"""How well palette dithering reaches the colours asked for, over the 32^3 colour cube of engine-palette.wgsl.

For each cube colour near the palette (nearest colour within 0.08 in OKLab), it compares:
  - the nearest colour;
  - the engine's best pair (engine-palette.wgsl: among the ten nearest in OKLab, the segment passing closest, with the
    0.1 |b - a|^2 t (1 - t) penalty), mixed in the ideal share t;
  - Knoll pattern dithering: n candidates by error accumulation (multiplier m) in OKLab, mixed equally.
Error: the OKLab distance of the mixture's mean from the colour asked for. Grain: the RMS spread of the colours used
around their mean (how noisy a flat area looks). Both x100.

    python3 -I docs/research/palette-mix.py [--world desert]

Reads materials/palette.json (and a world's palette.entries) only. Needs numpy.
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]])
M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]])


def oklab(rgb255):
    c = rgb255 / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return np.cbrt(np.maximum(lin @ M1.T, 0)) @ M2.T


def measure(P):
    PL = oklab(P)
    g = np.arange(32) * 255.0 / 31.0
    L = oklab(np.stack(np.meshgrid(g, g, g, indexing='ij'), -1).reshape(-1, 3))
    d = ((L[:, None, :] - PL[None, :, :]) ** 2).sum(-1)
    near = np.sqrt(d.min(1))
    inside = near < 0.08
    rows = [('nearest', near, np.zeros_like(near))]
    k = min(10, len(P))
    idx = np.argsort(d, 1)[:, :k]
    best = np.full(len(L), 1e30)
    perr = np.zeros(len(L))
    pgrain = np.zeros(len(L))
    for i in range(k):
        for j in range(i, k):
            a, b = PL[idx[:, i]], PL[idx[:, j]]
            dv = b - a
            dd = np.maximum((dv * dv).sum(1), 1e-12)
            t = np.clip(((L - a) * dv).sum(1) / dd, 0, 1)
            p = a + dv * t[:, None]
            e = ((L - p) ** 2).sum(1) + 0.1 * dd * t * (1 - t)
            better = e < best
            best = np.where(better, e, best)
            perr = np.where(better, np.sqrt(((L - p) ** 2).sum(1)), perr)
            pgrain = np.where(better, np.sqrt(dd * t * (1 - t)), pgrain)
    rows.append(('engine pair', perr, pgrain))
    for m in (0.4, 0.6, 0.85):
        for n in (4, 8):
            err = np.zeros_like(L)
            cs = []
            for _ in range(n):
                c = (((L + err * m)[:, None, :] - PL[None, :, :]) ** 2).sum(-1).argmin(1)
                cs.append(PL[c])
                err += L - PL[c]
            mean = sum(cs) / n
            rows.append((f'knoll n{n} x{m}', np.sqrt(((L - mean) ** 2).sum(1)), np.sqrt(np.mean([((c - mean) ** 2).sum(1) for c in cs], 0))))
    print(f'{inside.sum()} cube colours within 0.08 of the palette ({len(P)} colours)')
    for name, e, gr in rows:
        ei, gi = e[inside], gr[inside]
        print(f'  {name:>15}: error mean {ei.mean() * 100:5.2f} p90 {np.percentile(ei, 90) * 100:5.2f} | grain mean {gi.mean() * 100:5.2f} p90 {np.percentile(gi, 90) * 100:5.2f}')


def main():
    pal = np.array(json.load(open(os.path.join(ROOT, 'materials', 'palette.json')))['colours'], dtype=np.float64)
    if '--world' in sys.argv:
        world = sys.argv[sys.argv.index('--world') + 1]
        entries = json.load(open(os.path.join(ROOT, 'materials', f'{world}.json'))).get('palette', {}).get('entries')
        if entries:
            pal = pal[entries]
    measure(pal)


if __name__ == '__main__':
    main()
