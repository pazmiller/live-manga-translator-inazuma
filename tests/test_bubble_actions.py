import base64
import io
import json
import os
import sys
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import ocr
import server
import translate


def png_payload(size=(300, 100)):
    buffer = io.BytesIO()
    with Image.new("RGB", size, "white") as image:
        image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()


class BubbleActionTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        server._ocr_cache.clear()
        translate._cache.clear()
        self.image = png_payload()
        self.text_request = dict(text="corrected dialogue", source="en", target="zh-CN", provider="google")

    def tearDown(self):
        self.client.close()

    def test_ocr_needs_no_provider_keys_and_upscales_saved_crop(self):
        lines = [dict(box=[20, 20, 100, 50], text="correctly read", score=1)]
        with patch.dict(os.environ, {}, clear=True), patch.object(ocr, "ocr_lines", return_value=lines) as engine, patch.object(translate, "translate_text") as provider:
            response = self.client.post("/bubble/ocr", json=dict(image=self.image, source="en"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"text": "correctly read"})
        image, source = engine.call_args.args
        self.assertEqual(image.shape, (300, 900, 3))
        self.assertEqual(source, "en")
        provider.assert_not_called()

    def test_ocr_upscale_is_bounded_and_blank_is_valid(self):
        with patch.object(ocr, "ocr_lines", return_value=[]) as engine:
            response = self.client.post("/bubble/ocr", json=dict(image=png_payload((1000, 300)), source="ja"))
        self.assertEqual(response.json(), {"text": ""})
        self.assertEqual(engine.call_args.args[0].shape, (480, 1600, 3))

    def test_ocr_invalid_image_does_not_consume_a_slot(self):
        slot = threading.BoundedSemaphore(1)
        with patch.object(server, "_slots", slot), patch.dict(os.environ, {}, clear=True):
            response = self.client.post("/bubble/ocr", json=dict(image="invalid", source="ja"))
            self.assertEqual(response.status_code, 400)
            self.assertTrue(slot.acquire(blocking=False))
            slot.release()

    def test_corrected_text_is_used_for_google_and_deepseek(self):
        for provider, function in (("google", "translate_free"), ("deepseek", "translate_deepseek")):
            with self.subTest(provider=provider), patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-placeholder"}), patch.object(translate, function, return_value=["  translation  "]) as call, patch.object(ocr, "ocr_lines") as engine:
                response = self.client.post("/bubble/translate", json={**self.text_request, "provider": provider})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"text": "corrected dialogue", "translated": "translation"})
            call.assert_called_once_with(["corrected dialogue"], "en", "zh-CN")
            engine.assert_not_called()

    def test_claude_receives_corrected_text_without_images(self):
        client = Mock()
        client.beta.messages.create.return_value = SimpleNamespace(
            stop_reason="end_turn", content=[SimpleNamespace(type="text", text='["correct translation"]')])
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-placeholder"}), patch.object(translate, "_anthropic_client", return_value=client), patch.object(translate, "translate_claude_vision") as vision:
            response = self.client.post("/bubble/translate", json={**self.text_request, "provider": "claude"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"text": "corrected dialogue", "translated": "correct translation"})
        content = client.beta.messages.create.call_args.kwargs["messages"][0]["content"]
        self.assertEqual([part["type"] for part in content], ["text"])
        self.assertIn("corrected dialogue", content[0]["text"])
        vision.assert_not_called()

    def test_text_validation_prevents_provider_calls(self):
        invalid = ({"text": ""}, {"text": " \n "}, {"text": "x" * 4001}, {"source": "xx"},
                   {"target": "xx"}, {"provider": "xx"}, {"text": 123})
        with patch.object(translate, "translate_text") as provider:
            for changes in invalid:
                with self.subTest(changes=list(changes)):
                    response = self.client.post("/bubble/translate", json={**self.text_request, **changes})
                    self.assertEqual(response.status_code, 422)
            provider.assert_not_called()

    def test_invalid_translation_count_or_blank_is_not_success(self):
        for result in ([], [""], [" "], [None], ["one", "two"], "wrong type"):
            with self.subTest(result=result), patch.object(translate, "translate_free", return_value=result):
                response = self.client.post("/bubble/translate", json=self.text_request)
            self.assertEqual(response.status_code, 502)
            self.assertNotIn("translated", response.json())

    def test_malformed_claude_result_is_not_success(self):
        for result in ('[]', '["one", "two"]', '[" "]', '["unfinished"'):
            with self.subTest(result=result), patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-placeholder"}), patch.object(translate, "_claude_response", return_value=result):
                response = self.client.post("/bubble/translate", json={**self.text_request, "provider": "claude"})
            self.assertEqual(response.status_code, 502)

    def test_provider_exception_is_sanitized_and_releases_slot(self):
        for error in (TimeoutError("private URL and secret"), ValueError("private URL and secret")):
            slot = threading.BoundedSemaphore(1)
            with self.subTest(error=type(error).__name__), patch.object(server, "_slots", slot), patch.object(translate, "translate_free", side_effect=error):
                response = self.client.post("/bubble/translate", json=self.text_request)
            self.assertEqual(response.status_code, 502)
            self.assertNotIn("private", response.text)
            self.assertNotIn("secret", response.text)
            self.assertTrue(slot.acquire(blocking=False))
            slot.release()

    def test_bubble_endpoints_share_existing_concurrency_limit(self):
        with patch.object(server, "_slots", threading.BoundedSemaphore(0)), patch.object(ocr, "ocr_lines") as engine, patch.object(translate, "translate_text") as provider:
            self.assertEqual(self.client.post("/bubble/ocr", json=dict(image=self.image)).status_code, 429)
            self.assertEqual(self.client.post("/bubble/translate", json=self.text_request).status_code, 429)
            engine.assert_not_called()
            provider.assert_not_called()

    def test_paid_text_translation_still_requires_key(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(translate, "translate_text") as provider:
            for name in ("claude", "deepseek"):
                self.assertEqual(self.client.post("/bubble/translate", json={**self.text_request, "provider": name}).status_code, 400)
            provider.assert_not_called()


class SelectedRetryTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        server._ocr_cache.clear()
        translate._cache.clear()
        self.payload = dict(image=png_payload(), source="en", target="zh-CN", provider="google")
        self.lines = [dict(box=[20 + i * 100, 20, 60 + i * 100, 40], text=text, score=1)
                      for i, text in enumerate(("first", "second", "third"))]

    def tearDown(self):
        self.client.close()

    def events(self, payload):
        response = self.client.post("/translate/stream", json=payload)
        self.assertEqual(response.status_code, 200)
        return [json.loads(line) for line in response.text.splitlines()]

    def seed(self):
        with patch.object(ocr, "ocr_lines", return_value=self.lines), patch.object(translate, "translate_free", return_value=["a", "b", "c"]):
            self.events(self.payload)

    def test_retry_after_partial_failure_only_sends_missing_original_ids(self):
        def partial(*_):
            yield "first success"
            raise TimeoutError("private provider error")

        payload = {**self.payload, "provider": "deepseek"}
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-placeholder"}), patch.object(ocr, "ocr_lines", return_value=self.lines) as engine:
            with patch.object(translate, "_deepseek_stream", side_effect=partial):
                first = self.events(payload)
            with patch.object(translate, "_deepseek_stream", return_value=iter(["second success", "third success"])) as provider:
                retry = self.events({**payload, "only_ids": [2, 1]})
        self.assertEqual([event["bubble"]["id"] for event in first if event["type"] == "bubble"], [0])
        self.assertEqual(first[-1]["type"], "error")
        provider.assert_called_once_with(["second", "third"], "en", "zh-CN")
        regions = next(event for event in retry if event["type"] == "regions")
        self.assertTrue(regions["cached"])
        self.assertEqual([bubble["id"] for bubble in regions["bubbles"]], [1, 2])
        results = [event for event in retry if event["type"] == "bubble"]
        self.assertEqual([event["bubble"]["id"] for event in results], [1, 2])
        self.assertEqual([event["total"] for event in results], [2, 2])
        self.assertEqual([event["completed"] for event in results], [1, 2])
        self.assertEqual(retry[-1]["count"], 2)
        self.assertEqual(engine.call_count, 1)
        self.assertEqual([b["id"] for b in next(iter(server._ocr_cache.values()))], [0, 1, 2])

    def test_empty_retry_does_not_call_provider(self):
        self.seed()
        with patch.object(translate, "translated_bubbles") as provider:
            events = self.events({**self.payload, "only_ids": []})
        self.assertEqual(next(event for event in events if event["type"] == "regions")["bubbles"], [])
        self.assertEqual(events[-1]["count"], 0)
        provider.assert_not_called()

    def test_retry_ids_are_strict_bounded_and_unique(self):
        with patch.object(ocr, "ocr_lines") as engine, patch.object(translate, "translated_bubbles") as provider:
            for ids in ([-1], [0, 0], [True], [1.0], ["1"], list(range(101)), "1"):
                with self.subTest(ids=ids):
                    response = self.client.post("/translate/stream", json={**self.payload, "only_ids": ids})
                    self.assertEqual(response.status_code, 422)
            engine.assert_not_called()
            provider.assert_not_called()

    def test_unknown_id_and_expired_cache_fail_without_reidentifying_bubbles(self):
        self.seed()
        with patch.object(ocr, "ocr_lines") as engine, patch.object(translate, "translated_bubbles") as provider:
            unknown = self.events({**self.payload, "only_ids": [3]})
            server._ocr_cache.clear()
            expired = self.events({**self.payload, "only_ids": [1]})
            engine.assert_not_called()
            provider.assert_not_called()
        self.assertEqual(unknown[-1]["type"], "error")
        self.assertIn("编号", unknown[-1]["message"])
        self.assertEqual(expired[-1]["type"], "error")
        self.assertIn("重新翻译整个选区", expired[-1]["message"])

    def test_cached_success_is_never_resent_to_provider(self):
        bubbles = [dict(id=0, text="first"), dict(id=1, text="second")]
        with patch.object(translate, "translate_free", return_value=["a", "b"]):
            list(translate.translated_bubbles(bubbles, None, "en", "zh-CN", "google", threading.Event()))
        for key in list(translate._cache):
            if key[-1] == 1:
                del translate._cache[key]
        with patch.object(translate, "translate_free", return_value=["retried"]) as provider:
            results = list(translate.translated_bubbles(bubbles, None, "en", "zh-CN", "google", threading.Event()))
        provider.assert_called_once_with(["second"], "en", "zh-CN")
        self.assertEqual([(b["id"], b["cached"]) for b in results], [(0, True), (1, False)])


if __name__ == "__main__":
    unittest.main()
