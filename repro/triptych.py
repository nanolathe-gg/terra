"""Before/after review sheets: for each world, one row per scene of
retail | before | after at half size, from two all.sh outputs.

  triptych.py <before-out> <after-out> <dest-dir> [--worlds green,lava]

Writes <dest-dir>/<world>.png.
"""
import argparse
from pathlib import Path

from PIL import Image

from pair import label, sheet

ap = argparse.ArgumentParser()
ap.add_argument('before'); ap.add_argument('after'); ap.add_argument('dest')
ap.add_argument('--worlds', default='')
args = ap.parse_args()
want = {w for w in args.worlds.split(',') if w}
rows = {}
for d in sorted(Path(args.after).iterdir()):
    b = Path(args.before) / d.name
    if not ((d / 'ours.png').exists() and (b / 'ours.png').exists()):
        continue
    world = d.name.rsplit('-', 1)[0]
    if want and world not in want:
        continue
    half = lambda p: Image.open(p).convert('RGB').resize((512, 512), Image.LANCZOS)
    rows.setdefault(world, []).append(sheet([label(half(d / 'retail.png'), f'{d.name} retail'),
                                             label(half(b / 'ours.png'), 'before'), label(half(d / 'ours.png'), 'after')]))
dest = Path(args.dest)
dest.mkdir(parents=True, exist_ok=True)
for world, rs in rows.items():
    out = Image.new('RGB', (rs[0].width, sum(r.height for r in rs) + 8 * (len(rs) - 1)), (24, 24, 24))
    y = 0
    for r in rs:
        out.paste(r, (0, y)); y += r.height + 8
    out.save(dest / f'{world}.png')
    print(dest / f'{world}.png')
