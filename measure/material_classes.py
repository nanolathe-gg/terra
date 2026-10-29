"""Per-surface-class numbers for Green's windows (card H3): flat plain, grass slope, rock face.

  material_classes.py <render-root> [<render-root> ...]   (repro/all.sh outputs with green-1..3)

A pixel's class comes from the height slope at its own position, by the same rule for retail
(heights.npy, 16-px cells) and ours (ours-heights.json): flat below .03 height units per px, grass
slope .10-.50, rock face above .50 (the heights are bilinear-upsampled, unshifted by the screen
projection, so a class's mask is approximate and equal in both). Per class: share of pixels, mean
luma, luma s.d., s.d. of the 5-px box mean, mean hue (degrees) and saturation.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

LUMA = np.array([.299, .587, .114])
CLASSES = [('flat', 0, .03), ('grass slope', .10, .50), ('rock face', .50, 99)]


def slope_map(grid, px):
    big = ndi.zoom(grid, 1024 / grid.shape[0], order=1)
    gy, gx = np.gradient(ndi.gaussian_filter(big, 3))
    return np.hypot(gx, gy)


def hue(mean):
    mx, mn = mean.max(), mean.min()
    if mx == mn:
        return 0.0, 0.0
    r, g, b = mean
    h = (60 * ((g - b) / (mx - mn)) % 360) if mx == r else 60 * (2 + (b - r) / (mx - mn)) if mx == g else 60 * (4 + (r - g) / (mx - mn))
    return float(h), float((mx - mn) / mx)


def rows(img, slope, margin=40):
    out = {}
    L = img @ LUMA
    box = ndi.uniform_filter(L, 5)
    for name, lo, hi in CLASSES:
        m = (slope >= lo) & (slope < hi)
        m[:margin] = m[-margin:] = False; m[:, :margin] = m[:, -margin:] = False
        if m.sum() < 500:
            out[name] = None
            continue
        h, s = hue(img[m].mean(0))
        out[name] = (m.mean(), L[m].mean(), L[m].std(), box[m].std(), h, s)
    return out


def main():
    roots = [Path(a) for a in sys.argv[1:]]
    for w in (1, 2, 3):
        d0 = roots[0] / f'green-{w}'
        ret = np.asarray(Image.open(d0 / 'retail.png').convert('RGB')).astype(float)
        sr = slope_map(np.load(d0 / 'heights.npy'), 16)
        print(f'green-{w}  class: share | luma mean sd sd5 | hue sat')
        res = {'retail': rows(ret, sr)}
        for r in roots:
            o = json.loads((r / f'green-{w}' / 'ours-heights.json').read_text())
            g = np.array(o['heights'], float).reshape(o['grid'], o['grid'])
            res[r.name] = rows(np.asarray(Image.open(r / f'green-{w}' / 'ours.png').convert('RGB')).astype(float), slope_map(g - o['sea'], 2))
        for name, _, _ in CLASSES:
            for label, rr in res.items():
                v = rr[name]
                print(f'  {name:12s} {label:10s}', 'n/a' if v is None else f'{v[0]:.3f} | {v[1]:5.1f} {v[2]:5.1f} {v[3]:5.2f} | {v[4]:5.1f} {v[5]:.3f}')


main()
