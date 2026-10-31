"""Measure a world's land materials from its prepared images (cards H3 and H14).

A dev tool; the server never runs it. It reads the prepared images and writes
the numbers a material is made from, `materials/<world>.json`, so the editor
needs no image at run time (the images are only where the numbers come from,
and they stay outside git).

  material_numbers.py <world> <assets-dir> [--out materials/<world>.json] [--dither beach=1.0,quilt=1.5]

The materials a world draws follow the bridge's layer rules (sculpt-renderer.js,
BRIDGE_LAYER): slope grass is the slope image (the structured one on a
structured surface), rock is the hill rock (or the structured one), weathered
and fractured are their own images only where the world's material is `varied`
and the rock otherwise. A layer whose image is an earlier layer's names that
material again in `order` (Moon: slopeGrass, rock, rock, rock). The file keeps
what is already in it (a fitted `model`, a `placement` block) and rewrites
`measured`, `order`, `ground`, and the config's `material` and `water` blocks,
the numbers that were only in the uncommitted config.json.

Per material:
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
  lit       the structure numbers of a lit height field (material_lit.py: light axis, orientation, anisotropy, seams, cell size, veins),
            for the images that are not the 16-tile strip (card H14b).
A world whose plain is one quilted image (no ground tiles, or a default of ground=texture) gets that image as one more material,
`quilt`, last in `order`: the generated array holds it as a layer and the draw's plain reads it (card H14b step 3).
A world with a mineral ring, beach or transition body gets layers 4-7 as the bridge laid them out (fringe, body, beach, ring).
Tiled images wrap, as the draw's repeat sampling does; the ground strip is
sixteen separate 32 x 32 tiles and does not.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).resolve().parent))
import material_lit as ml

LUMA = np.array([.299, .587, .114])
KNOTS = 16
SIGMAS = [0.0] + [0.7 * 2 ** k for k in range(7)]    # 0, .7, 1.4 ... 44.8
DRAWS = {'ground': 'plain ground (the 16 tiles, groundTile)', 'slopeGrass': 'cover on slopes (generated layer 0)',
         'rock': 'hill rock (generated layer 1)', 'weathered': 'weathered rock patches (generated layer 2)',
         'fractured': 'fractured rock patches (generated layer 3)', 'fringe': 'fringe (generated layer 4)',
         'body': 'transition body (generated layer 5)', 'beach': 'beach (generated layer 6)', 'ring': 'mineral ring (generated layer 7)',
         'quilt': 'the plain as one quilted image (generated layer after the others)'}


def letter(i):
    """The entry's one-letter code: a..z, then A..Z (the draw's groundTileBitmap reads it back)."""
    return chr(97 + i) if i < 26 else chr(65 + i - 26)


def layer_plan(config):
    """The four rock-family layers of the bridge's rules as [(material name, image file name)] in layer order."""
    t, d = config['textures'], config['defaults']
    structured = d.get('surface') == 'structured'
    slope = t['slopeStructured'] if structured and 'slopeStructured' in t else t['slopeGrass']
    rock = t['rockStructured'] if structured and 'rockStructured' in t else t['hillRock']
    varied = d.get('material') == 'varied'
    images = [slope, rock, t['rockWeathered'] if varied else rock, t['rockFractured'] if varied else rock]
    names = ['slopeGrass', 'rock', 'weathered', 'fractured']
    # Layers 4-7 as the bridge laid them out: each defaults to the fringe image (slopeFringe, else the slope image); a world that names a
    # transition body, beach or mineral ring has its layers up to the last of those.
    fringe = t.get('slopeFringe', t['slopeGrass'])
    extra = [('fringe', fringe), ('body', t.get('transitionBody', fringe)), ('beach', t.get('beach', fringe)), ('ring', t.get('mineralRing', fringe))]
    last = max([i for i, k in enumerate(['slopeFringe', 'transitionBody', 'beach', 'mineralRing']) if k in t], default=-1)
    names += [n for n, _ in extra[:last + 1]]
    images += [u for _, u in extra[:last + 1]]
    plan, seen = [], {}
    for name, url in zip(names, images):
        file = url.rsplit('/', 1)[-1]
        plan.append((seen.setdefault(file, name), file))
    return plan


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


def vocabulary(flat, count=16):
    """H14d: the commonest colours of the image (up to `count`), most used first: what the dither pass reduces the smooth colour to."""
    cols, n = np.unique(flat, axis=0, return_counts=True)
    return [[int(v) for v in c] for c in cols[np.argsort(-n, kind='stable')[:count]]]


