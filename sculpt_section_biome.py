"""Biome materials measured from a decoded section catalog (cmd/sectioncat).

Each section is an RGB art image (one pixel per world pixel, drawn from the
shared TA palette) with one 8-bit height per 16-px cell. Art for a cell at
height H is drawn H/2 rows north of its grid row, so every height is projected
onto the art before pixels are classified. Pixels are then sorted into level
dry ground, slope and rock (by cell height gradient, optionally with a colour
family), water (a colour cluster that sits below the measured shoreline) and,
where the world has one, beach sand near the water.

From those classes this writes one world's assets: a limited set of 32-px base
ground tiles sampled from measured palette-index neighbour statistics (the
ground_tiles.py sampler, fed from section art instead of corpus maps), quilted
slope, rock, deep- and shallow-water and beach textures, and the measured
shoreline and colour-by-depth ramp. Textures are appearance proxies with
native lighting baked in; brightness is never read as height. Every threshold
in a recipe is an authored prototype choice unless the provenance file says it
was measured.
"""

import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, gaussian_filter

from ground_tiles import causal_tables, measure, sample_tiles
from sculpt_materials import digest, noise_texture, palette_lut, save
from sculpt_slope_material import quilt


PALETTE = Path('/private/tmp/nanolathe-neural-terrain/editor-green-sections/palette.pal')
SCRATCH = Path('/private/tmp/claude-501/-Users-daniel-src-nanolathe/d3f5a820-e6ab-45a4-a10b-857ca7d6c22b/scratchpad')
LUMA = np.array([.299, .587, .114])
VERSION = 1

RECIPES = {
    # Retail Moon. The catalog holds two tonal families: light grey dust
    # (flat/, misc/) and a darker one (dark/). Ground, slope and rock all come
    # from the light family so they sit together; the dark flat stands in for
    # water, which the Moon does not have (authored: a carved basin reads as a
    # dark mare instead of failing to load).
    'moon': {
        'name': 'Moon',
        'root': SCRATCH / 'sections/worlds/sections/moon',
        'ground_kinds': ['flat', 'misc'],
        'ground_reference': 'flat/lunarflat256x',
        'face_kinds': ['misc'],
        # Height units per 16-px cell. Crater shoulders and ejecta form the
        # slope band; walls steeper than the rock threshold form the rock.
        'slope_gradient': [2, 7], 'rock_gradient': 6,
        'slope_colour': None, 'rock_colour': 'dark', 'rock_fill': .75,
        'water': None, 'mare_reference': 'dark/lunardk512xflatgr',
        'seed': 3341907,
    },
    # Third-party Zhon. Its "savannah" level ground is the olive-brown
    # abb1fb9d flat family (the census of level blocks across every savannah
    # kind puts it first by far); the other flats are sand, a greener and a
    # redder grass, mud and water.
    'zhon': {
        'name': 'Zhon',
        'root': SCRATCH / 'sections-zhon/TASect_Zhon/sections/zhon',
        'ground_kinds': ['coast sandy savannah', 'low savannah paths', 'low savannah rivers',
                         'low savannah to low sandy', 'low savannah to high savannah', 'low flats'],
        'ground_reference': 'low flats/abb1fb9d',
        'face_kinds': ['coast cliffs savannah', 'coast cliffs sandy', 'low savannah to high savannah',
                       'low sandy to high savannah', 'low savannah to high sandy'],
        # Zhon cliffs rise as sand aprons studded with grey-blue boulders; the
        # gradient alone does not separate them, so colour splits the band.
        'slope_gradient': [6, 99], 'rock_gradient': 8,
        'slope_colour': 'beach', 'rock_colour': 'grey', 'rock_fill': 1.,
        'water': {'kinds': ['coast sandy', 'coast sandy savannah'],
                  'deep_reference': 'low flats/59f53dfd',
                  'beach_reference': 'low flats/0717093d'},
        'seed': 5590213,
    },
}


