"""H15 step D: what retail's slopes look like, world by world, and the knots that fit them.

    python measure/fit_forms.py <world> [--root R] [--bins 30,80] [--cells 20] [--knots 10] [--json OUT] [--maps a,b]

Reads every usable map under R/retail-<world> (heights.bin at 16-px cells, the sea taken off, as repro/stats.py does); Zhon has no map exports, so it
reads R/repro-r7/zhon-*/heights.npy (64 x 64 windows, sea already off). A feature is a connected region above the map's plain (modal dry height) with a
top (95th percentile) at least 8 units over it; water is the same going down (the shore is the foot, the bed the top, the waterline is 0).
Distance comes from a distance transform from the foot, a feature's width is the median distance of its top cells, and a feature's curve is its mean
height share per distance share. Features are binned by height, each feature counts once (its own curve, then the mean over the bin's features), and
a knot list is fitted to that mean by adding knots where the error is largest. The cells are 16 px, so this judges form (width, overall shape) and not
the last few px. Lean: for slope cells, the run (feature height over the gradient) by the bearing the ground falls toward, eight sectors.
"""
import argparse, json, sys
from pathlib import Path
import numpy as np
from scipy import ndimage

ROOT = Path('/tmp/nanolathe-map-editor')
CELL = 16
FOOT = 2.0          # a cell is in a feature from this many units over the plain (a foot at the plain itself would take the noise in)
MIN_RISE = 8.0      # the feature's top over the plain
MIN_WIDTH = 40.0    # px; narrower features are two cells or fewer from foot to top and say nothing about form
TALL_WIDTH = 96.0   # px, six cells
PEAK_SHARE = .08
SECTORS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']


def load_maps(world, root, only=None):
    """[(name, heights above sea, plain override or None)]"""
    out = []
    if world == 'zhon':
        for d in sorted((root / 'repro-r7').glob('zhon-*')):
            crop = json.loads((d / 'crop.json').read_text())
            out.append((d.name, np.load(d / 'heights.npy').astype(np.float64), float(crop.get('plain', 0.0))))
        return out
    base = root / f'retail-{world}'
    for md in sorted(p for p in base.iterdir() if (p / 'metadata.json').exists()):
        meta = json.loads((md / 'metadata.json').read_text())
        if meta['width'] < 1024 or meta['height'] < 1024 or (only and meta['name'] not in only):
            continue
        cells = np.memmap(md / 'heights.bin', np.uint8, 'r', shape=(meta['cell_height'], meta['cell_width']))
        out.append((meta['name'], np.asarray(cells, np.float64) - meta['sea_level'], None))
    return out


def modal_dry(h):
    dry = np.round(h[h >= 0]).astype(int)
    return float(np.bincount(dry).argmax()) if dry.size else 0.0


def features(h, plain, water):
    """Yield (rise, rel, dist) for each qualifying feature: rel the height share of every cell, dist the distance from the foot in px."""
    z = (-h if water else h - plain)                      # height over the foot level, going up (land) or down (water)
    mask = (h < 0) if water else (z > FOOT)
    lab, n = ndimage.label(mask)
    edt = (ndimage.distance_transform_edt(np.pad(mask, 1, mode='edge'))[1:-1, 1:-1] - .5).clip(0) * CELL
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        m = lab[sl] == i
        zz, dd = z[sl][m], edt[sl][m]
        if zz.size < 6:
            continue
        top = np.percentile(zz, 95)
        if top < MIN_RISE:
            continue
        width = float(np.median(dd[zz >= top]))
        if width < MIN_WIDTH:
            continue
        gy, gx = np.gradient(z[sl])
        top_cells = m & (z[sl] >= .9 * top)
        yield {'sections': sections(m, top_cells), 'topShare': float(np.mean(zz >= .9 * top)), 'rise': float(top), 'width': width, 'area': int(zz.size), 'rel': zz / top, 'dist': dd / width,
               'gx': gx[m], 'gy': gy[m]}


