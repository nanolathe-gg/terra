"""The erosion pass's envelope (card H5 item 2): what it changed, against what must stay exact.

  envelope.py <ours-erosion.json> [more ...]     (repro/render.mjs --erosion writes it)

Prints, per file: the largest |eroded - authored| over protected samples (protection >= 1) and over
samples at or below the sea (both must be 0); the largest change anywhere and where (grid x, y, world px);
and the share of samples that moved by more than 1 height unit among the unprotected dry ones.
"""
import json
import sys

import numpy as np

for path in sys.argv[1:]:
    e = json.load(open(path)); g = e['grid']; sp = (e['size'] - 1) / (g - 1)
    a = np.array(e['authored']).reshape(g, g); h = np.array(e['height']).reshape(g, g)
    p = np.array(e['protect']).reshape(g, g) if e.get('protect') else np.zeros((g, g))
    sea = e.get('seaLevel', 0.0)
    d = h - a
    prot = p >= 1; wet = a <= sea; free = ~prot & ~wet
    y, x = np.unravel_index(np.argmax(np.abs(d)), d.shape)
    print(f'{path}\n  protected samples {int(prot.sum())}: max |change| {np.abs(d[prot]).max() if prot.any() else 0:.6f}'
          f'\n  at or below sea {int(wet.sum())}: max |change| {np.abs(d[wet]).max() if wet.any() else 0:.6f}'
          f'\n  largest change {d[y, x]:+.2f} at sample ({x},{y}) = world px ({x * sp:.0f},{y * sp:.0f}), authored {a[y, x]:.1f}'
          f'\n  free dry samples {int(free.sum())}: moved > 1 unit {100 * (np.abs(d[free]) > 1).mean():.1f}%, > 3 units {100 * (np.abs(d[free]) > 3).mean():.1f}%, mean |change| {np.abs(d[free]).mean():.2f}')
