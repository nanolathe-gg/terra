"""Retail match harness: each window broken into the stages a terrain picture is made of, so a gap can be traced to the stage that
carries it before anything is tuned or proposed (docs/retail-match/README.md, "Stages").

  match_stages.py <stages-dir> [--crop 192]

<stages-dir>/scenes/<window>/ holds the retail crop (retail.png, heights.npy, crop.json) and our renders of the same world files, each
in its own folder with ours.png: final/ (the picture, with ours-heights.json), predither/ (page setting palette=off: the picture before
the output dither), clay/ (the Clay box: light and relief on a plain material) and material/ (view=material: the ground's material
unlit). repro/match.sh --stages renders them.

Retail is one finished picture, so its stages are estimates. Each estimator runs the same way on retail's picture and on ours (the
`est` columns), so the two compare like for like, and our own engine views are the truth that checks the estimator on our side (its
`trust`): an estimator that cannot recover our own stage from our own picture says little about retail's. A trust under TRUST_MIN marks
that stage's retail estimate untrusted for the class. The stages:

 1. height   the 16 px heights, retail's own (heights.npy) and our cells, drawn to the screen as the picture is: relief at 32 and 64 px.
             Real heights on both sides, so no estimate. Finer height detail is not recovered from the picture. Measured on red-3: linear
             shape from shading on our own render found our own detail heights at a correlation of only .06, while our Clay render
             follows our screen-drawn height gradient at .66 at 64 px, .45 at 16 px and .12 at 4 px (so the drawing to the screen is
             right). The likely cause: fine shading comes mostly from the material's relief, not the heights. Compare fine relief in
             the light stage instead.
 2. light    the step within a palette ramp. The game's palette is twelve 16-step ramps and four 8-step ones, each one hue from light
             to dark; terrain art is painted along them, so a pixel's ramp says which paint (material) it is and its step how lit
             (light times the paint's own tone). Steps are blurred by DEDITHER_SIGMA and each ramp's own mean is taken out.
             Trust: correlation with our Clay render, finer than CUT_PX (dry ground only: the Clay render draws no water).
 3. placement which ramp each pixel uses: the paint map. Compared as each class's share of every ramp (total variation distance,
             0 the same, 1 nothing shared) and how patchy it is (ramp changes per pixel after a 3x3 majority). Trust: our picture's
             ramp shares against our unlit material view's (does the light push pixels into other ramps?); dry ground only.
 4. predither the picture before the output dither: luma blurred by DEDITHER_SIGMA. On our renders this blur brings the dithered and
             the undithered picture within 7% in edge density and 2% in 2 px grain (red-3, measured when this was written), so it
             removes our dither from the numbers; ours' true value is our palette=off render. Grain at 2, 8 and 32 px and edges.
 5. dither   what the blur took away: its strength (luma s.d.) and its direction (the correlation of horizontal and of vertical pixel
             neighbors; retail drawn in rows correlates differently across than down).

These are diagnostics. Nothing here may be copied into a world or a scene: no traced masks, heights or paint maps (CLAUDE.md rule 10).
A stage gap says which kind of lever to look at (README.md, "Stages"), not what to paint.

Writes <stages-dir>/stages.json and stages.md (per window and class: each stage's numbers and its gap), and per window
sheets/<window>/retail.png (retail's five stages alone, for a read before seeing ours), sheets/<window>/compare.png (rows: the
stages; columns: retail estimate, our estimate, our engine's view; half size) and sheets/<window>/<class>.png (the same at 2x on the
class's crop). Retail-derived pictures stay under <stages-dir>, outside the checkout.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from match_classes import CLASSES, WATER, MIN_PIXELS, best_square, side  # noqa: E402
from stats import EDGE_THRESH, WORLD_BASE, luma, resample_heights  # noqa: E402

DEDITHER_SIGMA = 1.0
CUT_PX = 32          # the light stage's detail band: finer than this
TRUST_MIN = .5
STAGES = ['height', 'light', 'placement', 'predither', 'dither']
# A stage gap in threshold units (1 is a finding): ratios as |log(ours/retail)| / log(RATIO), shares as distance / SHARE.
RATIO = 1.3
SHARE = .15
PALETTE = Path(__file__).resolve().parent.parent / 'materials' / 'palette.json'


def palette():
    cols = np.asarray(json.loads(PALETTE.read_text())['indexed'], np.int64)
    ramp = np.full(256, -1)
    step = np.zeros(256)
    for i in range(16, 208):
        ramp[i], step[i] = (i - 16) // 16, ((i - 16) % 16) / 15
    for i in range(208, 240):
        ramp[i], step[i] = 12 + (i - 208) // 8, ((i - 208) % 8) / 7
    return cols, ramp, step


COLS, RAMP, STEP = palette()
RAMPS = int(RAMP.max()) + 1
RAMP_COLOR = np.array([COLS[16 + r * 16 + 6] if r < 12 else COLS[208 + (r - 12) * 8 + 3] for r in range(RAMPS)], np.uint8)


def indices(rgb):
    """Palette index per pixel: the exact color, or the nearest of the ramps' colors (a render off the palette, such as palette=off)."""
    key = (rgb[..., 0].astype(np.int64) << 16) | (rgb[..., 1].astype(np.int64) << 8) | rgb[..., 2]
    table = {int((c[0] << 16) | (c[1] << 8) | c[2]): i for i, c in reversed(list(enumerate(COLS))) if i >= 16 and i < 240}
    flat = key.ravel()
    out = np.array([table.get(int(k), -1) for k in np.unique(flat)])
    uniq = np.unique(flat)
    miss = out < 0
    if miss.any():
        u = np.stack([(uniq[miss] >> 16) & 255, (uniq[miss] >> 8) & 255, uniq[miss] & 255], 1).astype(np.float64)
        ramp_cols = COLS[16:240].astype(np.float64)
        out[miss] = 16 + np.argmin(((u[:, None, :] - ramp_cols[None]) ** 2).sum(2), 1)
    return out[np.searchsorted(uniq, flat)].reshape(key.shape)


