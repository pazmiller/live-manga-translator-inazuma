import threading

import numpy as np

_engines = {}
_engine_lock = threading.RLock()


def _make_engine(lang: str):
    from rapidocr import RapidOCR, LangRec

    lang_map = {
        "ja": LangRec.JAPAN,
        "en": LangRec.EN,
        "zh": LangRec.CH,
        "ko": LangRec.KOREAN,
    }
    return RapidOCR(params={"Rec.lang_type": lang_map.get(lang, LangRec.CH),
                            "Global.log_level": "warning"})


def get_engine(lang: str):
    with _engine_lock:
        if lang not in _engines:
            # A user switching languages should not retain four model sets.
            if len(_engines) >= 2:
                _engines.pop(next(iter(_engines)))
            _engines[lang] = _make_engine(lang)
        return _engines[lang]


def warmup(lang="ja"):
    with _engine_lock:
        get_engine(lang)(np.full((64, 160, 3), 255, np.uint8))


def ocr_lines(img: np.ndarray, lang: str):
    """Returns list of {box: [x1,y1,x2,y2], text, score}."""
    # RapidOCR mutates its preprocessing state during inference.
    with _engine_lock:
        result = get_engine(lang)(img)
    if result is None or result.boxes is None:
        return []
    lines = []
    for box, txt, score in zip(result.boxes, result.txts, result.scores):
        pts = np.asarray(box)
        x1, y1 = pts[:, 0].min(), pts[:, 1].min()
        x2, y2 = pts[:, 0].max(), pts[:, 1].max()
        lines.append({"box": [float(x1), float(y1), float(x2), float(y2)], "text": txt, "score": float(score)})
    return lines


def _expand(box, m):
    return [box[0] - m, box[1] - m, box[2] + m, box[3] + m]


def grow_to_background(img, bubbles, max_grow=0.6, tol=38):
    """Widen each bubble into the surrounding balloon fill.

    OCR boxes hug the glyphs, so an overlay sized to them leaves the original
    text peeking out at the edges. The balloon interior is a flat light region,
    so we push each edge outward while the newly covered strip stays close to
    the balloon's background colour.
    """
    h, w = img.shape[:2]
    gray = img.mean(axis=2)

    for b in bubbles:
        x1, y1 = int(b["x"]), int(b["y"])
        x2, y2 = int(b["x"] + b["w"]), int(b["y"] + b["h"])
        # Sample the balloon fill just outside the glyphs, where it is cleanest.
        margin = max(2, int(min(b["w"], b["h"]) * 0.1))
        ring = gray[max(0, y1 - margin):min(h, y2 + margin),
                    max(0, x1 - margin):min(w, x2 + margin)]
        if ring.size == 0:
            continue
        bg = float(np.percentile(ring, 90))

        limit_x = int(b["w"] * max_grow)
        limit_y = int(b["h"] * max_grow)

        def clear(strip):
            return strip.size > 0 and abs(float(strip.mean()) - bg) < tol

        for _ in range(limit_x):
            if x1 - 1 < 0 or not clear(gray[y1:y2, x1 - 1:x1]):
                break
            x1 -= 1
        for _ in range(limit_x):
            if x2 + 1 > w or not clear(gray[y1:y2, x2:x2 + 1]):
                break
            x2 += 1
        for _ in range(limit_y):
            if y1 - 1 < 0 or not clear(gray[y1 - 1:y1, x1:x2]):
                break
            y1 -= 1
        for _ in range(limit_y):
            if y2 + 1 > h or not clear(gray[y2:y2 + 1, x1:x2]):
                break
            y2 += 1

        b["x"], b["y"], b["w"], b["h"] = float(x1), float(y1), float(x2 - x1), float(y2 - y1)
    return bubbles


