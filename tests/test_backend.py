import os
import base64
import io
import json
import sys
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import ocr
import translate


class LayoutTests(unittest.TestCase):
    def bubble(self):
        return ocr.group_bubbles([{"box": [20, 20, 60, 40], "text": "hello", "score": 1}])[0]

    def test_dark_background_preserved(self):
        img = np.full((80, 100, 3), [40, 30, 20], np.uint8)
        b = ocr.prepare_layout(img, [self.bubble()])[0]
        self.assertTrue(b["can_replace"])
        self.assertEqual(b["background"], "#141e28")
        self.assertEqual(b["foreground"], "#f7f7f7")
        self.assertEqual((b["x"], b["w"]), (20, 40))

    def test_texture_uses_reading_card(self):
        img = np.random.default_rng(7).integers(0, 255, (80, 100, 3), dtype=np.uint8)
        self.assertFalse(ocr.prepare_layout(img, [self.bubble()])[0]["can_replace"])

    def test_screentone_stripes_are_not_flat_fill(self):
        img = np.full((80, 100, 3), [235, 210, 221], np.uint8)
        img[::5] = [202, 170, 178]
        self.assertFalse(ocr.prepare_layout(img, [self.bubble()])[0]["can_replace"])

    def test_mask_covers_missed_glyph_in_uneven_lines(self):
        img = np.full((120, 140, 3), 255, np.uint8)
        lines = [dict(box=[20, 20, 80, 40], text="one"), dict(box=[40, 44, 100, 64], text="two")]
        img[49:51, 23:32] = 0  # a glyph omitted by the second OCR line
        b = ocr.prepare_layout(img, ocr.group_bubbles(lines))[0]
        self.assertTrue(b["can_replace"])
        self.assertTrue(any(m["x"] <= 23 and m["x"]+m["w"]>=32 and m["y"]<=49 and m["y"]+m["h"]>=51 for m in b["masks"]))

    def test_nearby_bubbles_separated_by_black_border(self):
        img = np.full((120, 170, 3), 255, np.uint8)
        img[:, 82:86] = 0
        lines = [dict(box=[20, 30, 73, 50], text="a"), dict(box=[94, 30, 145, 50], text="b")]
        self.assertEqual(len(ocr.group_bubbles(lines, img=img)), 2)

    def test_vertical_reading_order_and_fragment(self):
        lines = [dict(box=[40, 40, 60, 125], text="なる"),
                 dict(box=[70, 15, 90, 125], text="明日は"),
                 dict(box=[40, 15, 60, 36], text="よく")]
        b = ocr.group_bubbles(lines)[0]
        self.assertTrue(b["vertical"])
        self.assertEqual(b["text"], "明日はよくなる")

    def test_small_ruby_beside_vertical_column_not_dialogue(self):
        lines = [dict(box=[120, 5, 187, 210], text="立川で見た"),
                 dict(box=[108, 119, 133, 176], text="2404"),
                 dict(box=[54, 14, 78, 90], text="28"),
                 dict(box=[70, 23, 121, 206], text="穴の下の"),
                 dict(box=[15, 11, 67, 250], text="巨大な眼は")]
        b = ocr.group_bubbles(lines)[0]
        self.assertEqual(b["text"], "立川で見た穴の下の巨大な眼は")
        self.assertEqual(len(b["boxes"]), 5, "Ruby still needs masking in a flat bubble")


