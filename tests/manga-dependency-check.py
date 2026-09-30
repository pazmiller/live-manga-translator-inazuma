"""Compare installed MangaOCR environments on saved crops, offline and on CPU.

Run this script separately with each environment's Python. Requires existing
.qa/real-01.jpg, real-02.jpg and live-real-*.json fixtures (not distributed).
Prints a JSON report; does not change the application's selected interpreter.
"""
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import time

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_PROGRESS_BARS'] = '1'

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'aa6573bd10b0d446cbf622e29c3e084914df9741'


def main():
    started = time.perf_counter()
    from huggingface_hub import snapshot_download
    from manga_ocr import MangaOcr
    from PIL import Image
    import torch

    model_path = snapshot_download('kha-white/manga-ocr-base', revision=REVISION, local_files_only=True)
    model = MangaOcr(model_path, force_cpu=True)
    report = {'versions': {name: metadata.version(name) for name in ('torch', 'transformers', 'manga-ocr', 'setuptools')},
              'revision': REVISION, 'device': str(model.model.device), 'cuda_build': torch.version.cuda,
              'load_and_warmup_seconds': round(time.perf_counter() - started, 3), 'samples': []}
    for number in (1, 2):
        stem = f'real-{number:02d}'
        bubbles = json.loads((ROOT / '.qa' / f'live-{stem}.json').read_text(encoding='utf-8'))['bubbles']
        with Image.open(ROOT / '.qa' / f'{stem}.jpg') as image:
            for index, bubble in enumerate(bubbles):
                x, y = max(0, int(bubble['x'] - 16)), max(0, int(bubble['y'] - 16))
                with image.crop((x, y, min(image.width, x + int(bubble['w'] + 32)),
                                 min(image.height, y + int(bubble['h'] + 32)))) as crop:
                    results = []
                    for _ in range(3):
                        before = time.perf_counter()
                        text = model(crop)
                        assert isinstance(text, str) and text.strip(), 'Empty OCR result'
                        results.append({'text': text, 'seconds': round(time.perf_counter() - before, 3)})
                    assert len({item['text'] for item in results}) == 1, 'Repeated OCR output changed'
                    report['samples'].append({'sample': stem, 'bubble': index, 'size': crop.size, 'runs': results})
    print(json.dumps(report, ensure_ascii=True))


if __name__ == '__main__':
    main()
