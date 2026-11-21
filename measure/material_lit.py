"""What a lit height field needs from a prepared image (card H14b): numbers measured on the image, and the metrics a swatch is judged by.

A dev tool library (material_numbers.py writes these into `measured[name].lit`; material_fit.py and the lab compare swatches with them).
Retail art is a height field lit from one direction and reduced to a palette. The image shows the lit result only, so what can be read
from it is its structure, not the height:

  gradAxis     angle (degrees, image coordinates, x right, y down, folded to 0..180) of the major axis of the structure tensor of luma
               blurred at sigma 1. For a lit isotropic height the luma is a directional derivative of it, so its gradient power is
               largest along the light's azimuth: this is the light's axis (the sign, toward or away from the light, is not in the image).
  coherence    (l1 - l2) / (l1 + l2) of that tensor: 0 isotropic, 1 all one direction. It mixes the light's effect with real streaks.
  light        the light's azimuth in turns (0 = from +x, a quarter turn towards +y, which is down the screen) for the generator's `light`:
               the gradient axis, on the side facing west (retail's light comes from the west, docs/retail-match/EXPERIMENTS.md rows 66 and 82). The image cannot
               tell the two ends of the axis apart; this convention picks the one.
  streak       angle (degrees) of the long axis of the structure at sigma 4, and its coherence: where the grain runs.
  shear        the whole-number slope k (y = -k x) nearest the streak angle, what the generator can wrap (engine-materials.wgsl).
  dark         share of pixels darker than half the median luma.
  seam         dark lines: share of pixels under half the luma of their 4-px-sigma neighbourhood (a polygon crack in Crystal's slope gives 3.9%
               where its plain gives 0.7%; a luma top-hat does not tell them apart in these dithered images), their mean width in px
               (area / skeleton length), and the line length per px^2 (`seamLength`).
  cell         2 / seamLength: the spacing of a closed network of seams (for a Voronoi network the edge length per area is 2/s).
  vein         pixels more than 80 levels (RGB distance) from the image's mean colour, for thin lines in a colour of their own (Archipelago's
               magenta strokes on pale mineral):
               share, width, length per area, spacing (1 / length, an open network), and the lines' mean colour.
"""
import numpy as np
from scipy import ndimage as ndi

LUMA = np.array([.299, .587, .114])


def tensor(L, sigma, mode='wrap'):
    g = ndi.gaussian_filter(L, sigma, mode=mode)
    gy, gx = np.gradient(g)
    jxx, jyy, jxy = (gx * gx).mean(), (gy * gy).mean(), (gx * gy).mean()
    tr, det = jxx + jyy, jxx * jyy - jxy * jxy
    disc = np.sqrt(max(tr * tr / 4 - det, 0.0))
    l1, l2 = tr / 2 + disc, tr / 2 - disc
    angle = 0.5 * np.degrees(np.arctan2(2 * jxy, jxx - jyy)) % 180.0
    return angle, float((l1 - l2) / max(l1 + l2, 1e-9))


def line_stats(mask):
    """Width (px) and length per px^2 of a thin-line mask: area over skeleton length, the skeleton being the ridge of the distance transform."""
    area = float(mask.sum())
    if area < 1:
        return 0.0, 0.0
    edt = ndi.distance_transform_edt(mask)
    ridge = mask & (edt >= ndi.maximum_filter(edt, 3) - 1e-9) & (edt > 0)
    length = max(float(ridge.sum()), 1.0)
    return area / length, length / mask.size


def dark_lines(L):
    return L < 0.5 * ndi.gaussian_filter(L, 4, mode='wrap')


def vein_mask(a):
    return np.linalg.norm(a - a.reshape(-1, 3).mean(0), axis=-1) > 80.0


def lit_numbers(a):
    """a: H x W x 3 float image. The structure numbers above."""
    L = a @ LUMA
    ang, coh = tensor(L, 1.0)
    sang, scoh = tensor(L, 4.0)
    shear = int(np.clip(round(-np.tan(np.radians(sang if sang < 90 else sang - 180))), -4, 4)) if scoh > 0.02 else 0
    seam = dark_lines(L)
    w, length = line_stats(seam)
    vein = vein_mask(a)
    vw, vlen = line_stats(vein)
    vcol = a[vein].mean(0) if vein.sum() > 8 else a.reshape(-1, 3).mean(0)
    toward = ang if ang < 90 else ang - 180          # the axis as an angle in (-90, 90]: its +x end
    light = ((toward + 180.0) % 360.0) / 360.0       # the end that faces west
    return {'gradAxis': round(float(ang), 1), 'light': round(light, 3), 'coherence': round(coh, 3), 'streak': round(float(sang), 1), 'streakCoherence': round(scoh, 3),
            'shear': shear, 'dark': round(float((L < 0.5 * np.median(L)).mean()), 4),
            'seam': round(float(seam.mean()), 4), 'seamWidth': round(w, 2), 'seamLength': round(length, 4),
            'cell': round(2.0 / length, 1) if length > 0 else 0.0,
            'vein': round(float(vein.mean()), 4), 'veinWidth': round(vw, 2), 'veinLength': round(vlen, 4),
            'veinSpacing': round(1.0 / vlen, 1) if vlen > 0 else 0.0, 'veinRGB': [round(float(v), 1) for v in vcol]}


def compare(a):
    """The numbers a swatch is judged by against its image (both H x W x 3, palette-snapped): luma mean, s.d., s.d. of the 5-px mean,
    luma correlation at 1 and 2 px along x and y, structure tensor angle and coherence at sigma 1, dark share, thin-dark-line share."""
    L = a @ LUMA
    d = L - L.mean()
    lag = lambda k, ax: float((d * np.roll(d, -k, axis=ax)).mean() / d.var())
    ang, coh = tensor(L, 1.0)
    sd = float(L.std())
    m1 = ndi.uniform_filter(L, 9, mode='wrap')
    flat = float((np.sqrt(np.maximum(ndi.uniform_filter(L * L, 9, mode='wrap') - m1 * m1, 0.0)) < 0.3 * sd).mean())
    return {'flat': round(flat, 3), 'mean': round(float(L.mean()), 1), 'sd': round(sd, 1), 'sd5': round(float(ndi.uniform_filter(L, 5, mode='wrap').std()), 1),
            'lag': [round(lag(1, 1), 2), round(lag(2, 1), 2), round(lag(1, 0), 2), round(lag(2, 0), 2)],
            'axis': round(float(ang), 0), 'coh': round(coh, 2), 'dark': round(float((L < 0.5 * np.median(L)).mean()), 3),
            'seam': round(float(dark_lines(L).mean()), 3)}
