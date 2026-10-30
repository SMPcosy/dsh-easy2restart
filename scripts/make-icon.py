#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
dsh-easy2restart 图标生成器（淡暖纸本 v1.0）
========================================================
产出：
  icon.png          512×512 插件列表图标（纸本卡片 + 墨色重启环 + 青色归档托盘）
  scripts/preview-icon.png   小尺寸可读性检查表（16/24/32/48/64/128）

设计约束（来自 ui-design-spec）：
  - 纸 #FBF6EC / 卡片 #FFFDF8 / 墨 #2A2119 / 线 #E5D8C4
  - 语义色只用一个青 #2C6B62（归档），红黄绿留给界面状态，不上图标
  - 笔画粗、元素少：32px 下仍能读出「重启 + 归档」
  - 4× 超采样后降采样，边缘不发毛

用法：python scripts/make-icon.py
"""
import math
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

INK = "#2A2119"
PAPER = "#FBF6EC"
CARD = "#FFFDF8"
LINE = "#E5D8C4"
ACCENT = "#2C6B62"  # 青：归档

DESIGN = 1024          # 设计坐标系
SS = 2                 # 相对 1024 的超采样倍数（实际画布 2048）
OUT = 512


def s(v):
    """设计单位 → 画布像素"""
    return int(round(v * SS))


def stroke_arc(d, cx, cy, r, a0, a1, width, fill, step=1.5):
    """顺时针从 a0° 画到 a1°（屏幕坐标 y 向下），线宽 width，两端圆头。

    Pillow 的 ImageDraw.arc 对 start/end 的绕行方向与线宽处理都不稳定，
    这里直接采样成折线自己描边，结果完全可控。
    """
    n = max(2, int(abs(a1 - a0) / step))
    pts = []
    for i in range(n + 1):
        ang = math.radians(a0 + (a1 - a0) * i / n)
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    d.line([(s(x), s(y)) for x, y in pts], fill=fill, width=s(width), joint="curve")
    for x, y in (pts[0], pts[-1]):      # 圆头
        d.ellipse(
            [s(x - width / 2), s(y - width / 2), s(x + width / 2), s(y + width / 2)],
            fill=fill,
        )
    return pts[-1]


def build():
    size = s(DESIGN)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # ---- 卡片底：一层边界，圆角 220/1024（≈22%） ----
    d.rounded_rectangle(
        [s(10), s(10), s(DESIGN - 10), s(DESIGN - 10)],
        radius=s(220),
        fill=CARD,
        outline=LINE,
        width=s(6),
    )

    # ---- 重启环：280° 圆弧 + 一个连续的箭头（缺口在右上，箭头指向右下） ----
    cx, cy, r = 468.0, 424.0, 254.0
    stroke = 68.0
    start_deg, end_deg = 20.0, 292.0     # 顺时针 20°→292°，缺口 88° 落在右上
    stroke_arc(d, cx, cy, r, start_deg, end_deg, stroke, INK)

    # ---- 箭头：底边压在弧的端头上，尖端沿切线前进 ----
    rad = math.radians(end_deg)
    px = cx + r * math.cos(rad)
    py = cy + r * math.sin(rad)
    tx, ty = -math.sin(rad), math.cos(rad)      # 切线（角度增大 = 顺时针）
    nx, ny = math.cos(rad), math.sin(rad)       # 法线
    tip = (px + tx * 112, py + ty * 112)
    base = (px - tx * 6, py - ty * 6)
    half = 98
    d.polygon(
        [
            (s(tip[0]), s(tip[1])),
            (s(base[0] + nx * half), s(base[1] + ny * half)),
            (s(base[0] - nx * half), s(base[1] - ny * half)),
        ],
        fill=INK,
    )

    # ---- 归档托盘（右下，实心盖 + 描边盒体，和环完全分开） ----
    d.rounded_rectangle([s(598), s(714), s(902), s(770)], radius=s(20), fill=ACCENT)
    d.rounded_rectangle(
        [s(628), s(794), s(872), s(898)],
        radius=s(18),
        outline=ACCENT,
        width=s(36),
    )

    return img.resize((OUT, OUT), Image.LANCZOS)


def preview(icon):
    """小尺寸可读性检查表：每个尺寸都放在浅底与深底上各一遍"""
    sizes = [16, 24, 32, 48, 64, 128]
    pad = 16
    width = sum(sz + pad for sz in sizes) + pad
    height = pad + 128 + pad + 128 + pad
    sheet = Image.new("RGB", (width, height), "#FBF6EC")
    d = ImageDraw.Draw(sheet)
    d.rectangle([0, pad + 128 + pad, width, height], fill="#2A2119")
    x = pad
    for sz in sizes:
        small = icon.resize((sz, sz), Image.LANCZOS)
        top = pad + (128 - sz) // 2
        sheet.paste(small, (x, top), small)
        bottom = pad + 128 + pad + (128 - sz) // 2
        sheet.paste(small, (x, bottom), small)
        x += sz + pad
    return sheet


def main():
    icon = build()
    icon_path = os.path.join(ROOT, "icon.png")
    icon.save(icon_path, "PNG", optimize=True)
    preview(icon).save(os.path.join(HERE, "preview-icon.png"), "PNG", optimize=True)
    print("icon.png", icon.size, os.path.getsize(icon_path), "bytes")


if __name__ == "__main__":
    main()
