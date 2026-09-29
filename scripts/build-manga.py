"""Freeze the CPU Manga OCR worker and its cached model for an offline install."""
import subprocess
import sys
from pathlib import Path

from huggingface_hub import snapshot_download

root = Path(__file__).resolve().parents[1]
model = snapshot_download("kha-white/manga-ocr-base",
                          revision="aa6573bd10b0d446cbf622e29c3e084914df9741", local_files_only=True)
subprocess.run([
    sys.executable, "-m", "PyInstaller", "--noconfirm", "--onedir",
    "--name", "inazuma-manga-ocr", "--distpath", str(root / ".build/manga-runtime"),
    "--workpath", str(root / ".build/manga-work"), "--specpath", str(root / ".build"),
    "--collect-all", "manga_ocr", "--collect-data", "transformers",
    "--collect-all", "unidic_lite", "--collect-all", "fugashi",
    "--hidden-import", "transformers.models.vit.modeling_vit",
    "--hidden-import", "transformers.models.bert.modeling_bert",
    "--hidden-import", "transformers.models.bert_japanese.tokenization_bert_japanese",
    "--hidden-import", "transformers.models.vision_encoder_decoder.modeling_vision_encoder_decoder",
    "--hidden-import", "transformers.models.vit.image_processing_vit",
    "--add-data", f"{model};manga-model",
    str(root / "backend/manga_ocr_worker.py"),
], cwd=root, check=True)
