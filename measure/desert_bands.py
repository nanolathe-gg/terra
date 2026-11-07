"""Contour bands of Painted Desert: transects up the steepest ascent.

For each unique raised form, transects start on the form's foot (world
height 9) every ~24 px and climb the height gradient in 1-px steps until the
ground levels out. Along each, the band class of the locally averaged colour
(desert_common.classify) is run-length encoded; each run gives a band's
thickness along the slope in px and in height units. Boundary curves between
classes give the warp: how far one visible band edge wanders in TA height.
"""
import sys

import numpy as np
from scipy.ndimage import label

from desert_common import CLASS_NAMES, classify, load, raised_forms, unique_forms, world_view


def form_instances(h, idx, forms):
    """One interior instance of each unique form (copies touching the map
    edge are clipped)."""
    inner = [f for f in forms if f[2] > 0 and f[4] > 0 and f[3] < h.shape[0] - 1 and f[5] < h.shape[1] - 1]
    return unique_forms(h, idx, inner)


def view_of(form, h, idx, pal, smooth=3, margin=2):
    _, _, y0, y1, x0, x1 = form
    Y0, Y1 = max(0, (y0 - margin) * 16), min(h.shape[0] * 16, (y1 + 1 + margin) * 16)
    X0, X1 = max(0, (x0 - margin) * 16), min(h.shape[1] * 16, (x1 + 1 + margin) * 16)
    return world_view(idx, pal, h, Y0, Y1, X0, X1, smooth=smooth)


