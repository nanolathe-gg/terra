"""Try lit-material numbers on one prepared image and look (card H14b).

A dev tool. Builds a one-material table from the image's measured numbers, overlays `lit.<key>=value` arguments (and
`model.<key>=...` for stretch and tint), renders the swatch with the engine's own pass (measure/swatch.mjs, --auto-zq so the rank map
is the field's own) at foot 1 and 4, and writes <out>/<name>.png: image | swatch at 1x and 2x, the quarter level, and the numbers.

  lit_lab.py <image> <assets-dir> <name> <out-dir> [--cdp 9681] [--table t.json] [lit.relief=1 lit.cell=20 amps=0.3,0.8,...]

`--table` starts from a table (a `materials/<world>.json` or the lab's own output) and its entry `<name>`; otherwise from the image.
The table with the numbers used is left as <out>/<name>.json so a try can be repeated or committed.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import material_numbers as mn
import material_lit as ml
import material_swatches as ms


def base_table(path, name):
    a = mn.load(path, 'wrap')
    m = mn.measure(a, 'wrap')
    var = np.array([1 / 3] + [ms_var() ] * 6)
    # Luma is the slope of the height, so a band of luma of cell 2^k px is a band of height 2^k times as large; scaled so the slope's r.m.s. is 1.
    amps = np.array(m['bands']) / np.sqrt(var) * np.array([0] + [2.0 ** k for k in range(1, 7)])
    amps = amps / np.sqrt(sum((amps[k] / 2.0 ** k) ** 2 for k in range(1, 7)))
    amps[0] = 0.15   # white grain in z units (z is not unit variance for a lit material)
    lag = m['tintLag'] if m['tintLag'] is not None else 0.0
    m['image'] = Path(path).name
    m['lit'] = ml.lit_numbers(a)
    return {'order': [name], 'measured': {name: m},
            'model': {name: {'amps': [round(float(v), 4) for v in amps], 'stretch': 1.0, 'tintMix': float(np.clip(2.0 * lag, 0, .8)), 'tintScale': 1.0,
                             'zq': [0.0] * 13, 'lit': {'relief': 1.0, 'light': m['lit']['light'], 'shear': 0}}}}


def ms_var():
    return 0.0378   # variance of the model's smoothstep value noise, as material_fit.lattice_variance gives it


def apply(table, name, sets):
    mod = table['model'][name]
    for s in sets:
        k, v = s.split('=')
        if k == 'amps':
            mod['amps'] = [float(x) for x in v.split(',')]
        elif k.startswith('lit.'):
            mod.setdefault('lit', {})[k[4:]] = json.loads(v)
        elif k.startswith('model.'):
            mod[k[6:]] = json.loads(v)
        else:
            raise SystemExit('unknown setting ' + s)


def run(table, out, cdp, foot):
    tab = out / 'table.json'
    tab.write_text(json.dumps(table))
    r = subprocess.run(['node', str(HERE / 'swatch.mjs'), str(tab), str(out / f'raw{foot}'), '--foot', str(foot), '--auto-zq', '--cdp', str(cdp)], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stdout + r.stderr)
    n = 512 // foot
    return np.fromfile(out / f'raw{foot}' / f'{table["order"][0]}.rgba', np.uint8).reshape(n, n, 4)[..., :3].astype(float), json.loads((out / f'raw{foot}' / 'meta.json').read_text())


def main():
    args = sys.argv[1:]
    opts = {}
    for flag in ('--cdp', '--table'):
        if flag in args:
            i = args.index(flag)
            opts[flag] = args[i + 1]
            del args[i:i + 2]
    image, assets, name, out = Path(args[0]), Path(args[1]), args[2], Path(args[3])
    sets = args[4:]
    out.mkdir(parents=True, exist_ok=True)
    cdp = opts.get('--cdp', '9681')
    if '--table' in opts:
        table = json.loads(Path(opts['--table']).read_text())
        table = {'order': [name], 'measured': {name: table['measured'][name]}, 'model': {name: table['model'][name]}}
    else:
        table = base_table(image, name)
    apply(table, name, sets)
    lut = np.asarray(Image.open(assets / 'palette-lut.png').convert('RGB'))
    img = np.asarray(Image.open(image).convert('RGB')).astype(float)
    img = np.tile(img, (-(-512 // img.shape[0]), -(-512 // img.shape[1]), 1))[:512, :512]
    raw1, meta = run(table, out, cdp, 1)
    raw4, _ = run(table, out, cdp, 4)
    box = img.reshape(128, 4, 128, 4, 3).mean((1, 3))
    if meta['zq']:
        table['model'][name]['zq'] = [round(v, 4) for v in list(meta['zq'].values())[0]]
    (out / f'{name}.json').write_text(json.dumps(table, indent=1))
    simg, g1, g4 = ms.snap(lut, img), ms.snap(lut, raw1), ms.snap(lut, raw4)
    q4 = np.kron(g4, np.ones((4, 4, 1)))
    iq = np.kron(ms.snap(lut, box), np.ones((4, 4, 1)))
    rows = [('image', simg), ('swatch', g1), ('imgQuarter', iq), ('quarter', q4)]
    nums = {k: ml.compare(v) for k, v in rows}
    nums['bands'] = {k: ms.stats(v)['bands'] for k, v in rows}
    crop = lambda a, s, o=64: Image.fromarray(a[o:o + s, o:o + s].astype(np.uint8))
    sheet = Image.new('RGB', (4 * 256 + 5 * 8 + 256, 2 * 256 + 3 * 8 + 90), (20, 20, 20))
    x = 8
    for k, a in rows[:2]:
        sheet.paste(crop(a, 256, 0), (x, 8)); x += 264
    for k, a in rows[:2]:
        sheet.paste(crop(a, 128).resize((256, 256), Image.NEAREST), (x, 8)); x += 264
    sheet.paste(crop(q4, 256, 0), (x, 8))
    sheet.paste(crop(iq, 256, 0), (8, 272)); sheet.paste(crop(q4, 256, 0), (272, 272))
    d = ImageDraw.Draw(sheet)
    d.text((8, 2 * 256 + 20), f'{name}: image | swatch (1x) | image 2x | swatch 2x | quarter level (4x nearest) ; below: image quarter | swatch quarter (both at 1x of the final size)', fill=(255, 255, 255))
    y = 2 * 256 + 34
    for k, v in nums.items():
        d.text((8, y), f'{k:8s} {v}', fill=(255, 255, 255)); y += 14
    sheet.save(out / f'{name}.png')
    for k, v in nums.items():
        print(f'{k:8s} {v}')
    print('lit measured', json.dumps(table['measured'][name].get('lit')))


if __name__ == '__main__':
    main()
