"""Makes materials/fractures.png, the crack field every world draws (card H14e: committed, because it is ours and its port to startup
is the Fractures card's). A dev tool: `make_fractures.py --out DIR`, then copy DIR/fractures.png to materials/.

Sparse finite fracture groups for the optional sculpting appearance layer.

Wholly authored line geometry, not recovered geology or a retail algorithm.
No terrain, native brightness or artwork is read. The shader owns dry-slope
admission, crack width and carving depth; this field only supplies distances
and group attributes independently of the existing surface roughness.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import time

import numpy as np
from PIL import Image, ImageDraw


SIZE = 1024
SEED = 64178243 + 461
GROUPS = 160
SUPPORT = 8.0
CLEARANCE = 18.0


def _point_distance(p, a, b):
    dx, dy = b[0]-a[0], b[1]-a[1]
    t = max(0., min(1., ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)))
    return math.hypot(p[0]-a[0]-t*dx, p[1]-a[1]-t*dy)


def _segment_distance(a, b, c, d):
    ax, ay, bx, by = b[0]-a[0], b[1]-a[1], d[0]-c[0], d[1]-c[1]
    denominator = ax*by-ay*bx
    if abs(denominator) > 1e-10:
        cx, cy = c[0]-a[0], c[1]-a[1]
        t, u = (cx*by-cy*bx)/denominator, (cx*ay-cy*ax)/denominator
        if 0 <= t <= 1 and 0 <= u <= 1:
            return 0.
    return min(_point_distance(a, c, d), _point_distance(b, c, d),
               _point_distance(c, a, b), _point_distance(d, a, b))


def _pairs(path):
    return list(zip(path[:-1], path[1:]))


def _candidate(rng):
    centre = rng.uniform(0, SIZE, 2)
    heading = float(rng.uniform(0, 2*math.pi))
    length = float(rng.uniform(12, 45))
    count = int(rng.integers(2, 5))
    fractions = rng.uniform(.7, 1.3, count)
    fractions /= fractions.sum()
    start = centre - .5*length*np.array([math.cos(heading), math.sin(heading)])
    main = [start.tolist()]
    bend = 0.
    for part in fractions:
        bend = float(np.clip(.45*bend+rng.uniform(-.42, .42), -.55, .55))
        angle = heading+bend
        main.append([main[-1][0]+length*part*math.cos(angle),
                     main[-1][1]+length*part*math.sin(angle)])
    branches = []
    if rng.random() < .30:
        # A fork shares an actual main vertex and the whole group's attributes.
        junction = int(rng.integers(1, len(main)-1))
        angle = math.atan2(main[junction][1]-main[junction-1][1],
                           main[junction][0]-main[junction-1][0])
        angle += float(rng.choice([-1, 1]))*float(rng.uniform(.68, 1.23))
        branch_length = float(rng.uniform(6, 20))
        branch = [main[junction].copy()]
        for part in (.55, .45):
            branch.append([branch[-1][0]+part*branch_length*math.cos(angle),
                           branch[-1][1]+part*branch_length*math.sin(angle)])
            angle += float(rng.uniform(-.25, .25))
        nonincident = [(a, b) for a, b in _pairs(main)
                       if a != main[junction] and b != main[junction]]
        if all(_segment_distance(a, b, c, d) > .5
               for a, b in _pairs(branch) for c, d in nonincident):
            branches.append(branch)
    segments = [segment for path in [main, *branches] for segment in _pairs(path)]
    radius = max(math.hypot(p[0]-centre[0], p[1]-centre[1])
                 for path in [main, *branches] for p in path)
    return {'centre': centre.tolist(), 'radius': radius, 'main': main,
            'branches': branches, 'segments': segments,
            'main_length': length, 'depth': float(rng.uniform(.48, .90))}


def _separate(candidate, accepted):
    cx, cy = candidate['centre']
    for previous in accepted:
        px, py = previous['centre']
        sx, sy = round((cx-px)/SIZE)*SIZE, round((cy-py)/SIZE)*SIZE
        if math.hypot(cx-px-sx, cy-py-sy) >= candidate['radius']+previous['radius']+CLEARANCE:
            continue
        for a, b in candidate['segments']:
            for c, d in previous['segments']:
                if _segment_distance(a, b, [c[0]+sx, c[1]+sy],
                                      [d[0]+sx, d[1]+sy]) < CLEARANCE:
                    return False
    return True


def _raster_segment(distance, owner, a, b, group):
    # Repeated geometry, rather than averaged borders, supplies toroidal support.
    # All coordinates denote world units; texel samples sit at x+.5,y+.5.
    for sy in (-SIZE, 0, SIZE):
        for sx in (-SIZE, 0, SIZE):
            ax, ay, bx, by = a[0]+sx, a[1]+sy, b[0]+sx, b[1]+sy
            x0, x1 = max(0, math.floor(min(ax, bx)-SUPPORT)), min(SIZE, math.ceil(max(ax, bx)+SUPPORT)+1)
            y0, y1 = max(0, math.floor(min(ay, by)-SUPPORT)), min(SIZE, math.ceil(max(ay, by)+SUPPORT)+1)
            if x0 >= x1 or y0 >= y1:
                continue
            yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float64)
            xx += .5; yy += .5
            dx, dy = bx-ax, by-ay
            t = np.clip(((xx-ax)*dx+(yy-ay)*dy)/(dx*dx+dy*dy), 0, 1)
            local = np.hypot(xx-ax-t*dx, yy-ay-t*dy)
            old = distance[y0:y1, x0:x1]
            take = local < old
            old[take] = local[take]
            owner[y0:y1, x0:x1][take] = group


def _preview(distance, owner, groups, density):
    image = np.full((SIZE, SIZE, 3), [171, 175, 167], np.uint8)
    priorities = np.array([g['priority_byte'] for g in groups]+[255])
    active = (owner >= 0) & (priorities[owner] <= density*255)
    # A native-resolution one-pixel-scale threshold, not extra height or albedo.
    coverage = (1-np.clip((distance-.35)/.55, 0, 1))*active
    image = image.astype(np.float32)*(1-coverage[..., None]) + np.array([36, 40, 35])*coverage[..., None]
    return Image.fromarray(np.rint(image).clip(0, 255).astype(np.uint8))


def make_fracture_field(out: Path) -> dict:
    start = time.perf_counter()
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED)
    groups = []
    attempts = 0
    while len(groups) < GROUPS and attempts < 12000:
        attempts += 1
        candidate = _candidate(rng)
        if _separate(candidate, groups):
            groups.append(candidate)
    if len(groups) != GROUPS:
        raise ValueError('could not place the bounded finite fracture groups')
    # Balanced priorities select complete groups instead of fading every line.
    priorities = rng.permutation(np.rint(np.linspace(1, 254, GROUPS)).astype(np.uint8))
    distance = np.full((SIZE, SIZE), SUPPORT, np.float32)
    owner = np.full((SIZE, SIZE), -1, np.int16)
    for i, group in enumerate(groups):
        group['priority_byte'] = int(priorities[i])
        group['depth_byte'] = int(round(group['depth']*255))
        for a, b in group['segments']:
            _raster_segment(distance, owner, a, b, i)
    rgba = np.empty((SIZE, SIZE, 4), np.uint8)
    rgba[..., 0] = np.rint((1-distance/SUPPORT)*255).clip(0, 255).astype(np.uint8)
    rgba[..., 1] = np.array([g['priority_byte'] for g in groups]+[255], np.uint8)[owner]
    rgba[..., 2] = np.array([g['depth_byte'] for g in groups]+[102], np.uint8)[owner]
    rgba[..., 3] = 255
    path = out/'fractures.png'
    Image.fromarray(rgba).save(path)
    Image.fromarray(rgba[..., 0]).save(out/'fractures-distance.png')
    thin = _preview(distance, owner, groups, 1.)
    thin.save(out/'fractures-thin.png')
    # Contact panels retain one output pixel per world texel. Inspect a fork
    # and independent groups, then a wrapped edge, without enlarging the cracks.
    fork = next(g for g in groups if g['branches'])
    origin = [int(fork['centre'][0])-128, int(fork['centre'][1])-128]
    xs, ys = (np.arange(256)+origin[0]) % SIZE, (np.arange(256)+origin[1]) % SIZE
    board = Image.new('RGB', (1024, 576), (24, 27, 23)); draw = ImageDraw.Draw(board)
    panels = [('R: distance support', Image.fromarray(rgba[..., 0]).convert('RGB'))]
    panels += [(f'density {density:.0%}', _preview(distance, owner, groups, density)) for density in (.25, .5, 1.)]
    for j, (label, image) in enumerate(panels):
        crop = np.asarray(image)[ys[:, None], xs[None, :]]
        board.paste(Image.fromarray(crop), (j*256, 24)); draw.text((j*256+6, 5), label, fill='white')
    for j, (x, y) in enumerate([(0, 0), (384, 384), (768, 768), (SIZE-128, SIZE-128)]):
        xx, yy = (np.arange(256)+x) % SIZE, (np.arange(256)+y) % SIZE
        board.paste(Image.fromarray(np.asarray(thin)[yy[:, None], xx[None, :]]), (j*256, 312))
        draw.text((j*256+6, 292), f'native 256 crop: {x},{y}', fill='white')
    board.save(out/'fractures-contact.png')
    metadata = {
        'path': str(path.resolve()), 'size': SIZE, 'image_size': [SIZE, SIZE], 'seed': SEED,
        'world_units_per_texel': 1, 'texel_centres': 'x+.5,y+.5',
        'group_count': len(groups), 'forked_groups': sum(bool(g['branches']) for g in groups),
        'periodic': True, 'sampling': 'linear repeat; numeric channels, no sRGB conversion',
        'channels': {'R': 'normalized 1-distance/8, zero at distance>=8 world units',
                     'G': 'constant group priority; activate whole groups when G<=density',
                     'B': 'constant group depth multiplier, in [0.4,1]', 'A': '255'},
        'authored_ranges': {'main_length': [12, 45], 'branch_length': [6, 20],
                            'group_clearance': CLEARANCE, 'distance_support': SUPPORT},
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'contact': str((out/'fractures-contact.png').resolve()),
        'provenance': str((out/'fractures-provenance.json').resolve()),
        'limits': ['Authored finite paths, not historical or recovered fracture geometry.',
                   'Density is sparse; a particular small hill may expose no group.',
                   'Dry-slope admission, thin width and restrained carving are shader responsibilities.']}
    provenance = {'metadata': metadata, 'generation_seconds': time.perf_counter()-start,
                  'placement_attempts': attempts, 'contact_origin_xy': origin,
                  'geometry': [{k: v for k, v in g.items() if k != 'segments'} for g in groups]}
    (out/'fractures-provenance.json').write_text(json.dumps(provenance, indent=2)+'\n')
    return metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(make_fracture_field(args.out), indent=2))
