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
  slope   H17: ground whose slope is at least .10 (measure/material_classes.py's grass slope and rock face together), the blocks a mark
          on slopes is cut into; the family option of geology_controls.mjs reads cracks and crack tone here, not the raised class
  face    H17: slope at least .50 (material_classes.py's rock face), where the structured face (joints, gullies, facets,
          blocks) is cut. Both are 16-px blocks with a 40-px margin dropped, as measure/impact.py reads its classes; a `slope` or
          `face` row also carries the other class's share under `slope_changed` / `face_changed`
  The water side (H18). The waterline is the sea's edge on the displayed heights (g = height - sea; dry above 0.5, wet below -0.5). Distances are
  in window px to the nearest ground of the other side:
  shallows  wet ground within 64 px of dry ground: the shallow bed, the shelf and the step to deep, where the water's colour and bed marks act
  edge      either side within 6 px of the waterline: the waterline's stairs, blur and rim, thin marks that 16-px block means barely see
  beach     dry ground within 200 px of wet ground: sand, aprons and bars (Zhon's beach reaches ~107-178 px)
  shore     either side within 120 px of the waterline: what a stroke's coast pass cuts (layers, fingers, plates, the dry bank)
  crater    H20: discs round the scene's crater strokes, each .75 of the card's diameter in radius (the bowl, rim and apron), at the stroke's points as the
            scene file gives them (no height shift: the discs are wider than the shift); the class for the crystal craters' skin and web
  impact    H21: dry relief at least 1.5 either side of the plain (includes crater bowls, unlike raised)
  fold      H21: dry gentle slopes .025–.60, moonFolds' support
  These masks use the existing height-grid projection approximation; a below-5% row is not proof of dead code.
  wall      H19: ground faceRelief's gate is above .5 on (1 - broad.y / 2 at least 2.25, engine-frag.wgsl), at the screen rows it is drawn on (a row
            less g / 2), which are many more than its world rows. A retail window holds almost none, so each root holds <world>-1 alone, the
            world's repro/walls scene
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

exec(open(Path(__file__).resolve().parent / 'material_classes.py').read().split('def main')[0])  # LUMA, CLASSES, slope_map

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
    if cls == 'crater':
        scene = json.loads((Path(__file__).resolve().parent.parent / 'repro' / 'scenes' / f'{world}-{n}.json').read_text())
        yy, xx = np.mgrid[:1024, :1024]
        m = np.zeros((1024, 1024), bool)
        for kind, points, *opt in scene['strokes']:
            if kind == 'crater':
                r = .75 * (opt[0].get('card', {}).get('diameter', 100) if opt else 100)
                for x, y in points:
                    m |= (xx - x) ** 2 + (yy - y) ** 2 <= r * r
        return m
    if cls == 'wall':
        h = ndi.zoom(g, 1024 / g.shape[0], order=1)
        broad = (np.roll(h, -5, 0) - np.roll(h, 5, 0)) / 10   # broadGradient's y
        y, x = np.nonzero(1 - broad / 2 >= 2.25)
        row = (y - h[y, x] / 2).astype(int)
        m = np.zeros_like(h, bool)
        m[row[(row >= 0) & (row < 1024)], x[(row >= 0) & (row < 1024)]] = True
        return ndi.binary_closing(m, np.ones((12, 1), bool))   # one world row is up to 9 screen rows
    if cls in ('slope', 'face'):
        m = slope_map(g, 2) >= (.10 if cls == 'slope' else .50)
        m[:40] = m[-40:] = False; m[:, :40] = m[:, -40:] = False
        return m
    h = ndi.zoom(g, 1024 / g.shape[0], order=1)
    base = BASE.get(world, 24)
    if cls == 'impact':
        return (h > .5) & (np.abs(h - base) >= 1.5)
    if cls == 'fold':
        slope = slope_map(g, 2)
        return (h > .5) & (slope >= .025) & (slope <= .60)
    if cls in ('shallows', 'edge', 'beach', 'shore'):
        dry, wet = h > .5, h < -.5
        if not dry.any() or not wet.any():
            return np.zeros_like(dry)
        toWet, toDry = ndi.distance_transform_edt(~wet), ndi.distance_transform_edt(~dry)
        if cls == 'shallows':
            return wet & (toDry <= 64)
        if cls == 'beach':
            return dry & (toWet <= 200)
        reach = 6 if cls == 'edge' else 120
        return (dry & (toWet <= reach)) | (wet & (toDry <= reach))
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
    more = ('slope', 'face') if cls in ('slope', 'face') else ()
    for k in more:
        out[k + '_changed'] = []; out[k + '_share'] = []
    for n in (1,) if cls == 'wall' else (1, 2, 3):
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
        for k in more:
            ob = class_mask(base, world, n, k)[:bh, :bw].reshape(bh // B, B, bw // B, B).mean((1, 3)) > .5
            out[k + '_share'].append(round(float(ob.mean()), 4))
            out[k + '_changed'].append(round(float(ch[ob].mean()), 4) if ob.any() else None)
    print(json.dumps(out))


main()
