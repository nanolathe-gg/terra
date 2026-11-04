"""A numeric realism check for terrain: geomorphometric statistics that tell eroded, real terrain from synthetic noise.

Each height field is cut into windows of the lab's size (384 x 288 px, TA's 1 art px = 1.5 m) and measured:

  slope50, slope90   median and p90 of the true slope (tan), from central differences.
  slopeShape         slope50 / slope90: about 0.55 for Gaussian-gradient noise (a Rayleigh slope law); higher where
                     slopes pile up near a threshold (repose, hillslope diffusion), lower for flats and cliffs.
  curvSkew2, 8       skewness of the Laplacian of the surface smoothed at sigma 2 and 8 px (positive = concave, valleys).
                     Erosion makes valleys narrow and sharp and divides broad and round, so the Laplacian has a long
                     positive tail; the channel-extraction literature thresholds valleys where curvature leaves the
                     normal law (Lashermes, Foufoula-Georgiou and Dietrich 2007; Passalacqua et al. 2010). fBm is
                     symmetric (0); ridged noise is negative.
  betaLong, Short    the power-spectrum exponent (P ~ k^-beta) over wavelengths 24..96 px and 4..12 px. Real
                     relief is not one fractal: hillslope diffusion steepens the spectrum below the ridge-valley
                     spacing (Perron, Kirchner and Dietrich 2008). fBm keeps one beta (2H + 2) at every scale.
  pitArea            share of the window under closed depressions deeper than 0.5 px (priority-flood fill,
                     Barnes et al. 2014). Water-cut terrain drains; summed noise is pocked with basins.
  hack               Hack's exponent h in L ~ A^h (longest flow path against D8 area; Hack 1957: 0.6; Rigon et al.
                     1996: 0.5-0.6).
  concavity          theta in S ~ A^-theta along the larger flow paths (Flint 1974: 0.3-0.7 in channels).
  saHill             d log S / d log A for areas of 1..16 px: positive where divides are round (S grows downslope
                     before channels take over; Tarboton et al. 1991; Roering et al. 2007).
  gmRidge, gmSpur, gmHollow, gmValley
                     shares of the geomorphon forms (Jasiewicz and Stepinski 2013; lookup 24 px, flat 1 degree). The
                     Perceived Terrain Realism Metric (Rajasekaran et al. 2022, ACM TAP 19(2)) found these four
                     forms carry people's realism judgement.
  hypso              hypsometric integral (mean - min) / (max - min) (Strahler 1952). Weak on a window: reported only.
  aniso              fabric anisotropy, (l1 - l2) / (l1 + l2) of the gradient structure tensor after a sigma 16 high
                     pass: joints, strata and valleys aligned down the regional slope. Isotropic noise is near 0.
  relief             max - min in TA height units (zk 0.7: one unit is 0.7 px of true height). Reported only.

Horton/Strahler ratios are left out: random networks give the same bifurcation and length ratios, so they do not
discriminate (Kirchner 1993). Orometry (Argudo et al. 2019) needs hundreds of peaks, many kilometres of map, so it
does not fit a window.

    python3 -I docs/research/realism.py lab-out/*.f32 [--w 384] [--zk 0.7]          score lab height fields
    python3 -I docs/research/realism.py --synthetic                                  noise baselines and discrimination
    python3 -I docs/research/realism.py --dem SRC [--box x0,y0,w,h] [--dem-mpp 1] [--mpp 1.5] [--name site] > site.json
    python3 -I docs/research/realism.py --ranges site.json ...                       pooled ranges for REFERENCE

SRC for --dem is a local .npy, raw .f32 (--dem-w), or float32 GeoTIFF, or an https URL of a cloud-optimized GeoTIFF:
only the tiles inside --box are fetched, by curl range requests (LZW or deflate, predictor 1-3). Needs numpy only.
"""
import heapq
import json
import math
import os
import struct
import subprocess
import sys
import zlib

import numpy as np

WIN = (384, 288)
STATS = ['slope50', 'slope90', 'slopeShape', 'curvSkew2', 'curvSkew8', 'betaLong', 'betaShort', 'pitArea', 'hack',
         'concavity', 'saHill', 'gmRidge', 'gmSpur', 'gmHollow', 'gmValley', 'hypso', 'aniso', 'relief']
SCORED = [s for s in STATS if s not in ('hypso', 'relief')]
MIN_RELIEF = 24  # TA units: flatter windows (a prairie table, a valley floor) say nothing about erosion and are skipped

