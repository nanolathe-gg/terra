"""Dark lines, shading and slope forms on Painted Desert's raised ground.

Dark pixels are palette entries with luma < 90. Connected dark clusters of
at least 6 px are measured for width (minor axis) and orientation against
the local contour (0 deg = along the contour, 90 = down the slope). Also:
luma of the orange and cool band classes on west- and east-facing slopes,
and cell-slope distribution on raised forms.
"""
import numpy as np
from scipy.ndimage import label

import desert_bands as db
import desert_common as dc
from desert_common import classify as classify3


def main():
    m, h, idx, pal = dc.load()
    pl = pal.astype(np.float32) @ dc.LUMA
    forms, _ = dc.raised_forms(h)
    inst = db.form_instances(h, idx, forms)
    dark_share = {'west': [0, 0], 'east': [0, 0], 'plain': [0, 0]}
    widths, angles, lengths = [], [], []
    shade = {}
    for f in inst:
        a, rgb, H, gx, gy = db.view_of(f, h, idx, pal, smooth=3)
        s = np.hypot(gx, gy)
        lum = pl[a]
        dark = lum < 90
        band = (H > 9) & (H < 60) & (s > 1.5)
        for k, sel in (('west', band & (gx > .7 * s)), ('east', band & (gx < -.7 * s))):
            dark_share[k][0] += int(dark[sel].sum()); dark_share[k][1] += int(sel.sum())
        cls = classify3(rgb)
        for k, sel in (('west', band & (gx > .7 * s)), ('east', band & (gx < -.7 * s))):
            for c, name in ((1, 'orange'), (2, 'pale'), (3, 'gray'), (None, 'cool (pale+gray)')):
                mk = sel & ((cls == c) if c else (cls >= 2))
                shade[(name, k)] = shade.get((name, k), []) + [rgb[mk] @ dc.LUMA]
        lab, n = label(dark & band, structure=np.ones((3, 3)))
        if n == 0:
            continue
        sizes = np.bincount(lab.ravel())
        for i in np.nonzero(sizes >= 6)[0]:
            if i == 0:
                continue
            ys, xs = np.nonzero(lab == i)
            cy, cx = ys.mean(), xs.mean()
            cov = np.cov(np.vstack([xs - cx, ys - cy]))
            ev, evec = np.linalg.eigh(cov)
            major = evec[:, 1]
            gxm, gym = gx[ys, xs].mean(), gy[ys, xs].mean()
            gn = np.hypot(gxm, gym)
            if gn < 1e-3:
                continue
            cosang = abs(major[0] * gxm / gn + major[1] * gym / gn)
            angles.append(np.degrees(np.arcsin(min(1.0, cosang))))  # 0 = along contour, 90 = downslope
            widths.append(4 * np.sqrt(max(ev[0], 0)))
            lengths.append(4 * np.sqrt(max(ev[1], 0)))
    a = np.asarray(idx[1000:3000, 3000:5000])
    dark_share['plain'] = [int((pl[a] < 90).sum()), a.size]
    print('Dark-pixel share (palette luma < 90):')
    for k, (d, n) in dark_share.items():
        print(f'  {k:6s} {100 * d / max(n, 1):5.2f}%')
    widths, angles, lengths = map(np.array, (widths, angles, lengths))
    print(f'Dark clusters >= 6 px on band slopes: {len(widths)}; width (2 sigma minor) median {np.median(widths):.1f} px'
          f' [p25 {np.percentile(widths, 25):.1f}, p75 {np.percentile(widths, 75):.1f}]; length median {np.median(lengths):.1f} px'
          f' [p75 {np.percentile(lengths, 75):.1f}, p95 {np.percentile(lengths, 95):.1f}]')
    elong = lengths > 2 * widths
    print(f'  elongated (length > 2 width): {100 * elong.mean():.0f}%; of those along the contour (< 30 deg) {100 * (angles[elong] < 30).mean():.0f}%,'
          f' down the slope (> 60 deg) {100 * (angles[elong] > 60).mean():.0f}%')
    print('Band luma by facing (3x3 mean colour):')
    for name in ('orange', 'pale', 'gray', 'cool (pale+gray)'):
        w = np.concatenate(shade[(name, 'west')]); e = np.concatenate(shade[(name, 'east')])
        print(f'  {name:16s} west {np.median(w):6.1f}  east {np.median(e):6.1f}  ratio east/west {np.median(e) / np.median(w):.2f}')
    # slope distribution on raised forms (cells), per unique form
    print('Cell slope on raised forms (units per 16-px cell, central differences):')
    allg = []
    for f in inst:
        _, peak, y0, y1, x0, x1 = f
        sub = h[max(0, y0 - 1):y1 + 2, max(0, x0 - 1):x1 + 2].astype(float)
        gy, gx = np.gradient(sub)
        g = np.hypot(gx, gy)[sub > 8]
        allg.append(g)
        print(f'  form {f[0]:5d} cells peak {peak:3d}: median {np.median(g):.2f}, p90 {np.percentile(g, 90):.2f}, p99 {np.percentile(g, 99):.2f}, '
              f'share > 8: {100 * (g > 8).mean():.1f}%')
    g = np.concatenate(allg)
    bins = [0, .5, 1, 2, 3, 4, 6, 8, 12, 16, 99]
    c, _ = np.histogram(g, bins)
    print('  all: ' + ', '.join(f'{bins[i]}-{bins[i + 1]}: {100 * c[i] / c.sum():.1f}%' for i in range(len(c))))


if __name__ == '__main__':
    main()
