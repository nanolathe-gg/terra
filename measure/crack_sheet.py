"""Side-by-side crop sheets, 2x nearest, with an optional line overlay.

  crack_sheet.py OUT.png SIZE COLS [--overlay] label=path@x,y ...

Each crop is SIZE x SIZE px of the image at (x, y), scaled 2x. With
--overlay every crop is followed by a copy with crack_lines' detected line
cores in magenta. `best(path_or_rgb, slope, size)` finds the window with the
most slope >= 0.4 ground, for picking crops.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crack_lines as cl  # noqa: E402


def best(slope, valid, size, lo=.4, hi=99.):
    m = (valid & (slope >= lo) & (slope < hi)).astype(np.float32)
    c = ndimage.uniform_filter(m, size, mode='constant')
    h = size // 2
    c[:h] = c[-h:] = 0
    c[:, :h] = c[:, -h:] = 0
    y, x = np.unravel_index(np.argmax(c), c.shape)
    return int(x - h), int(y - h), float(c[y, x])


def sheet(out, size, cols, items, overlay=False, scale=2):
    tiles = []
    for label, path, x, y in items:
        rgb = np.asarray(Image.open(path).convert('RGB'))
        crop = rgb[y:y + size, x:x + size]
        tiles.append((label, crop))
        if overlay:
            core = cl.lines(cl.luma(rgb))[0][y:y + size, x:x + size]
            ov = crop.copy()
            ov[core] = (255, 0, 255)
            tiles.append((label + ' lines', ov))
    w = size * scale + 6
    rows = (len(tiles) + cols - 1) // cols
    img = Image.new('RGB', (cols * w, rows * (w + 12)), (12, 12, 12))
    draw = ImageDraw.Draw(img)
    for k, (label, t) in enumerate(tiles):
        x, y = (k % cols) * w, (k // cols) * (w + 12)
        img.paste(Image.fromarray(t).resize((size * scale, size * scale), Image.NEAREST), (x, y + 14))
        draw.text((x + 3, y + 1), label, fill=(235, 235, 235))
    img.save(out)


if __name__ == '__main__':
    out, size, cols, *rest = sys.argv[1:]
    overlay = '--overlay' in rest
    items = []
    for tok in rest:
        if tok == '--overlay':
            continue
        label, spec = tok.split('=', 1)
        path, xy = spec.rsplit('@', 1)
        x, y = (int(v) for v in xy.split(','))
        items.append((label, path, x, y))
    sheet(out, int(size), int(cols), items, overlay)
