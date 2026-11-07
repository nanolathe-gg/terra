"""Height across the shore on retail maps: signed distance from the waterline (cells of 16 px, + on land)
against height above the sea, as percentiles over every coast cell.

    python beach_profile.py ROOT [NAME...]

ROOT is a directory of retail exports (heights.bin, metadata.json). The 16-px heights are the game's own, so
this is the profile the units walk on. Only a table is worth committing; the maps stay outside Git.
"""
import json, sys
from pathlib import Path
import numpy as np
from scipy.ndimage import distance_transform_edt, zoom

UP = 4          # sub-cell resolution of the distance field
BINS = np.arange(-6, 12.01, 0.5)

def profile(cells, sea):
    h = zoom(cells.astype(np.float32), UP, order=1, mode='nearest') - sea      # bilinear
    land = h > 0
    dl = distance_transform_edt(land) / UP            # cells to the nearest water, on land
    dw = distance_transform_edt(~land) / UP           # cells to the nearest land, in water
    sd = np.where(land, dl - 0.5 / UP, -(dw - 0.5 / UP))
    return sd, h

def main():
    root = Path(sys.argv[1]); names = sys.argv[2:]
    acc = {}
    for d in sorted(root.iterdir()):
        if not (d / 'metadata.json').exists() or (names and not any(n in d.name for n in names)): continue
        md = json.loads((d / 'metadata.json').read_text())
        cells = np.fromfile(d / 'heights.bin', np.uint8).reshape(md['cell_height'], md['cell_width'])
        sd, h = profile(cells, md['sea_level'])
        # Per map: the beach-like coast is where the land 3 cells in is still low (under 8 units): its own profile.
        ix = np.digitize(sd, BINS)
        for k in range(1, len(BINS)):
            acc.setdefault(k, []).append(h[ix == k][::7])
    print('dist(cells)  n   p10  p25  p50  p75  p90   (height above sea, units)')
    for k in sorted(acc):
        a = np.concatenate(acc[k])
        if a.size < 50: continue
        p = np.percentile(a, [10, 25, 50, 75, 90])
        print(f'{BINS[k-1]:5.1f}..{BINS[k]:4.1f} {a.size:8d} ' + ' '.join(f'{v:5.1f}' for v in p))

main()
