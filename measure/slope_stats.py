"""Brightness, contrast and rock/moss share by slope: retail sections vs renders.

Each sample is an 8x8 screen window at a world point on a 16-px grid, found
through TA's projection (screen y = world y - h/2). Water pixels are skipped.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

BINS = [0, .08, .25, .5, .9, 1.5, 9]

def window_stats(rgb):
    px = rgb.reshape(-1, 3).astype(np.float32)
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    water = (b > g + 8) & (b > r + 8)
    px = px[~water]
    if len(px) < 16: return None
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    luma = .299 * r + .587 * g + .114 * b
    chroma = px.max(1) - px.min(1)
    gray = (chroma < 28).mean()
    green = ((g > r + 12) & (g > b + 12)).mean()
    return luma.mean(), luma.std(), gray, green

def collect(samples):
    out = {}
    for slope, st in samples:
        k = np.searchsorted(BINS, slope, side='right') - 1
        out.setdefault(k, []).append(st)
    return {k: np.array(v) for k, v in out.items()}

def retail(manifest, root, world='greenworld'):
    samples = []
    for s in json.load(open(manifest))['sections']:
        if s['world'] != world: continue
        art = np.asarray(Image.open(Path(root) / s['art']).convert('RGB'))
        h = np.asarray(Image.open(Path(root) / s['heights'])).astype(np.float32)
        gy, gx = np.gradient(h, 16.0)
        slope = np.hypot(gx, gy)
        H, W = art.shape[:2]
        for cy in range(1, h.shape[0] - 1):
            for cx in range(1, h.shape[1] - 1):
                x = cx * 16 + 8; y = int(cy * 16 + 8 - h[cy, cx] / 2)
                if y < 4 or y + 4 > H or x + 4 > W: continue
                st = window_stats(art[y - 4:y + 4, x - 4:x + 4])
                if st: samples.append((slope[cy, cx], st))
    return samples

def ours(png, heights_json):
    art = np.asarray(Image.open(png).convert('RGB'))
    d = json.load(open(heights_json))
    grid, size, base, sea = d['grid'], d['size'], d['base'], d['sea']
    h = np.array(d['heights'], np.float32).reshape(grid, grid)
    spacing = (size - 1) / (grid - 1)
    gy, gx = np.gradient(h, spacing)
    slope = np.hypot(gx, gy)
    samples = []
    for wy in range(8, size - 8, 16):
        for wx in range(8, size - 8, 16):
            i, j = int(round(wy / spacing)), int(round(wx / spacing))
            if h[i, j] < sea + 1: continue
            y = int(wy - (max(sea, h[i, j]) - base) / 2)
            if y < 4 or y + 4 > size: continue
            st = window_stats(art[y - 4:y + 4, wx - 4:wx + 4])
            if st: samples.append((slope[i, j], st))
    return samples

def report(name, samples):
    c = collect(samples)
    print(f'\n{name}  ({len(samples)} samples)')
    print('  slope bin      n   luma  contrast  gray%  green%')
    for k in sorted(c):
        a = c[k]
        print(f'  {BINS[k]:4.2f}-{BINS[k+1]:<4.2f} {len(a):6d} {a[:,0].mean():6.1f} {a[:,1].mean():8.1f} {100*a[:,2].mean():6.1f} {100*a[:,3].mean():6.1f}')

if __name__ == '__main__':
    mode = sys.argv[1]
    if mode == 'retail':
        report('retail greenworld sections', retail(sys.argv[2], sys.argv[3]))
    else:
        samples = []
        for stem in sys.argv[3:]:
            samples += ours(stem + '.png', stem + '.heights.json')
        report(sys.argv[2], samples)
