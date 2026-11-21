"""Numbers sheet for retail/editor reproduction windows (backlog card C3).

For every rendered window it reports height and picture metrics for retail and
for ours, and for every world the 10th-50th-90th percentile range of the same
metrics over many seeded retail windows. Text-only reviews can then say
"ours is outside the world's family" without looking at a picture.

  stats.py <render-root> [--out DIR] [--worlds green,ice] [--samples 24]
           [--seed 2701] [--retail-root DIR] [--zhon-sections DIR]
  stats.py --selftest

<render-root> is a repro/all.sh output (or a copy): one directory per window
with retail.png, heights.npy, crop.json, ours.png and ours-heights.json.

Metric definitions (all computed on the window, or on the 1024-px sample):

  height.  From the 16-px cell heights: retail heights.npy is already above
           sea; ours-heights.json is raw and its sea is subtracted. Ours'
           displayed heights are sampled at 2 px over the map, so they are
           averaged down to 16-px cells before any height metric. Slopes are
           height units per world pixel (np.gradient with the cell spacing).
           * slope histogram: dry cells in the interior, bins below;
           * steep shares: dry interior slope > .5 and > 1.0;
           * water share: cells below sea / all cells;
           * shore band: for each dry cell touching water, the distance in px
             to the nearest cell at plain height; median. Plain height is
             crop.json's `plain` for retail and the world's baseHeight for
             ours (24; 8 for Archipelago and Zhon);
           * roughness: s.d. of heights minus a Gaussian of 8 px and 32 px,
             over dry interior cells (height units).

  pic.     From retail.png and ours.png; all-zero rows and columns are masked
           first (Zhon sections carry about 31 black rows at the top where the
           projection reaches above the section).
           * luma mean and s.d. (Rec. 601 luma, 0-255);
           * Lab histogram distance: 10x8x8 bins in CIELAB, chi-square
             distance to the world family's pooled histogram (leave-one-out
             for family windows);
           * edge density: pixels whose blurred Sobel gradient exceeds 10,
             as a share of valid pixels;
           * edge orientation shares: edge direction within 22.5 degrees of
             horizontal, vertical, or else diagonal;
           * thin dark line density: black top-hat over a 5-px disk, then a
             5-px linear opening in 8 directions, threshold 24 - dark,
             elongated structures 1-3 px across;
           * band-pass energy at 2, 8 and 32 px: s.d. of a difference of
             Gaussians at sigma s/2 and s, in luma units.

The family sample is seeded and deterministic: --samples windows per world
(default 24, at least 20) are cut from the world's retail exports, or, for
Zhon, from its section art (sections >= 512 px; the 1024-px ones are the
reproduction sources). The same metrics are computed on each family window;
the table's range is the 10th-90th order statistic. The containment check is
on by default: the script exits 1 unless the family band contains at least 80%
of the family's own retail windows (the card's check). Reproduction windows are
curated views rather than a random sample, so their retail containment is
reported as a diagnostic, not used as the gate.

Only numpy, Pillow and scipy (already used by the measure scripts) are
imported. Nothing here goes into Git: retail pixels and derived sheets stay
under /tmp/nanolathe-map-editor.
"""
import argparse
import hashlib
import json
import random
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

WORLD_ORDER = ['green', 'red', 'archipelago', 'moon', 'zhon', 'lava', 'desert', 'crystal', 'ice']


def world_base(world):
    """The world's dry base in the editor: materials/<world>.json world.baseHeight, as sculpt.py reads it (24 where unset;
    card C3 says to use it, not crop.json)."""
    try:
        return float(json.loads((Path(__file__).resolve().parent.parent / 'materials' / f'{world}.json').read_text())['world']['baseHeight'])
    except (OSError, KeyError, TypeError, ValueError):
        return 24.0


WORLD_BASE = {w: world_base(w) for w in WORLD_ORDER}
WORLD_BASE['zhon'] = 8  # Dry base for existing results from the archived scenes.
ZHON_SEA = 59.0  # the sea of the Zhon section crops (crop.json of zhon-1..3)
SAMPLE = 1024
SLOPE_BINS = [0.0, .03, .08, .15, .3, .5, 1.0, 2.0, np.inf]
DISK5 = np.array([[0, 1, 1, 1, 0], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1],
                  [1, 1, 1, 1, 1], [0, 1, 1, 1, 0]], bool)
