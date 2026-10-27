"""Fit brightness = a + b*dh/dx + c*dh/dy over sloped ground (16-px cells).

dh/dx > 0 means ground rises to the east (faces west); dh/dy > 0 rises to
the south (faces north). b < 0 means east-facing... see sign notes below.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

def cells_retail(man, root, kinds):
    X, Y = [], []
    for s in json.load(open(man))['sections']:
        if s['world'] != 'greenworld' or s['kind'] not in kinds: continue
        art = np.asarray(Image.open(Path(root) / s['art']).convert('RGB')).astype(np.float32)
        h = np.asarray(Image.open(Path(root) / s['heights'])).astype(np.float32)
        gy, gx = np.gradient(h, 16.0)
        H, W = art.shape[:2]
        for cy in range(1, h.shape[0] - 1):
            for cx in range(1, h.shape[1] - 1):
                x = cx * 16 + 8; y = int(cy * 16 + 8 - h[cy, cx] / 2)
                if y < 4 or y + 4 > H or x + 4 > W: continue
                win = art[y-4:y+4, x-4:x+4].reshape(-1, 3)
                if ((win[:, 2] > win[:, 1] + 8) & (win[:, 2] > win[:, 0] + 8)).mean() > .2: continue
                X.append((gx[cy, cx], gy[cy, cx])); Y.append((.299*win[:,0]+.587*win[:,1]+.114*win[:,2]).mean())
    return np.array(X), np.array(Y)

def cells_ours(stems):
    X, Y = [], []
    for stem in stems:
        art = np.asarray(Image.open(stem + '.png').convert('RGB')).astype(np.float32)
        d = json.load(open(stem + '.heights.json')); g = d['grid']
        h = np.array(d['heights'], np.float32).reshape(g, g)
        n = g // 8; c = h[:n*8, :n*8].reshape(n, 8, n, 8).mean(axis=(1, 3))
        gy, gx = np.gradient(c, 16.0)
        for cy in range(1, n - 1):
            for cx in range(1, n - 1):
                if c[cy, cx] < d['sea'] + 1: continue
                x = cx * 16 + 8; y = int(cy * 16 + 8 - (c[cy, cx] - d['base']) / 2)
                if y < 4 or y + 4 > d['size']: continue
                win = art[y-4:y+4, x-4:x+4].reshape(-1, 3)
                X.append((gx[cy, cx], gy[cy, cx])); Y.append((.299*win[:,0]+.587*win[:,1]+.114*win[:,2]).mean())
    return np.array(X), np.array(Y)

def fit(name, X, Y):
    s = np.hypot(X[:, 0], X[:, 1]); m = (s > .15) & (s < 1.2)
    A = np.c_[np.ones(m.sum()), X[m]]
    coef, *_ = np.linalg.lstsq(A, Y[m], rcond=None)
    flat = Y[s < .05].mean()
    b, c = coef[1], coef[2]
    # Brightness rises fastest when the ground rises along (b, c): the slope
    # then faces the opposite way, toward the light.
    ang = np.degrees(np.arctan2(-c, -b))
    print(f'{name}: n={m.sum()} flat luma {flat:.1f}; d luma/d slope east {b:+.1f}, south {c:+.1f}; '
          f'strength {np.hypot(b, c):.1f} per unit slope; slopes facing toward ({-b:+.1f},{-c:+.1f}) are brightest '
          f'(angle {ang:.0f} deg, 0=east, 90=south)')

if __name__ == '__main__':
    if sys.argv[1] == 'retail':
        fit('retail green hills+coast', *cells_retail(sys.argv[2], sys.argv[3], {'hills', 'coast', 'island', 'old coast'}))
    else:
        fit(sys.argv[2], *cells_ours(sys.argv[3:]))
