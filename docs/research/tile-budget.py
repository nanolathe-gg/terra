"""Unique 32 x 32 tiles in a TA-palette image, and how far near-duplicate merging can cut them.

    python3 -I docs/research/tile-budget.py IMAGE.png [IMAGE.png ...] [--heights H.f32 --w W] [--out DIR]
        [--thresholds 0.5,1,1.5,2,3,4] [--protect 6]

For each image:
  - the tile slots and the exactly unique tiles (what the exporter's dedupe keeps today);
  - near-duplicate merging, one row per threshold. Each tile goes, in order, to the nearest representative kept so
    far, if their error is under the threshold; otherwise it becomes a representative itself. The error is
    perceptual: the mean OKLab distance (x100) after a 2-px box blur, since a palette image is a dither and only
    its local mean is seen, with the 2-px border weighted 3x so merges do not open seams against the neighbours.
    Representatives are real tiles, so the output stays in the palette.
  - With --heights, tiles whose height range exceeds --protect units (cliffs, slopes, shores) are never merged
    (BACKLOG Phase 4 (c)); they keep their own tile.
  - --out writes each image rebuilt from its representatives at every threshold, for a 1x look.
Only numpy and Pillow.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

T = 32


def oklab(rgb):
    c = rgb / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]])
    m2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]])
    return np.cbrt(np.maximum(lin @ m1.T, 0)) @ m2.T


def blur2(a):
    """A 5-tap box blur (radius 2) over the whole image, edge-clamped, per channel."""
    out = a.copy()
    for axis in (0, 1):
        pad = [(0, 0)] * a.ndim
        pad[axis] = (2, 2)
        p = np.pad(out, pad, mode='edge')
        n = out.shape[axis]
        out = sum(np.take(p, range(k, k + n), axis=axis) for k in range(5)) / 5.0
    return out


def tiles_of(img):
    h, w = img.shape[0] // T * T, img.shape[1] // T * T
    a = img[:h, :w]
    return a.reshape(h // T, T, w // T, T, -1).swapaxes(1, 2).reshape(-1, T, T, a.shape[-1]), (h // T, w // T)


def weights():
    wt = np.ones((T, T))
    wt[:2, :] = wt[-2:, :] = wt[:, :2] = wt[:, -2:] = 3.0
    return wt / wt.sum()


def merge(feat, protect, thr, wt):
    """Leader clustering in order: returns each tile's representative index and its error."""
    n = len(feat)
    rep_of = np.empty(n, dtype=np.int64)
    err = np.zeros(n)
    reps = []
    flat_w = wt.reshape(-1)
    rep_feat = np.empty((0, feat.shape[1], 3))
    for i in range(n):
        if protect[i] or not reps:
            rep_of[i] = i
            if not protect[i]:
                reps.append(i)
                rep_feat = feat[i][None]
            continue
        d = np.sqrt(((rep_feat - feat[i][None]) ** 2).sum(-1)) @ flat_w * 100.0
        j = int(np.argmin(d))
        if d[j] < thr:
            rep_of[i] = reps[j]
            err[i] = d[j]
        else:
            rep_of[i] = i
            reps.append(i)
            rep_feat = np.concatenate([rep_feat, feat[i][None]], 0)
    return rep_of, err


def main():
    args = sys.argv[1:]

    def opt(k, d):
        if k in args:
            i = args.index(k)
            v = args[i + 1]
            del args[i:i + 2]
            return v
        return d

    heights = opt('--heights', None)
    hw = int(opt('--w', 0) or 0)
    out = opt('--out', None)
    thresholds = [float(x) for x in opt('--thresholds', '0.5,1,1.5,2,3,4').split(',')]
    protect_units = float(opt('--protect', 6))
    wt = weights()
    report = {}
    for path in args:
        rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
        if rgb.shape[0] % 2 == 1:
            rgb = rgb[1:]   # the lab's sheets carry one extra row
        raw, grid = tiles_of(rgb.astype(np.uint8))
        exact = len({t.tobytes() for t in raw})
        lab_blur = blur2(oklab(rgb))
        feat, _ = tiles_of(lab_blur)
        feat = feat.reshape(len(feat), T * T, 3)
        protect = np.zeros(len(feat), dtype=bool)
        if heights:
            hf = np.fromfile(heights, dtype=np.float32).reshape(-1, hw)
            ht, _ = tiles_of(hf[:, :, None])
            rng = ht.reshape(len(ht), -1).max(1) - ht.reshape(len(ht), -1).min(1)
            protect = rng > protect_units
        rows = []
        for thr in thresholds:
            rep_of, err = merge(feat, protect, thr, wt)
            # exact duplicates of a representative count once
            unique = len({raw[r].tobytes() for r in set(rep_of.tolist())})
            merged = err > 0
            rows.append({'threshold': thr, 'unique': unique, 'mergedShare': round(float(merged.mean()), 3),
                         'meanErrMerged': round(float(err[merged].mean()) if merged.any() else 0.0, 3),
                         'maxErr': round(float(err.max()), 3)})
            if out:
                os.makedirs(out, exist_ok=True)
                rebuilt = raw[rep_of].reshape(grid[0], grid[1], T, T, 3).swapaxes(1, 2).reshape(grid[0] * T, grid[1] * T, 3)
                Image.fromarray(rebuilt.astype(np.uint8)).save(os.path.join(out, f'{os.path.basename(path)[:-4]}--merge{thr:g}.png'))
        report[os.path.basename(path)] = {'slots': len(raw), 'exactUnique': exact, 'protected': int(protect.sum()), 'merge': rows}
        print(f'{os.path.basename(path)}: {len(raw)} slots, {exact} exactly unique, {int(protect.sum())} protected')
        for r in rows:
            print(f"  threshold {r['threshold']:>4}: {r['unique']:>5} unique  ({100 * r['mergedShare']:.0f}% merged, mean error {r['meanErrMerged']}, max {r['maxErr']})")
    if out:
        json.dump(report, open(os.path.join(out, 'tile-budget.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
