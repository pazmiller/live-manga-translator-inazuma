import io
import base64
import json
import sys
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from backend_test_support import authenticated_client
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import server
import translate


def client_for(texts, swapped=False):
    client = MagicMock()
    payload = json.dumps([dict(index=i, source=text if not swapped else 'wrong', translation=f'translated-{i}')
                          for i, text in enumerate(texts)])
    stream = MagicMock()
    stream.__iter__.return_value = iter(SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=payload[i:i+9]))])
                                        for i in range(0, len(payload), 9))
    client.chat.completions.create.return_value = stream
    return client, stream


class ProviderTests(unittest.TestCase):
    def setUp(self):
        translate._cache.clear()
        server._ocr_cache.clear()

    def test_three_providers_use_configured_models_and_validate_source_mapping(self):
        for provider in translate.PROVIDERS:
            with self.subTest(provider=provider):
                config = dict(api_key='test-private-key', model=translate.PROVIDERS[provider]['defaultModel'])
                client, stream = client_for(['original'])
                with patch.object(translate, '_llm_client', return_value=client) as factory:
                    self.assertEqual(translate.translate_text('original', 'ja', 'zh-CN', provider, config), 'translated-0')
                factory.assert_called_once_with(provider, 'test-private-key')
                kwargs = client.chat.completions.create.call_args.kwargs
                self.assertEqual(kwargs['model'], config['model'])
                self.assertNotIn('temperature', kwargs)
                stream.close.assert_called_once()
                bad_client, _ = client_for(['original'], swapped=True)
                with patch.object(translate, '_llm_client', return_value=bad_client), self.assertRaisesRegex(translate.TranslationError, '对应'):
                    translate.translate_text('original', 'ja', 'zh-CN', provider, config)

    def test_cache_isolated_by_provider_model_and_key(self):
        calls = []
        def generate(texts, source, target, provider, config):
            calls.append((provider, config['model'], config['api_key']))
            yield 'translated'
        bubbles = [dict(id=0, text='original')]
        configs = [('openai', 'model-a', 'key-a'), ('openai', 'model-a', 'key-a'),
                   ('openai', 'model-b', 'key-a'), ('openai', 'model-a', 'key-b'), ('gemini', 'model-a', 'key-a')]
        with patch.object(translate, '_llm_stream', generate):
            for provider, model, key in configs:
                list(translate.translated_bubbles(bubbles, None, 'ja', 'en', provider, threading.Event(),
                                                 dict(model=model, api_key=key)))
        self.assertEqual(len(calls), 4)

    def test_http_single_batch_and_stream_receive_request_credentials(self):
        http = authenticated_client(server)
        self.addCleanup(http.close)
        config = dict(provider='openai', model='custom-model', api_key='test-private-key', source='ja', target='zh-CN')
        with patch.object(translate, '_llm_client', side_effect=lambda *_: client_for(['original'])[0]):
            self.assertEqual(http.post('/bubble/translate', json={**config, 'text':'original'}).json()['translated'], 'translated-0')
            self.assertEqual(http.post('/selection/translate-texts', json={**config, 'texts':['original']}).json()['items'][0]['text'], 'original')
            buffer = io.BytesIO()
            Image.new('RGB', (100,100), 'white').save(buffer, format='PNG')
            with patch.object(server.ocr, 'ocr_lines', return_value=[dict(box=[10,10,70,40],text='original',score=1)]):
                response = http.post('/translate/stream', json={**config, 'image':base64.b64encode(buffer.getvalue()).decode()})
            events = [json.loads(line) for line in response.text.splitlines()]
            self.assertEqual(events[-1]['type'], 'done')
            self.assertEqual(events[-1]['count'], 1)
            self.assertNotIn('test-private-key', response.text)
        invalid = http.post('/bubble/translate', json={**config, 'provider':'invalid', 'text':'original'})
        self.assertEqual(invalid.status_code, 422)
        self.assertNotIn('test-private-key', invalid.text)


if __name__ == '__main__':
    unittest.main()