def sections(m, top):
    """Slope lengths in px, cell by cell, on either side of the top: along each column the run north and south of the top's ends, along each row
    west and east. Runs that reach the edge of the feature's box (which touches the map's edge) are left out."""
    out = {'NS': [], 'WE': []}
    for key, mm, tt in (('NS', m, top), ('WE', m.T, top.T)):
        for j in range(mm.shape[1]):
            rows = np.flatnonzero(tt[:, j])
            if not rows.size:
                continue
            a, b = rows[0], rows[-1]
            col = mm[:, j]
            lo = a
            while lo > 0 and col[lo - 1]: lo -= 1
            hi = b
            while hi < len(col) - 1 and col[hi + 1]: hi += 1
            if lo > 0 and hi < len(col) - 1:
                out[key].append(((a - lo + .5) * CELL, (hi - b + .5) * CELL))
    return out


# The curve of a form, as repro/stats-free reference: the shared forms' shapes (sculpt-shape-presets.js) for the comparison column.
def smooth(t): t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)
def mountain(t, m=3.5): t = np.clip(t, 0, 1); return (1 - (1 - t) ** 2) ** m


def mono_cubic(xs, ys):
    """The editor's sampler (knotCurve in sculpt-shape-presets.js): Fritsch-Carlson tangents, zero at the ends and where the slope changes sign."""
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    n = len(xs)
    d = (ys[1:] - ys[:-1]) / np.maximum(xs[1:] - xs[:-1], 1e-9)
    m = np.zeros(n)
    for i in range(1, n - 1):
        if d[i - 1] * d[i] > 0:
            h0, h1 = xs[i] - xs[i - 1], xs[i + 1] - xs[i]
            w1, w2 = 2 * h1 + h0, h1 + 2 * h0
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        x = np.asarray(x, float)
        k = np.clip(np.searchsorted(xs, x, side='right') - 1, 0, n - 2)
        h = xs[k + 1] - xs[k]
        u = (x - xs[k]) / h
        u2, u3 = u * u, u * u * u
        y = (2 * u3 - 3 * u2 + 1) * ys[k] + (u3 - 2 * u2 + u) * h * m[k] + (-2 * u3 + 3 * u2) * ys[k + 1] + (u3 - u2) * h * m[k + 1]
        return np.where(x <= xs[0], ys[0], np.where(x >= xs[-1], ys[-1], y))
    return f


def isotonic(y):
    """Pool adjacent violators: the nearest non-decreasing curve (a measured foot-to-top average should rise)."""
    y = list(map(float, y)); w = [1.0] * len(y); out = []
    for v, ww in zip(y, w):
        out.append([v, ww])
        while len(out) > 1 and out[-2][0] > out[-1][0]:
            b = out.pop(); a = out[-1]
            a[0] = (a[0] * a[1] + b[0] * b[1]) / (a[1] + b[1]); a[1] += b[1]
    return np.concatenate([[v] * int(w) for v, w in out])


def fit_knots(x, y, n):
    """Greedy: start from the two ends, add the knot where the monotone cubic is furthest from the measured curve, until n knots."""
    ks = [0, len(x) - 1]
    while len(ks) < n:
        f = mono_cubic(x[ks], y[ks])
        err = np.abs(f(x) - y)
        err[ks] = 0
        if err.max() < .03:
            break
        ks = sorted(ks + [int(err.argmax())])
    f = mono_cubic(x[ks], y[ks])
    return [[round(float(x[k]), 3), round(float(y[k]), 3)] for k in ks], float(np.sqrt(np.mean((f(x) - y) ** 2))), float(np.abs(f(x) - y).max())


def curve_of(feats, cells):
    """Height share per distance share, pooled over the features' cells with each feature weighing the same (a cell weighs 1 over its feature's
    cells short of the top), in `cells` even bins; the last bin is everything at or past the top. Returns bin centres, means, cells per bin."""
    num, den, cnt = np.zeros(cells + 1), np.zeros(cells + 1), np.zeros(cells + 1)
    for f in feats:
        idx = np.minimum((f['dist'] * cells).astype(int), cells)
        wgt = np.full(f['rel'].shape, 1.0 / max(1, np.sum(f['dist'] < 1)))
        np.add.at(num, idx, wgt * f['rel']); np.add.at(den, idx, wgt); np.add.at(cnt, idx, 1)
    mean = np.where(den > 0, num / np.maximum(den, 1e-12), np.nan)
    return np.append((np.arange(cells) + .5) / cells, 1.0), mean, cnt