def light_estimate(idx):
    """Stage 2: 1 - step within the ramp (1 lit, 0 dark), de-dithered, each ramp's own mean taken out (its paint's tone)."""
    ramp, step = RAMP[idx], STEP[idx]
    lit = 1 - step
    out = lit.copy()
    for r in np.unique(ramp):
        m = ramp == r
        if m.sum() > 50:
            out[m] -= lit[m].mean()
    return ndimage.gaussian_filter(out, DEDITHER_SIGMA)


def majority(ramp):
    """Each pixel's most common ramp in its 3x3 neighbourhood (the dither mixes neighbouring steps, rarely ramps)."""
    best, count = ramp.copy(), np.zeros(ramp.shape)
    for r in np.unique(ramp):
        c = ndimage.uniform_filter((ramp == r).astype(np.float32), 3)
        better = c > count
        best[better], count[better] = r, c[better]
    return best


def screen_heights(h, plain, size):
    """A height grid drawn to the screen as the picture is (match_classes.screen_classes, with values): each world row at
    y - (h - plain)/2, nearer rows over farther; pixels no row reaches take the nearest one drawn."""
    hp = np.asarray(Image.fromarray(h.astype(np.float32), mode='F').resize((size, size), Image.BILINEAR), np.float64)
    out = np.full((size, size), np.nan)
    xs = np.arange(size)
    for y in range(size):
        sy = np.round(y - (hp[y] - plain) / 2).astype(int)
        ok = (sy >= 0) & (sy < size)
        out[sy[ok], xs[ok]] = hp[y, ok]
    hole = np.isnan(out)
    if hole.any() and not hole.all():
        idx = ndimage.distance_transform_edt(hole, return_distances=False, return_indices=True)
        out = out[tuple(idx)]
    return out


def detail(h):
    return h - ndimage.gaussian_filter(h, CUT_PX / 4)


def corr(a, b, m):
    a, b = a[m], b[m]
    if a.size < MIN_PIXELS or a.std() == 0 or b.std() == 0:
        return float('nan')
    return float(np.corrcoef(a, b)[0, 1])


def band(x, s):
    return ndimage.gaussian_filter(x, max(s / 2, .5)) - ndimage.gaussian_filter(x, s)


