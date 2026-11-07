"""Retail Moon: how far small craters sit from the big crater they gather round (card lfimpact2; docs/IMPACT_RETAIL.md).

  python measure/crater_secondaries.py [depth units, default 6]

Reads the twelve retail Moon maps' 16-px heights under $R/retail-moon (R=/private/tmp/nanolathe-map-editor). Big craters are crater_rings.py's (rim
diameter 150 px or more); small craters are bowls: a cell lower than its eight neighbours and `depth` or more units under the median of the cells 2 to 3
cells away, outside every big crater's rim. Each small crater and each cell belongs to the big crater it is nearest to in that crater's rim radii, so the
annuli do not overlap; the density of small craters per annulus (per 1000 cells) against the density 3 to 5 rim radii out shows where they gather
beyond the scattered background. Then the three repro windows (repro-r7 moon-1..3): the small crater strokes the scenes place on retail's small craters,
in rim radii (.305 of the stroke's Diameter, the lfCrater section's rim) from the nearest big crater stroke. Prints numbers only.
"""
import json, math, os, sys
import numpy as np
from scipy import ndimage as ndi
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crater_rings as cr
R = '/private/tmp/nanolathe-map-editor'
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANDS = [(1.0, 1.5), (1.5, 2.0), (2.0, 2.5), (2.5, 3.0), (3.0, 4.0), (4.0, 5.0)]
DEPTH = float(sys.argv[1]) if len(sys.argv) > 1 else 6.0

def bowls(h, depth):
    yy, xx = np.mgrid[-3:4, -3:4]; ring = (np.hypot(yy, xx) >= 1.9) & (np.hypot(yy, xx) <= 3.2); out = []
    for y in range(3, h.shape[0] - 3):
        for x in range(3, h.shape[1] - 3):
            c = h[y, x]; nb = h[y - 1:y + 2, x - 1:x + 2]
            if c > nb.min() or (nb == c).sum() > 1: continue
            if np.median(h[y - 3:y + 4, x - 3:x + 4][ring]) - c >= depth: out.append((x * 16 + 8, y * 16 + 8))
    return out

def big_craters(hm):
    sm = ndi.gaussian_filter(hm, 1.0); ground = ndi.median_filter(hm, size=31)
    lab, n = ndi.label(sm < ground - 3); out = []
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        if len(ys) < 5: continue
        r = cr.measure(hm, ys.mean(), xs.mean(), math.sqrt(len(ys) / math.pi))
        if r and r['D'] >= 150 and r['rim'] >= 2 and r['depth'] >= 4 and r['cv'] <= 0.3: out.append((xs.mean() * 16 + 8, ys.mean() * 16 + 8, r['R'] * 16))
    return out

def main():
    n, cells, us, nbig = [0] * len(BANDS), [0] * len(BANDS), [], 0
    root = R + '/retail-moon'
    for d in sorted(os.listdir(root)):
        if not os.path.isdir(os.path.join(root, d)): continue
        m, hm = cr.load(root, d); big = big_craters(hm); nbig += len(big)
        if not big: continue
        yy, xx = np.mgrid[0:hm.shape[0], 0:hm.shape[1]]
        near = np.min([np.hypot(xx * 16 + 8 - x, yy * 16 + 8 - y) / Rp for x, y, Rp in big], axis=0)
        for i, (a, b) in enumerate(BANDS): cells[i] += int(((near >= a) & (near < b)).sum())
        for x, y in bowls(hm, DEPTH):
            u = min(math.hypot(x - bx, y - by) / Rp for bx, by, Rp in big)
            if u < 1.0: continue
            us.append(u)
            for i, (a, b) in enumerate(BANDS):
                if a <= u < b: n[i] += 1
    bg = (n[4] + n[5]) / max(cells[4] + cells[5], 1)
    print(f'Twelve retail Moon maps: {nbig} big craters (rim diameter 150 px or more); small craters {DEPTH:.0f}+ units deep, outside the rims:')
    for (a, b), k, c in zip(BANDS, n, cells): print(f'  {a:3.1f}-{b:3.1f} R: {k:4d} in {c:6d} cells, {k / max(c, 1) * 1000:5.2f} per 1000 cells, {k / max(c, 1) / max(bg, 1e-9):4.2f} x the density 3-5 R out')
    u = np.array([v for v in us if v < 2.0])
    print(f'  within 2 R: {len(u)}, median {np.median(u):.2f} R (p25 {np.percentile(u, 25):.2f}, p75 {np.percentile(u, 75):.2f})')
    print('The repro windows: the small crater strokes beside a big one (within 2 rim radii of it):')
    for w in ['moon-1', 'moon-2', 'moon-3']:
        sc = json.load(open(f'{REPO}/repro/scenes/{w}.json'))
        cr_ = [(st[1][-1][0], st[1][-1][1], st[2]['card']['diameter']) for st in sc['strokes'] if st[2].get('card', {}).get('curve', {}).get('form') == 'lfCrater' and len(st[1]) == 1]
        for x, y, D in cr_:
            for bx, by, BD in cr_:
                if BD >= 2.5 * D and math.hypot(x - bx, y - by) < 2 * .305 * BD: print(f'  {w}: a {D} px crater {math.hypot(x - bx, y - by) / (.305 * BD):.2f} R from the {BD} px one')

if __name__ == '__main__':
    main()
