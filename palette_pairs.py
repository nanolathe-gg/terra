"""Palette lookup with two-entry mixes, for the TA palette stage.

Retail terrain art often shows a colour the palette lacks as a pixel-by-pixel
mix of two entries: Painted Desert's tans are 50/50 mixes of entry pairs
(measure/desert_palette.py), which nearest-colour quantization turns into a
single rose or olive entry. This writes a 1024x96 lookup over a 32^3 colour
cube (column r + 32 b, row g): rows 0-31 hold the nearest entry (the existing
palette-lut.png), rows 32-63 and 64-95 the best pair (A, B) for that colour.
The shader measures the mix along A-B per pixel and picks A or B against a
per-pixel threshold.

A pair is chosen in OKLab: the distance from the colour to the segment A-B,
plus a small penalty on mixing distant entries (weighted by how even the mix
is), so near colours are preferred where they serve.
"""
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

PALETTE = Path('/private/tmp/nanolathe-neural-terrain/editor-green-sections/palette.pal')


def oklab(rgb):
    """sRGB 0..255 to OKLab (Ottosson 2020)."""
    c = np.asarray(rgb, float) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
                   [0.2119034982, 0.6806995451, 0.1073969566],
                   [0.0883024619, 0.2817188376, 0.6299787005]])
    lms = np.cbrt(lin @ m1.T)
    m2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
                   [1.9779984951, -2.4285922050, 0.4505937099],
                   [0.0259040371, 0.7827717662, -0.8086757660]])
    return lms @ m2.T


def pair_lut(palette, neighbours=10, spread_penalty=0.1):
    usable = np.unique(palette[np.any(palette > 0, axis=1)], axis=0)
    y, x = np.indices((32, 1024))
    cube = (np.stack((x % 32, y, x // 32), axis=2) * 255 / 31).reshape(-1, 3)
    lab_e, lab_c = oklab(usable), oklab(cube)
    _, near = cKDTree(lab_e).query(lab_c, k=neighbours)
    best_err = np.full(len(cube), np.inf)
    best_a = near[:, 0].copy()
    best_b = near[:, 0].copy()
    for i in range(neighbours):
        for j in range(i, neighbours):
            a, b = lab_e[near[:, i]], lab_e[near[:, j]]
            d = b - a
            dd = np.maximum((d * d).sum(1), 1e-12)
            t = np.clip(((lab_c - a) * d).sum(1) / dd, 0, 1)
            p = a + d * t[:, None]
            err = ((lab_c - p) ** 2).sum(1) + spread_penalty * dd * t * (1 - t)
            better = err < best_err
            best_err[better] = err[better]
            best_a[better] = near[better, i]
            best_b[better] = near[better, j]
    _, nearest = cKDTree(usable.astype(float)).query(cube)
    rows = [usable[nearest], usable[best_a], usable[best_b]]
    return np.concatenate([r.reshape(32, 1024, 3) for r in rows], axis=0).astype(np.uint8)


def make_pair_lut(out, palette_path=PALETTE, name='palette-pairs.png'):
    palette = np.fromfile(palette_path, np.uint8).reshape(256, 4)[:, :3]
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pair_lut(palette)).save(out / name)
    return out / name


if __name__ == '__main__':
    import sys
    print(make_pair_lut(sys.argv[1] if len(sys.argv) > 1 else '.'))
