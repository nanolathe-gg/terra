"""The tan problem: choose a world's ground and rock colours near short palette segments, automatically, as data.

    python3 -I docs/research/tx-tan.py [--tau 0.02,0.035]
    python3 -I docs/research/tx-tan.py --png OUT/tx-tan--*.png     (grain of the lab renders of exp/tx-tan.js)

A material colour is drawn at many light levels, so what dithers is its whole shading line, not its mean. For an
albedo A (sRGB), the line is A's linear rgb times eight light levels (0.30 to 1.30). Each lit colour is quantised
the way card P9 proposes (Knoll, 8 candidates, error multiplier 0.4, mixed equally); its grain is the RMS spread of
the candidates around their mean (palette-mix.py's measure) and its error the distance of that mean from the colour.
cost(A) = mean over the line of (grain + 2 error), OKLab x 100.

The search moves A within tau in OKLab (lightness within +-0.015, the rest in chroma and hue, on a 0.004 grid) and
keeps the cheapest; a third column keeps the hue within 6 degrees and the chroma at 80% or more. A world with palette.entries is searched against those colours only (the engine's rule). The
result is new numbers for the material table (measured.ground.meanRGB, material.rockMeanRGB and the like): data,
not code, and one search per world at authoring time. Reads materials/*.json only. Needs numpy.
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]])
M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]])
LIGHT = np.array([0.30, 0.42, 0.55, 0.70, 0.85, 1.0, 1.15, 1.30])


def to_lin(rgb255):
    c = np.asarray(rgb255, float) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_oklab(lin):
    return np.cbrt(np.maximum(lin @ M1.T, 0)) @ M2.T


def oklab_to_lin(L):
    return (L @ np.linalg.inv(M2).T) ** 3 @ np.linalg.inv(M1).T


def to_srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055) * 255


def knoll_stats(G, P, n=8, m=0.4):
    err = np.zeros_like(G); cs = []
    pp = (P * P).sum(1)
    for _ in range(n):
        c = (pp[None, :] - 2 * (G + err * m) @ P.T).argmin(1); cs.append(c); err += G - P[c]
    C = np.stack(cs, 1); mean = P[C].mean(1)
    grain = np.sqrt(((P[C] - mean[:, None, :]) ** 2).sum(-1).mean(1))
    return grain, np.sqrt(((mean - G) ** 2).sum(-1)), C


def line_cost(albedo_lin, P):
    """albedo_lin: (k, 3). Returns per albedo (cost, grain, error, distinct colours on its line), x100."""
    k = len(albedo_lin)
    lit = np.clip(albedo_lin[:, None, :] * LIGHT[None, :, None], 0, 1).reshape(-1, 3)
    g, e, C = knoll_stats(lin_to_oklab(lit), P)
    g = g.reshape(k, -1).mean(1) * 100; e = e.reshape(k, -1).mean(1) * 100
    cols = np.array([len(np.unique(r)) for r in C.reshape(k, -1)])
    return g + 2 * e, g, e, cols


def search(rgb, P, tau, lock=False):
    A = lin_to_oklab(to_lin(rgb)[None])[0]
    s = np.arange(-tau, tau + 1e-9, 0.004)
    da, db, dl = np.meshgrid(s, s, np.array([-0.015, -0.0075, 0, 0.0075, 0.015]), indexing='ij')
    off = np.stack([dl.ravel(), da.ravel(), db.ravel()], 1)
    off = off[np.sqrt((off ** 2).sum(1)) <= tau + 1e-9]
    if lock and np.hypot(A[1], A[2]) > 0.02:     # keep the hue within 6 degrees and at least 80% of the chroma
        c0 = np.hypot(A[1], A[2]); h0 = np.arctan2(A[2], A[1]); B = A[None] + off
        dh = np.abs((np.arctan2(B[:, 2], B[:, 1]) - h0 + np.pi) % (2 * np.pi) - np.pi)
        off = off[(dh <= np.radians(6)) & (np.hypot(B[:, 1], B[:, 2]) >= 0.8 * c0)]
    cand = A[None] + off
    lin = oklab_to_lin(cand)
    ok = (lin >= 0).all(1) & (lin <= 1).all(1)
    cand, lin, off = cand[ok], lin[ok], off[ok]
    cost, g, e, cols = line_cost(lin, P)
    i0 = np.argmin(np.abs(off).sum(1))            # the unmoved colour
    i = int(cost.argmin())
    return dict(rgb0=rgb, g0=g[i0], e0=e[i0], c0=cols[i0], rgb=to_srgb(lin[i]), g=g[i], e=e[i], c=cols[i],
                de=np.sqrt((off[i] ** 2).sum()) * 100)


def png_grain(paths):
    """Grain of lab renders (RMS of the image minus its 1 px Gaussian blur, OKLab x 100) and colours used."""
    from PIL import Image
    k = np.exp(-np.arange(-3, 4) ** 2 / 2.0); k /= k.sum()
    for p in paths:
        L = lin_to_oklab(to_lin(np.asarray(Image.open(p).convert('RGB'), float)))
        b = sum(k[i] * np.pad(L, ((3, 3), (0, 0), (0, 0)), mode='reflect')[i:i + L.shape[0]] for i in range(7))
        b = sum(k[i] * np.pad(b, ((0, 0), (3, 3), (0, 0)), mode='reflect')[:, i:i + L.shape[1]] for i in range(7))
        g = np.sqrt(((L - b)[4:-4, 4:-4] ** 2).sum(-1).mean()) * 100
        n = len(np.unique(np.asarray(Image.open(p).convert('RGB')).reshape(-1, 3), axis=0))
        print(f'{os.path.basename(p):>32}: grain {g:5.2f}, {n} colours')


def main():
    if '--png' in sys.argv:
        return png_grain(sys.argv[sys.argv.index('--png') + 1:])
    taus = [0.02, 0.035]
    if '--tau' in sys.argv:
        taus = [float(t) for t in sys.argv[sys.argv.index('--tau') + 1].split(',')]
    pal = np.array(json.load(open(os.path.join(ROOT, 'materials', 'palette.json')))['colours'], dtype=np.float64)
    rows = []
    for w in ['desert', 'archipelago', 'zhon', 'red', 'lava', 'green', 'moon']:
        t = json.load(open(os.path.join(ROOT, 'materials', f'{w}.json')))
        ent = t.get('palette', {}).get('entries')
        P = lin_to_oklab(to_lin(pal[ent] if ent else pal))
        meas = t.get('measured', {})
        mats = [(k, meas[k]['meanRGB']) for k in ('ground', 'quilt', 'body', 'beach') if k in meas]
        mats.append(('rockMeanRGB', t['material']['rockMeanRGB']))
        for name, rgb in mats:
            rows.append((w, name, len(P), [search(np.asarray(rgb, float), P, tau) for tau in taus] + [search(np.asarray(rgb, float), P, max(taus), True)]))
    print(f'Knoll x0.4 over the shading line (8 light levels); grain and error x100 OKLab; tau = {taus}')
    print(f'{"world":>11} {"material":>12} pal | {"before":>21} | ' + ' | '.join(f'{"tau " + str(t):>40}' for t in taus) + f' | {"hue-locked, tau " + str(max(taus)):>40}')
    print(f'{"":>11} {"":>12}     | {"grain err cols":>21} | ' + ' | '.join(f'{"grain err cols  dE  rgb":>40}' for _ in taus + [0]))
    for w, name, n, rs in rows:
        r0 = rs[0]
        cells = [f'{r["g"]:5.2f} {r["e"]:4.2f} {r["c"]:3d} {r["de"]:4.1f}  [{", ".join(f"{v:.0f}" for v in r["rgb"])}]' for r in rs]
        print(f'{w:>11} {name:>12} {n:3d} | {r0["g0"]:5.2f} {r0["e0"]:4.2f} {r0["c0"]:3d} [{", ".join(f"{v:.0f}" for v in r0["rgb0"])}] | ' + ' | '.join(f'{c:>40}' for c in cells))


if __name__ == '__main__':
    main()
