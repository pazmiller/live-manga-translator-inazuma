"""Line-based Manga OCR worker: load once, read saved bubble PNGs until EOF."""
import base64
import io
import json
import sys
import os
from pathlib import Path

if getattr(sys, "frozen", False):
    import multiprocessing
    multiprocessing.freeze_support()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

from PIL import Image
from manga_ocr import MangaOcr


model = MangaOcr(str(Path(__file__).with_name("manga-model")), force_cpu=True) if getattr(sys, "frozen", False) else MangaOcr()
print(json.dumps({"type": "ready"}), flush=True)
for line in sys.stdin:
    try:
        request = json.loads(line)
        with Image.open(io.BytesIO(base64.b64decode(request["image"], validate=True))) as image:
            text = model(image.convert("RGB"))
        print(json.dumps({"text": text}, ensure_ascii=True), flush=True)
    except Exception:
        print(json.dumps({"error": "日漫精读识别失败，请检查截图后重试"}), flush=True)