# Ranges measured with this file from USGS 3DEP 1 m lidar DEMs (public domain), resampled by area to 1.5 m per px,
# windows of 384 x 288 px. Each site: p10, p50, p90 over its windows; 'real': p5 and p95 over all of them.
# Filled in by `--ranges`; see SOURCES.
REFERENCE = {}
SOURCES = {}


# ---- reading ----------------------------------------------------------------------------------------------------

def _get(src, a, b):
    if src.startswith('https://'):
        r = subprocess.run(['curl', '-sSf', '--max-time', '120', '-r', f'{a}-{b}', src], capture_output=True, check=True)
        return r.stdout
    with open(src, 'rb') as f:
        f.seek(a)
        return f.read(b - a + 1)


def _ifd0(src):
    buf = _get(src, 0, (1 << 20) - 1)
    bo = '<' if buf[:2] == b'II' else '>'
    big = struct.unpack(bo + 'H', buf[2:4])[0] == 43
    off = struct.unpack(bo + 'Q', buf[8:16])[0] if big else struct.unpack(bo + 'I', buf[4:8])[0]
    cnt = struct.unpack(bo + ('Q' if big else 'H'), buf[off:off + (8 if big else 2)])[0]
    p, esz, tags = off + (8 if big else 2), 20 if big else 12, {}
    sizes = {1: 'B', 2: 'B', 3: 'H', 4: 'I', 11: 'f', 12: 'd', 16: 'Q'}
    for i in range(cnt):
        e = buf[p + i * esz:p + (i + 1) * esz]
        tag, typ = struct.unpack(bo + 'HH', e[:4])
        n = struct.unpack(bo + ('Q' if big else 'I'), e[4:12] if big else e[4:8])[0]
        f = sizes.get(typ, 'B')
        nb = struct.calcsize(f) * n
        v = e[12:20] if big else e[8:12]
        if nb > len(v):
            o = struct.unpack(bo + ('Q' if big else 'I'), v)[0]
            v = buf[o:o + nb] if o + nb <= len(buf) else _get(src, o, o + nb - 1)
        tags[tag] = v[:nb].rstrip(b'\0').decode('latin1') if typ == 2 else struct.unpack(bo + f * n, v[:nb])
    return bo, tags


def _lzw(data):
    out, tab, pos, nbits, prev, n = bytearray(), [bytes([i]) for i in range(256)] + [b'', b''], 0, 9, None, len(data) * 8
    while pos + nbits <= n:
        code = (int.from_bytes(data[pos >> 3:(pos >> 3) + 4].ljust(4, b'\0'), 'big') >> (32 - (pos & 7) - nbits)) & ((1 << nbits) - 1)
        pos += nbits
        if code == 256:
            tab, nbits, prev = tab[:258], 9, None
            continue
        if code == 257:
            break
        ent = tab[code] if prev is None or code < len(tab) else prev + prev[:1]
        if prev is not None:
            tab.append(prev + ent[:1])
        out += ent
        prev = ent
        if len(tab) + 1 >= (1 << nbits) and nbits < 12:
            nbits += 1
    return bytes(out)


