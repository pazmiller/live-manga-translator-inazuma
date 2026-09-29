import hashlib
import hmac
import io
import secrets
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from fastapi.testclient import TestClient
from local_auth import client_token, read_session_key, LocalAuth
import server


class LocalAuthTests(unittest.TestCase):
    def setUp(self):
        self.previous = server.app.state.session_key
        self.secret = secrets.token_bytes(32)
        server.app.state.session_key = self.secret
        self.client = TestClient(server.app)
        self.headers = {'Authorization': f'Bearer {client_token(self.secret)}'}

    def tearDown(self):
        self.client.close()
        server.app.state.session_key = self.previous

    def test_all_application_routes_require_auth_before_validation(self):
        for route in ('/health', '/docs', '/openapi.json'):
            self.assertEqual(self.client.get(route).status_code, 401)
        for route in ('/translate', '/translate/stream', '/bubble/translate',
                      '/bubble/ocr', '/bubble/manga-ocr', '/selection/translate-texts'):
            self.assertEqual(self.client.post(route, content=b'not JSON').status_code, 401)

    def test_health_and_translation_with_valid_credentials(self):
        self.assertEqual(self.client.get('/health', headers=self.headers).status_code, 200)
        with patch.object(server.translate, 'translate_text', return_value='translated') as translate:
            response = self.client.post('/bubble/translate', headers=self.headers,
                                        json={'provider':'deepseek', 'api_key':'test-placeholder', 'text':'hello'})
            self.assertEqual(response.status_code, 200)
            translate.assert_called_once()

    def test_challenge_is_fresh_and_not_a_client_token(self):
        nonce = secrets.token_hex(32)
        response = self.client.get('/auth', params={'nonce':nonce})
        proof = response.json()['proof']
        self.assertEqual(proof, hmac.new(self.secret, f'server\n{nonce}'.encode(), hashlib.sha256).hexdigest())
        self.assertNotEqual(proof, client_token(self.secret))
        self.assertEqual(self.client.get('/health', headers={'Authorization':f'Bearer {proof}'}).status_code, 401)
        self.assertEqual(self.client.get('/auth?nonce=bad').status_code, 400)

    def test_old_session_and_browser_requests_rejected(self):
        old = self.headers
        server.app.state.session_key = secrets.token_bytes(32)
        self.assertEqual(self.client.get('/health', headers=old).status_code, 401)
        self.assertEqual(self.client.get('/auth?nonce=' + 'a'*64,
                                        headers={'Origin':'https://example.invalid'}).status_code, 403)

    def test_missing_parent_secret_fails_closed(self):
        server.app.state.session_key = None
        self.assertEqual(self.client.get('/health').status_code, 503)
        for value in (b'', b'invalid\n', b'a'*100):
            with self.assertRaises(ValueError):
                read_session_key(io.BytesIO(value))
        self.assertEqual(read_session_key(io.BytesIO(self.secret.hex().encode()+b'\n')), self.secret)


class BeforeBodyTests(unittest.IsolatedAsyncioTestCase):
    async def test_unauthorized_body_is_never_read(self):
        async def forbidden(*args):
            self.fail('Unauthorized request reached request body or application')
        replies = []
        async def send(message): replies.append(message)
        middleware = LocalAuth(forbidden, lambda: b'x'*32)
        await middleware({'type':'http','method':'POST','path':'/translate','headers':[]}, forbidden, send)
        self.assertEqual(replies[0]['status'], 401)
