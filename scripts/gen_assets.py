#!/usr/bin/env python3
"""Generate font atlas (Latin + CJK) and a sample line-art PNG."""
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

LATIN = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
CJK = Path("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf")
if not CJK.exists():
    CJK = Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc")


def collect_chars():
    chars = set(chr(c) for c in range(32, 127))
    chars.update("・。、（）「」【】％°±×÷—–−")
    src = ROOT / "source"
    for p in src.rglob("*.d"):
        text = p.read_text(encoding="utf-8")
        for ch in text:
            o = ord(ch)
            if ch == "\n" or ch == "\r" or ch == "\t":
                continue
            if o >= 0x80:
                chars.add(ch)
    chars.discard("\n")
    return sorted(chars)


def pick_font(ch, latin, cjk):
    if ord(ch) < 128 or ("\u00A0" <= ch <= "\u024F"):
        return latin
    return cjk


def main():
    latin = ImageFont.truetype(str(LATIN), 20)
    cjk = ImageFont.truetype(str(CJK), 20)
    chars = collect_chars()
    gw, gh = 28, 32
    cols = 32
    rows = (len(chars) + cols - 1) // cols
    img = Image.new("RGBA", (cols * gw, rows * gh), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    mapping = []
    for i, ch in enumerate(chars):
        x = (i % cols) * gw
        y = (i // cols) * gh
        font = pick_font(ch, latin, cjk)
        # White RGB, alpha from coverage — ColorMod tints at runtime.
        # Anchor baseline so Latin and CJK sit in the same cell.
        draw.text((x + 2, y + 26), ch, font=font, fill=(255, 255, 255, 255), anchor="ls")
        # measure advance
        bbox = draw.textbbox((0, 0), ch, font=font)
        adv = max(8, bbox[2] - bbox[0] + 2)
        mapping.append(f"{ord(ch)} {x} {y} {gw} {gh} {adv}")
    img.save(ASSETS / "font_atlas.png")
    (ASSETS / "font_atlas.txt").write_text("\n".join(mapping) + "\n", encoding="utf-8")

    w, h = 768, 768
    samp = Image.new("RGB", (w, h), (255, 255, 255))
    d = ImageDraw.Draw(samp)
    m = 180
    d.line([(m, 480), (384, 220), (768 - m, 480)], fill=(20, 20, 20), width=8)
    d.rectangle([m + 40, 480, 768 - m - 40, 620], outline=(20, 20, 20), width=8)
    d.rectangle([350, 520, 430, 620], outline=(20, 20, 20), width=8)
    samp.save(ASSETS / "sample_house.png")
    print("wrote", ASSETS, "glyphs", len(chars), "size", img.size)


if __name__ == "__main__":
    main()
