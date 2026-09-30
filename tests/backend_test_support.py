import secrets
import sys
from pathlib import Path
from fastapi.testclient import TestClient
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from local_auth import client_token


def authenticated_client(server):
    server.app.state.session_key = secrets.token_bytes(32)
    return TestClient(server.app, headers={
        'Authorization': f'Bearer {client_token(server.app.state.session_key)}'})
