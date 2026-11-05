"""Retail Green hills: form table and the per-cell steepness band.
  hill_band.py retail <retail-green-dir>      tile every retail Green map into 64-cell (1024 px) windows, measure the raised forms
  hill_band.py ours <ours-heights.json> ...   the same measures on a render's heights (render.mjs ours-heights.json, 2 px samples)
Per-cell steepness (the game keeps one height byte per 16-px cell): max minus min of the cell's four corner heights, in height units.
Only numbers are written; no retail pixels or heights."""
import json, sys
from pathlib import Path
import numpy as np
from scipy import ndimage

def cell_steep(h):
    a, b, c, d = h[:-1, :-1], h[:-1, 1:], h[1:, :-1], h[1:, 1:]
    return np.maximum.reduce([a, b, c, d]) - np.minimum.reduce([a, b, c, d])

def forms(h, px, base, min_rise=12, edge_ok=False):
    raised = h > base + 4
    labels, count = ndimage.label(raised)
    out = []
    steep = cell_steep(h)
    for k in range(1, count + 1):
        m = labels == k
        if m.sum() * px * px < 900: continue
        if not edge_ok and (m[0].any() or m[-1].any() or m[:, 0].any() or m[:, -1].any()): continue
        rise = float(h[m].max() - base)
        if rise < min_rise: continue
        dist = ndimage.distance_transform_edt(m) * px
        rel = (h - base) / rise
        def reach(level):
            sel = m & (rel >= level - .05) & (rel <= level + .05)
            return float(np.median(dist[sel])) if sel.any() else np.nan
        nd = dist[m] / dist[m].max(); rm = rel[m]
        prof = [float(np.median(rm[(nd >= i / 8) & (nd < (i + 1) / 8 + (i == 7) * 1e-6)])) if ((nd >= i / 8) & (nd < (i + 1) / 8 + (i == 7) * 1e-6)).any() else np.nan for i in range(8)]
        gy, gx = np.gradient(h, px); slope = np.hypot(gx, gy)[m]
        cm = m[:-1, :-1] & m[1:, 1:] & m[:-1, 1:] & m[1:, :-1]
        out.append(dict(rise=rise, area=float(m.sum() * px * px), d20=reach(.2), d50=reach(.5), d80=reach(.8),
                        flat=float((rel[m] >= .9).mean()), prof=prof, s50=float(np.median(slope)), s90=float(np.percentile(slope, 90)),
                        cells=steep[cm]))
    return out

def table(name, rows, bins=((0, 45), (45, 80), (80, 1e9))):
    print(f'{name}: {len(rows)} forms')
    print(f'{"rise bin":>10} {"n":>3} {"rise":>5} {"area":>7} {"w20-80":>6} {"flat10":>6} {"s50":>5} {"s90":>5} | cell step p50 p90 p95 p99 max')
    for lo, hi in bins:
        r = [x for x in rows if lo <= x['rise'] < hi]
        if not r: continue
        med = lambda k: float(np.median([x[k] for x in r if np.isfinite(x[k])]))
        w = float(np.median([x['d80'] - x['d20'] for x in r if np.isfinite(x['d80'] - x['d20'])]))
        c = np.concatenate([x['cells'] for x in r])
        print(f'{lo:>4}-{hi if hi < 1e8 else "up":>5} {len(r):>3} {med("rise"):5.0f} {med("area"):7.0f} {w:6.0f} {med("flat"):6.2f} {med("s50"):5.2f} {med("s90"):5.2f} | '
              + ' '.join(f'{np.percentile(c, p):4.1f}' for p in (50, 90, 95, 99)) + f' {c.max():4.0f}')

if __name__ == '__main__':
    if sys.argv[1] == 'retail':
        root = Path(sys.argv[2]); rows = []; win = 64
        for d in sorted(root.iterdir()):
            if not (d / 'heights.bin').exists(): continue
            meta = json.load(open(d / 'metadata.json'))
            cells = np.fromfile(d / 'heights.bin', np.uint8).reshape(meta['cell_height'], meta['cell_width']).astype(np.float32)
            sea = meta['sea_level']
            for y in range(0, cells.shape[0] - win + 1, win):
                for x in range(0, cells.shape[1] - win + 1, win):
                    h = cells[y:y + win, x:x + win]
                    base = float(np.median(np.concatenate([h[0], h[-1], h[:, 0], h[:, -1]])))
                    if base < sea + 2 or (h < sea).mean() > .05: continue
                    rows += forms(h, 16.0, base)
        rows = [r for r in rows if r['area'] < 400000]
        table('retail Green, every raised form of 1024 px windows', rows)
        big = [r for r in rows if r['area'] >= 30000]
        table('retail Green, forms of 30k px2 and more (a 400 px stroke makes 60-100k)', big, bins=((0, 30), (30, 45), (45, 60), (60, 80), (80, 1e9)))
        for lo, hi in ((30, 60), (60, 80)):
            pr = np.nanmedian([r['prof'] for r in big if lo <= r['rise'] < hi], axis=0)
            print(f'section, big forms rise {lo}-{hi}: relative height at distance from foot/inradius 1/16..15/16: ' + ' '.join(f'{v:.2f}' for v in pr))
        for lo, hi in ((0, 45), (0, 60), (0, 80)):
            c = np.concatenate([r['cells'] for r in big if lo <= r['rise'] < hi])
            print(f'band, big forms rise {lo}-{hi}: cell step p90 {np.percentile(c, 90):.1f} p95 {np.percentile(c, 95):.1f} p99 {np.percentile(c, 99):.1f}')
    else:
        for p in sys.argv[2:]:
            d = json.load(open(p)); g = d['grid']; h = np.array(d['heights'], np.float32).reshape(g, g)
            h = h[::8, ::8] if g == 512 else h   # 2 px samples -> 16 px cells
            base = float(np.median(np.concatenate([h[0], h[-1], h[:, 0], h[:, -1]])))
            fs = forms(h, 16.0, base, edge_ok=True)
            table(p, fs)
            for r in fs: print(f'  rise {r["rise"]:.0f} section: ' + ' '.join(f'{v:.2f}' for v in r['prof']))
