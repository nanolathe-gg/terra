"""H16: what one knob state did to one world's three windows, on rendered pixels.

  geology_diff.py <base-root> <state-root> <world> <class>

Each root holds <world>-1..3 as repro/all.sh or render.mjs writes them (ours.png, ours-heights.json). Prints one JSON object:
mean |diff| and the share of pixels moved by more than 8 (repro/compare.py's numbers, over the whole window), and the share of
the knob's class blocks that changed (measure/impact.py's block rule: 16-px blocks whose mean luma moves by more than 6, luma
s.d. by more than 4 or mean colour by more than 8), with the class's share of the window.

Classes, read on the base render's heights (the sea is subtracted; the dry base is 24, or 8 for Archipelago):
  raised  dry ground at least 1.5 above the base: the beds, strata, bands and column act here
  bank    ground between the sea and the plain (sea + .5 to base - .3): the coast layers act here
  halo    dry ground within 100 px of ground at least 4 above the base, outside it: the fringe's rings act here
  window  every pixel: for knobs with no ground class of their own
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

B, MEAN, SD, COLOUR = 16, 6, 4, 8
LUMA = np.array([.299, .587, .114])
BASE = {'archipelago': 8, 'zhon': 8}


def blocks(img):
    h, w = (img.shape[0] // B) * B, (img.shape[1] // B) * B
    x = img[:h, :w].astype(float).reshape(h // B, B, w // B, B, 3)
    lum = x @ LUMA
    return lum.mean((1, 3)), lum.std((1, 3)), x.mean((1, 3))


def changed(a, b):
    (ma, sa, ca), (mb, sb, cb) = blocks(a), blocks(b)
    return (np.abs(ma - mb) > MEAN) | (np.abs(sa - sb) > SD) | (np.linalg.norm(ca - cb, axis=-1) > COLOUR)


def class_mask(root, world, n, cls):
    if cls == 'window':
        return np.ones((1024, 1024), bool)
    o = json.loads((Path(root) / f'{world}-{n}' / 'ours-heights.json').read_text())
    g = np.array(o['heights'], float).reshape(o['grid'], o['grid']) - o['sea']
    h = ndi.zoom(g, 1024 / g.shape[0], order=1)
    base = BASE.get(world, 24)
    if cls == 'raised':
        return h >= base + 1.5
    if cls == 'bank':
        return (h > .5) & (h < base - .3)
    hills = h >= base + 4
    near = ndi.distance_transform_edt(~hills) <= 100
    return near & ~hills & (h > .5)


def main():
    base, state, world, cls = sys.argv[1:5]
    out = {'mad': [], 'moved': [], 'class_share': [], 'class_changed': []}
    for n in (1, 2, 3):
        a = np.asarray(Image.open(Path(base) / f'{world}-{n}' / 'ours.png').convert('RGB'), np.int16)
        b = np.asarray(Image.open(Path(state) / f'{world}-{n}' / 'ours.png').convert('RGB'), np.int16)
        d = np.abs(a - b)
        out['mad'].append(round(float(d.mean()), 3))
        out['moved'].append(round(float((d.max(-1) > 8).mean()), 4))
        m = class_mask(base, world, n, cls)
        bh, bw = (m.shape[0] // B) * B, (m.shape[1] // B) * B
        cb = m[:bh, :bw].reshape(bh // B, B, bw // B, B).mean((1, 3)) > .5
        ch = changed(a.astype(np.uint8), b.astype(np.uint8))
        out['class_share'].append(round(float(cb.mean()), 4))
        out['class_changed'].append(round(float(ch[cb].mean()), 4) if cb.any() else None)
    print(json.dumps(out))


main()
