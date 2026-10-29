"""Weather marks on Green's windows: where the dark lines run (against the fall line), and loose debris.

  weather_marks.py <retail.png|ours.png> <heights: crop dir's heights.npy | ours-heights.json> [label]

Lines: a dark-line pixel is below .75 x its 9-px median and 15 levels under it. Its direction is the
structure-tensor axis of the smoothed mask (sigma 1.5); the fall line is the projected cell-height
gradient (16-px cells, TA's h/2 projection). Per class (grass slope: slope >= .3, not grey; rock:
grey pixels inside a 7-px-closed region of 400+ px) it prints the line-pixel share, the share of the
line pixels within 30 deg of the fall line (along), 30-60, and over 60 deg (across the slope: a
contour), and the vertical spacing of the lines (rows between dark runs, median).
Debris: grey pixels (g <= r+2 and g <= b+2, luma > 35) outside the rock region by distance from it
(0-4, 4-12, 12-30, 30-60 px): the grey share, and the count of grey specks of 3-40 px per 1000 px.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def load(img, hts):
    rgb = np.asarray(Image.open(img).convert('RGB')).astype(np.float32)
    if str(hts).endswith('.npy'):
        cells = np.load(hts).astype(np.float32)
    else:
        d = json.load(open(hts)); g = d['grid']; k = g // 64
        cells = np.array(d['heights'], np.float32).reshape(g, g).reshape(64, k, 64, k).mean(axis=(1, 3))
    return rgb, cells


def fall_field(cells, shape):
    gy, gx = np.gradient(cells, 16.0)
    up = lambda a: ndi.zoom(a, shape[0] / a.shape[0], order=1)
    return up(gx), up(gy), np.hypot(up(gx), up(gy))


def measure(rgb, cells, label):
    L = rgb @ np.array([.299, .587, .114], np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    water = (b > g + 8) & (b > r + 8)
    grey = (g <= r + 2) & (g <= b + 2) & (L > 35) & ~water
    rock = ndi.binary_closing(grey, np.ones((7, 7)))
    lab, n = ndi.label(rock)
    area = np.bincount(lab.ravel()); area[0] = 0
    rock = (area > 400)[lab]
    gx, gy, slope = fall_field(cells, L.shape)
    med = ndi.median_filter(L, 9)
    dark = (L < .75 * med) & (med - L >= 15) & ~water
    m = ndi.gaussian_filter(dark.astype(np.float32), 1.5)
    my, mx = np.gradient(m)
    sxx, syy, sxy = (ndi.gaussian_filter(a, 2) for a in (mx * mx, my * my, mx * my))
    ang_grad = .5 * np.arctan2(2 * sxy, sxx - syy)          # gradient axis; the line runs across it
    line = ang_grad + np.pi / 2
    fall = np.arctan2(gy, gx)
    d = np.abs(((line - fall + np.pi / 2) % np.pi) - np.pi / 2)  # 0..pi/2
    deg = np.degrees(d)
    valid = np.ones(L.shape, bool); valid[:12] = valid[-12:] = False; valid[:, :12] = valid[:, -12:] = False
    out = [label]
    for name, cls in (('grass slope', valid & ~water & ~rock & (slope >= .3)), ('rock', valid & rock & (slope >= .3))):
        k = cls & dark
        if k.sum() < 300:
            out.append(f'  {name:12s} too few'); continue
        a = deg[k]
        col = dark[:, :].astype(np.int8)
        trans = (np.diff(col, axis=0) == 1) & cls[1:]
        spacing = cls.sum() / max(trans.sum(), 1)  # px per dark run starting, along a column
        out.append(f'  {name:12s} px {int(cls.sum()):7d}  line px {100 * k.sum() / cls.sum():5.1f}%  along(<30) {100 * (a < 30).mean():4.0f}%  '
                   f'30-60 {100 * ((a >= 30) & (a < 60)).mean():4.0f}%  across(>60) {100 * (a >= 60).mean():4.0f}%  vertical run spacing {spacing:5.1f} px')
    dist = ndi.distance_transform_edt(~rock)
    dry = ~water
    for lo, hi in ((0, 4), (4, 12), (12, 30), (30, 60)):
        z = dry & ~rock & (dist >= lo) & (dist < hi) & valid
        if z.sum() < 500: continue
        sp = grey & z
        sl, ns = ndi.label(sp, np.ones((3, 3))); ar = np.bincount(sl.ravel())[1:]
        specks = ((ar >= 3) & (ar <= 40)).sum()
        out.append(f'  debris {lo:2d}-{hi:2d} px from rock: grey {100 * sp.sum() / z.sum():5.2f}%  specks 3-40 px {1000 * specks / z.sum():5.2f}/1000 px  (n {int(z.sum())})')
    out.append(f'  rock region {100 * rock.mean():.1f}% of the window')
    return '\n'.join(out)


if __name__ == '__main__':
    rgb, cells = load(sys.argv[1], sys.argv[2])
    print(measure(rgb, cells, sys.argv[3] if len(sys.argv) > 3 else sys.argv[1]))
