"""Water colour by depth and depth by distance from shore, from coast sections."""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

def section_samples(art, h):
    H, W = art.shape[:2]
    rows = []
    for cy in range(h.shape[0]):
        for cx in range(h.shape[1]):
            x = cx * 16 + 8; y = int(cy * 16 + 8)  # water is drawn at sea level: projection is a constant shift
            if y + 4 > H or x + 4 > W: continue
            win = art[y-4:y+4, x-4:x+4].reshape(-1, 3).astype(np.float32)
            blue = ((win[:, 2] > win[:, 1] + 20) & (win[:, 2] > win[:, 0] + 20)).mean()
            rows.append((cy, cx, h[cy, cx], blue, *win.mean(0)))
    return np.array(rows)

def main(man, root, world='greenworld', kinds=('coast', 'island', 'old coast', 'water')):
    by_depth = {}; by_dist = {}
    for s in json.load(open(man))['sections']:
        if s['world'] != world or s['kind'] not in kinds: continue
        art = np.asarray(Image.open(Path(root) / s['art']).convert('RGB'))
        h = np.asarray(Image.open(Path(root) / s['heights'])).astype(np.float32)
        r = section_samples(art, h)
        water = r[:, 3] > .9; land = r[:, 3] < .05
        if water.sum() < 20 or land.sum() < 20: continue
        # Sea level: the height that best separates water cells from land cells.
        hs = r[:, 2]; best = None
        for t in np.unique(hs):
            err = ((hs[water] >= t).sum() + (hs[land] < t).sum())
            if best is None or err < best[0]: best = (err, t)
        sea = best[1]
        wet = np.zeros(h.shape, bool)
        for row in r[water]: wet[int(row[0]), int(row[1])] = True
        dist = ndimage.distance_transform_edt(wet) * 16
        for row in r[water]:
            d = sea - row[2]; k = int(np.clip(d // 4, 0, 30))
            by_depth.setdefault(k, []).append(row[4:7])
            j = int(dist[int(row[0]), int(row[1])] // 16)
            by_dist.setdefault(j, []).append(d)
    print('depth(units)  n    R     G     B   luma')
    for k in sorted(by_depth):
        a = np.array(by_depth[k]); m = a.mean(0)
        print(f'  {k*4:3d}-{k*4+3:<3d} {len(a):5d} {m[0]:5.1f} {m[1]:5.1f} {m[2]:5.1f} {.299*m[0]+.587*m[1]+.114*m[2]:5.1f}')
    print('distance from shore (px)  median depth  p25  p75')
    for j in sorted(by_dist)[:10]:
        a = np.array(by_dist[j])
        print(f'  {j*16:4d}  {np.median(a):6.1f} {np.percentile(a,25):6.1f} {np.percentile(a,75):6.1f}  n={len(a)}')

main(sys.argv[1], sys.argv[2])
