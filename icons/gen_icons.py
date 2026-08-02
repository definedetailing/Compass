#!/usr/bin/env python3
"""Generate Compass PWA icons — "Neon rose (dark)" design, full-bleed.
Full-bleed squares so iOS/Android apply their own rounded/mask corners
(and iOS reliably uses the icon instead of a letter fallback)."""
from PIL import Image, ImageDraw, ImageFilter
import math, os

HERE = os.path.dirname(os.path.abspath(__file__))
S = 1024


def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def radial_bg(inner, outer, cx=0.5, cy=0.5):
    img = Image.new("RGB", (S, S), outer)
    px = img.load()
    maxd = math.hypot(S, S) * 0.62
    for y in range(S):
        for x in range(0, S, 2):
            d = math.hypot(x - S * cx, y - S * cy) / maxd
            c = lerp(inner, outer, min(d, 1))
            px[x, y] = c
            if x + 1 < S: px[x + 1, y] = c
    return img


def rose(d, cx, cy, R, r, col_main, col_alt):
    for k in range(4):                       # long cardinal points
        ang = math.radians(k * 90 - 90)
        tip = (cx + math.cos(ang) * R, cy + math.sin(ang) * R)
        w = R * 0.11
        pxx, pyy = -math.sin(ang), math.cos(ang)
        d.polygon([tip, (cx + pxx * w, cy + pyy * w), (cx, cy),
                   (cx - pxx * w, cy - pyy * w)], fill=col_main)
    for k in range(4):                       # short diagonal points
        ang = math.radians(k * 90 - 45)
        tip = (cx + math.cos(ang) * r, cy + math.sin(ang) * r)
        w = r * 0.12
        pxx, pyy = -math.sin(ang), math.cos(ang)
        d.polygon([tip, (cx + pxx * w, cy + pyy * w), (cx, cy),
                   (cx - pxx * w, cy - pyy * w)], fill=col_alt)


def build():
    img = radial_bg((22, 40, 90), (6, 12, 26)).convert("RGBA")
    # cyan glow behind the rose
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([S*0.5-300, S*0.5-300, S*0.5+300, S*0.5+300], fill=(56, 189, 248, 130))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(80)))
    d = ImageDraw.Draw(img)
    cx = cy = S / 2
    rose(d, cx, cy, R=300, r=150, col_main=(224, 242, 254, 255), col_alt=(56, 189, 248, 255))
    d.ellipse([cx-24, cy-24, cx+24, cy+24], fill=(14, 165, 233, 255))
    d.ellipse([cx-10, cy-10, cx+10, cy+10], fill=(255, 255, 255, 255))
    return img.convert("RGB")


BASE = build()

def save(size, name): BASE.resize((size, size), Image.LANCZOS).save(os.path.join(HERE, name))

save(192, "icon-192.png")
save(512, "icon-512.png")
save(180, "apple-touch-icon.png")
save(512, "maskable-512.png")   # full-bleed; rose sits well inside the safe zone
save(32,  "favicon-32.png")
print("neon-rose icons written")
