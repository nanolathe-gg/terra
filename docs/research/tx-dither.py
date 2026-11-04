"""Palette rendering for TA pixel art: threshold masks, parallel error diffusion, cleanup and 0.5x downscaling.

    python3 -I docs/research/tx-dither.py IN_DIR OUT_DIR

IN_DIR holds true-colour lab renders (pal=0): d/mountain-gullies--gullies.png (desert), g/rk-types--granite.png.
A synthetic sweep of tans (OKLab lightness 0.45-0.85 across, chroma 0.01-0.07 down, hue 70 degrees) is made here.
Every method maps a colour per pixel to a palette index:
  nearest            the nearest colour in OKLab
  pair+bayer4        the engine today (engine-palette.wgsl best pair; engine-frag.wgsl 4 x 4 Bayer threshold)
  knoll+bayer4       Knoll, 8 candidates, error multiplier 0.4, sorted by lightness (card P9), 4 x 4 Bayer
  knoll+ign          the same on interleaved gradient noise
  knoll+blue         the same on a 64 x 64 void-and-cluster mask (Ulichney 1993), made here in integers
  pair+blue          the engine's pair on the blue mask
  knoll+edge         knoll+bayer4 whose multiplier falls to 0 where the input's OKLab gradient is steep
  knoll+clean        knoll+bayer4, then one parallel pass that fills orphan pixels (unlike all 8 neighbours)
  dotdiff            Knuth's dot diffusion (1987): an 8 x 8 class matrix; each class quantises to the nearest colour
                     and pushes its error to the neighbours of higher class (64 passes, each fully parallel)
  fs                 Floyd-Steinberg, serpentine, in OKLab: the serial reference (engine-materials makeDither's rule)
Measures (OKLab x 100, a 4 px border left out):
  err1, err2   perceived error: RMS difference of the output and the input after a Gaussian blur of 1 and 2 px
  grain        RMS of the output minus its own 1 px blur (how noisy it looks at 1x); the input's own is listed
  orph         the share of orphan pixels, %
  edit         output pixels changed when a 4 x 4 input patch moves by 0.02 in L (regional replay), and how far
  cols         palette colours used
Then 0.5x views of knoll+bayer4: the engine's overview mean (mix, off the palette), the 2 x 2 mode, a weighted medoid
of a 4 x 4 footprint (palette-preserving, edge-keeping: the idea of Kopf et al. 2013 without its optimisation), and
a re-dither of the input box-downscaled; err1 against the input box-downscaled, grain, and palette or not.
Needs numpy and Pillow.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]])
M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]])
KNUTH = np.array([[34, 48, 40, 32, 29, 15, 23, 31], [42, 58, 56, 53, 21, 5, 7, 10], [50, 62, 61, 45, 13, 1, 2, 18],
                  [38, 46, 54, 37, 25, 17, 9, 26], [28, 14, 22, 30, 35, 49, 41, 33], [20, 4, 6, 11, 43, 59, 57, 52],
                  [12, 0, 3, 19, 51, 63, 60, 44], [24, 16, 8, 27, 39, 47, 55, 36]])
BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]])


def oklab(rgb255):
    c = rgb255 / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return np.cbrt(np.maximum(lin @ M1.T, 0)) @ M2.T


def from_oklab(L):
    lms = (L @ np.linalg.inv(M2).T) ** 3
    lin = np.clip(lms @ np.linalg.inv(M1).T, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055) * 255


def pcg(v):
    s = (v.astype(np.uint64) * np.uint64(747796405) + np.uint64(2891336453)) & np.uint64(0xffffffff)
    w = (((s >> ((s >> np.uint64(28)) + np.uint64(4))) ^ s) * np.uint64(277803737)) & np.uint64(0xffffffff)
    return (w >> np.uint64(22)) ^ w


def void_and_cluster(n=64, sigma=1.5):
    """Ulichney's void-and-cluster rank mask, in integers so every machine makes the same table: the energy kernel is a
    toroidal Gaussian scaled to 2^16 and rounded, the start pattern is the 10% of pixels with the lowest pcg hash, and
    ties go to the lowest index. Returns thresholds (rank + 0.5) / n^2."""
    N = n * n
    d = np.minimum(np.arange(n), n - np.arange(n))
    K = np.rint(np.exp(-(d[:, None] ** 2 + d[None, :] ** 2) / (2 * sigma ** 2)) * 65536).astype(np.int64)
    roll = lambda i: np.roll(np.roll(K, i // n, 0), i % n, 1).ravel()
    ones = N // 10
    B = np.zeros(N, bool)
    B[np.argsort(pcg(np.arange(N)), kind='stable')[:ones]] = True
    E = np.zeros(N, np.int64)
    for i in np.nonzero(B)[0]:
        E += roll(i)
    big = np.int64(1) << 62
    while True:                                     # relax: move the tightest cluster into the largest void
        c = np.where(B, E, -big).argmax(); B[c] = False; E -= roll(c)
        v = np.where(B, big, E).argmin()
        if v == c:
            B[c] = True; E += roll(c); break
        B[v] = True; E += roll(v)
    rank = np.zeros(N, np.int64)
    B1, E1 = B.copy(), E.copy()
    for r in range(ones - 1, -1, -1):
        c = np.where(B1, E1, -big).argmax(); B1[c] = False; E1 -= roll(c); rank[c] = r
    for r in range(ones, N):                        # the largest void of ones is the tightest cluster of zeros
        v = np.where(B, big, E).argmin(); B[v] = True; E += roll(v); rank[v] = r
    return ((rank + 0.5) / N).reshape(n, n)


def nearest(L, P):
    out = np.empty(len(L), np.int64)
    pp = (P * P).sum(1)
    for s in range(0, len(L), 8192):
        x = L[s:s + 8192]
        out[s:s + 8192] = (pp[None, :] - 2 * x @ P.T).argmin(1)
    return out


def knoll(L, P, n=8, m=0.4):
    m = np.broadcast_to(np.asarray(m, float), (len(L),))[:, None]
    err = np.zeros_like(L); C = []
    for _ in range(n):
        c = nearest(L + err * m, P); C.append(c); err += L - P[c]
    C = np.stack(C, 1)
    return np.take_along_axis(C, np.argsort(P[C][:, :, 0], 1, kind='stable'), 1)


def pair(L, P):
    if len(L) > 8192:
        r = [pair(L[s:s + 8192], P) for s in range(0, len(L), 8192)]
        return tuple(np.concatenate([x[i] for x in r]) for i in range(3))
    d = ((L[:, None, :] - P[None, :, :]) ** 2).sum(-1)
    k = min(10, len(P))
    idx = np.argsort(d, 1, kind='stable')[:, :k]
    best = np.full(len(L), 1e30); pa = idx[:, 0].copy(); pb = idx[:, 0].copy(); tb = np.zeros(len(L))
    for i in range(k):
        for j in range(i, k):
            a, b = P[idx[:, i]], P[idx[:, j]]; dv = b - a
            dd = np.maximum((dv * dv).sum(1), 1e-12)
            t = np.clip(((L - a) * dv).sum(1) / dd, 0, 1)
            e = ((L - a - dv * t[:, None]) ** 2).sum(1) + 0.1 * dd * t * (1 - t)
            bt = e < best
            best = np.where(bt, e, best); pa = np.where(bt, idx[:, i], pa); pb = np.where(bt, idx[:, j], pb); tb = np.where(bt, t, tb)
    return pa, pb, tb


def masks(h, w, blue):
    y, x = np.mgrid[0:h, 0:w]
    return {'bayer4': (BAYER4[y % 4, x % 4] + 0.5) / 16, 'ign': (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1,
            'blue': blue[y % 64, x % 64]}


def dot_chain(cls=KNUTH):
    """The exact apron of dot diffusion for regional replay: the longest chain of 8-neighbour steps through strictly
    rising classes on the tiled class matrix (a pixel depends on its lower-class neighbours, and they on theirs)."""
    n = len(cls); depth = np.zeros((n, n), int)
    for k in range(n * n):
        y, x = map(int, np.argwhere(cls == k)[0])
        depth[y, x] = max([depth[(y + dy) % n, (x + dx) % n] + 1 for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                           if (dy or dx) and cls[(y + dy) % n, (x + dx) % n] < k] + [0])
    return depth.max()


def dot_diffusion(img, P):
    h, w = img.shape[:2]
    cls = KNUTH[np.arange(h)[:, None] % 8, np.arange(w)[None, :] % 8]
    v = img.copy(); out = np.zeros((h, w), np.int64)
    nb = [(-1, -1, 1), (-1, 0, 2), (-1, 1, 1), (0, -1, 2), (0, 1, 2), (1, -1, 1), (1, 0, 2), (1, 1, 1)]
    for k in range(64):
        ys, xs = np.nonzero(cls == k)
        q = nearest(v[ys, xs], P); out[ys, xs] = q; e = v[ys, xs] - P[q]
        wsum = np.zeros(len(ys)); ent = []
        for dy, dx, wt in nb:
            yy, xx = ys + dy, xs + dx
            ok = (yy >= 0) & (yy < h) & (xx >= 0) & (xx < w)
            ok[ok] = cls[yy[ok], xx[ok]] > k
            wsum += wt * ok; ent.append((yy, xx, wt, ok))
        for yy, xx, wt, ok in ent:
            f = (wt / np.maximum(wsum, 1))[ok]
            v[yy[ok], xx[ok]] += e[ok] * f[:, None]
    return out


def floyd_steinberg(img, P):
    h, w = img.shape[:2]; v = img.copy(); out = np.zeros((h, w), np.int64)
    pp = (P * P).sum(1)
    for y in range(h):
        rev = y % 2 == 1; xs = range(w - 1, -1, -1) if rev else range(w); s = -1 if rev else 1
        for x in xs:
            c = int((pp - 2 * P @ v[y, x]).argmin()); out[y, x] = c; e = v[y, x] - P[c]
            if 0 <= x + s < w: v[y, x + s] += e * 7 / 16
            if y + 1 < h:
                if 0 <= x - s < w: v[y + 1, x - s] += e * 3 / 16
                v[y + 1, x] += e * 5 / 16
                if 0 <= x + s < w: v[y + 1, x + s] += e * 1 / 16
    return out


def blur(a, s):
    r = int(3 * s + 0.5); t = np.arange(-r, r + 1); k = np.exp(-t * t / (2 * s * s)); k /= k.sum()
    a = np.pad(a, ((r, r), (r, r), (0, 0)), mode='reflect')
    a = sum(k[i] * a[i:i + a.shape[0] - 2 * r, :] for i in range(2 * r + 1))
    return sum(k[i] * a[:, i:i + a.shape[1] - 2 * r] for i in range(2 * r + 1))


def orphans(q):
    p = np.pad(q, 1, mode='edge'); h, w = q.shape; same = np.zeros(q.shape, bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx: same |= p[1 + dy:1 + dy + h, 1 + dx:1 + dx + w] == q
    return ~same


def clean(q, img, P, tau=0.03):
    """One parallel pass: an orphan takes the neighbour colour nearest its own goal, if that costs at most tau more."""
    h, w = q.shape; p = np.pad(q, 1, mode='edge'); orph = orphans(q)
    best = q.copy(); bd = np.sqrt(((P[q] - img) ** 2).sum(-1)); lim = bd + tau; cur = np.full(q.shape, 1e9)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if not (dy or dx): continue
            c = p[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]; d = np.sqrt(((P[c] - img) ** 2).sum(-1))
            take = orph & (d < cur) & (d <= lim); best = np.where(take, c, best); cur = np.where(take, d, cur)
    return best


def render(method, img, P, M):
    h, w = img.shape[:2]; L = img.reshape(-1, 3)
    if method == 'nearest': return nearest(L, P).reshape(h, w)
    if method == 'dotdiff': return dot_diffusion(img, P)
    if method == 'fs': return floyd_steinberg(img, P)
    if method.startswith('pair'):
        a, b, t = pair(L, P); th = M[method.split('+')[1]].ravel()
        return np.where(th < t, b, a).reshape(h, w)
    mask = M['bayer4' if method in ('knoll+edge', 'knoll+clean') else method.split('+')[1]].ravel()
    m = 0.4
    if method == 'knoll+edge':
        g = np.zeros((h, w))
        g[1:-1, 1:-1] = np.sqrt(((img[1:-1, 2:] - img[1:-1, :-2]) ** 2).sum(-1) + ((img[2:, 1:-1] - img[:-2, 1:-1]) ** 2).sum(-1)) / 2
        t = np.clip((g.ravel() - 0.012) / 0.03, 0, 1); m = 0.4 * (1 - t * t * (3 - 2 * t))
    C = knoll(L, P, 8, m)
    q = C[np.arange(len(L)), np.minimum((mask * 8).astype(int), 7)].reshape(h, w)
    return clean(q, img, P) if method == 'knoll+clean' else q


def measures(q, img, P):
    o = P[q]; b = (slice(4, -4), slice(4, -4))
    e1 = np.sqrt(((blur(o, 1) - blur(img, 1))[b] ** 2).sum(-1).mean()) * 100
    e2 = np.sqrt(((blur(o, 2) - blur(img, 2))[b] ** 2).sum(-1).mean()) * 100
    gr = np.sqrt(((o - blur(o, 1))[b] ** 2).sum(-1).mean()) * 100
    return e1, e2, gr, orphans(q)[b].mean() * 100, len(np.unique(q))


METHODS = ['nearest', 'pair+bayer4', 'knoll+bayer4', 'knoll+ign', 'knoll+blue', 'pair+blue', 'knoll+edge', 'knoll+clean', 'dotdiff', 'fs']


def downscale(q, img, P, blue):
    h, w = q.shape; h2, w2 = h // 2, w // 2; o = P[q][:h2 * 2, :w2 * 2]
    ref = img[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2, 3).mean((1, 3))
    res = {'mix': o.reshape(h2, 2, w2, 2, 3).mean((1, 3))}
    blk = q[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2).transpose(0, 2, 1, 3).reshape(h2, w2, 4)
    mean = res['mix']
    best = blk[:, :, 0].copy(); bc = np.zeros((h2, w2)); bd = np.full((h2, w2), 1e9)
    for i in range(4):
        cnt = (blk == blk[:, :, i:i + 1]).sum(-1); d = ((P[blk[:, :, i]] - mean) ** 2).sum(-1)
        tk = (cnt > bc) | ((cnt == bc) & (d < bd)); best = np.where(tk, blk[:, :, i], best); bc = np.where(tk, cnt, bc); bd = np.where(tk, d, bd)
    res['mode'] = P[best]
    # Weighted medoid of the 4 x 4 input footprint around each output pixel (Gaussian, sigma 1.2 input px).
    pq = np.pad(q, 1, mode='edge'); offs = [(dy, dx) for dy in range(-1, 3) for dx in range(-1, 3)]
    wts = np.array([np.exp(-((dy - 0.5) ** 2 + (dx - 0.5) ** 2) / (2 * 1.2 ** 2)) for dy, dx in offs])
    cs = np.stack([pq[1 + dy:1 + dy + 2 * h2:2, 1 + dx:1 + dx + 2 * w2:2] for dy, dx in offs], -1)
    cost = np.zeros(cs.shape)
    for i in range(16):
        cost[:, :, i] = sum(wts[j] * np.sqrt(((P[cs[:, :, i]] - P[cs[:, :, j]]) ** 2).sum(-1)) for j in range(16))
    res['medoid'] = P[np.take_along_axis(cs, cost.argmin(-1)[:, :, None], -1)[:, :, 0]]
    M = masks(h2, w2, blue)
    res['redither'] = P[render('knoll+bayer4', ref, P, M)]
    out = {}
    for k, o2 in res.items():
        b = (slice(3, -3), slice(3, -3))
        e1 = np.sqrt(((blur(o2, 1) - blur(ref, 1))[b] ** 2).sum(-1).mean()) * 100
        gr = np.sqrt(((o2 - blur(o2, 1))[b] ** 2).sum(-1).mean()) * 100
        out[k] = (e1, gr, k != 'mix', o2)
    return out, np.sqrt(((ref - blur(ref, 1))[3:-3, 3:-3] ** 2).sum(-1).mean()) * 100


def sheet(path, panels, z=2):
    h, w = panels[0][1].shape[:2]; cols = 5; rows = (len(panels) + cols - 1) // cols
    S = Image.new('RGB', (cols * (w * z + 6), rows * (h * z + 18)), (24, 24, 24)); D = ImageDraw.Draw(S)
    for i, (name, rgb) in enumerate(panels):
        x, y = (i % cols) * (w * z + 6), (i // cols) * (h * z + 18)
        im = Image.fromarray(np.clip(rgb + 0.5, 0, 255).astype(np.uint8)).resize((rgb.shape[1] * z, rgb.shape[0] * z), Image.NEAREST)
        S.paste(im, (x, y)); D.text((x + 2, y + h * z + 3), name, fill=(220, 220, 220))
    S.save(path)


def main():
    ind, outd = sys.argv[1], sys.argv[2]
    pal = np.array(json.load(open(os.path.join(ROOT, 'materials', 'palette.json')))['colours'], dtype=np.float64)
    ent = json.load(open(os.path.join(ROOT, 'materials', 'desert.json')))['palette']['entries']
    blue = void_and_cluster()
    bspec = np.abs(np.fft.fft2(blue - blue.mean())) ** 2; fr = np.sqrt(np.fft.fftfreq(64)[:, None] ** 2 + np.fft.fftfreq(64)[None, :] ** 2)
    print(f'blue mask: low-frequency power share (f < 0.125) {bspec[(fr > 0) & (fr < 0.125)].sum() / bspec.sum() * 100:.3f}%  '
          f'(white noise ~{np.pi * 0.125 ** 2 * 100:.1f}%), thresholds unique {len(np.unique(blue)) == 4096}')
    print(f'dot diffusion: longest rising-class chain {dot_chain()} steps (the exact replay apron, px)')
    yy, xx = np.mgrid[0:64, 0:192]
    Lr = 0.45 + 0.40 * xx / 191; Cr = 0.01 + 0.06 * yy / 63; hu = np.radians(70)
    ramp = from_oklab(np.stack([Lr, Cr * np.cos(hu), Cr * np.sin(hu)], -1))
    cases = [('tans-full', ramp, pal), ('tans-desert52', ramp, pal[ent]),
             ('gullies-desert52', np.asarray(Image.open(os.path.join(ind, 'd', 'mountain-gullies--gullies.png')).convert('RGB'), float), pal[ent]),
             ('granite-full', np.asarray(Image.open(os.path.join(ind, 'g', 'rk-types--granite.png')).convert('RGB'), float), pal)]
    for name, rgb, P255 in cases:
        img = oklab(rgb); P = oklab(P255); h, w = img.shape[:2]; M = masks(h, w, blue)
        bi = (slice(4, -4), slice(4, -4))
        print(f'\n{name} ({w} x {h}, {len(P)} colours): input grain {np.sqrt(((img - blur(img, 1))[bi] ** 2).sum(-1).mean()) * 100:.2f}')
        print(f'  {"method":>13}  err1  err2 grain orph%  edit(px, reach) cols')
        img2 = img.copy(); cy, cx = h // 2, w // 2; img2[cy - 2:cy + 2, cx - 2:cx + 2, 0] += 0.02
        panels = [('input', rgb)]; outs = {}
        for meth in METHODS:
            q = render(meth, img, P, M); outs[meth] = q
            e1, e2, gr, orph, nc = measures(q, img, P)
            ch = np.nonzero(render(meth, img2, P, M) != q)
            reach = int(max(np.abs(ch[0] - cy + 0.5).max(), np.abs(ch[1] - cx + 0.5).max()) + 0.5) if len(ch[0]) else 0
            print(f'  {meth:>13} {e1:5.2f} {e2:5.2f} {gr:5.2f} {orph:5.1f}  {len(ch[0]):6d} {reach:5d}    {nc:3d}')
            panels.append((meth, P255[q]))
        sheet(os.path.join(outd, f'tx-dither--{name}.png'), panels)
        ds, rg = downscale(outs['knoll+bayer4'], img, P, blue)
        print(f'  0.5x of knoll+bayer4 (reference grain {rg:.2f}):  ' + '  '.join(f'{k} err1 {v[0]:.2f} grain {v[1]:.2f}{"" if v[2] else " (off palette)"}' for k, v in ds.items()))
        sheet(os.path.join(outd, f'tx-dither--{name}--half.png'), [(k, from_oklab(v[3])) for k, v in ds.items()], z=4)
    Image.fromarray((blue * 255).astype(np.uint8)).resize((256, 256), Image.NEAREST).save(os.path.join(outd, 'tx-dither--blue64.png'))


if __name__ == '__main__':
    main()
