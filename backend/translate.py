import base64
import io
import json
import os
import re
import time
import threading
from collections import OrderedDict
from functools import lru_cache

LANG_NAMES = {
    "ja": "Japanese", "en": "English", "zh": "Chinese", "ko": "Korean",
    "zh-CN": "Simplified Chinese", "zh-TW": "Traditional Chinese",
}


class TranslationError(ValueError):
    """A fixed, user-facing validation message, safe to return from the API."""


def _translate_with(translator_cls, texts, source, target):
    tr = translator_cls(source=source, target=target)
    out = []
    for t in texts:
        t = t.strip()
        if not t:
            out.append("")
            continue
        for attempt in range(3):
            try:
                out.append(tr.translate(t) or "")
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(0.6 * (attempt + 1))
    return out


# MyMemory needs region-qualified codes, unlike Google's bare ones.
MYMEMORY_CODES = {
    "ja": "ja-JP", "en": "en-US", "ko": "ko-KR",
    "zh": "zh-CN", "zh-CN": "zh-CN", "zh-TW": "zh-TW",
}


def translate_free(texts, source, target):
    """Google first; MyMemory as backup when Google rate-limits."""
    from deep_translator import GoogleTranslator, MyMemoryTranslator

    try:
        return _translate_with(GoogleTranslator, texts, source, target)
    except Exception:
        print("google failed; falling back to mymemory", flush=True)
        return _translate_with(
            MyMemoryTranslator, texts,
            MYMEMORY_CODES.get(source, source), MYMEMORY_CODES.get(target, target),
        )


@lru_cache(maxsize=1)
def _anthropic_client():
    import anthropic

    return anthropic.Anthropic(timeout=35, max_retries=0)


@lru_cache(maxsize=1)
def _deepseek_client():
    from openai import OpenAI
    return OpenAI(api_key=os.environ["DEEPSEEK_API_KEY"],
                  base_url="https://api.deepseek.com", timeout=30, max_retries=0)


def translate_deepseek(texts, source, target):
    """DeepSeek is text-only (no vision), so it translates the OCR'd strings
    directly, same shape as translate_free but with LLM-quality phrasing."""
    return list(_deepseek_stream(texts, source, target))


class ArrayStream:
    """Decode complete JSON array items; escaped text may span chunks."""
    def __init__(self, item_type=str):
        self.buffer = ""
        self.items = []
        self.pos = None
        self.decoder = json.JSONDecoder()
        self.item_type = item_type

    def feed(self, chunk):
        self.buffer += chunk
        if self.pos is None:
            start = self.buffer.find("[")
            if start < 0:
                return []
            self.pos = start + 1
        out = []
        while self.pos < len(self.buffer):
            while self.pos < len(self.buffer) and self.buffer[self.pos] in " \r\n\t,":
                self.pos += 1
            if self.pos >= len(self.buffer) or self.buffer[self.pos] == "]":
                break
            try:
                value, end = self.decoder.raw_decode(self.buffer, self.pos)
            except json.JSONDecodeError:
                break
            if not isinstance(value, self.item_type) or (isinstance(value, str) and not value.strip()):
                raise TranslationError("翻译返回空内容或格式错误，请重试")
            self.pos = end
            item = value.strip() if isinstance(value, str) else value
            self.items.append(item)
            out.append(item)
        return out

    def finish(self, count):
        try:
            parsed, _ = self.decoder.raw_decode(self.buffer, self.buffer.index("["))
        except (ValueError, json.JSONDecodeError):
            raise TranslationError("翻译响应不完整，请重试") from None
        normalized = ([(x.strip() if isinstance(x, str) else x) for x in parsed]
                      if isinstance(parsed, list) and self.item_type is str else parsed)
        if (not isinstance(parsed, list) or any(not isinstance(x, self.item_type) for x in parsed)
                or len(self.items) != count or normalized != self.items):
            raise TranslationError("翻译条数与原文不一致，请重试")


def _deepseek_stream(texts, source, target):
    client = _deepseek_client()

    numbered = json.dumps([{"index": i, "source": text} for i, text in enumerate(texts)], ensure_ascii=False)
    prompt = (
        f"Translate each manga speech bubble from {LANG_NAMES.get(source, source)} "
        f"to {LANG_NAMES.get(target, target)}, in natural, colloquial manga style. "
        "For each input, copy its index and source exactly, then translate ONLY that source. "
        "Reply with ONLY a JSON array in the same order and count, with objects shaped "
        '{"index":0,"source":"exact input source","translation":"translated text"}:\n\n'
        f"{numbered}"
    )
    resp = client.chat.completions.create(
        model=os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"),
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        stream=True,
    )
    parser = ArrayStream(dict)
    emitted = 0
    try:
        for chunk in resp:
            if chunk.choices:
                for item in parser.feed(chunk.choices[0].delta.content or ""):
                    if emitted >= len(texts):
                        raise TranslationError("翻译返回多余条目，请重试")
                    if item.get("index") != emitted or item.get("source") != texts[emitted]:
                        raise TranslationError("翻译结果与原文对应错误，请重试")
                    value = item.get("translation")
                    if not isinstance(value, str) or not value.strip():
                        raise TranslationError("翻译返回空内容或格式错误，请重试")
                    emitted += 1
                    yield value.strip()
        parser.finish(len(texts))
    finally:
        resp.close()


