# -*- coding: utf-8 -*-
"""把选定的候选图标应用为正式图标（icon.png / icon.ico / 托盘图标）

用法：python apply_variant.py v3
"""
import io
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
VARIANTS = os.path.join(HERE, 'variants')

SIZES = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]


def main():
    key = (sys.argv[1] if len(sys.argv) > 1 else '').strip().lower()
    src_path = os.path.join(VARIANTS, key + '.png')
    if not key or not os.path.exists(src_path):
        avail = sorted(f[:-4] for f in os.listdir(VARIANTS) if f.startswith('v') and f.endswith('.png'))
        print('用法：python apply_variant.py <版本>')
        print('可选：', ', '.join(avail))
        return 1

    src = Image.open(src_path).convert('RGBA')
    if src.size != (512, 512):
        src = src.resize((512, 512), Image.LANCZOS)

    src.save(os.path.join(HERE, 'icon.png'))
    src.resize((256, 256), Image.LANCZOS).save(os.path.join(HERE, 'icon-256.png'))
    src.save(os.path.join(HERE, 'icon.ico'), sizes=SIZES)

    print('已应用', key, '→ icon.png / icon.ico / icon-256.png')
    print()
    print('注意：托盘图标不在这里生成。托盘只有 16x16，直接缩应用图标会糊成一团，')
    print('      必须用笔画更少的字单独做 —— 跑 python make_tray_icon.py wen')
    print('提示：改完图标后，如果已经生成过 exe，需要重新双击 make-launcher.bat。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
