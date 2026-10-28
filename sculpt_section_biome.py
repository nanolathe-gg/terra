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
import os
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, gaussian_filter

from ground_tiles import causal_tables, measure, sample_tiles
from sculpt_materials import digest, noise_texture, palette_lut, save
from sculpt_slope_material import quilt


PALETTE = Path('/private/tmp/nanolathe-neural-terrain/editor-green-sections/palette.pal')
# Decoded section catalogs (cmd/sectioncat on branch sct-reader), kept
# outside Git; override with NANOLATHE_SECTION_CATALOGS.
SCRATCH = Path(os.environ.get('NANOLATHE_SECTION_CATALOGS', '/private/tmp/nanolathe-map-editor/catalogs'))
LUMA = np.array([.299, .587, .114])
VERSION = 1
# A sea whose mean colour at every measured depth lies within this RGB
# distance of the deep flat has no ramp (authored; Lava's spread is ~5,
# Zhon's teal-to-deep ramp is far wider).
FLAT_RAMP_RGB = 12

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
        'slope_colour': None, 'rock_colour': 'dark', 'rock_fill': .75, 'rock_band': [.2, .8],
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
        # Boulders read as light grey-blue domes beside the sand; the class's
        # darker half is mostly their baked shadow side, which the renderer
        # shades again, so the brighter patches are kept (authored).
        'rock_band': [.45, .95],
        'water': {'kinds': ['coast sandy', 'coast sandy savannah'],
                  'deep_reference': 'low flats/59f53dfd',
                  'beach_reference': 'low flats/0717093d', 'beach_kinds': ['coast sandy savannah'],
                  # The river variant (card B4): brown shallows and dark olive
                  # deeps from the one river-mouth section the reproduction
                  # windows do not cut (65a3d59f; its colour by depth, brown 97
                  # at 3-6 to olive 36 at 44-60, matches the windows'). The
                  # family's 50 small sections are uniform maroon at every
                  # depth, a different reach, so they stay out.
                  'river': {'kind': 'low savannah rivers', 'only': ['65a3d59f'],
                            'bands': {'shallow': [0, 10], 'mid': [20, 30], 'deep': [44, 60]}}},
        'seed': 5590213,
    },
    # Retail Lava. One brown ground (flats/low-land; high-land and
    # mtn/l-mtn-flat repeat its art) beside a molten sea that the coast kind
    # draws on cells ~24 height units below the shoreline. Coasts interlock
    # fingers of land and lava; their land side is a ridged flow bank on the
    # rising cells (the slope class). Cliffs of the tall isles, mountain caps
    # and big hills are dark and striated (the rock class).
    'lava': {
        'name': 'Lava',
        'root': SCRATCH / 'sections/worlds/sections/lava',
        'ground_kinds': ['flats', 'misc', 'mtn'],
        'ground_reference': 'flats/low-land',
        # Slope from the ridged coast banks and the small lumpy misc hills;
        # rock from the high cliffs. One shared list would mix the isles'
        # dark shoulders into the slope pool.
        'slope_kinds': ['coast', 'misc'],
        'rock_kinds': ['isle', 'mtn', 'misc'],
        # The coast bank rises ~45 units over ~8 cells, so [3, 8) holds it;
        # cliff faces are steeper and darker (lum ~35-47 against ground 66).
        'slope_gradient': [3, 8], 'rock_gradient': 8,
        'slope_colour': None, 'rock_colour': 'dark', 'rock_fill': .75, 'rock_band': [.2, .8],
        # Lava's level ground carries authored micro-relief: every 4x4-cell
        # window of the low-land flat spans 4-7 height units and its cell
        # gradient stays under 2.2 at the 90th percentile (measured). Level
        # therefore means a window within 7 units and a gradient below the
        # slope class, not one exact height as on the Moon and Zhon.
        'level_spread': 7, 'level_gradient': 3,
        'water': {'kinds': ['coast'], 'deep_reference': 'flats/low-lava',
                  # Molten rock shares no colour with the land, so its indices
                  # are the lava flat's family plus two rim colours found only
                  # at or inside the lava's edge (measured). The below-the-land
                  # heuristic would also take the black and dark-brown
                  # shadows of the ridged bank, which sit below the land too.
                  'indices': 'reference', 'extra_indices': [200, 207],
                  # No sand or lit crust: the dark band beside the lava is the
                  # bank's ridged slope material, not a level beach.
                  'beach_reference': None,
                  # Lava colour does not change with depth (measured), so a
                  # flat ramp is detected instead of fitted; these depths only
                  # keep the renderer's shallow/deep blend out of the way
                  # (authored).
                  'flat_ramp': [0, 10]},
        'seed': 7716203,
    },
    # Crystal (ta-archive section pack TASect_Crystal; Cavedog-style names,
    # land at 85 in every file name). One violet ground streaked
    # on the diagonal (flats/flat1_85, every cell at 85; flat2-4 repeat its
    # art with scattered shards and 82-87 micro-relief), a navy sea on cells
    # at 0, and a blue-violet shelf of crystal rubble below the waterline.
    # Hills and islands are mounds tiled with flat-topped polygonal columns
    # outlined in near-black; craters and roughs are the same violet ground
    # crazed by a dark crack web.
    'crystal': {
        'name': 'Crystal',
        'root': SCRATCH / 'sections-crystal/TASect_Crystal/sections/crystal',
        'ground_kinds': ['flats', 'coasts', 'craters', 'roughs', 'hills'],
        'ground_reference': 'flats/flat1_85',
        # Slope from the crack-webbed crater walls, rough ridges and coast
        # banks; rock from the column faces of hills and islands.
        'slope_kinds': ['craters', 'roughs', 'coasts'],
        'rock_kinds': ['hills', 'islands'],
        'slope_gradient': [2, 8], 'rock_gradient': 8,
        'slope_colour': None, 'rock_colour': 'dark', 'rock_fill': .75, 'rock_band': [.2, .8],
        'level_spread': 5, 'level_gradient': 3,
        # Islands are left out of the water kinds: their column flanks run
        # down to the cells at 0 and would count as water below the shore.
        'water': {'kinds': ['coasts', 'ponds', 'reefs'], 'deep_reference': 'islands/water512_85',
                  # The colour heuristic finds no clean shoreline here (the
                  # shaded banks share the shelf's dark violets, so water
                  # colour stays near half from 69 to 79). Every retail
                  # Crystal map (brilliant cut lake, crystal cracked, crystal
                  # isles, crystal maze) sets sea level 65 over land at 85,
                  # and the shelf's blue lean (blue minus red, 31-38 against
                  # the land's 18) ends between 60 and 70 in the coast
                  # sections (measured).
                  'sea': 65, 'sea_source': 'retail Crystal OTA sea level, 4 of 4 maps',
                  # The ramp's half-way depths lie on the steep outer bank,
                  # where [.4, .6] holds 11 whole patches; [.3, .7] holds 76.
                  'mid_curve': [.3, .7],
                  # The shelf below the waterline is crystal rubble, not a
                  # level beach above it.
                  'beach_reference': None, 'flat_ramp': [0, 10]},
        'seed': 4401877,
    },
    # Ice (ta-archive section pack TASect_Ice). Pale blue snow on level
    # cells at 85 (flats/0-1) and a second plateau at 170 (flats/5-6),
    # a saturated royal-blue sea on cells at 0 (flats/2-4), and between
    # them a broken pack-ice shelf at ~45-60 crossed by straight pressure
    # ridges. The cliffs kind is the 85-to-170 step drawn as a crevasse
    # line; hills are rounded snow mounds with dark slate shaded faces.
    'ice': {
        'name': 'Ice',
        'root': SCRATCH / 'sections-ice/TASect_Ice/sections/ice',
        'ground_kinds': ['flats', 'shores', 'cliffs', 'hills', 'pools'],
        'ground_reference': 'flats/1',
        'slope_kinds': ['hills', 'pools', 'islands', 'cliffs'],
        'rock_kinds': ['hills', 'cliffs', 'pools'],
        'slope_gradient': [3, 8], 'rock_gradient': 8,
        'slope_colour': None, 'rock_colour': 'dark', 'rock_fill': .75, 'rock_band': [.2, .8],
        # The shoreline is measured from the art (65: white floes give way
        # to blue below it). Retail Ice maps set 75 (5 of 7; 73 and 55 on
        # the others), which puts the floe shelf under the game's water:
        # pack ice drawn floating, not a different waterline.
        'water': {'kinds': ['shores', 'islands', 'pools'], 'deep_reference': 'flats/4',
                  # Water lightens towards the floes from ~10 units deep
                  # (measured: blue [38,76,225] deep, [97,120,220] within 7
                  # units), and the fitted ramp starts at the shoreline, so
                  # the shallow pool is drawn from the first 20 units (the
                  # first 12 hold only 2 whole 24-px water patches).
                  'shallow_band': 20,
                  # The measured ramp jumps from ~.38 to ~.65 between depths
                  # 7 and 10, where the floes end, so no whole patch lies at
                  # half way; the mid stop is the water just past the jump.
                  'mid_curve': [.6, .85],
                  'beach_reference': None, 'flat_ramp': [0, 10]},
        'seed': 6120449,
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

    def level_blocks(self, above, spread=0):
        """32-px tile-grid blocks whose 2x2 cells and their neighbours share
        one height (within `spread`) above `above`, cut at the rows that
        height is drawn on."""
        h = self.cells
        for ty in range(1, h.shape[0] // 2 - 1):
            for tx in range(1, h.shape[1] // 2 - 1):
                w = h[ty * 2 - 1:ty * 2 + 3, tx * 2 - 1:tx * 2 + 3]
                if w.max() - w.min() > spread or w.min() <= above:
                    continue
                y = ty * 32 - int(np.median(w)) // 2
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
    deep_family, _ = catalog.family(spec['deep_reference'])
    by_colour = spec.get('indices') == 'reference'
    if by_colour:
        water_index = deep_family.copy()
        water_index[spec.get('extra_indices', [])] = True
    else:
        below = np.zeros(256)
        total = np.zeros(256)
        for s in sections:
            total += np.bincount(s.idx.ravel(), minlength=256)
            below += np.bincount(s.idx[s.height < land_level - 4], minlength=256)
        water_index = (below / np.maximum(total, 1)) > .5
        water_index |= deep_family
    # Shoreline: the lowest height at which water colour no longer dominates.
    wet = np.zeros(256)
    seen = np.zeros(256)
    for s in sections:
        h = s.height.astype(int).clip(0, 255)
        seen += np.bincount(h.ravel(), minlength=256)
        wet += np.bincount(h[water_index[s.idx]], minlength=256)
    fraction = wet / np.maximum(seen, 1)
    detected = next(v for v in range(256) if seen[v] > 1000 and fraction[v] < .5)
    # A recipe may fix the shoreline from the world's retail maps where the
    # colour heuristic is ambiguous (Crystal's shaded banks share the
    # shelf's dark violets, so water colour never clearly gives way).
    sea = spec.get('sea', detected)
    # Depth ramp. Colour is projected on the axis from the shallowest water's
    # mean to the deep flat's mean; a smoothstep is fitted to its mean by depth.
    masks = {}
    shallow_sum, shallow_n = np.zeros(3), 0
    for s in sections:
        water = gaussian_filter(water_index[s.idx].astype(np.float32), 2) > .5
        if not by_colour:
            # An exact colour family needs no height cut; the heuristic one
            # does, since its colours can also occur on land.
            water &= s.height < sea
        masks[s.name] = water
        band = water & (s.height >= sea - 6) & (s.height < sea)
        shallow_sum += s.smooth[band].sum(axis=0)
        shallow_n += int(band.sum())
    shallow_rgb = shallow_sum / max(shallow_n, 1)
    deep_rgb = catalog.section(spec['deep_reference']).rgb.reshape(-1, 3).mean(axis=0)
    # Mean colour by depth below the shoreline, before any ramp is fitted.
    rgb_sum, rgb_n = np.zeros((sea + 1, 3)), np.zeros(sea + 1)
    for s in sections:
        water = masks[s.name] & (s.height < sea)
        depth = (sea - s.height[water]).astype(int).clip(0, sea)
        np.add.at(rgb_sum, depth, s.smooth[water])
        np.add.at(rgb_n, depth, 1)
    depth_rgb = {int(d): [round(float(v), 1) for v in rgb_sum[d] / rgb_n[d]] for d in range(sea + 1) if rgb_n[d] > 500}
    spread = max(float(np.linalg.norm(np.array(v) - deep_rgb)) for v in depth_rgb.values())
    common = {'water_index': water_index, 'sea': int(sea), 'masks': masks, 'sections': sections,
              'shoreline_fraction': {int(v): round(float(fraction[v]), 3) for v in range(max(0, sea - 10), min(255, sea + 6))},
              **({'sea_detected': int(detected), 'sea_source': spec['sea_source']} if 'sea' in spec else {}),
              'depth_rgb': depth_rgb, 'depth_rgb_spread': round(spread, 1),
              'shallow_reference_rgb': shallow_rgb.tolist()}
    if spread < FLAT_RAMP_RGB:
        # Colour does not change with depth: a smoothstep fitted to noise
        # would place stops anywhere, so the recipe's authored depths stand.
        return {**common, 'ramp': 'flat', 'shallowDepth': spec['flat_ramp'][0], 'deepDepth': spec['flat_ramp'][1],
                'depth_curve': {}}
    axis = deep_rgb - shallow_rgb
    t_sum, t_n = np.zeros(sea + 1), np.zeros(sea + 1)
    for s in sections:
        water = masks[s.name] & (s.height < sea)
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
    return {**common, 'ramp': 'fitted', 'shallowDepth': best[1], 'deepDepth': best[2],
            'depth_curve': {int(d): round(float(c), 3) for d, c in zip(depths, curve)}}


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


def pool(sections, select, patch, per_section, spacing, minimum, label, fill=1., black=.02, typical=None,
         avoid=None):
    """Patches lying in the selected class (every pixel, or at least `fill`
    of them for narrow bands), preferring the ones with the most native
    mid-band texture, spread over each section. `typical` keeps only patches
    whose mean luminance lies between those quantiles of all candidates, so
    one quilt does not mix the class's lightest and darkest patches. `avoid`
    marks pixels no patch may contain at all (e.g. water beside a partly
    filled rock patch)."""
    found = []
    for s in sections:
        mask = select(s)
        if mask.sum() < patch * patch:
            continue
        banned = None if avoid is None else avoid(s)
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
                if banned is not None and banned[sl].any():
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
            for x, y in s.level_blocks(above, recipe.get('level_spread', 0)):
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
        if recipe['water']['beach_reference']:
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
    def level(s):
        if recipe.get('level_gradient') is None:
            return s.gradient == 0
        return s.gradient < recipe['level_gradient']
    ground_patches, ground_records = pool(
        ground_sections,
        lambda s: level(s) & (s.height > above) & (gaussian_filter(reference_mask[s.idx].astype(np.float32), 3) > .9),
        64, 6, 40, 12, 'level ground')

    # A recipe may draw slope and rock from different section kinds.
    slope_faces = [s for kind in recipe.get('slope_kinds', recipe.get('face_kinds')) for s in catalog.kind(kind)]
    rock_faces = [s for kind in recipe.get('rock_kinds', recipe.get('face_kinds')) for s in catalog.kind(kind)]

    def dry_by(s, margin):
        if not water:
            return np.ones(s.idx.shape, bool)
        mask = water['masks'].get(s.name)
        if mask is None:
            mask = gaussian_filter(water['water_index'][s.idx].astype(np.float32), 2) > .5
            if recipe['water'].get('indices') != 'reference':
                mask &= s.height < sea + 2
        return distance_transform_edt(~mask) > margin

    def dry(s):
        return dry_by(s, 6)

    def rock(s):
        return (s.gradient >= recipe['rock_gradient']) & colour_mask(s, recipe['rock_colour'], families) & dry(s)

    def slope(s):
        lo, hi = recipe['slope_gradient']
        mask = (s.gradient >= lo) & (s.gradient < hi) & colour_mask(s, recipe['slope_colour'], families) & dry(s)
        if recipe['rock_colour']:
            mask &= ~colour_mask(s, recipe['rock_colour'], families)
        return mask

    # A partly filled rock patch must still hold no water (Lava's cliffs
    # drop straight into the lava); a recipe without water avoids nothing.
    wet = (lambda s: ~dry_by(s, 0)) if water and recipe['water'].get('indices') == 'reference' else None
    rock_patches, rock_records = pool(rock_faces, rock, 40, 6, 28, 24, 'rock', fill=recipe['rock_fill'],
                                      black=.10, typical=tuple(recipe['rock_band']), avoid=wet)
    slope_patches, slope_records = pool(slope_faces, slope, 40, 6, 28, 24, 'slope', fill=.85)

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
        report['deep_water'] = {'source': recipe['water']['deep_reference'], 'sha256': deep_section.sha256,
                                'quilt': deep_quilt, 'patches': deep_records}
        flat = water['ramp'] == 'flat'
        if flat:
            # Colour does not change with depth (measured), so the shallows
            # are the same molten texture and there is no third stop.
            arrays[world + '-water-shallow'] = arrays[world + '-water']
            report['shallow_water'] = {'same_as': 'deep water', 'reason': 'flat colour-by-depth ramp'}
        else:
            # Shallow water: the band nearest the shoreline, well inside the water.
            # A recipe may widen the band where the measured ramp starts at
            # the shoreline itself (Ice: lighter water among the floes).
            shallow_cut = recipe['water'].get('shallow_band', max(4, water['shallowDepth']))

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
            # A recipe may widen the band where a steep bank leaves too few
            # whole patches at half way (Crystal: [.3, .7]).
            mid_lo, mid_hi = recipe['water'].get('mid_curve', (.4, .6))
            mid_band = [d for d, c in curve if mid_lo <= c <= mid_hi] or [curve[len(curve) // 2][0]]
            mid_depth = next(d for d, c in curve if c >= .5)

            def middle(s):
                depth = sea - s.height
                return water['masks'][s.name] & (depth >= mid_band[0]) & (depth <= mid_band[-1])
            mid_patches, mid_records = pool(water['sections'], middle, 24, 4, 20, 16, 'mid-depth water',
                                            typical=(.35, .65))
            arrays[world + '-water-mid'], mid_quilt = quilt(mid_patches, size=256, patch=24, overlap=10, seed=seed + 6)
            pools.update(shallow=shallow_patches, mid=mid_patches)
            report['shallow_water'] = {'pool_count': len(shallow_records), 'patches': shallow_records,
                                       'quilt': shallow_quilt, 'depth_band': [0, shallow_cut]}
            report['mid_water'] = {'pool_count': len(mid_records), 'patches': mid_records, 'quilt': mid_quilt,
                                   'depth_band': [mid_band[0], mid_band[-1]], 'half_depth': mid_depth}
            material['midDepth'] = mid_depth

        if recipe['water']['beach_reference']:
            # Beach: level sand of the beach family within reach of the water.
            def beach(s):
                near = distance_transform_edt(~water['masks'][s.name]) <= 96
                sand = gaussian_filter(families['beach'][s.idx].astype(np.float32), 2) > .9
                return near & sand & (s.gradient == 0) & (s.height > sea)
            beach_patches, beach_records = pool(water['sections'], beach, 48, 3, 40, 24, 'beach sand')
            arrays[world + '-beach'], beach_quilt = quilt(beach_patches, size=512, patch=48, overlap=16, seed=seed + 5)
            pools.update(beach=beach_patches)
            report['beach'] = {'pool_count': len(beach_records), 'patches': beach_records, 'quilt': beach_quilt,
                               'reach_px': 96}
            report['beach'].update(measure_beach(water, families['beach'], reference_mask, sea,
                                                 recipe['water']['beach_kinds']))
        material.update(shallowDepth=water['shallowDepth'], deepDepth=water['deepDepth'])
        if recipe['water'].get('river'):
            river_keys = river_water(catalog, recipe['water']['river'], sea, seed, arrays, world, report)
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
    if water and 'midDepth' in material:
        textures['waterMid'] = '/sculpt-assets/' + world + '-water-mid.png'
    if water and recipe['water']['beach_reference']:
        textures['beach'] = '/sculpt-assets/' + world + '-beach.png'
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
    if water and 'midDepth' in material:
        config['water']['midRGB'] = mean('water-mid')
    if water and recipe['water'].get('river'):
        # What the river variant swaps in: its three water textures and a
        # ramp read off the retail river family's colour by depth (brown at
        # the shore, dark olive from ~45 units down: windows zhon-1..3 at 0-3 /
        # 26-34 / 44-56: R 97-109 / 61-65 / 39-45).
        rtex = {**textures, 'water': '/sculpt-assets/' + river_keys['deep'] + '.png',
                'waterShallow': '/sculpt-assets/' + river_keys['shallow'] + '.png',
                'waterMid': '/sculpt-assets/' + river_keys['mid'] + '.png'}
        rmean = lambda band: [round(float(v), 2) for v in actual[river_keys[band]].mean(axis=(0, 1))]
        config['river'] = {
            'textures': rtex,
            'material': {**material, 'shallowDepth': 0, 'deepDepth': 50, 'midDepth': 25},
            'water': {'meanRGB': rmean('deep'), 'deepRGB': rmean('deep'), 'shallowRGB': rmean('shallow'),
                      'shallowMeanRGB': rmean('shallow'), 'mean': [v / 255 for v in rmean('deep')], 'grainRGB': [1., 1., 1.],
                      'midRGB': rmean('mid')}}
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


def river_water(catalog, spec, sea, seed, arrays, world, report):
    """River-family water textures by depth below the shoreline (shallow, mid
    and deep bands), quilted from the family's sections with the same patch
    rules as the coastal water, and the config pieces a variant swaps in."""
    sections = [s for s in catalog.kind(spec['kind']) if s.name.split('/')[-1] in spec['only']]
    means = {}
    for band, (lo, hi) in spec['bands'].items():
        def select(s, lo=lo, hi=hi):
            depth = sea - s.height
            water = (depth >= lo) & (depth <= hi) & (s.height < sea)
            return water & (distance_transform_edt(s.height < sea) > 4)
        patches, records = pool(sections, select, 24, 30, 16, 4, 'river ' + band + ' water', fill=.8, typical=(.1, .9))
        key = world + '-river-' + band
        arrays[key], quilt_info = quilt(patches, size=256, patch=24, overlap=10, seed=seed + 20 + len(means))
        report['river_' + band] = {'pool_count': len(records), 'patches': records, 'quilt': quilt_info,
                                   'depth_band': [lo, hi], 'sections': [s.name for s in sections]}
        means[band] = key
    return means


def measure_beach(water, beach_family, ground_family, sea, kinds):
    """Sand fraction of dry ground by distance from the water and by height
    above it, in the coast kinds that carry both sand and grass."""
    by_distance = np.zeros((2, 513))
    by_height = np.zeros((2, 64))
    for s in water['sections']:
        if s.kind not in kinds:
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
            'scope': ', '.join(kinds) + ' only; distance in world px from the measured water mask'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('world', choices=sorted(RECIPES))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--root', type=Path, help='section catalog folder for the world')
    args = parser.parse_args()
    print(json.dumps(prepare_section_biome(args.world, args.out, args.root), indent=1))
