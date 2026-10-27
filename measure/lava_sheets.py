"""Labelled side-by-side crops for the Lava band and finger-coast review:
retail on top at 1:1, ours below at the same scale (our world is 1024 px
across), plus 3x zooms. Retail pixels and the sheets stay outside Git.

    python lava_sheets.py RETAIL_ROOT OURS_ROOT OUT_DIR

OURS_ROOT holds the lava_strokes.mjs / capture.mjs scenes named below.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from lava_maps import RetailMap

S = 400


def retail(root, name, x, y, size=S):
    d = next(Path(root).glob(name + '-*'))
    return RetailMap(d).rgb[y:y + size, x:x + size]


def ours(root, stem, x, y, size=S):
    a = np.asarray(Image.open(Path(root) / (stem + '.png')).convert('RGB'))
    out = np.zeros((size, size, 3), np.uint8)
    c = a[y:y + size, x:x + size]
    out[:c.shape[0], :c.shape[1]] = c
    return out


def sheet(rows, out, zoom=1):
    h = max(len(r) for r in rows)
    tiles = [[t for t, _ in r] for r in rows]
    size = tiles[0][0].shape[0]
    canvas = np.zeros((len(rows) * size, h * size, 3), np.uint8)
    for i, r in enumerate(tiles):
        for j, t in enumerate(r):
            canvas[i * size:(i + 1) * size, j * size:(j + 1) * size] = t
    im = Image.fromarray(canvas)
    if zoom != 1:
        im = im.resize((im.width * zoom, im.height * zoom), Image.NEAREST)
    d = ImageDraw.Draw(im)
    for i, r in enumerate(rows):
        for j, (_, label) in enumerate(r):
            d.rectangle([j * size * zoom, i * size * zoom, j * size * zoom + 7 * len(label) + 6, i * size * zoom + 13],
                        fill=(0, 0, 0))
            d.text((j * size * zoom + 3, i * size * zoom + 2), label, fill=(255, 255, 0))
    im.save(out)


def main(rroot, oroot, outdir):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    # Contour bands on hill faces.
    sheet([[(retail(rroot, 'kill_the_middle', 1600, 1150), 'retail kill the middle 1600,1150'),
            (retail(rroot, 'lava_mania', 2750, 800), 'retail lava mania 2750,800'),
            (retail(rroot, 'red_hot_lava', 2150, 600), 'retail red hot lava 2150,600')],
           [(ours(oroot, 'd0', 180, 200), 'ours Lava defaults: mesa'),
            (ours(oroot, 'f-prop', 180, 200), 'ours proposed knobs: mesa'),
            (ours(oroot, 'f-prop', 380, 400), 'ours proposed knobs: gentle hill')]],
          outdir / 'sheet-bands.png')
    # Finger coasts.
    sheet([[(retail(rroot, 'lava_run', 1400, 150), 'retail lava run 1400,150'),
            (retail(rroot, 'red_hot_lava', 0, 300), 'retail red hot lava 0,300'),
            (retail(rroot, 'kill_the_middle', 2600, 2950), 'retail kill the middle 2600,2950')],
           [(ours(oroot, 'd0', 300, 624), 'ours deep stroke, Lava defaults'),
            (ours(oroot, 'coasts-b0', 250, 350), 'ours example=coasts'),
            (ours(oroot, 'f-prop', 300, 624), 'ours deep stroke, proposed knobs')]],
          outdir / 'sheet-coasts.png')
    # 3x zooms: a band, a waterline.
    z = 133
    sheet([[(retail(rroot, 'kill_the_middle', 1760, 1360, z), 'retail band 3x'),
            (retail(rroot, 'lava_run', 1560, 330, z), 'retail waterline 3x'),
            (retail(rroot, 'kill_the_middle', 2700, 3000, z), 'retail fingers 3x')],
           [(ours(oroot, 'f-prop', 520, 470, z), 'ours band (proposed) 3x'),
            (ours(oroot, 'd0', 420, 760, z), 'ours waterline 3x'),
            (ours(oroot, 'coasts-b0', 420, 560, z), 'ours fingers 3x')]],
          outdir / 'sheet-zoom3x.png', zoom=3)


if __name__ == '__main__':
    main(*sys.argv[1:4])
