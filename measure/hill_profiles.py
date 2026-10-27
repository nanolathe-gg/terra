"""Hill form from heights: rise, footprint, 20-80% rise width, slope spread."""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

def hills(h, px, base=None, min_rise=12):
    base = np.median(np.concatenate([h[0], h[-1], h[:, 0], h[:, -1]])) if base is None else base
    raised = h > base + 4
    labels, count = ndimage.label(raised)
    out = []
    for k in range(1, count + 1):
        m = labels == k
        if m.sum() * px * px < 900: continue
        rise = h[m].max() - base
        if rise < min_rise: continue
        # Distance from the footprint edge, in world px.
        dist = ndimage.distance_transform_edt(m) * px
        rel = (h - base) / rise
        def reach(level):
            sel = m & (rel >= level - .05) & (rel <= level + .05)
            return np.median(dist[sel]) if sel.any() else np.nan
        gy, gx = np.gradient(h, px)
        slope = np.hypot(gx, gy)[m]
        out.append(dict(rise=float(rise), area=float(m.sum() * px * px), d20=reach(.2), d50=reach(.5), d80=reach(.8),
                        slope50=float(np.median(slope)), slope90=float(np.percentile(slope, 90))))
    return out

def summary(name, rows):
    a = {k: np.array([r[k] for r in rows], float) for k in rows[0]}
    print(f'{name}: {len(rows)} raised forms')
    for k in ['rise', 'area', 'd20', 'd50', 'd80', 'slope50', 'slope90']:
        v = a[k][np.isfinite(a[k])]
        print(f'  {k:8s} median {np.median(v):8.1f}   p25 {np.percentile(v,25):8.1f}  p75 {np.percentile(v,75):8.1f}')
    w = a['d80'] - a['d20']; w = w[np.isfinite(w)]
    print(f'  width 20-80% rise: median {np.median(w):.1f} px  (p25 {np.percentile(w,25):.1f}, p75 {np.percentile(w,75):.1f})')
    r = a['rise'] / np.maximum(a['d80'] - a['d20'], 1); r = r[np.isfinite(r)]
    print(f'  rise per 20-80% width: median {np.median(r):.2f}')

if __name__ == '__main__':
    if sys.argv[1] == 'retail':
        man, root = sys.argv[2], Path(sys.argv[3]); rows = []
        for s in json.load(open(man))['sections']:
            if s['world'] != 'greenworld' or s['kind'] != 'hills': continue
            h = np.asarray(Image.open(root / s['heights'])).astype(np.float32)
            rows += hills(h, 16.0)
        summary('retail greenworld hills', rows)
    else:
        for path in sys.argv[2:]:
            d = json.load(open(path)); g = d['grid']
            h = np.array(d['heights'], np.float32).reshape(g, g)
            summary(Path(path).stem, hills(h, (d['size'] - 1) / (g - 1), base=d['base']))
