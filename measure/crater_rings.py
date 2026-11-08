"""Big retail craters: what stands outside the rim (card lfimpact; docs/IMPACT_RETAIL.md).

  python measure/crater_rings.py <world,...> [min rim diameter px, default 120] [out.json] [--apron]

Reads each retail map's 16-px heights under $R/retail-<world> (R=/private/tmp/nanolathe-map-editor) and finds the round, rimmed bowls (cells 3 units
under a 31-cell median of the ground; rim 2+ units over the ground at 3-4 rim radii, depth 4+ under it, the rim radius varying by under 30% round the
ring). Retail maps reuse crater art, so craters with the same rim diameter, rim and depth are counted once (`n`: how many copies). For each it prints the
rim crest radius R (the median of 72 sectors' highest point between .7 and 2.5 bowl radii), the rim's height over the far ground and the depth under
it, where the outer flank comes down (10% of the rim's height), and the ground past the rim with the radial median removed (the residual): its s.d. by
band, its blocks (connected cells 3+ units over the median profile, 1.05-2.2 R: count, mean radius, angular width, highest point) and the share of the
azimuth carrying a secondary crest (a sector's local maximum past 1.15 R, 2+ units prominent over the troughs .3 R each side). --apron adds the art's
contrast round each crater (the luma s.d. of 8 x 8 px blocks by band over the plain's at 3-4 R, and the share of blocks above the plain's 90th
percentile). Prints numbers only: no retail pixels or heights are written.
"""
import json, os, sys, math, numpy as np
from scipy import ndimage as ndi
R = '/private/tmp/nanolathe-map-editor'
ARGS = [a for a in sys.argv[1:] if a != '--apron']; APRON = '--apron' in sys.argv
worlds = ARGS[0].split(',') if __name__ == '__main__' and ARGS else []
min_d = float(ARGS[1]) if __name__ == '__main__' and len(ARGS) > 1 else 120
out_json = ARGS[2] if __name__ == '__main__' and len(ARGS) > 2 else None
SECT = 72; DR = 0.25

def load(root, d):
    m = json.load(open(os.path.join(root, d, 'metadata.json')))
    w, h = m['width'] // 16, m['height'] // 16
    return m, np.fromfile(os.path.join(root, d, 'heights.bin'), dtype=np.uint8)[:w * h].reshape(h, w).astype(float)

def sectors(hm, cy, cx, rmax):
    rs = np.arange(0, rmax + 1e-6, DR); P = np.full((SECT, len(rs)), np.nan); H, W = hm.shape
    for i in range(SECT):
        t = (i + .5) * 2 * math.pi / SECT; ys = cy + rs * math.sin(t); xs = cx + rs * math.cos(t)
        ok = (ys >= 0) & (xs >= 0) & (ys <= H - 1) & (xs <= W - 1)
        if ok.any(): P[i, ok] = ndi.map_coordinates(hm, [ys[ok], xs[ok]], order=1)
    return rs, P