def edges(x):
    gy, gx = ndimage.sobel(x, 0) / 8.0, ndimage.sobel(x, 1) / 8.0
    e = np.hypot(gx, gy) >= EDGE_THRESH
    return e, np.abs(gy) > np.abs(gx)   # an edge that changes down the picture is a horizontal line


def side_maps(rgb, coarse_screen):
    L = luma(rgb)
    idx = indices(rgb)
    lit = light_estimate(idx)
    pre = ndimage.gaussian_filter(L, DEDITHER_SIGMA)
    out = {'L': L, 'idx': idx, 'ramp': majority(RAMP[idx]), 'light': lit, 'pre': pre, 'resid': L - pre}
    out['height'] = coarse_screen
    return out


def ramp_shares(ramp, m):
    r = ramp[m]
    r = r[r >= 0]
    return np.bincount(r, minlength=RAMPS) / max(r.size, 1)


def patchiness(ramp, m):
    ch = np.zeros(ramp.shape, bool)
    ch[:, 1:] |= ramp[:, 1:] != ramp[:, :-1]
    ch[1:] |= ramp[1:] != ramp[:-1]
    return float(ch[m].mean())


def class_numbers(maps, m, truth=None):
    if m.sum() < MIN_PIXELS:
        return None
    o = {}
    e, horiz = edges(maps['pre'])
    o['predither'] = {f'band{s}': float(band(maps['pre'], s)[m].std()) for s in (2, 8, 32)}
    o['predither']['edges'] = float(e[m].mean())
    o['predither']['horizontal'] = float(horiz[e & m].mean()) if (e & m).sum() > 50 else float('nan')
    r = maps['resid']
    o['dither'] = {'strength': float(r[m].std()),
                   'across': float(np.corrcoef(r[:, :-1][m[:, :-1]], r[:, 1:][m[:, :-1]])[0, 1]),
                   'down': float(np.corrcoef(r[:-1][m[:-1]], r[1:][m[:-1]])[0, 1])}
    lit = maps['light']
    le, lh = edges(lit * 255)
    o['light'] = {'spread': float(lit[m].std()), 'band8': float(band(lit, 8)[m].std()), 'band32': float(band(lit, 32)[m].std()),
                  'horizontal': float(lh[le & m].mean()) if (le & m).sum() > 50 else float('nan')}
    o['placement'] = {'shares': ramp_shares(maps['ramp'], m).round(4).tolist(), 'patchiness': patchiness(maps['ramp'], m)}
    h = maps['height']
    o['height'] = {'relief32': float(band(h, 32)[m].std()), 'relief64': float(band(h, 64)[m].std())}
    if truth:
        t = {}
        if 'clay' in truth:
            t['light'] = corr(detail(lit), detail(truth['clay']), m)
        if 'material_ramp' in truth:
            a, b = ramp_shares(maps['ramp'], m), ramp_shares(truth['material_ramp'], m)
            t['placement'] = float(1 - .5 * np.abs(a - b).sum())
        if 'predither' in truth:
            q = ndimage.gaussian_filter(truth['predither'], DEDITHER_SIGMA)
            t['predither'] = corr(maps['pre'], q, m)
            qe, _ = edges(q)
            o['predither_true'] = {**{f'band{s}': float(band(q, s)[m].std()) for s in (2, 8, 32)}, 'edges': float(qe[m].mean())}
        if 'height_detail' in truth:   # our heights finer than the cells (no retail counterpart): for reference
            o['height_fine'] = {'relief4': float(band(truth['height_detail'], 4)[m].std()), 'relief16': float(band(truth['height_detail'], 16)[m].std())}
        o['trust'] = {k: (round(v, 3) if math.isfinite(v) else None) for k, v in t.items()}
    return o


def lr(a, b):
    if not (a and b) or not all(map(math.isfinite, (a, b))) or a <= 0 or b <= 0:
        return 0.0
    return abs(math.log(b / a)) / math.log(RATIO)