def transects(H, gx, gy, cls, start=9.0, spacing=24, flat=.3, steps=900):
    """Climb from the foot ring; returns lists of (class, height, slope) per step."""
    ring = (np.abs(H - start) < .5) & (np.hypot(gx, gy) > 1)
    ys, xs = np.nonzero(ring)
    # thin the seeds to about one per `spacing` px
    keep, taken = [], set()
    for y, x in zip(ys, xs):
        k = (y // spacing, x // spacing)
        if k not in taken:
            taken.add(k)
            keep.append((y + .5, x + .5))
    out = []
    for y, x in keep:
        path = []
        for _ in range(steps):
            iy, ix = int(y), int(x)
            if not (0 <= iy < H.shape[0] and 0 <= ix < H.shape[1]):
                break
            sx, sy = gx[iy, ix], gy[iy, ix]
            s = np.hypot(sx, sy)
            path.append((int(cls[iy, ix]), float(H[iy, ix]), float(s)))
            if s < flat:
                break
            y += sy / s
            x += sx / s
        if len(path) > 20:
            out.append(path)
    return out


def runs(path, min_px=2):
    """Run-length encode a transect's classes; runs shorter than min_px join
    the previous run (dither noise)."""
    rs = []
    for c, hh, s in path:
        if rs and rs[-1][0] == c:
            rs[-1][1].append((hh, s))
        else:
            rs.append([c, [(hh, s)]])
    merged = []
    for c, pts in rs:
        if merged and (len(pts) < min_px or merged[-1][0] == c):
            merged[-1][1].extend(pts)
        else:
            merged.append([c, list(pts)])
    out = []
    for c, pts in merged:
        hs = np.array([p[0] for p in pts]); ss = np.array([p[1] for p in pts])
        out.append(dict(cls=c, px=len(pts), h0=float(hs[0]), h1=float(hs[-1]), dh=float(hs[-1] - hs[0]),
                        slope=float(np.median(ss))))
    return out


def boundary_warp(H, cls, s, a, b, min_len=150):
    """Connected boundary curves between classes a and b on slopes; for each,
    its length and the spread (std) of TA height along it."""
    edge = np.zeros(cls.shape, bool)
    for dy, dx in ((0, 1), (1, 0)):
        p = cls[:cls.shape[0] - dy, :cls.shape[1] - dx]
        q = cls[dy:, dx:]
        e = ((p == a) & (q == b)) | ((p == b) & (q == a))
        edge[:cls.shape[0] - dy, :cls.shape[1] - dx] |= e
    edge &= s > 1.5
    lab, n = label(edge, structure=np.ones((3, 3)))
    curves = []
    if n == 0:
        return curves
    sizes = np.bincount(lab.ravel())
    for i in np.nonzero(sizes >= min_len)[0]:
        if i == 0:
            continue
        hv = H[lab == i]
        curves.append(dict(px=int(sizes[i]), h=float(np.median(hv)), std=float(hv.std()),
                           iqr=float(np.subtract(*np.percentile(hv, [75, 25])))))
    return curves


def main(corpus=None):
    m, h, idx, pal = load(corpus) if corpus else load()
    forms, _ = raised_forms(h)
    inst = form_instances(h, idx, forms)
    allruns, allcurves = [], []
    for f in inst:
        a, rgb, H, gx, gy = view_of(f, h, idx, pal)
        cls = classify(rgb)
        s = np.hypot(gx, gy)
        tr = transects(H, gx, gy, cls)
        fr = [runs(p) for p in tr]
        for r in fr:
            for x in r:
                x['form'] = f[0]
            allruns.extend(r)
        cv = []
        for pa, pb in ((1, 2), (1, 3), (2, 3), (0, 1)):
            for c in boundary_warp(H, cls, s, pa, pb):
                c.update(form=f[0], pair=f'{CLASS_NAMES[pa]}/{CLASS_NAMES[pb]}')
                cv.append(c)
        allcurves.extend(cv)
        seqs = [''.join('TOPG'[x['cls']] for x in r) for r in fr]
        print(f'form {f[0]} cells, peak {f[1]}: {len(tr)} transects; e.g. {seqs[0][:60]} | {seqs[len(seqs)//2][:60]}')
    return allruns, allcurves


def report(allruns, allcurves):
    print('\nBand runs on slopes (height 9-60, slope >= 1.5 units/cell, run fully inside):')
    print('class    n   dH median [p25-p75]   px median [p25-p75]  slope u/cell')
    for c, name in enumerate(CLASS_NAMES):
        r = [x for x in allruns if x['cls'] == c and 9.5 < x['h0'] < 60 and x['slope'] >= 1.5 and x['dh'] > 0]
        if not r:
            continue
        dh = np.array([x['dh'] for x in r]); px = np.array([x['px'] for x in r]); sl = np.array([x['slope'] for x in r])
        print(f'{name:7s} {len(r):5d}  {np.median(dh):5.2f} [{np.percentile(dh, 25):4.2f}-{np.percentile(dh, 75):4.2f}]'
              f'      {np.median(px):5.1f} [{np.percentile(px, 25):4.1f}-{np.percentile(px, 75):4.1f}]   {np.median(sl):4.2f}')
    r = [x for x in allruns if 9.5 < x['h0'] < 60 and x['slope'] >= 1.5 and x['dh'] > 0]
    dh = np.array([x['dh'] for x in r])
    print(f'all      {len(r):5d}  {np.median(dh):5.2f} [{np.percentile(dh, 25):4.2f}-{np.percentile(dh, 75):4.2f}]')
    # transitions
    T = np.zeros((4, 4))
    for a, b in zip(allruns[:-1], allruns[1:]):
        if a.get('form') == b.get('form') and b['h0'] >= a['h0'] - .5 and 9.5 < a['h0'] < 60:
            T[a['cls'], b['cls']] += 1
    print('\nUpward class transitions (row -> column), counts:')
    print('        ' + ' '.join(f'{n:>7s}' for n in CLASS_NAMES))
    for i, n in enumerate(CLASS_NAMES):
        print(f'{n:7s} ' + ' '.join(f'{int(v):7d}' for v in T[i]))
    print('\nBoundary curves (>= 150 px) : TA-height spread along one visible band edge')
    for pair in sorted({c['pair'] for c in allcurves}):
        cs = [c for c in allcurves if c['pair'] == pair]
        std = np.array([c['std'] for c in cs]); iqr = np.array([c['iqr'] for c in cs]); px = np.array([c['px'] for c in cs])
        print(f'{pair:12s} curves {len(cs):4d}  length median {np.median(px):6.0f} px  height std median {np.median(std):5.2f}'
              f' [p25 {np.percentile(std, 25):4.2f}, p75 {np.percentile(std, 75):4.2f}]  IQR median {np.median(iqr):4.2f}')


if __name__ == '__main__':
    report(*main(sys.argv[1] if len(sys.argv) > 1 else None))
