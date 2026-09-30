# -*- coding: utf-8 -*-
"""托盘图标专用候选：必须能在 16px 下看清（笔画少的方案）"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'tray_candidates')
os.makedirs(OUT, exist_ok=True)

NAVY = (18, 28, 56)
BLUE = (16, 104, 232)
WHITE = (255, 255, 255, 255)
CJK = r'C:\Windows\Fonts\msyhbd.ttc'
LAT = r'C:\Windows\Fonts\segoeuib.ttf'

SS = 8  # 先在 8 倍下画再缩到 16，保证边缘干净


def f(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.truetype(CJK, size)


def base_tile(size, bg):
    n = size * SS
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.28), fill=bg)
    return img, ImageDraw.Draw(img)


def center(d, cx, cy, txt, font, fill, n):
    b = d.textbbox((0, 0), txt, font=font)
    d.text((cx - (b[0] + b[2]) / 2, cy - (b[1] + b[3]) / 2), txt, font=font, fill=fill)


def make(kind, size):
    n = size * SS
    if kind == 'A':
        img, d = base_tile(size, NAVY)
        center(d, n / 2, n / 2 * 1.02, 'A', f(LAT, int(n * 0.78)), WHITE, n)
    elif kind == 'A-blue':
        img, d = base_tile(size, WHITE)
        center(d, n / 2, n / 2 * 1.02, 'A', f(LAT, int(n * 0.78)), BLUE + (255,), n)
    elif kind == 'swap':
        img, d = base_tile(size, NAVY)
        w = max(1, int(n * 0.10))
        d.line([(n * 0.28, n * 0.38), (n * 0.72, n * 0.38)], fill=WHITE, width=w)
        d.line([(n * 0.28, n * 0.62), (n * 0.72, n * 0.62)], fill=WHITE, width=w)
        a = n * 0.16
        d.polygon([(n * 0.72, n * 0.38), (n * 0.72 - a, n * 0.38 - a * 0.62), (n * 0.72 - a, n * 0.38 + a * 0.62)], fill=WHITE)
        d.polygon([(n * 0.28, n * 0.62), (n * 0.28 + a, n * 0.62 - a * 0.62), (n * 0.28 + a, n * 0.62 + a * 0.62)], fill=WHITE)
    elif kind == 'wen':
        img, d = base_tile(size, NAVY)
        center(d, n / 2, n / 2 * 1.03, '文', f(CJK, int(n * 0.72)), WHITE, n)
    elif kind == 'AB':
        img, d = base_tile(size, NAVY)
        center(d, n * 0.36, n / 2 * 1.03, 'A', f(LAT, int(n * 0.50)), WHITE, n)
        center(d, n * 0.68, n / 2 * 1.03, '文', f(CJK, int(n * 0.46)), WHITE, n)
    elif kind == 'yi':
        img, d = base_tile(size, NAVY)
        center(d, n / 2, n / 2 * 1.03, '译', f(CJK, int(n * 0.70)), WHITE, n)
    else:
        raise ValueError(kind)
    return img.resize((size, size), Image.LANCZOS)


KINDS = [
    ('yi', '译（当前）'),
    ('A', 'A 深底'),
    ('A-blue', 'A 浅底'),
    ('wen', '文'),
    ('AB', 'A 文'),
    ('swap', '双向箭头'),
]

made = []
for k, title in KINDS:
    for sz in (16, 32):
        make(k, sz).save(os.path.join(OUT, f'{k}-{sz}.png'))
    made.append((k, title))
    print('生成', k, title)

# ---- 对比图：16px 真实 + 8 倍像素放大 ----
COLS = len(made)
CELL = 200
PAD = 40
sheet = Image.new('RGB', (COLS * CELL + PAD * 2, 430), (243, 246, 251))
d = ImageDraw.Draw(sheet)
f_h = f(CJK, 22)
f_s = f(CJK, 16)

for i, (k, title) in enumerate(made):
    cx = PAD + i * CELL + CELL // 2
    img16 = Image.open(os.path.join(OUT, f'{k}-16.png'))
    img32 = Image.open(os.path.join(OUT, f'{k}-32.png'))

    # 32px 大图作参考
    d.rounded_rectangle([cx - 34, 60, cx + 34, 128], radius=16, fill=(212, 222, 240))
    sheet.paste(img32.resize((64, 64), Image.LANCZOS), (cx - 32, 62), img32.resize((64, 64), Image.LANCZOS))

    # 16px 真实大小（浅底）
    d.rounded_rectangle([cx - 30, 150, cx + 30, 186], radius=8, fill=(244, 244, 244))
    sheet.paste(img16, (cx - 8, 160), img16)
    # 16px 真实大小（深底）
    d.rounded_rectangle([cx - 30, 196, cx + 30, 232], radius=8, fill=(32, 32, 32))
    sheet.paste(img16, (cx - 8, 206), img16)

    # 像素级放大
    px = img16.resize((16 * 7, 16 * 7), Image.NEAREST)
    sheet.paste(px, (cx - 56, 250), px)

    d.text((cx, 34), title, font=f_h, fill=(28, 40, 66), anchor='ma')
    d.text((cx, 168), '浅', font=f_s, fill=(120, 132, 156), anchor='ra')
    d.text((cx, 214), '深', font=f_s, fill=(150, 160, 178), anchor='ra')

sheet.save(os.path.join(HERE, '_托盘候选.png'))
print('对比图已生成', sheet.size)
