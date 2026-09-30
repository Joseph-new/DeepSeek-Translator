# -*- coding: utf-8 -*-
"""托盘图标专用生成器

为什么单独一个脚本：托盘图标只有 16×16，**不能直接把 256px 的应用图标缩下来**。
实测「译」字在 16px 下会糊成一团白块 —— 笔画数决定了它物理上装不下。
所以托盘用一个笔画更少的字，风格与应用图标保持一致（同色系、同白色字形）。

用法：python make_tray_icon.py [wen|A|swap]
     默认 wen（「文」，与应用图标的 CJK 方向一致，且 16px 可读）
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
CJK = r'C:\Windows\Fonts\msyhbd.ttc'
LAT = r'C:\Windows\Fonts\segoeuib.ttf'

SS = 8
TOP, BOTTOM = (42, 58, 104), (14, 22, 48)   # 与应用图标的深蓝同色系
WHITE = (255, 255, 255, 255)

GLYPHS = {
    'wen': (CJK, 0.72, '文'),
    'yi': (CJK, 0.70, '译'),      # 保留但已知 16px 不可读，仅作对照
    'A': (LAT, 0.78, 'A'),
}


def load_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.truetype(CJK, size)


def build(size, key):
    path, ratio, txt = GLYPHS[key]
    n = size * SS
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))

    grad = Image.new('RGB', (1, n))
    for y in range(n):
        t = y / max(1, n - 1)
        grad.putpixel((0, y), tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)))
    grad = grad.resize((n, n), Image.BILINEAR).convert('RGBA')

    mask = Image.new('L', (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.28), fill=255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    f = load_font(path, int(n * ratio))
    b = d.textbbox((0, 0), txt, font=f)
    d.text((n / 2 - (b[0] + b[2]) / 2, n / 2 * 1.03 - (b[1] + b[3]) / 2), txt, font=f, fill=WHITE)

    # 轻微锐化，抵消缩小时的糊化
    return img.resize((size, size), Image.LANCZOS)


def main():
    key = (sys.argv[1] if len(sys.argv) > 1 else 'wen').strip()
    if key not in GLYPHS:
        print('用法：python make_tray_icon.py [%s]' % '|'.join(GLYPHS))
        return 1
    if key == 'yi':
        print('提示：「译」在 16px 下会糊成一团，仅建议用于对照。')

    build(16, key).save(os.path.join(HERE, 'tray.png'))
    build(32, key).save(os.path.join(HERE, 'tray@2x.png'))
    print('托盘图标已生成：%s（tray.png 16px / tray@2x.png 32px）' % GLYPHS[key][2])
    return 0


if __name__ == '__main__':
    sys.exit(main())