def _png_b64(pil_img):
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _claude_response(content):
    client = _anthropic_client()
    kwargs = dict(
        model=os.environ.get("CLAUDE_MODEL", "claude-opus-5"),
        max_tokens=4096,
        output_config={"effort": "low"},
        messages=[{"role": "user", "content": content}],
    )
    try:
        resp = client.beta.messages.create(
            betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs
        )
    except TypeError:
        resp = client.messages.create(**kwargs)
    if resp.stop_reason == "refusal":
        raise TranslationError("翻译服务拒绝了这段内容，请修改原文或更换引擎")
    return "".join(b.text for b in resp.content if b.type == "text")


def translate_text(text, source, target, provider):
    """Translate edited source text; even Claude must not reread an image."""
    if provider == "claude":
        raw = _claude_response([{"type": "text", "text": (
            f"Translate this manga speech bubble from {LANG_NAMES[source]} to {LANG_NAMES[target]}. "
            "Use the supplied corrected text exactly as your source, in natural, colloquial manga style. "
            "Reply with ONLY a JSON array containing exactly one nonempty translation string.\n\n"
            f"Source text:\n{text}"
        )}])
        parser = ArrayStream()
        values = parser.feed(raw)
        parser.finish(1)
    elif provider == "deepseek":
        values = translate_deepseek([text], source, target)
    else:
        values = translate_free([text], source, target)
    if not isinstance(values, list) or len(values) != 1 or not isinstance(values[0], str) or not values[0].strip():
        raise TranslationError("翻译必须返回一条非空结果，请重试")
    return values[0].strip()


def translate_claude_vision(crops, source, target):
    """crops: list of PIL images, one per bubble. Claude reads and translates each.
    Returns list of {"text": original, "translated": translation}."""
    content = []
    for i, im in enumerate(crops):
        content.append({"type": "text", "text": f"Bubble {i}:"})
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": _png_b64(im)}})
    content.append({
        "type": "text",
        "text": (
            f"Each image above is one manga speech bubble in {LANG_NAMES.get(source, source)}. "
            f"For every bubble, transcribe the text exactly, then translate it into {LANG_NAMES.get(target, target)} "
            "in natural, colloquial manga style, matching tone and speaker voice. "
            "Reply with ONLY a JSON array, one object per bubble in order: "
            '[{"index": 0, "text": "...", "translated": "..."}, ...]'
        ),
    })
    raw = _claude_response(content)
    m = re.search(r"\[.*\]", raw, re.S)
    items = json.loads(m.group(0) if m else raw)
    out = [{"text": "", "translated": ""} for _ in crops]
    for it in items:
        i = int(it.get("index", -1))
        if 0 <= i < len(out):
            out[i] = {"text": it.get("text", ""), "translated": it.get("translated", "")}
    if any(not isinstance(r["translated"], str) or not r["translated"].strip() for r in out):
        raise TranslationError("翻译响应缺少气泡，请重试")
    return out


_cache = OrderedDict()
_cache_lock = threading.Lock()


def translated_bubbles(bubbles, pil, source, target, provider, cancelled):
    """Yield completed bubbles immediately. Cache text, never screenshots."""
    if provider == "claude":
        crops = [pil.crop((max(0,int(b["x"])-4), max(0,int(b["y"])-4),
                           min(pil.width,int(b["x"]+b["w"])+4), min(pil.height,int(b["y"]+b["h"])+4))) for b in bubbles]
        for b, result in zip(bubbles, translate_claude_vision(crops, source, target)):
            if cancelled.is_set():
                return
            yield {**b, **result, "cached": False}
        return
    model = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat") if provider == "deepseek" else "google"
    # Keep adjacent dialogue as context for the model and for the cache key.
    context = tuple(b["text"] for b in bubbles)
    missing = []
    for i, b in enumerate(bubbles):
        key = (provider, model, source, target, context, i)
        with _cache_lock:
            value = _cache.get(key)
            if value is not None:
                _cache.move_to_end(key)
        if value is not None:
            yield {**b, "translated": value, "cached": True}
        else:
            missing.append((b, key))
    if not missing or cancelled.is_set():
        return
    # A retry must never send already completed bubbles back to the provider.
    texts = [b["text"] for b, _ in missing]
    stream = _deepseek_stream(texts, source, target) if provider == "deepseek" else iter(translate_free(texts, source, target))
    pending_cache = {}
    completed = 0
    try:
        for (b, key), value in zip(missing, stream):
            if cancelled.is_set():
                return
            if not isinstance(value, str) or not value.strip():
                raise TranslationError("翻译返回空内容，请重试")
            completed += 1
            pending_cache[key] = value
            yield {**b, "translated": value, "cached": False}
        # Exhaust once more so the streaming parser validates the final bracket/count.
        if next(stream, None) is not None or completed != len(missing):
            raise TranslationError("翻译条数与原文不一致，请重试")
        with _cache_lock:
            _cache.update(pending_cache)
            while len(_cache) > 256:
                _cache.popitem(last=False)
    finally:
        if hasattr(stream, "close"):
            stream.close()
