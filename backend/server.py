import asyncio
import base64
import binascii
import copy
import hashlib
import io
import json
import os
import queue
import sys
import threading
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, SecretStr, field_validator

_env = Path(os.environ["MWT_ENV_FILE"]) if os.environ.get("MWT_ENV_FILE") else Path(__file__).resolve().parent.parent / ".env"
if _env.exists():
    for line in _env.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("\"'"))

import ocr
import translate
from manga_worker import MangaWorker, MangaWorkerError

_warm = {"state": "loading"}
_slots = threading.BoundedSemaphore(2)
_ocr_cache = OrderedDict()
_ocr_cache_lock = threading.Lock()


def manga_ocr_python():
    if getattr(sys, "frozen", False):
        bundled = Path(sys.executable).parent.parent / "manga-ocr" / "inazuma-manga-ocr.exe"
        return bundled if bundled.is_file() else None
    if not Path(__file__).with_name("manga_ocr_worker.py").is_file():
        return None
    configured = os.getenv("MWT_MANGA_OCR_PYTHON")
    candidate = Path(configured) if configured else Path(__file__).resolve().parent.parent / ".manga-ocr-venv" / "Scripts" / "python.exe"
    return candidate if candidate.is_file() else None


_manga = MangaWorker(manga_ocr_python, None if getattr(sys, "frozen", False) else Path(__file__).with_name("manga_ocr_worker.py"))


def prewarm():
    try:
        ocr.warmup()
        _warm["state"] = "ready"
    except Exception:
        _warm["state"] = "error"


@asynccontextmanager
async def lifespan(app):
    threading.Thread(target=prewarm, daemon=True).start()
    threading.Thread(target=_manga.start, daemon=True).start()
    try:
        yield
    finally:
        _manga.close()


