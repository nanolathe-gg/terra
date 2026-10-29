"""Measure Green's land materials from the prepared images (card H3, item 2).

A dev tool; the server never runs it. It reads the prepared images and writes
the numbers a material is made from, `materials/green.json`'s `measured` rows,
so the editor needs no image at run time (the images are only where the
numbers come from, and they stay outside git).

  material_numbers.py <assets-green-dir> [--out materials/green.json]

Per material (the five Green draws):
  ramp      RGB at 16 luma quantiles: the mean colour of each sixteenth of the
            pixels ranked by luma (0.299, 0.587, 0.114), darkest first. The
            model maps a uniform rank through it, so its histogram is the
            image's.
  bands     luma s.d. of seven octave bands. Band 0 is the image minus its
            0.7-sigma Gaussian blur (detail under about 1 px); band k is the
            difference of Gaussians at sigma 0.7 * 2^(k-1) and 0.7 * 2^k;
            band 6 stops at sigma 22.4 (grain up to about 32 px). What the
            blur at 22.4 leaves is the broad level (`broad`), not grain.
  lumaQ     luma at the 1, 5, 25, 50, 75, 95 and 99th percentiles (the model's `tail` is fitted to them).
  sd5       luma s.d. of the 5 x 5 box mean (the "s.d. after a 5-px blur").
  stretch   rms x gradient over rms y gradient of luma blurred at sigma 1;
            above 1 the grain runs along x.
  lag       luma correlation at 1 and 2 px, along x and along y.
  tint      what luma does not explain. In each sixteenth the colours leave the
            ramp along one direction (the first principal axis of the colours
            about the bin mean, signed so green rises); `tint` is that axis
            times its s.d., per knot. The model adds it times a unit noise
            that has no spatial structure (the measured part of the tint
            along it, `tintLag`, is its pixel correlation at 1 px).
  chroma    s.d. of each colour channel left once the ramp alone is taken
            away, and `chromaLeft` what is left after the tint too.
  colours   distinct colours in the image, and the share of the commonest.
Tiled images wrap, as the draw's repeat sampling does; the ground strip is
sixteen separate 32 x 32 tiles and does not.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

LUMA = np.array([.299, .587, .114])
KNOTS = 16
SIGMAS = [0.0] + [0.7 * 2 ** k for k in range(7)]    # 0, .7, 1.4 ... 44.8
# The material set: name, image, how it wraps (tile size or None), what the draw calls it.
MATERIALS = [
    ('ground', 'ground-tiles.png', 'strip', 'plain grass (grassTex via groundTile)'),
    ('slopeGrass', 'slope-grass.png', 'wrap', 'grass on slopes (slopeGrassTex)'),
    ('rock', 'slope-rock.png', 'wrap', 'hill rock (rockTex with rock=hill)'),
    ('weathered', 'rock-weathered.png', 'wrap', 'weathered rock patches (rockWeatheredTex)'),
    ('fractured', 'rock-fractured.png', 'wrap', 'fractured rock patches (rockFracturedTex)'),
]


def load(path, mode):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
    if mode == 'strip':      # the draw reads only row 0..31, tile i at x = 32 i
        a = a[:32]
    return a


def blur(x, sigma, mode):
    if sigma == 0:
        return x
    if mode == 'strip':      # per tile: no wrap, mirror at the tile edge
        tiles = x.reshape(32, 16, 32)
        return np.stack([ndi.gaussian_filter(t, sigma, mode='mirror') for t in tiles.transpose(1, 0, 2)]).transpose(1, 0, 2).reshape(32, 512)
    return ndi.gaussian_filter(x, sigma, mode='wrap')


def lag(L, k, axis, mode):
    d = L - L.mean()
    if mode == 'strip':
        t = d.reshape(32, 16, 32).transpose(1, 0, 2)
        t = t if axis == 1 else t.transpose(0, 2, 1)
        return float((t[:, :, :-k] * t[:, :, k:]).mean() / d.var())
    return float((d * np.roll(d, -k, axis=axis)).mean() / d.var())


def measure(a, mode):
    L = a @ LUMA
    flat = a.reshape(-1, 3)
    order = np.argsort(L.reshape(-1), kind='stable')
    rank = np.empty(len(order)); rank[order] = (np.arange(len(order)) + .5) / len(order)
    bins = np.minimum((rank * KNOTS).astype(int), KNOTS - 1)
    ramp = np.stack([flat[bins == k].mean(0) for k in range(KNOTS)])
    fit = ramp[bins]
    chroma = (flat - fit).std(0)
    res = flat - fit
    tint, along = [], np.zeros(len(flat))
    for k in range(KNOTS):
        r = res[bins == k]
        w, v = np.linalg.eigh(np.cov(r.T))
        d = v[:, -1] * (1 if v[1, -1] >= 0 else -1)
        tint.append(d * np.sqrt(w[-1]))
        along[bins == k] = (r @ d)
    tint = np.array(tint)
    left = (res - (along[:, None] * tint[bins] / np.maximum(np.linalg.norm(tint[bins], axis=1, keepdims=True), 1e-9))).std(0)
    pl = along.reshape(a.shape[:2])
    tint_lag = float((pl * np.roll(pl, -1, axis=1)).mean() / pl.var()) if mode == 'wrap' else None
    blurred = [blur(L, s, mode) for s in SIGMAS]
    bands = [float((blurred[k] - blurred[k + 1]).std()) for k in range(7)]
    box = ndi.uniform_filter(L, 5, mode='wrap' if mode == 'wrap' else 'mirror')
    gy, gx = np.gradient(blur(L, 1.0, mode))
    colours, counts = np.unique(flat, axis=0, return_counts=True)
    return {
        'size': [a.shape[1] // (16 if mode == 'strip' else 1), a.shape[0]],
        'meanRGB': [round(float(v), 2) for v in flat.mean(0)],
        'lumaMean': round(float(L.mean()), 2), 'lumaSd': round(float(L.std()), 2),
        'sd5': round(float(box.std()), 2),
        'lumaQ': [round(float(v), 1) for v in np.percentile(L, [1, 5, 25, 50, 75, 95, 99])],
        'broad': round(float(blurred[-1].std()), 2),
        'bands': [round(b, 3) for b in bands],
        'stretch': round(float(np.sqrt((gx ** 2).mean() / (gy ** 2).mean())), 3),
        'lag': {'x1': round(lag(L, 1, 1, mode), 3), 'x2': round(lag(L, 2, 1, mode), 3),
                'y1': round(lag(L, 1, 0, mode), 3), 'y2': round(lag(L, 2, 0, mode), 3)},
        'chroma': [round(float(c), 2) for c in chroma], 'chromaLeft': [round(float(c), 2) for c in left],
        'tintLag': None if tint_lag is None else round(tint_lag, 3),
        'tint': [[round(float(v), 1) for v in row] for row in tint],
        'colours': int(len(colours)), 'topShare': round(float(counts.max() / counts.sum()), 3),
        'ramp': [[round(float(v), 1) for v in row] for row in ramp],
    }


def main():
    args = sys.argv[1:]
    out = Path(args[args.index('--out') + 1]) if '--out' in args else Path(__file__).resolve().parent.parent / 'materials' / 'green.json'
    if '--out' in args:
        del args[args.index('--out'):args.index('--out') + 2]
    assets = Path(args[0])
    table = {}
    for name, image, mode, note in MATERIALS:
        table[name] = {'image': image, 'draw': note, **measure(load(assets / image, mode), mode)}
    old = json.loads(out.read_text()) if out.exists() else {}
    old['measured'] = table
    # The plain is not modelled: its 16 tiles (generated, in ours, by ground_tiles.py from an index model of retail's flat ground)
    # are kept as data: the colour entries in luma order and each tile as 1,024 entry letters (a = first entry), rows top first.
    strip = np.asarray(Image.open(assets / 'ground-tiles.png').convert('RGB'))[:32]
    entries = sorted({tuple(c) for c in strip.reshape(-1, 3)}, key=lambda c: float(np.dot(c, LUMA)))
    index = {c: i for i, c in enumerate(entries)}
    old['ground'] = {'entries': [list(map(int, c)) for c in entries],
                     'tiles': [''.join(chr(97 + index[tuple(strip[y, 32 * t + x])]) for y in range(32) for x in range(32)) for t in range(16)]}
    out.write_text(json.dumps(old, indent=1) + '\n')
    for name, row in table.items():
        print(f"{name:11s} mean {row['lumaMean']:6.1f} sd {row['lumaSd']:5.1f} sd5 {row['sd5']:5.2f} stretch {row['stretch']:.2f} "
              f"lag {row['lag']['x1']:.2f}/{row['lag']['y1']:.2f} chroma {row['chroma']} left {row['chromaLeft']} colours {row['colours']} bands {row['bands']}")


main()