def stage_gaps(r, o):
    """Each stage's gap for one class in threshold units, and the words for its largest part."""
    g = {}
    rp, op = r['predither'], o['predither']
    parts = {k: lr(rp[k], op[k]) for k in ('band2', 'band8', 'band32', 'edges')}
    k = max(parts, key=parts.get)
    g['predither'] = (parts[k], f"{k} ours {op[k] / rp[k] if rp[k] else float('nan'):.2f}x retail")
    rl, ol = r['light'], o['light']
    parts = {k: lr(rl[k], ol[k]) for k in ('spread', 'band8', 'band32')}
    if all(math.isfinite(x) for x in (rl['horizontal'], ol['horizontal'])):
        parts['horizontal'] = abs(ol['horizontal'] - rl['horizontal']) / .1
    k = max(parts, key=parts.get)
    g['light'] = (parts[k], f"{k} retail {rl[k]:.3g}, ours {ol[k]:.3g}")
    a, b = np.array(r['placement']['shares']), np.array(o['placement']['shares'])
    tv = .5 * np.abs(a - b).sum()
    over = int(np.argmax(b - a)) if tv > 0 else -1
    under = int(np.argmax(a - b)) if tv > 0 else -1
    pg = max(tv / SHARE, lr(r['placement']['patchiness'], o['placement']['patchiness']))
    g['placement'] = (pg, f"ramp shares {tv:.0%} apart (ours more of ramp {over}, less of ramp {under}); patchiness retail "
                          f"{r['placement']['patchiness']:.3f}, ours {o['placement']['patchiness']:.3f}")
    rd, od = r['dither'], o['dither']
    dg = max(lr(rd['strength'], od['strength']), abs(od['across'] - rd['across']) / .1, abs(od['down'] - rd['down']) / .1)
    g['dither'] = (dg, f"strength retail {rd['strength']:.1f}, ours {od['strength']:.1f}; neighbor correlation across/down retail "
                       f"{rd['across']:.2f}/{rd['down']:.2f}, ours {od['across']:.2f}/{od['down']:.2f}")
    if 'height' in r and 'height' in o:
        parts = {k: lr(r['height'][k], o['height'][k]) for k in ('relief32', 'relief64')}
        k = max(parts, key=parts.get)
        g['height'] = (parts[k], f"{k} retail {r['height'][k]:.2f}, ours {o['height'][k]:.2f} (height units, 16 px heights)")
    return {k: {'size': round(v[0], 2), 'text': v[1]} for k, v in g.items()}


def read(path):
    return np.asarray(Image.open(path).convert('RGB'))


def window(d):
    final = d / 'final'
    crop_meta = json.loads((d / 'crop.json').read_text())
    rh = np.load(d / 'heights.npy').astype(np.float64)
    rplain = float(crop_meta.get('plain', 0.0))
    data = json.loads((final / 'ours-heights.json').read_text())
    g = int(data['grid'])
    raw = np.clip(np.asarray(data['heights'], np.float64).reshape(g, g), 0, 255) - float(data.get('sea', 0.0))
    size = Image.open(final / 'ours.png').size[0]
    oplain = float(data.get('base', WORLD_BASE.get(d.name.split('-', 1)[0], 24)))
    ocells = resample_heights(raw, max(2, round(size / 16)))
    rpic, rmasks, _ = side(d / 'retail.png', rh, rplain)
    opic, omasks, _ = side(final / 'ours.png', ocells, oplain)
    o_true_h = screen_heights(raw, oplain, size)
    truth = {'height_detail': detail(o_true_h)}
    if (d / 'clay' / 'ours.png').exists():
        truth['clay'] = luma(read(d / 'clay' / 'ours.png')) / 255
    if (d / 'material' / 'ours.png').exists():
        truth['material_ramp'] = majority(RAMP[indices(read(d / 'material' / 'ours.png'))])
    if (d / 'predither' / 'ours.png').exists():
        truth['predither'] = luma(read(d / 'predither' / 'ours.png'))
    rmaps = side_maps(rpic, screen_heights(rh, rplain, size))
    omaps = side_maps(opic, screen_heights(ocells, oplain, size))
    res = {'classes': {}}
    for c in CLASSES:
        r = class_numbers(rmaps, rmasks[c])
        t = {k: v for k, v in truth.items() if not (c in WATER and k in ('height_detail', 'material_ramp', 'clay'))}
        o = class_numbers(omaps, omasks[c], t)
        if not r or not o:
            continue
        if c in WATER:
            r.pop('height', None)
            o.pop('height', None)
        gaps = stage_gaps(r, o)
        trust = o.get('trust', {})
        for k, v in gaps.items():
            tv = trust.get(k)
            v['trusted'] = tv is None or tv >= TRUST_MIN
        res['classes'][c] = {'retail': r, 'ours': o, 'gaps': gaps, 'trust': trust}
    sheets(d, rmaps, omaps, truth, rmasks, opic, rpic)
    return res