def _overlap(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def group_bubbles(lines, margin_ratio=0.65, img=None, source="ja"):
    """Union-find merge of nearby text lines into bubbles."""
    if source == "ja":
        lines = _attach_ruby(lines)
    n = len(lines)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    expanded = []
    for l in lines:
        b = l["box"]
        thin = min(b[2] - b[0], b[3] - b[1])
        expanded.append(_expand(b, thin * margin_ratio))
    for i in range(n):
        for j in range(i + 1, n):
            if _overlap(expanded[i], expanded[j]) and not _has_separator(lines[i]["box"], lines[j]["box"], img):
                parent[find(i)] = find(j)

    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(lines[i])

    bubbles = []
    for members in groups.values():
        all_boxes = [box for m in members for box in [m["box"], *m.get("ruby_boxes", [])]]
        xs1 = min(box[0] for box in all_boxes)
        ys1 = min(box[1] for box in all_boxes)
        xs2 = max(box[2] for box in all_boxes)
        ys2 = max(box[3] for box in all_boxes)
        vertical = sum(1 for m in members if (m["box"][3] - m["box"][1]) > (m["box"][2] - m["box"][0])) > len(members) / 2
        if vertical:
            # OCR may split a vertical column into several fragments.
            column_width = max(8, float(np.median([m["box"][2] - m["box"][0] for m in members])))
            members.sort(key=lambda m: (-round((m["box"][0] - xs1) / column_width), m["box"][1]))
        else:
            members.sort(key=lambda m: m["box"][1])
        bubbles.append({
            "x": xs1, "y": ys1, "w": xs2 - xs1, "h": ys2 - ys1,
            "vertical": vertical,
            "boxes": all_boxes,
            "text": "".join(m["text"] for m in members) if vertical else " ".join(m["text"] for m in members),
        })
    return bubbles


def _attach_ruby(lines):
    """Associate small right-side furigana with a larger vertical text column.

    Keep their boxes for erasure, but don't repeat their OCR as dialogue.
    Require a strong size difference so full-size split characters survive.
    """
    result = [{**line, "ruby_boxes": []} for line in lines]
    attached = set()
    for i, small in enumerate(result):
        a = small["box"]
        aw, ah = a[2]-a[0], a[3]-a[1]
        candidates = []
        for j, large in enumerate(result):
            if i == j:
                continue
            b = large["box"]
            bw, bh = b[2]-b[0], b[3]-b[1]
            if bh < bw*2 or aw > bw*.58 or ah > bh*.65:
                continue
            if a[1] >= b[1]-bw*.25 and a[3] <= b[3]+bw*.25 and b[2]-bw*.35 <= a[0] <= b[2]+bw*.35:
                candidates.append((abs(a[0]-b[2]), j))
        if candidates:
            _, parent = min(candidates)
            result[parent]["ruby_boxes"].append(a)
            attached.add(i)
    return [line for i, line in enumerate(result) if i not in attached]


def _has_separator(a, b, img):
    """Avoid merging across a solid balloon/panel boundary in the line gap."""
    if img is None:
        return False
    height, width = img.shape[:2]
    if a[2] <= b[0] or b[2] <= a[0]:
        left, right = sorted((a, b), key=lambda r: r[0])
        x1, x2 = int(left[2]), int(right[0])
        y1, y2 = int(max(a[1], b[1])), int(min(a[3], b[3]))
        axis = 0
    else:
        top, bottom = sorted((a, b), key=lambda r: r[1])
        x1, x2 = int(max(a[0], b[0])), int(min(a[2], b[2]))
        y1, y2 = int(top[3]), int(bottom[1])
        axis = 1
    gap = img[max(0,y1):min(height,y2), max(0,x1):min(width,x2)]
    if not gap.size:
        return False
    dark = gap.mean(axis=2) < 70
    return bool((dark.mean(axis=axis) > 0.85).any() and dark.mean() < 0.65)


def prepare_layout(img, bubbles):
    """Check the text-line and group perimeters, without growing into the balloon.

    Flat fills get small colour-matched masks. Artwork, gradients, outlines or
    disagreeing fills fall back to a card without painting over the source.
    Coordinates remain the OCR bounds; the renderer measures actual text fit.
    """
    height, width = img.shape[:2]
    for b in bubbles:
        samples, masks = [], []
        group_box = [b["x"], b["y"], b["x"]+b["w"], b["y"]+b["h"]]
        boxes = [*b.get("boxes", []), group_box]
        for box in boxes:
            x1, y1, x2, y2 = map(lambda n: int(round(n)), box)
            x1, y1, x2, y2 = max(0,x1-2), max(0,y1-2), min(width,x2+2), min(height,y2+2)
            if x2 <= x1 or y2 <= y1:
                continue
            # A 2-pixel ring can accidentally land entirely between screentone
            # stripes. Sample a wider annulus, while keeping the painted mask small.
            ax1, ay1, ax2, ay2 = max(0,x1-6), max(0,y1-6), min(width,x2+6), min(height,y2+6)
            samples.extend([img[ay1:y1, ax1:ax2].reshape(-1,3), img[y2:ay2, ax1:ax2].reshape(-1,3),
                            img[y1:y2, ax1:x1].reshape(-1,3), img[y1:y2, x2:ax2].reshape(-1,3)])
            masks.append(dict(x=x1, y=y1, w=x2-x1, h=y2-y1))
        if not samples or not any(s.size for s in samples):
            b.update(can_replace=False, masks=[])
            continue
        pixels = np.concatenate(samples).astype(np.int16)
        # A median handles sparse antialiased glyphs at the perimeter.
        color = np.median(pixels, axis=0)
        uniform = float((np.max(np.abs(pixels-color), axis=1) < 20).mean())
        rgb = [int(c) for c in color[::-1]]
        # The verified group rectangle also covers inter-line gaps and a glyph
        # occasionally omitted from one line but still inside the group bounds.
        group_pixels = np.concatenate(samples[-4:]).astype(np.int16)
        group_uniform = float((np.max(np.abs(group_pixels-color), axis=1) < 20).mean()) if group_pixels.size else 0
        b.update(can_replace=uniform >= 0.90 and group_uniform >= 0.95, masks=masks[-1:],
                 background="#" + "".join(f"{c:02x}" for c in rgb),
                 foreground="#f7f7f7" if np.mean(rgb) < 125 else "#19191c")
    return bubbles
