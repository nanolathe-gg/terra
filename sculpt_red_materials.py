"""Native Red Planet appearance proxies for the temporary sculpting lab.

Ground retains 96px native context; cracked faces use 40px interiors only.
These are appearance samples, not recovered physical albedo or height maps.
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, gaussian_filter

from sculpt_materials import digest, noise_texture, palette_lut, save
from sculpt_slope_material import quilt


DEFAULT_DATA = Path('/private/tmp/red-planet-inspection/decoded')
PALETTE = Path('/private/tmp/nanolathe-neural-terrain/editor-green-sections/palette.pal')
SEED = 725193
LUMA = np.array([.299, .587, .114])


def load(data, section):
    directory = data / section
    metadata = json.loads((directory / 'metadata.json').read_text())
    rgb = np.asarray(Image.open(directory / 'native.png').convert('RGB')).astype(np.float32)
    if rgb.shape[:2] != (metadata['height'], metadata['width']):
        raise ValueError('native image size differs from decoded section metadata: ' + section)
    return rgb, {'section': section, 'metadata': metadata,
                 'native_sha256': digest(directory / 'native.png'),
                 'indexed_sha256': digest(directory / 'indexed.bin')}


def ground_pool(data):
    patches, records, sources = [], [], []
    patch = 96
    for name in ['marsflatgr00', 'marsflatgr01', 'marsflatgr02']:
        rgb, source = load(data, 'flat/' + name)
        count = 0
        for y in range(0, rgb.shape[0] - patch + 1, 32):
            for x in range(0, rgb.shape[1] - patch + 1, 32):
                patches.append(rgb[y:y + patch, x:x + patch].copy())
                records.append({'section': source['section'], 'xy': [x, y], 'size': patch})
                count += 1
        source['selected_patch_count'] = count
        sources.append(source)
    return np.asarray(patches), records, sources


def face_pool(data):
    """Select distributed crack interiors, excluding water and broad edges."""
    patches, originals, records, sources = [], [], [], []
    patch = 40
    sections = sorted(data.glob('hills/*/native.png')) + sorted(data.glob('coast/*/native.png'))
    for path in sections:
        section = str(path.parent.relative_to(data))
        rgb, source = load(data, section)
        lum = rgb @ LUMA
        broad_rgb = gaussian_filter(rgb, (1.2, 1.2, 0))
        red = ((broad_rgb[..., 0] > broad_rgb[..., 1] + 14) &
               (broad_rgb[..., 0] > broad_rgb[..., 2] + 14))
        distance = distance_transform_edt(red)
        # Band energy chooses visible native cracks; luminance is never height.
        mid = gaussian_filter(lum, 1.2) - gaussian_filter(lum, 8)
        broad_lum = gaussian_filter(lum, 24)
        candidates = []
        for y in range(8, rgb.shape[0] - patch - 7, 8):
            for x in range(8, rgb.shape[1] - patch - 7, 8):
                sl = np.s_[y:y + patch, x:x + patch]
                local = mid[sl]
                quadrants = [local[:20, :20], local[:20, 20:], local[20:, :20], local[20:, 20:]]
                energy = float(local.std())
                if (distance[sl].min() < 6 or energy < 4.0 or
                        min(float(q.std()) for q in quadrants) < 1.8 or
                        float((lum[sl] < 12).mean()) > .025 or
                        not 28 < float(lum[sl].mean()) < 78):
                    continue
                candidates.append({'section': section, 'xy': [x, y], 'size': patch,
                                   'midband_rms': energy,
                                   'raw_mean_luminance': float(lum[sl].mean()),
                                   'minimum_distance_from_nonland': float(distance[sl].min())})
        candidates.sort(key=lambda r: (-r['midband_rms'], r['xy'][1], r['xy'][0]))
        selected = []
        for record in candidates:
            x, y = record['xy']
            if any(np.hypot(x - r['xy'][0], y - r['xy'][1]) < 24 for r in selected):
                continue
            selected.append(record)
            if len(selected) == 12:
                break
        # A shared scalar preserves native red/brown chroma and crack contrast.
        # The bounded broad correction is an authored appearance choice only.
        factor = np.clip(60 / np.maximum(broad_lum, 1), .85, 1.25)
        corrected = rgb * factor[..., None]
        for record in selected:
            x, y = record['xy']
            sl = np.s_[y:y + patch, x:x + patch]
            originals.append(rgb[sl].copy())
            patches.append(corrected[sl].copy())
            record['brightness_factor_range'] = [float(factor[sl].min()), float(factor[sl].max())]
            records.append(record)
        source.update(eligible_patch_count=len(candidates), selected_patch_count=len(selected))
        sources.append(source)
    if len(patches) < 24:
        raise ValueError('too few safe native Red Planet cracked face interiors')
    return np.asarray(patches), records, originals, sources


def shallow_pool(data):
    patches, records, sources = [], [], []
    patch = 24
    for path in sorted(data.glob('coast/*/native.png')):
        section = str(path.parent.relative_to(data))
        rgb, source = load(data, section)
        broad = gaussian_filter(rgb, (2, 2, 0))
        # Native purple is separate from both the red land and deep indigo.
        purple = ((broad[..., 0] > 65) & (broad[..., 0] > broad[..., 1] + 18) &
                  (broad[..., 2] > broad[..., 0] + 14) & (broad[..., 2] > broad[..., 1] + 40))
        distance = distance_transform_edt(purple)
        candidates = []
        for y in range(0, rgb.shape[0] - patch + 1, 8):
            for x in range(0, rgb.shape[1] - patch + 1, 8):
                sl = np.s_[y:y + patch, x:x + patch]
                separation = float(distance[sl].min())
                raw = rgb[sl]
                if separation < 7 or np.any(raw[..., 0] > raw[..., 2] + 8):
                    continue
                candidates.append({'section': section, 'xy': [x, y], 'size': patch,
                                   'minimum_distance_from_nonshallow': separation})
        candidates.sort(key=lambda r: (-r['minimum_distance_from_nonshallow'], r['xy'][1], r['xy'][0]))
        selected = []
        for record in candidates:
            x, y = record['xy']
            if any(np.hypot(x - r['xy'][0], y - r['xy'][1]) < 16 for r in selected):
                continue
            selected.append(record)
            patches.append(rgb[y:y + patch, x:x + patch].copy())
            records.append(record)
            if len(selected) == 16:
                break
        source.update(eligible_patch_count=len(candidates), selected_patch_count=len(selected))
        sources.append(source)
    if len(patches) < 16:
        raise ValueError('no sufficiently broad safe native purple shallow-water pool')
    return np.asarray(patches), records, sources


def contact(out, ground, slope, rock, water, shallow, ground_patches, face_raw, shallow_patches):
    board = Image.new('RGB', (1536, 1136), (25, 21, 22))
    draw = ImageDraw.Draw(board)
    for x, label, array in [(0, 'ground quilt: native scale / 96px context', ground),
                             (512, 'cracked slope: native scale / 40px interiors', slope),
                             (1024, 'cracked rock: 256px tile repeated', np.tile(rock, (2, 2, 1)))]:
        draw.text((x + 6, 8), label, fill='white')
        board.paste(Image.fromarray(np.rint(array).clip(0, 255).astype(np.uint8)), (x, 28))
    for x, label, array in [(0, 'unchanged deep native tile', water),
                             (256, 'safe purple shallow quilt', shallow)]:
        draw.text((x + 6, 560), label, fill='white')
        board.paste(Image.fromarray(np.rint(array).clip(0, 255).astype(np.uint8)), (x, 580))
    draw.text((520, 560), 'unaltered native face interiors (before bounded compensation)', fill='white')
    for i, array in enumerate(face_raw[:132]):
        board.paste(Image.fromarray(array.astype(np.uint8)), (520 + (i % 22) * 44, 580 + (i // 22) * 44))
    draw.text((6, 856), 'unaltered ground interiors', fill='white')
    for i, array in enumerate(ground_patches[::18][:6]):
        board.paste(Image.fromarray(array.astype(np.uint8)), (i * 100, 880))
    draw.text((620, 856), 'unaltered purple shallow interiors', fill='white')
    for i, array in enumerate(shallow_patches[::max(1, len(shallow_patches) // 96)][:96]):
        board.paste(Image.fromarray(array.astype(np.uint8)), (620 + (i % 32) * 28, 880 + (i // 32) * 28))
    board.save(out / 'material-contact.png')


def prepare_structured_red_assets(out: Path, data: Path = DEFAULT_DATA) -> dict:
    """Optional connected crack comparison; leave baseline outputs untouched."""
    start = time.perf_counter()
    out, data = Path(out), Path(data)
    out.mkdir(parents=True, exist_ok=True)
    patch, overlap = 64, 24
    patches, records, sources = [], [], []
    for path in sorted(data.glob('coast/*/native.png')):
        section = str(path.parent.relative_to(data))
        rgb, source = load(data, section)
        lum = rgb @ LUMA
        broad = gaussian_filter(rgb, (3, 3, 0))
        # A broad hue mask admits dark native cracks while excluding water.
        land = ((broad[..., 0] > broad[..., 2] + 8) &
                (broad[..., 0] > broad[..., 1] + 8))
        distance = distance_transform_edt(land)
        mid = gaussian_filter(lum, 1.2) - gaussian_filter(lum, 8)
        candidates = []
        for y in range(8, rgb.shape[0] - patch - 7, 8):
            for x in range(8, rgb.shape[1] - patch - 7, 8):
                sl = np.s_[y:y + patch, x:x + patch]
                raw, local = rgb[sl], mid[sl]
                quadrants = [local[:32, :32], local[:32, 32:], local[32:, :32], local[32:, 32:]]
                energy = float(local.std())
                quadrant_energy = min(float(q.std()) for q in quadrants)
                crack_fraction = min(float((q < -5).mean()) for q in quadrants)
                if (distance[sl].min() < 8 or energy < 9.2 or quadrant_energy < 5 or
                        crack_fraction < .12 or float((lum[sl] < 10).mean()) > .06 or
                        np.any(raw[..., 2] > raw[..., 0] + 8)):
                    continue
                candidates.append({'section': section, 'xy': [x, y], 'size': patch,
                                   'midband_rms': energy, 'minimum_quadrant_rms': quadrant_energy,
                                   'minimum_quadrant_crack_fraction': crack_fraction,
                                   'minimum_distance_from_nonland': float(distance[sl].min()),
                                   'raw_mean_luminance': float(lum[sl].mean())})
        candidates.sort(key=lambda r: (-r['midband_rms'], r['xy'][1], r['xy'][0]))
        selected = []
        for record in candidates:
            x, y = record['xy']
            if any(np.hypot(x - r['xy'][0], y - r['xy'][1]) < 32 for r in selected):
                continue
            selected.append(record)
            patches.append(rgb[y:y + patch, x:x + patch].copy())
            records.append(record)
            if len(selected) == 8:
                break
        source.update(eligible_patch_count=len(candidates), selected_patch_count=len(selected))
        sources.append(source)
    if len(patches) < 16:
        raise ValueError('too few connected native Red Planet crack interiors for optional variant')
    pool = np.asarray(patches)
    outputs = {}
    for role, size, seed in [('slope', 512, SEED + 11), ('rock', 256, SEED + 12)]:
        tile, placements = quilt(pool, size=size, patch=patch, overlap=overlap, seed=seed)
        name = 'red-' + role + '-structured'
        save(out / (name + '.png'), tile)
        actual = np.asarray(Image.open(out / (name + '.png')))
        used = [p['source_patch'] for p in placements['placements']]
        outputs[role] = {'path': str(out / (name + '.png')),
                         'texture': '/sculpt-assets/' + name + '.png',
                         'meanRGB': actual.mean(axis=(0, 1)).tolist(),
                         'sha256': digest(out / (name + '.png')), 'quilt': placements,
                         'unique_placed_patches': len(set(used)),
                         'placement_weighted_midband_rms': float(np.mean([records[i]['midband_rms'] for i in used]))}
    baseline = {}
    if (out / 'materials.json').exists():
        old = json.loads((out / 'materials.json').read_text())['faces']
        for role in ['slope', 'rock']:
            used = [p['source_patch'] for p in old[role + '_quilt']['placements']]
            baseline[role] = {'unique_placed_patches': len(set(used)),
                              'placement_weighted_midband_rms': float(np.mean([old['patches'][i]['midband_rms'] for i in used]))}
    board = Image.new('RGB', (1536, 1112), (25, 21, 22))
    draw = ImageDraw.Draw(board)
    panels = [(512, 'optional slope: native scale / 64px crack interiors', out / 'red-slope-structured.png'),
              (1024, 'optional rock: 256px tile repeated at native scale', out / 'red-rock-structured.png')]
    if (out / 'red-slope.png').exists():
        panels.insert(0, (0, 'baseline slope: native scale / 40px interiors', out / 'red-slope.png'))
    for x, label, path in panels:
        actual = np.asarray(Image.open(path))
        if actual.shape[0] == 256:
            actual = np.tile(actual, (2, 2, 1))
        board.paste(Image.fromarray(actual), (x, 28))
        draw.text((x + 6, 8), label, fill='white')
    draw.text((6, 558), 'selected native 64px interiors: unchanged RGB, no scaling or contrast change', fill='white')
    for i, native in enumerate(patches[:176]):
        board.paste(Image.fromarray(native.astype(np.uint8)), ((i % 22) * 68, 582 + (i // 22) * 68))
    board.save(out / 'structured-material-contact.png')
    report = {'outputs': outputs, 'sources': sources, 'pool_count': len(records), 'patches': records,
              'baseline_placement_comparison': baseline,
              'parameters': {'patch_size': patch, 'overlap': overlap, 'minimum_midband_rms': 9.2,
                             'minimum_quadrant_rms': 5, 'minimum_quadrant_crack_fraction': .12,
                             'treatment': 'unchanged native RGB, translations and binary cuts only'},
              'generation_seconds': time.perf_counter() - start,
              'limits': ['Optional appearance comparison; baseline outputs and config are unchanged.',
                         '64px coast interiors retain connected facets and baked illumination, not complete banks or hills.',
                         'No new noise, recoloring, brightness correction, contrast amplification or height inference.',
                         'Stronger texture alone cannot establish native quality in the rendered geometry.']}
    (out / 'structured-materials.json').write_text(json.dumps(report, indent=2) + '\n')
    return outputs


def prepare_red_assets(out: Path, data: Path = DEFAULT_DATA) -> dict:
    start = time.perf_counter()
    out, data = Path(out), Path(data)
    out.mkdir(parents=True, exist_ok=True)
    palette = np.fromfile(PALETTE, np.uint8).reshape(256, 4)[:, :3]
    ground_patches, ground_records, ground_sources = ground_pool(data)
    face_patches, face_records, face_raw, face_sources = face_pool(data)
    shallow_patches, shallow_records, shallow_sources = shallow_pool(data)
    ground, ground_quilt = quilt(ground_patches, size=512, patch=96, overlap=32, seed=SEED)
    slope, slope_quilt = quilt(face_patches, size=512, patch=40, overlap=16, seed=SEED + 1)
    rock, rock_quilt = quilt(face_patches, size=256, patch=40, overlap=16, seed=SEED + 2)
    shallow, shallow_quilt = quilt(shallow_patches, size=256, patch=24, overlap=10, seed=SEED + 3)
    water, water_source = load(data, 'flat/marsflatwtr01')
    arrays = {'red-ground': ground, 'red-slope': slope, 'red-rock': rock,
              'red-water': water, 'red-water-shallow': shallow,
              'noise-ridged-gaussian': noise_texture('ridged-gaussian'),
              'palette-lut': palette_lut(palette)}
    for name, array in arrays.items():
        save(out / (name + '.png'), array)
    # Means describe the actual byte textures that the renderer samples.
    actual = {name: np.asarray(Image.open(out / (name + '.png'))) for name in arrays}
    mean = lambda name: actual[name].mean(axis=(0, 1)).tolist()
    config = {
        'biome': 'Red Planet', 'biomeId': 'red',
        'textures': {key: '/sculpt-assets/' + name + '.png' for key, name in [
            ('grass', 'red-ground'), ('slopeGrass', 'red-slope'),
            ('rock', 'red-rock'), ('hillRock', 'red-rock'),
            ('rockWeathered', 'red-rock'), ('rockFractured', 'red-rock'),
            ('water', 'red-water'), ('waterShallow', 'red-water-shallow'),
            ('noise', 'noise-ridged-gaussian'), ('palette', 'palette-lut')]},
        'material': {'rockSlope': .96, 'rockFeather': .48, 'rockCurvature': .28,
                     'wetBand': 13, 'shallowDepth': 2, 'deepDepth': 42,
                     'grassDetail': 1., 'rockDetail': 1., 'waterDetail': 1.,
                     'rockMeanRGB': mean('red-rock'), 'hillRockMeanRGB': mean('red-rock')},
        'water': {'meanRGB': mean('red-water'), 'deepRGB': mean('red-water'),
                  'shallowRGB': mean('red-water-shallow'),
                  'shallowMeanRGB': mean('red-water-shallow'),
                  'mean': (actual['red-water'].mean(axis=(0, 1)) / 255).tolist(),
                  'grainRGB': [1., 1., 1.]},
        'noise': {'variant': 'ridged-gaussian', 'size': 512,
                  'channels': ['broad', 'mid', 'ridged-gaussian', 'fine']},
        'palette': {'size': 32, 'imageSize': [1024, 32], 'excludedExactBlack': True},
    }
    contact(out, actual['red-ground'], actual['red-slope'], actual['red-rock'],
            actual['red-water'], actual['red-water-shallow'], ground_patches, face_raw, shallow_patches)
    provenance = {
        'config': config, 'generation_seconds': time.perf_counter() - start,
        'palette': {'path': str(PALETTE), 'sha256': digest(PALETTE),
                    'scope': 'shared universal palette only; no Green Planet source images'},
        'ground': {'sources': ground_sources, 'pool_count': len(ground_records),
                   'patches': ground_records, 'quilt': ground_quilt,
                   'treatment': 'unaltered 96px RGB interiors; translations and binary cuts only'},
        'faces': {'sources': face_sources, 'pool_count': len(face_records), 'patches': face_records,
                  'slope_quilt': slope_quilt, 'rock_quilt': rock_quilt,
                  'treatment': {'patch_size': 40, 'overlap': 16, 'broad_luminance_sigma': 24,
                                'reference_luminance': 60, 'scalar_factor_clamp': [.85, 1.25],
                                'rotations': False, 'scaling': False, 'generated_detail': False}},
        'water': {'source': water_source, 'treatment': 'unchanged native flat deep-water tile'},
        'shallow': {'sources': shallow_sources, 'pool_count': len(shallow_records),
                    'patches': shallow_records, 'quilt': shallow_quilt,
                    'treatment': 'unaltered purple interiors; translations and binary cuts only'},
        'output_sha256': {name: digest(out / (name + '.png')) for name in arrays},
        'limits': ['Appearance proxies are not recovered physical albedo; local native lighting remains baked.',
                   'Brightness is not used as height. Complete hill/coast sections never enter new geometry.',
                   'Ground and water remain unaltered; face brightness compensation is an authored appearance choice.',
                   'Rock, hillRock, weathered and fractured alias one native cracked family; no unsupported separate mineral claim.',
                   'Material thresholds and water depth curves are prototype choices, not retail formulas.'],
    }
    (out / 'materials.json').write_text(json.dumps(provenance, indent=2) + '\n')
    return config


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--data', type=Path, default=DEFAULT_DATA)
    parser.add_argument('--structured-only', action='store_true', help='prepare optional stronger faces without changing baseline assets')
    args = parser.parse_args()
    prepare = prepare_structured_red_assets if args.structured_only else prepare_red_assets
    print(json.dumps(prepare(args.out, args.data), indent=2))
