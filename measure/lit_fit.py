"""Fit a lit material's numbers to its prepared image (card H14b). A dev tool; material_fit.py --lit calls it.

The generator's picture cannot be solved for in closed form, so this is a pattern search on rendered swatches. Each round makes
one candidate per number and direction (every candidate a layer of one table, all with layer 0's noise, so they differ only in
their numbers), renders them in one Chrome session (swatch.mjs --auto-zq --same-seed: the rank quantiles are each candidate's own,
so the histogram is the image's by construction), scores each against the image's palette-snapped tile, and takes the best moves.

Score (sum, lower is better, each term a log-ratio or a difference scaled to about 1 for a visible miss):
  the six luma octave bands, the s.d. and the s.d. of the 5-px mean, luma correlation at 1 and 2 px along x and along y, the share of
  pixels darker than half the median luma, the share of dark lines (pixels under half the luma of their neighbourhood), the structure
  tensor's coherence and orientation, the share of flat pixels (9 x 9 luma s.d. under 0.3 of the image's: planar facets and the lack of them), the kurtosis of the luma gradient (how crisp the facet edges are), and where the material has
  veins the share of pixels far from the mean colour.
Numbers whose generator feature is off in the starting point (cell 0, no veins) stay off.

  lit_fit.py <table.json> <material> <image> <assets-dir> <work-dir> [--cdp 9681] [--rounds 12] [--fix key,key]
Writes the best numbers into <table.json> (`model.<material>.lit`, amps, stretch, tintScale, zq) and prints the score trace.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import material_lit as ml
import material_swatches as ms

LUMA = np.array([.299, .587, .114])
SIGMAS = [0.0] + [0.7 * 2 ** k for k in range(7)]
# name: (low, high, step, kind)  kind 'x' multiplicative step, '+' additive; amps are searched as amp1..amp6 and a0
SPACE = {
    'relief': (0.3, 6.0, 1.3, 'x'), 'ridged': (0.0, 1.0, 0.15, '+'), 'cell': (8.0, 96.0, 1.25, 'x'), 'tilt': (0.05, 4.0, 1.3, 'x'),
    'tone': (0.0, 3.0, 0.25, '+'), 'seamWidth': (0.5, 12.0, 1.3, 'x'), 'seamDepth': (0.0, 8.0, 0.5, '+'), 'warp': (0.0, 24.0, 3.0, '+'),
    'cone': (0.0, 4.0, 0.3, '+'), 'seamVary': (0.0, 1.0, 0.25, '+'), 'seamGap': (0.05, 0.95, 0.1, '+'), 'veinWidth': (0.6, 6.0, 1.25, 'x'), 'veinSpacing': (12.0, 160.0, 1.25, 'x'),
    'veinShare': (0.05, 0.95, 0.1, '+'),
}

def stats(a):
    L = a @ LUMA
    sd = float(L.std())
    blurred = [L if s == 0 else ndi.gaussian_filter(L, s, mode='wrap') for s in SIGMAS]
    d = L - L.mean()
    lag = lambda k, ax: float((d * np.roll(d, -k, axis=ax)).mean() / d.var())
    ang, coh = ml.tensor(L, 1.0)
    gy, gx = np.gradient(ndi.gaussian_filter(L, 0.8, mode='wrap'))
    g = np.hypot(gx, gy)
    m1 = ndi.uniform_filter(L, 9, mode='wrap')
    local = np.sqrt(np.maximum(ndi.uniform_filter(L * L, 9, mode='wrap') - m1 * m1, 0.0))
    out = {'flat': float((local < 0.3 * sd).mean()), 'bands': np.array([float((blurred[k] - blurred[k + 1]).std()) for k in range(6)]), 'sd': sd,
           'sd5': float(ndi.uniform_filter(L, 5, mode='wrap').std()), 'lag': np.array([lag(1, 1), lag(2, 1), lag(1, 0), lag(2, 0)]),
           'dark': float((L < 0.5 * np.median(L)).mean()), 'coh': coh, 'axis': ang, 'kurt': float(((g - g.mean()) ** 4).mean() / g.var() ** 2),
           'seam': float(ml.dark_lines(L).mean())}
    out['vein'] = float(ml.vein_mask(a).mean())
    return out


def score(c, t, veins):
    lr = lambda x, y: abs(np.log(max(x, 1e-3) / max(y, 1e-3)))
    s = sum(lr(c['bands'][k], t['bands'][k]) for k in range(6))
    s += 1.5 * (lr(c['sd'], t['sd']) + lr(c['sd5'], t['sd5']))
    s += 3.0 * float(np.abs(c['lag'] - t['lag']).sum())
    s += abs(c['dark'] - t['dark']) / 0.04 + lr(c['seam'] + 0.002, t['seam'] + 0.002)
    s += 2.0 * abs(c['coh'] - t['coh'])
    da = abs(c['axis'] - t['axis']) % 180
    s += min(da, 180 - da) / 30.0 * min(c['coh'], t['coh']) * 4
    s += lr(c['kurt'], t['kurt'])
    s += 2.0 * lr(c['flat'] + 0.02, t['flat'] + 0.02)
    if veins:
        s += lr(c['vein'] + 0.002, t['vein'] + 0.002)
    return float(s)


def candidate_table(base, name, models):
    table = {'order': [f'c{i}' for i in range(len(models))], 'measured': {}, 'model': {}}
    for i, m in enumerate(models):
        table['measured'][f'c{i}'] = base['measured'][name]
        table['model'][f'c{i}'] = m
    return table


def render(base, name, models, work, cdp, lut):
    work.mkdir(parents=True, exist_ok=True)
    tab = work / 'cands.json'
    tab.write_text(json.dumps(candidate_table(base, name, models)))
    r = subprocess.run(['node', str(HERE / 'swatch.mjs'), str(tab), str(work / 'raw'), '--foot', '1', '--auto-zq', '--same-seed', '--cdp', str(cdp)], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stdout + r.stderr)
    meta = json.loads((work / 'raw' / 'meta.json').read_text())
    out = []
    for i, m in enumerate(models):
        raw = np.fromfile(work / 'raw' / f'c{i}.rgba', np.uint8).reshape(512, 512, 4)[..., :3].astype(float)
        m = json.loads(json.dumps(m))
        m['zq'] = [round(v, 4) for v in meta['zq'][str(i)]]
        out.append((m, stats(ms.snap(lut, raw))))
    return out


def moves(model, fixed):
    """Every one-number change of a model, as (label, model)."""
    lit = model['lit']
    out = []
    names = [k for k in SPACE if k in lit and lit[k] != 0 and k not in fixed]
    for k in names:
        lo, hi, step, kind = SPACE[k]
        for sign in (-1, 1):
            v = lit[k] * (step ** sign) if kind == 'x' else lit[k] + sign * step
            v = min(max(v, lo if lit[k] > 0 or kind == 'x' else 0.0), hi)
            if abs(v - lit[k]) < 1e-9:
                continue
            m = json.loads(json.dumps(model)); m['lit'][k] = round(v, 4)
            out.append((f'{k}{"+" if sign > 0 else "-"}', m))
    for k in range(7):
        if f'amp{k}' in fixed:
            continue
        for sign in (-1, 1):
            m = json.loads(json.dumps(model)); m['amps'][k] = round(m['amps'][k] * (1.3 ** sign), 4)
            out.append((f'amp{k}{"+" if sign > 0 else "-"}', m))
    if 'stretch' not in fixed:
        for sign in (-1, 1):
            m = json.loads(json.dumps(model)); m['stretch'] = round(min(max(m['stretch'] * 1.3 ** sign, 0.15), 8.0), 3)
            out.append((f'stretch{"+" if sign > 0 else "-"}', m))
    if 'shear' not in fixed and 'shear' in lit:
        for sign in (-1, 1):
            m = json.loads(json.dumps(model)); m['lit']['shear'] = int(lit['shear'] + sign)
            if abs(m['lit']['shear']) <= 4:
                out.append((f'shear{"+" if sign > 0 else "-"}', m))
    return out


def fit(path, name, image, assets, work, cdp, rounds, fixed):
    base = json.loads(Path(path).read_text())
    lut = np.asarray(Image.open(assets / 'palette-lut.png').convert('RGB'))
    img = np.asarray(Image.open(image).convert('RGB')).astype(float)
    img = np.tile(img, (-(-512 // img.shape[0]), -(-512 // img.shape[1]), 1))[:512, :512]
    target = stats(ms.snap(lut, img))
    veins = base['model'][name]['lit'].get('veinShare', 0) > 0
    best = json.loads(json.dumps(base['model'][name]))
    (cur, cs), = render(base, name, [best], work, cdp, lut)
    best, best_score = cur, score(cs, target, veins)
    print(f'start score {best_score:.2f}', flush=True)
    for r in range(rounds):
        cands = moves(best, fixed)
        results = []
        for i in range(0, len(cands), 30):
            results += render(base, name, [m for _, m in cands[i:i + 30]], work, cdp, lut)
        scored = sorted(((score(s, target, veins), cands[i][0], m) for i, (m, s) in enumerate(results)), key=lambda x: x[0])
        improving = [x for x in scored if x[0] < best_score - 1e-3]
        if not improving:
            print(f'round {r}: no move improves; stop', flush=True)
            break
        # Apply the best move per number together (a few at once), keep it only if it beats the best single move.
        merged = json.loads(json.dumps(best))
        taken = []
        for sc, label, m in improving[:6]:
            key = label.rstrip('+-')
            if key in taken:
                continue
            taken.append(key)
            if key.startswith('amp'):
                k = int(key[3:]); merged['amps'][k] = m['amps'][k]
            elif key == 'stretch':
                merged['stretch'] = m['stretch']
            else:
                merged['lit'][key] = m['lit'][key]
        (mm, ms_), = render(base, name, [merged], work, cdp, lut)
        merged_score = score(ms_, target, veins)
        if merged_score < improving[0][0]:
            best, best_score = mm, merged_score
            print(f'round {r}: {merged_score:.2f} with {taken}', flush=True)
        else:
            (bm, bs), = render(base, name, [improving[0][2]], work, cdp, lut)
            best, best_score = bm, score(bs, target, veins)
            print(f'round {r}: {best_score:.2f} with {improving[0][1]}', flush=True)
        base['model'][name] = best
        Path(path).write_text(json.dumps(base, indent=1) + '\n')
    return best, best_score, target


def main():
    args = sys.argv[1:]
    opts = {'--cdp': '9681', '--rounds': '12', '--fix': ''}
    for flag in opts:
        if flag in args:
            i = args.index(flag); opts[flag] = args[i + 1]; del args[i:i + 2]
    path, name, image, assets, work = args[0], args[1], Path(args[2]), Path(args[3]), Path(args[4])
    fit(path, name, image, assets, work, opts['--cdp'], int(opts['--rounds']), set(filter(None, opts['--fix'].split(','))))


if __name__ == '__main__':
    main()
