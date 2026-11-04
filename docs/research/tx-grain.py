"""Measures the texture families of docs/research/lab/exp/tx-grain.js on the raw fields the lab saves with --heights.

    node docs/research/lab/run.mjs tx-grain --out OUT --heights
    python3 -I docs/research/tx-grain.py OUT

Per family and column (rock: crests asked to follow txRockAngle; soil: isotropic; grass: near-fixed blades):
  std     the field's standard deviation over relief (1 = the unit variance every family aims at);
  cv      the spread of contrast: the coefficient of variation of the standard deviation over 12 x 12 windows
          (low = even contrast everywhere; Gabor's cancellations and bombing's gaps raise it);
  ang     orientation error, degrees: the structure tensor's dominant gradient direction (11 x 11 box) against the
          direction asked for (the normal of the crest direction), mean over the column;
  coh     the structure tensor's coherence (1 = perfectly oriented stripes, 0 = isotropic);
  lam     the wavelength at the peak of the radially averaged power spectrum, px (asked: 6, 3, 2.5);
  rep     repetition: the highest normalised autocorrelation at lags of 62-66 px in any direction (the tile is 64 px).
Needs numpy only.
"""
import os
import sys

import numpy as np

W, H, COLW, RELIEF, TILE = 384, 288, 128, 1.2, 64
FAMS = ['value', 'stripes', 'gabor', 'phasor', 'lrp', 'bomb', 'tile', 'hpn']
COLS = [('rock', 6.0), ('soil', 3.0), ('grass', 2.5)]


def box(a, r):
    k = np.ones(2 * r + 1) / (2 * r + 1)
    a = np.apply_along_axis(lambda v: np.convolve(v, k, 'same'), 0, a)
    return np.apply_along_axis(lambda v: np.convolve(v, k, 'same'), 1, a)


def asked_angle(x, y, col):
    # The crest direction the module asks for (txAngle), so the gradient should point along it + 90 degrees.
    if col == 0:
        return 0.6 + 1.0 * np.sin(y / 70.0) + 0.5 * np.sin(x / 55.0)
    return 1.25 + 0.25 * np.sin(y / 40.0)


def measure(f, col, x0):
    m = 8
    a = f[m:-m, x0 + m:x0 + COLW - m] / RELIEF
    hh, ww = a.shape
    out = {'std': a.std()}
    win = 12
    stds = np.array([a[j:j + win, i:i + win].std() for j in range(0, hh - win + 1, win) for i in range(0, ww - win + 1, win)])
    out['cv'] = stds.std() / stds.mean()
    gy, gx = np.gradient(a)
    jxx, jxy, jyy = box(gx * gx, 5), box(gx * gy, 5), box(gy * gy, 5)
    ang = 0.5 * np.arctan2(2 * jxy, jxx - jyy)
    tr = jxx + jyy
    coh = np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2) / np.maximum(tr, 1e-12)
    yy, xx = np.mgrid[m:H - m, x0 + m:x0 + COLW - m] + 0.5
    s = slice(6, -6)
    out['coh'] = coh[s, s].mean()
    if col != 1:
        want = asked_angle(xx, yy, col) + np.pi / 2
        d = np.abs((ang - want + np.pi / 2) % np.pi - np.pi / 2)
        out['ang'] = np.degrees(d[s, s].mean())
    else:
        out['ang'] = float('nan')
    z = (a - a.mean()) * np.outer(np.hanning(hh), np.hanning(ww))
    P = np.abs(np.fft.fft2(z, (256, 256))) ** 2
    fy, fx = np.meshgrid(np.fft.fftfreq(256), np.fft.fftfreq(256), indexing='ij')
    fr = np.sqrt(fx ** 2 + fy ** 2)
    bins = np.arange(0.02, 0.5, 0.01)
    rad = np.array([P[(fr >= b) & (fr < b + 0.01)].mean() for b in bins])
    out['lam'] = 1.0 / (bins[rad.argmax()] + 0.005)
    # Autocorrelation by FFT with zero padding, normalised by the overlap at each lag.
    zz = a - a.mean()
    F = np.fft.fft2(zz, (2 * hh, 2 * ww))
    ac = np.real(np.fft.ifft2(np.abs(F) ** 2))
    cnt = np.real(np.fft.ifft2(np.abs(np.fft.fft2(np.ones_like(zz), (2 * hh, 2 * ww))) ** 2))
    ac = ac / np.maximum(cnt, 1) / zz.var()
    ly, lx = np.meshgrid(np.fft.fftfreq(2 * hh) * 2 * hh, np.fft.fftfreq(2 * ww) * 2 * ww, indexing='ij')
    lr = np.sqrt(lx ** 2 + ly ** 2)
    ok = (lr >= TILE - 2) & (lr <= TILE + 2) & (cnt > 0.25 * hh * ww)
    out['rep'] = ac[ok].max()
    return out


def main():
    d = sys.argv[1]
    print(f'{"family":>8} | ' + ' | '.join(f'{n:^34}' for n, _ in COLS))
    print(f'{"":>8} | ' + ' | '.join(f'{"std":>4} {"cv":>4} {"ang":>5} {"coh":>4} {"lam":>4} {"rep":>4}' for _ in COLS))
    for fam in FAMS:
        p = os.path.join(d, f'tx-grain--{fam}.f32')
        if not os.path.exists(p):
            continue
        f = np.fromfile(p, dtype=np.float32).reshape(H, W).astype(np.float64)
        cells = []
        for col, (name, lam) in enumerate(COLS):
            r = measure(f, col, col * COLW)
            cells.append(f'{r["std"]:4.2f} {r["cv"]:4.2f} {r["ang"]:5.1f} {r["coh"]:4.2f} {r["lam"]:4.1f} {r["rep"]:4.2f}')
        print(f'{fam:>8} | ' + ' | '.join(cells))


if __name__ == '__main__':
    main()