def measure(a, mode, dither=0.0):
    """`dither` > 0 (H14d, wrapped images): the knots are the bins of the rank of the luma blurred at that sigma, so the ramp is the smooth
    colour, and the image's commonest colours (`vocab`, up to 16) are what the dither pass reduces it to."""
    L = a @ LUMA
    flat = a.reshape(-1, 3)
    key = ndi.gaussian_filter(L, dither, mode='wrap') if dither > 0 else L
    order = np.argsort(key.reshape(-1), kind='stable')
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
        **({'lit': ml.lit_numbers(a)} if mode == 'wrap' else {}),
        **({'dither': dither, 'vocab': vocabulary(flat),
            # the smooth field the dither reduces: its bands are what the model's z is fitted to (the image's own bands are mostly the dither)
            'smoothBands': [round(float(b), 3) for b in (lambda bl: [(bl[k] - bl[k + 1]).std() for k in range(7)])([blur(key, s, mode) for s in SIGMAS])]} if dither > 0 else {}),
    }


def main():
    args = sys.argv[1:]
    out = None
    if '--out' in args:
        out = Path(args[args.index('--out') + 1])
        del args[args.index('--out'):args.index('--out') + 2]
    dithers = {}
    if '--dither' in args:
        i = args.index('--dither')
        dithers = {kv.split('=')[0]: float(kv.split('=')[1]) for kv in args[i + 1].split(',')}
        del args[i:i + 2]
    world, assets = args[0], Path(args[1])
    out = out or Path(__file__).resolve().parent.parent / 'materials' / f'{world}.json'
    config = json.loads((assets / 'config.json').read_text())
    plan = layer_plan(config)
    tiles = 'groundTiles' in config['textures']
    quilt = not tiles or config['defaults'].get('ground') == 'texture'
    table = {}
    if tiles:
        ground_file = config['textures']['groundTiles'].rsplit('/', 1)[-1]
        table['ground'] = {'image': ground_file, 'draw': DRAWS['ground'], **measure(load(assets / ground_file, 'strip'), 'strip')}
    for name, file in plan:
        if name not in table:
            table[name] = {'image': file, 'draw': DRAWS[name], **measure(load(assets / file, 'wrap'), 'wrap', dithers.get(name, 0.0))}
    if quilt:
        file = config['textures']['grass'].rsplit('/', 1)[-1]
        table['quilt'] = {'image': file, 'draw': DRAWS['quilt'], **measure(load(assets / file, 'wrap'), 'wrap', dithers.get('quilt', 0.0))}
    old = json.loads(out.read_text()) if out.exists() else {}
    old['measured'] = table
    old['order'] = [name for name, _ in plan] + (['quilt'] if quilt else [])
    # The plain is not modelled: its 16 tiles are kept as data: the colour entries in luma order and each tile as 1,024 entry letters
    # (a = first entry), rows top first. The draw builds them at startup (groundTileBitmap, sculpt-renderer.js).
    if tiles:
        strip = np.asarray(Image.open(assets / ground_file).convert('RGB'))[:32]
        entries = sorted({tuple(c) for c in strip.reshape(-1, 3)}, key=lambda c: float(np.dot(c, LUMA)))
        if len(entries) > 52:
            raise SystemExit(f'{world}: {len(entries)} ground colours do not fit the one-letter entry code')
        index = {c: i for i, c in enumerate(entries)}
        old['ground'] = {'entries': [list(map(int, c)) for c in entries],
                         'tiles': [''.join(letter(index[tuple(strip[y, 32 * t + x])]) for y in range(32) for x in range(32)) for t in range(16)]}
    # What config.json held that no committed file did: the world's material and water numbers (measured means, depths, authored
    # coverage and relief values). The server overlays them on the page's config (sculpt.py, world_knobs).
    old['material'] = config['material']
    old['water'] = config['water']
    out.write_text(json.dumps(old, indent=1) + '\n')
    for name, row in table.items():
        print(f"{name:11s} mean {row['lumaMean']:6.1f} sd {row['lumaSd']:5.1f} sd5 {row['sd5']:5.2f} stretch {row['stretch']:.2f} "
              f"lag {row['lag']['x1']:.2f}/{row['lag']['y1']:.2f} chroma {row['chroma']} left {row['chromaLeft']} colours {row['colours']} bands {row['bands']}")
    print('order', old['order'])


if __name__ == '__main__':
    main()
