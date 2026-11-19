"""Retail match harness: each reproduction window split by terrain class, retail beside ours, in numbers and 1x crops.

  match_classes.py <render-root> --out DIR [--worlds green] [--crop 256]

<render-root> is a repro/all.sh output (what repro/match.sh renders): one directory per window with retail.png, heights.npy,
crop.json, ours.png and ours-heights.json. Each side is classed by its own heights, then projected to screen space the way the
picture is drawn (a cell shows at screenY = worldY - (height - plain)/2, retail_crop.py), so a class mask lies on the pixels that
class actually drew. The classes:

  water   below the sea;
  shore   dry, within SHORE_PX px of water;
  level   dry, slope under .08 (height units per px, on 16 px cells as stats.py measures);
  slope   dry, slope .08 to .5;
  steep   dry, slope .5 and over (cliffs, faces).

Both sides are classed from 16 px height cells, so a class boundary can sit up to half a cell from where the picture changes: each
mask loses EDGE_PX px (half a cell) at its border, so a number describes the class, not the seam between two. A retail coast is
drawn by its tiles, not by its heights, so a mask can still hold the other side of a waterline: a dry class drops pixels whose color
within COAST_PX of a waterline is nearer that side's own water than that class's own color, and the water drops pixels nearer the land
(`unmixed`). Per class and side:
share of the window, mean color (sRGB and CIELAB), luma mean and spread, band-pass energy at 2, 8 and 32 px, edge density and thin
dark line density (stats.py's definitions, read inside the mask). Then plain-language findings where a gap passes a threshold
(THRESHOLDS below), largest first, and 1x crops: for each class, the 256 px square where retail has the most of it, cut from both
pictures at the same place and doubled (nearest neighbor) so a picture reader keeps single pixels.

Writes <out>/classes.json (every number), <out>/classes.md (the findings, the table), and <out>/crops/<window>/<class>.png
(retail left, ours right). Retail pixels stay in <out>, which must be outside the checkout (AGENTS.md rule 6).
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
from stats import (DISK5, EDGE_THRESH, FPS, THIN_THRESH, WORLD_BASE, find_windows, luma,  # noqa: E402
                   resample_heights, srgb_to_lab)

CLASSES = ['water', 'shore', 'level', 'slope', 'steep']
SHORE_PX = 40
EDGE_PX = 8   # half a 16 px height cell
LEVEL, STEEP = .08, .5
# A finding is reported when a gap passes its threshold: luma in 0-255 units, color as CIELAB distance of the class means, share
# in points of the window, and the texture numbers as a ratio ours / retail outside [1/r, r].
THRESHOLDS = {'share': .05, 'luma': 8.0, 'color': 6.0, 'spread': 1.3, 'band': 1.3, 'edges': 1.5, 'lines': 1.6}
# Below these both sides are too faint for a ratio to mean anything (a share of pixels).
FLOORS = {'edges': .004, 'lines': .0003}
MIN_PIXELS = 4000   # a class with fewer pixels on either side gets no texture comparison
UNMIX_WARN = .25    # warn when unmixing drops more than this share of a class
COAST_PX = 24       # unmixing looks this far from a waterline (one and a half height cells)


def cell_classes(h, spacing):
    """Class index per cell (CLASSES order) from heights above the sea, one per `spacing` px."""
    dry = h >= 0
    gy, gx = np.gradient(h, spacing, spacing)
    slope = np.hypot(gx, gy)
    near = ndimage.distance_transform_edt(dry) * spacing <= SHORE_PX
    out = np.full(h.shape, 2, np.uint8)
    out[slope >= LEVEL] = 3
    out[slope >= STEEP] = 4
    out[dry & near & (slope < STEEP)] = 1
    out[~dry] = 0
    return out


def screen_classes(cls, h, plain, size):
    """Project a cell class grid to size x size screen pixels: each world row y draws at y - (h - plain)/2, later (nearer) rows
    over earlier ones, as the game draws; pixels no row reaches take the nearest one drawn."""
    n = cls.shape[0]
    k = size / n
    hp = np.asarray(Image.fromarray(h.astype(np.float32), mode='F').resize((size, size), Image.BILINEAR), np.float64)
    cp = np.repeat(np.repeat(cls, math.ceil(k), 0), math.ceil(k), 1)[:size, :size]
    out = np.full((size, size), 255, np.uint8)
    xs = np.arange(size)
    for y in range(size):
        sy = np.round(y - (hp[y] - plain) / 2).astype(int)
        ok = (sy >= 0) & (sy < size)
        out[sy[ok], xs[ok]] = cp[y, ok]
    hole = out == 255
    if hole.any() and not hole.all():
        idx = ndimage.distance_transform_edt(hole, return_distances=False, return_indices=True)
        out = out[tuple(idx)]
    return out


def masks(screen, valid):
    out = {}
    for i, name in enumerate(CLASSES):
        m = screen == i
        out[name] = ndimage.binary_erosion(m, iterations=EDGE_PX) & valid
    return out


def unmixed(rgb, ms, screen):
    """Near a waterline only (COAST_PX of it, by the side's own heights), drop from each dry class the pixels whose color is nearer
    this side's water than that class's own, and from the water those nearer the land: a coast drawn off its height cells (retail's
    tiles) puts water pixels inside a shore mask. Medians of the side's own classes, so it needs no world's colors; away from the
    coast nothing is touched (gray rock on a snow world is not water). A side with too little water or land is left alone."""
    water = ms['water']
    dry = np.zeros_like(water)
    for name in CLASSES[1:]:
        dry |= ms[name]
    if water.sum() < MIN_PIXELS or dry.sum() < MIN_PIXELS:
        return ms
    near_water = ndimage.distance_transform_edt(screen != 0) <= COAST_PX
    near_land = ndimage.distance_transform_edt(screen == 0) <= COAST_PX
    px = rgb.astype(np.float64)
    dist = lambda c: np.linalg.norm(px - c, axis=2)
    to_water = dist(np.median(px[water], axis=0))
    out = dict(ms)
    for name in CLASSES[1:]:
        if ms[name].sum() >= MIN_PIXELS:
            out[name] = ms[name] & ~(near_water & (to_water < dist(np.median(px[ms[name]], axis=0))))
    out['water'] = water & ~(near_land & (dist(np.median(px[dry], axis=0)) < to_water))
    return out


def texture_maps(rgb):
    """Per-pixel maps the class statistics read: luma, edges, thin dark lines, and band-pass at 2, 8 and 32 px."""
    L = luma(rgb)
    smooth = ndimage.gaussian_filter(L, 1.0)
    gm = np.hypot(ndimage.sobel(smooth, 0) / 8.0, ndimage.sobel(smooth, 1) / 8.0)
    th = ndimage.grey_closing(smooth, footprint=DISK5) - smooth
    op = np.max([ndimage.grey_opening(th, footprint=f) for f in FPS], axis=0)
    bands = {s: ndimage.gaussian_filter(L, max(s / 2, .5)) - ndimage.gaussian_filter(L, s) for s in (2, 8, 32)}
    return {'L': L, 'edge': gm >= EDGE_THRESH, 'thin': op >= THIN_THRESH, 'bands': bands, 'lab': np.stack(srgb_to_lab(rgb.reshape(-1, 3)), axis=1).reshape(rgb.shape[0], rgb.shape[1], 3)}


def class_stats(rgb, maps, m):
    n = int(m.sum())
    out = {'share': n / m.size, 'pixels': n}
    if n < MIN_PIXELS:
        return out
    out.update({
        'rgb': [float(v) for v in rgb[m].mean(axis=0)],
        'lab': [float(v) for v in maps['lab'][m].mean(axis=0)],
        'luma': float(maps['L'][m].mean()),
        'spread': float(maps['L'][m].std()),
        'edges': float(maps['edge'][m].mean()),
        'lines': float(maps['thin'][m].mean()),
        **{f'band{s}': float(b[m].std()) for s, b in maps['bands'].items()},
    })
    return out


def side(pic_path, h, plain, size_check=None):
    rgb = np.asarray(Image.open(pic_path).convert('RGB'))
    size = rgb.shape[0]
    valid = ~np.all(rgb == 0, axis=2)
    inner = np.zeros_like(valid)
    inner[4:-4, 4:-4] = True
    cls = cell_classes(h, size / h.shape[0])
    screen = screen_classes(cls, h, plain, size)
    before = masks(screen, valid & inner)
    after = unmixed(rgb, before, screen)
    # The share of each class unmixing dropped: a world whose land and water look alike could lose a class to it.
    dropped = {n: 1 - after[n].sum() / before[n].sum() for n in CLASSES if before[n].sum() >= MIN_PIXELS}
    return rgb, after, dropped


def ratio(a, b):
    if not a or not b:
        return float('nan')
    return b / a


def sizes(r, o):
    """Every gap's size in threshold units, reported or not (1 is the threshold), so the trial log can tell a finding that cleared
    from one that slipped just under its threshold."""
    out = {'share': abs(o['share'] - r['share']) / THRESHOLDS['share']}
    if 'luma' not in r or 'luma' not in o:
        return out
    out['luma'] = abs(o['luma'] - r['luma']) / THRESHOLDS['luma']
    out['color'] = math.dist(r['lab'], o['lab']) / THRESHOLDS['color']
    for key in ('spread', 'band2', 'band8', 'band32', 'edges', 'lines'):
        t = THRESHOLDS['band' if key.startswith('band') else key]
        q = ratio(r[key], o[key])
        out[key] = 0.0 if max(r[key], o[key]) < FLOORS.get(key, 0) else (abs(math.log(q) / math.log(t)) if math.isfinite(q) and q > 0 else 2.0)
    return {k: round(v, 3) for k, v in out.items()}


def findings(name, r, o):
    """Plain-language gaps for one class, each with its size for ranking (in threshold units)."""
    out = []
    ds = o['share'] - r['share']
    if abs(ds) >= THRESHOLDS['share']:
        out.append((abs(ds) / THRESHOLDS['share'], f'{name}:share', f"{name}: ours covers {o['share']:.0%} of the window, retail {r['share']:.0%} (a shape gap: fix the strokes or the landform first)"))
    if 'luma' not in r or 'luma' not in o:
        return out
    dl = o['luma'] - r['luma']
    if abs(dl) >= THRESHOLDS['luma']:
        out.append((abs(dl) / THRESHOLDS['luma'], f'{name}:luma', f"{name}: ours {'brighter' if dl > 0 else 'darker'} by {abs(dl):.0f} luma (retail {r['luma']:.0f}, ours {o['luma']:.0f})"))
    dc = math.dist(r['lab'], o['lab'])
    if dc >= THRESHOLDS['color']:
        rl, ol = r['lab'], o['lab']
        hue = lambda lab: (math.degrees(math.atan2(lab[2], lab[1])) % 360, math.hypot(lab[1], lab[2]))
        (rh, rc), (oh, oc) = hue(rl), hue(ol)
        bits = []
        if abs(oc - rc) > 3:
            bits.append('more saturated' if oc > rc else 'grayer')
        dh = (oh - rh + 180) % 360 - 180
        if min(rc, oc) > 5 and abs(dh) > 8:
            bits.append(f"hue turned {abs(dh):.0f} degrees {'toward yellow/red' if (dh < 0) == (rh < 180) else 'toward green/blue'}")
        rgb = lambda v: '#%02x%02x%02x' % tuple(int(round(max(0, min(255, c)))) for c in v)
        out.append((dc / THRESHOLDS['color'], f'{name}:color', f"{name}: color off by {dc:.0f} (CIELAB) - retail mean {rgb(r['rgb'])}, ours {rgb(o['rgb'])}{'; ' + ', '.join(bits) if bits else ''}"))
    words = {'spread': 'tone spread (luma s.d.)', 'band2': 'fine grain (2 px)', 'band8': 'mid texture (8 px)', 'band32': 'broad patches (32 px)',
             'edges': 'edge density', 'lines': 'thin dark lines (cracks, creases)'}
    for key, label in words.items():
        t = THRESHOLDS['band' if key.startswith('band') else key]
        if max(r[key], o[key]) < FLOORS.get(key, 0):
            continue   # both too faint to matter
        q = ratio(r[key], o[key])
        if not math.isfinite(q):
            if r[key] != o[key] and max(r[key], o[key]) > 1e-3:
                out.append((2.0, f'{name}:{key}', f"{name}: {label} - retail {r[key]:.3g}, ours {o[key]:.3g}"))
            continue
        if q >= t or q <= 1 / t:
            size = math.log(q) / math.log(t)
            out.append((abs(size), f'{name}:{key}', f"{name}: {label} ours {q:.2f}x retail ({'too much' if q > 1 else 'too little'}; retail {r[key]:.3g}, ours {o[key]:.3g})"))
    return out


def best_square(mask, size):
    """Top-left of the size x size square holding the most of a mask, or None when it holds under a tenth."""
    n = mask.shape[0]
    if n < size:
        return None
    s = ndimage.uniform_filter(mask.astype(np.float32), size, mode='constant')
    half = size // 2
    inner = s[half:n - size + half + 1, half:n - size + half + 1]
    y, x = np.unravel_index(np.argmax(inner), inner.shape)
    if inner[y, x] < .1:
        return None
    return int(y), int(x)


def crop_pair(rpic, opic, at, size, label, path):
    y, x = at
    a = Image.fromarray(rpic[y:y + size, x:x + size]).resize((size * 2, size * 2), Image.NEAREST)
    b = Image.fromarray(opic[y:y + size, x:x + size]).resize((size * 2, size * 2), Image.NEAREST)
    gap = 8
    out = Image.new('RGB', (size * 4 + gap, size * 2 + 18), (24, 24, 24))
    out.paste(a, (0, 18))
    out.paste(b, (size * 2 + gap, 18))
    d = ImageDraw.Draw(out)
    d.text((4, 3), f'retail  {label}  x{x} y{y} {size}px at 2x', fill=(230, 230, 230))
    d.text((size * 2 + gap + 4, 3), 'ours', fill=(230, 230, 230))
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path)


def window(d, out, crop):
    crop_meta = json.loads((d / 'crop.json').read_text())
    rh = np.load(d / 'heights.npy').astype(np.float64)
    rplain = float(crop_meta.get('plain', 0.0))
    data = json.loads((d / 'ours-heights.json').read_text())
    g = int(data['grid'])
    oh = np.asarray(data['heights'], np.float64).reshape(g, g) - float(data.get('sea', 0.0))
    opic_size = Image.open(d / 'ours.png').size[0]
    oh = resample_heights(oh, max(2, round(opic_size / 16)))
    oplain = float(data.get('base', WORLD_BASE.get(d.name.split('-', 1)[0], 24)))
    rpic, rm, rdrop = side(d / 'retail.png', rh, rplain)
    opic, om, odrop = side(d / 'ours.png', oh, oplain)
    warn = [f'{who} {n}: unmixing dropped {x:.0%} of its pixels as the other side of the waterline (land and water colors alike?)'
            for who, dropped in (('retail', rdrop), ('ours', odrop)) for n, x in dropped.items() if x > UNMIX_WARN]
    rmaps, omaps = texture_maps(rpic), texture_maps(opic)
    result = {'classes': {}, 'findings': [], 'crops': {}, 'warnings': warn}
    found = []
    for name in CLASSES:
        r, o = class_stats(rpic, rmaps, rm[name]), class_stats(opic, omaps, om[name])
        result['classes'][name] = {'retail': r, 'ours': o, 'sizes': sizes(r, o)}
        found += findings(name, r, o)
        at = best_square(rm[name], crop)
        if at:
            p = out / 'crops' / d.name / f'{name}.png'
            crop_pair(rpic, opic, at, crop, f'{d.name} {name}', p)
            result['crops'][name] = str(p)
    found.sort(key=lambda f: -f[0])
    result['findings'] = [{'size': round(s, 2), 'key': k, 'text': t} for s, k, t in found]
    return result


def table_md(name, res):
    rows = [f'### {name}', '']
    if res['findings']:
        rows += ['Findings, largest first (size = gap in threshold units):', '']
        rows += [f"- **{f['size']:.1f}** {f['text']}" for f in res['findings'][:12]]
    else:
        rows += ['No class gap passes a threshold.']
    rows += ['', '| class | share r / o | luma r / o | spread r / o | grain 2px r / o | 8px r / o | 32px r / o | edges r / o | lines r / o |',
             '| --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    for c, v in res['classes'].items():
        r, o = v['retail'], v['ours']
        cell = lambda k, f='{:.0f}': (f.format(r[k]) if k in r else '-') + ' / ' + (f.format(o[k]) if k in o else '-')
        rows.append(f"| {c} | {r['share']:.0%} / {o['share']:.0%} | {cell('luma')} | {cell('spread', '{:.1f}')} | {cell('band2', '{:.2f}')} | "
                    f"{cell('band8', '{:.2f}')} | {cell('band32', '{:.2f}')} | {cell('edges', '{:.3f}')} | {cell('lines', '{:.4f}')} |")
    if res['crops']:
        rows += ['', 'Crops (retail left, ours right, 2x): ' + ', '.join(f'[{c}]({p})' for c, p in res['crops'].items())]
    return '\n'.join(rows) + '\n'


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('root')
    ap.add_argument('--out', required=True)
    ap.add_argument('--worlds', default='')
    ap.add_argument('--crop', type=int, default=256)
    a = ap.parse_args(argv)
    out = Path(a.out)
    repo = Path(__file__).resolve().parent.parent
    if out.resolve().is_relative_to(repo):
        raise SystemExit('match_classes.py: --out must be outside the checkout (retail pixels).')
    worlds = find_windows(a.root)
    want = [w for w in a.worlds.split(',') if w]
    all_res = {}
    md = ['# Per-class gaps: retail vs ours', '',
          'Each side is classed by its own heights (water, shore, level, slope, steep). `r` is retail, `o` ours.', '']
    for w, dirs in worlds.items():
        if want and w not in want:
            continue
        for d in dirs:
            res = window(d, out, a.crop)
            all_res[d.name] = res
            md.append(table_md(d.name, res))
            md += [f'- WARNING: {x}' for x in res['warnings']] + ([''] if res['warnings'] else [])
    out.mkdir(parents=True, exist_ok=True)
    (out / 'classes.json').write_text(json.dumps(all_res, indent=1))
    (out / 'classes.md').write_text('\n'.join(md))
    for name, res in all_res.items():
        top = res['findings'][:3]
        print(f'{name:16s} ' + ('; '.join(f["text"] for f in top) if top else 'no class gap over threshold'))
        for x in res['warnings']:
            print(f'{"":16s} WARNING: {x}')
    print(f'classes {out / "classes.md"}; crops {out / "crops"}/<window>/<class>.png')


if __name__ == '__main__':
    main()
