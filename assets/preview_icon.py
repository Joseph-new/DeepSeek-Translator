# -*- coding: utf-8 -*-
"""按真实使用场景预览新图标：窗口/任务栏/托盘（浅色与深色任务栏各一份）"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
icon = Image.open(os.path.join(HERE, 'icon.png')).convert('RGBA')
tray = Image.open(os.path.join(HERE, 'tray.png')).convert('RGBA')

FONT = r'C:\Windows\Fonts\msyhbd.ttc'
def font(sz):
    try:
        return ImageFont.truetype(FONT, sz)
    except Exception:
        return ImageFont.load_default()

W, H = 980, 560
sheet = Image.new('RGB', (W, H), (243, 246, 251))
d = ImageDraw.Draw(sheet)
f_h = font(24)
f_s = font(16)

def label(xy, text, anchor='la', f=None):
    d.text(xy, text, font=f or f_s, fill=(70, 82, 106), anchor=anchor)

# ---- 大尺寸 ----
big = icon.resize((240, 240), Image.LANCZOS)
d.rounded_rectangle([44, 92, 44 + 246, 92 + 246], radius=58, fill=(205, 216, 235))
sheet.paste(big, (47, 95), big)
label((167, 66), '窗口 / 桌面图标  256px', 'ma', f_h)

# ---- 任务栏尺寸 ----
for i, sz in enumerate((32, 48)):
    x = 340 + i * 90
    im = icon.resize((sz, sz), Image.LANCZOS)
    sheet.paste(im, (x, 170), im)
    label((x + sz // 2, 230), f'{sz}px', 'ma')
label((385, 140), '任务栏', 'ma', f_h)

# ---- 托盘：浅色任务栏 ----
d.rounded_rectangle([540, 92, 940, 172], radius=12, fill=(243, 243, 243))
t = tray.resize((48, 48), Image.NEAREST)
sheet.paste(t, (560, 108))
label((700, 116), '托盘 16px（浅色任务栏，放大显示）')
label((700, 140), '↑ 左为像素放大，右为真实大小', f=font(14))
real = tray.resize((16, 16), Image.LANCZOS)
sheet.paste(real, (830, 124))

# ---- 托盘：深色任务栏 ----
d.rounded_rectangle([540, 192, 940, 272], radius=12, fill=(32, 32, 32))
sheet.paste(Image.new('RGBA', (48, 48), (0, 0, 0, 0)), (560, 208))
sheet.paste(t, (560, 208), t)
sheet.paste(real, (830, 224), real)
label((700, 216), '托盘 16px（深色任务栏）', f=f_s)

# ---- 像素级 16px 放大 ----
label((44, 360), '16px 像素级放大（托盘真实素材）', 'la', f_h)
px = tray.resize((16 * 10, 16 * 10), Image.NEAREST)
sheet.paste(px, (44, 396))
label((44 + 170, 500), '↑ 无插值放大，看清实际像素', f=font(14))

sheet.save(os.path.join(HERE, '_新图标预览.png'))
print('预览已生成', sheet.size)