DEFAULT_R = Path('/tmp/nanolathe-map-editor')
DEFAULT_ZHON = DEFAULT_R / 'catalogs/sections-zhon/TASect_Zhon/sections/zhon'
LUMA = np.array([.299, .587, .114], np.float32)
EDGE_THRESH = 10.0
THIN_THRESH = 24.0


def _line_footprints(length=5, count=8):
    """Boolean line structuring elements at count orientations."""
    out, c = [], length // 2
    for k in range(count):
        th = np.pi * k / count
        f = np.zeros((length, length), bool)
        for t in np.arange(-c, c + 1):
            x = int(round(c + t * np.cos(th))); y = int(round(c + t * np.sin(th)))
            f[y, x] = True
        out.append(f)
    return out


FPS = _line_footprints()


def luma(rgb):
    return np.asarray(rgb, np.float32)[..., :3] @ LUMA


def srgb_to_lab(rgb):
    """sRGB 0-255 -> CIELAB (D65), one row per pixel of an (N,3) array."""
    c = np.asarray(rgb, np.float32) / 255.0
    c = np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)
    m = np.array([[.4124564, .3575761, .1804375],
                  [.2126729, .7151522, .0721750],
                  [.0193339, .1191920, .9503041]], np.float32)
    xyz = c @ m.T
    xyz /= np.array([.95047, 1.0, 1.08883], np.float32)
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    L = 116 * f[:, 1] - 16
    a = 500 * (f[:, 0] - f[:, 1])
    b = 200 * (f[:, 1] - f[:, 2])
    return L, a, b


def lab_histogram(rgb, valid):
    """Normalised 10x8x8 Lab histogram over the valid pixels."""
    L, a, b = srgb_to_lab(rgb[valid])
    li = np.clip((L / 100 * 10).astype(np.int32), 0, 9)
    ai = np.clip(((a + 128) / 32).astype(np.int32), 0, 7)
    bi = np.clip(((b + 128) / 32).astype(np.int32), 0, 7)
    h = np.bincount((li * 8 + ai) * 8 + bi, minlength=640).astype(np.float64)
    total = h.sum()
    return h / total if total else h


def chi2(p, q):
    return float(.5 * np.sum((p - q) ** 2 / (p + q + 1e-12)))


def screen_rows(pic, top, size, colour=lambda rows: rows):
    """Rows top..top+size of a screen-space picture, black outside it."""
    out = np.zeros((size, pic.shape[1], 3), np.uint8)
    a, b = max(top, 0), min(top + size, pic.shape[0])
    if b > a:
        out[a - top:b - top] = colour(np.asarray(pic[a:b]))
    return out


def load_rgb(path):
    """RGB image plus a validity mask. All-black rows/columns are outside the
    section (Zhon's 31 top rows); they are never used for a metric."""
    rgb = (np.asarray(path, np.uint8) if isinstance(path, np.ndarray)
           else np.asarray(Image.open(path).convert('RGB')))
    rows = np.where(~np.all(rgb == 0, axis=(1, 2)))[0]
    cols = np.where(~np.all(rgb == 0, axis=(0, 2)))[0]
    if not len(rows) or not len(cols):
        what = '<array>' if isinstance(path, np.ndarray) else path
        raise SystemExit(f'{what}: the whole picture is black')
    y0, y1, x0, x1 = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
    rgb = rgb[y0:y1, x0:x1]
    valid = ~np.all(rgb == 0, axis=2)
    return rgb, valid


def _fill_rows(a, valid):
    """Replace masked rows by their nearest valid row, for filters only."""
    if valid.all():
        return a
    out = a.copy()
    last = None
    for y in range(a.shape[0]):
        if valid[y].any():
            last = y
        elif last is not None:
            out[y] = out[last]
    first = np.where(valid.any(axis=1))[0][0]
    for y in range(first - 1, -1, -1):
        out[y] = out[first]
    return out


