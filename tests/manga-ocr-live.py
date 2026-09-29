"""Manual live comparison using the same saved-bubble crop rule as main.js."""
import base64
import io
import json
import os
import sys
import time
from pathlib import Path

from backend_test_support import authenticated_client
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
import server


def main():
    if not server.manga_ocr_python():
        raise SystemExit("Set MWT_MANGA_OCR_PYTHON to the optional Manga OCR Python executable")
    report = []
    with authenticated_client(server) as client:
        for number in (1, 2):
            stem = f"real-{number:02d}"
            bubble = json.loads((ROOT / ".qa" / f"live-{stem}.json").read_text(encoding="utf-8"))["bubbles"][0]
            comparison = {"sample": stem}
            for name, route, padding in (("rapidocr", "ocr", 8), ("manga_ocr", "manga-ocr", 16)):
                with Image.open(ROOT / ".qa" / f"{stem}.jpg") as image:
                    x, y = max(0, int(bubble["x"] - padding)), max(0, int(bubble["y"] - padding))
                    crop = image.crop((x, y, min(image.width, x + int(bubble["w"] + 2 * padding)),
                                       min(image.height, y + int(bubble["h"] + 2 * padding))))
                    with io.BytesIO() as output:
                        crop.save(output, format="PNG")
                        payload = {"image": base64.b64encode(output.getvalue()).decode("ascii"), "source": "ja"}
                started = time.perf_counter()
                response = client.post(f"/bubble/{route}", json=payload)
                response.raise_for_status()
                comparison[name] = {"crop_size": crop.size, "text": response.json()["text"],
                                    "seconds": round(time.perf_counter() - started, 3)}
            report.append(comparison)
    target = ROOT / ".qa" / "manga-ocr-comparison.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    assert report[-1]["manga_ocr"]["seconds"] < 2.5, "Warm Manga OCR still starts and reloads for every bubble"
    print(json.dumps({"passed": True, "report": str(target), "results": report}, ensure_ascii=True))


if __name__ == "__main__":
    main()
