"""Crisp dark marks on slopes (Moon's pitted walls): retail vs renders.

A mark is a connected run of pixels whose luma is below MARK x the 9-px
local median and at least DROP below it in absolute terms: a hard, small
dark speck or dash, not shading or smudge. Per slope bin and facing
(shaded: the ground falls away from the light, which comes from due west on
every retail Lunar map), with luma relative to the image's level ground:

  luma      mean relative luma of the bin
  marks     marks of 1-40 px per 1000 px, by area: 1-2, 3-6, 7-20, 21-40
  cover%    share of the bin's px inside a 1-40 px mark
  depth     mean (1 - luma/local median) over mark px
  aspect    median second-moment axis ratio of marks of 3+ px
  fall°     median angle between a mark's long axis and the fall line
            (0: along the slope, 90: along the contour)
  vert°     median angle between a mark's long axis and the screen vertical

  slope_marks.py retail moon                  the Lunar section catalog
  slope_marks.py pair <repro-dir> [base]      retail.png and ours.png of a repro
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crack_lines as cl  # noqa: E402

MARK, DROP = .6, 20.0
AREAS = [0, 2.5, 6.5, 20.5, 40.5]
BINS = [(.15, .4), (.4, .8), (.8, 99.)]
LIGHT = np.array([-1.0, 0.0])  # toward the light, world x (east) and y (south)


def measure(rgb, cells, shift, valid, ground=None):
    """Per (bin, facing) statistics for one image. cells: heights per 16-px
    cell; shift: rows each cell is drawn above its world row."""
    L = cl.luma(rgb)
    gy, gx = np.gradient(cells.astype(np.float32), 16.0)
    shape = L.shape
    slope = cl.project(cells, np.hypot(gx, gy), shape, shift)
    px = cl.project(cells, gx, shape, shift)
    py = cl.project(cells, gy, shape, shift)
    if ground is None:
        flat = valid & (slope < .05)
        ground = float(np.median(L[flat])) if flat.sum() > 2000 else float(np.median(L[valid]))
    med = ndimage.median_filter(L, 9)
    dark = (L < MARK * med) & (med - L >= DROP)
    lab, n = ndimage.label(dark, structure=np.ones((3, 3)))
    area = np.bincount(lab.ravel(), minlength=n + 1).astype(np.float32)
    small = (area >= 1) & (area <= 40)
    small[0] = False
    inmark = small[lab]
    # Second moments per mark (3+ px) for axis and aspect.
    ys, xs = np.nonzero(lab)
    ids = lab[ys, xs]
    cnt = np.bincount(ids, minlength=n + 1).astype(np.float64)
    sx, sy = np.bincount(ids, xs, n + 1), np.bincount(ids, ys, n + 1)
    sxx, syy, sxy = np.bincount(ids, xs * xs, n + 1), np.bincount(ids, ys * ys, n + 1), np.bincount(ids, xs * ys, n + 1)
    with np.errstate(invalid='ignore', divide='ignore'):
        mx, my = sx / cnt, sy / cnt
        cxx, cyy, cxy = sxx / cnt - mx * mx + 1 / 12, syy / cnt - my * my + 1 / 12, sxy / cnt - mx * my
        tr, det = cxx + cyy, cxx * cyy - cxy * cxy
        l1 = tr / 2 + np.sqrt(np.maximum(tr * tr / 4 - det, 0))
        l2 = tr / 2 - np.sqrt(np.maximum(tr * tr / 4 - det, 0))
        theta = .5 * np.arctan2(2 * cxy, cxx - cyy)  # long axis angle, image x/y
        aspect = np.sqrt(l1 / np.maximum(l2, 1e-6))
    cxi = np.clip(np.nan_to_num(mx).round().astype(int), 0, shape[1] - 1)
    cyi = np.clip(np.nan_to_num(my).round().astype(int), 0, shape[0] - 1)
    rel = L / ground
    out = {}
    # > 0: the ground rises toward the light, so the slope faces away from it.
    facing = px * LIGHT[0] + py * LIGHT[1]
    for (lo, hi) in BINS:
        for side, fm in (('lit', facing <= 0), ('shaded', facing > 0)):
            m = valid & (slope >= lo) & (slope < hi) & fm
            npx = int(m.sum())
            if npx < 2000:
                continue
            mids = np.unique(lab[m & inmark])
            mids = mids[mids > 0]
            # A mark counts in the bin where its centre lies.
            mids = mids[m[cyi[mids], cxi[mids]]]
            hist = np.histogram(area[mids], AREAS)[0] if len(mids) else np.zeros(4)
            big = mids[area[mids] >= 3]
            fall = []
            vert = []
            for k in big:
                ax = np.array([np.cos(theta[k]), np.sin(theta[k])])
                g = np.array([px[cyi[k], cxi[k]], py[cyi[k], cxi[k]]])
                gn = np.hypot(*g)
                if gn > 0:
                    fall.append(np.degrees(np.arccos(min(1, abs(ax @ g) / gn))))
                vert.append(np.degrees(np.arccos(min(1, abs(ax[1])))))
            mk = m & inmark
            out[f'{lo}-{hi} {side}'] = dict(
                px=npx, luma=float(rel[m].mean()),
                marks=(1000. * hist / npx).round(2).tolist(), total=float(1000. * hist.sum() / npx),
                cover=100. * float(mk.sum()) / npx,
                depth=float((1 - L[mk] / np.maximum(med[mk], 1)).mean()) if mk.any() else 0.,
                aspect=float(np.median(aspect[big])) if len(big) else 0.,
                fall=float(np.median(fall)) if fall else 0., vert=float(np.median(vert)) if vert else 0.)
    return out


def pool(rows):
    keys = sorted({k for r in rows for k in r})
    out = {}
    for k in keys:
        rs = [r[k] for r in rows if k in r]
        out[k] = {f: (np.median([r[f] for r in rs], axis=0).round(2).tolist() if f == 'marks' else float(np.median([r[f] for r in rs])))
                  for f in rs[0] if f != 'px'}
        out[k]['px'] = int(sum(r['px'] for r in rs)); out[k]['images'] = len(rs)
    return out


def fmt(table, label):
    rows = [label, '  bin              imgs  luma   marks/1000px(1-2,3-6,7-20,21-40)  total  cover%  depth  aspect fall  vert']
    for k, t in table.items():
        rows.append(f'  {k:16s} {t.get("images", 1):4d}  {t["luma"]:.3f}  {str(t["marks"]):34s} {t["total"]:5.2f}  {t["cover"]:5.2f}  '
                    f'{t["depth"]:.3f}  {t["aspect"]:5.2f}  {t["fall"]:4.0f}  {t["vert"]:4.0f}')
    return '\n'.join(rows)


def ours_input(png, heights, base):
    rgb = np.asarray(Image.open(png).convert('RGB'))
    d = json.load(open(heights))
    g = d['grid']
    h = np.array(d['heights'], np.float32).reshape(g, g)
    k = g // 64
    cells = h.reshape(64, k, 64, k).mean(axis=(1, 3))
    shift = np.round((np.maximum(cells, d['sea']) - base) / 2).astype(np.int32)
    valid = np.ones(rgb.shape[:2], bool)
    return rgb, cells, shift, valid


if __name__ == '__main__':
    if sys.argv[1] == 'retail':
        rows = []
        for name, rgb, cells in cl.catalog_sections(cl.RETAIL[sys.argv[2]][1], cl.RETAIL[sys.argv[2]][2]):
            valid = ~cl.water_colour(rgb)
            rows.append(measure(rgb, cells, (cells.astype(np.int32) // 2), valid))
        print(fmt(pool(rows), f'retail {sys.argv[2]} sections ({len(rows)}), per-image median'))
    else:
        d = Path(sys.argv[2])
        base = float(sys.argv[3]) if len(sys.argv) > 3 else 24
        rgb = np.asarray(Image.open(d / 'retail.png').convert('RGB'))
        cells = np.load(d / 'heights.npy').astype(np.float32)
        print(fmt(measure(rgb, cells, (np.maximum(cells, 0) // 2).astype(np.int32), np.ones(rgb.shape[:2], bool)), 'retail crop'))
        print(fmt(measure(*ours_input(d / 'ours.png', d / 'ours-heights.json', base)), 'ours'))
