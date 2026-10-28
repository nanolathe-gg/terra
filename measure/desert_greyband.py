"""The neutral grey band at the foot of retail Painted Desert's raised ground (card E8).

  desert_greyband.py [export-dir]

Grey pixels: 5x5-averaged colour with R-B under 14 and luma 85-145 (the plain's
dithered speckle uses the same palette greys, so single entries do not work).
Prints the share of grey by world height (whole units), the mean colour and the
ribbon width (twice the largest distance-transform value of each component of
150+ px below height 40), and the slope of the grey ground against all ground
at height 8.5-12.5. Result on Painted Desert: the share peaks at height 10-11
(6.6% and 5.9%, against 0.04% on the plain at 2-4), mean RGB (118, 115, 112),
ribbons 9 px wide (10th-90th percentile 6-13), on gentler ground than average
(median 2.4 units per cell against 3.6).
"""
import sys

import numpy as np
from scipy import ndimage as ndi

import desert_common as dc


def main(corpus=None):
    m, h, idx, pal = dc.load(corpus) if corpus else dc.load()
    nb = 24
    grey, tot = np.zeros(nb), np.zeros(nb)
    colours, widths, slope_grey, slope_all = [], [], [], []
    for y0 in range(0, m['height'], 512):
        y1 = min(m['height'], y0 + 512)
        a, rgb, H, gx, gy = dc.world_view(idx, pal, h, y0, y1, 0, m['width'], smooth=5)
        luma = rgb @ np.array([.299, .587, .114])
        g = (rgb[..., 0] - rgb[..., 2] < 14) & (luma > 85) & (luma < 145)
        hb = np.clip(np.floor(H).astype(int), 0, nb - 1)
        grey += np.bincount(hb[g], minlength=nb)
        tot += np.bincount(hb.ravel(), minlength=nb)
        low = g & (H < 40)
        colours.append(rgb[low][::40])
        dt = ndi.distance_transform_edt(low)
        lab, n = ndi.label(low)
        if n:
            size = ndi.sum(np.ones_like(dt), lab, index=np.arange(1, n + 1))
            widest = ndi.maximum(dt, lab, index=np.arange(1, n + 1))
            widths += [2 * w for s, w in zip(size, widest) if s > 150]
        band = (H >= 8.5) & (H < 12.5)
        s = np.hypot(gx, gy)
        slope_grey.append(s[band & g][::5])
        slope_all.append(s[band][::50])
    print('height  grey share')
    for b in range(nb):
        print(f'{b:5d}  {100 * grey[b] / max(tot[b], 1):5.2f}%')
    print('mean RGB of grey below height 40:', np.concatenate(colours).mean(0).round(0))
    print('ribbon width px, pct 10/50/90:', np.percentile(widths, [10, 50, 90]).round(1))
    print('slope (units per cell) pct 10/50/90, grey:', np.percentile(np.concatenate(slope_grey), [10, 50, 90]).round(1),
          'all:', np.percentile(np.concatenate(slope_all), [10, 50, 90]).round(1))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)