def picture_metrics(path_or_rgb, valid=None):
    """Scalar picture metrics, plus the Lab histogram of the valid pixels."""
    if valid is None:
        rgb, valid = load_rgb(path_or_rgb)
    else:
        rgb = path_or_rgb
    margin = 4
    inner = np.zeros_like(valid)
    inner[margin:-margin, margin:-margin] = True
    valid = valid & inner
    if not valid.any():
        raise SystemExit(f'{path_or_rgb}: no valid pixels after the black-border mask')
    L = luma(rgb)
    Lf = _fill_rows(L, valid)
    n = int(valid.sum())
    metrics = {
        'pic.luma_mean': float(L[valid].mean()),
        'pic.luma_sd': float(L[valid].std()),
    }
    # Edges: a one-pixel blur, then a Sobel gradient per world pixel.
    smooth = ndimage.gaussian_filter(Lf, 1.0)
    gy = ndimage.sobel(smooth, 0) / 8.0
    gx = ndimage.sobel(smooth, 1) / 8.0
    gm = np.hypot(gx, gy)
    edge = valid & (gm >= EDGE_THRESH)
    metrics['pic.edge_density'] = float(edge.sum()) / n
    if edge.any():
        # Gradient direction mod pi is the edge normal; the edge itself runs
        # 90 degrees from it. Horizontal/vertical are within 22.5 degrees.
        ang = (np.arctan2(gy[edge], gx[edge]) + np.pi / 2) % np.pi
        h = ((ang < np.pi / 8) | (ang >= 7 * np.pi / 8)).mean()
        v = (np.abs(ang - np.pi / 2) < np.pi / 8).mean()
        metrics['pic.edge_horizontal'] = float(h)
        metrics['pic.edge_vertical'] = float(v)
        metrics['pic.edge_diagonal'] = float(max(0.0, 1.0 - h - v))
    else:
        metrics['pic.edge_horizontal'] = metrics['pic.edge_vertical'] = metrics['pic.edge_diagonal'] = float('nan')
    # Thin dark lines: black top-hat (dark structures narrower than 5 px),
    # then a 1-px-wide line opening in 8 directions (elongated structures).
    th = ndimage.grey_closing(smooth, footprint=DISK5) - smooth
    op = np.max([ndimage.grey_opening(th, footprint=f) for f in FPS], axis=0)
    metrics['pic.thin_dark_density'] = float((valid & (op >= THIN_THRESH)).sum()) / n
    # Band-pass energy at three pixel scales, as a difference of Gaussians.
    for s in (2, 8, 32):
        band = ndimage.gaussian_filter(Lf, max(s / 2, .5)) - ndimage.gaussian_filter(Lf, s)
        metrics[f'pic.band_{s}px'] = float(band[valid].std())
    hist = lab_histogram(rgb, valid)
    return metrics, hist


def slope_label(lo, hi):
    return f'{lo:.2f}-{hi:.2f}' if np.isfinite(hi) else f'{lo:.2f}+'


def height_metrics(h, spacing, plain):
    """Height metrics for cells above sea, one height per `spacing` world px."""
    h = np.asarray(h, np.float64)
    dry = h >= 0
    water = ~dry
    inner = np.zeros_like(dry)
    inner[1:-1, 1:-1] = True
    dry_in = dry & inner
    sy, sx = (spacing, spacing) if np.isscalar(spacing) else spacing
    gy, gx = np.gradient(h, sy, sx)
    slope = np.hypot(gx, gy)
    out = {
        'height.water_share': float(water.mean()),
        'height.steep_gt_0.5': float((slope[dry_in] > .5).mean()) if dry_in.any() else float('nan'),
        'height.steep_gt_1.0': float((slope[dry_in] > 1.0).mean()) if dry_in.any() else float('nan'),
    }
    if dry_in.any():
        s = slope[dry_in]
        for lo, hi in zip(SLOPE_BINS[:-1], SLOPE_BINS[1:]):
            out[f'height.slope_{slope_label(lo, hi)}'] = float(((s >= lo) & (s < hi)).mean())
    else:
        for lo, hi in zip(SLOPE_BINS[:-1], SLOPE_BINS[1:]):
            out[f'height.slope_{slope_label(lo, hi)}'] = float('nan')
    # Shore band: shoreline dry cells to the nearest cell at plain height.
    plain_cells = dry & (h >= plain)
    shore = dry & ndimage.binary_dilation(water, np.ones((3, 3)))
    if plain_cells.any() and shore.any():
        d = ndimage.distance_transform_edt(~plain_cells) * (sy + sx) / 2
        out['height.shore_band_px'] = float(np.median(d[shore]))
    else:
        out['height.shore_band_px'] = float('nan')
    # Roughness relative to a broad Gaussian, at 8 and 32 px.
    for s in (8, 32):
        sigma = s / ((sy + sx) / 2)
        rough = h - ndimage.gaussian_filter(h, sigma)
        out[f'height.rough_{s}px'] = float(rough[dry_in].std()) if dry_in.any() else float('nan')
    return out


