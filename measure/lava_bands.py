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

from lava_maps import RetailMap
from lava_world import LAVA, world_tile

SLOPES = [0, .03, .07, .15, .3, .5, .8, 1.2, 2.0]
TILE, MARGIN = 768, 48
# Light comes from the west: a face whose downhill direction points west
# (-x) faces the light. facing = dot(downhill, toward the light).
LIGHT = np.array([-1.0, -.15])
LIGHT /= np.hypot(*LIGHT)


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
    for d in sorted(Path(root).iterdir()):
        if not (d / 'metadata.json').exists() or (names and not any(n in d.name for n in names)):
            continue
        m = RetailMap(d)
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


def find_lines(P, thr):
    """Dark-line pixels: band-pass minima along the fall line, below -thr."""
    lum = P['lum']
    B = gaussian_filter(lum, .8) - gaussian_filter(lum, 6)
    H, W = B.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    fy, fx = P['fy'], P['fx']
    a = map_coordinates(B, [yy + fy * 1.5, xx + fx * 1.5], order=1, mode='nearest')
    c = map_coordinates(B, [yy - fy * 1.5, xx - fx * 1.5], order=1, mode='nearest')
    line = (B < -thr) & (B <= a) & (B <= c) & P['ok']
    return B, line


def lines(root, out, names):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(11)
    t = np.arange(-40, 41, dtype=np.float32)
    stats = {}
    for d in sorted(Path(root).iterdir()):
        if not (d / 'metadata.json').exists() or (names and not any(n in d.name for n in names)):
            continue
        m = RetailMap(d)
        # Threshold from the map's level ground: band-pass spread there.
        flat = []
        for x0, y0, x1, y1 in list(tiles(m))[::3]:
            P = prepare(m, x0, y0, x1, y1)
            B = gaussian_filter(P['lum'], .8) - gaussian_filter(P['lum'], 6)
            sel = P['ok'] & (P['g'] < .02)
            if sel.sum() > 1000:
                flat.append(B[sel][::7])
        thr = 1.5 * float(np.std(np.concatenate(flat))) if flat else 6.0
        S = stats.setdefault(m.name, {'thr': thr, 'bins': {}})
        for x0, y0, x1, y1 in tiles(m):
            P = prepare(m, x0, y0, x1, y1)
            B, line = find_lines(P, thr)
            g = P['g']
            facing = P['fx'] * LIGHT[0] + P['fy'] * LIGHT[1]
            fb = np.where(g < .03, 0, np.where(facing > .5, 1, np.where(facing < -.5, 2, 3)))
            gb = np.digitize(g, SLOPES) - 1
            # Runs along the contour: connected dark-line components and the
            # extent of each across the fall direction.
            lab, n = label(line, np.ones((3, 3)))
            for b in range(len(SLOPES) - 1):
                for f in range(4):
                    sel = P['ok'] & (gb == b) & (fb == f)
                    cnt = int(sel.sum())
                    if cnt == 0:
                        continue
                    e = S['bins'].setdefault(f'{b}:{f}', {'px': 0, 'line_px': 0, 'spacing_px': [], 'spacing_units': [],
                                                          'prof_lum': np.zeros(len(t)), 'prof_n': 0, 'slope': 0.0,
                                                          'run_len': [], 'line_lum': [], 'idx': np.zeros(256)})
                    e['px'] += cnt
                    e['slope'] += float(g[sel].sum())
                    e['line_px'] += int((line & sel).sum())
                    ly, lx = np.nonzero(line & sel)
                    if len(ly) == 0:
                        continue
                    e['line_lum'].extend(P['lum'][ly, lx][::5].tolist())
                    e['idx'] += np.bincount(P['idx'][ly, lx], minlength=256)
                    pick = rng.choice(len(ly), min(len(ly), 60), replace=False)
                    for k in pick:
                        y, x = ly[k], lx[k]
                        uy, ux = P['fy'][y, x], P['fx'][y, x]
                        e['prof_lum'] += profile(P['lum'], y, x, uy, ux, t)
                        e['prof_n'] += 1
                        # next dark line downhill along the fall line
                        pl = profile(line.astype(np.float32), y, x, uy, ux, t) > .5
                        ph = profile(P['hs'], y, x, uy, ux, t)
                        down = np.nonzero(pl[42:])[0]
                        if len(down):
                            j = 42 + down[0]
                            e['spacing_px'].append(float(t[j]))
                            e['spacing_units'].append(float(ph[40] - ph[j]))
                    comp = np.unique(lab[ly, lx])
                    for c in comp[:40]:
                        cy, cx = np.nonzero(lab == c)
                        if len(cy) < 2:
                            continue
                        # extent along the local contour direction
                        uy, ux = P['fy'][cy[0], cx[0]], P['fx'][cy[0], cx[0]]
                        s = cx * (-uy) + cy * ux
                        e['run_len'].append(float(s.max() - s.min() + 1))
        print('done', m.name, file=sys.stderr)
    facing_name = {0: 'level', 1: 'lit', 2: 'shaded', 3: 'side'}
    rows = []
    allbins = {}
    for name, S in stats.items():
        for key, e in S['bins'].items():
            a = allbins.setdefault(key, [])
            a.append(e)
            rows.append(summarise(name, key, e, t, facing_name))
    for key, es in allbins.items():
        merged = {k: (sum((e[k] for e in es), [] if isinstance(es[0][k], list) else 0)) for k in es[0]}
        rows.append(summarise('ALL', key, merged, t, facing_name))
    (out / 'lines.json').write_text(json.dumps(rows, indent=1))
    return rows


def summarise(name, key, e, t, facing_name):
    b, f = (int(v) for v in key.split(':'))
    sp = np.array(e['spacing_px'])
    su = np.array(e['spacing_units'])
    rl = np.array(e['run_len'])
    prof = (e['prof_lum'] / max(1, e['prof_n'])).tolist() if e['prof_n'] else []
    pct = lambda a, q: [round(float(v), 2) for v in np.percentile(a, q)] if len(a) else []
    idx = np.asarray(e['idx'])
    top = [int(i) for i in np.argsort(-idx)[:6]] if idx.sum() else []
    return dict(map=name, slope_bin=f'{SLOPES[b]}-{SLOPES[b + 1]}', facing=facing_name[f], px=e['px'],
                mean_slope=round(e['slope'] / max(1, e['px']), 3),
                line_share=round(e['line_px'] / max(1, e['px']), 4),
                spacing_px_p25_50_75=pct(sp, [25, 50, 75]), spacing_units_p25_50_75=pct(su, [25, 50, 75]),
                run_px_p50_75_90=pct(rl, [50, 75, 90]), n_runs=len(rl),
                line_lum_p50=pct(e['line_lum'], [50]), line_top_indices=top,
                profile=[round(v, 1) for v in prof])


if __name__ == '__main__':
    cmd, root = sys.argv[1], sys.argv[2]
    if cmd == 'spectra':
        freqs, acc = spectra(root, sys.argv[3:])
        for r in report_spectra(freqs, acc):
            print(json.dumps(r))
    elif cmd == 'lines':
        for r in lines(root, sys.argv[3], sys.argv[4:]):
            if r['map'] == 'ALL':
                print(json.dumps({k: v for k, v in r.items() if k != 'profile'}))
