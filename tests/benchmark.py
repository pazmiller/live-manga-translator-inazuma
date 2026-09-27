"""Opt-in real HTTP/OCR/provider check. Saves only fixture results, never keys."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".qa"
URL = "http://127.0.0.1:18765"


def run_case(name, image):
    payload = json.dumps(dict(image=base64.b64encode(image.read_bytes()).decode(), source="ja", target="zh-CN", provider="deepseek")).encode()
    request = urllib.request.Request(URL+"/translate/stream", data=payload, headers={"Content-Type": "application/json"})
    start = time.perf_counter()
    events, arrivals = [], []
    with urllib.request.urlopen(request, timeout=75) as response:
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
                                stdout=log, stderr=log, env={**os.environ,"PYTHONIOENCODING":"utf-8"}, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            ready = False
            for _ in range(120):
                if proc.poll() is not None:
                    raise RuntimeError("Backend exited; inspect .qa/backend-benchmark.log")
                try:
                    with urllib.request.urlopen(URL+"/health", timeout=1) as response:
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
