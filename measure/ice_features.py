"""Ice-world features from the Ice section pack and retail Ice maps.

Brief measurements for the Ice world and the ice "crystal" blocks:

- snow ground and the plateau level (colour, grain);
- water colour by depth (from the prepared world's materials.json);
- the pack-ice shelf on shores: white floes detached from the shore, their
  sizes and their share by distance from the solid snow edge;
- pressure ridges: thin dark lines across the shore snow (width, length,
  spacing);
- crevasses: the dark crack line the cliffs kind draws along its 85-to-170
  step, and its side branches;
- ice blocks (hills/09, hills/10 and the retail Polar Range field): raised
  forms from the 16-px height cells, with footprint sides, relief, top
  plateau share (apex ratio), side slope, top tilt, and art luma by face
  direction under TA's light.

Angles: degrees in the map plane, 0 = east, 90 = south. Heights in TA units;
a cell's art is drawn h/2 rows north. Thresholds are authored measurement
choices, recorded in the output.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sculpt_section_biome import PALETTE, palette_codes, project_cells  # noqa: E402
from crystal_geometry import q, simplify_closed, calipers, colour_summary  # noqa: E402

LUMA = np.array([.299, .587, .114], np.float32)
ROOT = Path('/private/tmp/nanolathe-map-editor/catalogs/sections-ice/TASect_Ice/sections/ice')
RETAIL = Path('/private/tmp/nanolathe-map-editor/retail-ice')
MATERIALS = Path('/private/tmp/nanolathe-map-editor/agent-icecrystal/assets-ice/materials.json')
SETTINGS = {'snow_luma': 150, 'water_blue_minus_red': 100, 'ridge_tophat_luma': 25, 'ridge_min_px': 30,
            'crack_luma': 120, 'block_rise_units': 20, 'block_top_within_units': 15,
            'face_slope_units_per_px': .3}


def load(path, code):
    rgb = np.asarray(Image.open(path).convert('RGB'))
    a = rgb.astype(np.int32)
    idx = code[(a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]]
    cells = np.asarray(Image.open(str(path).replace('.art.png', '.heights.png'))).astype(np.int32)
    return rgb.astype(np.float32), idx, cells


def snow(code):
    out = {}
    for name in ('flats/1', 'flats/6'):
        rgb, idx, cells = load(ROOT / (name + '.art.png'), code)
        lum = rgb @ LUMA
        a = lum - lum.mean()
        lag1 = float((a[:, 1:] * a[:, :-1]).mean() / a.var())
        out[name] = {'height': int(np.median(cells)), **colour_summary(rgb.reshape(-1, 3), idx.ravel()),
                     'luma_std': round(float(lum.std()), 1), 'lag1_correlation': round(lag1, 3)}
    same = np.array_equal(load(ROOT / 'flats/1.art.png', code)[0], load(ROOT / 'flats/6.art.png', code)[0])
    out['plateau_art_identical_to_low_snow'] = bool(same)
    return out


def shores(code):
    """Floes, shelf and pressure ridges on the shore sections."""
    floes, band, ridges, widths = [], np.zeros((2, 40)), [], []
    shelf_heights = []
    ridge_px, ridge_area = 0, 0
    for art in sorted((ROOT / 'shores').glob('*.art.png')):
        rgb, idx, cells = load(art, code)
        lum = rgb @ LUMA
        sm = ndi.gaussian_filter(rgb, (1, 1, 0))
        white = ndi.gaussian_filter(lum, 1) > SETTINGS['snow_luma']
        water = (sm[..., 2] - sm[..., 0]) > SETTINGS['water_blue_minus_red']
        lab, n = ndi.label(ndi.binary_opening(white, iterations=1))
        if n == 0:
            continue
        sizes = ndi.sum(white, lab, np.arange(1, n + 1))
        main = lab == 1 + int(np.argmax(sizes))
        dist = ndi.distance_transform_edt(~main)
        height = project_cells(cells, cells, lum.shape)
        for k in range(1, n + 1):
            m = lab == k
            if k == 1 + int(np.argmax(sizes)) or sizes[k - 1] < 6:
                continue
            ys, xs = np.nonzero(m)
            floes.append(dict(area=int(m.sum()), eqd=float(np.sqrt(4 * m.sum() / np.pi)), dist=float(dist[m].min()),
                              height=float(np.median(height[m]))))
        d = (dist // 8).astype(int).clip(0, 39)
        sea = water | (white & ~main)
        np.add.at(band[0], d[sea], 1)
        np.add.at(band[1], d[sea & white], 1)
        # Shelf: the heights under floes and the water between them.
        shelf_heights += height[sea & (dist < 96)].astype(int).tolist()
        # Pressure ridges: thin dark strokes on the solid snow.
        snowland = ndi.binary_erosion(main, iterations=3)
        th = ndi.grey_closing(ndi.gaussian_filter(lum, .8), size=(7, 7)) - ndi.gaussian_filter(lum, .8)
        stroke = (th > SETTINGS['ridge_tophat_luma']) & snowland
        rl, rn = ndi.label(stroke, structure=np.ones((3, 3)))
        for k, sl in enumerate(ndi.find_objects(rl), start=1):
            m = rl[sl] == k
            a = int(m.sum())
            if a < SETTINGS['ridge_min_px']:
                continue
            ys, xs = np.nonzero(m)
            pts = np.c_[xs, ys].astype(float)
            try:
                hull = pts[ConvexHull(pts).vertices]
            except Exception:
                continue
            wmin, wmax = calipers(hull)
            ridges.append(dict(px=a, length=wmax, width=a / max(wmax, 1)))
        ridge_px += int(sum(r['px'] for r in ridges[-rn:])) if rn else 0
        ridge_area += int(snowland.sum())
    frac = band[1] / np.maximum(band[0], 1)
    lengths = np.array([r['length'] for r in ridges])
    total_len = float(sum(r['length'] for r in ridges))
    return {
        'floes': {'count': len(floes), 'diameter_px': q([f['eqd'] for f in floes]),
                  'distance_from_shore_px': q([f['dist'] for f in floes]),
                  'height_units': q([f['height'] for f in floes]),
                  'note': 'white pieces detached from the main snow mass, 6 px and up'},
        'floe_share_of_sea_by_distance_px': {f'{8 * i}-{8 * i + 8}': round(float(frac[i]), 3) for i in range(16) if band[0, i] > 200},
        'shelf_height_units_within_96px': q(shelf_heights),
        'pressure_ridges': {'segments': len(ridges), 'length_px': q(lengths), 'width_px': q([r['width'] for r in ridges]),
                            'spacing_px (snow area / total length)': round(ridge_area / max(total_len, 1), 1),
                            'note': 'thin dark strokes (top-hat over 7 px) on the solid shore snow; segments are '
                                    'connected strokes, so junctions merge their branches'},
    }


def crevasses(code):
    """The dark crack along the cliffs kind's step and its side branches."""
    mains, branches, cols = [], [], []
    for art in sorted((ROOT / 'cliffs').glob('*.art.png')):
        rgb, idx, cells = load(art, code)
        lum = ndi.gaussian_filter(rgb @ LUMA, .8)
        dark = lum < SETTINGS['crack_luma']
        lab, n = ndi.label(dark, structure=np.ones((3, 3)))
        if n == 0:
            continue
        sizes = ndi.sum(dark, lab, np.arange(1, n + 1))
        order = np.argsort(-sizes)
        k = order[0] + 1
        m = lab == k
        ys, xs = np.nonzero(m)
        pts = np.c_[xs, ys].astype(float)
        hull = pts[ConvexHull(pts).vertices]
        wmin, wmax = calipers(hull)
        # Width: the shorter run through each crack pixel.
        hrun = np.array([np.sum(m[y, max(0, x - 15):x + 16]) for y, x in zip(ys[::7], xs[::7])])
        vrun = np.array([np.sum(m[max(0, y - 15):y + 16, x]) for y, x in zip(ys[::7], xs[::7])])
        mains.append(dict(px=int(m.sum()), length=wmax, width=float(np.median(np.minimum(hrun, vrun)))))
        cols.append((rgb[m].mean(axis=0), int(m.sum())))
        for j in order[1:]:
            if sizes[j] < 20:
                break
            mm = lab == j + 1
            yy, xx = np.nonzero(mm)
            p2 = np.c_[xx, yy].astype(float)
            try:
                h2 = p2[ConvexHull(p2).vertices]
            except Exception:
                continue
            branches.append(dict(px=int(sizes[j]), length=calipers(h2)[1]))
    w = np.array([c[1] for c in cols], float)
    rgb = np.average(np.array([c[0] for c in cols]), axis=0, weights=w)
    return {'main_crack': {'count': len(mains), 'length_px': q([x['length'] for x in mains]),
                           'width_px': q([x['width'] for x in mains]),
                           'mean_rgb': [round(float(v), 1) for v in rgb], 'luma': round(float(rgb @ LUMA), 1)},
            'separate_side_cracks': {'count': len(branches), 'per_section': round(len(branches) / max(len(mains), 1), 1),
                                     'length_px': q([b['length'] for b in branches])},
            'step_units': '85 to 170 (cells either side of the crack)',
            'note': 'side cracks joined to the main crack are counted with it, so separate_side_cracks are only the detached ones'}


