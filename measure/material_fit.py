"""Fit the band amplitudes of a world's material model to the measured bands (cards H3 and H14).

A dev tool. It renders swatches from engine-materials.wgsl (measure/swatch.mjs, headless Chrome),
measures their luma bands as material_numbers.py measures the prepared images, and moves each
band's amplitude by the ratio of the measured band to the swatch's, then rescales z to unit
variance (the ramp supplies the histogram only when z is a unit normal). It writes the `model`
rows of materials/<world>.json (the materials named in its `order`, once each).

  material_fit.py <materials/<world>.json> <work-dir> [--rounds 6] [--cdp 9663]

A lit material (card H14b: its `lit` block has a relief above 0) is not fitted by band ratios: its picture is a lit height field,
and its numbers (light, cells, seams, veins, relief, band amplitudes) are found by a pattern search on rendered swatches, with the
image itself as the target. That is lit_fit.py; this script hands it the material:

  material_fit.py --lit <table.json> <material> <image> <assets-dir> <work-dir> [--rounds 12] [--cdp 9681] [--fix key,key]
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
ORDER = []          # the table's materials, each once, in first-layer order (set in main)
LAYER = {}          # a material's first layer, whose noise salt the engine used


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


def u32(x):
    return np.asarray(x, np.uint64) & np.uint64(0xFFFFFFFF)


def hash2(ix, iy, salt):
    # mmHash of engine-materials.wgsl, in 32-bit arithmetic
    n = u32(u32(ix) * np.uint64(374761393) + u32(iy) * np.uint64(668265263) + np.uint64(salt) * np.uint64(2246822519))
    n = u32(u32(n ^ (n >> np.uint64(13))) * np.uint64(1274126177))
    n = u32(u32(n ^ (n >> np.uint64(16))) * np.uint64(2246822519))
    return (n ^ (n >> np.uint64(15))).astype(np.float64) / 4294967295.0


def z_quantiles(m, size=1024):
    """The model's z over a size x size field (mirror of mmColor's noise sum at foot 1), at MM_P."""
    salt = LAYER[next(k for k, v in TABLE_MODEL.items() if v is m)] * 16 + 1
    y, x = np.mgrid[0:size, 0:size].astype(np.float64) + .5
    a = m['amps']
    z = a[0] * (hash2(np.floor(x).astype(np.int64), np.floor(y).astype(np.int64), salt) * 2 - 1)
    for k in range(1, 7):
        cell = 2.0 ** k
        qx, qy = x / (cell * m['stretch']), y / cell
        cx, cy = np.floor(qx), np.floor(qy)
        fx, fy = qx - cx, qy - cy
        wx, wy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        cx, cy = cx.astype(np.int64), cy.astype(np.int64)
        h = lambda dx, dy: hash2(cx + dx, cy + dy, salt + k)
        v = (h(0, 0) * (1 - wx) + h(1, 0) * wx) * (1 - wy) + (h(0, 1) * (1 - wx) + h(1, 1) * wx) * wy
        z = z + a[k] * (v * 2 - 1)
    return np.quantile(z, P)


P = [0.001, 0.01, 0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.95, 0.99, 0.999]
TABLE_MODEL = {}


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
    if args and args[0] == '--lit':
        import lit_fit
        sys.argv = [sys.argv[0]] + args[1:]
        return lit_fit.main()
    rounds = int(args[args.index('--rounds') + 1]) if '--rounds' in args else 6
    cdp = int(args[args.index('--cdp') + 1]) if '--cdp' in args else 9663
    for flag in ('--rounds', '--cdp'):
        if flag in args:
            del args[args.index(flag):args.index(flag) + 2]
    path, work = Path(args[0]), Path(args[1])
    table = json.loads(path.read_text())
    for layer, name in enumerate(table['order']):
        if name not in LAYER:
            LAYER[name] = layer
            ORDER.append(name)
    v_lat = lattice_variance(2, 2)
    var = np.array([1 / 3] + [v_lat] * 6)
    model = table.get('model', {})
    for name in ORDER:
        m = table['measured'][name]
        target = np.array(m.get('smoothBands', m['bands']))
        a = target / np.sqrt(var)
        if name in model:
            a = np.array(model[name]['amps'])
        a = a / np.sqrt((a * a * var).sum())
        lag = m['tintLag'] if m['tintLag'] is not None else 0.0
        model[name] = {'amps': a.tolist(), 'stretch': 1.0, 'tintMix': float(np.clip(2.0 * lag, 0, .8)), 'tintScale': 1.0}
        if 'vocab' in m:
            # H14d: a dithered material has no grain band and no tint noise (the error diffusion is the pixel-level part).
            model[name].update(dither=1.0, tintScale=0.0)
            a[0] = 0.0
            a = a / np.sqrt((a * a * var).sum())
            model[name]['amps'] = a.tolist()
    table['model'] = model
    TABLE_MODEL.update(model)
    for n in ORDER:
        model[n]['zq'] = [round(float(v), 4) for v in z_quantiles(model[n])]
    for r in range(rounds):
        sw = run(table, work, r, cdp)
        worst = 0
        for name in ORDER:
            L = sw[name] @ LUMA
            ms = table['measured'][name]
            if 'smoothBands' in ms:
                L = ndi.gaussian_filter(L, ms['dither'], mode='wrap')   # a dithered material's smooth field is what is fitted
            b, broad = bands(L)
            target = np.array(ms.get('smoothBands', ms['bands']))
            ratio = np.clip(target / np.maximum(b, 1e-3), .5, 2.0) ** .8
            a = np.array(model[name]['amps']) * ratio
            a = a / np.sqrt((a * a * var).sum())
            model[name]['amps'] = [round(float(v), 4) for v in a]
            model[name]['zq'] = [round(float(v), 4) for v in z_quantiles(model[name])]
            worst = max(worst, float(np.abs(b / target - 1).max()))
            if r == rounds - 1 or r == 0:
                print(f'round {r} {name:10s} bands {np.round(b, 2).tolist()} target {target.tolist()} sd {L.std():.1f}/{table["measured"][name]["lumaSd"]}')
        print(f'round {r}: worst band error {worst:.2f}')
        table['model'] = model
    # z is a sum of bounded noise, not a normal variable: store its 13 quantiles so the shader maps it to an exact rank.
    for n in ORDER:
        model[n]['zq'] = [round(float(v), 4) for v in z_quantiles(model[n])]
    table['model'] = model
    path.write_text(json.dumps(table, indent=1) + '\n')


if __name__ == '__main__':
    main()