def measure(hm, cy, cx, rb, far=None, rmax=None):
    rs, P = sectors(hm, cy, cx, rmax if rmax else 4.5 * rb + 8)
    if far is None and np.isnan(P).mean() > 0.1: return None
    lo, hi = np.searchsorted(rs, 0.7 * rb), np.searchsorted(rs, 2.5 * rb + 1.5)
    rim_r = np.array([rs[lo + np.nanargmax(P[i, lo:hi])] for i in range(SECT)])
    Rr = float(np.median(rim_r)); cv = float(np.std(rim_r) / max(Rr, 1e-6))
    u = rs / Rr
    f = (u >= 3.0) & (u <= 4.0)
    if far is None:
        if not f.any(): return None
        far = float(np.nanmedian(P[:, f]))
    med = np.nanmedian(P, 0)
    floor = float(np.nanmin(med[u <= 0.5])) if (u <= 0.5).any() else float(med[0])
    rim = float(np.nanmedian([np.nanmax(P[i, (u >= .8) & (u <= 1.2)]) for i in range(SECT)])) - far
    depth = far - floor
    # the outer flank: where the median profile (past its crest) first falls to 10% of the rim height
    jc = int(np.nanargmax(np.where((u >= .8) & (u <= 1.2), med, -1e9)))
    reach = next((u[j] for j in range(jc, len(u)) if med[j] - far <= 0.1 * max(rim, 1)), float('nan'))
    # residual on the grid: the cells' heights less the median profile at their radius
    r0 = int(math.ceil(3.2 * Rr)) + 1
    ys, xs = np.mgrid[int(cy) - r0:int(cy) + r0 + 1, int(cx) - r0:int(cx) + r0 + 1]
    ok = (ys >= 0) & (xs >= 0) & (ys < hm.shape[0]) & (xs < hm.shape[1])
    rr = np.hypot(ys - cy, xs - cx) / Rr; th = np.arctan2(ys - cy, xs - cx)
    hv = np.where(ok, hm[np.clip(ys, 0, hm.shape[0] - 1), np.clip(xs, 0, hm.shape[1] - 1)], np.nan)
    res = hv - np.interp(rr * Rr, rs, np.nan_to_num(med, nan=far))
    bands = [(1.0, 1.25), (1.25, 1.5), (1.5, 2.0), (2.0, 2.5), (3.0, 4.0)]
    spread = []
    for a, b in bands:
        m_ = ok & (rr >= a) & (rr < b)
        spread.append(float(np.nanstd(res[m_])) if m_.sum() > 3 else float('nan'))
    # blocks: residual >= 3 units, 1.05-2.2 R
    blk = ok & (rr >= 1.05) & (rr < 2.2) & (res >= 3.0)
    lab, n = ndi.label(blk)
    blocks = []
    for k in range(1, n + 1):
        cc = lab == k
        if cc.sum() < 2: continue
        ang = th[cc]; a0 = np.angle(np.mean(np.exp(1j * ang)))
        width = float(np.degrees(np.ptp(np.angle(np.exp(1j * (ang - a0))))) + 360.0 / (2 * math.pi * float(np.mean(rr[cc])) * Rr) * 1.0)
        blocks.append(dict(u=float(np.mean(rr[cc])), w=width, h=float(np.max(res[cc])), cells=int(cc.sum())))
    # secondary crests: per sector, local maxima past 1.15 R (and past the rim crest's own fall), prominence >= 2 against the lowest point within .3 R each side
    crests = []
    for i in range(SECT):
        p = P[i]; w = max(1, int(round(0.3 * Rr / DR)))
        for j in np.nonzero((u >= 1.15) & (u <= 2.6))[0]:
            if j < 1 or j >= len(p) - 1 or np.isnan(p[j]): continue
            if p[j] >= p[j - 1] and p[j] > p[j + 1]:
                prom = p[j] - max(np.nanmin(p[max(0, j - w):j]), np.nanmin(p[j + 1:j + 1 + w]))
                if prom >= 2.0: crests.append((i, float(u[j]), float(p[j] - far), float(prom)))
    cband = []
    for a, b in ((1.15, 1.5), (1.5, 2.0), (2.0, 2.6)):
        cband.append(len({c[0] for c in crests if a <= c[1] < b}) / SECT)
    return dict(R=Rr, D=2 * Rr * 16, cv=cv, rim=rim, depth=depth, reach=float(reach), spread=spread, blocks=blocks, crests=crests, cband=cband, far=far)