def gray(x, lo=None, hi=None):
    lo = np.nanpercentile(x, 1) if lo is None else lo
    hi = np.nanpercentile(x, 99) if hi is None else hi
    return np.clip((x - lo) / (hi - lo + 1e-9) * 255, 0, 255).astype(np.uint8)


def height_picture(h, rng=None):
    """Height as gray with a dark contour every 1/24 of the range (the window's, or `rng` shared by a row): what rises, not shading."""
    lo, hi = rng or (np.nanpercentile(h, 1), np.nanpercentile(h, 99))
    step = max((hi - lo) / 24, 1e-6)
    g = gray(h, lo, hi).astype(np.int32)
    q = np.floor(h / step)
    line = np.zeros(h.shape, bool)
    line[:, 1:] |= q[:, 1:] != q[:, :-1]
    line[1:] |= q[1:] != q[:-1]
    g[line] = g[line] // 3
    return np.stack([g] * 3, -1).astype(np.uint8)


def ramp_picture(ramp):
    out = np.zeros(ramp.shape + (3,), np.uint8)
    ok = ramp >= 0
    out[ok] = RAMP_COLOR[ramp[ok]]
    return out


def stage_pictures(maps, light_range, height_range):
    rgb = lambda g: np.stack([g] * 3, -1)
    return [height_picture(maps['height'], height_range), rgb(gray(maps['light'], *light_range)), ramp_picture(maps['ramp']),
            np.clip(ndimage.gaussian_filter(maps['rgb'].astype(np.float64), (DEDITHER_SIGMA, DEDITHER_SIGMA, 0)), 0, 255).astype(np.uint8),
            maps['rgb']]


ROWS = ['height (16 px heights; ours: true, finer)', 'light (step within the palette ramp)', 'placement (palette ramp: the paint)',
        'before the dither (blurred 1 px)', 'final']


def grid(cells, labels, cols_labels, scale):
    h, w = cells[0][0].shape[:2]
    h2, w2 = int(h * scale), int(w * scale)
    pad, head = 6, 16
    out = Image.new('RGB', (len(cells[0]) * (w2 + pad), len(cells) * (h2 + head) + head), (24, 24, 24))
    d = ImageDraw.Draw(out)
    for j, c in enumerate(cols_labels):
        d.text((j * (w2 + pad) + 4, 2), c, fill=(230, 230, 230))
    for i, row in enumerate(cells):
        y = head + i * (h2 + head)
        d.text((4, y + 2), labels[i], fill=(200, 200, 160))
        for j, im in enumerate(row):
            if im is None:
                continue
            pic = Image.fromarray(im).resize((w2, h2), Image.NEAREST if scale >= 1 else Image.BILINEAR)
            out.paste(pic, (j * (w2 + pad), y + head))
    return out


