"""Native Archipelago appearance samples for the temporary sculpting lab.

Small translated interiors retain sand grain, fine hill cracks and reef-water
mottling. They are appearance proxies, not physical albedo or recovered height.
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, gaussian_filter

from sculpt_materials import digest, noise_texture, palette_lut, save
from sculpt_red_materials import load, PALETTE
from sculpt_slope_material import quilt


DEFAULT_DATA = Path('/private/tmp/archipelago-inspection/decoded')
SEED = 814729
LUMA = np.array([.299, .587, .114])


def sand_pool(data):
    rgb, source = load(data, 'sections/a-pcs-07')
    patches, records = [], []
    for y in range(0, rgb.shape[0] - 95, 48):
        for x in range(0, rgb.shape[1] - 95, 48):
            patches.append(rgb[y:y + 96, x:x + 96].copy())
            records.append({'section': source['section'], 'xy': [x, y], 'size': 96})
    return np.asarray(patches), records, [source]


def hill_pools(data):
    pools = {'face': [], 'fringe': [], 'ring': []}
    records = {'face': [], 'fringe': [], 'ring': []}
    sources = []
    # Larger native hills give interior context without copying a whole mound.
    for number in range(1, 33):
        section = 'hills/a' + str(number).zfill(3)
        rgb, source = load(data, section)
        lum = rgb @ LUMA
        broad = gaussian_filter(lum, 3)
        face_distance = distance_transform_edt(broad < 135)
        mid = gaussian_filter(lum, 1.2) - gaussian_filter(lum, 7)
        # These darker reddish native pixels distinguish vein tails from the
        # brighter pink grain already present in ordinary pale sand.
        veins = ((rgb[..., 0] > rgb[..., 1] + 50) &
                 (rgb[..., 2] > rgb[..., 1] + 5) & (lum < 170))
        counts = {}
        for role, size in [('face', 48), ('fringe', 32), ('ring', 48)]:
            candidates = []
            half = size // 2
            for y in range(8, rgb.shape[0] - size - 7, 8):
                for x in range(8, rgb.shape[1] - size - 7, 8):
                    sl = np.s_[y:y + size, x:x + size]
                    local = mid[sl]
                    mean = float(lum[sl].mean())
                    energy = float(local.std())
                    detail = {}
                    if role == 'face':
                        if float((lum[sl] > 180).mean()) > .08 or float((lum[sl] < 16).mean()) > .04:
                            continue
                        quadrants = [local[:half, :half], local[:half, half:], local[half:, :half], local[half:, half:]]
                        if (not 65 < mean < 105 or face_distance[sl].min() < 6 or energy < 7 or
                                min(float(q.std()) for q in quadrants) < 3.5):
                            continue
                        score = energy
                    elif role == 'fringe':
                        # Sparse native vein tails extend through pale sand;
                        # reject mineral fill and broad sand/face silhouettes.
                        vein = veins[sl]
                        fraction = float(vein.mean())
                        pale = float((lum[sl] > 185).mean())
                        dark = float((lum[sl] < 130).mean())
                        quadrants = [vein[:half, :half], vein[:half, half:], vein[half:, :half], vein[half:, half:]]
                        if (not 175 < mean < 218 or not 2 < energy < 9 or
                                not .015 < fraction < .12 or pale < .45 or dark > .03 or
                                sum(int(q.sum() >= 3) for q in quadrants) < 2 or
                                broad[sl].min() < 155):
                            continue
                        score = -abs(mean - 205) - 40 * abs(fraction - .06)
                        detail = {'vein_fraction': fraction, 'pale_fraction': pale,
                                  'dark_fraction': dark, 'minimum_broad_luminance': float(broad[sl].min())}
                    else:
                        # Denser connected reddish veins over native sandy
                        # fill form a separate layer from dark mineral core.
                        vein = veins[sl]
                        fraction = float(vein.mean())
                        dark = float((lum[sl] < 105).mean())
                        quadrants = [vein[:half, :half], vein[:half, half:], vein[half:, :half], vein[half:, half:]]
                        minimum_quadrant = min(float(q.mean()) for q in quadrants)
                        if (not 155 < mean < 195 or not .14 < fraction < .40 or dark > .03 or
                                minimum_quadrant < .06 or broad[sl].min() < 125 or broad[sl].std() > 16):
                            continue
                        score = -abs(mean - 175) - 40 * abs(fraction - .26)
                        detail = {'vein_fraction': fraction, 'dark_fraction': dark,
                                  'minimum_quadrant_vein_fraction': minimum_quadrant,
                                  'minimum_broad_luminance': float(broad[sl].min()),
                                  'broad_luminance_rms': float(broad[sl].std())}
                    candidates.append({'section': section, 'xy': [x, y], 'size': size,
                                       'mean_luminance': mean, 'midband_rms': energy,
                                       'selection_score': score, **detail})
            candidates.sort(key=lambda r: (-r['selection_score'], r['xy'][1], r['xy'][0]))
            chosen = []
            for record in candidates:
                x, y = record['xy']
                if any(np.hypot(x - r['xy'][0], y - r['xy'][1]) < size * .6 for r in chosen):
                    continue
                chosen.append(record)
                pools[role].append(rgb[y:y + size, x:x + size].copy())
                records[role].append(record)
                if len(chosen) == 8:
                    break
            counts[role] = {'eligible': len(candidates), 'selected': len(chosen)}
        source['patch_counts'] = counts
        sources.append(source)
    if min(len(pools['face']), len(pools['fringe'])) < 24:
        raise ValueError('too few safe native Archipelago hill or fringe interiors')
    if len(pools['ring']) < 16:
        raise ValueError('too few safe native Archipelago reddish transition interiors')
    return {role: np.asarray(pool) for role, pool in pools.items()}, records, sources


def reef_pool(data):
    patches, records, sources = [], [], []
    size = 48
    for number in range(1, 25):
        section = 'reefs/a' + str(number).zfill(3)
        rgb, source = load(data, section)
        broad = gaussian_filter(rgb, (3, 3, 0))
        shallow = ((broad[..., 1] > 96) & (broad[..., 1] < 125) &
                   (broad[..., 2] > broad[..., 0] + 70))
        distance = distance_transform_edt(shallow)
        candidates = []
        for y in range(8, rgb.shape[0] - size - 7, 8):
            for x in range(8, rgb.shape[1] - size - 7, 8):
                sl = np.s_[y:y + size, x:x + size]
                raw = rgb[sl]
                separation = float(distance[sl].min())
                if separation < 7 or np.any(raw[..., 0] > raw[..., 2] - 45):
                    continue
                candidates.append({'section': section, 'xy': [x, y], 'size': size,
                                   'minimum_distance_from_nonreef': separation})
        candidates.sort(key=lambda r: (-r['minimum_distance_from_nonreef'], r['xy'][1], r['xy'][0]))
        chosen = []
        for record in candidates:
            x, y = record['xy']
            if any(np.hypot(x - r['xy'][0], y - r['xy'][1]) < 32 for r in chosen):
                continue
            chosen.append(record)
            patches.append(rgb[y:y + size, x:x + size].copy())
            records.append(record)
            if len(chosen) == 8:
                break
        source.update(eligible_patch_count=len(candidates), selected_patch_count=len(chosen))
        sources.append(source)
    if len(patches) < 16:
        raise ValueError('too few safe native Archipelago submerged reef interiors')
    return np.asarray(patches), records, sources


def curved_ring_pool(data):
    """Manually inspected local nested curves, not complete hill outlines."""
    selections = {
        'hills/a026': [(360, 40), (368, 64), (384, 80), (392, 96)],
        'hills/a028': [(312, 344), (320, 352), (328, 360)],
    }
    patches, records, sources = [], [], []
    for section, positions in selections.items():
        native, source = load(data, section)
        for x, y in positions:
            patch = native[y:y + 80, x:x + 80].copy()
            if patch.shape != (80, 80, 3):
                raise ValueError('native Archipelago curved-ring crop is out of bounds: ' + section)
            patches.append(patch)
            records.append({'section': section, 'xy': [x, y], 'size': 80,
                            'meanRGB': patch.mean(axis=(0, 1)).tolist(),
                            'selection': 'visual inspection: smoother nested reddish curves over local sandy fill'})
        source['selected_patch_count'] = len(positions)
        sources.append(source)
    return np.asarray(patches), records, sources


def transition_body_pool(data):
    """Inspected warm mineral/vein interiors, excluding pale sand and voids."""
    selections = {
        'hills/a022': [(288, 312), (368, 112), (368, 64), (296, 160), (336, 160),
                       (376, 88), (376, 200), (88, 336), (368, 160)],
        'hills/a026': [(360, 184), (72, 88), (296, 128), (336, 192), (416, 272),
                       (384, 200), (304, 168), (368, 216), (408, 192)],
        'hills/a028': [(224, 376), (264, 344), (432, 136), (432, 112), (264, 312)],
    }
    patches, records, sources = [], [], []
    for section, positions in selections.items():
        native, source = load(data, section)
        for x, y in positions:
            patch = native[y:y + 32, x:x + 32].copy()
            if patch.shape != (32, 32, 3):
                raise ValueError('native Archipelago transition-body crop is out of bounds: ' + section)
            lum = patch @ LUMA
            veins = ((patch[..., 0] > patch[..., 1] + 50) &
                     (patch[..., 2] > patch[..., 1] + 5) & (lum < 170))
            patches.append(patch)
            records.append({'section': section, 'xy': [x, y], 'size': 32,
                            'meanRGB': patch.mean(axis=(0, 1)).tolist(),
                            'mean_luminance': float(lum.mean()), 'vein_fraction': float(veins.mean()),
                            'pale_fraction': float((lum > 185).mean()),
                            'dark_fraction': float((lum < 60).mean()),
                            'selection': 'visual inspection: dense reddish veins intertwined with warm mineral fill'})
        source['selected_patch_count'] = len(positions)
        sources.append(source)
    return np.asarray(patches), records, sources


def transition_body_contact(out, data, arrays, patches, records):
    board = Image.new('RGB', (1536, 840), (28, 27, 24))
    draw = ImageDraw.Draw(board)
    for x, label, key in [(0, 'existing dark mineral core: unchanged', 'archipelago-slope'),
                           (512, 'native dense warm mineral transition', 'archipelago-transition-body'),
                           (1024, 'existing pale red-vein material: unchanged', 'archipelago-mineral-ring')]:
        draw.text((x + 6, 8), label, fill='white')
        board.paste(Image.fromarray(arrays[key]), (x, 28))
    draw.text((6, 558), 'all selected native 32px warm mineral interiors', fill='white')
    for i, patch in enumerate(patches):
        board.paste(Image.fromarray(patch.astype(np.uint8)), ((i % 12) * 40, 584 + (i // 12) * 40))
    examples = []
    for section in dict.fromkeys(record['section'] for record in records):
        record = next(record for record in records if record['section'] == section)
        native, _ = load(data, section)
        x, y = record['xy']
        left, top = max(0, x - 48), max(0, y - 48)
        crop = native[top:top + 128, left:left + 128]
        name = 'native-body-context-' + section.replace('/', '-') + '.png'
        save(out / name, crop)
        px = 536 + len(examples) * 280
        board.paste(Image.fromarray(crop.astype(np.uint8)), (px, 584))
        draw.rectangle((px + x - left, 584 + y - top, px + x - left + 31, 584 + y - top + 31), outline=(255, 195, 96))
        draw.text((px, 726), section + ' ' + str([left, top, 128, 128]), fill='white')
        examples.append({'section': section, 'xywh': [left, top, 128, 128],
                         'path': str(out / name), 'sha256': digest(out / name),
                         'scope': 'source context for inspection only; not a renderer texture'})
    board.save(out / 'transition-body-contact.png')
    return examples


def curved_ring_contact(out, arrays, patches, records):
    board = Image.new('RGB', (1536, 740), (28, 27, 24))
    draw = ImageDraw.Draw(board)
    for x, label, key in [(0, 'existing connected cracks: unchanged', 'archipelago-mineral-ring'),
                           (512, 'optional smoother nested native curves', 'archipelago-mineral-rings'),
                           (1024, 'preserved sparse outer tails', 'archipelago-fringe')]:
        draw.text((x + 6, 8), label, fill='white')
        board.paste(Image.fromarray(arrays[key]), (x, 28))
    draw.text((6, 558), 'all selected native 80px curve interiors: unchanged RGB and native scale', fill='white')
    for i, (patch, record) in enumerate(zip(patches, records)):
        x = i * 208
        board.paste(Image.fromarray(patch.astype(np.uint8)), (x, 584))
        draw.text((x, 680), record['section'] + ' ' + str(record['xy']), fill='white')
        name = 'native-curves-' + record['section'].replace('/', '-') + '-' + '-'.join(map(str, record['xy'])) + '.png'
        save(out / name, patch)
        record['inspection_crop'] = {'path': str(out / name), 'sha256': digest(out / name)}
    board.save(out / 'mineral-rings-contact.png')


def make_contact(out, arrays, pools):
    board = Image.new('RGB', (1536, 1220), (28, 27, 24))
    draw = ImageDraw.Draw(board)
    for x, label, key in [(0, 'native sand quilt: 96px interiors', 'archipelago-ground'),
                           (512, 'native olive/brown hill: 48px interiors', 'archipelago-slope'),
                           (1024, 'native sandy vein tails: 32px interiors', 'archipelago-fringe')]:
        draw.text((x + 6, 8), label, fill='white')
        board.paste(Image.fromarray(arrays[key]), (x, 28))
    for x, label, key in [(0, 'unchanged native deep-water interior', 'archipelago-water'),
                           (256, 'native submerged reef-water quilt', 'archipelago-water-shallow'),
                           (512, 'same hill family: rock tile', 'archipelago-rock')]:
        draw.text((x + 6, 558), label, fill='white')
        board.paste(Image.fromarray(arrays[key]), (x, 582))
    for x, role, size in [(0, 'face', 48), (512, 'fringe', 32), (1024, 'reef', 48)]:
        draw.text((x + 6, 858), 'unaltered native ' + role + ' source interiors', fill='white')
        pool = pools[role]
        step = max(1, len(pool) // 50)
        columns = 512 // (size + 4)
        for i, native in enumerate(pool[::step][:columns * 6]):
            board.paste(Image.fromarray(native.astype(np.uint8)),
                        (x + (i % columns) * (size + 4), 886 + (i // columns) * (size + 4)))
    board.save(out / 'material-contact.png')


def ring_contact(out, data, arrays, patches, records):
    board = Image.new('RGB', (1536, 930), (28, 27, 24))
    draw = ImageDraw.Draw(board)
    for x, label, key in [(0, 'native reddish ring: 48px local interiors', 'archipelago-mineral-ring'),
                           (512, 'preserved sparse sandy outer tails', 'archipelago-fringe'),
                           (1024, 'preserved dark hill core', 'archipelago-slope')]:
        draw.text((x + 6, 8), label, fill='white')
        board.paste(Image.fromarray(arrays[key]), (x, 28))
    draw.text((6, 558), 'unaltered selected native ring interiors', fill='white')
    for i, patch in enumerate(patches[:60]):
        board.paste(Image.fromarray(patch.astype(np.uint8)), ((i % 10) * 52, 582 + (i // 10) * 52))
    examples = []
    seen = set()
    for record in records:
        section = record['section']
        if section in seen:
            continue
        seen.add(section)
        native, _ = load(data, section)
        x, y = record['xy']
        left = max(0, min(x - 40, native.shape[1] - 128))
        top = max(0, min(y - 40, native.shape[0] - 128))
        crop = native[top:top + 128, left:left + 128]
        name = 'native-ring-crop-' + section.replace('/', '-') + '.png'
        save(out / name, crop)
        index = len(examples)
        px = 536 + index * 240
        board.paste(Image.fromarray(crop.astype(np.uint8)), (px, 582))
        draw.text((px, 724), section + ' native crop', fill='white')
        draw.text((px, 742), str([left, top, 128, 128]), fill='white')
        examples.append({'section': section, 'xywh': [left, top, 128, 128],
                         'path': str(out / name), 'sha256': digest(out / name),
                         'scope': 'source context for inspection only; not a renderer texture'})
        if len(examples) == 4:
            break
    board.save(out / 'mineral-ring-contact.png')
    return examples


def prepare_archipelago_assets(out: Path, data: Path = DEFAULT_DATA) -> dict:
    start = time.perf_counter()
    out, data = Path(out), Path(data)
    out.mkdir(parents=True, exist_ok=True)
    sand, sand_records, sand_sources = sand_pool(data)
    hills, hill_records, hill_sources = hill_pools(data)
    reef, reef_records, reef_sources = reef_pool(data)
    curves, curve_records, curve_sources = curved_ring_pool(data)
    body_pool, body_records, body_sources = transition_body_pool(data)
    grass, ground_quilt = quilt(sand, size=512, patch=96, overlap=32, seed=SEED)
    slope, slope_quilt = quilt(hills['face'], size=512, patch=48, overlap=16, seed=SEED + 1)
    fringe, fringe_quilt = quilt(hills['fringe'], size=512, patch=32, overlap=12, seed=SEED + 2)
    ring, ring_quilt = quilt(hills['ring'], size=512, patch=48, overlap=16, seed=SEED + 5)
    rings, rings_quilt = quilt(curves, size=512, patch=80, overlap=28, seed=SEED + 6)
    body, body_quilt = quilt(body_pool, size=512, patch=32, overlap=12, seed=SEED + 7)
    rock, rock_quilt = quilt(hills['face'], size=256, patch=48, overlap=16, seed=SEED + 3)
    shallow, shallow_quilt = quilt(reef, size=256, patch=48, overlap=16, seed=SEED + 4)
    deep_source, water_source = load(data, 'sections/a-pcs-04')
    water = deep_source[:256, 256:512].copy()
    if np.any(water[..., 0] > water[..., 2] - 45):
        raise ValueError('chosen Archipelago deep-water interior contains nonwater pixels')
    water_source['crop_xywh'] = [256, 0, 256, 256]
    palette = np.fromfile(PALETTE, np.uint8).reshape(256, 4)[:, :3]
    arrays = {'archipelago-ground': grass, 'archipelago-slope': slope, 'archipelago-fringe': fringe,
              'archipelago-mineral-ring': ring,
              'archipelago-mineral-rings': rings,
              'archipelago-transition-body': body,
              'archipelago-rock': rock, 'archipelago-water': water, 'archipelago-water-shallow': shallow,
              'noise-ridged-gaussian': noise_texture('ridged-gaussian'), 'palette-lut': palette_lut(palette)}
    for name, array in arrays.items():
        save(out / (name + '.png'), array)
    actual = {name: np.asarray(Image.open(out / (name + '.png'))) for name in arrays}
    mean = lambda key: actual['archipelago-' + key].mean(axis=(0, 1)).tolist()
    config = {
        'biome': 'Archipelago', 'biomeId': 'archipelago',
        'textures': {key: '/sculpt-assets/' + name + '.png' for key, name in [
            ('grass', 'archipelago-ground'), ('slopeGrass', 'archipelago-fringe'),
            ('slopeFringe', 'archipelago-fringe'), ('slopeStructured', 'archipelago-slope'),
            ('mineralRing', 'archipelago-mineral-ring'),
            ('mineralRings', 'archipelago-mineral-rings'),
            ('transitionBody', 'archipelago-transition-body'),
            ('rock', 'archipelago-rock'), ('hillRock', 'archipelago-rock'),
            ('rockStructured', 'archipelago-slope'), ('rockWeathered', 'archipelago-rock'),
            ('rockFractured', 'archipelago-rock'), ('water', 'archipelago-water'),
            ('waterShallow', 'archipelago-water-shallow'), ('noise', 'noise-ridged-gaussian'),
            ('palette', 'palette-lut')]},
        'material': {'rockSlope': .98, 'rockFeather': .50, 'rockCurvature': .28,
                     'wetBand': 5, 'shallowDepth': 2, 'deepDepth': 34,
                     'grassDetail': 1., 'rockDetail': 1., 'waterDetail': 1.,
                     'rockMeanRGB': mean('rock'), 'hillRockMeanRGB': mean('rock')},
        'water': {'meanRGB': mean('water'), 'deepRGB': mean('water'),
                  'shallowRGB': mean('water-shallow'), 'shallowMeanRGB': mean('water-shallow'),
                  'mean': (actual['archipelago-water'].mean(axis=(0, 1)) / 255).tolist(),
                  'grainRGB': [1., 1., 1.]},
        'noise': {'variant': 'ridged-gaussian', 'size': 512,
                  'channels': ['broad', 'mid', 'ridged-gaussian', 'fine']},
        'palette': {'size': 32, 'imageSize': [1024, 32], 'excludedExactBlack': True},
    }
    make_contact(out, actual, dict(hills, reef=reef))
    ring_examples = ring_contact(out, data, actual, hills['ring'], hill_records['ring'])
    curved_ring_contact(out, actual, curves, curve_records)
    body_examples = transition_body_contact(out, data, actual, body_pool, body_records)
    provenance = {
        'config': config, 'generation_seconds': time.perf_counter() - start,
        'palette': {'path': str(PALETTE), 'sha256': digest(PALETTE), 'scope': 'shared universal palette only'},
        'ground': {'sources': sand_sources, 'pool_count': len(sand_records), 'patches': sand_records, 'quilt': ground_quilt},
        'hills': {'sources': hill_sources, 'pool_counts': {role: len(pool) for role, pool in hills.items()},
                  'patches': hill_records, 'slope_quilt': slope_quilt, 'fringe_quilt': fringe_quilt, 'rock_quilt': rock_quilt,
                  'fringe_selection': {'mean_luminance_range': [175, 218], 'vein_fraction_range': [.015, .12],
                                       'minimum_pale_fraction': .45, 'maximum_dark_fraction': .03,
                                       'minimum_broad_luminance': 155, 'patch_size': 32,
                                       'scope': 'sparse darker reddish vein tails in pale native sand, no mineral silhouette'},
                  'ring_quilt': ring_quilt, 'ring_native_examples': ring_examples,
                  'ring_selection': {'mean_luminance_range': [155, 195], 'vein_fraction_range': [.14, .40],
                                     'minimum_quadrant_vein_fraction': .06, 'maximum_dark_fraction': .03,
                                     'minimum_broad_luminance': 125, 'maximum_broad_luminance_rms': 16,
                                     'patch_size': 48, 'overlap': 16,
                                     'scope': 'dense local reddish vein network with sandy fill; no complete boundary silhouette'}},
        'water': {'source': water_source, 'treatment': 'unchanged 256px flat native deep-water interior'},
        'shallow': {'sources': reef_sources, 'pool_count': len(reef_records), 'patches': reef_records, 'quilt': shallow_quilt},
        'curved_rings': {'sources': curve_sources, 'pool_count': len(curve_records), 'patches': curve_records,
                         'quilt': rings_quilt, 'patch_size': 80, 'overlap': 28, 'seed': SEED + 6,
                         'selection': 'manually inspected nested reddish curve fragments from two native outer-margin regions',
                         'scope': 'optional local texture variant; spatial ring placement belongs to the renderer',
                         'limits': ['Small native source pool causes local arc repetition and retains native directional linework.',
                                    'Crops preserve several partial nested curves, never a complete hill or closed hill boundary.',
                                    'The texture is visually more curved than mineralRing; it does not recover historical generation mechanics.']},
        'transition_body': {'sources': body_sources, 'pool_count': len(body_records), 'patches': body_records,
                            'quilt': body_quilt, 'patch_size': 32, 'overlap': 12, 'seed': SEED + 7,
                            'meanRGB': mean('transition-body'), 'native_examples': body_examples,
                            'selection': 'numeric screening followed by native-pixel inspection of warm mineral fill with dense reddish veins',
                            'screen': {'mean_luminance_range': [115, 165], 'minimum_vein_fraction': .18,
                                       'maximum_pale_fraction': .10, 'maximum_dark_fraction': .015,
                                       'minimum_mean_red_minus_green': 17},
                            'scope': 'optional local appearance bridge; placement and amount belong to the renderer',
                            'limits': ['Native stone retains some muted olive grain and baked microshading.',
                                       'Small selected interiors repeat; no complete landform or pale perimeter band is transferred.',
                                       'Unchanged native RGB only; this is not reconstructed physical albedo.']},
        'treatment': 'unaltered native RGB, translations and binary cuts only; no compensation, scaling or rotations',
        'output_sha256': {name: digest(out / (name + '.png')) for name in arrays},
        'recommended_appearance': {'surface': 'structured', 'transition': 'mineral', 'material': 'single',
                                   'surfaceRelief': .45, 'fractureDepth': .35, 'fractures': 20, 'scree': 0,
                                   'rockyCoasts': False, 'slopeStart': .08, 'slopeFull': .35,
                                   'slopeFloor': 8, 'slopeDry': 24, 'faceFill': 0},
        'limits': ['Appearance proxies retain local native lighting; they are not physical albedo or fine height.',
                   'The bright reef sample supplies local water mottling only, never a complete submerged formation.',
                   'Fine reddish native crack pixels remain among the muted olive/brown hill grains.',
                   'Slope and structured rock can share the exact 512px tile; standard 256px rock uses the same source family.',
                   'The fringe samples sparse native reddish vein tails in pale sand, not a recovered transition model.',
                   'The optional mineralRing samples denser local native veins; its spatial band belongs to the renderer.',
                   'Appearance thresholds and recommended relief are authored prototype choices, not retail mechanics.'],
    }
    (out / 'materials.json').write_text(json.dumps(provenance, indent=2) + '\n')
    (out / 'config.json').write_text(json.dumps(config, indent=2) + '\n')
    return config


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--data', type=Path, default=DEFAULT_DATA)
    args = parser.parse_args()
    print(json.dumps(prepare_archipelago_assets(args.out, args.data), indent=2))
