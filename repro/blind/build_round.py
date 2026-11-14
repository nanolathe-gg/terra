"""Blind round 8: nine worlds. For each world, one 256-px crop of our
reproduction (repro-out/<world>/ours.png) and one 256-px retail crop from a
different map of that world, plus one retail reference from a third place.
Images are named <world>-NN.png so the reviewer knows the world.

  build_round.py <repro-out-dir> <round-dir> <key.json> [seed]
"""
import json
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image

W = 256
out_root, rnd, key_path = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
rng = random.Random(int(sys.argv[4]) if len(sys.argv) > 4 else 8088)
RETAIL = Path('/tmp/nanolathe-map-editor')
ZHON = RETAIL / 'catalogs/sections-zhon/TASect_Zhon/sections/zhon'


def score(slope, wet):
    # Prefer crops with some relief and a little water, like the repro windows.
    return -abs((slope > .2).mean() - .3) - max(0, wet - .35) + (0.05 if 0.05 < wet < 0.35 else 0)


def best_crop(h, cell, size, avoid=None):
    """h: heights above sea on a grid of `cell` px. Returns (x, y) in px."""
    gy, gx = np.gradient(h, float(cell))
    slope = np.hypot(gx, gy)
    n = W // cell
    cands = []
    for y in range(2, h.shape[0] - n - 1, max(1, 64 // cell)):
        for x in range(0, h.shape[1] - n, max(1, 64 // cell)):
            if avoid and abs(x * cell - avoid[0]) < 384 and abs(y * cell - avoid[1]) < 384:
                continue
            cands.append((score(slope[y:y + n, x:x + n], (h[y:y + n, x:x + n] < 0).mean()) + rng.random() * .05, x, y))
    cands.sort(reverse=True)
    _, x, y = rng.choice(cands[:12])
    mh = float(np.maximum(h[y:y + n, x:x + n], 0).mean())
    return x * cell, int(max(0, min(size - W, y * cell - mh / 2)))


def retail_maps(world):
    if world == 'zhon':
        return []
    return sorted(p for p in (RETAIL / f'retail-{world}').iterdir() if p.is_dir())


def retail_crop(world, exclude):
    """A 256-px crop of a retail map of this world, avoiding the maps (or
    section ids) in exclude when another is available."""
    if world == 'zhon':
        arts = sorted(ZHON.glob('*/*.art.png'))
        arts = [a for a in arts if not any(e and e in str(a) for e in exclude) and Image.open(a).size[0] >= 512]
        art = rng.choice(arts)
        pic = np.asarray(Image.open(art).convert('RGB'))
        h = np.asarray(Image.open(str(art).replace('.art.png', '.heights.png'))).astype(float) - 8
        x, y = best_crop(h, 16, pic.shape[0])
        return Image.fromarray(pic[y:y + W, x:x + W]), art.parent.name + '/' + art.name
    skip = {str(e).replace(' ', '_') for e in exclude}
    maps = [m for m in retail_maps(world) if m.name.split('-')[0] not in skip] or retail_maps(world)
    m = rng.choice(maps)
    meta = json.loads((m / 'metadata.json').read_text())
    cells = np.fromfile(m / 'heights.bin', np.uint8).reshape(meta['cell_height'], meta['cell_width']).astype(float) - meta['sea_level']
    x, y = best_crop(cells, 16, meta['height'])
    pal = np.fromfile(m / 'palette-rgb.bin', np.uint8).reshape(256, 3)
    idx = np.memmap(m / 'map-indexed.bin', np.uint8, 'r', shape=(meta['height'], meta['width']))
    return Image.fromarray(pal[np.asarray(idx[y:y + W, x:x + W])]), f'{m.name}@{x},{y}'


(rnd / 'images').mkdir(parents=True, exist_ok=True)
(rnd / 'references').mkdir(parents=True, exist_ok=True)
key = {}
groups = {}
for d in sorted(p for p in out_root.iterdir() if (p / 'ours.png').exists()):
    world = d.name.rsplit('-', 1)[0] if d.name.rsplit('-', 1)[-1].isdigit() else d.name
    groups.setdefault(world, []).append(d)
for world, dirs in groups.items():
    # Retail crops avoid every map the reproductions came from.
    sources = [json.loads((d / 'crop.json').read_text()) for d in dirs]
    used = [s.get('map') or Path(s.get('section', '')).stem for s in sources]
    d = rng.choice(dirs)
    data = json.loads((d / 'ours-heights.json').read_text())
    g = data['grid']
    h = np.asarray(data['heights'], float).reshape(g, g) - data['sea']
    ours = Image.open(d / 'ours.png').convert('RGB')
    x, y = best_crop(h, ours.width // g, ours.width)
    items = [('generated', f'{d.name} repro @{x},{y}', ours.crop((x, y, x + W, y + W)))]
    im, src = retail_crop(world, used)
    items.append(('retail', src, im))
    ref, ref_src = retail_crop(world, used + [src.split('@')[0].split('-')[0]])
    ref.save(rnd / 'references' / f'{world}-reference.png')
    key[f'{world}-reference.png'] = {'kind': 'reference', 'source': ref_src}
    rng.shuffle(items)
    for k, (kind, src, im) in enumerate(items, 1):
        name = f'{world}-{k:02d}.png'
        im.save(rnd / 'images' / name)
        key[name] = {'kind': kind, 'source': src}
key_path.write_text(json.dumps(key, indent=1))
print(len(key), 'files')