def sheets(d, rmaps, omaps, truth, rmasks, opic, rpic):
    rmaps['rgb'], omaps['rgb'] = rpic, opic
    both = np.concatenate([rmaps['light'].ravel(), omaps['light'].ravel()])
    lr_ = (np.percentile(both, 1), np.percentile(both, 99))
    hb = np.concatenate([rmaps['height'].ravel(), omaps['height'].ravel()])
    hr = (np.percentile(hb, 1), np.percentile(hb, 99))
    rp, op = stage_pictures(rmaps, lr_, hr), stage_pictures(omaps, lr_, hr)
    rgb = lambda g: np.stack([g] * 3, -1)
    true_h = None
    final = d / 'final'
    tp = [None,
          rgb(gray(truth['clay'])) if 'clay' in truth else None,
          ramp_picture(truth['material_ramp']) if 'material_ramp' in truth else None,
          read(d / 'predither' / 'ours.png') if (d / 'predither' / 'ours.png').exists() else None,
          read(final / 'ours.png')]
    if 'height_detail' in truth:
        data = json.loads((final / 'ours-heights.json').read_text())
        g = int(data['grid'])
        raw = np.clip(np.asarray(data['heights'], np.float64).reshape(g, g), 0, 255) - float(data.get('sea', 0.0))
        true_h = screen_heights(raw, float(data.get('base', 24)), opic.shape[0])
        tp[0] = height_picture(true_h, hr)
    out = d.parent.parent / 'sheets' / d.name
    out.mkdir(parents=True, exist_ok=True)
    grid([[x] for x in rp], ROWS, ['retail (estimated stages)'], .5).save(out / 'retail.png')
    cols = ['retail, estimated', 'ours, estimated the same way', "ours, the engine's own view"]
    grid([[a, b, c] for a, b, c in zip(rp, op, tp)], ROWS, cols, .5).save(out / 'compare.png')
    n = 192
    for c in CLASSES:
        at = best_square(rmasks[c], n)
        if not at:
            continue
        y, x = at
        cut = lambda im: None if im is None else im[y:y + n, x:x + n]
        grid([[cut(a), cut(b), cut(t)] for a, b, t in zip(rp, op, tp)], ROWS, [f'{c} x{x} y{y}: ' + cols[0], cols[1], cols[2]], 2).save(out / f'{c}.png')


def md(name, res):
    rows = [f'### {name}', '']
    lines = []
    for c, v in res['classes'].items():
        for k, g in v['gaps'].items():
            lines.append((g['size'], c, k, g))
    lines.sort(key=lambda x: -x[0])
    rows += ['Largest stage gaps (size in threshold units; untrusted = our estimate does not recover our own view here):', '']
    for size, c, k, g in lines[:10]:
        if size < 1:
            break
        rows.append(f"- **{size:.1f}** {c} {k}: {g['text']}{'' if g['trusted'] else ' (estimate untrusted here: trust ' + str(res['classes'][c]['trust'].get(k)) + ')'}")
    rows += ['', '| class | ' + ' | '.join(STAGES) + ' | trust (light, placement, predither) |', '| --- |' + ' --- |' * (len(STAGES) + 1)]
    for c, v in res['classes'].items():
        t = v['trust']
        cell = lambda k: f"{v['gaps'][k]['size']:.1f}{'' if v['gaps'][k]['trusted'] else '?'}" if k in v['gaps'] else '-'
        rows.append(f"| {c} | " + ' | '.join(cell(k) for k in STAGES) + ' | ' + ', '.join(str(t.get(k, '-')) for k in ('light', 'placement', 'predither')) + ' |')
    rows += ['', f'Sheets: sheets/{name}/retail.png (retail alone), compare.png, <class>.png', '']
    return '\n'.join(rows)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('root')
    a = ap.parse_args(argv)
    root = Path(a.root)
    repo = Path(__file__).resolve().parent.parent
    if root.resolve().is_relative_to(repo):
        raise SystemExit('match_stages.py: the stages folder must be outside the checkout (retail pixels).')
    out, text = {}, ['# Stages: retail estimated vs ours', '',
                     'Each stage is estimated from the picture the same way on both sides; our engine views check the estimate (trust). '
                     'A stage gap points at a kind of lever (README.md, "Stages"). Nothing here may be copied into a world or a scene.', '']
    for d in sorted((root / 'scenes').iterdir()):
        if not (d / 'final' / 'ours.png').exists():
            continue
        res = window(d)
        out[d.name] = res
        text.append(md(d.name, res))
        top = sorted(((g['size'], c, k, g) for c, v in res['classes'].items() for k, g in v['gaps'].items()), key=lambda x: -x[0])[:3]
        print(f"{d.name:10s} " + '; '.join(f"{c} {k} {s:.1f}{'' if g['trusted'] else '?'} ({g['text']})" for s, c, k, g in top))
    (root / 'stages.json').write_text(json.dumps(out, indent=1))
    (root / 'stages.md').write_text('\n'.join(text))
    print(f'stages {root / "stages.md"}; sheets {root / "sheets"}/<window>/compare.png, retail.png, <class>.png')


if __name__ == '__main__':
    main()
