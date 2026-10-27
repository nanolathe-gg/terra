"""Load retail maps exported by tools/neural-terrain/export (one directory per
map: metadata.json, heights.bin, map-indexed.bin, palette-rgb.bin) and crop
them for the Lava band and finger-coast measurements (lava_bands.py,
lava_coasts.py). The exports and every crop stay outside Git.

    python lava_maps.py crop MAPDIR X Y [SIZE] [ZOOM] OUT.png
    python lava_maps.py list ROOT

TA draws a world point (x, y, h) at screen row y - h/2, so the art is in
screen space; lava_world.py resamples it into world space.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

LUMA = np.array([.299, .587, .114])


class RetailMap:
    def __init__(self, root):
        self.root = Path(root)
        md = json.loads((self.root / 'metadata.json').read_text())
        self.meta = md
        self.name = md['name']
        self.W, self.H = md['width'], md['height']
        self.sea = md['sea_level']
        self.idx = np.fromfile(self.root / 'map-indexed.bin', np.uint8).reshape(self.H, self.W)
        self.palette = np.fromfile(self.root / 'palette-rgb.bin', np.uint8).reshape(256, 3)
        self.cells = np.fromfile(self.root / 'heights.bin', np.uint8).reshape(
            md['cell_height'], md['cell_width']).astype(np.int32)

    @property
    def rgb(self):
        return self.palette[self.idx]

    @property
    def lum_table(self):
        return self.palette.astype(np.float32) @ LUMA


class OurMap(RetailMap):
    """A sculpt-page capture (PNG + heights.json from lava_strokes.mjs or
    capture.mjs scenes with heights) in the RetailMap shape: art mapped to
    the TA palette (the renderer quantizes to it), heights averaged into
    16-px cells like a retail map's, measured from the page's base height
    (the renderer projects (h - base) / 2)."""

    def __init__(self, stem, palette_from):
        stem = str(stem)
        self.name = Path(stem).name
        self.palette = np.fromfile(Path(palette_from) / 'palette-rgb.bin', np.uint8).reshape(256, 3)
        rgb = np.asarray(Image.open(stem + '.png').convert('RGB')).astype(np.int32)
        d = json.loads(Path(stem + '.heights.json').read_text())
        self.H, self.W = rgb.shape[:2]
        pal = self.palette.astype(np.int32)
        flat = (rgb[..., 0] << 16) | (rgb[..., 1] << 8) | rgb[..., 2]
        u, inv = np.unique(flat, return_inverse=True)
        ur = np.stack([u >> 16, (u >> 8) & 255, u & 255], 1)
        nearest = np.argmin(((ur[:, None, :] - pal[None]) ** 2).sum(-1), 1)
        self.idx = nearest[inv].reshape(self.H, self.W).astype(np.uint8)
        g = d['grid']
        h = np.asarray(d['heights'], np.float32).reshape(g, g) - d['base']
        from scipy.ndimage import zoom
        full = zoom(h, self.W / g, order=1)[:self.H, :self.W]
        n = self.W // 16
        self.cells = full[:n * 16, :n * 16].reshape(n, 16, n, 16).mean(axis=(1, 3))
        self.sea = d['sea'] - d['base']
        self.meta = dict(name=self.name, width=self.W, height=self.H, sea_level=self.sea)


def crop(mapdir, x, y, size=400, zoom=1, out=None):
    m = RetailMap(mapdir)
    img = Image.fromarray(m.rgb[y:y + size, x:x + size])
    if zoom != 1:
        img = img.resize((img.width * zoom, img.height * zoom), Image.NEAREST)
    img.save(out)


def main(argv):
    if argv[0] == 'crop':
        mapdir, x, y = argv[1], int(argv[2]), int(argv[3])
        size = int(argv[4]) if len(argv) > 5 else 400
        zoom = int(argv[5]) if len(argv) > 6 else 1
        crop(mapdir, x, y, size, zoom, argv[-1])
    elif argv[0] == 'list':
        for md in sorted(Path(argv[1]).glob('*/metadata.json')):
            m = json.loads(md.read_text())
            print(md.parent.name, m['width'], m['height'], 'sea', m['sea_level'])


if __name__ == '__main__':
    main(sys.argv[1:])
