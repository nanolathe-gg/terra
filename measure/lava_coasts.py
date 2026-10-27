"""Lava finger coasts on retail maps against our captures.

    python lava_coasts.py edge ROOT [MAP...]     colours across the waterline
    python lava_coasts.py bank ROOT [MAP...]     height by distance from lava
    python lava_coasts.py fingers ROOT OUT [MAP...]  finger and inlet shapes

ROOT is a directory of retail exports or of sculpt captures (lava_bands
iter_maps). The edge and finger measurements work on the art as drawn
(screen space), where the lava is the palette's molten family; the bank
profile works in world space (lava_world.py).

Distances are signed: + on land, - in lava, in px from the waterline. A
waterline pixel's outward normal points from land into lava; light comes
from the west, so a west-looking edge faces the light.
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import distance_transform_edt, find_objects, gaussian_filter, label

from lava_bands import iter_maps
from lava_world import LAVA, world_tile

LUMA = np.array([.299, .587, .114])
FACING = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']  # outward normal, screen y down


def masks(m):
    """Lava pixels, with specks under 6 px (art grain) given to their
    surroundings."""
    lava = LAVA[m.idx]
    for target in (True, False):
        lab, n = label(lava == target, np.ones((3, 3)))
        small = np.bincount(lab.ravel()) < 6
        small[0] = False
        lava = np.where(small[lab], not target, lava)
    return lava


def signed(lava):
    d_land, ind = distance_transform_edt(~lava, return_indices=True)  # land: distance to lava
    d_lava = distance_transform_edt(lava)
    sd = np.where(lava, -d_lava, d_land)
    # outward normal of the nearest waterline: from the land pixel toward its
    # nearest lava pixel
    ny = ind[0] - np.arange(lava.shape[0])[:, None]
    nx = ind[1] - np.arange(lava.shape[1])[None, :]
    return sd, nx, ny


def facing_bin(nx, ny):
    a = np.degrees(np.arctan2(ny, nx))  # 0 = E, 90 = S (screen)
    return (np.round(a / 45).astype(int) % 8)


def edge(root, names):
    out = {}
    for m in iter_maps(root, names):
        lava = masks(m)
        if lava.mean() < .002 or lava.mean() > .995:
            continue
        sd, nx, ny = signed(lava)
        fb = facing_bin(nx, ny)
        lum = m.palette.astype(np.float32) @ LUMA
        res = {}
        for d in range(-6, 13):
            sel = (np.rint(sd) == d) if d > 0 else (np.rint(sd) == d - 0)
            if d == 0:
                continue
            row = {}
            for f in range(8):
                s = sel & (fb == f) if d > 0 else sel
                if s.sum() < 50:
                    continue
                c = np.bincount(m.idx[s], minlength=256)
                top = np.argsort(-c)[:4]
                row[FACING[f] if d > 0 else 'lava'] = dict(n=int(s.sum()), luma=round(float(lum[m.idx[s]].mean()), 1),
                                                          top=[[int(i), round(float(c[i] / s.sum()), 2)] for i in top])
                if d < 0:
                    break
            res[d] = row
        out[m.name] = res
        print('done', m.name, file=sys.stderr)
    return out


def bank(root, names):
    out = {}
    for m in iter_maps(root, names):
        if (LAVA[m.idx]).mean() < .002:
            continue
        acc = np.zeros(161); n = np.zeros(161)
        for y0 in range(0, m.H, 1024):
            for x0 in range(0, m.W, 1024):
                x1, y1 = min(m.W, x0 + 1024), min(m.H, y0 + 1024)
                wh, lum, idx, vis = world_tile(m, x0, y0, x1, y1)
                lava = LAVA[idx]
                if lava.mean() < .002 or lava.mean() > .998:
                    continue
                d = distance_transform_edt(~lava)
                k = np.rint(d).astype(int)
                ok = (k <= 160) & ~lava & vis
                np.add.at(acc, k[ok], wh[ok] - m.sea)
                np.add.at(n, k[ok], 1)
        prof = acc / np.maximum(n, 1)
        out[m.name] = {int(d): round(float(prof[d]), 1) for d in range(0, 161, 4) if n[d] > 100}
        print('done', m.name, file=sys.stderr)
    return out


def fingers(root, outdir, names, sigma=40):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    out = {}
    for m in iter_maps(root, names):
        lava = masks(m)
        if lava.mean() < .002 or lava.mean() > .995:
            continue
        land = ~lava
        pad = 3 * sigma
        sm = gaussian_filter(np.pad(land.astype(np.float32), pad, mode='reflect'), sigma)[pad:-pad, pad:-pad]
        coast = sm > .5
        sgy, sgx = np.gradient(sm)
        # depth beyond the smoothed coast, on either side
        beyond_land = distance_transform_edt(~coast)  # for land pixels outside the smooth land
        beyond_lava = distance_transform_edt(coast)
        border = np.zeros_like(land)
        b = 24
        border[:b] = border[-b:] = True
        border[:, :b] = border[:, -b:] = True
        smooth_len = float((np.abs(gaussian_filter(coast.astype(np.float32), 1) - .5) < .25).sum() / 2)
        rec = {'smooth_coast_px': round(smooth_len)}
        for kind, mask, depth in (('land_fingers', land & ~coast, beyond_land), ('lava_inlets', lava & coast, beyond_lava)):
            lab, n = label(mask, np.ones((3, 3)))
            rows = []
            for i, sl in enumerate(find_objects(lab), 1):
                comp = lab[sl] == i
                if comp.sum() < 12 or border[sl][comp].any():
                    continue
                dep = depth[sl][comp]
                L = float(dep.max())
                if L < 4:
                    continue
                # width at depth bands: pixels in a 2-px depth band / 2 px
                widths = []
                for frac in (.1, .5, .85):
                    dd = frac * L
                    widths.append(float(((dep >= dd - 1) & (dep < dd + 1)).sum() / 2.0))
                thick = 2 * distance_transform_edt(np.pad(comp, 1))[1:-1, 1:-1]
                yy, xx = np.nonzero(comp)
                yy = yy + sl[0].start
                xx = xx + sl[1].start
                base = dep <= dep.min() + max(2.0, .15 * L)
                by, bx = yy[base].mean(), xx[base].mean()
                tip = dep >= .9 * L
                ty, tx = yy[tip].mean(), xx[tip].mean()
                # outward normal of the smoothed coast at the base (land into lava)
                iy, ix = int(round(by)), int(round(bx))
                gy, gx = sgy[iy, ix], sgx[iy, ix]
                nrm = np.hypot(gx, gy) + 1e-9
                nx, ny = -gx / nrm, -gy / nrm
                if kind == 'lava_inlets':
                    nx, ny = -nx, -ny
                ax, ay = tx - bx, ty - by
                ang = float(np.degrees(np.arctan2(nx * ay - ny * ax, nx * ax + ny * ay)))
                rows.append(dict(area=int(comp.sum()), length=round(L, 1), w_base=widths[0], w_mid=widths[1],
                                 w_tip=widths[2], max_thick=round(float(thick.max()), 1), x=round(float(bx)),
                                 y=round(float(by)), normal_deg=round(float(np.degrees(np.arctan2(ny, nx)))),
                                 axis_off_normal_deg=round(ang)))
            rec[kind] = rows
        # Alternation along the coast: widths of land and lava runs crossed
        # by curves at fixed offsets from the smoothed coast (+ inland).
        sdc = beyond_lava - beyond_land
        runs = {}
        for off in (-16, -8, 0, 8, 16):
            band = (np.abs(sdc - off) < 1) & ~border
            for nm, msk in (('land', land), ('lava', lava)):
                lab2, n2 = label(band & msk, np.ones((3, 3)))
                w = np.bincount(lab2.ravel())[1:] / 2.0
                w = w[w >= 2]
                runs[f'{off}:{nm}'] = [round(float(v), 1) for v in np.percentile(w, [25, 50, 75])] + [int(len(w))] if len(w) else []
        rec['runs'] = runs
        # islets: small land pieces wholly inside lava
        labl, nl = label(land, np.ones((3, 3)))
        sizes = np.bincount(labl.ravel())
        rec['islets_lt_400px'] = int(((sizes[1:] < 400) & (sizes[1:] >= 6)).sum())
        out[m.name] = rec
        print('done', m.name, file=sys.stderr)
    (outdir / 'fingers.json').write_text(json.dumps(out))
    return out


def summarise_fingers(out):
    lines = []
    for name, rec in out.items():
        cl = rec['smooth_coast_px']
        for kind in ('land_fingers', 'lava_inlets'):
            R = rec[kind]
            big = [r for r in R if r['length'] >= 8]
            if not big:
                lines.append(f'{name:18s} {kind}: none')
                continue
            L = np.array([r['length'] for r in big]); wb = np.array([r['w_base'] for r in big])
            wm = np.array([r['w_mid'] for r in big]); wt = np.array([r['w_tip'] for r in big])
            th = np.array([r['max_thick'] for r in big])
            q = lambda a: '/'.join('%.0f' % v for v in np.percentile(a, [25, 50, 75]))
            lines.append(f'{name:18s} {kind:12s} n={len(big):4d} per 100 px coast {100 * len(big) / max(cl, 1):.2f} | '
                         f'length {q(L)} | max thickness {q(th)} | width base/mid/tip med {np.median(wb):.0f}/{np.median(wm):.0f}/{np.median(wt):.0f} '
                         f'| tip/mid {np.median(wt / np.maximum(wm, 1)):.2f} | length>=40: {(L >= 40).mean():.2f}')
        for kind in ('land_fingers', 'lava_inlets'):
            for lab_, lo, hi in (('normal S (north bank)', 45, 135), ('normal N (south bank)', -135, -45), ('normal E/W', None, None)):
                R = [r for r in rec[kind] if r['length'] >= 8 and (
                    (lo is not None and lo <= r['normal_deg'] <= hi) or
                    (lo is None and (abs(r['normal_deg']) < 45 or abs(r['normal_deg']) > 135)))]
                if len(R) < 5:
                    continue
                L = np.array([r['length'] for r in R]); off = np.array([abs(r['axis_off_normal_deg']) for r in R])
                lines.append(f'   {kind:12s} {lab_:22s} n={len(R):4d} length p25/50/75 ' + '/'.join('%.0f' % v for v in np.percentile(L, [25, 50, 75]))
                             + f' | axis off normal |deg| p50/75 {np.percentile(off, 50):.0f}/{np.percentile(off, 75):.0f}'
                             + f' | width mid med {np.median([r["w_mid"] for r in R]):.0f} tip/mid {np.median([r["w_tip"] / max(1, r["w_mid"]) for r in R]):.2f}')
        for k, v in rec.get('runs', {}).items():
            if v:
                lines.append(f'   run widths at offset {k:10s} p25/50/75 {v[0]:.0f}/{v[1]:.0f}/{v[2]:.0f}  n={v[3]}  per 100 px coast {100 * v[3] / max(cl, 1):.1f}')
        lines.append(f'{name:18s} islets (6-400 px) {rec["islets_lt_400px"]} per 1000 px coast {1000 * rec["islets_lt_400px"] / max(cl, 1):.2f}')
    return lines


if __name__ == '__main__':
    cmd, root = sys.argv[1], sys.argv[2]
    if cmd == 'edge':
        print(json.dumps(edge(root, sys.argv[3:])))
    elif cmd == 'bank':
        print(json.dumps(bank(root, sys.argv[3:])))
    elif cmd == 'fingers':
        for line in summarise_fingers(fingers(root, sys.argv[3], sys.argv[4:])):
            print(line)
