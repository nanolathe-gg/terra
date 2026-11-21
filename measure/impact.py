"""The impact of one control (AGENTS.md rule 9, "Every kept control must visibly matter"): the share
of a surface class that visibly changes between the control's minimum and its maximum, on Green's
three windows.

  impact.py <name> <lo-root> <hi-root> [--sheet <out.png>]

Each root holds green-1..3 as repro/all.sh or render.mjs writes them (ours.png, ours-heights.json),
rendered with the control at its minimum (lo) and its maximum (hi), everything else equal.

Measured on 16-px blocks, not pixels. A small height change re-registers the same texture a pixel
or two over, which moves most pixels by more than 8 luma while the picture looks the same (card H5
found 24-65% "changed" for erosion knobs whose min and max look alike). A block counts as changed
when its mean luma moves by more than 6, its luma s.d. by more than 4, or its mean colour by more
than 8 (RGB distance). A block's class is the class of most of its pixels by
measure/material_classes.py's rule on the lo render's heights, inside its 40 px margin.

Prints per class (plus every block) the share of changed blocks on green-1, -2 and -3, then the
noise floor: the same measure between lo and lo moved by 2 px and 1 px (calibrated on 2026-10-29:
1-3% of all blocks). The per-pixel share (>8 luma) follows in brackets, for reference only.
--sheet writes the 1x crop pairs: for each window, the 256-px square where the most blocks changed,
lo | hi. A main control under 5% of its class on every window, or not clearly above the floor, is a
finding: strengthen it or remove it.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

here = Path(__file__).resolve().parent
exec(open(here / 'material_classes.py').read().split('def main')[0])  # LUMA, CLASSES, slope_map

B, CROP = 16, 256
MEAN, SD, COLOUR = 6, 4, 8


def load(root, w):
    d = Path(root) / f'green-{w}'
    img = np.asarray(Image.open(d / 'ours.png').convert('RGB'))
    o = json.loads((d / 'ours-heights.json').read_text())
    g = np.array(o['heights'], float).reshape(o['grid'], o['grid'])
    return img, slope_map(g - o['sea'], 2)


def blocks(img):
    h, w = (img.shape[0] // B) * B, (img.shape[1] // B) * B
    x = img[:h, :w].astype(float).reshape(h // B, B, w // B, B, 3)
    lum = x @ LUMA
    return lum.mean((1, 3)), lum.std((1, 3)), x.mean((1, 3))


def changed(a, b):
    (ma, sa, ca), (mb, sb, cb) = blocks(a), blocks(b)
    return (np.abs(ma - mb) > MEAN) | (np.abs(sa - sb) > SD) | (np.linalg.norm(ca - cb, axis=-1) > COLOUR)


def class_blocks(slope, lo, hi):
    m = (slope >= lo) & (slope < hi)
    m[:40] = m[-40:] = False; m[:, :40] = m[:, -40:] = False
    h, w = (m.shape[0] // B) * B, (m.shape[1] // B) * B
    return m[:h, :w].reshape(h // B, B, w // B, B).mean((1, 3)) > .5, m


def main():
    args = sys.argv[1:]
    sheet = None
    if '--sheet' in args:
        i = args.index('--sheet'); sheet = args[i + 1]; del args[i:i + 2]
    name, lo_root, hi_root = args
    names = [c[0] for c in CLASSES] + ['all']
    share = {c: [] for c in names}; floor = {c: [] for c in names}; pixels = {c: [] for c in names}
    pairs = []
    for w in (1, 2, 3):
        lo, slope = load(lo_root, w)
        hi, _ = load(hi_root, w)
        moved = changed(lo, hi)
        noise = changed(lo, np.roll(np.roll(lo, 2, 1), 1, 0))
        px = np.abs(lo.astype(float) @ LUMA - hi.astype(float) @ LUMA) > 8
        for cname, a, b in CLASSES + [('all', -1, 1e9)]:
            mb, mp = class_blocks(slope, a, b) if cname != 'all' else (np.ones_like(moved), np.ones(px.shape, bool))
            ok = mb.sum() >= 4
            share[cname].append(moved[mb].mean() * 100 if ok else float('nan'))
            floor[cname].append(noise[mb].mean() * 100 if ok else float('nan'))
            pixels[cname].append(px[mp].mean() * 100 if mp.sum() >= 500 else float('nan'))
        k = CROP // B
        cs = np.cumsum(np.cumsum(np.pad(moved.astype(float), ((1, 0), (1, 0))), 0), 1)
        win = cs[k:, k:] - cs[:-k, k:] - cs[k:, :-k] + cs[:-k, :-k]
        by, bx = np.unravel_index(np.argmax(win), win.shape)
        y0, x0 = by * B, bx * B
        pairs.append((lo[y0:y0 + CROP, x0:x0 + CROP], hi[y0:y0 + CROP, x0:x0 + CROP], f'green-{w} at {x0},{y0}'))
    fmt = lambda v: '  '.join(f'{s:5.1f}%' for s in v)
    for c in names:
        print(f'{name:14s} {c:11s} blocks changed  green-1/2/3: {fmt(share[c])}   floor {fmt(floor[c])}   [pixels {fmt(pixels[c])}]')
    if sheet:
        gap, label = 4, 14
        out = Image.new('RGB', (2 * CROP + gap, 3 * (CROP + label)), (255, 0, 255))
        draw = ImageDraw.Draw(out)
        for i, (a, b, text) in enumerate(pairs):
            top = i * (CROP + label)
            draw.rectangle([0, top, out.width, top + label - 1], fill=(0, 0, 0))
            draw.text((2, top + 1), f'{name}: {text}  (min | max)', fill=(255, 255, 255))
            out.paste(Image.fromarray(a), (0, top + label))
            out.paste(Image.fromarray(b), (CROP + gap, top + label))
        out.save(sheet)


main()