def resample_heights(cells, target):
    """Average a square cell grid down to target x target cells."""
    cells = np.asarray(cells, np.float64)
    n = cells.shape[0]
    if n == target:
        return cells
    if n % target == 0:
        k = n // target
        return cells.reshape(target, k, target, k).mean(axis=(1, 3))
    im = Image.fromarray(cells.astype(np.float32), mode='F')
    return np.asarray(im.resize((target, target), Image.BILINEAR), np.float64)


def map_metadata(path):
    meta = json.loads((path / 'metadata.json').read_text())
    return meta


def usable_map(path):
    m = map_metadata(path)
    return m['width'] >= SAMPLE and m['height'] >= SAMPLE


def family_maps(world, root, count, seed):
    """Seeded 1024-px windows from a world's retail export directories,
    uniform over the world's maps and positions."""
    root = Path(root)
    base = root / f'retail-{world}'
    maps = sorted(p for p in base.iterdir() if (p / 'metadata.json').exists()) if base.is_dir() else []
    maps = [p for p in maps if usable_map(p)]
    if not maps:
        raise SystemExit(f'{world}: no retail map exports under {base}')
    rng = random.Random(int.from_bytes(hashlib.sha256(f'{seed}:{world}'.encode()).digest()[:8], 'big'))
    rng.shuffle(maps)
    wins, seen = [], set()
    i = 0
    while len(wins) < count and i < count * 200:
        md = maps[i % len(maps)]
        i += 1
        meta = map_metadata(md)
        max_x = (meta['width'] - SAMPLE) // 16
        # Leave room for the retail projection offset (<= ~160 rows) so the
        # picture window does not leave the map at the top.
        y_lo = min(256, meta['height'] - SAMPLE)
        max_y = (meta['height'] - SAMPLE) // 16
        y_lo = max(0, y_lo // 16)
        x = rng.randrange(0, max_x + 1) * 16
        y = rng.randrange(y_lo, max_y + 1) * 16
        if (str(md), x, y) in seen:
            continue
        seen.add((str(md), x, y))
        cells = np.memmap(md / 'heights.bin', np.uint8, 'r',
                          shape=(meta['cell_height'], meta['cell_width']))
        cut = np.asarray(cells[y // 16:y // 16 + SAMPLE // 16, x // 16:x // 16 + SAMPLE // 16], np.float64)
        cut -= meta['sea_level']
        dry = cut[cut >= 0]
        plain = float(np.median(dry)) if dry.size else 0.0
        wins.append({'id': f'{world}:{meta["name"]}:{x},{y}', 'map': meta['name'], 'x': x, 'y': y,
                     'plain': plain, 'cells': cut, 'spacing': SAMPLE / cut.shape[0], 'md': md, 'meta': meta})
    out, cache = [], {}
    for c in wins:
        md = c['md']
        if md not in cache:
            meta = c['meta']
            cache[md] = (np.memmap(md / 'map-indexed.bin', np.uint8, 'r', shape=(meta['height'], meta['width'])),
                         np.fromfile(md / 'palette-rgb.bin', np.uint8).reshape(256, 3))
        idx, pal = cache[md]
        off = round((c['meta']['sea_level'] + c['plain']) / 2)
        rgb = screen_rows(idx[:, c['x']:c['x'] + SAMPLE], c['y'] - off, SAMPLE, lambda rows: pal[rows])
        out.append({'id': c['id'], 'map': c['map'], 'x': c['x'], 'y': c['y'],
                    'plain': c['plain'], 'cells': c['cells'], 'rgb': rgb, 'spacing': c['spacing']})
    return out


def family_sections(count, seed):
    """Seeded Zhon section windows (the sections stand in for a retail map)."""
    root = Path(DEFAULT_ZHON)
    if not root.is_dir():
        return []
    arts = sorted(p for p in root.rglob('*.art.png')
                  if Image.open(p).size[0] >= 512 and p.with_name(p.name.replace('.art.png', '.heights.png')).exists())
    if not arts:
        return []
    rng = random.Random(int.from_bytes(hashlib.sha256(f'{seed}:zhon'.encode()).digest()[:8], 'big'))
    rng.shuffle(arts)
    out = []
    for art in arts[:count]:
        height = art.with_name(art.name.replace('.art.png', '.heights.png'))
        rgb = np.asarray(Image.open(art).convert('RGB'))
        cells = np.asarray(Image.open(height).convert('L'), np.float64) - ZHON_SEA
        dry = cells[cells >= 0]
        plain = float(np.median(dry)) if dry.size else 0.0
        off = round((ZHON_SEA + plain) / 2)
        rgb = screen_rows(rgb, -off, rgb.shape[0])
        out.append({'id': f'zhon:{art.parent.name}/{art.name[:-8]}', 'section': str(art),
                    'plain': plain, 'cells': cells, 'rgb': rgb, 'spacing': rgb.shape[0] / cells.shape[0]})
    return out


def family_window(world, root, count, seed):
    return family_sections(count, seed) if world == 'zhon' else family_maps(world, root, count, seed)


def find_windows(root):
    """Reproduction directories in a repro/all.sh output, grouped by world."""
    root = Path(root)
    out = {}
    if not root.is_dir():
        raise SystemExit(f'{root}: not a directory')
    for d in sorted(root.iterdir()):
        if not d.is_dir() or not (d / 'retail.png').exists() or not (d / 'ours.png').exists():
            continue
        if not (d / 'heights.npy').exists() or not (d / 'crop.json').exists() or not (d / 'ours-heights.json').exists():
            continue
        world = d.name.rsplit('-', 1)[0]
        out.setdefault(world, []).append(d)
    for w in out:
        out[w].sort(key=lambda p: [int(x) if x.isdigit() else x for x in p.name.replace('-', ' ').split()])
    return out


def read_repro(d):
    """Metrics for one reproduction directory: retail and ours."""
    crop = json.loads((d / 'crop.json').read_text())
    rh = np.load(d / 'heights.npy').astype(np.float64)
    rpic = np.asarray(Image.open(d / 'retail.png').convert('RGB'))
    rmetrics, rhist = picture_metrics(rpic)
    rplain = float(crop.get('plain', 0.0))
    rspacing = rpic.shape[0] / rh.shape[0]
    rmetrics.update(height_metrics(rh, rspacing, rplain))
    data = json.loads((d / 'ours-heights.json').read_text())
    g = int(data['grid'])
    opic = np.asarray(Image.open(d / 'ours.png').convert('RGB'))
    # The game keeps one byte a cell: the export clamps heights to 0-255 (engine-feed.wgsl), so score what a map can hold. Round 8 raised
    # green-4's strokes past 255 on 14% of its cells and the unclamped heights scored as a shape gain.
    oh = np.clip(np.asarray(data['heights'], np.float64).reshape(g, g), 0.0, 255.0) - float(data.get('sea', 0.0))
    target = max(2, round(opic.shape[0] / 16))
    oh = resample_heights(oh, target)
    oplain = float(data.get('base', WORLD_BASE.get(d.name.split('-', 1)[0], 24)))   # a variant's windows (green-modern-1) sit on their world's base
    ometrics, ohist = picture_metrics(opic)
    ometrics.update(height_metrics(oh, opic.shape[0] / target, oplain))
    return rmetrics, rhist, ometrics, ohist


def pct_range(values):
    v = np.asarray([x for x in values if x is not None and np.isfinite(x)], np.float64)
    if not len(v):
        return {'p10': None, 'p50': None, 'p90': None, 'n': 0}
    if len(v) == 1:
        return {'p10': float(v[0]), 'p50': float(v[0]), 'p90': float(v[0]), 'n': 1}
    # Order-statistic percentiles: with a handful of samples, linear
    # interpolation would put p10/p90 between samples and leave less than
    # 80% of the sample inside. Nearest keeps the 10th-90th band honest for
    # the check below.
    p = np.percentile(v, [10, 50, 90], method='nearest')
    return {'p10': float(p[0]), 'p50': float(p[1]), 'p90': float(p[2]), 'n': int(len(v))}


def outside(value, rng):
    if value is None or not np.isfinite(value):
        return False
    lo, hi = rng['p10'], rng['p90']
    if lo is None or hi is None:
        return False
    return bool(value < lo or value > hi)


def clean(v):
    if isinstance(v, float) and not np.isfinite(v):
        return None
    if isinstance(v, (np.floating,)):
        v = float(v)
        return float(np.round(v, 6)) if np.isfinite(v) else None
    return v


def metric_format(key):
    if key.endswith('luma_mean'):
        return '{:.1f}'
    if key.startswith('pic.lab_hist') or 'thin_dark' in key or 'edge_' in key or 'slope_' in key or 'water_share' in key or 'steep' in key:
        return '{:.3f}'
    return '{:.2f}'


def fmt(key, value):
    if value is None or (isinstance(value, float) and not np.isfinite(value)):
        return 'nan'
    return metric_format(key).format(value)


def table_rows(world, family, windows):
    keys = [k for k in family['range'] if not k.startswith('meta.')]
    keys = sorted(keys)
    lines = ['| metric | p10 | p50 | p90 | ' + ' | '.join(
        f'{w["name"]} r | {w["name"]} o' for w in windows) + ' |',
        '| --- | ---: | ---: | ---: | ' + ' | '.join('---: | ---:' for _ in windows) + ' |']
    for k in keys:
        r = family['range'][k]
        cells = [fmt(k, r['p10']), fmt(k, r['p50']), fmt(k, r['p90'])]
        for w in windows:
            for side in ('retail', 'ours'):
                v = w[side].get(k)
                mark = '!' if (w['outside'][side].get(k)) else ''
                cells.append(fmt(k, v) + mark)
        lines.append('| ' + k + ' | ' + ' | '.join(cells) + ' |')
    return lines


def main(argv=None):
    global DEFAULT_ZHON
    argv = list(sys.argv[1:] if argv is None else argv)
    if '--selftest' in argv:
        return selftest()
    ap = argparse.ArgumentParser(description='retail/editor numbers sheet (C3)')
    ap.add_argument('root')
    ap.add_argument('--out', default=None, help='where to write stats.json/stats.md (default: root)')
    ap.add_argument('--worlds', default='', help='comma-separated subset')
    ap.add_argument('--samples', type=int, default=24, help='family windows per world (>=20)')
    ap.add_argument('--seed', type=int, default=2701)
    ap.add_argument('--retail-root', default=str(DEFAULT_R))
    ap.add_argument('--zhon-sections', default=str(DEFAULT_ZHON))
    ap.add_argument('--no-check', action='store_true', help='do not exit 1 on low family containment')
    args = ap.parse_args(argv)
    DEFAULT_ZHON = Path(args.zhon_sections)
    if args.samples < 20:
        raise SystemExit('--samples must be at least 20')
    root = Path(args.root)
    out = Path(args.out) if args.out else root
    windows = find_windows(root)
    if not windows:
        raise SystemExit(f'{root}: no reproduction directories (need retail.png, heights.npy, crop.json, ours.png, ours-heights.json)')
    wanted = [w for w in WORLD_ORDER if w in windows]
    wanted += sorted(w for w in windows if w not in wanted)
    if args.worlds:
        keep = {w for w in args.worlds.split(',') if w}
        wanted = [w for w in wanted if w in keep]
        if not wanted:
            raise SystemExit('--worlds selected no reproduction directory')
    all_data = {}
    totals = {'inside': 0, 'total': 0}
    ftotals = {'inside': 0, 'total': 0}
    t0 = time.time()
    for world in wanted:
        tw = time.time()
        fam = family_window(world.split('-')[0], args.retail_root, args.samples, args.seed)   # a variant's windows (green-modern) are judged on their world's family
        if not fam:
            raise SystemExit(f'{world}: no family windows')
        if len(fam) < 20:
            raise SystemExit(f'{world}: only {len(fam)} family windows (need at least 20)')
        fam_metrics, hists = [], []
        for w in fam:
            m, h = picture_metrics(w['rgb'])
            m.update(height_metrics(w['cells'], w['spacing'], w['plain']))
            fam_metrics.append(m); hists.append(h)
        total_hist = np.sum(hists, axis=0)
        for m, h in zip(fam_metrics, hists):
            ref = total_hist - h
            ref = ref / ref.sum() if ref.sum() else ref
            m['pic.lab_hist_dist'] = chi2(h, ref)
        fam_ref = total_hist / total_hist.sum()
        range_ = {k: pct_range([m.get(k) for m in fam_metrics]) for k in fam_metrics[0]}
        # The card's check: the family band must hold at least 80% of the
        # retail windows that defined it. (Reproduction windows are curated
        # views, so they are reported separately rather than used as the
        # percentile gate.)
        f_inside = f_total = 0
        for m in fam_metrics:
            for k, r in range_.items():
                v = m.get(k)
                if v is None or not np.isfinite(v) or r['p10'] is None:
                    continue
                f_total += 1
                f_inside += not outside(v, r)
        fam_out = {'source': str(Path(args.retail_root) / f'retail-{world}') if world != 'zhon'
                   else str(DEFAULT_ZHON),
                   'count': len(fam), 'range': range_,
                   'windows': [{k: v for k, v in {'id': w['id'], 'plain': w['plain'], **m}.items()} for w, m in zip(fam, fam_metrics)]}
        win_out, inside, total = [], 0, 0
        for d in windows[world]:
            rmetrics, rhist, ometrics, ohist = read_repro(d)
            name = d.name
            rmetrics['pic.lab_hist_dist'] = chi2(rhist, fam_ref)
            ometrics['pic.lab_hist_dist'] = chi2(ohist, fam_ref)
            flags = {'retail': {}, 'ours': {}}
            for k, r in range_.items():
                flags['retail'][k] = outside(rmetrics.get(k), r)
                flags['ours'][k] = outside(ometrics.get(k), r)
                if rmetrics.get(k) is not None and np.isfinite(rmetrics.get(k, np.nan)) and r['p10'] is not None:
                    total += 1
                    inside += not flags['retail'][k]
            win_out.append({'name': name, 'retail': rmetrics, 'ours': ometrics,
                            'outside': flags})
        share = inside / total if total else 1.0
        fshare = f_inside / f_total if f_total else 1.0
        totals['inside'] += inside; totals['total'] += total
        ftotals['inside'] += f_inside; ftotals['total'] += f_total
        all_data[world] = {'family': fam_out, 'windows': win_out,
                           'containment': {'inside': inside, 'total': total, 'share': share},
                           'family_containment': {'inside': f_inside, 'total': f_total, 'share': fshare}}
        print(f'{world:12s} {len(fam):3d} family windows, {len(win_out)} reproduction windows, '
              f'family self {fshare:.1%}, reproduction retail {share:.1%} inside p10-p90 '
              f'({time.time() - tw:.1f} s)', flush=True)
    overall = totals['inside'] / totals['total'] if totals['total'] else 1.0
    foverall = ftotals['inside'] / ftotals['total'] if ftotals['total'] else 1.0
    data = {'meta': {'root': str(root), 'seed': args.seed, 'samples': args.samples,
                     'worlds': wanted, 'retail_root': str(args.retail_root),
                     'zhon_sections': str(DEFAULT_ZHON)},
            'worlds': all_data,
            'containment': {'inside': totals['inside'], 'total': totals['total'], 'share': overall},
            'family_containment': {'inside': ftotals['inside'], 'total': ftotals['total'], 'share': foverall}}
    def clean_obj(o):
        if isinstance(o, dict):
            return {k: clean_obj(v) for k, v in o.items()}
        if isinstance(o, list):
            return [clean_obj(v) for v in o]
        return clean(o)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'stats.json').write_text(json.dumps(clean_obj(data), indent=1, sort_keys=True) + '\n')
    lines = ['# Numbers sheet', '',
             f'Reproduction root: `{root}`. Family: {args.samples} seeded retail windows per world, seed {args.seed}.',
             'Each window has two columns: `r` is the retail crop, `o` is ours. '
             '`!` marks a value outside its world family p10-p90.', '']
    for world in wanted:
        wd = all_data[world]
        lines += [f'## {world}', '', f'Family: {wd["family"]["count"]} windows from `{wd["family"]["source"]}`.', '']
        lines += table_rows(world, wd['family'], wd['windows'])
        lines += ['', f'Family self-containment: {wd["family_containment"]["inside"]}/{wd["family_containment"]["total"]} '
                      f'({wd["family_containment"]["share"]:.1%}). '
                      f'Reproduction retail containment: {wd["containment"]["inside"]}/{wd["containment"]["total"]} '
                      f'({wd["containment"]["share"]:.1%}).', '']
    lines += ['## Check', '',
              f'Family self-containment: {ftotals["inside"]}/{ftotals["total"]} ({foverall:.1%}). '
              f'Pass: {"yes" if foverall >= .8 else "no"} (target 80%).', '',
              f'Reproduction retail windows inside their family range: {totals["inside"]}/{totals["total"]} '
              f'({overall:.1%}); diagnostic only (the reproduction views are curated, not a random sample).', '',
              '## Definitions', '',
              '- `height.*`: 16-px cell heights above sea; slopes are height units per world pixel over dry interior '
              'cells. `shore_band_px` is the median distance from a shoreline cell to the nearest cell at plain height '
              '(crop.json `plain` for retail, the world base for ours). `rough_8px`/`rough_32px` are the s.d. of the '
              'height left after a Gaussian of that scale.',
              '- `pic.*`: luma is 0-255; all-zero borders (Zhon section rows) are masked. `lab_hist_dist` is the '
              'chi-square distance to the world family pooled 10x8x8 CIELAB histogram. `edge_*` are shares of edge '
              'pixels within 22.5 degrees of horizontal/vertical (the rest diagonal); `thin_dark_density` is the '
              'share of pixels in a dark 1-3 px line; `band_*` are the s.d. of a difference of Gaussians at that scale.',
              '- Ranges are the 10th/50th/90th order statistics of the seeded family; `nan` means the metric is '
              'undefined for that window (no water, no dry cells, or no edges).', '']
    (out / 'stats.md').write_text('\n'.join(lines))
    print(f'wrote {out / "stats.json"} and {out / "stats.md"} ({time.time() - t0:.1f} s)')
    low = [w for w in wanted if all_data[w]['family_containment']['share'] < .8]
    if (foverall < .8 or low) and not args.no_check:
        bad = ', '.join(low) if low else 'all worlds'
        print(f'FAIL: family ranges contain only {foverall:.1%} of their own retail windows ({bad})',
              file=sys.stderr)
        return 1
    return 0


def selftest():
    """Synthetic checks for the metric definitions (card C3)."""
    ok = True

    def check(name, cond, detail=''):
        nonlocal ok
        ok = ok and bool(cond)
        print(f'selftest: {"PASS" if cond else "FAIL"} {name}{" (" + detail + ")" if detail else ""}')

    # Horizontal stripes: 4-px bands, luma 60 and 180.
    y = np.arange(128)[:, None]
    stripes = np.where((y // 4) % 2, 180, 60).repeat(128, axis=1).astype(np.uint8)
    rgb = np.dstack([stripes] * 3)
    m, _ = picture_metrics(rgb, np.ones((128, 128), bool))
    check('horizontal stripes read horizontal', m['pic.edge_horizontal'] > .8,
          f'horizontal {m["pic.edge_horizontal"]:.2f}')
    check('horizontal stripes have edges', m['pic.edge_density'] > .01,
          f'density {m["pic.edge_density"]:.3f}')

    # A 1-px dark grid on light ground.
    g = np.full((128, 128), 210, np.uint8)
    g[::8, :] = 30; g[:, ::8] = 30
    rgb = np.dstack([g] * 3)
    m, _ = picture_metrics(rgb, np.ones((128, 128), bool))
    check('1-px dark grid reads as thin lines', m['pic.thin_dark_density'] > .1,
          f'thin {m["pic.thin_dark_density"]:.3f}')

    # A flat image has no edges and no thin lines.
    flat = np.full((128, 128, 3), 128, np.uint8)
    m, _ = picture_metrics(flat, np.ones((128, 128), bool))
    check('flat image has no edges', m['pic.edge_density'] == 0, f'density {m["pic.edge_density"]:.3f}')
    check('flat image has no thin lines', m['pic.thin_dark_density'] == 0,
          f'thin {m["pic.thin_dark_density"]:.3f}')

    # Heights: a flat dry plane, and a ramp from water to a plain.
    h = np.full((64, 64), 10.0)
    hm = height_metrics(h, 16.0, 10)
    check('flat dry plane has no water', hm['height.water_share'] == 0)
    check('flat dry plane has no steep ground', hm['height.steep_gt_0.5'] == 0,
          f'steep {hm["height.steep_gt_0.5"]:.3f}')
    ramp = np.tile(np.linspace(-100, 400, 32), (64, 1))
    hm = height_metrics(ramp, 16.0, 12)
    check('ramp has water', hm['height.water_share'] > .2, f'water {hm["height.water_share"]:.2f}')
    check('ramp has steep ground', hm['height.steep_gt_0.5'] > 0,
          f'steep {hm["height.steep_gt_0.5"]:.3f}')
    check('ramp has a shore band', np.isfinite(hm['height.shore_band_px']),
          f'{hm["height.shore_band_px"]:.1f} px')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