def smoothed(y):
    """[1 2 1] over the foot-to-top bins (ends held), the top bin left alone: the cells are 16 px, a bin is a few cells."""
    out = y.copy()
    for i in range(1, len(y) - 2):
        v = y[i - 1:i + 2]; w = np.array([1., 2., 1.])
        ok = ~np.isnan(v)
        if ok.all(): out[i] = (v * w).sum() / w.sum()
    return out


def lean_of(feats):
    """Run by the bearing the ground falls toward. Slope cells only (height share .1 to .9); the run is the feature's rise over the gradient, px."""
    runs = [[] for _ in SECTORS]
    for f in feats:
        sel = (f['rel'] > .1) & (f['rel'] < .9)
        g = np.hypot(f['gx'], f['gy'])
        sel &= g > 0
        # the ground falls toward -gradient; rows grow southward, so north is -y
        ang = np.arctan2(f['gx'][sel] * -1, f['gy'][sel])      # 0 = falling toward north (gy > 0 means the ground rises southward), clockwise
        sec = np.round(ang / (np.pi / 4)).astype(int) % 8
        run = f['rise'] / g[sel] * CELL / CELL                 # gradient is per cell: rise / (units per cell) = cells, times 16 = px
        for s, r in zip(sec, run * CELL):
            runs[s].append(r)
    med = np.array([np.median(r) if len(r) > 20 else np.nan for r in runs])
    return med, [len(r) for r in runs]


def analyse(world, root, bins, cells, nknots, only):
    maps = load_maps(world, root, only)
    if not maps:
        raise SystemExit(f'{world}: no usable maps under {root}')
    out = {'world': world, 'maps': [m[0] for m in maps], 'land': {}, 'water': {}}
    pooled = {'land': [], 'water': []}
    for name, h, plain in maps:
        p = modal_dry(h) if plain is None else plain
        for kind in ('land', 'water'):
            fs = list(features(h, p, kind == 'water'))
            for f in fs:
                f['map'] = name
            pooled[kind] += fs
        print(f'  {name}: plain {p:g}, {len(pooled["land"])} land / {len(pooled["water"])} water features so far', file=sys.stderr)
    edges = [0] + bins + [1e9]
    groups = []
    for kind in ('land', 'water'):
        for lo, hi in zip(edges[:-1], edges[1:]):
            groups.append((kind, f'{lo:g}-{hi:g}' if hi < 1e9 else f'{lo:g}+', [f for f in pooled[kind] if lo <= f['rise'] < hi]))
    # Tall features (80+ units, at least TALL_WIDTH px from foot to top) split by how much of the feature lies near its top: PEAK_SHARE of its cells at
    # 90% of the top or higher. A cone has about 2% there, a plateau a third; below the threshold it is peaked, at or above it flat-topped.
    tall = [f for f in pooled['land'] if f['rise'] >= 80 and f['width'] >= TALL_WIDTH]
    groups += [('land', '80+ peaked', [f for f in tall if f['topShare'] < PEAK_SHARE]), ('land', '80+ flat', [f for f in tall if f['topShare'] >= PEAK_SHARE])]
    for kind, label, fs in groups:
        if len(fs) < 3:
            out[kind][label] = {'features': len(fs)}
            continue
        x, mean, support = curve_of(fs, cells)
        ok = ~np.isnan(mean) & (support >= 10)
        mean = smoothed(mean)
        xs, ys = np.concatenate([[0], x[ok]]), np.concatenate([[0], isotonic(np.clip(mean[ok], 0, 1.0))])
        halves = [curve_of([f for f in fs if hash_half(f['map']) == k], cells)[1] for k in (0, 1)]
        hv = ~np.isnan(halves[0]) & ~np.isnan(halves[1])
        half_rms = float(np.sqrt(np.mean((smoothed(halves[0])[hv] - smoothed(halves[1])[hv]) ** 2))) if hv.any() else None
        ys = ys / ys[-1]                                              # the top is 1 by definition
        knots, rms, mx = fit_knots(xs, ys, nknots)
        ref = {'smoothstep': float(np.sqrt(np.mean((smooth(xs) - ys) ** 2))), 'mountain3.5': float(np.sqrt(np.mean((mountain(xs) - ys) ** 2)))}
        med, cnt = lean_of(fs)
        fin = med[~np.isnan(med)]
        ray = {}
        for key, (na, nb) in {'NS': ('N', 'S'), 'WE': ('W', 'E')}.items():
            pairs = np.array([p for f in fs for p in f['sections'][key]]).reshape(-1, 2)
            ray[key] = {'pairs': len(pairs), na + '_px': round(float(pairs[:, 0].mean()), 1) if len(pairs) else None, nb + '_px': round(float(pairs[:, 1].mean()), 1) if len(pairs) else None,
                        f'{na}/{nb}': round(float(pairs[:, 0].mean() / pairs[:, 1].mean()), 2) if len(pairs) else None,
                        f'{na}/{nb} median pair': round(float(np.median(pairs[:, 0] / pairs[:, 1])), 2) if len(pairs) else None}
        out[kind][label] = {
            'features': len(fs), 'maps': sorted({f['map'] for f in fs}), 'riseMedian': float(np.median([f['rise'] for f in fs])),
            'widthPx': {'p25': float(np.percentile([f['width'] for f in fs], 25)), 'median': float(np.median([f['width'] for f in fs])),
                        'p75': float(np.percentile([f['width'] for f in fs], 75))},
            'curve': [[round(float(a), 3), round(float(b), 3)] for a, b in zip(x[ok], mean[ok])],
            'knots': knots, 'fitRms': round(rms, 4), 'halvesRms': None if half_rms is None else round(half_rms, 4), 'fitMax': round(mx, 4), 'refRms': {k: round(v, 4) for k, v in ref.items()},
            'runPx': {s: (None if np.isnan(v) else round(float(v), 1)) for s, v in zip(SECTORS, med)},
            'runCells': dict(zip(SECTORS, cnt)), 'rays': ray,
            'lean': {'N/S': ratio(med, 0, 4), 'NE/SW': ratio(med, 1, 5), 'E/W': ratio(med, 2, 6), 'SE/NW': ratio(med, 3, 7)} if len(fin) == 8 else None}
    return out