def read_tiff(src, box=None):
    """A float32 window (x0, y0, w, h) of a tiled or stripped GeoTIFF; nodata becomes NaN."""
    bo, t = _ifd0(src)
    W, H = t[256][0], t[257][0]
    x0, y0, w, h = box or (0, 0, W, H)
    tiled = 322 in t
    tw, th = (t[322][0], t[323][0]) if tiled else (W, t.get(278, (H,))[0])
    offs, cnts = (t[324], t[325]) if tiled else (t[273], t[279])
    comp, pred, nx = t.get(259, (1,))[0], t.get(317, (1,))[0], (W + tw - 1) // tw
    if t.get(339, (1,))[0] != 3 or t[258][0] != 32:
        raise ValueError('only float32 GeoTIFFs')
    out = np.full((h, w), np.nan, np.float32)
    for ty in range(y0 // th, (y0 + h - 1) // th + 1):
        for tx in range(x0 // tw, (x0 + w - 1) // tw + 1):
            k = ty * nx + tx
            if cnts[k] == 0:
                continue
            raw = _get(src, offs[k], offs[k] + cnts[k] - 1)
            raw = zlib.decompress(raw) if comp in (8, 32946) else _lzw(raw) if comp == 5 else raw
            rows = len(raw) // (4 * tw)
            if pred == 3:
                b = np.cumsum(np.frombuffer(raw, np.uint8)[:rows * 4 * tw].reshape(rows, 4 * tw), 1, dtype=np.uint8)
                a = b.reshape(rows, 4, tw).transpose(0, 2, 1).copy().view('>f4').reshape(rows, tw)
            else:
                a = np.frombuffer(raw, bo + 'f4')[:rows * tw].reshape(rows, tw)
                if pred == 2:
                    a = np.cumsum(a.view(np.int32), 1, dtype=np.int32).view(np.float32)
            ax, ay = tx * tw, ty * th
            sx0, sy0, sx1, sy1 = max(x0, ax), max(y0, ay), min(x0 + w, ax + tw), min(y0 + h, ay + rows)
            out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = a[sy0 - ay:sy1 - ay, sx0 - ax:sx1 - ax]
    if 42113 in t:
        out[out == float(t[42113])] = np.nan
    out[out < -1e30] = np.nan
    return out


def resample(z, f):
    """Area average onto pixels f source pixels wide (f >= 1, need not be whole)."""
    for axis in (0, 1):
        n = z.shape[axis]
        c = np.concatenate([np.zeros_like(np.take(z, [0], axis)), np.cumsum(z, axis)], axis)
        e = np.arange(int(n // f) + 1) * f
        k = np.minimum(np.floor(e).astype(int), n - 1)
        t = (e - k).reshape([-1 if i == axis else 1 for i in range(2)])
        ce = np.take(c, k, axis) * (1 - t) + np.take(c, k + 1, axis) * t
        z = np.diff(ce, axis=axis) / f
    return z


# ---- the statistics ---------------------------------------------------------------------------------------------

def _blur_lap(g, sigma, lap):
    """Gaussian blur (lap=False) or Laplacian of Gaussian (lap=True) by FFT, with mirrored edges."""
    p = int(3 * sigma) + 2
    a = np.pad(g, p, mode='reflect')
    ky, kx = np.meshgrid(np.fft.fftfreq(a.shape[0]), np.fft.rfftfreq(a.shape[1]), indexing='ij')
    k2 = (2 * np.pi) ** 2 * (kx * kx + ky * ky)
    filt = np.exp(-0.5 * k2 * sigma * sigma) * (-k2 if lap else 1)
    return np.fft.irfft2(np.fft.rfft2(a) * filt, a.shape)[p:-p, p:-p]


def _skew(x):
    x = x - x.mean()
    s = x.std()
    return float((x ** 3).mean() / s ** 3) if s > 0 else 0.0


def _spectrum(g, bands):
    H, W = g.shape
    yy, xx = np.mgrid[0:H, 0:W]
    A = np.c_[np.ones(H * W), xx.ravel(), yy.ravel()]
    r = g.ravel() - A @ np.linalg.lstsq(A, g.ravel(), rcond=None)[0]
    win = np.outer(np.hanning(H), np.hanning(W))
    P = np.abs(np.fft.fft2(r.reshape(H, W) * win)) ** 2
    k = np.hypot(*np.meshgrid(np.fft.fftfreq(H), np.fft.fftfreq(W), indexing='ij'))
    out = []
    for lo, hi in bands:
        edges = np.geomspace(1 / hi, 1 / lo, 9)
        lk, lp = [], []
        for a, b in zip(edges[:-1], edges[1:]):
            m = (k >= a) & (k < b)
            if m.sum() >= 4:
                lk.append(math.log(math.sqrt(a * b)))
                lp.append(math.log(P[m].mean()))
        out.append(float(-np.polyfit(lk, lp, 1)[0]) if len(lk) >= 3 else float('nan'))
    return out


N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def _drainage(g):
    """Priority-flood fill with an epsilon (Barnes et al. 2014), D8 receivers, area and longest flow length."""
    H, W = g.shape
    z = g.astype(np.float64).ravel()
    f = z.copy()
    closed = np.zeros(H * W, bool)
    edge = np.zeros((H, W), bool)
    edge[0], edge[-1], edge[:, 0], edge[:, -1] = True, True, True, True
    heap = [(f[i], i) for i in np.flatnonzero(edge)]
    closed[edge.ravel()] = True
    heapq.heapify(heap)
    while heap:
        zc, i = heapq.heappop(heap)
        y, x = divmod(i, W)
        for dy, dx in N8:
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W:
                j = yy * W + xx
                if not closed[j]:
                    closed[j] = True
                    if f[j] <= zc:
                        f[j] = zc + 1e-6
                    heapq.heappush(heap, (f[j], j))
    F = f.reshape(H, W)
    P = np.pad(F, 1, constant_values=np.inf)
    best, rec, dist = np.zeros((H, W)), np.full((H, W), -1), np.ones((H, W))
    yy, xx = np.mgrid[0:H, 0:W]
    for dy, dx in N8:
        d = math.hypot(dy, dx)
        s = (F - P[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]) / d
        m = s > best
        best[m], dist[m] = s[m], d
        rec[m] = ((yy + dy) * W + xx + dx)[m]
    rec, dist = rec.ravel(), dist.ravel()
    area, length = np.ones(H * W), np.zeros(H * W)
    for i in np.argsort(-f, kind='stable'):
        r = rec[i]
        if r >= 0:
            area[r] += area[i]
            length[r] = max(length[r], length[i] + dist[i])
    slope = np.where(rec >= 0, (z - z[np.maximum(rec, 0)]) / dist, 0)
    return (f - z).reshape(H, W), area, length, np.maximum(slope, 0)


def _binned_fit(x, y, lo, hi):
    """Slope of log y against log x over medians in 0.2-decade bins of x within [lo, hi]."""
    m = (x >= lo) & (x <= hi) & (y > 0)
    if m.sum() < 20 or hi < lo * 4:
        return float('nan')
    lx, ly = np.log10(x[m]), np.log10(y[m])
    bx, by = [], []
    for a in np.arange(math.log10(lo), math.log10(hi), 0.2):
        s = (lx >= a) & (lx < a + 0.2)
        if s.sum() >= 5:
            bx.append(np.median(lx[s]))
            by.append(np.median(ly[s]))
    return float(np.polyfit(bx, by, 1)[0]) if len(bx) >= 3 else float('nan')


# Geomorphon forms by (number of lower directions, number of higher directions), from r.geomorphon's table.
FORMS = ['flat', 'peak', 'ridge', 'shoulder', 'spur', 'slope', 'hollow', 'footslope', 'valley', 'pit']
_T = ['FL FL FL FS FS VL VL VL PT', 'FL FL FS FS FS VL VL VL', 'FL SH SL SL HL HL VL', 'SH SH SL SL SL HL',
      'SH SH SP SL SL', 'RI RI SP SP', 'RI RI RI', 'RI RI', 'PK']
_CODE = {'FL': 0, 'PK': 1, 'RI': 2, 'SH': 3, 'SP': 4, 'SL': 5, 'HL': 6, 'FS': 7, 'VL': 8, 'PT': 9}
GM_TABLE = np.full((9, 9), 5, int)
for _r, _row in enumerate(_T):
    for _c, _f in enumerate(_row.split()):
        GM_TABLE[_r, _c] = _CODE[_f]


def _geomorphons(g, L=24, flat_deg=1.0):
    H, W = g.shape
    t = math.radians(flat_deg)
    lower, higher = np.zeros((H, W), int), np.zeros((H, W), int)
    P = np.pad(g, L, constant_values=np.nan)
    np.seterr(invalid='ignore')
    for dy, dx in N8:
        up, dn = np.full((H, W), -np.inf), np.full((H, W), np.inf)
        for r in range(1, L + 1):
            s = P[L + dy * r:L + dy * r + H, L + dx * r:L + dx * r + W]
            ang = np.arctan((s - g) / (r * math.hypot(dy, dx)))
            up, dn = np.fmax(up, ang), np.fmin(dn, ang)
        higher += (up + dn) > t     # zenith - nadir: the direction rises more than it falls
        lower += (up + dn) < -t
    form = GM_TABLE[lower, higher][L:-L, L:-L]
    return np.bincount(form.ravel(), minlength=10) / form.size


def measure(g, zk_units=0.7):
    """Statistics of one window g of true heights in px (a slope of 1 is 45 degrees)."""
    gy, gx = np.gradient(g)
    s = np.hypot(gx, gy)[2:-2, 2:-2].ravel()
    out = {'slope50': float(np.median(s)), 'slope90': float(np.percentile(s, 90))}
    out['slopeShape'] = out['slope50'] / max(out['slope90'], 1e-9)
    for sig in (2, 8):
        c = _blur_lap(g, sig, True)[3 * sig:-3 * sig, 3 * sig:-3 * sig]
        out[f'curvSkew{sig}'] = _skew(c.ravel())
    out['betaLong'], out['betaShort'] = _spectrum(g, [(24, 96), (4, 12)])
    depth, area, length, slope = _drainage(g)
    out['pitArea'] = float((depth > 0.5).mean())
    amax = area.max()
    out['hack'] = _binned_fit(area, length, 20, amax / 5)
    c = _binned_fit(area, slope, 200, amax / 5)
    out['concavity'] = -c if c == c else c
    out['saHill'] = _binned_fit(area, slope, 1, 16)
    gm = _geomorphons(g)
    out['gmRidge'], out['gmSpur'], out['gmHollow'], out['gmValley'] = (float(gm[i]) for i in (2, 4, 6, 8))
    lo, hi = g.min(), g.max()
    out['hypso'] = float((g.mean() - lo) / max(hi - lo, 1e-9))
    hp = g - _blur_lap(g, 16, False)
    hy, hx = np.gradient(hp)
    J = np.array([[(hx * hx).sum(), (hx * hy).sum()], [(hx * hy).sum(), (hy * hy).sum()]])
    ev = np.linalg.eigvalsh(J)
    out['aniso'] = float((ev[1] - ev[0]) / max(ev.sum(), 1e-12))
    out['relief'] = float((hi - lo) / zk_units)
    return out


def windows(g, size=WIN, limit=None):
    w, h = size
    out = []
    for y in range(0, g.shape[0] - h + 1, h):
        for x in range(0, g.shape[1] - w + 1, w):
            win = g[y:y + h, x:x + w]
            if not np.isnan(win).any():
                out.append(win)
    return out[:limit]


# ---- baselines, ranges and the score ---------------------------------------------------------------------------

def synthetic(kind, seed, size=WIN):
    """Deterministic noise windows: fBm (H 1 and 0.5), ridged and billowed multifractal, by spectral synthesis."""
    w, h = size
    rng = np.random.default_rng(seed)
    ky, kx = np.meshgrid(np.fft.fftfreq(h), np.fft.rfftfreq(w), indexing='ij')
    k = np.maximum(np.hypot(kx, ky), 1 / max(w, h))

    def band(lam):  # one octave of Gaussian noise around wavelength lam px, unit variance
        f = np.exp(-0.5 * (np.log2(k * lam) / 0.5) ** 2)
        n = np.fft.irfft2(np.fft.rfft2(rng.standard_normal((h, w))) * f, (h, w))
        return n / n.std()

    if kind.startswith('fbm'):
        Hu = 1.0 if kind == 'fbm-h1' else 0.5
        spec = np.fft.rfft2(rng.standard_normal((h, w))) * k ** -(Hu + 1)
        spec[0, 0] = 0
        g = np.fft.irfft2(spec, (h, w))
    else:
        g = np.zeros((h, w))
        for o, lam in enumerate([192, 96, 48, 24, 12, 6, 3]):
            n = band(lam)
            g += (0.5 ** o) * ((1 - np.abs(n) / 2.5) ** 2 if kind == 'ridged' else np.abs(n))
    return g


def ranges(rows):
    """Per-site p10/p50/p90 and pooled p5/p95 over windows: rows are dicts with 'site' and the statistics."""
    out = {}
    rows = [r for r in rows if r['relief'] >= MIN_RELIEF]
    sites = sorted({r['site'] for r in rows})
    for name in sites + ['real']:
        rs = [r for r in rows if name == 'real' or r['site'] == name]
        qs = (5, 50, 95) if name == 'real' else (10, 50, 90)
        out[name] = {s: [round(float(np.nanpercentile([r[s] for r in rs], q)), 4) for q in qs] for s in STATS}
        out[name]['n'] = len(rs)
    return out


def score(st, ref=None):
    """Statistics inside the pooled real p5..p95, and the distance outside in units of that range's width."""
    ref = ref or REFERENCE['real']
    inside, miss = 0, []
    for s in SCORED:
        lo, _, hi = ref[s]
        v = st[s]
        if v != v:
            miss.append((s, float('inf')))
        elif lo <= v <= hi:
            inside += 1
        else:
            miss.append((s, (lo - v if v < lo else v - hi) / max(hi - lo, 1e-9)))
    return inside, sorted(miss, key=lambda m: -m[1])


def nearest_site(st):
    """The real site whose medians are closest, each statistic scaled by the pooled p5..p95 width."""
    best = None
    for name, r in REFERENCE.items():
        if name == 'real':
            continue
        d = sum(((st[s] - r[s][1]) / max(REFERENCE['real'][s][2] - REFERENCE['real'][s][0], 1e-9)) ** 2
                for s in SCORED if st[s] == st[s])
        best = min(best or (d, name), (d, name))
    return best[1]


def table(rows, names):
    head = ['in'] + [s[:9] for s in STATS] + ['nearest']
    print(f'{"field":<34}' + ''.join(f'{h:>10}' for h in head))
    if REFERENCE:
        for site, r in REFERENCE.items():
            print(f'{"  " + site + " (p50)":<34}' + f'{"":>10}' + ''.join(f'{r[s][1]:>10.3f}' for s in STATS))
        lo, hi = REFERENCE['real'], REFERENCE['real']
        print(f'{"  real p5":<34}{"":>10}' + ''.join(f'{lo[s][0]:>10.3f}' for s in STATS))
        print(f'{"  real p95":<34}{"":>10}' + ''.join(f'{hi[s][2]:>10.3f}' for s in STATS))
    for name, st in zip(names, rows):
        inside = f'{score(st)[0]}/{len(SCORED)}' if REFERENCE else ''
        near = nearest_site(st) if REFERENCE else ''
        print(f'{name:<34}{inside:>10}' + ''.join(f'{st[s]:>10.3f}' for s in STATS) + f'{near:>12}')


def opt(k, d=None):
    return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d


def main():
    zk = float(opt('--zk', 0.7))
    if '--dem' in sys.argv:
        src = opt('--dem')
        if src.endswith('.npy'):
            z = np.load(src).astype(np.float64)
        elif src.endswith('.f32'):
            z = np.fromfile(src, '<f4').reshape(-1, int(opt('--dem-w'))).astype(np.float64)
        else:
            box = tuple(int(v) for v in opt('--box').split(',')) if '--box' in sys.argv else None
            z = read_tiff(src, box).astype(np.float64)
        mpp, dem_mpp = float(opt('--mpp', 1.5)), float(opt('--dem-mpp', 1))
        g = resample(z, mpp / dem_mpp) / mpp if mpp != dem_mpp else z / mpp
        lim = int(opt('--limit', 0)) or None
        rows = [dict(site=opt('--name', 'dem'), **measure(w, zk)) for w in windows(g, limit=lim)]
        print(json.dumps(rows))
        return
    if '--ranges' in sys.argv:
        rows = [r for f in sys.argv[sys.argv.index('--ranges') + 1:] for r in json.load(open(f))]
        print(json.dumps(ranges(rows), indent=None).replace('], "', '],\n  "').replace('}, "', '},\n "'))
        return
    if '--synthetic' in sys.argv:
        kinds = ['fbm-h1', 'fbm-h05', 'ridged', 'billow']
        rows, names = [], []
        target = REFERENCE['real']['slope50'][1] if REFERENCE else 0.4
        for kind in kinds:
            for seed in range(int(opt('--n', 6))):
                g = synthetic(kind, seed)
                gy, gx = np.gradient(g)
                g *= target / np.median(np.hypot(gx, gy))
                rows.append(measure(g, zk))
                names.append(f'{kind} #{seed}')
        table(rows, names)
        if REFERENCE:
            print('share of noise windows each statistic puts outside the real p5..p95:')
            for kind in kinds:
                rs = [r for r, n in zip(rows, names) if n.startswith(kind + ' ')]
                print(f'  {kind:<9}' + ' '.join(f'{s}={np.mean([not (REFERENCE["real"][s][0] <= r[s] <= REFERENCE["real"][s][2]) for r in rs]):.2f}' for s in SCORED))
        if '--json' in sys.argv:
            print(json.dumps([dict(site=n.split(' ')[0], **r) for n, r in zip(names, rows)]))
        return
    files = [a for a in sys.argv[1:] if a.endswith('.f32')]
    if not files:
        print(__doc__)
        return
    W = int(opt('--w', WIN[0]))
    rows, names = [], []
    for f in files:
        h = np.fromfile(f, '<f4').astype(np.float64)
        rows.append(measure(h.reshape(-1, W) * zk, zk))
        names.append(os.path.basename(f)[:-4])
    table(rows, names)
    if '--json' in sys.argv:
        print(json.dumps([dict(site=n, **r) for n, r in zip(names, rows)]))


if __name__ == '__main__':
    main()
