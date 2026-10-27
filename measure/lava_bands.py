"""Contour bands on retail Lava maps: where they are, their height step, and
how they look.

Works in world space (lava_world.py): the art is sampled at each world
point's projected row, so a band that follows a height contour is a contour
here, and slope is height units per world px. Light on Lava comes from the
west (measured: brightest faces look 155-180 degrees, 0 = east, 90 = south).

    python lava_bands.py spectra ROOT [MAP...]   power across vs along contours
    python lava_bands.py lines ROOT OUT_DIR [MAP...]  dark-line census + profiles

`spectra` samples 64-px luminance profiles on land, straight along the fall
line and along the contour, at seeds binned by slope. Contour bands put
power across the contour (fall-line profiles) that the contour profiles lack;
the excess spectrum's peak wavelength, times slope, is the height per band.

`lines` finds dark lines (band-pass luminance minima along the fall line),
and reports, per slope bin and facing, line density, spacing along the fall
line in px and in height units, line runs along the contour (dashes), and the
tonal profile across a line averaged at its minimum.
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates, label

from lava_maps import OurMap, RetailMap
from lava_world import LAVA, world_tile

SLOPES = [0, .03, .07, .15, .3, .5, .8, 1.2, 2.0, 99]
TILE, MARGIN = 768, 48
# Light comes from the west: a face whose downhill direction points west
# (-x) faces the light. facing = dot(downhill, toward the light).
LIGHT = np.array([-1.0, -.15])
LIGHT /= np.hypot(*LIGHT)


# Our captures are mapped to the retail palette read from this export.
PALETTE_FROM = Path('/private/tmp/nanolathe-map-editor/retail-lava/kill_the_middle-93be44e8')


def iter_maps(root, names):
    """Retail map exports under ROOT, or sculpt captures (NAME.png with
    NAME.heights.json) when ROOT holds those."""
    root = Path(root)
    caps = sorted(root.glob('*.heights.json'))
    if caps:
        for c in caps:
            stem = str(c).removesuffix('.heights.json')
            if not names or any(n in Path(stem).name for n in names):
                yield OurMap(stem, PALETTE_FROM)
        return
    for d in sorted(root.iterdir()):
        if (d / 'metadata.json').exists() and (not names or any(n in d.name for n in names)):
            yield RetailMap(d)


def tiles(m):
    for ty in range(0, m.H, TILE):
        for tx in range(0, m.W, TILE):
            x0, y0 = max(0, tx - MARGIN), max(0, ty - MARGIN)
            x1, y1 = min(m.W, tx + TILE + MARGIN), min(m.H, ty + TILE + MARGIN)
            if x1 - x0 < 2 * MARGIN + 64 or y1 - y0 < 2 * MARGIN + 64:
                continue
            yield x0, y0, x1, y1


def prepare(m, x0, y0, x1, y1):
    wh, lum, idx, vis = world_tile(m, x0, y0, x1, y1)
    land = vis & ~LAVA[idx]
    far = distance_transform_edt(land) > 10
    s = gaussian_filter(wh, 6)
    gy, gx = np.gradient(s)
    g = np.hypot(gx, gy)
    with np.errstate(invalid='ignore', divide='ignore'):
        fx = np.where(g > 1e-6, -gx / g, 0.0)
        fy = np.where(g > 1e-6, -gy / g, 0.0)
    inner = np.zeros_like(far)
    inner[MARGIN:-MARGIN, MARGIN:-MARGIN] = True
    return dict(wh=wh, hs=gaussian_filter(wh, 3), lum=lum.astype(np.float32), idx=idx, ok=far & inner, g=g, fx=fx, fy=fy)


def profile(img, y, x, uy, ux, t):
    return map_coordinates(img, [y + uy * t, x + ux * t], order=1, mode='nearest')


def spectra(root, names):
    t = np.arange(-32, 32, dtype=np.float32)
    win = np.hanning(len(t)).astype(np.float32)
    freqs = np.fft.rfftfreq(len(t))
    rng = np.random.default_rng(5)
    acc = {}
    for m in iter_maps(root, names):
        for x0, y0, x1, y1 in tiles(m):
            P = prepare(m, x0, y0, x1, y1)
            ys, xs = np.nonzero(P['ok'])
            if len(ys) == 0:
                continue
            gb = np.digitize(P['g'][ys, xs], SLOPES) - 1
            for b in range(len(SLOPES) - 1):
                sel = np.nonzero(gb == b)[0]
                if len(sel) == 0:
                    continue
                sel = rng.choice(sel, min(len(sel), 150), replace=False)
                for k in sel:
                    y, x = ys[k], xs[k]
                    ux, uy = P['fx'][y, x], P['fy'][y, x]
                    facing = ux * LIGHT[0] + uy * LIGHT[1]
                    fb = 0 if b == 0 else (1 if facing > .5 else 2 if facing < -.5 else 3)
                    key = (m.name, b, fb)
                    for dname, (vy, vx) in (('fall', (uy, ux)), ('contour', (ux, -uy))):
                        p = profile(P['lum'], y, x, vy, vx, t)
                        p = p - np.polyval(np.polyfit(t, p, 1), t)
                        pw = np.abs(np.fft.rfft(p * win)) ** 2
                        a = acc.setdefault(key, {'n': 0, 'fall': 0, 'contour': 0, 'slope': 0})
                        a[dname] = a[dname] + pw
                    a['n'] += 1
                    a['slope'] += P['g'][y, x]
        print('done', m.name, file=sys.stderr)
    return freqs, acc


def report_spectra(freqs, acc):
    wl = np.where(freqs > 0, 1 / np.maximum(freqs, 1e-9), np.inf)
    band = (wl >= 4) & (wl <= 32)
    facing_name = {0: 'level', 1: 'lit', 2: 'shaded', 3: 'side'}
    rows = []
    maps = sorted({k[0] for k in acc})
    for name in maps + ['ALL']:
        for b in range(len(SLOPES) - 1):
            for fb in range(4):
                keys = [k for k in acc if (name == 'ALL' or k[0] == name) and k[1] == b and k[2] == fb]
                n = sum(acc[k]['n'] for k in keys)
                if n < 60:
                    continue
                F = sum(acc[k]['fall'] for k in keys) / n
                C = sum(acc[k]['contour'] for k in keys) / n
                slope = sum(acc[k]['slope'] for k in keys) / n
                ratio = F[band].sum() / C[band].sum()
                excess = np.where(band, F - C, 0)
                pk = int(np.argmax(excess))
                rows.append(dict(map=name, slope_bin=f'{SLOPES[b]}-{SLOPES[b + 1]}', mean_slope=round(float(slope), 3),
                                 facing=facing_name[fb], n=n, across_over_along=round(float(ratio), 2),
                                 excess_peak_px=round(float(wl[pk]), 1),
                                 excess_peak_units=round(float(wl[pk] * slope), 1),
                                 excess_share=round(float(excess[band].clip(0).sum() / F[band].sum()), 2)))
    return rows


def bandpass(P):
    """Band-pass luminance smoothed along the contour (Gaussian, sigma 4 px,
    oriented by the local fall line): isotropic grain averages out, lines
    that run along the contour survive."""
    lum = P['lum']
    B = gaussian_filter(lum, .8) - gaussian_filter(lum, 6)
    H, W = B.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    ty, tx = P['fx'], -P['fy']  # contour direction
    acc = np.zeros_like(B)
    wsum = 0.0
    for k in range(-8, 9):
        w = np.exp(-.5 * (k / 4.0) ** 2)
        acc += w * map_coordinates(B, [yy + ty * k, xx + tx * k], order=1, mode='nearest')
        wsum += w
    return B, acc / wsum, yy, xx


def find_lines(P, thr):
    """Dark-line pixels: oriented band-pass minima along the fall line (the
    lowest within +-2 px), below -thr, in components that run at least 8 px
    along the contour."""
    B, Bo, yy, xx = bandpass(P)
    fy, fx = P['fy'], P['fx']
    line = (Bo < -thr) & P['ok']
    for k in (1, 2):
        for sgn in (1, -1):
            line &= Bo <= map_coordinates(Bo, [yy + sgn * fy * k, xx + sgn * fx * k], order=1, mode='nearest')
    lab, n = label(line, np.ones((3, 3)))
    if n:
        ys, xs = np.nonzero(lab)
        ids = lab[ys, xs]
        s = xs * P['fx'][ys, xs] - ys * P['fy'][ys, xs]  # along-contour coordinate (approx.)
        smin = np.full(n + 1, np.inf); smax = np.full(n + 1, -np.inf)
        np.minimum.at(smin, ids, s); np.maximum.at(smax, ids, s)
        extent = smax - smin + 1
        keep = extent >= 8
        keep[0] = False
        line = keep[lab]
        lab, n = label(line, np.ones((3, 3)))
    return B, Bo, line, lab, n


def thin(mask):
    """Zhang-Suen thinning (numpy)."""
    m = np.pad(mask.astype(np.uint8), 1)
    while True:
        changed = False
        for step in (0, 1):
            P2, P3, P4, P5 = m[:-2, 1:-1], m[:-2, 2:], m[1:-1, 2:], m[2:, 2:]
            P6, P7, P8, P9 = m[2:, 1:-1], m[2:, :-2], m[1:-1, :-2], m[:-2, :-2]
            nb = [P2, P3, P4, P5, P6, P7, P8, P9]
            Bn = sum(x.astype(np.int32) for x in nb)
            A = sum(((nb[i] == 0) & (nb[(i + 1) % 8] == 1)).astype(np.int32) for i in range(8))
            c = m[1:-1, 1:-1] == 1
            if step == 0:
                cond = c & (Bn >= 2) & (Bn <= 6) & (A == 1) & (P2 * P4 * P6 == 0) & (P4 * P6 * P8 == 0)
            else:
                cond = c & (Bn >= 2) & (Bn <= 6) & (A == 1) & (P2 * P4 * P8 == 0) & (P2 * P6 * P8 == 0)
            if cond.any():
                m[1:-1, 1:-1][cond] = 0
                changed = True
        if not changed:
            return m[1:-1, 1:-1].astype(bool)


def junctions(skel):
    """(branch points, end points) of a 1-px skeleton by crossing number."""
    m = np.pad(skel.astype(np.uint8), 1)
    nb = [m[:-2, 1:-1], m[:-2, 2:], m[1:-1, 2:], m[2:, 2:], m[2:, 1:-1], m[2:, :-2], m[1:-1, :-2], m[:-2, :-2]]
    cn = sum(((nb[i] == 0) & (nb[(i + 1) % 8] == 1)).astype(np.int32) for i in range(8))
    return skel & (cn >= 3), skel & (cn == 1)


def map_threshold(m):
    """3 sigma of the oriented band-pass on the map's level ground."""
    flat = []
    for x0, y0, x1, y1 in list(tiles(m))[::3]:
        P = prepare(m, x0, y0, x1, y1)
        sel = P['ok'] & (P['g'] < .02)
        if sel.sum() > 1000:
            flat.append(bandpass(P)[1][sel][::7])
    return 3.0 * float(np.std(np.concatenate(flat))) if flat else 6.0


