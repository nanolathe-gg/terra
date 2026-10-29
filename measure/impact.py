"""The impact of one control (docs/TERRAIN_ENGINE.md, "Every kept control must matter"): the share of
a surface class's pixels whose luma changes by more than 8 between the control's minimum and its
maximum, on Green's three windows.

  impact.py <name> <lo-root> <hi-root> [--sheet <out.png>]

Each root holds green-1..3 as repro/all.sh or render.mjs writes them (ours.png, ours-heights.json),
rendered with the control at its minimum (lo) and its maximum (hi), everything else equal. A
pixel's class comes from the lo render's heights by measure/material_classes.py's rule, with its
40 px margin. Prints one line per class, plus every pixel, with the share on green-1, -2 and -3.
--sheet writes the 1x crop pairs: for each window, the 256-px square where the most pixels moved,
lo | hi. A main control under 5% of its class on every window is a finding: strengthen it or
remove it.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

here = Path(__file__).resolve().parent
exec(open(here / 'material_classes.py').read().split('def main')[0])  # LUMA, CLASSES, slope_map

CROP = 256


def load(root, w):
    d = Path(root) / f'green-{w}'
    img = np.asarray(Image.open(d / 'ours.png').convert('RGB'))
    o = json.loads((d / 'ours-heights.json').read_text())
    g = np.array(o['heights'], float).reshape(o['grid'], o['grid'])
    return img, slope_map(g - o['sea'], 2)


def main():
    args = sys.argv[1:]
    sheet = None
    if '--sheet' in args:
        i = args.index('--sheet'); sheet = args[i + 1]; del args[i:i + 2]
    name, lo_root, hi_root = args
    shares = {c[0]: [] for c in CLASSES}; shares['all pixels'] = []
    pairs = []
    for w in (1, 2, 3):
        lo, slope = load(lo_root, w)
        hi, _ = load(hi_root, w)
        moved = np.abs(lo.astype(float) @ LUMA - hi.astype(float) @ LUMA) > 8
        for cname, a, b in CLASSES:
            m = (slope >= a) & (slope < b)
            m[:40] = m[-40:] = False; m[:, :40] = m[:, -40:] = False
            shares[cname].append(moved[m].mean() * 100 if m.sum() >= 500 else float('nan'))
        shares['all pixels'].append(moved.mean() * 100)
        density = ndi.uniform_filter(moved.astype(float), CROP)
        h = CROP // 2
        y, x = np.unravel_index(np.argmax(density[h:-h, h:-h]), density[h:-h, h:-h].shape)
        y0, x0 = y, x
        pairs.append((lo[y0:y0 + CROP, x0:x0 + CROP], hi[y0:y0 + CROP, x0:x0 + CROP], f'green-{w} at {x0},{y0}'))
    for cname, v in shares.items():
        print(f'{name:14s} {cname:11s} changed >8 luma  green-1/2/3:', '  '.join(f'{s:5.1f}%' for s in v))
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