def hash_half(name):
    return sum(map(ord, name)) % 2


def ratio(med, a, b):
    return round(float(med[a] / med[b]), 2)


def show(res):
    print(f'{res["world"]}: {len(res["maps"])} maps')
    for kind in ('land', 'water'):
        for label, r in res[kind].items():
            if r['features'] < 3:
                print(f'  {kind} {label}: {r["features"]} features (too few)')
                continue
            w = r['widthPx']
            print(f'  {kind} {label}: {r["features"]} features in {len(r["maps"])} maps, rise {r["riseMedian"]:.0f}, width px {w["p25"]:.0f}/{w["median"]:.0f}/{w["p75"]:.0f}')
            print(f'    knots {r["knots"]}')
            print(f'    halves (maps split in two) differ by rms {r["halvesRms"]}; fit rms {r["fitRms"]} max {r["fitMax"]}; rms of smoothstep {r["refRms"]["smoothstep"]}, mountain {r["refRms"]["mountain3.5"]}')
            print(f'    run px by falling-toward bearing {r["runPx"]}')
            print(f'    lean (gradient) {r["lean"]}')
            print(f'    slope length along the top\'s columns/rows {r["rays"]}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('world')
    ap.add_argument('--root', default=str(ROOT))
    ap.add_argument('--bins', default='30,80')
    ap.add_argument('--cells', type=int, default=12)
    ap.add_argument('--knots', type=int, default=10)
    ap.add_argument('--maps', default='')
    ap.add_argument('--json', default='')
    a = ap.parse_args()
    res = analyse(a.world, Path(a.root), [float(v) for v in a.bins.split(',')], a.cells, a.knots, set(a.maps.split(',')) if a.maps else None)
    show(res)
    if a.json:
        Path(a.json).write_text(json.dumps(res, indent=1))
