"""Helpers the section measuring tools share (measure/ice_features.py, measure/crystal_geometry.py): the retail palette's location,
the exact colour-to-index table, and the projection of per-cell values onto section art. Dev tools only; the server reads none of it."""
from pathlib import Path

import numpy as np

PALETTE = Path('/private/tmp/nanolathe-neural-terrain/editor-green-sections/palette.pal')


def palette_codes(palette):
    """RGB -> palette index, exact. Duplicate colours resolve to the lowest
    index; the art only records colours, so either index draws the same."""
    code = np.full(1 << 24, -1, np.int32)
    for i in range(255, -1, -1):
        r, g, b = (int(v) for v in palette[i])
        code[(r << 16) | (g << 8) | b] = i
    return code


def project_cells(cells, values, shape):
    """Paint one value per 16-px cell at the art rows its height is drawn on.
    Southern cells are painted last, so a raised southern cell covers the art
    north of it as it does on screen."""
    out = np.full(shape, np.nan, np.float32)
    for cy in range(cells.shape[0]):
        for cx in range(cells.shape[1]):
            y0 = cy * 16 - int(cells[cy, cx]) // 2
            if y0 + 16 <= 0:
                continue
            out[max(0, y0):y0 + 16, cx * 16:cx * 16 + 16] = values[cy, cx]
    # Rows uncovered at the bottom (and any gaps) take the nearest value above.
    for y in range(1, shape[0]):
        gap = np.isnan(out[y])
        out[y][gap] = out[y - 1][gap]
    for y in range(shape[0] - 2, -1, -1):
        gap = np.isnan(out[y])
        out[y][gap] = out[y + 1][gap]
    return out
