"""Procedural base-ground tiles with retail neighbour statistics.

Measures, on retail flat ground of one world, how often each palette index
follows each context of left, upper-left, upper and upper-right neighbours,
then samples a fixed number of 32x32 tiles in raster order from those counts,
backing off to smaller contexts where data is thin. Retail grass correlation
reaches only a pixel or two, so any tile joins any other without a visible
seam, and the map needs only that many unique ground tiles.

A pairwise model fitted by moment matching was tried first; it fell into
ordered, checkerboard phases.

Measured tables are allowed under the map-generator policy; no retail pixel
is copied into a tile.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

CORPUS = Path('/private/tmp/nanolathe-neural-terrain/corpus')


def flat_blocks(corpus, skip=('the_pass', 'plains_and_passes', 'the_barrier_reef'), per_map=400, seed=5):
    """32x32 blocks of level, dry ground, aligned to the tile grid."""
    rng = np.random.default_rng(seed)
    blocks, palette = [], None
    for d in sorted(p for p in corpus.iterdir() if p.is_dir()):
        if d.name.startswith(skip):
            continue
        m = json.loads((d / 'metadata.json').read_text())
        cw, ch = m['cell_width'], m['cell_height']
        h = np.fromfile(d / 'heights.bin', np.uint8)
        if h.size != cw * ch:
            continue
        h = h.reshape(ch, cw).astype(np.int32)
        # A 2x2 cell block (one tile) whose cells and neighbours share a height.
        level = np.zeros((ch // 2, cw // 2), bool)
        for ty in range(1, ch // 2 - 1):
            row = h[ty * 2 - 1:ty * 2 + 3]
            for tx in range(1, cw // 2 - 1):
                w = row[:, tx * 2 - 1:tx * 2 + 3]
                level[ty, tx] = w.max() == w.min() and w[0, 0] > m['sea_level'] + 3
        ys, xs = np.nonzero(level)
        if not len(ys):
            continue
        idx = np.memmap(d / 'map-indexed.bin', np.uint8, mode='r', shape=(m['height'], m['width']))
        palette = np.fromfile(d / 'palette-rgb.bin', np.uint8).reshape(256, 3)
        for k in rng.choice(len(ys), size=min(per_map, len(ys)), replace=False):
            ty, tx = ys[k], xs[k]
            # Flat ground at height H is drawn H/2 rows north.
            y = ty * 32 - int(h[ty * 2, tx * 2]) // 2
            if y < 0 or y + 32 > m['height']:
                continue
            blocks.append(np.asarray(idx[y:y + 32, tx * 32:tx * 32 + 32]))
    return np.stack(blocks), palette


def measure(blocks, coverage=.995):
    """The palette indices covering most of the ground, and their shares."""
    counts = np.bincount(blocks.ravel(), minlength=256)
    order = np.argsort(-counts)
    vocab = np.sort(order[:np.searchsorted(np.cumsum(counts[order]) / counts.sum(), coverage) + 1])
    prior = counts[vocab] + 1.0
    return vocab, prior / prior.sum()


def causal_tables(blocks, vocab):
    """Counts of each index given its left, upper-left, upper and upper-right
    neighbours, plus backoff tables for (left, upper) and (left)."""
    K = len(vocab)
    # Indices outside the vocabulary fold into the most common one.
    lookup = np.full(256, int(np.argmax(np.bincount(np.searchsorted(vocab, blocks.ravel()).clip(0, K - 1), minlength=K))))
    lookup[vocab] = np.arange(K)
    m = lookup[blocks]
    c = m[:, 1:, 1:-1]
    left, upleft, up, upright = m[:, 1:, :-2], m[:, :-1, :-2], m[:, :-1, 1:-1], m[:, :-1, 2:]
    full = np.zeros((K ** 4, K))
    np.add.at(full, ((((left * K + upleft) * K + up) * K + upright).ravel(), c.ravel()), 1)
    pair = np.zeros((K * K, K))
    np.add.at(pair, ((left * K + up).ravel(), c.ravel()), 1)
    single = np.zeros((K, K))
    np.add.at(single, (left.ravel(), c.ravel()), 1)
    return full, pair, single


def sample_tiles(vocab, prior, tables, count, seed=17, size=32, min_count=8):
    """Raster-order sampling from the measured conditionals. Missing context at
    a tile's top row or left column backs off to the smaller tables."""
    rng = np.random.default_rng(seed)
    full, pair, single = tables
    K = len(vocab)
    tiles = np.zeros((count, size, size), int)
    for n in range(count):
        t = tiles[n]
        for y in range(size):
            for x in range(size):
                dist = None
                if y > 0 and 0 < x < size - 1:
                    row = full[((t[y, x - 1] * K + t[y - 1, x - 1]) * K + t[y - 1, x]) * K + t[y - 1, x + 1]]
                    if row.sum() >= min_count:
                        dist = row
                if dist is None and y > 0 and x > 0:
                    row = pair[t[y, x - 1] * K + t[y - 1, x]]
                    if row.sum() >= min_count:
                        dist = row
                if dist is None and x > 0:
                    dist = single[t[y, x - 1]]
                if dist is None or dist.sum() == 0:
                    dist = prior
                t[y, x] = rng.choice(K, p=dist / dist.sum())
    return vocab[tiles]


def make_ground_tiles(out, corpus=CORPUS, count=16, seed=17):
    """Write ground-tiles.png: a 512x512 texture whose first row holds the
    tiles in order (the renderer's tile placer reads it) and whose other rows
    are a random arrangement of the same tiles (for code that samples the
    ground texture directly)."""
    blocks, palette = flat_blocks(Path(corpus))
    vocab, prior = measure(blocks)
    tiles = palette[sample_tiles(vocab, prior, causal_tables(blocks, vocab), count, seed)]
    rng = np.random.default_rng(seed + 1)
    rows = [np.concatenate([tiles[i % count] for i in range(16)], axis=1)]
    for _ in range(15):
        rows.append(np.concatenate([tiles[rng.integers(count)] for _ in range(16)], axis=1))
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.concatenate(rows, axis=0)).save(out / 'ground-tiles.png')
    info = {'tiles': count, 'blocks_measured': int(len(blocks)), 'vocabulary': [int(v) for v in vocab], 'seed': seed}
    (out / 'ground-tiles.json').write_text(json.dumps(info, indent=1))
    return info


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--corpus', type=Path, default=CORPUS)
    parser.add_argument('--count', type=int, default=16)
    parser.add_argument('--seed', type=int, default=17)
    args = parser.parse_args()
    print(make_ground_tiles(args.out, args.corpus, args.count, args.seed))
