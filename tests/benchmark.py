"""Opt-in real HTTP/OCR/provider check. Saves only fixture results, never keys."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import http.client
import secrets
import hmac
import hashlib
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".qa"
SESSION = secrets.token_bytes(32)


@contextmanager
def request_api(route, payload=None, timeout=75):
    connection = http.client.HTTPConnection('127.0.0.1', 18765, timeout=timeout)
    try:
        nonce = secrets.token_hex(32)
        connection.request('GET', '/auth?nonce='+nonce)
        response = connection.getresponse()
        proof = json.loads(response.read(4097)).get('proof', '')
        expected = hmac.new(SESSION, f'server\n{nonce}'.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(proof, expected) or connection.sock is None:
            raise RuntimeError('Backend authentication failed')
        token = hmac.new(SESSION, b'client', hashlib.sha256).hexdigest()
        connection.request('POST' if payload else 'GET', route, payload,
                           {'Content-Type':'application/json', 'Authorization':f'Bearer {token}'})
        yield connection.getresponse()
    finally:
        connection.close()


def run_case(name, image):
    payload = json.dumps(dict(image=base64.b64encode(image.read_bytes()).decode(), source="ja", target="zh-CN", provider="deepseek")).encode()
    start = time.perf_counter()
    events, arrivals = [], []
    with request_api('/translate/stream', payload) as response:
        for line in response:
            event = json.loads(line)
            events.append(event)
            arrivals.append(dict(type=event["type"], ms=round((time.perf_counter()-start)*1000)))
    errors = [e for e in events if e["type"] == "error"]
    if errors:
        raise RuntimeError(errors[0]["message"])
    assert events[-1]["type"] == "done", events[-1]
    result = dict(name=name, arrivals=arrivals, summary=events[-1], bubbles=[e["bubble"] for e in events if e["type"] == "bubble"])
    (OUT / (name+".json")).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k:v for k,v in result.items() if k!="bubbles"}, ensure_ascii=True), flush=True)
    return result


if __name__ == "__main__":
    if "--live" not in sys.argv:
        raise SystemExit("Pass --live to make real DeepSeek requests using .env")
    OUT.mkdir(exist_ok=True)
    with (OUT / "backend-benchmark.log").open("w", encoding="utf-8") as log:
        proc = subprocess.Popen([sys.executable, str(ROOT/"backend/server.py"), "18765"], cwd=ROOT,
                                stdin=subprocess.PIPE, stdout=log, stderr=log, env={**os.environ,"PYTHONIOENCODING":"utf-8"}, creationflags=subprocess.CREATE_NO_WINDOW)
        proc.stdin.write(SESSION.hex().encode()+b'\n')
        proc.stdin.close()
        try:
            ready = False
            for _ in range(120):
                if proc.poll() is not None:
                    raise RuntimeError("Backend exited; inspect .qa/backend-benchmark.log")
                try:
                    with request_api('/health', timeout=1) as response:
                        info = json.load(response)
                    if info["ocr"] == "ready":
                        ready = True
                        break
                except OSError:
                    pass
                time.sleep(.25)
            assert ready, "OCR warmup did not complete"
            run_case("live-fixture", OUT/"fixture.png")
            repeat = run_case("live-repeat", OUT/"fixture.png")
            assert repeat["summary"]["ocr_cached"]
            assert repeat["summary"]["cached"] == repeat["summary"]["count"]
            for name in ("real-01", "real-02"):
                if (OUT/(name+".jpg")).exists():
                    run_case("live-"+name, OUT/(name+".jpg"))
        finally:
            proc.terminate()
            proc.wait(timeout=10)