def lines(root, out, names):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(11)
    t = np.arange(-12, 13, dtype=np.float32)
    stats = {}
    for m in iter_maps(root, names):
        thr = map_threshold(m)
        S = stats.setdefault(m.name, {})
        for x0, y0, x1, y1 in tiles(m):
            P = prepare(m, x0, y0, x1, y1)
            B, Bo, line, lab, n = find_lines(P, thr)
            skel = thin(line)
            br, ep = junctions(skel)
            g = P['g']
            facing = P['fx'] * LIGHT[0] + P['fy'] * LIGHT[1]
            fb = np.where(g < .03, 0, np.where(facing > .5, 1, np.where(facing < -.5, 2, 3)))
            gb = np.digitize(g, SLOPES) - 1
            binid = gb * 4 + fb
            lum = P['lum']
            for key in np.unique(binid[P['ok']]):
                sel = P['ok'] & (binid == key)
                e = S.setdefault(int(key), dict(px=0, slope=0.0, skel=0, branch=0, end=0, dpx=[], dh=[], slopes_at=[],
                                                prof=np.zeros(len(t)), prof_n=0, idx=np.zeros((5, 256)), runs=[]))
                e['px'] += int(sel.sum())
                e['slope'] += float(g[sel].sum())
                sk = skel & sel
                e['skel'] += int(sk.sum())
                e['branch'] += int((br & sel).sum())
                e['end'] += int((ep & sel).sum())
                ly, lx = np.nonzero(sk)
                if len(ly) == 0:
                    continue
                for k in rng.choice(len(ly), min(len(ly), 80), replace=False):
                    y, x = ly[k], lx[k]
                    uy, ux = P['fy'][y, x], P['fx'][y, x]
                    pr = profile(lum, y, x, uy, ux, t)
                    e['prof'] += pr
                    e['prof_n'] += 1
                    for j, o in enumerate((-2, -1, 0, 1, 2)):
                        yy, xx = int(round(y + uy * o)), int(round(x + ux * o))
                        if 0 <= yy < lum.shape[0] and 0 <= xx < lum.shape[1]:
                            e['idx'][j, P['idx'][yy, xx]] += 1
                    tt = np.arange(0, 41, dtype=np.float32)
                    hit = profile(line.astype(np.float32), y, x, uy, ux, tt) > .5
                    after = np.nonzero(~hit)[0]
                    if len(after):
                        nxt = np.nonzero(hit[after[0]:])[0]
                        if len(nxt):
                            j = after[0] + nxt[0]
                            hh = profile(P['hs'], y, x, uy, ux, np.array([0, tt[j]], np.float32))
                            e['dpx'].append(float(tt[j]))
                            e['dh'].append(float(hh[0] - hh[1]))
                            e['slopes_at'].append(float(g[y, x]))
            # runs: along-contour extent of each component, binned by its centre
            if n:
                ys, xs = np.nonzero(lab)
                ids = lab[ys, xs]
                s = xs * P['fx'][ys, xs] - ys * P['fy'][ys, xs]
                smin = np.full(n + 1, np.inf); smax = np.full(n + 1, -np.inf)
                np.minimum.at(smin, ids, s); np.maximum.at(smax, ids, s)
                cy = np.zeros(n + 1); cx = np.zeros(n + 1); cnt = np.zeros(n + 1)
                np.add.at(cy, ids, ys); np.add.at(cx, ids, xs); np.add.at(cnt, ids, 1)
                for c in range(1, n + 1):
                    key = int(binid[int(cy[c] / cnt[c]), int(cx[c] / cnt[c])])
                    if key in S:
                        S[key]['runs'].append(float(smax[c] - smin[c] + 1))
        print('done', m.name, 'thr %.1f' % thr, file=sys.stderr)
    rows = []
    merged = {}
    for name, S in stats.items():
        for key, e in S.items():
            rows.append(summarise(name, key, e, t))
            M = merged.setdefault(key, None)
            if M is None:
                merged[key] = {k: (v.copy() if isinstance(v, (list, np.ndarray)) else v) for k, v in e.items()}
            else:
                for k, v in e.items():
                    M[k] = M[k] + v
    for key, e in merged.items():
        rows.append(summarise('ALL', key, e, t))
    (out / 'lines.json').write_text(json.dumps(rows, indent=1))
    return rows


