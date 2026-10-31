"""Crystal formation geometry from Crystal-world section art and retail maps.

Crystal formations are mounds tiled with flat-topped polygonal columns
outlined in a dark line. Under TA's projection (world (x, y, h) is drawn at
screen y - h/2) a horizontal top keeps its true outline and is only shifted
up, and a vertical side face of height H appears below its top edge as a
band H/2 rows tall. So:

- tops are segmented as the lighter cells between outline pixels (a black
  top-hat on lightly smoothed luminance, plus near-black pixels) inside the
  raised part of a scene (projected height above the scene's base level);
- polygon sides come from each top's convex hull simplified by
  Douglas-Peucker;
- face height and orientation come from a column scan below every top: the
  run of dark pixels under its bottom edge (rows x 2 = height units) and the
  local slope of that edge (its outward normal, 0 = east, 90 = south);
- flat or pointed tops are told apart by the brightness difference between a
  top's lit and shaded halves, against the same statistic on level ground.

Every threshold below is an authored measurement choice, recorded in the
output. Output: one JSON table (see --out).
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull, cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from section_common import PALETTE, palette_codes, project_cells  # noqa: E402

LUMA = np.array([.299, .587, .114], np.float32)
CATALOGS = Path('/private/tmp/nanolathe-map-editor/catalogs')
FAMILIES = {
    'violet (Crystal)': CATALOGS / 'sections-crystal/TASect_Crystal/sections/crystal',
    'charcoal (U_Adamante_Crystal_V12)': CATALOGS / 'sections-uadamante-crystal/TASect_U_Adamante_Crystal_V12/sections/u_adamante_crystal_v12',
    'olive-brown (U_Lava_Crystal_V11)': CATALOGS / 'sections-ulava-crystal/TASect_U_Lava_Crystal_V11/sections/u_lava_crystal_v11',
}
RETAIL = Path('/private/tmp/nanolathe-map-editor/retail-crystal')
SETTINGS = {
    'smooth_sigma_px': 1.0, 'tophat_px': 7, 'tophat_dark': 16, 'near_black_luma': 14,
    'raised_above_base': 3, 'peak_radius_px': 4, 'min_peak_px': 2.5, 'min_line_px': 40, 'min_top_px': 60, 'max_top_px': 6000, 'min_solidity': .88,
    'dp_epsilon': 'max(1.5 px, 5% of equivalent diameter)', 'straight_vertex_deg': 160,
    'face_darker_by_luma': 10, 'ink_luma': 12, 'face_vertical_share': .2, 'max_face_rows': 40, 'edge_fit_half_width_px': 3,
}


# --- scenes ------------------------------------------------------------------

class Scene:
    """One art image with its 16-px height cells and the level it rises from."""

    def __init__(self, name, rgb, cells, base, idx=None):
        self.name, self.rgb, self.cells, self.base = name, rgb.astype(np.float32), cells.astype(np.int32), base
        self.idx = idx
        self.lum = ndi.gaussian_filter(self.rgb @ LUMA, SETTINGS['smooth_sigma_px'])
        self.raw_lum = self.rgb @ LUMA
        smooth = ndi.gaussian_filter(self.rgb, (1.5, 1.5, 0))
        r, g, b = smooth[..., 0], smooth[..., 1], smooth[..., 2]
        # Water and the drowned shelf are blue with green near red; crystal
        # violets keep green well below red, greys have no blue lean.
        self.water = ndi.binary_opening((g >= r - 6) & (b - r > 18), iterations=1)
        self.height = project_cells(self.cells, self.cells, self.rgb.shape[:2])


def section_scenes(root, kinds, code):
    for kind in kinds:
        for art in sorted((root / kind).glob('*.art.png')):
            rgb = np.asarray(Image.open(art).convert('RGB'))
            cells = np.asarray(Image.open(str(art).replace('.art.png', '.heights.png')))
            a = rgb.astype(np.int32)
            idx = code[(a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]]
            # Base: the commonest edge height (85 on land kinds, 0 round islands).
            edge = np.concatenate([cells[0], cells[-1], cells[:, 0], cells[:, -1]])
            yield Scene(f'{kind}/{art.name.removesuffix(".art.png")}', rgb, cells, int(np.bincount(edge).argmax()), idx)


def retail_scenes(limit_per_map=6, window=768):
    """Windows of retail Crystal maps centred on raised land formations."""
    for d in sorted(p for p in RETAIL.iterdir() if p.is_dir()):
        m = json.loads((d / 'metadata.json').read_text())
        W, H = m['width'], m['height']
        idx = np.memmap(d / 'map-indexed.bin', np.uint8, 'r', shape=(H, W))
        pal = np.fromfile(d / 'palette-rgb.bin', np.uint8).reshape(256, 3)
        cells = np.fromfile(d / 'heights.bin', np.uint8).reshape(m['cell_height'], m['cell_width']).astype(np.int32)
        level = int(np.bincount(cells[cells >= m['sea_level']].ravel()).argmax())
        raised = ndi.binary_opening(cells > level + 15, iterations=1)
        lab, n = ndi.label(raised)
        sizes = ndi.sum(raised, lab, np.arange(1, n + 1))
        taken = 0
        for k in np.argsort(-sizes):
            if sizes[k] < 12 or taken == limit_per_map:
                break
            cy, cx = ndi.center_of_mass(lab == k + 1)
            c = window // 16
            x0 = int(np.clip(cx - c / 2, 0, cells.shape[1] - c)) * 16
            y0 = int(np.clip(cy - c / 2, 0, cells.shape[0] - c)) * 16
            sub = cells[y0 // 16:y0 // 16 + c, x0 // 16:x0 // 16 + c]
            # The art of a cell is drawn h/2 rows north; read the art window
            # from the same rows, clipped to the map.
            rgb = pal[np.asarray(idx[y0:y0 + window, x0:x0 + window])]
            if rgb.shape[:2] != (window, window):
                continue
            taken += 1
            yield Scene(f'retail {m["name"]} @({x0},{y0})', rgb, sub, level, np.asarray(idx[y0:y0 + window, x0:x0 + window]))


# --- polygon helpers -----------------------------------------------------------

def douglas_peucker(points, eps):
    a, b = points[0], points[-1]
    if len(points) < 3:
        return [a, b]
    ab = b - a
    norm = np.hypot(*ab) or 1.
    d = np.abs(ab[0] * (points[:, 1] - a[1]) - ab[1] * (points[:, 0] - a[0])) / norm
    i = int(np.argmax(d))
    if d[i] > eps:
        return douglas_peucker(points[:i + 1], eps)[:-1] + douglas_peucker(points[i:], eps)
    return [a, b]


def simplify_closed(hull, eps, straight_deg):
    """Vertex count of a convex polygon after Douglas-Peucker and removal of
    nearly straight vertices."""
    c = hull.mean(axis=0)
    i0 = int(np.argmax(np.hypot(*(hull - c).T)))
    hull = np.roll(hull, -i0, axis=0)
    i1 = int(np.argmax(np.hypot(*(hull - hull[0]).T)))
    chain = np.vstack([hull, hull[:1]])
    pts = douglas_peucker(chain[:i1 + 1], eps)[:-1] + douglas_peucker(chain[i1:], eps)[:-1]
    pts = np.array(pts)
    changed = True
    while changed and len(pts) > 3:
        changed = False
        for i in range(len(pts)):
            p, q, r = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
            u, v = p - q, r - q
            ang = np.degrees(np.arccos(np.clip(u @ v / (np.hypot(*u) * np.hypot(*v) + 1e-9), -1, 1)))
            if ang > straight_deg:
                pts = np.delete(pts, i, axis=0)
                changed = True
                break
    return pts


def calipers(hull):
    """Minimum and maximum width of a convex polygon."""
    widths = []
    for i in range(len(hull)):
        p, q = hull[i], hull[(i + 1) % len(hull)]
        e = q - p
        n = np.hypot(*e)
        if n < 1e-9:
            continue
        widths.append(np.abs(e[0] * (hull[:, 1] - p[1]) - e[1] * (hull[:, 0] - p[0])).max() / n)
    diam = max(np.hypot(*(a - b)) for a in hull for b in hull)
    return float(min(widths)), float(diam)


# --- segmentation ----------------------------------------------------------------

CORNERS = np.array([[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]])
DISK1 = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)


def segment(scene):
    raised = scene.height > scene.base + SETTINGS['raised_above_base']
    formation = ndi.binary_closing(raised, iterations=3) & ~ndi.binary_dilation(scene.water, iterations=2)
    tophat = ndi.grey_closing(scene.lum, size=(SETTINGS['tophat_px'],) * 2) - scene.lum
    line = ((tophat > SETTINGS['tophat_dark']) | (scene.lum < SETTINGS['near_black_luma'])) & formation
    # Specks of a top's own texture are dark too; outlines form a network,
    # so small isolated marks are not outline.
    llab, ln = ndi.label(line)
    size = ndi.sum(line, llab, np.arange(1, ln + 1))
    line &= np.r_[False, size >= SETTINGS['min_line_px']][llab]
    # Outlines often stop short of their neighbours, so cells meet through
    # gaps. Each cell's centre is a peak of the distance to the nearest
    # outline; a watershed on that distance splits joined cells at the gap.
    free = ~line & formation
    dt = ndi.gaussian_filter(ndi.distance_transform_edt(free), 1.0)
    size = 2 * SETTINGS['peak_radius_px'] + 1
    peaks = (dt == ndi.maximum_filter(dt, size=size)) & (dt >= SETTINGS['min_peak_px']) & free
    lab, n = ndi.label(ndi.binary_dilation(peaks, iterations=1) & free)
    # Flood from the peaks downhill in distance, half a pixel at a time, so
    # two cells meet where their distances fall to the neck between them.
    for level in np.arange(float(dt.max()), -.25, -.5):
        allowed = free & (dt >= level) & (lab == 0)
        for _ in range(4):
            grown = ndi.grey_dilation(lab, size=(3, 3))
            new = allowed & (grown > 0) & (lab == 0)
            if not new.any():
                break
            lab[new] = grown[new]
    return formation, line, lab, n


def rim_profile(scene, m, sl, xs, ys, cx, cy):
    """Luma sums inside a top by distance from its rim (1, 2, 3, 4-5, 6+
    px) and by which side of the top the nearest rim lies (N, E, S, W)."""
    d = ndi.distance_transform_edt(np.pad(m, 1))[1:-1, 1:-1][m]
    dx, dy = xs - cx, ys - cy
    # Side of the rim nearest each pixel, by the pixel's direction from the
    # centre (adequate for convex tops).
    side = np.where(np.abs(dx) > np.abs(dy), np.where(dx > 0, 'E', 'W'), np.where(dy > 0, 'S', 'N'))
    band = np.digitize(d, [1.5, 2.5, 3.5, 5.5])  # 0: 1 px, 1: 2, 2: 3, 3: 4-5, 4: 6+
    lum = scene.raw_lum[ys, xs]
    out = {}
    for s in 'NESW':
        for b in range(5):
            sel = (side == s) & (band == b)
            if sel.any():
                out[(s, b)] = (float(lum[sel].sum()), int(sel.sum()))
    return out


def cell_table(scene, formation, line, lab, n):
    """Per-cell shape and colour; tops are convex cells of a usable size."""
    cells = {}
    objs = ndi.find_objects(lab)
    for k, sl in enumerate(objs, start=1):
        if sl is None:
            continue
        # Specks of the top's own texture can read as line pixels, and the
        # dithered art leaves ragged rims: a top is its outline filled and
        # opened by a 1-px disk (its largest piece).
        m = ndi.binary_opening(ndi.binary_fill_holes(lab[sl] == k), structure=DISK1)
        pieces, count = ndi.label(m)
        if count == 0:
            continue
        m = pieces == 1 + int(np.argmax(ndi.sum(m, pieces, range(1, count + 1))))
        area = int(m.sum())
        if area < SETTINGS['min_top_px'] or area > SETTINGS['max_top_px']:
            continue
        ys, xs = np.nonzero(m)
        ys = ys + sl[0].start
        xs = xs + sl[1].start
        centres = np.c_[xs, ys].astype(float)
        pts = (centres[:, None, :] + CORNERS[None]).reshape(-1, 2)
        try:
            hull = pts[ConvexHull(pts).vertices]
            inner = ConvexHull(centres)
        except Exception:
            continue
        # Pick's relation for a digital convex set: pixels = centre-hull
        # area + half its perimeter + 1, so a convex cell scores ~1.
        solidity = area / (inner.volume + inner.area / 2 + 1)
        if solidity < SETTINGS['min_solidity']:
            continue
        eqd = float(np.sqrt(4 * area / np.pi))
        eps = max(1.5, .05 * eqd)
        poly = simplify_closed(hull, eps, SETTINGS['straight_vertex_deg'])
        wmin, wmax = calipers(hull)
        lum = scene.raw_lum[ys, xs]
        rgb = scene.rgb[ys, xs]
        cx, cy = float(xs.mean()), float(ys.mean())
        # Principal axis (orientation and elongation of the top outline).
        cov = np.cov(np.c_[xs - cx, ys - cy].T)
        evals, evecs = np.linalg.eigh(cov)
        axis = float(np.degrees(np.arctan2(evecs[1, 1], evecs[0, 1])) % 180)
        # Edge directions of the simplified polygon (mod 180).
        edges = np.roll(poly, -1, axis=0) - poly
        edge_dir = (np.degrees(np.arctan2(edges[:, 1], edges[:, 0])) % 180).tolist()
        edge_len = np.hypot(edges[:, 0], edges[:, 1]).tolist()
        sides = len(poly)
        # Share of the outline that runs north-south on screen: a side face
        # of a vertical column is a parallelogram with two such edges.
        vertical = float(sum(l for d, l in zip(edge_dir, edge_len) if abs(d - 90) <= 10) / max(sum(edge_len), 1e-6))
        # The cell drawn directly above this one (across at most 4 outline
        # rows), by majority over the top row of pixels.
        above = []
        for x in np.unique(xs):
            y = ys[xs == x].min() - 1
            for _ in range(5):
                if y < 0 or lab[y, x] not in (0, k):
                    break
                y -= 1
            if y >= 0 and lab[y, x] not in (0, k):
                above.append(lab[y, x])
        above_label = int(np.bincount(above).argmax()) if above else 0
        cells[k] = dict(vertical_share=vertical, above=above_label,label=k, area=area, eqd=eqd, wmin=wmin, wmax=wmax, sides=sides,
                        sides_tight=len(simplify_closed(hull, 1.0, 170)),
                        sides_loose=len(simplify_closed(hull, max(2.5, .08 * eqd), 150)),
                        solidity=float(solidity), cx=cx, cy=cy, lum=float(lum.mean()),
                        rgb=rgb.mean(axis=0).tolist(), elong=float(np.sqrt(evals[1] / max(evals[0], 1e-6))),
                        axis=axis, edge_dir=edge_dir, edge_len=edge_len,
                        mode_index=int(np.bincount(scene.idx[ys, xs]).argmax()) if scene.idx is not None else None,
                        rim=rim_profile(scene, m, sl, xs, ys, cx, cy),
                        xs=xs, ys=ys)
    # A cell is a side face, not a top, when the cell above it is brighter
    # by the face margin and its outline has north-south edges.
    for c in cells.values():
        up = cells.get(c['above'])
        up_lum = up['lum'] if up else (float(scene.raw_lum[lab == c['above']].mean()) if c['above'] else None)
        c['face'] = bool(up_lum is not None and up_lum > c['lum'] + SETTINGS['face_darker_by_luma']
                         and c['vertical_share'] >= SETTINGS['face_vertical_share'])
    return {k: c for k, c in cells.items() if not c['face']}, {k: c for k, c in cells.items() if c['face']}


def face_scan(scene, line, lab, cells, light=None):
    """Samples below each cell's bottom edge: (normal azimuth, face rows,
    face luma, face rgb, face index, top luma, zero step)."""
    samples = []
    H = lab.shape[0]
    half = SETTINGS['edge_fit_half_width_px']
    for c in cells.values():
        xs, ys = c['xs'], c['ys']
        x0, x1 = xs.min(), xs.max()
        bottom = {}
        for x, y in zip(xs, ys):
            if y > bottom.get(x, -1):
                bottom[x] = y
        span = x1 - x0
        for x in range(int(x0 + .15 * span), int(x1 - .15 * span) + 1):
            if x not in bottom:
                continue
            nb = [(xx, bottom[xx]) for xx in range(x - half, x + half + 1) if xx in bottom]
            if len(nb) < 3:
                continue
            a = np.array(nb, float)
            slope = np.polyfit(a[:, 0], a[:, 1], 1)[0]
            az = float(np.degrees(np.arctan2(1.0, -slope)))
            y = bottom[x] + 1
            n_line = 0
            while y < H and line[y, x] and n_line < SETTINGS['max_face_rows']:
                n_line += 1
                y += 1
            if y >= H or n_line >= SETTINGS['max_face_rows']:
                continue
            below = lab[y, x]
            if below == 0:
                continue  # left the formation (or a gap)
            if n_line >= 5:
                ys_face = np.arange(bottom[x] + 1, bottom[x] + 1 + n_line)
                rows = n_line
            else:
                yy = y
                while yy < H and lab[yy, x] == below:
                    yy += 1
                lower = cells.get(below)
                darker = (scene.raw_lum[y:yy, x].mean() < c['lum'] - SETTINGS['face_darker_by_luma'])
                if not darker or (lower is not None and lower['area'] > 0 and below in cells and
                                  abs(lower['lum'] - c['lum']) < SETTINGS['face_darker_by_luma']):
                    samples.append(dict(az=az, rows=0, zero=True, top_lum=c['lum'], cell=c['label']))
                    continue
                ys_face = np.arange(bottom[x] + 1, yy)
                rows = n_line + (yy - y)
                if rows > SETTINGS['max_face_rows']:
                    continue
            face = scene.rgb[ys_face, x]
            ink = (face @ LUMA) < SETTINGS['ink_luma']
            body = face[~ink]
            samples.append(dict(az=az, rows=int(rows), zero=False, lum=float((face @ LUMA).mean()),
                                rgb=face.mean(axis=0).tolist(), top_lum=c['lum'], cell=c['label'],
                                ink=float(ink.mean()), body_sum=body.sum(axis=0).tolist(), body_n=int(len(body)),
                                idx=scene.idx[ys_face, x].tolist() if scene.idx is not None else []))
    return samples


def outline_width(line):
    """Width of outline strokes: per line pixel the shorter of its horizontal
    and vertical run."""
    def runs(mask):
        out = np.zeros(mask.shape, np.int32)
        for i, row in enumerate(mask):
            d = np.diff(np.r_[0, row.astype(np.int8), 0])
            starts, ends = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]
            for s, e in zip(starts, ends):
                out[i, s:e] = e - s
        return out
    h = runs(line)
    v = runs(line.T).T
    w = np.minimum(h, v)[line]
    return w


def line_orientation(line):
    """Orientation of outline strokes (degrees, 0 = east-west, 90 = north-
    south) from the structure tensor, with its coherence."""
    f = line.astype(np.float32)
    gx = ndi.gaussian_filter(f, 1.5, order=(0, 1))
    gy = ndi.gaussian_filter(f, 1.5, order=(1, 0))
    jxx, jyy, jxy = (ndi.gaussian_filter(v, 3) for v in (gx * gx, gy * gy, gx * gy))
    theta = .5 * np.degrees(np.arctan2(2 * jxy, jxx - jyy))   # gradient direction
    stroke = (theta + 90) % 180
    coh = np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2) / (jxx + jyy + 1e-6)
    return stroke, coh


# --- statistics ------------------------------------------------------------------

def q(values, ps=(10, 25, 50, 75, 90)):
    v = np.asarray(values, float)
    v = v[np.isfinite(v)]
    if not len(v):
        return None
    return {f'p{p}': round(float(np.percentile(v, p)), 2) for p in ps} | {'mean': round(float(v.mean()), 2), 'n': int(len(v))}


def hist(values, bins):
    h, e = np.histogram(values, bins=bins)
    return {f'{e[i]:g}-{e[i + 1]:g}': int(h[i]) for i in range(len(h))}


def colour_summary(rgbs, idxs=None):
    rgbs = np.asarray(rgbs, float)
    out = {'mean_rgb': [round(float(v), 1) for v in rgbs.mean(axis=0)], 'mean_luma': round(float(rgbs.mean(axis=0) @ LUMA), 1)}
    if idxs is not None and len(idxs):
        c = np.bincount(np.asarray(idxs, int), minlength=256)
        top = np.argsort(-c)[:4]
        out['top_indices'] = [[int(i), round(float(c[i] / c.sum()), 3)] for i in top if c[i]]
    return out


def fit_light(az, lum):
    """lum = a + b cos(az - phi): phi is the face normal that is brightest."""
    a = np.radians(np.asarray(az))
    A = np.c_[np.ones(len(a)), np.cos(a), np.sin(a)]
    coef, *_ = np.linalg.lstsq(A, np.asarray(lum), rcond=None)
    phi = float(np.degrees(np.arctan2(coef[2], coef[1])) % 360)
    return {'brightest_normal_deg': round(phi, 1), 'amplitude_luma': round(float(np.hypot(coef[1], coef[2])), 1),
            'mean_luma': round(float(coef[0]), 1)}


def mound_light(scenes):
    """Broad light from the 16-px height cells (as measure/light_fit.py):
    luma regressed on the cell gradient over raised, dry cells."""
    X, Y = [], []
    for s in scenes:
        h = s.cells.astype(np.float32)
        gy, gx = np.gradient(h, 16.0)
        Hh, Ww = s.lum.shape
        for cy in range(1, h.shape[0] - 1):
            for cx in range(1, h.shape[1] - 1):
                if h[cy, cx] <= s.base + 3:
                    continue
                x = cx * 16 + 8
                y = int(cy * 16 + 8 - h[cy, cx] / 2)
                if y < 4 or y + 4 > Hh or x + 4 > Ww:
                    continue
                if s.water[y - 4:y + 4, x - 4:x + 4].mean() > .2:
                    continue
                X.append((gx[cy, cx], gy[cy, cx]))
                Y.append(s.raw_lum[y - 4:y + 4, x - 4:x + 4].mean())
    X, Y = np.array(X), np.array(Y)
    s = np.hypot(X[:, 0], X[:, 1])
    m = (s > .15) & (s < 2.5)
    A = np.c_[np.ones(m.sum()), X[m]]
    coef, *_ = np.linalg.lstsq(A, Y[m], rcond=None)
    b, c = coef[1], coef[2]
    return {'cells': int(m.sum()), 'luma_per_unit_slope_east': round(float(b), 1),
            'luma_per_unit_slope_south': round(float(c), 1), 'strength_luma_per_unit_slope': round(float(np.hypot(b, c)), 1),
            'brightest_facing_deg': round(float(np.degrees(np.arctan2(-c, -b)) % 360), 1),
            'note': 'slope in height units per world px; facing angle 0 = east, 90 = south'}


def mound_shading(scenes, min_slope=.3):
    """Art luma of steep 16-px cells by downhill facing (8 bins) and a
    cosine fit, the same method as ice_features.blocks."""
    names = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']
    bins = {}
    for s in scenes:
        h = s.cells.astype(np.float32)
        gy, gx = np.gradient(h, 16.0)
        Hh, Ww = s.raw_lum.shape
        for cy, cx in zip(*np.nonzero(h > s.base + 20)):
            g = np.hypot(gx[cy, cx], gy[cy, cx])
            if g < min_slope:
                continue
            facing = float(np.degrees(np.arctan2(-gy[cy, cx], -gx[cy, cx])) % 360)
            y, x = int(cy * 16 + 8 - h[cy, cx] / 2), cx * 16 + 8
            if y < 4 or y + 4 > Hh or x + 4 > Ww:
                continue
            bins.setdefault(int(((facing + 22.5) % 360) // 45), []).append(s.rgb[y - 4:y + 4, x - 4:x + 4].reshape(-1, 3).mean(axis=0))
    az = np.concatenate([[b * 45.0] * len(v) for b, v in bins.items()])
    lu = np.concatenate([np.array(v) @ LUMA for v in bins.values()])
    A = np.c_[np.ones(len(az)), np.cos(np.radians(az)), np.sin(np.radians(az))]
    coef, *_ = np.linalg.lstsq(A, lu, rcond=None)
    return {'by_facing': {names[b]: {'cells': len(v), 'mean_rgb': [round(float(c), 1) for c in np.mean(v, axis=0)],
                                     'luma': round(float(np.mean(v, axis=0) @ LUMA), 1)} for b, v in sorted(bins.items())},
            'brightest_facing_deg': round(float(np.degrees(np.arctan2(coef[2], coef[1])) % 360), 1),
            'amplitude_luma': round(float(np.hypot(coef[1], coef[2])), 1),
            'note': 'cells rising 20+ units with slope >= .3 units/px; facing 0 = east, 90 = south, 180 = west'}


def split_contrast(scene, xs, ys, toward):
    """Mean luma of the half of a region nearer the light minus the far half."""
    u = np.array([np.cos(np.radians(toward)), np.sin(np.radians(toward))])
    d = (xs - xs.mean()) * u[0] + (ys - ys.mean()) * u[1]
    lum = scene.raw_lum[ys, xs]
    if (d > 0).sum() < 10 or (d < 0).sum() < 10:
        return np.nan
    return float(lum[d > 0].mean() - lum[d < 0].mean())


def ground_contrast(scene, light, radius, count=60, seed=1):
    """The same split statistic on discs of level ground (flat streaked art)."""
    rng = np.random.default_rng(seed)
    H, W = scene.lum.shape
    yy, xx = np.mgrid[-radius:radius + 1, -radius:radius + 1]
    disc = xx ** 2 + yy ** 2 <= radius ** 2
    out = []
    for _ in range(count):
        cx, cy = rng.integers(radius, W - radius), rng.integers(radius, H - radius)
        out.append(split_contrast(scene, (xx[disc] + cx), (yy[disc] + cy), light))
    return out


# --- main ------------------------------------------------------------------------

def measure_family(name, root, code, kinds, light=None, flat=None):
    scenes = list(section_scenes(root, kinds, code))
    return measure_scenes(name, scenes, light, flat)


def measure_scenes(name, scenes, light=None, flat=None, keep_scene=False):
    tops, faces, widths, strokes, formations = [], [], [], [], []
    face_cells_total = 0
    ink_widths = []
    rings = {k: [] for k in ('0-4', '4-8', '8-16', '16-32', '32-64', 'far')}
    for s in scenes:
        formation, line, lab, n = segment(s)
        cells, face_cells = cell_table(s, formation, line, lab, n)
        samples = face_scan(s, line, lab, {**cells, **face_cells})
        samples = [x for x in samples if x['cell'] in cells]
        face_cells_total += len(face_cells)
        for smp in samples:
            smp['scene'] = s.name
        faces += samples
        w = outline_width(line)
        widths += w[w > 0].tolist()
        w = outline_width((s.raw_lum < SETTINGS['ink_luma']) & formation)
        ink_widths += w[w > 0].tolist()
        st, coh = line_orientation(line)
        strokes += st[line & (coh > .5)].tolist()
        # Formation clusters: connected raised land with columns on it.
        flab, fn = ndi.label(formation)
        for k in range(1, fn + 1):
            fm = flab == k
            area = int(fm.sum())
            members = [c for c in cells.values() if fm[int(round(c['cy'])), int(round(c['cx']))]]
            if area < 2000 or len(members) < 5:
                continue
            fy, fx = ndi.center_of_mass(fm)
            R = np.sqrt(area / np.pi)
            pts = np.array([[c['cx'], c['cy']] for c in members])
            nn = cKDTree(pts).query(pts, k=2)[0][:, 1] if len(pts) > 1 else np.array([np.nan])
            # Relief from the cells under this formation.
            cm = np.zeros(s.cells.shape, bool)
            ys, xs = np.nonzero(fm)
            cm[np.clip((ys + (s.height[ys, xs] // 2).astype(int)) // 16, 0, s.cells.shape[0] - 1),
               np.clip(xs // 16, 0, s.cells.shape[1] - 1)] = True
            relief = float(s.cells[cm].max() - s.base) if cm.any() else np.nan
            line_share = float(line[fm].mean())
            top_share = float(sum(c['area'] for c in members) / area)
            for c in members:
                c['r_norm'] = float(np.hypot(c['cx'] - fx, c['cy'] - fy) / R)
                c['formation'] = f'{s.name}#{k}'
                c['nn'] = float(nn[members.index(c)])
            formations.append(dict(scene=s.name, area_px=area, eq_radius_px=round(R, 1), tops=len(members),
                                   relief_units=relief, line_share=round(line_share, 3),
                                   measured_top_share=round(top_share, 3),
                                   nn_spacing_px=round(float(np.median(nn)), 1)))
        for c in cells.values():
            c['scene'] = s.name
            # Ground position of the top: undo the h/2 lift with the cell grid.
            gy = c['cy']
            for _ in range(3):
                cy_cell = int(np.clip(gy // 16, 0, s.cells.shape[0] - 1))
                hh = s.cells[cy_cell, int(np.clip(c['cx'] // 16, 0, s.cells.shape[1] - 1))]
                gy = c['cy'] + hh / 2
            c['mound_units'] = float(hh - s.base)
            # Facing of the mound under the top (16-px cell gradient).
            gyc, gxc = np.gradient(s.cells.astype(np.float32), 16.0)
            ci, cj = int(np.clip(gy // 16, 0, s.cells.shape[0] - 1)), int(np.clip(c['cx'] // 16, 0, s.cells.shape[1] - 1))
            c['mound_slope'] = float(np.hypot(gxc[ci, cj], gyc[ci, cj]))
            c['mound_facing'] = float(np.degrees(np.arctan2(-gyc[ci, cj], -gxc[ci, cj])) % 360)
            if light is not None:
                c['split'] = split_contrast(s, c['xs'], c['ys'], light)
            tops.append(c)
        # Base treatment: ground colour by distance outside the formations.
        dry = ~s.water & ~formation
        dist = ndi.distance_transform_edt(~formation)
        for key, lo, hi in (('0-4', 0, 4), ('4-8', 4, 8), ('8-16', 8, 16), ('16-32', 16, 32), ('32-64', 32, 64), ('far', 96, 1e9)):
            m = dry & (dist > lo) & (dist <= hi)
            if m.sum() > 50 and formation.any():
                rings[key].append((s.rgb[m].mean(axis=0), int(m.sum()), float(s.raw_lum[m].std())))
        if not keep_scene:
            for c in cells.values():
                c.pop('xs'), c.pop('ys')
    return dict(name=name, scenes=len(scenes), tops=tops, faces=faces, widths=widths, strokes=strokes,
                formations=formations, rings=rings, face_cells=face_cells_total,
                ink_widths=ink_widths)


def summarise(m, light=None, ground_split=None):
    tops = [t for t in m['tops'] if 'formation' in t]
    faces = [f for f in m['faces'] if not f['zero']]
    zero = [f for f in m['faces'] if f['zero']]
    rows_by_top = {}
    for f in faces:
        rows_by_top.setdefault((f['scene'], f['cell']), []).append(f['rows'])
    rnorm_by_top = {(t['scene'], t['label']): t.get('r_norm', -1) for t in tops}
    out = {'scenes': m['scenes'], 'tops_measured': len(tops), 'face_cells_set_aside': m['face_cells'],
           'formations': len(m['formations'])}
    sides = np.array([t['sides'] for t in tops])
    eqd = np.array([t['eqd'] for t in tops])
    bins = [(60, 150), (150, 400), (400, 1000), (1000, 6000)]
    out['sides'] = {
        'histogram': {int(k): int((sides == k).sum()) for k in range(3, 13) if (sides == k).any()},
        'mean': round(float(sides.mean()), 2) if len(sides) else None,
        'by_top_area_px': {f'{a}-{b}': {int(k): int(((sides == k) & (np.array([t['area'] for t in tops]) >= a)
                                                     & (np.array([t['area'] for t in tops]) < b)).sum())
                                        for k in range(3, 11)} for a, b in bins},
        'sensitivity_mean': {'tight (1 px, 170 deg)': round(float(np.mean([t['sides_tight'] for t in tops])), 2),
                             'chosen': round(float(sides.mean()), 2),
                             'loose (max(2.5 px, 8%), 150 deg)': round(float(np.mean([t['sides_loose'] for t in tops])), 2)},
    }
    out['top_width_px'] = {'equivalent_diameter': q(eqd), 'min_caliper': q([t['wmin'] for t in tops]),
                           'max_caliper': q([t['wmax'] for t in tops]),
                           'elongation_axis_ratio': q([t['elong'] for t in tops])}
    out['face_height'] = {'rows': q([f['rows'] for f in faces]),
                          'units (2 x rows)': q([2 * f['rows'] for f in faces]),
                          'zero_step_share': round(len(zero) / max(len(m['faces']), 1), 3),
                          'per_top_median_units': q([2 * np.median(v) for v in rows_by_top.values()])}
    out['mound_relief_units'] = q([f['relief_units'] for f in m['formations']])
    out['top_mound_height_units'] = q([t['mound_units'] for t in tops])
    # Orientation randomness.
    ax = np.radians(2 * np.array([t['axis'] for t in tops if t['elong'] > 1.15]))
    R = float(np.hypot(np.cos(ax).mean(), np.sin(ax).mean())) if len(ax) else None
    edges = np.concatenate([t['edge_dir'] for t in tops]) if tops else np.array([])
    lens = np.concatenate([t['edge_len'] for t in tops]) if tops else np.array([])
    eh = np.histogram(edges, bins=np.arange(0, 181, 15), weights=lens)[0]
    out['orientation'] = {
        'top_axis_resultant_length': round(R, 3) if R is not None else None,
        'top_axis_note': '0 = uniformly random axes, 1 = all aligned (axial data, elongated tops only)',
        'edge_direction_length_share_15deg': {f'{a}-{a + 15}': round(float(v / eh.sum()), 3) for a, v in zip(range(0, 180, 15), eh)},
    }
    st = np.asarray(m['strokes'])
    out['lean'] = {
        'outline_strokes_within_5deg_of_vertical': round(float(((st > 85) & (st < 95)).mean()), 3) if len(st) else None,
        'uniform_expectation': round(10 / 180, 3),
        'stroke_direction_share_15deg': {f'{a}-{a + 15}': round(float(((st >= a) & (st < a + 15)).mean()), 3) for a in range(0, 180, 15)},
    }
    # Shading per face orientation.
    shade = {}
    for a in range(0, 180, 20):
        sel = [f for f in faces if a <= f['az'] < a + 20]
        if len(sel) >= 20:
            shade[f'{a}-{a + 20}'] = {'samples': len(sel), **colour_summary([f['rgb'] for f in sel], sum((f['idx'] for f in sel), [])),
                                      'rows_median': float(np.median([f['rows'] for f in sel]))}
    out['face_shading_by_normal_deg'] = shade
    if faces:
        out['face_light_fit'] = fit_light([f['az'] for f in faces], [f['lum'] for f in faces])
    # Do tops shade with the mound they sit on? Top luma by the facing of
    # the mound cell under each top (raised, slope >= .15 units/px).
    names = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']
    sel = [t for t in tops if t['mound_units'] > 3 and t['mound_slope'] >= .15]
    if sel:
        bins = np.array([int(((t['mound_facing'] + 22.5) % 360) // 45) for t in sel])
        lum = np.array([t['lum'] for t in sel])
        az = np.radians(bins * 45.0)
        A = np.c_[np.ones(len(az)), np.cos(az), np.sin(az)]
        coef, *_ = np.linalg.lstsq(A, lum, rcond=None)
        level = [t['lum'] for t in tops if t['mound_units'] > 3 and t['mound_slope'] < .15]
        out['top_luma_by_mound_facing'] = {
            'by_facing': {names[b]: {'tops': int((bins == b).sum()), 'mean_luma': round(float(lum[bins == b].mean()), 1)}
                          for b in range(8) if (bins == b).any()},
            'on_level_mound_mean_luma': round(float(np.mean(level)), 1) if level else None,
            'brightest_facing_deg': round(float(np.degrees(np.arctan2(coef[2], coef[1])) % 360), 1),
            'amplitude_luma': round(float(np.hypot(coef[1], coef[2])), 1),
            'residual_sd_luma': round(float((lum - A @ coef).std()), 1),
            'note': 'tops are planes that follow the mound surface; the residual is per-column variation'}
    out['top_colour'] = colour_summary([t['rgb'] for t in tops], [t['mode_index'] for t in tops if t['mode_index'] is not None])
    out['top_luma'] = q([t['lum'] for t in tops])
    if light is not None:
        split = np.array([t.get('split', np.nan) for t in tops])
        g = np.asarray(ground_split, float)
        g = g[np.isfinite(g)]
        hi = float(np.percentile(g, 95)) if len(g) else np.nan
        out['top_shape'] = {
            'split_contrast_luma': q(split),
            'level_ground_split_contrast_luma': q(g),
            'faceted_share (split above ground p95)': round(float(np.nanmean(np.abs(split) > hi)), 3),
            'light_toward_deg': light,
        }
    # Outline.
    w = np.asarray(m['widths'])
    out['outline'] = {'stroke_width_px': q(w), 'share_of_formation_px': q([f['line_share'] for f in m['formations']]),
                      'stroke_width_histogram_px': {int(k): int((w == k).sum()) for k in range(1, 16)},
                      'ink_stroke_width_px (luma < ink_luma)': q(m['ink_widths']),
                      'ink_stroke_width_histogram_px': {int(k): int((np.asarray(m['ink_widths']) == k).sum()) for k in range(1, 16)},
                      'note': 'strokes include the near-black side faces they merge with; the thinnest mode is the ink line'}
    # Face body colour without the ink, and how much of a face is ink.
    body = {}
    for a in range(0, 180, 20):
        sel = [f for f in faces if a <= f['az'] < a + 20]
        n = sum(f['body_n'] for f in sel)
        if len(sel) >= 20 and n:
            rgb = np.sum([f['body_sum'] for f in sel], axis=0) / n
            body[f'{a}-{a + 20}'] = {'body_rgb': [round(float(v), 1) for v in rgb], 'body_luma': round(float(rgb @ LUMA), 1),
                                     'ink_share': round(float(np.mean([f['ink'] for f in sel])), 3)}
    out['face_body_by_normal_deg'] = body
    # Rim of the tops: luma by distance from the outline, by side.
    rim = {}
    for s in 'NESW':
        row = {}
        for b, label in enumerate(['1', '2', '3', '4-5', '6+']):
            tot = sum(t['rim'].get((s, b), (0, 0))[0] for t in tops)
            cnt = sum(t['rim'].get((s, b), (0, 0))[1] for t in tops)
            if cnt:
                row[label] = round(tot / cnt, 1)
        rim[s] = row
    out['top_rim_luma_by_distance_px'] = rim
    # Cluster structure.
    rn = np.array([t.get('r_norm', np.nan) for t in tops])
    rb = [(0, .25), (.25, .5), (.5, .75), (.75, 1.), (1., 1.5)]
    out['clusters'] = {
        'tops_per_formation': q([f['tops'] for f in m['formations']]),
        'formation_eq_radius_px': q([f['eq_radius_px'] for f in m['formations']]),
        'nn_spacing_px': q([t['nn'] for t in tops if 'nn' in t]),
        'nn_spacing_over_top_diameter': q([t['nn'] / t['eqd'] for t in tops if 'nn' in t]),
        'measured_top_share_of_formation': q([f['measured_top_share'] for f in m['formations']]),
        'by_normalised_radius': {f'{a}-{b}': {
            'tops': int(((rn >= a) & (rn < b)).sum()),
            'top_diameter_px': q(eqd[(rn >= a) & (rn < b)], (50,)),
            'mound_height_units': q(np.array([t['mound_units'] for t in tops])[(rn >= a) & (rn < b)], (50,)),
            'face_units': q([2 * f['rows'] for f in faces if a <= rnorm_by_top.get((f['scene'], f['cell']), -1) < b], (50,)),
        } for a, b in rb},
        'overlap': 'none: the columns tile the mound; neighbours share an outline stroke',
    }
    ring = {}
    for k, v in m['rings'].items():
        if v:
            wts = np.array([x[1] for x in v], float)
            rgb = np.average(np.array([x[0] for x in v]), axis=0, weights=wts)
            ring[k] = {'mean_rgb': [round(float(c), 1) for c in rgb], 'luma': round(float(rgb @ LUMA), 1),
                       'luma_std': round(float(np.average([x[2] for x in v], weights=wts)), 1)}
    out['base_ring_px'] = ring
    return out


def shards_on_flats(root, code):
    """Loose crystals on level ground (flats with micro-relief): components of
    dark outline strokes, closed into footprints."""
    rows = []
    for art in sorted((root / 'flats').glob('*.art.png')):
        cells = np.asarray(Image.open(str(art).replace('.art.png', '.heights.png'))).astype(int)
        if cells.max() == cells.min():
            continue
        rgb = np.asarray(Image.open(art).convert('RGB')).astype(np.float32)
        lum = ndi.gaussian_filter(rgb @ LUMA, 1.0)
        tophat = ndi.grey_closing(lum, size=(9, 9)) - lum
        mark = ndi.binary_closing((tophat > 22) | (lum < 25), iterations=2)
        mark = ndi.binary_fill_holes(mark)
        lab, n = ndi.label(mark)
        for k, sl in enumerate(ndi.find_objects(lab), start=1):
            m = lab[sl] == k
            a = int(m.sum())
            if a < 40:
                continue
            ys, xs = np.nonzero(m)
            pts = np.c_[xs, ys].astype(float)
            try:
                hull = pts[ConvexHull(pts).vertices]
            except Exception:
                continue
            wmin, wmax = calipers(hull)
            rows.append(dict(section=art.name, area=a, eqd=float(np.sqrt(4 * a / np.pi)), wmin=wmin, wmax=wmax,
                             sides=len(simplify_closed(hull, max(1.5, .05 * np.sqrt(4 * a / np.pi)), 160))))
    area_px = sum(np.asarray(Image.open(a)).shape[0] * np.asarray(Image.open(a)).shape[1]
                  for a in sorted((root / 'flats').glob('*.art.png'))
                  if np.ptp(np.asarray(Image.open(str(a).replace('.art.png', '.heights.png')))) > 0)
    return {'count': len(rows), 'per_megapixel': round(len(rows) / max(area_px, 1) * 1e6, 1),
            'footprint_diameter_px': q([r['eqd'] for r in rows]), 'max_caliper_px': q([r['wmax'] for r in rows]),
            'sides': {int(k): int(sum(r['sides'] == k for r in rows)) for k in range(3, 11)},
            'note': 'flat sections with micro-relief only; footprints include the outline and shadow'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--debug', type=Path, help='write segmentation overlays here')
    args = parser.parse_args()
    palette = np.fromfile(PALETTE, np.uint8).reshape(256, 4)[:, :3]
    code = palette_codes(palette)
    result = {'method': __doc__.strip(), 'settings': SETTINGS,
              'conventions': {'angles': 'degrees in the map plane, 0 = east, 90 = south (screen down), 180 = west',
                              'height_units': 'TA height units; a vertical face of H units is drawn H/2 rows tall',
                              'luma': 'Rec.601 luma of the palette RGB, 0-255'}}
    # Light first, from the violet family's mound slopes and face scan.
    violet = FAMILIES['violet (Crystal)']
    light_scenes = list(section_scenes(violet, ['hills'], code))
    result['light'] = {'mound_scale': mound_light(light_scenes),
                       'mound_scale_by_facing': mound_shading(light_scenes),
                       'column_faces': 'see families.*.face_light_fit (visible faces span normals 0-180 only)'}
    light = result['light']['mound_scale']['brightest_facing_deg']
    flat = next(section_scenes(violet, ['flats'], code))
    families = {}
    for name, root in FAMILIES.items():
        if not root.exists():
            families[name] = {'missing': str(root)}
            continue
        flat_scene = next(s for s in section_scenes(root, ['flats'], code))
        m = measure_family(name, root, code, ['hills', 'islands'], light)
        families[name] = summarise(m, light, ground_contrast(flat_scene, light, 12))
    result['families'] = families
    retail = measure_scenes('retail', list(retail_scenes()), light)
    result['retail_maps'] = summarise(retail, light, ground_contrast(flat, light, 12))
    result['retail_maps']['scene_names'] = sorted({t['scene'] for t in retail['tops']})
    craters = measure_family('craters', violet, code, ['craters', 'roughs'], light)
    result['crack_web_on_slopes'] = {k: v for k, v in summarise(craters, light, ground_contrast(flat, light, 12)).items()
                                     if k in ('tops_measured', 'sides', 'top_width_px', 'outline', 'top_colour')}
    result['crack_web_on_slopes']['note'] = ('craters and roughs kinds: the same segmentation over lowered or '
                                             'rough ground; cells here are crack-web plates, not columns')
    result['loose_shards_on_flats'] = shards_on_flats(violet, code)
    args.out.write_text(json.dumps(result, indent=1) + '\n')
    print(json.dumps({k: (v if k in ('light',) else '...') for k, v in result.items()}, indent=1))


if __name__ == '__main__':
    main()
