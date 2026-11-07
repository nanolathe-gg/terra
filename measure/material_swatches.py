"""Swatch sheets: each prepared image beside the model's picture of it (cards H3 and H14).

A dev tool. For every material it renders the model (measure/swatch.mjs) at foot 1 and at foot 4 (a
quarter-resolution draw), snaps both and the prepared image to the palette (palette-lut.png, the
nearest entry, as the draw's palette stage does), and writes <out>/<material>.png: prepared | model,
at 1x and 2x, with the numbers under each. `numbers.json` holds the same numbers.

  material_swatches.py <materials/<world>.json> <assets-dir> <out-dir> [--cdp 9663]
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

HERE = Path(__file__).resolve().parent
LUMA = np.array([.299, .587, .114])
SIGMAS = [0.0] + [0.7 * 2 ** k for k in range(7)]
N = 256


def snap(lut, rgb):
    c = np.clip(np.floor(rgb / 255.0 * 31 + .5), 0, 31).astype(int)
    return lut[c[..., 1], c[..., 0] + 32 * c[..., 2]].astype(float)


def stats(a):
    L = a @ LUMA
    m = 16
    blurred = [L if s == 0 else ndi.gaussian_filter(L, s, mode='mirror') for s in SIGMAS]
    bands = [float((blurred[k] - blurred[k + 1])[m:-m, m:-m].std()) for k in range(6)]
    mean = a.reshape(-1, 3).mean(0)
    mx, mn = mean.max(), mean.min()
    hue = 0.0
    if mx > mn:
        r, g, b = mean
        hue = (60 * ((g - b) / (mx - mn)) % 360) if mx == r else (60 * (2 + (b - r) / (mx - mn))) if mx == g else (60 * (4 + (r - g) / (mx - mn)))
    return {'mean': round(float(L.mean()), 1), 'sd': round(float(L.std()), 1), 'sd5': round(float(ndi.uniform_filter(L, 5, mode='mirror').std()), 2),
            'bands': [round(b, 2) for b in bands], 'hue': round(float(hue), 1), 'sat': round(float((mx - mn) / max(mx, 1)), 3),
            'rgb': [round(float(v), 1) for v in mean]}


def prepared(assets, name, table):
    a = np.asarray(Image.open(assets / table['measured'][name]['image']).convert('RGB')).astype(float)
    if name == 'ground':     # the draw's mosaic: 32-px tiles chosen at random from the strip
        rng = np.random.default_rng(5)
        tiles = [a[:32, 32 * i:32 * i + 32] for i in range(16)]
        a = np.vstack([np.hstack([tiles[rng.integers(16)] for _ in range(16)]) for _ in range(16)])
    return np.tile(a, (-(-512 // a.shape[0]), -(-512 // a.shape[1]), 1))[:512, :512]   # a 256-px image repeats, as the draw's tiling did


def main():
    args = sys.argv[1:]
    cdp = args[args.index('--cdp') + 1] if '--cdp' in args else '9663'
    if '--cdp' in args:
        del args[args.index('--cdp'):args.index('--cdp') + 2]
    table, assets, out = Path(args[0]), Path(args[1]), Path(args[2])
    out.mkdir(parents=True, exist_ok=True)
    lut = np.asarray(Image.open(assets / 'palette-lut.png').convert('RGB'))
    t = json.loads(table.read_text())
    for foot in (1, 4):
        subprocess.run(['node', str(HERE / 'swatch.mjs'), str(table), str(out / f'raw{foot}'), '--foot', str(foot), '--size', '512', '--cdp', cdp], check=True, capture_output=True)
    numbers = {}
    for name in dict.fromkeys(t['order']):
        img = snap(lut, prepared(assets, name, t))
        gen = {}
        for foot in (1, 4):
            n = 512 // foot
            raw = np.fromfile(out / f'raw{foot}' / f'{name}.rgba', np.uint8).reshape(n, n, 4)[..., :3].astype(float)
            gen[foot] = snap(lut, raw)
        rows = {'prepared': img, 'model': gen[1]}
        numbers[name] = {'prepared': stats(img), 'model': stats(gen[1]),
                         'modelNoPalette': stats(np.fromfile(out / 'raw1' / f'{name}.rgba', np.uint8).reshape(512, 512, 4)[..., :3].astype(float)),
                         'model-quarter': stats(np.kron(gen[4], np.ones((4, 4, 1)))[:512, :512]),
                         'quarterNoPalette': stats(np.kron(np.fromfile(out / 'raw4' / f'{name}.rgba', np.uint8).reshape(128, 128, 4)[..., :3].astype(float), np.ones((4, 4, 1))))}
        # sheet: 1x and 2x of a 128 crop pair (prepared | model), then numbers
        sheet = Image.new('RGB', (2 * 256 + 2 * 256 + 3 * 8, 256 + 8 + 128 + 8 + 20 * 9), (20, 20, 20))
        crop = lambda a, s: Image.fromarray(a[40:40 + s, 40:40 + s].astype(np.uint8))
        sheet.paste(crop(img, 256), (8, 8)); sheet.paste(crop(gen[1], 256), (8 + 256 + 8, 8))
        sheet.paste(crop(img, 128).resize((256, 256), Image.NEAREST), (8 + 2 * 264, 8)); sheet.paste(crop(gen[1], 128).resize((256, 256), Image.NEAREST), (8 + 3 * 264, 8))
        quarter = Image.fromarray(np.kron(gen[4], np.ones((4, 4, 1)))[40:40 + 128, 40:40 + 128].astype(np.uint8))
        sheet.paste(quarter, (8 + 264, 8 + 256 + 8))
        d = ImageDraw.Draw(sheet)
        d.text((8, 8 + 256 + 8), f'{name}: left prepared (1x, 2x right), model beside it; model at foot 4 (quarter) at the bottom', fill=(255, 255, 255))
        y = 8 + 256 + 8 + 134
        for label in ('prepared', 'model', 'modelNoPalette', 'model-quarter', 'quarterNoPalette'):
            s = numbers[name][label]
            d.text((8, y), f"{label:14s} mean {s['mean']:5.1f} sd {s['sd']:5.1f} sd5 {s['sd5']:5.2f} bands {s['bands']} hue {s['hue']:5.1f} sat {s['sat']:.3f} rgb {s['rgb']}", fill=(255, 255, 255))
            y += 18
        sheet.save(out / f'{name}.png')
    (out / 'numbers.json').write_text(json.dumps(numbers, indent=1))
    for name, rows in numbers.items():
        for label, s in rows.items():
            print(f"{name:10s} {label:15s} mean {s['mean']:5.1f} sd {s['sd']:5.1f} sd5 {s['sd5']:5.2f} hue {s['hue']:5.1f} sat {s['sat']:.3f} rgb {s['rgb']}")


if __name__ == '__main__':
    main()