FACING = {0: 'level', 1: 'lit', 2: 'shaded', 3: 'side'}


def summarise(name, key, e, t):
    b, f = divmod(int(key), 4)
    dpx, dh = np.array(e['dpx']), np.array(e['dh'])
    runs = np.array(e['runs'])
    cv = lambda a: round(float(np.std(a) / np.mean(a)), 2) if len(a) > 5 and np.mean(a) > 0 else None
    pct = lambda a, q: [round(float(v), 1) for v in np.percentile(a, q)] if len(a) else []
    prof = e['prof'] / max(1, e['prof_n'])
    idx = e['idx']
    tops = [[int(i) for i in np.argsort(-idx[j])[:4] if idx[j, i] > 0] for j in range(5)]
    sk = max(1, e['skel'])
    return dict(map=name, slope_bin=f'{SLOPES[b]}-{SLOPES[b + 1]}', facing=FACING[f], px=e['px'],
                mean_slope=round(e['slope'] / max(1, e['px']), 3),
                line_share=round(e['skel'] / max(1, e['px']), 4),
                branch_per_100px=round(100 * e['branch'] / sk, 2), end_per_100px=round(100 * e['end'] / sk, 2),
                n_spacing=len(dpx), dpx_p25_50_75=pct(dpx, [25, 50, 75]), dpx_cv=cv(dpx),
                dh_p25_50_75=pct(dh, [25, 50, 75]), dh_cv=cv(dh),
                runs_p50_75_90=pct(runs, [50, 75, 90]), n_runs=len(runs),
                profile_lum=[round(float(v), 1) for v in prof] if e['prof_n'] else [],
                idx_at_offsets_m2_to_p2=tops)