def blocks(scenes):
    """Raised ice blocks from height cells: footprint, relief, top, tilt, shading."""
    rows, shade = [], {}
    for name, window, cells, base in scenes:
        H, W = cells.shape[0] * 16, cells.shape[1] * 16
        raised = cells > base + SETTINGS['block_rise_units']
        lab, n = ndi.label(raised)
        gy, gx = np.gradient(cells.astype(np.float32), 16.0)
        for k in range(1, n + 1):
            m = lab == k
            if m.sum() < 12:
                continue
            corners = np.array([[-.5, -.5], [.5, -.5], [-.5, .5], [.5, .5]])
            ys, xs = np.nonzero(m)
            pts = (np.c_[xs, ys][:, None, :] + corners[None]).reshape(-1, 2) * 16
            hull = pts[ConvexHull(pts).vertices]
            wmin, wmax = calipers(hull)
            top = m & (cells >= cells[m].max() - SETTINGS['block_top_within_units'])
            relief = float(cells[m].max() - base)
            # Sides of the outline at half the rise (the rubble foot rounds
            # the base), simplified at 6% of its diameter.
            half = m & (cells >= base + relief / 2)
            hy, hx = np.nonzero(half)
            hp = (np.c_[hx, hy][:, None, :] + corners[None]).reshape(-1, 2) * 16
            hh = hp[ConvexHull(hp).vertices]
            sides = len(simplify_closed(hh, max(16.0, .06 * calipers(hh)[1]), 150))
            # Top plane: least squares over the top half of the block's rise.
            upper = m & (cells >= base + relief / 2)
            uy, ux = np.nonzero(upper)
            A = np.c_[np.ones(len(ux)), ux * 16.0, uy * 16.0]
            coef, *_ = np.linalg.lstsq(A, cells[upper].astype(float), rcond=None)
            tilt = float(np.hypot(coef[1], coef[2]))
            rows.append(dict(scene=name, footprint_px2=int(m.sum()) * 256, sides=sides, wmin=wmin, wmax=wmax,
                             relief=relief, apex_ratio=float(np.sqrt(top.sum() / m.sum())),
                             side_slope=float(np.median(np.hypot(gx, gy)[m & ~top])) if (m & ~top).any() else np.nan,
                             upper_tilt=tilt, upper_tilt_dir=float(np.degrees(np.arctan2(coef[2], coef[1])) % 360)))
            # Art luma by downhill face direction for steep cells.
            for cy, cx in zip(*np.nonzero(m)):
                g = np.hypot(gx[cy, cx], gy[cy, cx])
                if g < SETTINGS['face_slope_units_per_px']:
                    continue
                facing = float(np.degrees(np.arctan2(-gy[cy, cx], -gx[cy, cx])) % 360)
                y = int(cy * 16 + 8 - cells[cy, cx] / 2)
                x = cx * 16 + 8
                if y < 4 or y + 4 > H or x + 4 > W:
                    continue
                b = int(((facing + 22.5) % 360) // 45)
                shade.setdefault(b, []).append((window(y - 4, y + 4, x - 4, x + 4).reshape(-1, 3).mean(axis=0), g))
    names = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']
    az, lu, wt = [], [], []
    for b, v in shade.items():
        for rgb, g in v:
            az.append(b * 45.0)
            lu.append(float(rgb @ LUMA))
    A = np.c_[np.ones(len(az)), np.cos(np.radians(az)), np.sin(np.radians(az))]
    coef, *_ = np.linalg.lstsq(A, np.array(lu), rcond=None)
    light = {'brightest_facing_deg': round(float(np.degrees(np.arctan2(coef[2], coef[1])) % 360), 1),
             'amplitude_luma': round(float(np.hypot(coef[1], coef[2])), 1), 'mean_luma': round(float(coef[0]), 1),
             'note': 'cosine fit of steep-cell luma on the downhill facing, 45-degree bins'}
    unique = {(r['relief'], round(r['wmin']), round(r['wmax'])) for r in rows}
    shading = {names[b]: {'cells': len(v), 'mean_rgb': [round(float(c), 1) for c in np.mean([x[0] for x in v], axis=0)],
                          'luma': round(float(np.mean([x[0] for x in v], axis=0) @ LUMA), 1),
                          'median_slope_units_per_px': round(float(np.median([x[1] for x in v])), 2)}
               for b, v in sorted(shade.items())}
    return {'blocks': len(rows), 'rows': [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()} for r in rows],
            'sides': {int(s): sum(r['sides'] == s for r in rows) for s in range(3, 9)},
            'relief_units': q([r['relief'] for r in rows]), 'max_caliper_px': q([r['wmax'] for r in rows]),
            'min_caliper_px': q([r['wmin'] for r in rows]), 'apex_ratio': q([r['apex_ratio'] for r in rows]),
            'side_slope_units_per_px': q([r['side_slope'] for r in rows]),
            'upper_tilt_units_per_px': q([r['upper_tilt'] for r in rows]),
            'face_shading_by_facing': shading, 'light_fit': light,
            'unique_shapes': len(unique),
            'note': 'footprints are 16-px cells rising more than 20 units; sides from the cell hull simplified at one '
                    'cell, so a block shows 4 only when it is at least ~5 cells across'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    palette = np.fromfile(PALETTE, np.uint8).reshape(256, 4)[:, :3]
    code = palette_codes(palette)
    result = {'method': __doc__.strip(), 'settings': SETTINGS}
    result['snow'] = snow(code)
    if MATERIALS.exists():
        mat = json.loads(MATERIALS.read_text())
        w = mat['water']
        result['water'] = {'sea_units_measured': w['sea'], 'ramp': w['ramp'], 'shallowDepth': w['shallowDepth'],
                           'deepDepth': w['deepDepth'], 'midDepth': mat['config']['material'].get('midDepth'),
                           'depth_rgb_sample': {d: w['depth_rgb'][d] for d in list(w['depth_rgb'])[::6]},
                           'deep_rgb': mat['config']['water']['deepRGB'], 'shallow_rgb': mat['config']['water']['shallowRGB'],
                           'mid_rgb': mat['config']['water'].get('midRGB'), 'water_indices': w['water_indices'],
                           'retail_ota_sea_level': {'75': 5, '73': 1, '55': 1}}
    result['shore'] = shores(code)
    result['crevasses'] = crevasses(code)
    scenes = []
    for name in ('hills/09', 'hills/10'):
        rgb, idx, cells = load(ROOT / (name + '.art.png'), code)
        scenes.append((name, lambda y0, y1, x0, x1, a=rgb: a[y0:y1, x0:x1], cells, 85))
    d = RETAIL / 'polar_range-c174f8c9'
    if d.exists():
        m = json.loads((d / 'metadata.json').read_text())
        cells = np.fromfile(d / 'heights.bin', np.uint8).reshape(m['cell_height'], m['cell_width']).astype(np.int32)
        idx = np.memmap(d / 'map-indexed.bin', np.uint8, 'r', shape=(m['height'], m['width']))
        pal = np.fromfile(d / 'palette-rgb.bin', np.uint8).reshape(256, 3)
        scenes.append(('retail polar range', lambda y0, y1, x0, x1: pal[np.asarray(idx[y0:y1, x0:x1])].astype(np.float32),
                       cells, 85))
    result['ice_blocks'] = blocks(scenes)
    args.out.write_text(json.dumps(result, indent=1) + '\n')
    print(json.dumps({k: '...' for k in result}, indent=1))


if __name__ == '__main__':
    main()
