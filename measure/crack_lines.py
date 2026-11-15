"""Thin dark lines and slope texture by slope bin: retail art vs editor renders.

Slope per screen pixel comes from heights averaged to 16-px cells (retail
stores one height per cell), projected as TA draws them: a cell's art sits
h/2 rows above its world row, and a southern cell covers the art north of it.
Our renders use the same cells (the 512 grid averaged 8x8) and the
renderer's own shift, (h - base)/2.

Line metric (per slope bin, slope in height units per world px):
  share    thin dark-line pixels / slope pixels
  width    line pixels per thinned (skeleton) pixel
  dens     skeleton (line length) px per 1000 slope px
  drop     mean oriented line response on the skeleton: luma of the line's
           sides minus its centre, along a 9-px segment (0-255)
  ldens, ldrop, lstrong   the same for long coherent lines only (17-px
           segments, runs >= 12 px): crack majors rather than texture
  ink      summed line response per slope px (dens x drop / 1000)
  strong   skeleton px with response >= 2 x THRESH per 1000 slope px
  run      skeleton-length-weighted mean length of a line's connected run
  lit%     share of px within 2 px of a line that are a bright thin rim
A pixel is a line candidate when the oriented line response reaches THRESH
and exceeds the local median response (32-px blocks) by REL; a connected
run is kept when its thinned length is >= 6 px. Its core (width) is the
run's pixels at least THRESH/2 below their 5-px closing.

Texture metric (Moon slopes):
  hf       std of luma minus a 1.5-px Gaussian (pixel-scale energy)
  lstd     mean std of luma in 8x8 windows
  specks   dark blobs (median-7 minus luma >= SPECK) by size class, per
           1000 px: 1-3, 4-12, 13-40, >40 px; and their mean elongation
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage, signal

BINS = [(.15, .4), (.4, .8), (.8, 99.)]
BIN_NAMES = ['0.15-0.4', '0.4-0.8', '>0.8']
THRESH = 16.0
REL = 10.0
SPECK = 14.0
DISK5 = np.array([[0, 1, 1, 1, 0], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [1, 1, 1, 1, 1], [0, 1, 1, 1, 0]], bool)
LUMA = np.array([.299, .587, .114], np.float32)


def luma(rgb):
    return rgb[..., :3].astype(np.float32) @ LUMA


# --- thinning (Zhang-Suen), vectorised ---------------------------------------

def thin(mask):
    img = np.pad(mask.astype(np.uint8), 1)
    while True:
        changed = False
        for step in (0, 1):
            p = img
            n = [p[:-2, 1:-1], p[:-2, 2:], p[1:-1, 2:], p[2:, 2:], p[2:, 1:-1], p[2:, :-2], p[1:-1, :-2], p[:-2, :-2]]
            c = p[1:-1, 1:-1]
            b = sum(x.astype(np.int32) for x in n)
            seq = n + [n[0]]
            a = sum(((seq[k] == 0) & (seq[k + 1] == 1)).astype(np.int32) for k in range(8))
            if step == 0:
                cond = (n[0] * n[2] * n[4] == 0) & (n[2] * n[4] * n[6] == 0)
            else:
                cond = (n[0] * n[2] * n[6] == 0) & (n[0] * n[4] * n[6] == 0)
            kill = (c == 1) & (b >= 2) & (b <= 6) & (a == 1) & cond
            if kill.any():
                changed = True
                img[1:-1, 1:-1][kill] = 0
        if not changed:
            return img[1:-1, 1:-1].astype(bool)


# --- detection -----------------------------------------------------------------

def _kernels(n=12, half=4.0, off=3.0, size=13):
    """Oriented matched filters: mean of two parallel side lines (+-off px)
    minus the mean of the centre line, each 2*half+1 px long, at n angles."""
    out, c = [], size // 2
    for k in range(n):
        th = np.pi * k / n
        u = np.array([np.cos(th), np.sin(th)]); v = np.array([-u[1], u[0]])
        kc, ks = np.zeros((size, size)), np.zeros((size, size))
        for t in np.arange(-half, half + 1e-6, .5):
            for o, kk in ((0, kc), (off, ks), (-off, ks)):
                x, y = c + t * u[0] + o * v[0], c + t * u[1] + o * v[1]
                x0, y0 = int(np.floor(x)), int(np.floor(y)); fx, fy = x - x0, y - y0
                for dx, dy, w in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
                    kk[y0 + dy, x0 + dx] += w
        out.append((ks / ks.sum() - kc / kc.sum())[::-1, ::-1])
    return out


KERNELS = _kernels()
# Long coherent lines (crack majors, fissures): 17-px segments at 16 angles.
LONG_KERNELS = _kernels(n=16, half=8.0, off=3.0, size=21)


def line_response(L, kernels=None):
    """Luma drop of the best-aligned 9-px (or the kernels') line against its sides, per pixel."""
    return np.max([signal.fftconvolve(L, k, mode='same') for k in (kernels or KERNELS)], axis=0)


def background(resp, block=32):
    """Local median of the line response (the surface's own texture level),
    on block x block tiles, bilinearly resampled to every pixel."""
    H, W = resp.shape
    hb, wb = -(-H // block), -(-W // block)
    pad = np.pad(resp, ((0, hb * block - H), (0, wb * block - W)), mode='reflect')
    med = np.median(pad.reshape(hb, block, wb, block).transpose(0, 2, 1, 3).reshape(hb, wb, -1), axis=2)
    full = ndimage.zoom(med, block, order=1, mode='nearest', grid_mode=True)
    return full[:H, :W]


def lines(L, thresh=THRESH, min_len=6, rel=REL, kernels=None):
    """Thin dark lines. Returns (core mask, skeleton mask, run length per
    skeleton px, line response). A line is a connected run where the
    oriented response reaches thresh, thinned to >= min_len px; its core is
    the pixels in the run at least half the threshold darker than their
    5-px closing (what the eye reads as the line's width)."""
    resp = line_response(L, kernels)
    # A line must stand out from its own surface: rough rock whose every
    # trough answers the filter carries few lines, a crack on smooth grass
    # stands out.
    cand = (resp >= thresh) & (resp - background(resp) >= rel)
    lab, n = ndimage.label(cand, structure=np.ones((3, 3)))
    if n == 0:
        z = np.zeros_like(cand)
        return z, z, np.zeros(L.shape, np.float32), resp
    skel = thin(cand)
    length = np.bincount(lab[skel], minlength=n + 1).astype(np.float32)
    keep = length >= min_len
    keep[0] = False
    run_mask = keep[lab]
    bth = ndimage.grey_closing(L, footprint=DISK5) - L
    core = run_mask & (bth >= .5 * thresh)
    skel = skel & run_mask
    run = np.where(skel, length[lab], 0).astype(np.float32)
    return core, skel, run, resp


def specks(L, valid, thresh=SPECK):
    drop = ndimage.median_filter(L, 7) - L
    lab, n = ndimage.label((drop >= thresh) & valid, structure=np.ones((3, 3)))
    if n == 0:
        return np.zeros(0), np.zeros(0)
    area = np.bincount(lab.ravel(), minlength=n + 1)[1:].astype(np.float32)
    sl = ndimage.find_objects(lab)
    ext = np.array([max(s[0].stop - s[0].start, s[1].stop - s[1].start) for s in sl], np.float32)
    # Elongation: bounding extent squared over area (1 for a dot, large for a squiggle).
    return area, ext * ext / area


SUMS = ('n', 'line', 'skel', 'drop', 'run', 'hf', 'lstd', 'nw', 'spel', 'spn', 'lit', 'strong', 'lskel', 'ldrop', 'lstrong')
MIN_PX = 3000  # an image counts toward a bin's per-image median with at least this many px


def finish(a):
    n = max(a['n'], 1)
    return dict(
        px=int(a['n']),
        share=100. * a['line'] / n,
        dens=1000. * a['skel'] / n,
        width=a['line'] / max(a['skel'], 1),
        drop=a['drop'] / max(a['skel'], 1),
        ink=a['drop'] / n,
        strong=1000. * a['strong'] / n,
        ldens=1000. * a['lskel'] / n,
        ldrop=a['ldrop'] / max(a['lskel'], 1),
        lstrong=1000. * a['lstrong'] / n,
        run=a['run'] / max(a['skel'], 1),
        lit=100. * a['lit'] / n,
        hf=float(np.sqrt(a['hf'] / n)),
        lstd=a['lstd'] / max(a['nw'], 1),
        specks=(1000. * a['sp'] / n).round(2).tolist(),
        speckElong=a['spel'] / max(a['spn'], 1))


class Acc:
    """Per-bin sums over many images, kept per image as well, so a table
    can be pooled or a per-image median (rough and smooth images weigh the
    same)."""
    def __init__(self):
        self.per = []

    @property
    def images(self):
        return len(self.per)

    def add(self, rgb, slope, valid, margin=4, name=''):
        L = luma(rgb)
        line, skel, run, resp = lines(L)
        _, lskel, _, lresp = lines(L, min_len=12, kernels=LONG_KERNELS)
        hf = L - ndimage.gaussian_filter(L, 1.5)
        # Lit wall: a bright thin rim within 2 px of a detected dark line.
        wth = L - ndimage.grey_opening(L, footprint=DISK5)
        near = ndimage.binary_dilation(line, iterations=2) & ~line
        lit = near & (wth >= THRESH)
        inner = np.zeros_like(valid)
        inner[margin:-margin, margin:-margin] = True
        valid = valid & inner
        H, W = L.shape
        hb, wb = H // 8, W // 8
        Lb = L[:hb * 8, :wb * 8].reshape(hb, 8, wb, 8).transpose(0, 2, 1, 3).reshape(hb, wb, 64)
        image = {'name': name}
        for (lo, hi), bn in zip(BINS, BIN_NAMES):
            m = valid & (slope >= lo) & (slope < hi)
            a = {k: 0. for k in SUMS}
            a['sp'] = np.zeros(4)
            a['n'] = int(m.sum())
            if a['n']:
                sk = skel & m
                a['line'] = int((line & m).sum())
                a['skel'] = int(sk.sum())
                a['drop'] = float(resp[sk].sum())
                a['strong'] = int((sk & (resp >= 2 * THRESH)).sum())
                lk = lskel & m
                a['lskel'] = int(lk.sum())
                a['ldrop'] = float(lresp[lk].sum())
                a['lstrong'] = int((lk & (lresp >= 2 * THRESH)).sum())
                a['run'] = float(run[sk].sum())
                a['hf'] = float((hf[m] ** 2).sum())
                a['lit'] = int((lit & m).sum())
                # Window std on 8x8 blocks wholly in the bin.
                mb = m[:hb * 8, :wb * 8].reshape(hb, 8, wb, 8).all(axis=(1, 3))
                if mb.any():
                    a['lstd'] = float(Lb[mb].std(axis=1).sum())
                    a['nw'] = int(mb.sum())
                area, el = specks(L, m)
                if len(area):
                    a['sp'] = np.histogram(area, [0, 3.5, 12.5, 40.5, 1e9])[0].astype(float)
                    big = area >= 4
                    a['spel'] = float(el[big].sum())
                    a['spn'] = int(big.sum())
            image[bn] = a
        self.per.append(image)

    def table(self, median=False):
        out = {}
        for bn in BIN_NAMES:
            if median:
                rows = [finish(im[bn]) for im in self.per if im[bn]['n'] >= MIN_PX]
                if not rows:
                    out[bn] = finish({**{k: 0. for k in SUMS}, 'sp': np.zeros(4)})
                    continue
                t = {k: float(np.median([r[k] for r in rows])) for k in rows[0] if k != 'specks'}
                t['specks'] = np.median([r['specks'] for r in rows], axis=0).round(2).tolist()
                t['px'] = int(sum(r['px'] for r in rows))
                t['images'] = len(rows)
                out[bn] = t
            else:
                tot = {k: sum(im[bn][k] for im in self.per) for k in SUMS}
                tot['sp'] = sum(im[bn]['sp'] for im in self.per)
                out[bn] = finish(tot)
        return out


# --- projection ----------------------------------------------------------------

def project(cells, values, shape, shift):
    """One value per 16-px cell painted at the screen rows its height is drawn
    on (rows cy*16 - shift); southern cells last. Uncovered rows take the
    nearest value above, then below."""
    H, W = shape
    out = np.full((H, W), np.nan, np.float32)
    cw = min(cells.shape[1], W // 16)
    view = out[:, :cw * 16].reshape(H, cw, 16)
    cols = np.arange(cw)
    for cy in range(cells.shape[0]):
        y0 = cy * 16 - shift[cy, :cw]
        for k in range(16):
            rows = y0 + k
            ok = (rows >= 0) & (rows < H)
            view[rows[ok], cols[ok], :] = values[cy, :cw][ok][:, None]
    for y in range(1, H):
        gap = np.isnan(out[y]); out[y][gap] = out[y - 1][gap]
    for y in range(H - 2, -1, -1):
        gap = np.isnan(out[y]); out[y][gap] = out[y + 1][gap]
    return out


def cell_slope(cells):
    gy, gx = np.gradient(cells.astype(np.float32))
    return np.hypot(gx, gy) / 16.0


def water_colour(rgb):
    r, g, b = (rgb[..., k].astype(np.int32) for k in range(3))
    return (b > g + 8) & (b > r + 8)


# --- sources -------------------------------------------------------------------

def ours(png, heights_json):
    """(rgb, slope, valid) for one editor render."""
    rgb = np.asarray(Image.open(png).convert('RGB'))
    d = json.load(open(heights_json))
    grid, base, sea = d['grid'], d['base'], d['sea']
    h = np.array(d['heights'], np.float32).reshape(grid, grid)
    k = grid // 64
    cells = h.reshape(64, k, 64, k).mean(axis=(1, 3))
    vis = np.maximum(cells, sea)
    shift = np.round((vis - base) / 2).astype(np.int32)
    slope = project(cells, cell_slope(cells), rgb.shape[:2], shift)
    low = project(cells, ndimage.minimum_filter(cells, 3), rgb.shape[:2], shift)
    valid = (low > sea + 1) & ~water_colour(rgb)
    return rgb, slope, valid


def retail_section(rgb, cells, sea=None):
    shift = (cells.astype(np.int32) // 2)
    slope = project(cells, cell_slope(cells), rgb.shape[:2], shift)
    valid = ~water_colour(rgb)
    if sea is not None:
        low = project(cells, ndimage.minimum_filter(cells, 3), rgb.shape[:2], shift)
        valid &= low > sea + 1
    return slope, valid


def decoded_sections(root, kinds, palette_path=None):
    """Decoded sections (indexed.bin, heights.bin, metadata.json, native*.png)."""
    root = Path(root)
    for kind in kinds:
        for d in sorted((root / kind).iterdir()):
            meta = json.loads((d / 'metadata.json').read_text())
            art = d / 'native.png' if (d / 'native.png').exists() else d / 'native-art.png'
            H, W = meta['height'], meta['width']
            if art.exists():
                rgb = np.asarray(Image.open(art).convert('RGB'))
            else:
                pal = np.fromfile(PALETTE, np.uint8).reshape(256, 4)[:, :3]
                rgb = pal[np.fromfile(d / 'indexed.bin', np.uint8).reshape(H, W)]
            cells = np.fromfile(d / 'heights.bin', np.uint8).reshape(H // 16, W // 16).astype(np.float32)
            yield f'{kind}/{d.name}', rgb, cells


def catalog_sections(root, kinds):
    """Section catalogs as <name>.art.png + <name>.heights.png."""
    root = Path(root)
    for kind in kinds:
        for art in sorted((root / kind).glob('*.art.png')):
            rgb = np.asarray(Image.open(art).convert('RGB'))
            cells = np.asarray(Image.open(str(art).replace('.art.png', '.heights.png'))).astype(np.float32)
            yield f'{kind}/{art.name[:-8]}', rgb, cells


def corpus_tiles(map_dir, tile=512, per_map=10, min_slope_share=.25, seed=1):
    """Whole retail maps: the tiles with the most slope ground, at most per_map."""
    map_dir = Path(map_dir)
    meta = json.loads((map_dir / 'metadata.json').read_text())
    W, H, cw, ch = meta['width'], meta['height'], meta['cell_width'], meta['cell_height']
    pal = np.fromfile(map_dir / 'palette-rgb.bin', np.uint8).reshape(256, 3)
    idx = np.memmap(map_dir / 'map-indexed.bin', np.uint8, 'r', shape=(H, W))
    cells = np.fromfile(map_dir / 'heights.bin', np.uint8).reshape(ch, cw).astype(np.float32)
    sea = meta['sea_level']
    sl = cell_slope(cells)
    # Score tiles on the cell grid (world rows; the h/2 shift is small at this size).
    tc = tile // 16
    cands = []
    for ty in range(1, ch // tc - 1):
        for tx in range(0, cw // tc):
            blk = sl[ty * tc:(ty + 1) * tc, tx * tc:(tx + 1) * tc]
            land = cells[ty * tc:(ty + 1) * tc, tx * tc:(tx + 1) * tc] > sea + 1
            share = ((blk >= .15) & land).mean()
            if share >= min_slope_share:
                cands.append((share, ty, tx))
    rng = np.random.default_rng(seed)
    cands.sort(reverse=True)
    pick = cands[:per_map * 3]
    if len(pick) > per_map:
        pick = [pick[i] for i in sorted(rng.choice(len(pick), per_map, replace=False))]
    for share, ty, tx in pick:
        # Cell window with a margin so projection fills the tile.
        cy0, cy1 = max(0, ty * tc - 12), min(ch, (ty + 1) * tc + 12)
        cx0, cx1 = tx * tc, (tx + 1) * tc
        sub = cells[cy0:cy1, cx0:cx1]
        y0 = cy0 * 16
        rows = (cy1 - cy0) * 16
        rgb = pal[np.asarray(idx[y0:y0 + rows, cx0 * 16:cx1 * 16])]
        slope, valid = retail_section(rgb, sub, sea)
        top = (ty * tc - cy0) * 16
        yield f'{map_dir.name}@{tx * tile},{ty * tile}', rgb[top:top + tile], slope[top:top + tile], valid[top:top + tile]


def fmt(table, label):
    rows = [f'{label}']
    rows.append('  bin          px      share%  dens   width  drop   ink    strong  ldens  ldrop  lstrng run    lit%   hf     lstd   specks/1000px (1-3,4-12,13-40,>40)  elong')
    for name in BIN_NAMES:
        t = table[name]
        rows.append(f'  {name:9s} {t["px"]:8d}  {t["share"]:6.2f}  {t["dens"]:5.1f}  {t["width"]:5.2f}  {t["drop"]:5.1f}  '
                    f'{t["ink"]:5.2f}  {t["strong"]:6.2f}  {t["ldens"]:5.1f}  {t["ldrop"]:5.1f}  {t["lstrong"]:6.2f} {t["run"]:5.1f}  {t["lit"]:5.2f}  {t["hf"]:5.2f}  {t["lstd"]:5.2f}   '
                    f'{t["specks"]}  {t["speckElong"]:5.2f}')
    return '\n'.join(rows)


PALETTE = Path('/tmp/nanolathe-neural-terrain/editor-green-sections/palette.pal')
CORPUS = Path('/tmp/nanolathe-neural-terrain/corpus')
CATALOGS = Path('/tmp/nanolathe-map-editor/catalogs')
RETAIL = {
    # world: (loader, root, kinds, sea level for the height mask)
    'green': ('corpus', CORPUS, None, None),
    'greensections': ('decoded', Path('/tmp/nanolathe-neural-terrain/editor-green-decoded/greenworld'), ['hills', 'island'], None),
    'red': ('decoded', Path('/tmp/red-planet-inspection/decoded'), ['big', 'hills', 'islands', 'misc'], None),
    'archipelago': ('decoded', Path('/tmp/archipelago-inspection/decoded'), ['caldera', 'hills', 'islands', 'sections'], None),
    'moon': ('catalog', CATALOGS / 'sections/worlds/sections/moon', ['dark', 'misc'], None),
    'lava': ('catalog', CATALOGS / 'sections/worlds/sections/lava', ['coast', 'isle', 'misc', 'mtn'], 24),
    'zhon': ('catalog', CATALOGS / 'sections-zhon/TASect_Zhon/sections/zhon', None, 59),
    'desert': ('map', Path('/tmp/nanolathe-map-editor/retail-desert/painted_desert-e2c3dad3'), None, None),
}


def retail_images(world, per_map=8):
    """(name, rgb, slope, valid) for a world's retail reference."""
    loader, root, kinds, sea = RETAIL[world]
    if loader == 'corpus':
        for d in sorted(p for p in root.iterdir() if p.is_dir()):
            yield from corpus_tiles(d, per_map=per_map)
    elif loader == 'map':
        yield from corpus_tiles(root, per_map=per_map * 4)
    else:
        if kinds is None:
            kinds = sorted(p.name for p in root.iterdir() if p.is_dir())
        source = decoded_sections(root, kinds) if loader == 'decoded' else catalog_sections(root, kinds)
        for name, rgb, cells in source:
            slope, valid = retail_section(rgb, cells, sea)
            yield name, rgb, slope, valid


if __name__ == '__main__':
    # retail WORLD [OUT.json]        a world's retail reference
    # ours LABEL OUT.json stem...    editor renders (stem.png + stem.heights.json)
    acc = Acc()
    if sys.argv[1] == 'retail':
        for name, rgb, slope, valid in retail_images(sys.argv[2]):
            acc.add(rgb, slope, valid, name=name)
        label, out = 'retail ' + sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None
    else:
        for stem in sys.argv[4:]:
            rgb, slope, valid = ours(stem + '.png', stem + '.heights.json')
            acc.add(rgb, slope, valid, name=stem)
        label, out = sys.argv[2], sys.argv[3]
    table, med = acc.table(), acc.table(median=True)
    print(fmt(table, f'{label} pooled ({acc.images} images)'))
    print(fmt(med, f'{label} per-image median'))
    if out:
        Path(out).write_text(json.dumps({'label': label, 'images': acc.images, 'pooled': table, 'median': med,
                                         'per': [{'name': im['name'], **{bn: finish(im[bn]) for bn in BIN_NAMES}}
                                                 for im in acc.per]}, indent=1))
