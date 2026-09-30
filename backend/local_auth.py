"""Per-launch parent/child authentication; never load its secret from config."""
import hashlib
import hmac
import re
from urllib.parse import parse_qs

from starlette.responses import JSONResponse


def read_session_key(stream):
    value = stream.readline(66).strip()
    if not re.fullmatch(rb'[a-f0-9]{64}', value):
        raise ValueError('Backend must be started by Inazuma with a private parent pipe')
    return bytes.fromhex(value.decode('ascii'))


def client_token(secret):
    return hmac.new(secret, b'client', hashlib.sha256).hexdigest()


class LocalAuth:
    def __init__(self, app, key):
        self.app, self.key = app, key

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        secret = self.key()
        headers = dict(scope.get('headers', []))
        response = None
        if not secret:
            response = JSONResponse({'detail': 'Backend authentication unavailable'}, status_code=503)
        elif b'origin' in headers:
            response = JSONResponse({'detail': 'Browser requests are not allowed'}, status_code=403)
        elif scope['path'] == '/auth' and scope['method'] == 'GET':
            nonce = parse_qs(scope.get('query_string', b'').decode('ascii', errors='replace')).get('nonce', [''])[0]
            if not re.fullmatch(r'[a-f0-9]{64}', nonce):
                response = JSONResponse({'detail': 'Invalid challenge'}, status_code=400)
            else:
                signature = hmac.new(secret, f'server\n{nonce}'.encode(), hashlib.sha256).hexdigest()
                response = JSONResponse({'proof': signature}, headers={'Cache-Control': 'no-store'})
        elif not hmac.compare_digest(headers.get(b'authorization', b''), f'Bearer {client_token(secret)}'.encode()):
            response = JSONResponse({'detail': 'Unauthorized local request'}, status_code=401)
        if response is not None:
            return await response(scope, receive, send)
        return await self.app(scope, receive, send)
