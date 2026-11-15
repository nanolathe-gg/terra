"""Shared loading and reprojection for the Painted Desert measurements.

A corpus directory holds metadata.json, heights.bin (u8 per 16-px cell),
map-indexed.bin (u8 palette index per pixel) and palette-rgb.bin. TA draws
world (x, y, h) at screen y - h/2; the cell height is placed at the cell's
north-west corner (offset 0), which a scan of offsets 0-16 px confirmed on
Painted Desert (mutual information of height and index peaks there).
"""
import json
from pathlib import Path

import numpy as np
from scipy.ndimage import label, map_coordinates, uniform_filter

DEFAULT_MAP = Path('/tmp/nanolathe-map-editor/retail-desert/painted_desert-e2c3dad3')
LUMA = np.array([.299, .587, .114], np.float32)


def load(d=DEFAULT_MAP):
    d = Path(d)
    m = json.loads((d / 'metadata.json').read_text())
    h = np.fromfile(d / 'heights.bin', np.uint8).reshape(m['cell_height'], m['cell_width'])
    idx = np.memmap(d / 'map-indexed.bin', np.uint8, mode='r', shape=(m['height'], m['width']))
    pal = np.fromfile(d / 'palette-rgb.bin', np.uint8).reshape(256, 3)
    return m, h, idx, pal


def height_field(h, y0, y1, x0, x1, off=0.0):
    """Bilinear world height at pixel centres of the world box."""
    cy = (np.arange(y0, y1, dtype=np.float32) + .5 - off) / 16
    cx = (np.arange(x0, x1, dtype=np.float32) + .5 - off) / 16
    Y, X = np.meshgrid(cy, cx, indexing='ij')
    return map_coordinates(h.astype(np.float32), [Y, X], order=1, mode='nearest')


def screen_rows(H, y0):
    """Screen row showing each world pixel (TA's oblique projection)."""
    return np.floor(np.arange(y0, y0 + H.shape[0])[:, None] + .5 - .5 * H).astype(np.int64)


def world_view(idx, pal, h, y0, y1, x0, x1, smooth=5):
    """World-space images of one box: palette index, locally averaged RGB
    (undoes the dither), height, and height gradient in units per cell."""
    H = height_field(h, y0, y1, x0, x1)
    sy = screen_rows(H, y0)
    top = max(0, int(sy.min()) - smooth)
    bot = min(idx.shape[0], int(sy.max()) + smooth + 1)
    a = np.asarray(idx[top:bot, x0:x1])
    rgb = pal[a].astype(np.float32)
    if smooth > 1:
        rgb = np.stack([uniform_filter(rgb[..., c], smooth) for c in range(3)], -1)
    rows = np.clip(sy - top, 0, a.shape[0] - 1)
    cols = np.broadcast_to(np.arange(x1 - x0)[None, :], rows.shape)
    gy, gx = np.gradient(H)
    return a[rows, cols], rgb[rows, cols], H, gx * 16, gy * 16


def raised_forms(h, threshold=12, min_cells=40):
    """Connected raised landforms (cells above threshold), largest first:
    (cells, peak, y0, y1, x0, x1) in cells, inclusive."""
    lab, n = label(h > threshold)
    sizes = np.bincount(lab.ravel())
    forms = []
    for i in range(1, n + 1):
        if sizes[i] < min_cells:
            continue
        ys, xs = np.nonzero(lab == i)
        forms.append((int(sizes[i]), int(h[lab == i].max()), int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())))
    forms.sort(reverse=True)
    return forms, lab


def unique_forms(h, idx, forms, same=.85):
    """Drop repeated stamps: a form whose height box equals an earlier one's
    on at least `same` of its cells is a copy."""
    kept = []
    for f in forms:
        _, _, y0, y1, x0, x1 = f
        hb = h[y0:y1 + 1, x0:x1 + 1]
        dup = False
        for g in kept:
            gy0, gx0 = g[2], g[4]
            gb = h[gy0:gy0 + hb.shape[0], gx0:gx0 + hb.shape[1]]
            if gb.shape == hb.shape and (gb == hb).mean() >= same:
                dup = True
                break
        if not dup:
            kept.append(f)
    return kept


def classify(rgb):
    """Band class from locally averaged colour: 1 orange (warmth R-B >= 40),
    2 pale (cooler, luma >= 160), 3 gray (cooler, darker). The warmth/luma
    histogram of the 67-high mesa has its orange cluster at warmth 60-90 and
    its pale cluster at -10..10; the plain's own tan (warmth ~48) only
    occurs below the forms. Class 0 is unused (kept for the names table)."""
    warm = rgb[..., 0] - rgb[..., 2]
    luma = rgb @ LUMA
    c = np.full(rgb.shape[:2], 3, np.int8)
    c[(warm < 40) & (luma >= 160)] = 2
    c[warm >= 40] = 1
    return c


CLASS_NAMES = ['tan', 'orange', 'pale', 'gray']