class TranslationTests(unittest.TestCase):
    def setUp(self):
        translate._cache.clear()

    def test_incremental_json_respects_escapes(self):
        raw = '["你好\\n世界", "say \\\"yes\\\"", "完了"]'
        expected = json.loads(raw)
        parser = translate.ArrayStream()
        got = []
        for char in raw:
            got.extend(parser.feed(char))
        parser.finish(3)
        self.assertEqual(got, expected)

    def test_missing_or_empty_result_is_error(self):
        for raw in ('["ok"]', '["ok", ""]', '["ok", null]', '["ok", "fine"'):
            parser = translate.ArrayStream()
            with self.assertRaises(ValueError):
                parser.feed(raw)
                parser.finish(2)

    def test_deepseek_response_must_match_each_source(self):
        def response(items):
            payload = json.dumps(items, ensure_ascii=False)
            chunks = [payload[i:i+7] for i in range(0, len(payload), 7)]
            stream = MagicMock()
            stream.__iter__.return_value = iter(SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=part))]) for part in chunks)
            client = Mock()
            client.chat.completions.create.return_value = stream
            return client

        # Two similar opening lines from the reported page must keep their own identity.
        texts = ["ち違くてその…", "い、いやこれは…"]
        valid = [{"index": 0, "source": texts[0], "translation": "one"},
                 {"index": 1, "source": texts[1], "translation": "two"}]
        with patch.object(translate, "_deepseek_client", return_value=response(valid)):
            self.assertEqual(list(translate._deepseek_stream(texts, "ja", "zh-CN")), ["one", "two"])
        swapped = [{**valid[0], "source": texts[1]}, {**valid[1], "source": texts[0]}]
        with patch.object(translate, "_deepseek_client", return_value=response(swapped)):
            with self.assertRaisesRegex(translate.TranslationError, "对应"):
                list(translate._deepseek_stream(texts, "ja", "zh-CN"))

    def test_failed_batch_is_not_cached(self):
        def failed(*_):
            yield "first"
            raise ValueError("invalid tail")
        b = [dict(id=0, text="a"), dict(id=1, text="b")]
        with patch.object(translate, "_deepseek_stream", failed):
            with self.assertRaises(ValueError):
                list(translate.translated_bubbles(b, None, "ja", "en", "deepseek", threading.Event()))
        self.assertEqual(len(translate._cache), 0)

    def test_cache_reuses_context_but_not_target(self):
        b = [dict(id=0, text="a")]
        with patch.object(translate, "_deepseek_stream", side_effect=lambda *_: iter(["translated"])) as provider:
            for target in ("en", "en", "zh-CN"):
                list(translate.translated_bubbles(b, None, "ja", target, "deepseek", threading.Event()))
            self.assertEqual(provider.call_count, 2)

    def test_cancel_does_not_call_provider(self):
        cancel = threading.Event()
        cancel.set()
        with patch.object(translate, "_deepseek_stream") as provider:
            self.assertEqual(list(translate.translated_bubbles([dict(id=0,text="a")],None,"ja","en","deepseek",cancel)), [])
            provider.assert_not_called()


class EndpointTests(unittest.TestCase):
    def setUp(self):
        from backend_test_support import authenticated_client
        import server
        credentials = patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-placeholder"})
        credentials.start()
        self.addCleanup(credentials.stop)
        self.server = server
        server._ocr_cache.clear()
        self.client = authenticated_client(server)
        buffer = io.BytesIO()
        Image.new("RGB", (100, 100), "white").save(buffer, format="PNG")
        self.payload = dict(image=base64.b64encode(buffer.getvalue()).decode(), provider="deepseek")

    def tearDown(self):
        self.client.close()

    def test_invalid_image_and_provider(self):
        self.assertEqual(self.client.post("/translate/stream", json={**self.payload,"image":"not base64!"}).status_code, 400)
        self.assertEqual(self.client.post("/translate/stream", json={**self.payload,"provider":"oops"}).status_code, 422)

    def test_empty_ocr_does_not_call_translation(self):
        with patch.object(ocr,"ocr_lines",return_value=[]), patch.object(translate,"translated_bubbles") as provider:
            response = self.client.post("/translate/stream", json=self.payload)
            events = [json.loads(line) for line in response.text.splitlines()]
            self.assertEqual(events[-1]["type"], "done")
            self.assertEqual(events[-1]["count"], 0)
            provider.assert_not_called()

    def test_stream_stages_and_ocr_cache(self):
        def translated(bubbles, *_):
            yield {**bubbles[0], "translated":"hello", "cached":False}
        lines = [dict(box=[20,20,60,40],text="test",score=1)]
        with patch.object(ocr,"ocr_lines",return_value=lines) as engine, patch.object(translate,"translated_bubbles",translated):
            first = self.client.post("/translate/stream",json=self.payload)
            events = [json.loads(line) for line in first.text.splitlines()]
            self.assertEqual([e["type"] for e in events], ["progress","regions","progress","bubble","done"])
            second = self.client.post("/translate",json=self.payload)
            self.assertEqual(second.status_code,200)
            self.assertTrue(second.json()["ocr_cached"])
            self.assertEqual(engine.call_count,1)

    def test_provider_failure_is_error_not_blank_success(self):
        with patch.object(ocr,"ocr_lines",return_value=[dict(box=[20,20,60,40],text="test",score=1)]), patch.object(translate,"translated_bubbles",side_effect=TimeoutError("private URL and key must not leak")):
            events = [json.loads(line) for line in self.client.post("/translate/stream",json=self.payload).text.splitlines()]
            self.assertEqual(events[-1]["type"],"error")
            self.assertNotIn("private",events[-1]["message"])
            self.assertNotIn("done",[e["type"] for e in events])


if __name__ == "__main__":
    unittest.main()
