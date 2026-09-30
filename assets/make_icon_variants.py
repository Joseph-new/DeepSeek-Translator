# -*- coding: utf-8 -*-
"""多版候选图标 + 排版干净的对比图（修正 v4 坐标错误、文字换行）"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'variants')
os.makedirs(OUT, exist_ok=True)

S = 512
SS = 4
W = S * SS

FONT_CJK = r'C:\Windows\Fonts\msyhbd.ttc'
FONT_LAT = r'C:\Windows\Fonts\segoeuib.ttf'


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.truetype(FONT_CJK, size)


def squircle_mask(size, radius_ratio=0.225, ss=1):
    n = size * ss
    m = Image.new('L', (n, n), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * radius_ratio), fill=255)
    return m if ss == 1 else m.resize((size, size), Image.LANCZOS)


def vgrad(size, top, bottom):
    g = Image.new('RGB', (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return g.resize((size, size), Image.BILINEAR)


def diag_grad(size, c1, c2):
    g = Image.new('RGB', (size, size))
    px = g.load()
    for y in range(size):
        for x in range(0, size, 3):
            t = (x + y) / (2 * (size - 1))
            c = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
            for k in range(3):
                if x + k < size:
                    px[x + k, y] = c
    return g


def draw_center(draw, cx, cy, txt, f, fill):
    b = draw.textbbox((0, 0), txt, font=f)
    draw.text((cx - (b[0] + b[2]) / 2, cy - (b[1] + b[3]) / 2), txt, font=f, fill=fill)


def sheen(base, radius_ratio=0.225, strength=62, height_ratio=0.56):
    n = base.size[0]
    mask = squircle_mask(n, radius_ratio)
    top = int(n * height_ratio)
    g = Image.new('L', (n, n), 0)
    gd = ImageDraw.Draw(g)
    for y in range(top):
        t = y / max(1, top - 1)
        gd.line([(0, y), (n, y)], fill=int(strength * (1 - t) ** 1.8))
    g = g.filter(ImageFilter.GaussianBlur(n * 0.02))
    g = Image.composite(g, Image.new('L', (n, n), 0), mask)
    base.paste(Image.new('RGBA', (n, n), (255, 255, 255, 255)), (0, 0), g)

    edge = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle(
        [n // 256, n // 256, n - n // 256 - 1, n - n // 256 - 1],
        radius=int(n * radius_ratio), outline=(255, 255, 255, 92), width=max(1, n // 230))
    base.alpha_composite(edge)
    return base


def canvas():
    """返回 (W 尺寸画布, 圆角遮罩 W 尺寸)"""
    return Image.new('RGBA', (W, W), (0, 0, 0, 0)), squircle_mask(W, 0.225, SS)


def finish(layer):
    return layer.resize((S, S), Image.LANCZOS)


# ---------------------------------------------------------------- 1 经典蓝
def v1():
    base, mask = canvas()
    base.paste(vgrad(W, (74, 168, 255), (10, 84, 255)).convert('RGBA'), (0, 0), mask)
    base = finish(sheen(base))
    d = ImageDraw.Draw(base)
    f = font(FONT_CJK, int(S * 0.34))
    draw_center(d, S * 0.335, S * 0.515, '文', f, (255, 255, 255, 255))
    draw_center(d, S * 0.665, S * 0.515, 'A', font(FONT_LAT, int(S * 0.34)), (255, 255, 255, 240))
    return base


# ---------------------------------------------------------------- 2 浅玻璃
def v2():
    base, mask = canvas()
    base.paste(vgrad(W, (253, 254, 255), (222, 233, 252)).convert('RGBA'), (0, 0), mask)
    base = finish(sheen(base, strength=95))
    d = ImageDraw.Draw(base)
    draw_center(d, S * 0.335, S * 0.515, '文', font(FONT_CJK, int(S * 0.34)), (10, 88, 216, 255))
    draw_center(d, S * 0.665, S * 0.515, 'A', font(FONT_LAT, int(S * 0.34)), (10, 88, 216, 235))
    return base


# ---------------------------------------------------------------- 3 对话气泡
def v3():
    base, mask = canvas()
    base.paste(diag_grad(W, (88, 178, 255), (16, 88, 238)).convert('RGBA'), (0, 0), mask)
    base = finish(sheen(base))
    d = ImageDraw.Draw(base)
    x0, y0, x1, y1 = S * 0.155, S * 0.195, S * 0.845, S * 0.665
    d.rounded_rectangle([x0, y0, x1, y1], radius=int(S * 0.155), fill=(255, 255, 255, 255))
    d.polygon([(S * 0.315, y1 - S * 0.015), (S * 0.285, S * 0.845), (S * 0.465, y1 - S * 0.015)],
              fill=(255, 255, 255, 255))
    draw_center(d, S * 0.395, S * 0.425, '文', font(FONT_CJK, int(S * 0.215)), (14, 92, 226, 255))
    draw_center(d, S * 0.625, S * 0.425, 'A', font(FONT_LAT, int(S * 0.215)), (14, 92, 226, 235))
    return base


# ---------------------------------------------------------------- 4 双色对撞
def v4():
    base, mask = canvas()
    base.paste(vgrad(W, (78, 198, 255), (12, 118, 246)).convert('RGBA'), (0, 0), mask)

    # 右下暖色三角（注意：必须用 W 尺寸坐标，否则会跑到左上角）
    warm = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(warm).polygon(
        [(W, W * 0.26), (W, W), (W * 0.22, W)], fill=(255, 152, 74, 255))
    warm = warm.filter(ImageFilter.GaussianBlur(W * 0.035))
    base.alpha_composite(Image.composite(warm, Image.new('RGBA', (W, W), (0, 0, 0, 0)), mask))
    base = finish(sheen(base, strength=52))

    d = ImageDraw.Draw(base)
    draw_center(d, S * 0.335, S * 0.355, 'A', font(FONT_LAT, int(S * 0.275)), (255, 255, 255, 255))
    draw_center(d, S * 0.665, S * 0.665, '文', font(FONT_CJK, int(S * 0.275)), (255, 255, 255, 255))

    w = max(2, int(S * 0.024))
    d.line([(S * 0.325, S * 0.605), (S * 0.675, S * 0.415)], fill=(255, 255, 255, 240), width=w)
    a = S * 0.072
    d.polygon([(S * 0.325, S * 0.605), (S * 0.325 + a, S * 0.605 - a * 0.42), (S * 0.325 + a * 0.42, S * 0.605 - a)],
              fill=(255, 255, 255, 240))
    d.polygon([(S * 0.675, S * 0.415), (S * 0.675 - a, S * 0.415 + a * 0.42), (S * 0.675 - a * 0.42, S * 0.415 + a)],
              fill=(255, 255, 255, 240))
    return base


# ---------------------------------------------------------------- 5 单字「译」
def v5():
    base, mask = canvas()
    base.paste(diag_grad(W, (52, 72, 120), (12, 20, 44)).convert('RGBA'), (0, 0), mask)
    base = finish(sheen(base, strength=46))
    d = ImageDraw.Draw(base)
    draw_center(d, S * 0.5, S * 0.525, '译', font(FONT_CJK, int(S * 0.50)), (255, 255, 255, 255))
    return base


# ---------------------------------------------------------------- 6 叠层卡片
def v6():
    base, mask = canvas()
    base.paste(vgrad(W, (128, 138, 255), (56, 50, 218)).convert('RGBA'), (0, 0), mask)
    base = finish(sheen(base))

    d = ImageDraw.Draw(base)
    d.rounded_rectangle([S * 0.20, S * 0.19, S * 0.80, S * 0.55], radius=int(S * 0.105),
                        fill=(255, 255, 255, 100))
    d.rounded_rectangle([S * 0.24, S * 0.40, S * 0.82, S * 0.76], radius=int(S * 0.105),
                        fill=(255, 255, 255, 253))
    draw_center(d, S * 0.415, S * 0.578, '文', font(FONT_CJK, int(S * 0.195)), (66, 60, 228, 255))
    draw_center(d, S * 0.645, S * 0.578, 'A', font(FONT_LAT, int(S * 0.195)), (66, 60, 228, 235))
    return base


VARIANTS = [
    ('v1', '1. 经典蓝', '蓝渐变 + 文A，当前版本的微调', v1),
    ('v2', '2. 浅玻璃', '浅色玻璃质感，与软件界面一致', v2),
    ('v3', '3. 对话气泡', '气泡承载 文A，翻译工具通用语义', v3),
    ('v4', '4. 双色对撞', '冷蓝撞暖橙 + 双向箭头，表达转换', v4),
    ('v5', '5. 单字「译」', '深色底 + 大字，小尺寸最清晰', v5),
    ('v6', '6. 叠层卡片', '两张错位卡片，寓意原文与译文', v6),
]

made = []
for key, title, desc, fn in VARIANTS:
    img = fn()
    img.save(os.path.join(OUT, key + '.png'))
    made.append((img, title, desc))
    print('生成', key, title.replace('\n', ' '))

# ---------------------------------------------------------------- 对比图（文字换行、16px 独立展示）
COLS = 3
CELL_W, CELL_H = 380, 350
PAD = 48
ICON = 200
ROWS = (len(made) + COLS - 1) // COLS

sheet = Image.new('RGB', (COLS * CELL_W + PAD * 2, ROWS * CELL_H + PAD * 2), (243, 246, 251))
sd = ImageDraw.Draw(sheet)
f_title = font(FONT_CJK, 27)
f_desc = font(FONT_CJK, 17)
f_tag = font(FONT_CJK, 14)


def wrap(text, f, max_w, draw):
    lines, cur = [], ''
    for ch in text:
        if draw.textlength(cur + ch, font=f) > max_w:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


for i, (img, title, desc) in enumerate(made):
    r, c = divmod(i, COLS)
    cx = PAD + c * CELL_W + CELL_W // 2
    oy = PAD + r * CELL_H

    icon_x = cx - ICON // 2
    sd.rounded_rectangle([icon_x + 6, oy + 10, icon_x + ICON + 6, oy + ICON + 10],
                         radius=int(ICON * 0.235), fill=(205, 216, 235))
    small = img.resize((ICON, ICON), Image.LANCZOS)
    sheet.paste(small, (icon_x, oy), small)

    # 16px 真实观感，放在图标右侧
    tiny = img.resize((16, 16), Image.LANCZOS)
    tx = icon_x + ICON + 26
    sd.rounded_rectangle([tx - 8, oy + ICON // 2 - 26, tx + 58, oy + ICON // 2 + 40], radius=10, fill=(255, 255, 255))
    sheet.paste(tiny.resize((48, 48), Image.NEAREST), (tx, oy + ICON // 2 - 18))
    sd.text((tx + 24, oy + ICON // 2 + 48), '16px', font=f_tag, fill=(120, 132, 156), anchor='ma')

    sd.text((cx, oy + ICON + 24), title, font=f_title, fill=(28, 40, 66), anchor='ma')
    for j, line in enumerate(wrap(desc, f_desc, CELL_W - 60, sd)[:2]):
        sd.text((cx, oy + ICON + 62 + j * 26), line, font=f_desc, fill=(98, 110, 134), anchor='ma')

sheet.save(os.path.join(OUT, '_对比.png'))
print('对比图已生成', sheet.size)
