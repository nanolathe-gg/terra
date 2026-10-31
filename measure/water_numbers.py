"""Measure a world's water grain from its prepared images and add it to the world's table (card H14e). A dev tool.

  water_numbers.py <world> <assets-dir> <name>=<texture key>[:dither] ... [--work DIR] [--cdp PORT] [--rounds N]

Each argument adds one generated material: the image the config's `textures` names under that key (`water`, `waterShallow`, or
`river.water` for a block of the config's `river` variant), measured as every other material (material_numbers.measure, with the
dither sigma when given) and fitted by material_fit on a scratch table holding only the water materials. The measured numbers and
the fitted model go into materials/<world>.json under the name; the table's own `order` is left alone, because the renderer appends
the two the world's `water` block names (`deep`, `shallow`) after it. Where deep and shallow are one image, name one material and
give both the same name in the `water` block.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import material_numbers as mn


def main():
    args = sys.argv[1:]
    opts = {'--work': None, '--cdp': '9663', '--rounds': '8'}
    for flag in opts:
        if flag in args:
            i = args.index(flag)
            opts[flag] = args[i + 1]
            del args[i:i + 2]
    world, assets, specs = args[0], Path(args[1]), args[2:]
    work = Path(opts['--work'] or tempfile.mkdtemp(prefix=f'water-{world}-'))
    work.mkdir(parents=True, exist_ok=True)
    config = json.loads((assets / 'config.json').read_text())
    measured = {}
    for spec in specs:
        name, rest = spec.split('=')
        key, _, dither = rest.partition(':')
        textures = config['river']['textures'] if key.startswith('river.') else config['textures']
        file = textures[key.removeprefix('river.')].rsplit('/', 1)[-1]
        measured[name] = {'image': file, 'draw': 'water grain (generated layer after the table\'s own)',
                          **mn.measure(mn.load(assets / file, 'wrap'), 'wrap', float(dither or 0))}
    scratch = work / 'table.json'
    scratch.write_text(json.dumps({'measured': measured, 'order': list(measured)}))
    subprocess.run([sys.executable, str(HERE / 'material_fit.py'), str(scratch), str(work / 'fit'), '--rounds', opts['--rounds'], '--cdp', opts['--cdp']], check=True)
    fitted = json.loads(scratch.read_text())
    path = HERE.parent / 'materials' / f'{world}.json'
    table = json.loads(path.read_text())
    for name in measured:
        table['measured'][name] = measured[name]
        table['model'][name] = fitted['model'][name]
    path.write_text(json.dumps(table, indent=1) + '\n')
    print('merged', list(measured), 'into', path)


if __name__ == '__main__':
    main()