app = FastAPI(lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def invalid_request(_request, _error):
    # Validation errors can otherwise echo the entire request, including keys.
    return JSONResponse(status_code=422, content={"detail": "请求参数无效，请检查语言、模型和输入内容"})


class ProviderReq(BaseModel):
    provider: Literal["openai", "gemini", "deepseek", "google", "claude"] = "deepseek"
    model: str | None = Field(default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
    api_key: SecretStr | None = Field(default=None, max_length=4096)

    def translation_options(self):
        if self.model is None and self.api_key is None:
            return {}
        return {"config": {"model": self.model, "api_key": self.api_key.get_secret_value() if self.api_key else None}}


class ImageReq(BaseModel):
    image: str = Field(max_length=24_000_000)
    source: Literal["ja", "en", "zh", "ko"] = "ja"


class TranslateReq(ImageReq, ProviderReq):
    target: Literal["zh-CN", "zh-TW", "en", "ja"] = "zh-CN"
    only_ids: list[Annotated[int, Field(strict=True, ge=0)]] | None = Field(default=None, max_length=100)

    @field_validator("only_ids")
    @classmethod
    def unique_ids(cls, ids):
        if ids is not None and len(set(ids)) != len(ids):
            raise ValueError("气泡编号不能重复")
        return ids


class BubbleTranslateReq(ProviderReq):
    text: str = Field(min_length=1, max_length=4000)
    source: Literal["ja", "en", "zh", "ko"] = "ja"
    target: Literal["zh-CN", "zh-TW", "en", "ja"] = "zh-CN"

    @field_validator("text")
    @classmethod
    def nonempty_text(cls, text):
        if not text.strip():
            raise ValueError("请输入气泡原文")
        return text.strip()


class TextsTranslateReq(ProviderReq):
    texts: list[Annotated[str, Field(min_length=1, max_length=4000)]] = Field(min_length=1, max_length=100)
    source: Literal["ja", "en", "zh", "ko"] = "ja"
    target: Literal["zh-CN", "zh-TW", "en", "ja"] = "zh-CN"

    @field_validator("texts")
    @classmethod
    def nonempty_texts(cls, texts):
        if any(not text.strip() for text in texts):
            raise ValueError("气泡原文不能为空")
        return [text.strip() for text in texts]


@app.get("/health")
def health():
    manga_state = _manga.status()
    return {"ok": True, "service": "manga-window-translator", "protocol": 4,
            "ocr": _warm["state"], "manga_ocr": manga_state == "ready",
            "manga_ocr_state": manga_state,
            "providers": {provider: bool(translate.provider_config(provider)['api_key']) for provider in translate.PROVIDERS}}


def require_provider(provider, config=None):
    if provider in translate.PROVIDERS and not translate.provider_config(provider, config)['api_key']:
        raise HTTPException(400, "请打开 翻译AI配置，为所选服务商填写 API Key")
    if provider == "claude" and not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(400, "请在 .env 配置 ANTHROPIC_API_KEY 后重启")


def decode_image(req):
    try:
        raw = base64.b64decode(req.image, validate=True)
        with Image.open(io.BytesIO(raw)) as original:
            if original.width * original.height > 12_000_000:
                raise HTTPException(400, "选区过大，请缩小到 1200 万像素以内")
            pil = original.convert("RGB")
    except (ValueError, binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(400, "截图无效，请重新框选") from None
    return pil, hashlib.sha256(raw).hexdigest()


def pipeline(req, pil, digest, cancelled):
    started = time.perf_counter()
    yield {"type": "progress", "stage": "ocr", "text": "正在识别文字…"}
    key = (digest, req.source)
    with _ocr_cache_lock:
        bubbles = copy.deepcopy(_ocr_cache.get(key))
        if bubbles is not None:
            _ocr_cache.move_to_end(key)
    ocr_cached = bubbles is not None
    if req.only_ids is not None and bubbles is None:
        raise translate.TranslationError("原选区的识别缓存已失效，请重新翻译整个选区后再补翻气泡")
    if bubbles is None:
        img = np.asarray(pil)[:, :, ::-1].copy()
        lines = ocr.ocr_lines(img, req.source)
        bubbles = ocr.prepare_layout(img, ocr.group_bubbles(lines, img=img, source=req.source))
        if len(bubbles) > 100:
            raise translate.TranslationError("文字区域过多，请缩小选区")
        for i, b in enumerate(bubbles):
            b["id"] = i
        with _ocr_cache_lock:
            _ocr_cache[key] = copy.deepcopy(bubbles)
            while len(_ocr_cache) > 12:
                _ocr_cache.popitem(last=False)
    if req.only_ids is not None:
        selected = set(req.only_ids)
        if not selected.issubset({b["id"] for b in bubbles}):
            raise translate.TranslationError("气泡编号与原选区不匹配，请重新翻译整个选区")
        bubbles = [b for b in bubbles if b["id"] in selected]
    ocr_ms = round((time.perf_counter() - started) * 1000)
    if cancelled.is_set():
        return
    yield {"type": "regions", "bubbles": bubbles, "ocr_ms": ocr_ms, "cached": ocr_cached}
    translated = cached = 0
    if bubbles:
        yield {"type": "progress", "stage": "translation", "text": f"识别到 {len(bubbles)} 处，正在翻译…"}
        for b in translate.translated_bubbles(bubbles, pil, req.source, req.target, req.provider, cancelled, **req.translation_options()):
            if cancelled.is_set():
                return
            translated += 1
            cached += int(b["cached"])
            yield {"type": "bubble", "bubble": b, "completed": translated, "total": len(bubbles)}
    elapsed = round((time.perf_counter() - started) * 1000)
    yield {"type": "done", "count": translated, "timings": {"ocr_ms": ocr_ms,
           "translation_ms": elapsed-ocr_ms, "total_ms": elapsed}, "cached": cached, "ocr_cached": ocr_cached}


def error_message(error):
    if isinstance(error, translate.TranslationError):
        return str(error)
    name = type(error).__name__.lower()
    if "timeout" in name:
        return "翻译服务响应超时，请重试或更换引擎"
    if "authentication" in name or "permission" in name:
        return "翻译服务拒绝访问，请检查 API key"
    if "ratelimit" in name or "toomany" in name:
        return "翻译服务限流，请稍后重试或更换引擎"
    return "识别或翻译失败，请检查网络、模型和引擎配置后重试"


@app.post("/bubble/ocr")
def bubble_ocr(req: ImageReq):
    if not _slots.acquire(blocking=False):
        raise HTTPException(429, "识别服务忙，请稍后重试")
    pil = enlarged = None
    try:
        pil, _ = decode_image(req)
        # Improve small saved crops without creating an unbounded OCR bitmap.
        scale = max(1, min(3, 1600 / max(pil.size)))
        enlarged = pil.resize((round(pil.width * scale), round(pil.height * scale)), Image.Resampling.LANCZOS) if scale > 1 else pil
        img = np.asarray(enlarged)[:, :, ::-1].copy()
        lines = ocr.ocr_lines(img, req.source)
        bubbles = ocr.group_bubbles(lines, source=req.source)
        return {"text": "\n".join(b["text"].strip() for b in bubbles if b["text"].strip())}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(502, error_message(error)) from None
    finally:
        if enlarged is not None and enlarged is not pil:
            enlarged.close()
        if pil is not None:
            pil.close()
        _slots.release()


@app.post("/bubble/manga-ocr")
def bubble_manga_ocr(req: ImageReq):
    if req.source != "ja":
        raise HTTPException(400, "日漫精读仅支持日文原文")
    if manga_ocr_python() is None:
        raise HTTPException(503, "尚未安装日漫精读模型")
    manga_state = _manga.status()
    if manga_state != "ready":
        message = "日漫精读模型正在后台载入，请稍候重试" if manga_state == "loading" else "日漫精读模型启动失败，请重启应用"
        raise HTTPException(503, message)
    if not _slots.acquire(blocking=False):
        raise HTTPException(429, "识别服务忙，请稍后重试")
    try:
        image, _ = decode_image(req)
        with image, io.BytesIO() as payload:
            image.save(payload, format="PNG")
            try:
                return {"text": _manga.recognize(payload.getvalue())}
            except MangaWorkerError as error:
                raise HTTPException(error.status_code, str(error)) from None
    finally:
        _slots.release()


@app.post("/bubble/translate")
def bubble_translate(req: BubbleTranslateReq):
    require_provider(req.provider, **req.translation_options())
    if not _slots.acquire(blocking=False):
        raise HTTPException(429, "翻译服务忙，请稍后重试")
    try:
        translated = translate.translate_text(req.text, req.source, req.target, req.provider, **req.translation_options())
        return {"text": req.text, "translated": translated}
    except Exception as error:
        raise HTTPException(502, error_message(error)) from None
    finally:
        _slots.release()


@app.post("/selection/translate-texts")
def selection_translate_texts(req: TextsTranslateReq):
    require_provider(req.provider, **req.translation_options())
    if not _slots.acquire(blocking=False):
        raise HTTPException(429, "翻译服务忙，请稍后重试")
    try:
        if req.provider == "claude":
            values = [translate.translate_text(text, req.source, req.target, req.provider) for text in req.texts]
        else:
            bubbles = [{"id": index, "text": text} for index, text in enumerate(req.texts)]
            values = [item["translated"] for item in translate.translated_bubbles(
                bubbles, None, req.source, req.target, req.provider, threading.Event(), **req.translation_options())]
        if len(values) != len(req.texts):
            raise translate.TranslationError("翻译条数与原文不一致，请重试")
        return {"items": [{"text": text, "translated": value} for text, value in zip(req.texts, values)]}
    except Exception as error:
        raise HTTPException(502, error_message(error)) from None
    finally:
        _slots.release()


@app.post("/translate/stream")
async def stream_translate(req: TranslateReq):
    require_provider(req.provider, **req.translation_options())
    pil, digest = decode_image(req)
    if not _slots.acquire(blocking=False):
        pil.close()
        raise HTTPException(429, "上一项任务正在结束，请稍后重试")
    events = queue.Queue(maxsize=8)
    cancelled = threading.Event()

    def put(event):
        while not cancelled.is_set():
            try:
                events.put(event, timeout=0.1)
                return True
            except queue.Full:
                pass
        return False

    def work():
        try:
            for event in pipeline(req, pil, digest, cancelled):
                if not put(event):
                    break
        except Exception as error:
            put({"type": "error", "message": error_message(error)})
        finally:
            pil.close()
            put(None)
            _slots.release()

    async def body():
        threading.Thread(target=work, daemon=True).start()
        try:
            while True:
                try:
                    event = await asyncio.to_thread(events.get, True, 0.2)
                except queue.Empty:
                    continue
                if event is None:
                    break
                yield json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"
        finally:
            cancelled.set()

    return StreamingResponse(body(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store"})


@app.post("/translate")
def do_translate(req: TranslateReq):
    require_provider(req.provider, **req.translation_options())
    pil, digest = decode_image(req)
    if not _slots.acquire(blocking=False):
        pil.close()
        raise HTTPException(429, "翻译服务忙，请稍后重试")
    try:
        bubbles, summary = [], {}
        for event in pipeline(req, pil, digest, threading.Event()):
            if event["type"] == "bubble":
                bubbles.append(event["bubble"])
            elif event["type"] == "done":
                summary = event
        return {**summary, "bubbles": sorted(bubbles, key=lambda b: b["id"])}
    except Exception as error:
        raise HTTPException(502, error_message(error)) from None
    finally:
        pil.close()
        _slots.release()


if __name__ == "__main__":
    import uvicorn
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
