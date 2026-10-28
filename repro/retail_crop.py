"""Cut a 1024-px window out of a retail map (or take a section) for a
reproduction: the picture, its heights, and a relief guide to place strokes.

  retail_crop.py map <export-dir> <x> <y> <out-dir> [--size 1024]
  retail_crop.py section <art.png> <heights.png> <out-dir> [--sea <units>]

<export-dir> is one map from tools/neural-terrain/export (map-indexed.bin,
heights.bin, palette-rgb.bin, metadata.json); x and y are the window's
top-left in map pixels, multiples of 16. Writes retail.png, heights.npy
(heights above the map's sea level, one per 16 px cell, world coordinates),
relief.png (shaded heights with contours and a 128-px labelled grid) and
crop.json. Nothing here goes into git: the outputs are retail pixels.

The picture is in screen space and the heights in world space: retail draws a
cell at screenY = worldY - height/2, the editor at worldY - (height - base)/2,
and a scene maps the retail plain to the editor's base. So retail.png starts
(sea + plain)/2 rows above the window (screen_offset in crop.json), which
puts retail level ground where ours renders; rows above the map are black.
--plain is the plain's height above sea (default: the window's dry median).
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def upsample(cells, size):
    """Heights per 16-px cell to one per pixel, bilinear between centres."""
    n = cells.shape[0]
    coords = (np.arange(size) + 0.5) / 16 - 0.5
    i = np.clip(np.floor(coords).astype(int), 0, n - 1)
    j = np.clip(i + 1, 0, n - 1)
    t = np.clip(coords - i, 0, 1)
    rows = cells[i] * (1 - t)[:, None] + cells[j] * t[:, None]
    return rows[:, i] * (1 - t)[None, :] + rows[:, j] * t[None, :]


def relief(h, title=''):
    """Shaded heights (world coordinates, heights above sea) with contours
    every 8 units, thick every 32, water blue and a labelled 128-px grid."""
    size = h.shape[0]
    gy, gx = np.gradient(h)
    shade = np.clip(0.75 + (-gx * 0.7 + gy * 0.3) * 0.25, 0.35, 1.25)
    land = np.clip(h / 120, 0, 1)
    rgb = np.stack([110 + 110 * land, 150 + 60 * land, 90 + 90 * land], -1) * shade[..., None]
    water = h < 0
    depth = np.clip(-h / 60, 0, 1)
    rgb[water] = np.stack([60 - 30 * depth, 110 - 50 * depth, 220 - 60 * depth], -1)[water]
    for step, ink in ((8, 0.72), (32, 0.35)):
        band = np.floor(h / step)
        edge = (band != np.roll(band, 1, 0)) | (band != np.roll(band, 1, 1))
        rgb[edge] *= ink
    sea = (h < 0) != (np.roll(h, 1, 0) < 0)
    rgb[sea] = (255, 255, 255)
    im = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    for k in range(0, size + 1, 128):
        d.line([(k, 0), (k, size)], fill=(255, 0, 255), width=1)
        d.line([(0, k), (size, k)], fill=(255, 0, 255), width=1)
        for m in range(0, size, 128):
            d.text((k + 2, m + 2), f'{k},{m}', fill=(255, 255, 255))
    if title:
        d.text((4, size - 14), title, fill=(255, 255, 0))
    return im


def plain_of(cut, plain):
    dry = cut[cut >= 0]
    return float(plain if plain is not None else np.median(dry) if dry.size else 0)


def screen_rows(pic, top, size, colour=lambda rows: rows):
    """Rows top..top+size of a screen-space picture, black outside it."""
    out = np.zeros((size, pic.shape[1], 3), np.uint8)
    a, b = max(top, 0), min(top + size, pic.shape[0])
    if b > a:
        out[a - top:b - top] = colour(np.asarray(pic[a:b]))
    return out


def from_map(args):
    src = Path(args.export)
    meta = json.loads((src / 'metadata.json').read_text())
    w, h, size = meta['width'], meta['height'], args.size
    x, y = args.x - args.x % 16, args.y - args.y % 16
    if x + size > w or y + size > h:
        raise SystemExit(f'window {x},{y}+{size} outside the {w}x{h} map')
    cells = np.fromfile(src / 'heights.bin', np.uint8).reshape(meta['cell_height'], meta['cell_width'])
    cut = cells[y // 16:(y + size) // 16, x // 16:(x + size) // 16].astype(float) - meta['sea_level']
    plain = plain_of(cut, args.plain)
    off = round((meta['sea_level'] + plain) / 2)
    pal = np.fromfile(src / 'palette-rgb.bin', np.uint8).reshape(256, 3)
    idx = np.memmap(src / 'map-indexed.bin', np.uint8, 'r', shape=(h, w))
    pic = screen_rows(idx[:, x:x + size], y - off, size, lambda rows: pal[rows])
    return pic, cut, {'map': meta['name'], 'planet': meta['planet'], 'export': str(src), 'x': x, 'y': y, 'size': size,
                      'sea_level': meta['sea_level'], 'plain': plain, 'screen_offset': off}


def from_section(args):
    art = np.asarray(Image.open(args.art).convert('RGB'))
    cut = np.asarray(Image.open(args.heights)).astype(float) - args.sea
    plain = plain_of(cut, args.plain)
    off = round((args.sea + plain) / 2)
    return screen_rows(art, -off, art.shape[0]), cut, {'section': str(args.art), 'heights': str(args.heights), 'size': art.shape[0],
                                                       'sea_level': args.sea, 'plain': plain, 'screen_offset': off}


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='mode', required=True)
    m = sub.add_parser('map')
    m.add_argument('export'); m.add_argument('x', type=int); m.add_argument('y', type=int); m.add_argument('out')
    m.add_argument('--size', type=int, default=1024)
    s = sub.add_parser('section')
    s.add_argument('art'); s.add_argument('heights'); s.add_argument('out')
    # Sections carry no sea level; read it off where the water pixels sit.
    s.add_argument('--sea', type=float, default=0)
    for p in (m, s):
        p.add_argument('--plain', type=float, help="the plain's height above sea that the scene maps to the editor's base")
    args = ap.parse_args()
    pic, cells, info = from_map(args) if args.mode == 'map' else from_section(args)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pic).save(out / 'retail.png')
    np.save(out / 'heights.npy', cells)
    hp = upsample(cells, pic.shape[0])
    relief(hp, 'retail heights above sea').save(out / 'relief.png')
    dry = cells[cells >= 0]
    info.update(cells_min=float(cells.min()), cells_max=float(cells.max()), water_share=float((cells < 0).mean()),
                dry_percentiles={p: float(np.percentile(dry, p)) for p in (5, 25, 50, 75, 95)} if dry.size else {})
    (out / 'crop.json').write_text(json.dumps(info, indent=1))
    print(json.dumps(info))


if __name__ == '__main__':
    main()
