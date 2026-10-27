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


# Green Planet defaults: maps whose level ground is not grass, and the
# height above sea that level ground must clear (shore flats are sand).
GREEN_SKIP = ('the_pass', 'plains_and_passes', 'the_barrier_reef')
GREEN_ABOVE_SEA = 3


def map_dirs(corpus):
    """A corpus is either one exported map directory (it holds metadata.json)
    or a directory of them."""
    corpus = Path(corpus)
    if (corpus / 'metadata.json').is_file():
        return [corpus]
    return sorted(p for p in corpus.iterdir() if p.is_dir())


def flat_blocks(corpus, skip=GREEN_SKIP, per_map=400, seed=5, above_sea=GREEN_ABOVE_SEA, tolerance=0,
                min_height=None, max_height=None, margin=1, exclude=()):
    """32x32 blocks of level, dry ground, aligned to the tile grid.

    A tile (2x2 cells) counts when its cells and their neighbours (`margin`
    cells round it; 1 gives a 4x4 window) differ in height by at most
    `tolerance`, its north-west cell
    stands more than `above_sea` above the map's sea level, and the window
    lies within [min_height, max_height] when those are given. A block in
    which the `exclude` palette indices make up more than 1% of the pixels is
    dropped (e.g. painted discs on a mesa top that are not ground texture).
    Map directories whose names start with a `skip` prefix are left out.
    """
    rng = np.random.default_rng(seed)
    blocks, palette = [], None
    for d in map_dirs(corpus):
        if skip and d.name.startswith(tuple(skip)):
            continue
        m = json.loads((d / 'metadata.json').read_text())
        cw, ch = m['cell_width'], m['cell_height']
        h = np.fromfile(d / 'heights.bin', np.uint8)
        if h.size != cw * ch:
            continue
        h = h.reshape(ch, cw).astype(np.int32)
        # A 2x2 cell block (one tile) whose cells and neighbours share a height.
        level = np.zeros((ch // 2, cw // 2), bool)
        t0 = (margin + 1) // 2
        for ty in range(t0, ch // 2 - t0):
            row = h[ty * 2 - margin:ty * 2 + 2 + margin]
            for tx in range(t0, cw // 2 - t0):
                w = row[:, tx * 2 - margin:tx * 2 + 2 + margin]
                lo, hi = w.min(), w.max()
                level[ty, tx] = (hi - lo <= tolerance and w[margin - 1, margin - 1] > m['sea_level'] + above_sea
                                 and (min_height is None or lo >= min_height)
                                 and (max_height is None or hi <= max_height))
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
            block = np.asarray(idx[y:y + 32, tx * 32:tx * 32 + 32])
            if len(exclude) and np.isin(block, exclude).mean() > .01:
                continue
            blocks.append(block)
    if not blocks:
        raise ValueError(f'no level blocks in {corpus} (skip {skip}, tolerance {tolerance}, '
                         f'heights {min_height}..{max_height}, above sea {above_sea})')
    return np.stack(blocks), palette


def measure(blocks, coverage=.995, max_vocab=None):
    """The palette indices covering most of the ground, and their shares.
    `max_vocab` caps the count (the context table grows as its fifth power)."""
    counts = np.bincount(blocks.ravel(), minlength=256)
    order = np.argsort(-counts)
    k = np.searchsorted(np.cumsum(counts[order]) / counts.sum(), coverage) + 1
    vocab = np.sort(order[:k if max_vocab is None else min(k, max_vocab)])
    prior = counts[vocab] + 1.0
    return vocab, prior / prior.sum()


def causal_tables(blocks, vocab, palette=None):
    """Counts of each index given its left, upper-left, upper and upper-right
    neighbours, plus backoff tables for (left, upper) and (left)."""
    K = len(vocab)
    # Indices outside the vocabulary fold into the most common one, or, given
    # the palette, into the nearest vocabulary colour (keeps a long tail of
    # dark specks dark).
    lookup = np.full(256, int(np.argmax(np.bincount(np.searchsorted(vocab, blocks.ravel()).clip(0, K - 1), minlength=K))))
    if palette is not None:
        d = ((palette[:, None, :].astype(float) - palette[vocab][None, :, :].astype(float)) ** 2).sum(-1)
        lookup = np.argmin(d, axis=1)
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


def make_ground_tiles(out, corpus=CORPUS, count=16, seed=17, name='ground-tiles', max_vocab=None, **select):
    """Write <name>.png: a 512x512 texture whose first row holds the
    tiles in order (the renderer's tile placer reads it) and whose other rows
    are a random arrangement of the same tiles (for code that samples the
    ground texture directly). `select` passes the level-ground choice
    (skip, per_map, above_sea, tolerance, min_height, max_height, margin,
    exclude) to
    flat_blocks; the defaults are Green Planet's. With `max_vocab`, the
    palette vocabulary is capped and rarer indices fold into the nearest
    vocabulary colour."""
    blocks, palette = flat_blocks(Path(corpus), **select)
    vocab, prior = measure(blocks, max_vocab=max_vocab)
    tables = causal_tables(blocks, vocab, palette if max_vocab is not None else None)
    tiles = palette[sample_tiles(vocab, prior, tables, count, seed)]
    rng = np.random.default_rng(seed + 1)
    rows = [np.concatenate([tiles[i % count] for i in range(16)], axis=1)]
    for _ in range(15):
        rows.append(np.concatenate([tiles[rng.integers(count)] for _ in range(16)], axis=1))
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.concatenate(rows, axis=0)).save(out / f'{name}.png')
    shares = np.bincount(blocks.ravel(), minlength=256) / blocks.size
    info = {'tiles': count, 'blocks_measured': int(len(blocks)), 'vocabulary': [int(v) for v in vocab], 'seed': seed,
            'max_vocab': max_vocab,
            'corpus': str(corpus), 'select': {k: (list(v) if isinstance(v, tuple) else v) for k, v in select.items()},
            'index_shares': {int(i): round(float(shares[i]), 4) for i in np.argsort(-shares)[:16]},
            'mean_rgb': [round(float(v), 1) for v in (shares[:, None] * palette.astype(float)).sum(0)]}
    (out / f'{name}.json').write_text(json.dumps(info, indent=1))
    return info


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--corpus', type=Path, default=CORPUS,
                        help='a directory of exported maps, or one map directory')
    parser.add_argument('--count', type=int, default=16)
    parser.add_argument('--seed', type=int, default=17)
    parser.add_argument('--name', default='ground-tiles', help='output file stem')
    parser.add_argument('--skip', default=','.join(GREEN_SKIP),
                        help='comma-separated map-directory prefixes to leave out (default: Green non-grass maps)')
    parser.add_argument('--per-map', type=int, default=400)
    parser.add_argument('--above-sea', type=int, default=GREEN_ABOVE_SEA,
                        help='level ground must stand more than this above sea level')
    parser.add_argument('--tolerance', type=int, default=0,
                        help='largest height difference within a tile and its neighbours (0: exactly level)')
    parser.add_argument('--min-height', type=int, default=None)
    parser.add_argument('--max-height', type=int, default=None)
    parser.add_argument('--margin', type=int, default=1, help='neighbour cells round a tile that must also be level')
    parser.add_argument('--exclude', default='',
                        help='comma-separated palette indices; blocks with more than 1%% of them are dropped')
    parser.add_argument('--max-vocab', type=int, default=None,
                        help='cap the palette vocabulary (rarer indices fold into the nearest colour)')
    args = parser.parse_args()
    skip = tuple(p for p in args.skip.split(',') if p)
    print(make_ground_tiles(args.out, args.corpus, args.count, args.seed, args.name, args.max_vocab, skip=skip, per_map=args.per_map,
                            above_sea=args.above_sea, tolerance=args.tolerance, min_height=args.min_height,
                            max_height=args.max_height, margin=args.margin,
                            exclude=tuple(int(v) for v in args.exclude.split(',') if v)))
