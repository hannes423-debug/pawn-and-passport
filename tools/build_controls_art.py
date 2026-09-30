#!/usr/bin/env python3
"""
tools/build_controls_art.py - cut the controls artwork for the Controls page.

Sources (the artist's sheets, kept at the project root, never edited):

  ui-controls-overview.png   mouse icons, then one panel per input device:
                             keyboard + mouse, Xbox, Nintendo, PlayStation
  ui-devices-1.png           DualShock, Xbox-style pad, Joy-Con grip
  ui-devices-2.png           DualSense, handheld, keyboard + mouse

Output: assets/ui/controls/<name>.webp. The panels keep the sheet's own
resolution; the device pictures are scaled down to icon size. Lossy at q90:
the sheets are painted, not pixel-exact, so lossless only kept the noise
(the four panels were 900 KB that way).

The boxes were measured from the sheets (gold panel borders, alpha islands)
and are checked here: a box that no longer holds its picture stops the build.

    python3 tools/build_controls_art.py
"""
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "ui", "controls")

PANELS = {                                   # ui-controls-overview.png, (x0, y0, x1, y1)
    "panel-keyboard": (54, 214, 1398, 473),
    "panel-xbox": (54, 484, 717, 784),
    "panel-nintendo": (733, 484, 1398, 784),
    "panel-playstation": (54, 796, 1398, 1053),
}
DEVICES = {                                  # sheet -> {name: box}
    "ui-devices-1.png": {"device-xbox": (759, 104, 1430, 591), "device-joycon": (1475, 108, 2156, 603)},
    "ui-devices-2.png": {"device-dualsense": (15, 160, 633, 565), "device-handheld": (641, 188, 1403, 541),
                         "device-keyboard": (1414, 208, 2157, 533)},
}
QUALITY = 90
DEVICE_W = 192                               # px: shown at 48-64 CSS px, so this covers a 3x screen


def save(img, name):
    path = os.path.join(OUT, f"{name}.webp")
    img.save(path, "WEBP", quality=QUALITY, method=6)
    print(f"{name:18s} {img.width}x{img.height} {os.path.getsize(path) // 1024} KB")


def main():
    os.makedirs(OUT, exist_ok=True)
    sheet = Image.open(os.path.join(ROOT, "ui-controls-overview.png")).convert("RGB")
    for name, box in PANELS.items():
        crop = sheet.crop(box)
        if np.asarray(crop).max(axis=2).mean() < 20:
            sys.exit(f"{name}: the box {box} is empty, the sheet changed")
        save(crop, name)
    for src, boxes in DEVICES.items():
        im = Image.open(os.path.join(ROOT, src)).convert("RGBA")
        for name, box in boxes.items():
            crop = im.crop(box)
            a = np.asarray(crop)[..., 3]
            if (a > 16).mean() < 0.2 or a[0].max() > 16 or a[-1].max() > 16 or a[:, 0].max() > 16 or a[:, -1].max() > 16:
                sys.exit(f"{name}: the box {box} cuts the picture or misses it, the sheet changed")
            scale = DEVICE_W / crop.width
            save(crop.resize((DEVICE_W, round(crop.height * scale)), Image.LANCZOS), name)


if __name__ == "__main__":
    main()
