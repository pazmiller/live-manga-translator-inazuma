import json
import os
import threading
import hashlib
from collections import OrderedDict
from functools import lru_cache
from pathlib import Path

PROVIDERS = json.loads(Path(__file__).with_name('provider-catalog.json').read_text(encoding='utf-8'))['providers']


def provider_config(provider, config=None):
    definition = PROVIDERS[provider]
    config = config or {}
    return {"api_key": config.get("api_key") or os.getenv(definition['keyEnv'], ''),
            "model": config.get("model") or os.getenv(definition['modelEnv']) or definition['defaultModel']}


@lru_cache(maxsize=6)
def _llm_client(provider, api_key):
    from openai import OpenAI
    return OpenAI(api_key=api_key, base_url=PROVIDERS[provider]['baseUrl'], timeout=45, max_retries=0)

LANG_NAMES = {
    "ja": "Japanese", "en": "English", "zh": "Chinese", "ko": "Korean",
    "zh-CN": "Simplified Chinese", "zh-TW": "Traditional Chinese",
}


class TranslationError(ValueError):
    """A fixed, user-facing validation message, safe to return from the API."""


@lru_cache(maxsize=1)
def _deepseek_client():
    from openai import OpenAI
    return OpenAI(api_key=os.environ["DEEPSEEK_API_KEY"],
                  base_url="https://api.deepseek.com", timeout=30, max_retries=0)


def translate_deepseek(texts, source, target):
    """DeepSeek is text-only (no vision), so it translates the OCR'd strings
    directly, using the shared structured LLM response validation."""
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
    yield from _llm_stream(texts, source, target, "deepseek")


def _llm_stream(texts, source, target, provider, config=None):
    options = provider_config(provider, config)
    client = _deepseek_client() if provider == "deepseek" and config is None else _llm_client(provider, options['api_key'])

    numbered = json.dumps([{"index": i, "source": text} for i, text in enumerate(texts)], ensure_ascii=False)
    prompt = (
        f"Translate each manga speech bubble from {LANG_NAMES.get(source, source)} "
        f"to {LANG_NAMES.get(target, target)}, in natural, colloquial manga style. "
        "For each input, copy its index and source exactly, then translate ONLY that source. "
        "Reply with ONLY a JSON array in the same order and count, with objects shaped "
        '{"index":0,"source":"exact input source","translation":"translated text"}:\n\n'
        f"{numbered}"
    )
    parameters = {}
    if provider == 'openai' and options['model'].startswith(('gpt-6-', 'gpt-5.6-')):
        parameters['reasoning_effort'] = 'low'
    elif provider == 'gemini' and options['model'].startswith('gemini-3.'):
        parameters['reasoning_effort'] = 'low'
    elif provider == 'deepseek' and options['model'] in ('deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash'):
        parameters['extra_body'] = {'thinking': {'type': 'disabled'}}
    resp = client.chat.completions.create(
        model=options['model'],
        messages=[{"role": "user", "content": prompt}],
        stream=True,
        **parameters,
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


def translate_text(text, source, target, provider, config=None):
    """Translate edited source text without rereading an image."""
    if provider not in PROVIDERS:
        raise TranslationError("不支持的翻译服务，请在翻译AI配置中重新选择")
    if provider == "deepseek" and config is None:
        values = translate_deepseek([text], source, target)
    else:
        values = list(_llm_stream([text], source, target, provider, config))
    if not isinstance(values, list) or len(values) != 1 or not isinstance(values[0], str) or not values[0].strip():
        raise TranslationError("翻译必须返回一条非空结果，请重试")
    return values[0].strip()


_cache = OrderedDict()
_cache_lock = threading.Lock()


def translated_bubbles(bubbles, pil, source, target, provider, cancelled, config=None):
    """Yield completed bubbles immediately. Cache text, never screenshots."""
    if provider not in PROVIDERS:
        raise TranslationError("不支持的翻译服务，请在翻译AI配置中重新选择")
    options = provider_config(provider, config)
    model = options.get('model', provider)
    credential_id = hashlib.sha256(options.get('api_key', '').encode()).hexdigest()
    # Keep adjacent dialogue as context for the model and for the cache key.
    context = tuple(b["text"] for b in bubbles)
    missing = []
    for i, b in enumerate(bubbles):
        key = (provider, model, credential_id, source, target, context, i)
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
    if provider == 'deepseek' and config is None:
        stream = _deepseek_stream(texts, source, target)
    else:
        stream = _llm_stream(texts, source, target, provider, config)
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
