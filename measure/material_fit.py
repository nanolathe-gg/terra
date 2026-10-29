"""Fit the band amplitudes of Green's material model to the measured bands (card H3, item 3).

A dev tool. It renders swatches from material-model.wgsl (measure/swatch.mjs, headless Chrome),
measures their luma bands as material_numbers.py measures the prepared images, and moves each
band's amplitude by the ratio of the measured band to the swatch's, then rescales z to unit
variance (the ramp supplies the histogram only when z is a unit normal). It writes the `model`
rows of materials/green.json.

  material_fit.py <materials/green.json> <work-dir> [--rounds 6] [--cdp 9663]
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi

HERE = Path(__file__).resolve().parent
SIGMAS = [0.0] + [0.7 * 2 ** k for k in range(7)]
LUMA = np.array([.299, .587, .114])
ORDER = ['ground', 'slopeGrass', 'rock', 'weathered', 'fractured']


def lattice_variance(cell_x, cell_y):
    """Variance of smoothstep value noise on a lattice of uniform hashes, scaled to -1..1 (cells of 2+ px, so no pixel aligns with a node)."""
    rng = np.random.default_rng(1)
    g = rng.random((258, 258)) * 2 - 1
    f = (np.arange(4096) + .5) / 64.0 % 1.0
    w = f * f * (3 - 2 * f)
    # separable bilinear with the smoothstep weights: sample variance over a full cell grid
    n = 64
    ww = np.array([(1 - w[:n]), w[:n]])
    tot = 0.0
    xs = np.linspace(0, 1, n, endpoint=False) + .5 / n
    wx = xs * xs * (3 - 2 * xs)
    v = ((1 - wx) ** 2 + wx ** 2).mean()
    return v * v / 3.0   # (sum of squared weights in x) * (in y) * var(hash in -1..1) = 1/3


def bands(L):
    m = 24
    blurred = [L if s == 0 else ndi.gaussian_filter(L, s, mode='mirror') for s in SIGMAS]
    return np.array([(blurred[k] - blurred[k + 1])[m:-m, m:-m].std() for k in range(7)]), blurred[-1][m:-m, m:-m].std()


def run(table, work, rounds, cdp, foot=1):
    work.mkdir(parents=True, exist_ok=True)
    tab = work / 'table.json'
    tab.write_text(json.dumps(table))
    subprocess.run(['node', str(HERE / 'swatch.mjs'), str(tab), str(work / 'sw'), '--foot', str(foot), '--cdp', str(cdp)], check=True, capture_output=True)
    out = {}
    for name in ORDER:
        n = json.loads((work / 'sw' / 'meta.json').read_text())['size']
        out[name] = np.fromfile(work / 'sw' / f'{name}.rgba', np.uint8).reshape(n, n, 4)[..., :3].astype(float)
    return out


def main():
    args = sys.argv[1:]
    rounds = int(args[args.index('--rounds') + 1]) if '--rounds' in args else 6
    cdp = int(args[args.index('--cdp') + 1]) if '--cdp' in args else 9663
    for flag in ('--rounds', '--cdp'):
        if flag in args:
            del args[args.index(flag):args.index(flag) + 2]
    path, work = Path(args[0]), Path(args[1])
    table = json.loads(path.read_text())
    table['order'] = ORDER
    v_lat = lattice_variance(2, 2)
    var = np.array([1 / 3] + [v_lat] * 6)
    model = table.get('model', {})
    for name in ORDER:
        m = table['measured'][name]
        target = np.array(m['bands'])
        a = target / np.sqrt(var)
        if name in model:
            a = np.array(model[name]['amps'])
        a = a / np.sqrt((a * a * var).sum())
        lag = m['tintLag'] if m['tintLag'] is not None else 0.0
        model[name] = {'amps': a.tolist(), 'stretch': 1.0, 'tintMix': float(np.clip(2.0 * lag, 0, .8)), 'tintScale': 1.0}
    table['model'] = model
    for r in range(rounds):
        sw = run(table, work, r, cdp)
        worst = 0
        for name in ORDER:
            L = sw[name] @ LUMA
            b, broad = bands(L)
            target = np.array(table['measured'][name]['bands'])
            ratio = np.clip(target / np.maximum(b, 1e-3), .5, 2.0) ** .8
            a = np.array(model[name]['amps']) * ratio
            a = a / np.sqrt((a * a * var).sum())
            model[name]['amps'] = [round(float(v), 4) for v in a]
            worst = max(worst, float(np.abs(b / target - 1).max()))
            if r == rounds - 1 or r == 0:
                print(f'round {r} {name:10s} bands {np.round(b, 2).tolist()} target {target.tolist()} sd {L.std():.1f}/{table["measured"][name]["lumaSd"]}')
        print(f'round {r}: worst band error {worst:.2f}')
        table['model'] = model
    path.write_text(json.dumps(table, indent=1) + '\n')


main()
