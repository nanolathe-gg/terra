"""Rock-face statistics for the Green windows (card E9): one row per image of
what the eye reads on a face, so retail | ours can be compared by number as
well as by picture. Nothing here is retail data; it reads whatever images it
is given.

  rock_face.py <label>=<png> [<label>=<png> ...] [--box x0,y0,x1,y1] [--rockonly]

--box picks the window (default green-2's face, x 20-880, y 650-870).
--rockonly keeps only pixels that are not grass-dominated (green-1 and
green-3 carry sparse grey patches, not a face).

Columns:
  green     share of pixels where green leads red and blue by 6 (grass or moss)
  mean, sd  luma on the kept pixels; lo / hi are the shares under 30 and over 90
  low       sd of luma blurred at sigma 5 px: the form of the face (gullies, ribs)
  stripe    variance of luma blurred 30 px along the lean (-22 degrees off
            vertical) over the variance blurred 30 px across it: above 1 the
            face is striped along the lean
  rows      same along the horizontal over across the vertical (bed lines)
  grad      90th percentile of the luma gradient (sharp facets read high)
  dark v|h  share of dark thin-line response within 25 degrees of vertical | horizontal
  period    first autocorrelation peak of the row-mean profile, px (beds)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def luma(a):
    return a[..., 0] * .299 + a[..., 1] * .587 + a[..., 2] * .114


def oriented_blur(L, deg_from_vertical, sigma_along, sigma_across):
    # Blur long along a direction, short across it: rotate, blur axis-aligned, rotate back.
    rot = ndi.rotate(L, -deg_from_vertical, reshape=True, order=1, mode='reflect')
    out = ndi.gaussian_filter(rot, (sigma_along, sigma_across))
    return out


def stripe_ratio(L, deg):
    # Variance of the long-blurred signal along the lean vs across it.
    a = oriented_blur(L, deg, 30, 1.5)
    b = oriented_blur(L, deg + 90, 30, 1.5)
    c = a.shape[0] // 4, a.shape[1] // 4
    va = a[c[0]:-c[0], c[1]:-c[1]].var()
    vb = b[c[0]:-c[0], c[1]:-c[1]].var()
    return va / max(vb, 1e-6)


def thin_lines(L):
    # Dark ridge response: black top-hat minus the local median, then orientation by the Hessian.
    s = ndi.gaussian_filter(L, 1.2)
    hxx = ndi.gaussian_filter(L, 1.2, order=(0, 2))
    hyy = ndi.gaussian_filter(L, 1.2, order=(2, 0))
    hxy = ndi.gaussian_filter(L, 1.2, order=(1, 1))
    tr, det = hxx + hyy, hxx * hyy - hxy ** 2
    disc = np.sqrt(np.maximum(tr * tr / 4 - det, 0))
    l1 = tr / 2 + disc            # the large eigenvalue: positive across a dark line
    # eigenvector of l1: across the line; the line runs perpendicular to it
    ang = 0.5 * np.arctan2(2 * hxy, hxx - hyy)      # direction of the principal axis
    line = np.degrees(ang) + 90.0                    # image-axes angle of the line (x right, y down)
    strong = l1 > 6.0
    return strong, np.mod(line, 180.0)


def row_period(L):
    prof = L.mean(axis=1)
    prof = prof - ndi.uniform_filter1d(prof, 41)
    n = len(prof)
    ac = np.correlate(prof, prof, 'full')[n - 1:]
    ac = ac / ac[0]
    for k in range(4, 40):
        if ac[k] > ac[k - 1] and ac[k] >= ac[k + 1] and ac[k] > 0.05:
            return k
    return 0


def stats(path, box, rockonly):
    im = np.asarray(Image.open(path).convert('RGB'), np.float32)
    x0, y0, x1, y1 = box
    a = im[y0:y1, x0:x1]
    L = luma(a)
    green = (a[..., 1] > a[..., 0] + 6) & (a[..., 1] > a[..., 2] + 6)
    keep = ~green if rockonly else np.ones_like(green)
    k = keep
    row = dict(green=green.mean(), mean=L[k].mean(), sd=L[k].std(), lo=(L[k] < 30).mean(), hi=(L[k] > 90).mean())
    row['low'] = ndi.gaussian_filter(L, 5)[k].std()
    row['stripe'] = stripe_ratio(L, -22.0)
    row['rows'] = stripe_ratio(L, 90.0) if False else (lambda A, B: A.var() / max(B.var(), 1e-6))(ndi.gaussian_filter(L, (1.5, 30)), ndi.gaussian_filter(L, (30, 1.5)))
    gy, gx = np.gradient(ndi.gaussian_filter(L, 0.8))
    gm = np.hypot(gx, gy)
    row['grad'] = np.percentile(gm[k], 90)
    strong, ang = thin_lines(L)
    s = strong & k
    n = max(s.sum(), 1)
    vert = (np.abs(ang - 90) < 25)
    hor = (ang < 25) | (ang > 155)
    row['dv'] = (s & vert).sum() / n
    row['dh'] = (s & hor).sum() / n
    row['dens'] = s.mean()
    row['period'] = row_period(L)
    return row


def main():
    args = sys.argv[1:]
    box, rockonly = (20, 650, 880, 870), False
    if '--box' in args:
        i = args.index('--box'); box = tuple(int(v) for v in args[i + 1].split(',')); del args[i:i + 2]
    if '--rockonly' in args:
        args.remove('--rockonly'); rockonly = True
    print(f"{'':28s} green   mean    sd    lo    hi    low stripe  rows  grad  dark v|h     dens period")
    for item in args:
        label, path = item.split('=', 1)
        r = stats(path, box, rockonly)
        print(f"{label:28s} {r['green']:5.3f} {r['mean']:6.1f} {r['sd']:5.1f} {r['lo']:5.3f} {r['hi']:5.3f} {r['low']:6.2f} {r['stripe']:6.2f} {r['rows']:5.2f} {r['grad']:5.1f}  {r['dv']:.2f} {r['dh']:.2f}  {r['dens']:6.3f} {r['period']:4d}")


if __name__ == '__main__':
    main()
