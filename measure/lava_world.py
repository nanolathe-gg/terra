"""World-space resampling of a retail map's art (shared by the Lava band
and coast measurements).

TA draws world point (x, y, h) at screen row y - h/2. For a world-space tile
this samples the art at that row, so a band that follows a height contour in
the world reads as a contour here too, and slopes are measured in height
units per world px. Heights are the 16-px cell heights, bilinear between
cell centres; the art was rendered from a finer surface, so the heights
locate faces and their slope, not individual terrace steps.
"""
import numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates

LAVA = np.zeros(256, bool)
LAVA[[200, 201, 202, 203, 204, 205, 206, 207, 211, 212, 213, 214, 215]] = True


def world_heights(cells, x0, y0, x1, y1):
    """Bilinear cell-centre heights for world pixels [x0,x1) x [y0,y1)."""
    ys = (np.arange(y0, y1) + .5) / 16 - .5
    xs = (np.arange(x0, x1) + .5) / 16 - .5
    Y, X = np.meshgrid(ys, xs, indexing='ij')
    return map_coordinates(cells.astype(np.float32), [Y, X], order=1, mode='nearest')


def world_tile(m, x0, y0, x1, y1):
    """(heights, luminance, palette index, visible) for a world tile; art
    sampled at the projected row (nearest; the art is indexed)."""
    wh = world_heights(m.cells, x0, y0, x1, y1)
    # Lava (and water) is drawn at its surface, the sea plane.
    rows = np.floor(np.arange(y0, y1)[:, None] - np.maximum(wh, m.sea) / 2 + .5).astype(np.int64)
    cols = np.broadcast_to(np.arange(x0, x1)[None, :], wh.shape)
    ok = (rows >= 0) & (rows < m.H)
    idx = m.idx[np.clip(rows, 0, m.H - 1), np.clip(cols, 0, m.W - 1)]
    # A world point is hidden when ground south of it projects at or above
    # its row (only on north-looking faces steeper than 2 units per px).
    vis = ok.copy()
    run = np.full(wh.shape[1], np.iinfo(np.int64).max)
    for r in range(wh.shape[0] - 1, -1, -1):
        vis[r] &= rows[r] <= run
        run = np.minimum(run, rows[r])
    lum = m.lum_table[idx]
    return wh, lum, idx, vis


def fall_field(wh, sigma=6):
    """Smoothed downhill unit vector and slope (height units per px)."""
    s = gaussian_filter(wh, sigma)
    gy, gx = np.gradient(s)
    g = np.hypot(gx, gy)
    # downhill = -gradient
    with np.errstate(invalid='ignore', divide='ignore'):
        fx, fy = np.where(g > 1e-6, -gx / g, 0), np.where(g > 1e-6, -gy / g, 0)
    return fx, fy, g
