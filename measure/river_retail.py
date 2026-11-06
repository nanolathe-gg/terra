"""Retail TA rivers at the game's scale: width, sinuosity, how far a course strays from its chord, and its bends (the riverfix card).
  river_retail.py [<R>]     R: the folder holding the retail exports (retail-<world>/<map>/heights.bin and metadata.json);
                            default /private/tmp/nanolathe-map-editor
Per map, water is height < sea on the 16-px height grid (bodies of 400 cells and more, islands under 120 cells filled, closed and opened twice and once,
padded past the map edge so the edge is no bank). Its medial axis (Zhang-Suen thinning) is walked by the shortest path between each pair of places it leaves
the map; a course is smoothed over .35 of its width. Width is twice the distance to the bank along the axis (median, in px). Over windows of 4 and 8 widths of
arc: the arc over the chord (sinuosity) and the farthest the course stands from the chord (in widths). Bends: inflections of the course smoothed over half a
width where the heading has turned 15 degrees or more since the last; wavelength is twice their median spacing and amplitude the median of each half bend's
farthest point from the chord between its inflections, both in widths. measure/river_band.mjs takes the same numbers on our River preset.
Only numbers are printed; no retail pixels or heights are written.

The table (2026-11-06; * a course that turns through a confluence or a crossing, so its window numbers are high; red river and red river north leave the map
by two exits at their north end, one row each):
  map                         width px  sin4   sin8   off8 med/p90 W  bend wavelength W  bend amplitude W
  evad river confluence *     528       1.068  1.129  1.37 / 1.50     2.2                .18
  evad river confluence *     544       1.142  1.259  1.25 / 2.01     3.1                .34
  evad river confluence *     512       1.089  1.288  1.80 / 2.24     2.3                .18
  red river                   831       1.083  1.118  1.07 / 1.62     4.1                .45
  red river north             1014      1.171  1.190  1.60 / 1.61     4.7                .56
  canal crossing *            982       1.218  1.567  2.97 / 2.99     6.0                .89
  canal crossing *            988       1.168  1.278  2.41 / 2.41     3.0                .11
  canal crossing              932       1.034  1.034  0.39 / 0.40     5.8                .24
  pc games' evad river delta  601       1.061  1.139  1.21 / 1.85     2.4                .12
  pc games' evad river delta  702       1.131  1.203  1.53 / 1.75     3.7                .34
  pc games' evad river delta  731       1.084  1.094  0.91 / 2.12     5.0                .47
Retail rivers are 510 to 1010 px wide (the River preset's channel is 48): what carries over to a narrow river is the shape in widths. The courses that do not
turn through a junction: sinuosity over 8 widths 1.03 to 1.20 (median 1.12), straying 0.4 to 1.6 widths from the chord (p90 up to 2.1). Retail's bends are
short (2 to 6 widths) and shallow (a tenth to a half of a width): bank jogs of a very wide channel, not meander loops; no retail river closes a loop or leaves
an oxbow."""
import heapq, json, sys
from pathlib import Path
import numpy as np
from scipy import ndimage as nd

CELL = 16
MAPS = [('retail-green', 'evad river confluence'), ('retail-red', 'red river'), ('retail-red', 'red river north'), ('retail-archipelago', 'canal crossing'),
        ('retail-green', "pc games' evad river delta")]
OFF = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

def thin(img):
    """Zhang-Suen thinning of a 0/1 image."""
    img = img.copy().astype(np.uint8)
    while True:
        changed = False
        for step in (0, 1):
            p = np.pad(img, 1)
            n = [p[:-2, 1:-1], p[:-2, 2:], p[1:-1, 2:], p[2:, 2:], p[2:, 1:-1], p[2:, :-2], p[1:-1, :-2], p[:-2, :-2]]
            B = sum(x.astype(int) for x in n); seq = n + [n[0]]
            A = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(int) for i in range(8))
            P2, P3, P4, P5, P6, P7, P8, P9 = n
            c = ((P2 * P4 * P6 == 0) & (P4 * P6 * P8 == 0)) if step == 0 else ((P2 * P4 * P8 == 0) & (P2 * P6 * P8 == 0))
            m = (img == 1) & (B >= 2) & (B <= 6) & (A == 1) & c
            if m.any(): img[m] = 0; changed = True
        if not changed: return img

def water(h, sea, P=40):
    wet = np.pad(h < sea, P, mode='edge')
    lab, n = nd.label(wet); sizes = nd.sum(wet, lab, range(1, n + 1))
    keep = np.isin(lab, 1 + np.nonzero(sizes >= 400)[0])
    holes = nd.binary_fill_holes(keep) & ~keep; hl, hn = nd.label(holes); hs = nd.sum(holes, hl, range(1, hn + 1))
    mask = keep | np.isin(hl, 1 + np.nonzero(hs < 120)[0])
    return nd.binary_opening(nd.binary_closing(mask, iterations=2), iterations=1), P

