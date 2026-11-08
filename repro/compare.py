"""What a change did to every reproduction: for each scene rendered in both
all.sh outputs, the mean absolute pixel difference of ours.png (0-255) and
the share of pixels that moved by more than 8. Scenes of worlds a change
was not meant to touch must stay at 0.

  compare.py <before-out> <after-out> [--worlds green,lava | --worlds none]

With --worlds, exits 1 if any pixel of another world's scene changed
(renders are deterministic: two runs of one build match exactly).
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('before'); ap.add_argument('after')
ap.add_argument('--worlds', default='', help='worlds the change may touch')
args = ap.parse_args()
allowed = {w for w in args.worlds.split(',') if w}
stray, changed, seen = [], [], 0
for d in sorted(Path(args.after).iterdir()):
    a, b = Path(args.before) / d.name / 'ours.png', d / 'ours.png'
    if not (a.exists() and b.exists()):
        continue
    x = np.asarray(Image.open(a).convert('RGB'), np.int16)
    y = np.asarray(Image.open(b).convert('RGB'), np.int16)
    diff = np.abs(x - y)
    seen += 1
    if diff.any():
        changed.append(d.name)
    mad, moved = float(diff.mean()), float((diff.max(-1) > 8).mean())
    world = d.name.rsplit('-', 1)[0]
    flag = '' if diff.any() else '  identical'
    if allowed and world not in allowed and diff.any():
        flag = '  <- outside --worlds'
        stray.append(d.name)
    print(f'{d.name:16s} mean |diff| {mad:6.2f}   moved {moved:6.1%}{flag}')
print(f'{len(changed)} of {seen} scenes changed' + (': ' + ' '.join(changed) if changed else ''))
if stray:
    print('changed outside the allowed worlds:', ' '.join(stray))
    sys.exit(1)
