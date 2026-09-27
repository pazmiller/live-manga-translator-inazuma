"""Deterministic manga-like layout; no downloaded artwork or provider required."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / ".qa"
OUT.mkdir(exist_ok=True)
im = Image.new("RGB", (1000, 740), "#ddd9d2")
d = ImageDraw.Draw(im)
font = ImageFont.truetype("C:/Windows/Fonts/meiryo.ttc", 22)
d.rectangle((12, 45, 988, 728), fill="#f4f1e9", outline="#25262a", width=3)
d.line((500, 45, 500, 728), fill="#25262a", width=3)
d.line((12, 400, 988, 400), fill="#25262a", width=3)
bubbles = []

def add(x, y, lines, translated, bg="#fff", vertical=False, textured=False):
    boxes = []
    for i, text in enumerate(lines):
        if vertical:
            px, py = x - i * 34, y
            boxes.append([px, py, px + 24, py + 27 * len(text)])
        else:
            px, py = x, y + i * 32
            bounds = d.textbbox((px, py), text, font=font)
            boxes.append(list(bounds))
    x1, y1 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x2, y2 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    d.rounded_rectangle((x1-22, y1-25, x2+22, y2+25), radius=38, fill=bg, outline="#24242a", width=3)
    if textured:
        for k in range(y1-15, y2+16, 5):
            d.line((x1-12, k, x2+12, k), fill="#b2aaca")
    for i, text in enumerate(lines):
        fg = "white" if bg == "#25242b" else "#16171a"
        if vertical:
            for j, char in enumerate(text):
                d.text((x-i*34, y+j*27-4), char, font=font, fill=fg)
        else:
            d.text((x, y+i*32), text, font=font, fill=fg)
    bubbles.append(dict(x=x1, y=y1, w=x2-x1, h=y2-y1, vertical=vertical,
                        text="".join(lines), translated=translated,
                        lines=[dict(box=b, text=t, score=0.99) for b,t in zip(boxes,lines)]))

add(80, 135, ["待って！", "一緒に行こう。"], "等一下！我们一起走吧。")
add(760, 110, ["明日はきっと", "いい日になる"], "明天一定会是美好的一天。", bg="#fff1cf", vertical=True)
add(365, 235, ["え？"], "什么？你是说我们必须在日落之前穿过这片森林，才能赶上最后一班回家的列车吗？")
add(70, 505, ["誰かいる？", "返事をして。"], "有人在吗？回答我。", bg="#25242b")
add(560, 490, ["大丈夫だよ。", "心配しないで。"], "没事的，不用担心。", bg="#ddd2eb", textured=True)
add(824, 643, ["ありがとう"], "Thank you for everything you have done for us.")
im.save(OUT / "fixture.png")
(OUT / "fixture.json").write_text(json.dumps(bubbles, ensure_ascii=False), encoding="utf-8")
sys.path.insert(0, str(OUT.parent / "backend"))
import numpy as np
import ocr
for i, b in enumerate(bubbles):
    b.update(id=i, boxes=[line["box"] for line in b.pop("lines")])
ocr.prepare_layout(np.asarray(im)[:, :, ::-1].copy(), bubbles)
(OUT / "layout.json").write_text(json.dumps(bubbles, ensure_ascii=False), encoding="utf-8")
print(OUT / "fixture.png")