def show(mapdir, x, y, size, out):
    """World-space crop beside its detected lines (red: kept lines, yellow:
    branch points), 2x."""
    from PIL import Image
    m = RetailMap(mapdir)
    thr = map_threshold(m)
    x0, y0 = max(0, x - MARGIN), max(0, y - MARGIN)
    P = prepare(m, x0, y0, min(m.W, x + size + MARGIN), min(m.H, y + size + MARGIN))
    B, Bo, line, lab, n = find_lines(P, thr)
    skel = thin(line)
    br, ep = junctions(skel)
    sl = np.s_[y - y0:y - y0 + size, x - x0:x - x0 + size]
    rgb = m.palette[P['idx']][sl]
    ov = rgb.copy()
    ov[skel[sl]] = [255, 40, 40]
    ov[br[sl]] = [255, 255, 0]
    img = np.concatenate([rgb, ov], 1)
    Image.fromarray(img).resize((img.shape[1] * 2, img.shape[0] * 2), Image.NEAREST).save(out)
    print('threshold %.1f' % thr)


def trace(P, y, x, sign, stop_slope=.05, steps=400):
    """Follow the fall line (sign +1 downhill, -1 uphill) from (y, x) until the
    ground levels out, the tile ends or land ends; returns the path."""
    H, W = P['g'].shape
    path = [(y, x)]
    for _ in range(steps):
        iy, ix = int(round(y)), int(round(x))
        if not (MARGIN // 2 <= iy < H - MARGIN // 2 and MARGIN // 2 <= ix < W - MARGIN // 2):
            return path, 'edge'
        if not P['land'][iy, ix]:
            return path, 'lava'
        if P['g'][iy, ix] < stop_slope and len(path) > 3:
            return path, 'level'
        y += sign * P['fy'][iy, ix]
        x += sign * P['fx'][iy, ix]
        path.append((y, x))
    return path, 'long'


def faces(root, out, names, sigma_k=2.0):
    """Whole-face transects: from a seed on a slope, trace the fall line up to
    the crest and down to the foot, then count dark lines crossed. If bands
    are a fixed height step, the count follows the face's height drop; if
    they are a fixed spacing on the ground, it follows the path length."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(3)
    rows = []
    for m in iter_maps(root, names):
        thr = map_threshold(m) * sigma_k / 3.0
        for x0, y0, x1, y1 in tiles(m):
            P = prepare(m, x0, y0, x1, y1)
            wh, lum, idx, vis = world_tile(m, x0, y0, x1, y1)
            P['land'] = vis & ~LAVA[idx]
            B, Bo, line, lab, n = find_lines(P, thr)
            ys, xs = np.nonzero(P['ok'] & (P['g'] > .3))
            if len(ys) == 0:
                continue
            for k in rng.choice(len(ys), min(len(ys), 25), replace=False):
                y, x = float(ys[k]), float(xs[k])
                up, why_up = trace(P, y, x, -1)
                down, why_down = trace(P, y, x, +1)
                if why_up != 'level' or why_down not in ('level', 'lava'):
                    continue
                path = up[::-1] + down[1:]
                py = np.array([p[0] for p in path]); px = np.array([p[1] for p in path])
                L = float(np.hypot(np.diff(py), np.diff(px)).sum())
                hh = map_coordinates(P['hs'], [py, px], order=1)
                dh = float(hh[0] - hh[-1])
                hit = map_coordinates(line.astype(np.float32), [py, px], order=0) > .5
                # distinct crossings: rising edges, merging hits within 2 px
                cnt, last = 0, -9
                for i in np.nonzero(hit)[0]:
                    if i - last > 2:
                        cnt += 1
                    last = i
                iy, ix = int(round(y)), int(round(x))
                facing = P['fx'][iy, ix] * LIGHT[0] + P['fy'][iy, ix] * LIGHT[1]
                rows.append(dict(map=m.name, x=x0 + x, y=y0 + y, length=round(L, 1), dh=round(dh, 1), lines=cnt,
                                 facing=round(float(facing), 2), foot=why_down, max_slope=round(float(map_coordinates(P['g'], [py, px], order=1).max()), 2)))
        print('done', m.name, file=sys.stderr)
    (out / 'faces.json').write_text(json.dumps(rows))
    return rows


def topology(root, names, min_slope=.15):
    """Branch and end points per 100 px of line, on a skeleton of the
    thresholded oriented band-pass (no fall-line suppression, so lines that
    meet stay joined), on slopes above min_slope."""
    out = {}
    for m in iter_maps(root, names):
        thr = map_threshold(m)
        tot = np.zeros(3)
        for x0, y0, x1, y1 in tiles(m):
            P = prepare(m, x0, y0, x1, y1)
            B, Bo, yy, xx = bandpass(P)
            mask = (Bo < -.7 * thr) & P['ok'] & (P['g'] > min_slope)
            lab, n = label(mask, np.ones((3, 3)))
            if n == 0:
                continue
            keep = np.bincount(lab.ravel()) >= 12
            keep[0] = False
            sk = thin(keep[lab])
            br, ep = junctions(sk)
            tot += [sk.sum(), br.sum(), ep.sum()]
        out[m.name] = dict(line_px=int(tot[0]), branch_per_100px=round(100 * tot[1] / max(1, tot[0]), 2),
                           end_per_100px=round(100 * tot[2] / max(1, tot[0]), 2))
        print(m.name, out[m.name], file=sys.stderr)
    return out


if __name__ == '__main__':
    cmd, root = sys.argv[1], sys.argv[2]
    if cmd == 'spectra':
        freqs, acc = spectra(root, sys.argv[3:])
        for r in report_spectra(freqs, acc):
            print(json.dumps(r))
    elif cmd == 'topology':
        print(json.dumps(topology(root, sys.argv[3:])))
    elif cmd == 'faces':
        rows = faces(root, sys.argv[3], sys.argv[4:])
        print(len(rows), 'faces')
    elif cmd == 'lines':
        for r in lines(root, sys.argv[3], sys.argv[4:]):
            print(json.dumps({k: v for k, v in r.items() if k not in ('profile_lum', 'idx_at_offsets_m2_to_p2')}))
