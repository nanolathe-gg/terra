"""sheet.py OUT COLS name=path@x0,y0,x1,y1 ... -> labelled 2x crop sheet."""
import sys
from PIL import Image, ImageDraw
out, cols, *items = sys.argv[1:]
cols = int(cols)
tiles = []
for item in items:
    name, rest = item.split('=', 1)
    path, box = rest.rsplit('@', 1)
    box = tuple(int(v) for v in box.split(','))
    im = Image.open(path).convert('RGB').crop(box)
    tiles.append((name, im.resize((im.width * 2, im.height * 2), Image.NEAREST)))
w = max(t.width for _, t in tiles); h = max(t.height for _, t in tiles)
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (w + 6), rows * (h + 20)), (15, 15, 15))
draw = ImageDraw.Draw(sheet)
for k, (name, im) in enumerate(tiles):
    x, y = (k % cols) * (w + 6), (k // cols) * (h + 20)
    sheet.paste(im, (x, y + 18)); draw.text((x + 4, y + 3), name, fill=(230, 230, 230))
sheet.save(out)