def shortest(pts, a, b):
    dist = {a: 0.0}; prev = {}; q = [(0.0, a)]
    while q:
        d, p = heapq.heappop(q)
        if p == b: break
        if d > dist.get(p, 1e18): continue
        for dy, dx in OFF:
            r = (p[0] + dy, p[1] + dx)
            if r in pts and d + (1.4142 if dy and dx else 1.0) < dist.get(r, 1e18): dist[r] = d + (1.4142 if dy and dx else 1.0); prev[r] = p; heapq.heappush(q, (dist[r], r))
    if b not in dist: return None
    path = [b]
    while path[-1] != a: path.append(prev[path[-1]])
    return path[::-1]

def smooth(xy, s): return np.stack([nd.gaussian_filter1d(xy[:, k], s, mode='nearest') for k in (0, 1)], 1)
def arc(s): return np.concatenate([[0], np.cumsum(np.hypot(*np.diff(s, axis=0).T))])
def offsets(seg):
    c = seg[-1] - seg[0]; cl = np.hypot(*c)
    return np.abs((seg[:, 0] - seg[0, 0]) * c[1] - (seg[:, 1] - seg[0, 1]) * c[0]) / max(cl, 1e-9), cl

def course_stats(s, width):
    """Window and bend statistics of a course s (N x 2 px, smoothed), in widths. Shared definitions with measure/river_band.mjs."""
    cum = arc(s); out = {}
    for k in (4, 8):
        sins, offs = [], []
        for i in range(0, len(s), max(1, len(s) // 400)):
            j = np.searchsorted(cum, cum[i] + k * width)
            if j >= len(s): break
            o, cl = offsets(s[i:j + 1])
            if cl > 1e-6: sins.append((cum[j] - cum[i]) / cl); offs.append(o.max() / width)
        out[f'sin{k}'] = round(float(np.median(sins)), 3) if sins else None
        if k == 8: out['off8'] = round(float(np.median(offs)), 2) if offs else None; out['off8_p90'] = round(float(np.percentile(offs, 90)), 2) if offs else None
    t = np.gradient(s, axis=0); th = np.unwrap(np.arctan2(t[:, 1], t[:, 0])); ds = float(np.median(np.diff(cum)))
    kap = nd.gaussian_filter1d(np.gradient(th) / ds, max(1.0, 0.5 * width / ds))
    keep = [0]
    for z in np.nonzero(np.sign(kap[1:]) != np.sign(kap[:-1]))[0]:
        if abs(th[z] - th[keep[-1]]) > np.radians(15): keep.append(z)
    keep = keep[1:]
    if len(keep) >= 3:
        out['wavelength'] = round(2 * float(np.median(np.diff(cum[keep]))) / width, 1)
        out['amplitude'] = round(float(np.median([offsets(s[a:b + 1])[0].max() for a, b in zip(keep, keep[1:])])) / width, 2)
    else: out['wavelength'] = out['amplitude'] = None
    return out

def measure(d):
    meta = json.load(open(d / 'metadata.json')); W, H = meta['cell_width'], meta['cell_height']
    h = np.fromfile(d / 'heights.bin', dtype=np.uint8)[:W * H].reshape(H, W)
    mp, P = water(h, meta['sea_level'])
    dist = nd.distance_transform_edt(mp)[P:-P, P:-P]
    sk = thin(mp)[P:-P, P:-P]; pts = set(zip(*[a.tolist() for a in np.nonzero(sk)]))
    exits = []
    for p in sorted(p for p in pts if p[0] <= 2 or p[1] <= 2 or p[0] >= H - 3 or p[1] >= W - 3):
        if all(abs(e[0] - p[0]) + abs(e[1] - p[1]) >= 30 for e in exits): exits.append(p)
    rows = []
    for i in range(len(exits)):
        for j in range(i + 1, len(exits)):
            path = shortest(pts, exits[i], exits[j])
            if not path or len(path) < 20: continue
            a = np.array(path, float)[:, ::-1] * CELL + CELL / 2
            width = float(np.median(2 * dist[tuple(np.array(path).T)] * CELL))
            s = smooth(a, max(1.0, 0.35 * width / CELL))
            if arc(s)[-1] < 8 * width: continue
            rows.append(dict(map=meta['name'], exits=[[int(v) for v in a[0]], [int(v) for v in a[-1]]], length_px=round(float(arc(s)[-1])), width_px=round(width), **course_stats(s, width)))
    return rows

if __name__ == '__main__':
    root = Path(sys.argv[1] if len(sys.argv) > 1 else '/private/tmp/nanolathe-map-editor')
    for world, name in MAPS:
        for d in sorted((root / world).glob('*/metadata.json')):
            if json.load(open(d))['name'] == name:
                for r in measure(d.parent): print(json.dumps(r))
