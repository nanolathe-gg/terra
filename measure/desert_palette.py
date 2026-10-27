"""Palette indices of Painted Desert by ground kind, and the band share of
orange against height.

Ground kinds (world space, TA projection): plain (height <= 8, away from
raised forms); band slopes (9-60, slope >= 1.5 units per cell) split into
west-facing (lit) and east-facing (shaded); mesa tops (>= 60, 3x3 cells
equal); upper rock (> 72, slope >= 1.5).
"""
import sys

import numpy as np
from scipy.ndimage import binary_dilation, maximum_filter, minimum_filter

import desert_common as dc


def main(corpus=None):
    m, h, idx, pal = dc.load(corpus) if corpus else dc.load()
    levelcell = maximum_filter(h, 3) == minimum_filter(h, 3)
    near_form = binary_dilation(h > 12, iterations=3)
    kinds = ['plain', 'band slope west (lit)', 'band slope east (shaded)', 'mesa top (level, >= 60)',
             'upper rock (> 72)', 'band level (9-59, level)']
    hist = np.zeros((len(kinds), 256))
    NB = 36
    orange = np.zeros((2, NB)); total = np.zeros((2, NB))
    for y0 in range(0, m['height'], 512):
        y1 = min(m['height'], y0 + 512)
        a, rgb, H, gx, gy = dc.world_view(idx, pal, h, y0, y1, 0, m['width'], smooth=3)
        s = np.hypot(gx, gy)
        cy = np.minimum(np.arange(y0, y1) // 16, h.shape[0] - 1)[:, None]
        cx = np.minimum(np.arange(m['width']) // 16, h.shape[1] - 1)[None, :]
        lev = levelcell[cy, cx]
        nf = near_form[cy, cx]
        sel = [
            (H <= 8) & ~nf,
            (H > 9) & (H < 60) & (s >= 1.5) & (gx > .7 * s),
            (H > 9) & (H < 60) & (s >= 1.5) & (gx < -.7 * s),
            (H >= 60) & lev,
            (H > 72) & (s >= 1.5),
            (H > 9) & (H < 59) & lev,
        ]
        for k, mk in enumerate(sel):
            hist[k] += np.bincount(a[mk], minlength=256)
        warm = rgb[..., 0] - rgb[..., 2]
        hb = np.clip((H / 4).astype(int), 0, NB - 1)
        for j, mk in enumerate(((s >= 1.5) & (gx > .7 * s) & nf, lev & nf)):
            orange[j] += np.bincount(hb[mk], weights=(warm[mk] >= 40).astype(float), minlength=NB)
            total[j] += np.bincount(hb[mk], minlength=NB)
    for k, name in enumerate(kinds):
        c = hist[k]
        n = c.sum()
        o = np.argsort(-c)[:12]
        mean = (c[:, None] * pal.astype(float)).sum(0) / max(n, 1)
        print(f'\n{name}: {int(n)} px, mean RGB {tuple(int(v) for v in mean)}')
        print('  ' + ', '.join(f'{i} {tuple(int(v) for v in pal[i])} {100 * c[i] / n:.1f}%' for i in o))
    print('\nShare of orange (local warmth R-B >= 40) by height, near raised forms:')
    print('  height   west slopes   level ground')
    for b in range(NB):
        if total[0, b] + total[1, b] < 500:
            continue
        w = f'{100 * orange[0, b] / total[0, b]:5.1f}% ({int(total[0, b])})' if total[0, b] > 300 else '      -'
        l = f'{100 * orange[1, b] / total[1, b]:5.1f}% ({int(total[1, b])})' if total[1, b] > 300 else '      -'
        print(f'  {b * 4:3d}-{b * 4 + 3:<3d}  {w:>20s}  {l:>20s}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)
