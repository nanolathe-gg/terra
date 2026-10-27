"""Side-by-side sheets for a reproduction directory (retail_crop.py + render.mjs):
pair.png (retail | ours, full size) and layout.png (both height reliefs at half
size, to check the strokes follow the retail layout).

  pair.py <dir> [<dir> ...]
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from retail_crop import relief, upsample  # noqa: E402


def label(im, text):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 8 + 7 * len(text), 16], fill=(0, 0, 0))
    d.text((4, 2), text, fill=(255, 255, 255))
    return im


def sheet(images, gap=8):
    w = sum(i.width for i in images) + gap * (len(images) - 1)
    out = Image.new('RGB', (w, max(i.height for i in images)), (24, 24, 24))
    x = 0
    for i in images:
        out.paste(i, (x, 0)); x += i.width + gap
    return out


def main(folder):
    d = Path(folder)
    retail, ours = Image.open(d / 'retail.png').convert('RGB'), Image.open(d / 'ours.png').convert('RGB')
    if ours.size != retail.size:
        ours = ours.resize(retail.size, Image.LANCZOS)
    sheet([label(retail.copy(), 'retail'), label(ours.copy(), 'ours')]).save(d / 'pair.png')
    size = retail.width
    rh = upsample(np.load(d / 'heights.npy'), size)
    data = json.loads((d / 'ours-heights.json').read_text())
    g = data['grid']
    oh = np.asarray(data['heights'], float).reshape(g, g) - data['sea']
    oh = np.asarray(Image.fromarray(oh.astype(np.float32)).resize((size, size), Image.BILINEAR))
    half = (size // 2, size // 2)
    sheet([relief(rh, 'retail heights').resize(half, Image.LANCZOS), relief(oh, 'our heights').resize(half, Image.LANCZOS)]).save(d / 'layout.png')
    print(d / 'pair.png', d / 'layout.png')


if __name__ == '__main__':
    for f in sys.argv[1:]:
        main(f)