def apron(world, d, cy, cx, Rpx):
    root = R + '/retail-' + world + '/' + d
    m = json.load(open(root + '/metadata.json')); W, H = m['width'], m['height']
    idx = np.memmap(root + '/map-indexed.bin', dtype=np.uint8, mode='r', shape=(H, W)); pal = np.fromfile(root + '/palette-rgb.bin', dtype=np.uint8).reshape(256, 3).astype(float)
    luma = pal @ np.array([.299, .587, .114])
    px, py, half = int(cx * 16), int(cy * 16), int(4.1 * Rpx)
    x0, y0, x1, y1 = max(0, px - half) // 8 * 8, max(0, py - half) // 8 * 8, min(W, px + half) // 8 * 8, min(H, py + half) // 8 * 8
    B = luma[np.asarray(idx[y0:y1, x0:x1])].reshape((y1 - y0) // 8, 8, (x1 - x0) // 8, 8).std(axis=(1, 3))
    yy, xx = np.mgrid[0:B.shape[0], 0:B.shape[1]]
    rr = np.hypot((yy * 8 + y0 + 4) - py, (xx * 8 + x0 + 4) - px) / Rpx
    plain = B[(rr >= 3) & (rr < 4)]
    if plain.size < 8: return ''
    p50, p90 = np.median(plain), np.percentile(plain, 90)
    return '  '.join(f"{np.median(B[(rr >= a) & (rr < b)]) / p50:4.2f}/{(B[(rr >= a) & (rr < b)] > p90).mean():.2f}" for a, b in ((1.0, 1.25), (1.25, 1.5), (1.5, 1.75), (1.75, 2.0), (2.0, 2.5)))

def main():
    rows = []
    for world in worlds:
        root = R + '/retail-' + world
        for d in sorted(os.listdir(root)):
            if not os.path.isdir(os.path.join(root, d)): continue
            m, hm = load(root, d)
            sm = ndi.gaussian_filter(hm, 1.0); ground = ndi.median_filter(hm, size=31)
            lab, n = ndi.label(sm < ground - 3)
            for k in range(1, n + 1):
                ys, xs = np.nonzero(lab == k)
                if len(ys) < 5: continue
                rb = math.sqrt(len(ys) / math.pi)
                r = measure(hm, ys.mean(), xs.mean(), rb)
                if not r or r['D'] < min_d: continue
                if r['rim'] < 2 or r['depth'] < 4 or r['cv'] > 0.3: continue
                r.update(world=world, map=m['name'], dir=d, cy=round(float(ys.mean()), 1), cx=round(float(xs.mean()), 1))
                rows.append(r)
    # dedupe stamped art: the same (D, rim, depth) rounded
    seen, uniq = {}, []
    for r in sorted(rows, key=lambda r: -r['D']):
        key = (r['world'], round(r['D'] / 16), round(r['rim']), round(r['depth']))
        if key in seen: seen[key]['copies'] += 1; continue
        r['copies'] = 1; seen[key] = r; uniq.append(r)
    print(f"{'world':6s} {'map':22s} {'cy':>6s} {'cx':>6s} {'n':>2s} {'D':>5s} {'cv':>4s} {'rim':>5s} {'dep':>5s} {'reach':>5s} | resid s.d. 1-1.25 1.25-1.5 1.5-2 2-2.5 far | blocks n, at R, deg, h | crests share 1.15-1.5 1.5-2 2-2.6")
    for r in uniq:
        b = r['blocks']
        bs = f"{len(b):2d} {np.mean([x['u'] for x in b]) if b else 0:4.2f} {np.median([x['w'] for x in b]) if b else 0:4.0f} {np.median([x['h'] for x in b]) if b else 0:4.1f}"
        if APRON: bs += '  | art ' + apron(r['world'], r['dir'], r['cy'], r['cx'], r['R'] * 16)
        print(f"{r['world']:6s} {r['map']:22s} {r['cy']:6.1f} {r['cx']:6.1f} {r['copies']:2d} {r['D']:5.0f} {r['cv']:4.2f} {r['rim']:5.1f} {r['depth']:5.1f} {r['reach']:5.2f} | {' '.join(f'{s:4.1f}' for s in r['spread'])} | {bs} | {' '.join(f'{s:.2f}' for s in r['cband'])}")
    if out_json:
        for r in uniq: r.pop('crests', None)
        json.dump(uniq, open(out_json, 'w'), indent=1)

if __name__ == '__main__':
    main()