def palette_codes(palette):
    """RGB -> palette index, exact. Duplicate colours resolve to the lowest
    index; the art only records colours, so either index draws the same."""
    code = np.full(1 << 24, -1, np.int32)
    for i in range(255, -1, -1):
        r, g, b = (int(v) for v in palette[i])
        code[(r << 16) | (g << 8) | b] = i
    return code


def project_cells(cells, values, shape):
    """Paint one value per 16-px cell at the art rows its height is drawn on.
    Southern cells are painted last, so a raised southern cell covers the art
    north of it as it does on screen."""
    out = np.full(shape, np.nan, np.float32)
    for cy in range(cells.shape[0]):
        for cx in range(cells.shape[1]):
            y0 = cy * 16 - int(cells[cy, cx]) // 2
            if y0 + 16 <= 0:
                continue
            out[max(0, y0):y0 + 16, cx * 16:cx * 16 + 16] = values[cy, cx]
    # Rows uncovered at the bottom (and any gaps) take the nearest value above.
    for y in range(1, shape[0]):
        gap = np.isnan(out[y])
        out[y][gap] = out[y - 1][gap]
    for y in range(shape[0] - 2, -1, -1):
        gap = np.isnan(out[y])
        out[y][gap] = out[y + 1][gap]
    return out


class Section:
    def __init__(self, root, art, code):
        self.name = str(art.relative_to(root)).removesuffix('.art.png')
        self.kind = art.parent.name
        self.rgb = np.asarray(Image.open(art).convert('RGB'))
        rgb = self.rgb.astype(np.int32)
        idx = code[(rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]]
        if np.any(idx < 0):
            raise ValueError('section art uses a colour outside the shared palette: ' + self.name)
        self.idx = idx.astype(np.uint8)
        self.cells = np.asarray(Image.open(str(art).replace('.art.png', '.heights.png'))).astype(np.int32)
        gy, gx = np.gradient(self.cells.astype(np.float32))
        self.cell_gradient = np.hypot(gx, gy)
        self.height = project_cells(self.cells, self.cells, self.idx.shape)
        self.gradient = project_cells(self.cells, self.cell_gradient, self.idx.shape)
        self.smooth = gaussian_filter(self.rgb.astype(np.float32), (2, 2, 0))
        self.sha256 = hashlib.sha256(art.read_bytes()).hexdigest()

    def level_blocks(self, above):
        """32-px tile-grid blocks whose 2x2 cells and their neighbours share
        one height above `above`, cut at the rows that height is drawn on."""
        h = self.cells
        for ty in range(1, h.shape[0] // 2 - 1):
            for tx in range(1, h.shape[1] // 2 - 1):
                w = h[ty * 2 - 1:ty * 2 + 3, tx * 2 - 1:tx * 2 + 3]
                if w.max() != w.min() or w[0, 0] <= above:
                    continue
                y = ty * 32 - int(w[0, 0]) // 2
                if 0 <= y and y + 32 <= self.idx.shape[0]:
                    yield tx * 32, y


class Catalog:
    def __init__(self, root, palette):
        self.root, self.palette, self.code = Path(root), palette, palette_codes(palette)
        self.cache = {}

    def section(self, name):
        if name not in self.cache:
            self.cache[name] = Section(self.root, self.root / (name + '.art.png'), self.code)
        return self.cache[name]

    def kind(self, kind):
        return [self.section(str(p.relative_to(self.root)).removesuffix('.art.png'))
                for p in sorted((self.root / kind).glob('*.art.png'))]

    def family(self, reference, coverage=.995):
        """The palette indices that make up a reference flat."""
        counts = np.bincount(self.section(reference).idx.ravel(), minlength=256).astype(float)
        order = np.argsort(-counts)
        keep = order[:np.searchsorted(np.cumsum(counts[order]) / counts.sum(), coverage) + 1]
        mask = np.zeros(256, bool)
        mask[keep] = True
        return mask, counts / counts.sum()


def overlap(block, histogram):
    counts = np.bincount(block.ravel(), minlength=256) / block.size
    return float(np.minimum(counts, histogram).sum())


# --- water -----------------------------------------------------------------

def measure_water(catalog, recipe, land_level):
    """Find Zhon's water: palette indices that occur mostly below the dry flat
    level in the coast kinds, the shoreline height where water colour gives
    way to land, and the depth ramp between shallow and deep colour."""
    spec = recipe['water']
    sections = [s for kind in spec['kinds'] for s in catalog.kind(kind)]
    below = np.zeros(256)
    total = np.zeros(256)
    for s in sections:
        total += np.bincount(s.idx.ravel(), minlength=256)
        below += np.bincount(s.idx[s.height < land_level - 4], minlength=256)
    water_index = (below / np.maximum(total, 1)) > .5
    deep_family, _ = catalog.family(spec['deep_reference'])
    water_index |= deep_family
    # Shoreline: the lowest height at which water colour no longer dominates.
    wet = np.zeros(256)
    seen = np.zeros(256)
    for s in sections:
        h = s.height.astype(int).clip(0, 255)
        seen += np.bincount(h.ravel(), minlength=256)
        wet += np.bincount(h[water_index[s.idx]], minlength=256)
    fraction = wet / np.maximum(seen, 1)
    sea = next(v for v in range(256) if seen[v] > 1000 and fraction[v] < .5)
    # Depth ramp. Colour is projected on the axis from the shallowest water's
    # mean to the deep flat's mean; a smoothstep is fitted to its mean by depth.
    masks = {}
    shallow_sum, shallow_n = np.zeros(3), 0
    for s in sections:
        water = gaussian_filter(water_index[s.idx].astype(np.float32), 2) > .5
        water &= s.height < sea
        masks[s.name] = water
        band = water & (s.height >= sea - 6)
        shallow_sum += s.smooth[band].sum(axis=0)
        shallow_n += int(band.sum())
    shallow_rgb = shallow_sum / max(shallow_n, 1)
    deep_rgb = catalog.section(spec['deep_reference']).rgb.reshape(-1, 3).mean(axis=0)
    axis = deep_rgb - shallow_rgb
    t_sum, t_n = np.zeros(sea + 1), np.zeros(sea + 1)
    for s in sections:
        water = masks[s.name]
        depth = (sea - s.height[water]).astype(int).clip(0, sea)
        t = ((s.smooth[water] - shallow_rgb) @ axis / (axis @ axis)).clip(0, 1)
        np.add.at(t_sum, depth, t)
        np.add.at(t_n, depth, 1)
    used = t_n > 500
    depths = np.arange(sea + 1)[used]
    curve = t_sum[used] / t_n[used]
    best = None
    for a in range(0, sea):
        for b in range(a + 4, sea + 20):
            x = ((depths - a) / (b - a)).clip(0, 1)
            err = float((((x * x * (3 - 2 * x)) - curve) ** 2 * t_n[used]).sum())
            if best is None or err < best[0]:
                best = (err, a, b)
    return {'water_index': water_index, 'sea': int(sea), 'masks': masks, 'sections': sections,
            'shallowDepth': best[1], 'deepDepth': best[2],
            'shoreline_fraction': {int(v): round(float(fraction[v]), 3) for v in range(max(0, sea - 10), min(255, sea + 6))},
            'depth_curve': {int(d): round(float(c), 3) for d, c in zip(depths, curve)},
            'shallow_reference_rgb': shallow_rgb.tolist()}


# --- patch pools -------------------------------------------------------------

def colour_mask(section, rule, families):
    if rule is None:
        return np.ones(section.idx.shape, bool)
    if rule == 'grey':
        # Grey-blue boulder stone: near-neutral or blue-leaning, not teal water
        # and not the warm sand or olive grass around it.
        r, g, b = section.smooth[..., 0], section.smooth[..., 1], section.smooth[..., 2]
        lum = section.smooth @ LUMA
        return (b >= r - 14) & (g - r < 22) & (lum > 50)
    if rule == 'dark':
        # Shadowed crater walls: clearly darker than the level dust around them.
        lum = gaussian_filter(section.rgb.astype(np.float32) @ LUMA, 4)
        return lum < families['ground_luminance'] - 28
    family = families[rule]
    return gaussian_filter(family[section.idx].astype(np.float32), 2) > .8


def pool(sections, select, patch, per_section, spacing, minimum, label, fill=1., black=.02, typical=None):
    """Patches lying in the selected class (every pixel, or at least `fill`
    of them for narrow bands), preferring the ones with the most native
    mid-band texture, spread over each section. `typical` keeps only patches
    whose mean luminance lies between those quantiles of all candidates, so
    one quilt does not mix the class's lightest and darkest patches."""
    found = []
    for s in sections:
        mask = select(s)
        if mask.sum() < patch * patch:
            continue
        # The image border counts as outside, so an all-class mask still works.
        inside = distance_transform_edt(np.pad(mask, 1))[1:-1, 1:-1]
        share = gaussian_filter(mask.astype(np.float32), patch / 4)
        lum = s.rgb.astype(np.float32) @ LUMA
        mid = gaussian_filter(lum, 1.2) - gaussian_filter(lum, 8)
        H, W = mask.shape
        for y in range(0, H - patch + 1, 8):
            for x in range(0, W - patch + 1, 8):
                sl = np.s_[y:y + patch, x:x + patch]
                if fill >= 1 and inside[sl].min() < 1.5:
                    continue
                if fill < 1 and (share[y + patch // 2, x + patch // 2] < fill or float(mask[sl].mean()) < fill):
                    continue
                if float((lum[sl] < 10).mean()) > black:
                    continue
                found.append((s, float(mid[sl].std()), float(lum[sl].mean()), y, x))
    if typical and found:
        lo, hi = np.quantile([f[2] for f in found], typical)
        found = [f for f in found if lo <= f[2] <= hi]
    patches, records = [], []
    for s in sections:
        candidates = sorted((f for f in found if f[0] is s), key=lambda f: (-f[1], f[3], f[4]))
        chosen = []
        for _, energy, mean, y, x in candidates:
            if any(np.hypot(x - cx, y - cy) < spacing for cy, cx in chosen):
                continue
            chosen.append((y, x))
            patches.append(s.rgb[y:y + patch, x:x + patch].astype(np.float32))
            records.append({'section': s.name, 'xy': [x, y], 'size': patch,
                            'midband_rms': round(energy, 2), 'mean_luminance': round(mean, 1)})
            if len(chosen) == per_section:
                break
    if len(patches) < minimum:
        raise ValueError(f'nanolathe: too few {label} interiors in section catalog: found {len(patches)}, expected {minimum}')
    return np.asarray(patches), records


# --- ground tiles ------------------------------------------------------------

def ground_blocks(catalog, recipe, above):
    reference_mask, reference = catalog.family(recipe['ground_reference'])
    blocks, sources = [], {}
    for kind in recipe['ground_kinds']:
        for s in catalog.kind(kind):
            for x, y in s.level_blocks(above):
                block = s.idx[y:y + 32, x:x + 32]
                # Only blocks of the chosen ground family: no sand, water or a
                # second grass sneaks into the neighbour statistics.
                if overlap(block, reference) >= .6:
                    blocks.append(block)
                    sources[s.name] = sources.get(s.name, 0) + 1
    return np.stack(blocks), sources


def ground_tiles(catalog, recipe, above, out, name, count=16):
    blocks, sources = ground_blocks(catalog, recipe, above)
    # The full four-neighbour table is K^5 counts; keep the vocabulary small
    # enough to hold, folding the rarest indices into the most common one.
    for coverage in (.995, .99, .98, .97, .96, .95):
        vocab, prior = measure(blocks, coverage)
        if len(vocab) <= 26:
            break
    tiles = catalog.palette[sample_tiles(vocab, prior, causal_tables(blocks, vocab), count, recipe['seed'])]
    rng = np.random.default_rng(recipe['seed'] + 1)
    rows = [np.concatenate([tiles[i % count] for i in range(16)], axis=1)]
    for _ in range(15):
        rows.append(np.concatenate([tiles[rng.integers(count)] for _ in range(16)], axis=1))
    save(out / (name + '.png'), np.concatenate(rows, axis=0))
    return {'tiles': count, 'blocks_measured': int(len(blocks)), 'vocabulary': [int(v) for v in vocab],
            'coverage': coverage, 'block_sources': sources, 'seed': recipe['seed'],
            'reference': recipe['ground_reference'], 'family_overlap_minimum': .6}


# --- assets ------------------------------------------------------------------

def contact(out, world, actual, pools):
    order = [k for k in ('ground-tiles', 'ground', 'slope', 'rock', 'beach', 'water-shallow', 'water-mid', 'water')
             if world + '-' + k in actual]
    board = Image.new('RGB', (256 * len(order), 256 + 24 + 6 * 52), (24, 24, 24))
    draw = ImageDraw.Draw(board)
    for i, key in enumerate(order):
        array = actual[world + '-' + key]
        if key == 'ground-tiles':
            array = array[32:288, :256]   # a random arrangement of the tiles
        board.paste(Image.fromarray(array[:256, :256]), (i * 256, 24))
        draw.text((i * 256 + 6, 6), key, fill='white')
    y = 286
    for label, patches in pools.items():
        draw.text((6, y), label + ' source interiors', fill='white')
        for j, p in enumerate(patches[::max(1, len(patches) // 24)][:24]):
            tile = Image.fromarray(np.rint(p).astype(np.uint8)).resize((40, 40), Image.NEAREST)
            board.paste(tile, (150 + j * 44, y))
        y += 52
    board.save(out / 'material-contact.png')


def recipe_digest(recipe, catalog_root):
    text = json.dumps({k: v for k, v in recipe.items() if k != 'root'}, sort_keys=True, default=str)
    text += str(VERSION) + str(catalog_root) + digest(Path(__file__))
    return hashlib.sha256(text.encode()).hexdigest()


def prepare_section_biome(world: str, out: Path, root: Path = None) -> dict:
    recipe = dict(RECIPES[world])
    if root is not None:
        recipe['root'] = Path(root)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    key = recipe_digest(recipe, recipe['root'])
    report_path = out / 'materials.json'
    if report_path.exists():
        # Preparation takes tens of seconds; reuse an identical earlier run.
        old = json.loads(report_path.read_text())
        if old.get('recipe_digest') == key and all((out / Path(u).name).exists() for u in old['config']['textures'].values()):
            return old['config']
    start = time.perf_counter()
    palette = np.fromfile(PALETTE, np.uint8).reshape(256, 4)[:, :3]
    catalog = Catalog(recipe['root'], palette)
    seed = recipe['seed']
    land_level = int(np.bincount(catalog.section(recipe['ground_reference']).cells.ravel()).argmax())
    report = {'world': world, 'catalog': str(recipe['root']), 'recipe_digest': key,
              'palette': {'path': str(PALETTE), 'sha256': digest(PALETTE)},
              'land_level': land_level}
    families = {'ground_luminance': float(catalog.section(recipe['ground_reference']).rgb.reshape(-1, 3).mean(axis=0) @ LUMA)}
    water = None
    if recipe['water']:
        water = measure_water(catalog, recipe, land_level)
        families['beach'], _ = catalog.family(recipe['water']['beach_reference'])
        report['water'] = {k: v for k, v in water.items() if k not in ('water_index', 'masks', 'sections')}
        report['water']['water_indices'] = np.nonzero(water['water_index'])[0].tolist()
    sea = water['sea'] if water else -999
    # Level dry ground starts a little above the shoreline.
    above = max(sea + 2, 0) if water else 0

    tiles = ground_tiles(catalog, recipe, above, out, world + '-ground-tiles')
    report['ground_tiles'] = tiles

    reference_mask, _ = catalog.family(recipe['ground_reference'])
    ground_sections = [catalog.section(n) for n in sorted(tiles['block_sources'], key=lambda n: -tiles['block_sources'][n])[:12]]
    ground_patches, ground_records = pool(
        ground_sections,
        lambda s: (s.gradient == 0) & (s.height > above) & (gaussian_filter(reference_mask[s.idx].astype(np.float32), 3) > .9),
        64, 6, 40, 12, 'level ground')

    faces = [s for kind in recipe['face_kinds'] for s in catalog.kind(kind)]

    def dry(s):
        if not water:
            return np.ones(s.idx.shape, bool)
        mask = water['masks'].get(s.name)
        if mask is None:
            mask = (gaussian_filter(water['water_index'][s.idx].astype(np.float32), 2) > .5) & (s.height < sea + 2)
        return distance_transform_edt(~mask) > 6

    def rock(s):
        return (s.gradient >= recipe['rock_gradient']) & colour_mask(s, recipe['rock_colour'], families) & dry(s)

    def slope(s):
        lo, hi = recipe['slope_gradient']
        mask = (s.gradient >= lo) & (s.gradient < hi) & colour_mask(s, recipe['slope_colour'], families) & dry(s)
        if recipe['rock_colour']:
            mask &= ~colour_mask(s, recipe['rock_colour'], families)
        return mask

    rock_patches, rock_records = pool(faces, rock, 40, 6, 28, 24, 'rock', fill=recipe['rock_fill'],
                                      black=.10, typical=(.2, .8))
    slope_patches, slope_records = pool(faces, slope, 40, 6, 28, 24, 'slope', fill=.85)

    arrays = {}
    arrays[world + '-ground'], ground_quilt = quilt(ground_patches, size=512, patch=64, overlap=24, seed=seed)
    arrays[world + '-slope'], slope_quilt = quilt(slope_patches, size=512, patch=40, overlap=16, seed=seed + 1)
    arrays[world + '-rock'], rock_quilt = quilt(rock_patches, size=256, patch=40, overlap=16, seed=seed + 2)
    pools = {'ground': ground_patches, 'slope': slope_patches, 'rock': rock_patches}
    report['ground'] = {'pool_count': len(ground_records), 'patches': ground_records, 'quilt': ground_quilt}
    report['slope'] = {'pool_count': len(slope_records), 'patches': slope_records, 'quilt': slope_quilt,
                       'gradient_cells': recipe['slope_gradient'], 'colour': recipe['slope_colour']}
    report['rock'] = {'pool_count': len(rock_records), 'patches': rock_records, 'quilt': rock_quilt,
                      'gradient_cells': recipe['rock_gradient'], 'colour': recipe['rock_colour']}

    material = {}
    if water:
        deep_section = catalog.section(recipe['water']['deep_reference'])
        deep_patches, deep_records = pool([deep_section], lambda s: np.ones(s.idx.shape, bool), 64, 40, 32, 12, 'deep water')
        arrays[world + '-water'], deep_quilt = quilt(deep_patches, size=256, patch=64, overlap=24, seed=seed + 3)
        # Shallow water: the band nearest the shoreline, well inside the water.
        shallow_cut = max(4, water['shallowDepth'])

        def shallow(s):
            mask = water['masks'][s.name] & (s.height >= sea - shallow_cut)
            return mask & (distance_transform_edt(water['masks'][s.name]) > 4)
        shallow_patches, shallow_records = pool(water['sections'], shallow, 24, 4, 20, 16, 'shallow water',
                                                typical=(.35, .65))
        arrays[world + '-water-shallow'], shallow_quilt = quilt(shallow_patches, size=256, patch=24, overlap=10, seed=seed + 4)
        # Mid-depth water: where the measured colour ramp is half way. A
        # straight blend of the shallow and deep tiles passes through colours
        # the art never uses (grey-blue after palette lookup); the art's own
        # mid-depth pixels give the renderer a third stop.
        curve = sorted((int(d), c) for d, c in water['depth_curve'].items())
        mid_band = [d for d, c in curve if .4 <= c <= .6] or [curve[len(curve) // 2][0]]
        mid_depth = next(d for d, c in curve if c >= .5)

        def middle(s):
            depth = sea - s.height
            return water['masks'][s.name] & (depth >= mid_band[0]) & (depth <= mid_band[-1])
        mid_patches, mid_records = pool(water['sections'], middle, 24, 4, 20, 16, 'mid-depth water',
                                        typical=(.35, .65))
        arrays[world + '-water-mid'], mid_quilt = quilt(mid_patches, size=256, patch=24, overlap=10, seed=seed + 6)

        # Beach: level sand of the beach family within reach of the water.
        def beach(s):
            near = distance_transform_edt(~water['masks'][s.name]) <= 96
            sand = gaussian_filter(families['beach'][s.idx].astype(np.float32), 2) > .9
            return near & sand & (s.gradient == 0) & (s.height > sea)
        beach_patches, beach_records = pool(water['sections'], beach, 48, 3, 40, 24, 'beach sand')
        arrays[world + '-beach'], beach_quilt = quilt(beach_patches, size=512, patch=48, overlap=16, seed=seed + 5)
        pools.update(shallow=shallow_patches, mid=mid_patches, beach=beach_patches)
        report['deep_water'] = {'source': recipe['water']['deep_reference'], 'sha256': deep_section.sha256,
                                'quilt': deep_quilt, 'patches': deep_records}
        report['shallow_water'] = {'pool_count': len(shallow_records), 'patches': shallow_records,
                                   'quilt': shallow_quilt, 'depth_band': [0, shallow_cut]}
        report['mid_water'] = {'pool_count': len(mid_records), 'patches': mid_records, 'quilt': mid_quilt,
                               'depth_band': [mid_band[0], mid_band[-1]], 'half_depth': mid_depth}
        report['beach'] = {'pool_count': len(beach_records), 'patches': beach_records, 'quilt': beach_quilt,
                           'reach_px': 96}
        report['beach'].update(measure_beach(water, families['beach'], reference_mask, sea))
        material.update(shallowDepth=water['shallowDepth'], deepDepth=water['deepDepth'], midDepth=mid_depth)
    else:
        mare = catalog.section(recipe['mare_reference'])
        mare_patches, mare_records = pool([mare], lambda s: np.ones(s.idx.shape, bool), 64, 40, 32, 12, 'mare')
        arrays[world + '-water'], mare_quilt = quilt(mare_patches, size=256, patch=64, overlap=24, seed=seed + 3)
        arrays[world + '-water-shallow'] = arrays[world + '-water']
        report['water'] = {'substitute': recipe['mare_reference'], 'sha256': mare.sha256, 'quilt': mare_quilt,
                           'note': 'The Moon has no water; the dark lunar flat is an authored stand-in.'}
        # No retail ramp exists; a short ramp keeps a carved basin's floor dark.
        material.update(shallowDepth=2, deepDepth=12)

    arrays['noise-ridged-gaussian'] = noise_texture('ridged-gaussian')
    arrays['palette-lut'] = palette_lut(palette)
    for name, array in arrays.items():
        save(out / (name + '.png'), array)
    actual = {name: np.asarray(Image.open(out / (name + '.png'))) for name in list(arrays) + [world + '-ground-tiles']}
    mean = lambda key: [round(float(v), 2) for v in actual[world + '-' + key].mean(axis=(0, 1))]
    tile_mean = [round(float(v), 2) for v in actual[world + '-ground-tiles'][:32].mean(axis=(0, 1))]

    textures = {key: '/sculpt-assets/' + world + '-' + name + '.png' for key, name in [
        ('grass', 'ground'), ('groundTiles', 'ground-tiles'), ('slopeGrass', 'slope'),
        ('rock', 'rock'), ('hillRock', 'rock'), ('rockWeathered', 'rock'), ('rockFractured', 'rock'),
        ('water', 'water'), ('waterShallow', 'water-shallow')]}
    textures['noise'] = '/sculpt-assets/noise-ridged-gaussian.png'
    textures['palette'] = '/sculpt-assets/palette-lut.png'
    material.update({'rockSlope': .96, 'rockFeather': .48, 'rockCurvature': .28, 'wetBand': 5 if water else 1,
                     'grassDetail': 1., 'rockDetail': 1., 'waterDetail': 1.,
                     'rockMeanRGB': mean('rock'), 'hillRockMeanRGB': mean('rock'),
                     'groundRGB': tile_mean, 'slopeRGB': mean('slope'), 'rockRGB': mean('rock')})
    if water:
        textures['beach'] = '/sculpt-assets/' + world + '-beach.png'
        textures['waterMid'] = '/sculpt-assets/' + world + '-water-mid.png'
        material['beachRGB'] = mean('beach')
        # The sections put sand and grass at one level just above the water,
        # so the beach is a band measured from the shore, not a height. The
        # height here is an authored choice inside the renderer's 4-8 range.
        material['beachHeight'] = 6
        material['beachWidth'] = report['beach']['width_px']
    config = {
        'biome': recipe['name'], 'biomeId': world,
        'textures': textures,
        'material': material,
        'water': {'meanRGB': mean('water'), 'deepRGB': mean('water'),
                  'shallowRGB': mean('water-shallow'), 'shallowMeanRGB': mean('water-shallow'),
                  'mean': [v / 255 for v in mean('water')], 'grainRGB': [1., 1., 1.]},
        'noise': {'variant': 'ridged-gaussian', 'size': 512, 'channels': ['broad', 'mid', 'ridged-gaussian', 'fine']},
        'palette': {'size': 32, 'imageSize': [1024, 32], 'excludedExactBlack': True},
        'measured': {'landLevel': land_level, 'seaLevel': sea if water else None},
    }
    if water:
        config['water']['midRGB'] = mean('water-mid')
    contact(out, world, actual, pools)
    report.update(config=config, generation_seconds=round(time.perf_counter() - start, 1),
                  output_sha256={name: digest(out / (name + '.png')) for name in actual},
                  treatment='unaltered native RGB, translations and binary cuts only; ground tiles are '
                            'sampled from measured palette-index neighbour counts, no pixel copied',
                  limits=['Appearance proxies keep native baked lighting; they are not albedo or height.',
                          'Gradient and colour thresholds in the recipe are authored prototype choices.',
                          'Heights are projected H/2 rows north before classification; underwater cells '
                          'use their own bed height, which may misplace the shelf by a few pixels.'])
    report_path.write_text(json.dumps(report, indent=1) + '\n')
    return config


def measure_beach(water, beach_family, ground_family, sea):
    """Sand fraction of dry ground by distance from the water and by height
    above it, in the coast kinds that carry both sand and grass."""
    by_distance = np.zeros((2, 513))
    by_height = np.zeros((2, 64))
    for s in water['sections']:
        if s.kind != 'coast sandy savannah':
            continue
        dist = distance_transform_edt(~water['masks'][s.name]).astype(int).clip(0, 512)
        sand = gaussian_filter(beach_family[s.idx].astype(np.float32), 2) > .5
        grass = gaussian_filter(ground_family[s.idx].astype(np.float32), 2) > .5
        land = (sand | grass) & (s.height >= sea)
        np.add.at(by_distance[0], dist[land], 1)
        np.add.at(by_distance[1], dist[land & sand], 1)
        rise = (s.height[land] - sea).astype(int).clip(0, 63)
        np.add.at(by_height[0], rise, 1)
        np.add.at(by_height[1], rise, sand[land])
    frac = by_distance[1] / np.maximum(by_distance[0], 1)
    width = next((d for d in range(1, 513) if by_distance[0, d] > 200 and frac[d] < .5), None)
    hfrac = by_height[1] / np.maximum(by_height[0], 1)
    return {'width_px': width,
            'sand_fraction_by_distance': {d: round(float(frac[d]), 3) for d in range(0, 257, 16) if by_distance[0, d] > 0},
            'sand_fraction_by_rise': {h: round(float(hfrac[h]), 3) for h in range(64) if by_height[0, h] > 2000},
            'scope': 'coast sandy savannah only; distance in world px from the measured water mask'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('world', choices=sorted(RECIPES))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--root', type=Path, help='section catalog folder for the world')
    args = parser.parse_args()
    print(json.dumps(prepare_section_biome(args.world, args.out, args.root), indent=1))
