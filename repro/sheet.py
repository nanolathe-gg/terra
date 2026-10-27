"""Tile every <dir>/<world>/pair.png at half size into <dir>/sheet.png."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

root = Path(sys.argv[1])
pairs = sorted(root.glob('*/pair.png'))
rows = [Image.open(p).convert('RGB') for p in pairs]
rows = [r.resize((r.width // 2, r.height // 2), Image.LANCZOS) for r in rows]
if rows:
    out = Image.new('RGB', (max(r.width for r in rows), sum(r.height + 20 for r in rows)), (24, 24, 24))
    y = 0
    for p, r in zip(pairs, rows):
        ImageDraw.Draw(out).text((4, y + 4), p.parent.name, fill=(255, 255, 255))
        out.paste(r, (0, y + 20)); y += r.height + 20
    out.save(root / 'sheet.png')
    print(root / 'sheet.png', len(rows), 'worlds')
