"""Gaps between the orange (warm) lines on the lit flanks of retail raised ground,
in height units and in px: how thick the beds are above the aprons (card E8).

  desert_strata_gaps.py [export-dir ...]

Lit (west-facing) flanks only, slope above 0.5 units per px, luma above 70, so
the shaded sides do not hide lines. A warm run is 3x3-averaged R-B above 25;
a gap is the distance between the centres of two consecutive runs on one row.
Painted Desert: median 10.8 units above 70 (14 px), 8.1 from 20 up. The Desert
Triad: median 15 above 60 (14 px), 11.9 from 20 up; run width ~4.4 units.
"""
import sys

import numpy as np
from scipy.ndimage import label

import desert_common as dc

MAPS = ['/private/tmp/nanolathe-map-editor/retail-desert/the_desert_triad-0e1a7587',
        '/private/tmp/nanolathe-map-editor/retail-desert/painted_desert-e2c3dad3']


def gaps(corpus, hmin, tag):
    m, h, idx, pal = dc.load(corpus)
    forms, _ = dc.raised_forms(h, threshold=hmin, min_cells=20)
    gap_h, gap_px, width_h = [], [], []
    for _, _, ya, yb, xa, xb in forms[:40]:
        y0, y1 = max(0, ya - 1) * 16, min(h.shape[0], yb + 2) * 16
        x0, x1 = max(0, xa - 1) * 16, min(h.shape[1], xb + 2) * 16
        a, rgb, H, gx, gy = dc.world_view(idx, pal, h, y0, y1, x0, x1, smooth=3)
        warm = rgb[..., 0] - rgb[..., 2]
        luma = rgb @ np.array([.299, .587, .114])
        s = np.hypot(gx, gy) / 16
        for r in range(0, H.shape[0], 6):
            ok = (H[r] > hmin) & (gx[r] > 0.6 * np.maximum(s[r] * 16, 1e-6)) & (s[r] > 0.5) & (luma[r] > 70)
            lab, n = label(ok)
            for i in range(1, n + 1):
                seg = np.nonzero(lab == i)[0]
                if len(seg) < 40:
                    continue
                d = np.diff(np.concatenate([[0], (warm[r, seg] > 25).astype(int), [0]]))
                runs = [(p, q) for p, q in zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]) if q - p >= 2]
                for p, q in runs:
                    width_h.append(abs(H[r, seg[min(q, len(seg) - 1)]] - H[r, seg[p]]))
                for (a1, b1), (a2, b2) in zip(runs[:-1], runs[1:]):
                    c1, c2 = (a1 + b1) // 2, (a2 + b2) // 2
                    gap_h.append(abs(H[r, seg[c2]] - H[r, seg[c1]]))
                    gap_px.append(c2 - c1)
    q = [10, 25, 50, 75, 90]
    print(f'{tag}: {len(gap_h)} gaps; height units {np.percentile(gap_h, q).round(1)}; px {np.percentile(gap_px, q).round(1)}; '
          f'run width (units) pct 25/50/75 {np.percentile(width_h, [25, 50, 75]).round(1)}')


if __name__ == '__main__':
    for corpus in sys.argv[1:] or MAPS:
        for hmin in (60, 20):
            gaps(corpus, hmin, f'{corpus.rsplit("/", 1)[-1]} above {hmin}')
