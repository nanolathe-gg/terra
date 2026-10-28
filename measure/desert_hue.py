"""Colour of Painted Desert reproductions by what is drawn, retail beside ours (card G4).

  desert_hue.py <render-dir> [<render-dir> ...]

A render dir is a repro/render.mjs output joined with its retail crop (all.sh
writes this): retail.png, heights.npy, crop.json, ours.png, ours-heights.json.
Both pictures use TA's oblique projection, screen row = world row - (height -
plain) / 2, so a height map is painted into screen space far to near (a cell
nearer the viewer overwrites the ones behind it) and every pixel is then
classed by the height of the ground it shows:

  plain  at or below 1 unit above the plain
  apron  1-17 above the plain
  bands  17-56 above (the orange and cool beds)
  cap    56 and above on gentle ground (slope under 0.35 units per px)
  flat40 the 40% of pixels with the least local change in luma (the card's measure)

For each class and each picture: mean RGB, the hue of the mean colour in
degrees (HSV), R/G, the standard deviation of luma, the share of pixels that
are orange (R-B over 40, hue under 45) and that are grey (R-B under 14, luma
85-145, 5x5-averaged). The plain's hue needs one map's tiles only, so the
Desert Triad window (desert-2) is compared to its own retail map, not the
Painted Desert's.
"""
import colorsys
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'repro'))
from retail_crop import upsample  # noqa: E402

LUMA = np.array([.299, .587, .114])


def screen_heights(h, plain, oversample=4):
    """Height (above the plain) of the ground each screen pixel shows."""
    size = h.shape[0]
    out = np.full((size, size), np.nan)
    cols = np.arange(size)
    for i in range(size * oversample):
        w = (i + .5) / oversample - .5
        w0 = int(np.clip(np.floor(w), 0, size - 2)); t = w - w0
        row = h[w0] * (1 - t) + h[w0 + 1] * t - plain
        r = np.floor(w + .5 - row / 2).astype(int)
        ok = (r >= 0) & (r < size)
        out[r[ok], cols[ok]] = row[ok]
    # holes left by steep cells take the ground below them
    for _ in range(4):
        nan = np.isnan(out)
        if not nan.any():
            break
        below = np.vstack([out[1:], out[-1:]])
        out[nan] = below[nan]
    nan = np.isnan(out)
    out[nan] = 0
    return out


def hue(rgb):
    return colorsys.rgb_to_hsv(*(np.clip(rgb, 0, 255) / 255))[0] * 360


def stats(img, mask):
    if mask.sum() < 200:
        return None
    px = img[mask]
    m = px.mean(0)
    luma = px @ LUMA
    sm = np.stack([uniform_filter(img[..., c], 5) for c in range(3)], -1)[mask]
    sl = sm @ LUMA
    return dict(n=int(mask.sum()), rgb=m.round(0).tolist(), hue=round(hue(m), 1), rg=round(m[0] / m[1], 3), lsd=round(float(luma.std()), 1),
                orange=round(float(((sm[:, 0] - sm[:, 2] > 40) & (sm[:, 1] / np.maximum(sm[:, 0], 1) > .66)).mean()), 3),
                grey=round(float(((sm[:, 0] - sm[:, 2] < 14) & (sl > 85) & (sl < 145)).mean()), 3))


def flat_mask(img, share=.4):
    luma = img @ LUMA
    gy, gx = np.gradient(uniform_filter(luma, 3))
    change = uniform_filter(np.hypot(gx, gy), 9)
    return change <= np.quantile(change, share)


def classes(img, hs):
    gy, gx = np.gradient(uniform_filter(hs, 5))
    slope = np.hypot(gx, gy)
    return {'plain': hs < 1, 'apron': (hs >= 1) & (hs < 17), 'bands': (hs >= 17) & (hs < 56),
            'cap': (hs >= 56) & (slope < .35), 'flat40': flat_mask(img)}


def main(d):
    d = Path(d)
    crop = json.loads((d / 'crop.json').read_text())
    rh = upsample(np.load(d / 'heights.npy'), crop['size'])
    data = json.loads((d / 'ours-heights.json').read_text())
    g = data['grid']
    oh = np.asarray(Image.fromarray((np.asarray(data['heights'], float).reshape(g, g) - data['sea']).astype(np.float32)).resize((crop['size'],) * 2, Image.BILINEAR))
    print(d.name)
    for name, png, hgt, plain in (('retail', 'retail.png', rh, crop['plain']), ('ours', 'ours.png', oh, 24.0)):
        img = np.asarray(Image.open(d / png).convert('RGB'), float)
        hs = screen_heights(hgt, plain)
        edges = [-99, 1, 4, 8, 12, 17, 24, 35, 48, 56, 99]
        for lo, hi in zip(edges, edges[1:]):
            m = (hs >= lo) & (hs < hi)
            if m.sum() > 2000:
                mu = img[m].mean(0)
                print(f"  {name:6s} height {lo:3d}..{hi:3d}  n {int(m.sum()):7d}  rgb {mu.round(0).tolist()}  hue {hue(mu):5.1f}  R/G {mu[0] / mu[1]:.3f}  luma {float(mu @ LUMA):5.1f}")
        for cls, mask in classes(img, hs).items():
            s = stats(img, mask)
            if s:
                print(f"  {name:6s} {cls:7s} n {s['n']:7d}  rgb {s['rgb']}  hue {s['hue']:5.1f}  R/G {s['rg']:.3f}  luma sd {s['lsd']:5.1f}  orange {s['orange']:.3f}  grey {s['grey']:.3f}")


if __name__ == '__main__':
    for f in sys.argv[1:]:
        main(f)
