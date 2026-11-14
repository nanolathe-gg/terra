"""What retail material each world has on this machine, for a retail round (docs/RETAIL_ROUND.md): the reproduction windows and the
retail maps they were cut from, the world's other retail map exports (stats.py's family), and the map editor's section packs.

  retail_sources.py [--root $R] [--worlds green,red] [--json]

Prints a Markdown table per world (or JSON). It reads only names, sizes and counts: no pixels. Paths are under --root
(default /tmp/nanolathe-map-editor): retail-<world>/ (map exports, retail_crop.py's input), repro-r7/<window>/ (the crops),
catalogs/sections*/ (section packs: a manifest.json and contact sheets by kind, or TA's own section folders with art and heights).
"""
import argparse
import collections
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORLDS = ['green', 'red', 'archipelago', 'moon', 'zhon', 'lava', 'desert', 'crystal', 'ice']


def windows(world, root):
    out = []
    for scene in sorted(HERE.glob(f'scenes/{world}-*.json')):
        s = json.loads(scene.read_text())
        crop = s.get('crop') or scene.stem
        c = root / 'repro-r7' / crop / 'crop.json'
        meta = json.loads(c.read_text()) if c.exists() else {}
        src = s.get('source') or {}
        out.append({'scene': scene.stem, 'query': s.get('query', ''), 'crop': crop, 'cropReady': c.exists(),
                    'map': meta.get('map') or src.get('map') or src.get('section', ''), 'x': meta.get('x', src.get('x')), 'y': meta.get('y', src.get('y'))})
    return out


def maps(world, root):
    base = root / f'retail-{world}'
    out = []
    for d in sorted(base.iterdir()) if base.is_dir() else []:
        m = d / 'metadata.json'
        if m.exists():
            meta = json.loads(m.read_text())
            out.append({'name': meta.get('name', d.name), 'size': f"{meta.get('width')}x{meta.get('height')}", 'sea': meta.get('sea_level'), 'dir': str(d)})
    return out


def sections(world, root):
    out = []
    for manifest in sorted((root / 'catalogs').glob('sections*/manifest.json')):
        m = json.loads(manifest.read_text())
        # A community pack names its world last (u_adamante_crystal_v12, u_lava_crystal_v11: both crystal); a retail pack names it alone.
        of = lambda name: name.split('_')[-2] if name.startswith('u_') else name
        kinds = collections.Counter(s['kind'] for s in m.get('sections', []) if of(s.get('world', '')) == world)
        if kinds:
            sheets = m.get('sheets')
            out.append({'pack': manifest.parent.name, 'kinds': dict(kinds), 'count': sum(kinds.values()),
                        'sheets': str(manifest.parent / 'sheets'), 'archives': [a.get('path') for a in m.get('archives', [])]})
    own = root / 'catalogs' / 'sections' / 'worlds' / 'sections' / world
    if own.is_dir():
        kinds = {d.name: len(list(d.glob('*.art.png'))) for d in sorted(own.iterdir()) if d.is_dir()}
        out.append({'pack': f'sections/worlds/sections/{world}', 'kinds': kinds, 'count': sum(kinds.values()), 'sheets': str(own), 'archives': []})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='/tmp/nanolathe-map-editor')
    ap.add_argument('--worlds', default='')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()
    root = Path(args.root)
    want = [w for w in (args.worlds.split(',') if args.worlds else WORLDS) if w]
    data = {w: {'windows': windows(w, root), 'maps': maps(w, root), 'sections': sections(w, root)} for w in want}
    if args.json:
        print(json.dumps(data, indent=1))
        return
    print('| world | windows (scene: retail map, x, y) | retail maps | section packs (kind: count) |')
    print('| --- | --- | --- | --- |')
    for w, d in data.items():
        win = '<br>'.join(f"{x['scene']}: {x['map']}{'' if x['x'] is None else f' {x['x']},{x['y']}'}{'' if x['cropReady'] else ' (no crop)'}" for x in d['windows'])
        mp = f"{len(d['maps'])}: " + ', '.join(m['name'] for m in d['maps']) if d['maps'] else 'none'
        sc = '<br>'.join(f"{s['pack']} ({s['count']}): " + ', '.join(f'{k} {n}' for k, n in s['kinds'].items()) for s in d['sections']) or 'none'
        print(f'| {w} | {win} | {mp} | {sc} |')


if __name__ == '__main__':
    main()
