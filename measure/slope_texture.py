"""Slope texture by slope bin, relative to the image's level ground: retail vs renders.

For each slope bin (crack_lines.BINS) and image, with luma L divided by the
median luma of the image's level ground (slope < 0.05; the world's median
level luma when an image has too little level ground):
  mean     mean relative luma (how much slopes darken)
  p10      10th percentile of relative luma (how dark the dark marks get)
  dark%    share of px darker than 0.6 of the ground
  e1,e2,e4 band-pass energy (std of a difference of Gaussians, relative
           luma x 100) at sigma 0.7-1.4 (pixel grain), 1.4-2.8 (specks and
           squiggles) and 2.8-5.6 (lumps, smears)
  blobs    dark marks (relative luma below 0.75 x their 15-px local median)
           per 1000 px by area: 1-3, 4-12, 13-40, 41-150, >150 px
  edge     mean luma step across a mark's boundary per px (crispness)
"""
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crack_lines as cl  # noqa: E402

AREAS = [0, 3.5, 12.5, 40.5, 150.5, 1e9]


def ground_level(L, slope, valid):
    m = valid & (slope < .05)
    return float(np.median(L[m])) if m.sum() > 2000 else None


def measure(rgb, slope, valid, ground, margin=6):
    L = cl.luma(rgb) / ground
    inner = np.zeros_like(valid)
    inner[margin:-margin, margin:-margin] = True
    valid = valid & inner
    g = [ndimage.gaussian_filter(L, s) for s in (.7, 1.4, 2.8, 5.6)]
    dog = [g[0] - g[1], g[1] - g[2], g[2] - g[3]]
    local = ndimage.median_filter(L, 15)
    dark = (L < .75 * local)
    lab, n = ndimage.label(dark, structure=np.ones((3, 3)))
    area = np.bincount(lab.ravel(), minlength=n + 1).astype(np.float32)
    # Crispness: luma gradient magnitude on each mark's boundary pixels.
    gy, gx = np.gradient(g[0])
    grad = np.hypot(gx, gy)
    edge = dark & ~ndimage.binary_erosion(dark)
    out = {}
    for (lo, hi), bn in zip(cl.BINS, cl.BIN_NAMES):
        m = valid & (slope >= lo) & (slope < hi)
        n_px = int(m.sum())
        if n_px < 3000:
            out[bn] = None
            continue
        ids = np.unique(lab[m & dark])
        ids = ids[ids > 0]
        hist = np.histogram(area[ids], AREAS)[0] if len(ids) else np.zeros(len(AREAS) - 1)
        em = edge & m
        out[bn] = dict(px=n_px, mean=float(L[m].mean()), p10=float(np.percentile(L[m], 10)),
                       dark=100. * float((L[m] < .6).mean()),
                       e1=100. * float(dog[0][m].std()), e2=100. * float(dog[1][m].std()), e4=100. * float(dog[2][m].std()),
                       blobs=(1000. * hist / n_px).round(2).tolist(),
                       edge=100. * float(grad[em].mean()) if em.any() else 0.)
    return out


def median_table(rows):
    out = {}
    for bn in cl.BIN_NAMES:
        r = [x[bn] for x in rows if x.get(bn)]
        if not r:
            continue
        t = {k: float(np.median([x[k] for x in r])) for k in ('mean', 'p10', 'dark', 'e1', 'e2', 'e4', 'edge')}
        t['blobs'] = np.median([x['blobs'] for x in r], axis=0).round(2).tolist()
        t['images'] = len(r)
        out[bn] = t
    return out


def fmt(table, label):
    rows = [label, '  bin        imgs  mean   p10    dark%   e1     e2     e4     edge   blobs/1000px (1-3,4-12,13-40,41-150,>150)']
    for bn in cl.BIN_NAMES:
        t = table.get(bn)
        if t:
            rows.append(f'  {bn:9s} {t["images"]:4d}  {t["mean"]:5.3f}  {t["p10"]:5.3f}  {t["dark"]:5.1f}  {t["e1"]:5.2f}  '
                        f'{t["e2"]:5.2f}  {t["e4"]:5.2f}  {t["edge"]:5.2f}  {t["blobs"]}')
    return '\n'.join(rows)


def retail(world, kinds=None):
    images = list(cl.retail_images(world))
    if kinds:
        images = [im for im in images if im[0].split('/')[0] in kinds]
    levels = [ground_level(cl.luma(rgb), s, v) for _, rgb, s, v in images]
    world_level = float(np.median([x for x in levels if x]))
    return [measure(rgb, s, v, lv or world_level) for (_, rgb, s, v), lv in zip(images, levels)]


def ours(stems):
    data = [cl.ours(s + '.png', s + '.heights.json') for s in stems]
    levels = [ground_level(cl.luma(rgb), s, v) for rgb, s, v in data]
    world_level = float(np.median([x for x in levels if x]))
    return [measure(rgb, s, v, lv or world_level) for (rgb, s, v), lv in zip(data, levels)]


if __name__ == '__main__':
    # retail WORLD [kind,kind]    |    ours LABEL stem...
    if sys.argv[1] == 'retail':
        kinds = sys.argv[3].split(',') if len(sys.argv) > 3 else None
        print(fmt(median_table(retail(sys.argv[2], kinds)), f'retail {sys.argv[2]} {kinds or ""}'))
    else:
        print(fmt(median_table(ours(sys.argv[3:])), sys.argv[2]))
