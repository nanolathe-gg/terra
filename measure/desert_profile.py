"""Painted Desert band profile details: class share by facing, periodicity of
the band sequence with height, edge sharpness and fine warp.

Uses desert_bands.py's transects and desert_common.classify's three classes.
"""
import numpy as np
from scipy.ndimage import gaussian_filter

import desert_bands as db
import desert_common as dc


classify3 = dc.classify


def main():
    m, h, idx, pal = dc.load()
    forms, _ = dc.raised_forms(h)
    inst = db.form_instances(h, idx, forms)
    facing = {k: np.zeros(4) for k in ('west', 'east', 'north', 'south')}
    spec, nspec = 0, 0
    edge_prof = {}
    fine = []
    for f in inst:
        a, rgb, H, gx, gy = db.view_of(f, h, idx, pal, smooth=3)
        _, raw, _, _, _ = db.view_of(f, h, idx, pal, smooth=1)
        cls = classify3(rgb)
        s = np.hypot(gx, gy)
        band = (H > 9) & (H < 60) & (s > 1.5)
        # facing: gradient points uphill; a west-facing slope rises to the east (gx > 0)
        for k, sel in (('west', gx > .7 * s), ('east', gx < -.7 * s), ('north', gy > .7 * s), ('south', gy < -.7 * s)):
            facing[k] += np.bincount(cls[band & sel], minlength=4)
        # periodicity: orange indicator against height along transects
        for path in db.transects(H, gx, gy, cls):
            hs = np.array([p[1] for p in path]); cs = np.array([p[0] for p in path])
            if hs[-1] - hs[0] < 24:
                continue
            grid = np.arange(hs[0], hs[-1], .25)
            o = np.interp(grid, np.maximum.accumulate(hs), (cs == 1).astype(float))
            o = o[:192] - o[:192].mean()
            if len(o) < 192:
                continue
            spec = spec + np.abs(np.fft.rfft(o * np.hanning(192))) ** 2
            nspec += 1
        # edge profiles: luma and warmth along the gradient, centred on
        # orange->pale and orange->gray crossings (unsmoothed pixels)
        warm = raw[..., 0] - raw[..., 2]
        luma = raw @ dc.LUMA
        for path_pts in transects_xy(H, gx, gy):
            cl = [cls[int(y), int(x)] for y, x in path_pts]
            for i in range(8, len(cl) - 8):
                if cl[i - 1] == 1 and cl[i] in (2, 3) and all(c == 1 for c in cl[i - 4:i]) and all(c == cl[i] for c in cl[i:i + 3]):
                    key = 'orange->' + ('pale' if cl[i] == 2 else 'gray')
                    seg = [(warm[int(y), int(x)], luma[int(y), int(x)]) for y, x in path_pts[i - 8:i + 8]]
                    edge_prof.setdefault(key, []).append(seg)
        # fine warp: residual of boundary height about a smooth (sigma 24 px) trend
        e = np.zeros(cls.shape, bool)
        e[:, :-1] |= (cls[:, :-1] == 1) & (cls[:, 1:] == 2) | (cls[:, :-1] == 2) & (cls[:, 1:] == 1)
        e[:-1, :] |= (cls[:-1, :] == 1) & (cls[1:, :] == 2) | (cls[:-1, :] == 2) & (cls[1:, :] == 1)
        e &= band
        w = gaussian_filter(e.astype(float), 24)
        hw = gaussian_filter(np.where(e, H, 0.0), 24) / np.maximum(w, 1e-6)
        r = (H - hw)[e & (w > .002)]
        fine.append(r)
    print('Class share on slopes 9-60 by facing (orange / pale / gray %):')
    for k, v in facing.items():
        v = v[1:] / v[1:].sum() * 100
        print(f'  {k:5s} {v[0]:5.1f} {v[1]:5.1f} {v[2]:5.1f}')
    freqs = np.fft.rfftfreq(192, .25)
    sp = spec / max(nspec, 1)
    top = np.argsort(-sp[2:])[:5] + 2
    print(f'\nOrange-band spectrum over {nspec} transects (48 height units each): strongest periods (units):',
          [(round(1 / freqs[i], 2), round(float(sp[i] / sp[2:].mean()), 2)) for i in top])
    print('  spectrum (period: relative power):', ' '.join(f'{1/freqs[i]:.1f}:{sp[i]/sp[2:].mean():.2f}' for i in range(2, 40, 2)))
    for key, segs in edge_prof.items():
        a = np.array(segs, float)
        wm, lm = a[..., 0].mean(0), a[..., 1].mean(0)
        lo, hi = wm[:4].mean(), wm[-4:].mean()
        t = (wm - lo) / (hi - lo)
        inside = np.nonzero((t > .1) & (t < .9))[0]
        print(f'\n{key}: {len(segs)} crossings; warmth profile (px -8..7):', ' '.join(f'{v:.0f}' for v in wm))
        print('   luma profile:', ' '.join(f'{v:.0f}' for v in lm), f'  10-90% width ~{len(inside)} px')
    r = np.concatenate(fine)
    print(f'\nFine warp: orange/pale edge height about its 24-px trend: std {r.std():.2f}, MAD {np.median(np.abs(r - np.median(r))):.2f} units')


def transects_xy(H, gx, gy, start=9.0, spacing=24, flat=.3, steps=900):
    ring = (np.abs(H - start) < .5) & (np.hypot(gx, gy) > 1)
    ys, xs = np.nonzero(ring)
    taken, out = set(), []
    for y, x in zip(ys, xs):
        k = (y // spacing, x // spacing)
        if k in taken:
            continue
        taken.add(k)
        y, x = y + .5, x + .5
        pts = []
        for _ in range(steps):
            iy, ix = int(y), int(x)
            if not (0 <= iy < H.shape[0] and 0 <= ix < H.shape[1]):
                break
            s = np.hypot(gx[iy, ix], gy[iy, ix])
            pts.append((y, x))
            if s < flat:
                break
            y += gy[iy, ix] / s
            x += gx[iy, ix] / s
        if len(pts) > 20:
            out.append(pts)
    return out


if __name__ == '__main__':
    main()
