"""How far each reproduction window is from its own retail crop, in one number per window, from a stats.py run.

  retail_gap.py <stats.json> [--base <stats.json>] [--worst 5]

For every window, each metric's gap is |ours - retail| in units of the world's retail family band (p90 - p10 of stats.py's seeded
family windows), so a gap of 1 is as far as the spread of the world's own retail maps. A window's scores are the mean gap over
its `height.*` metrics (the shape: slopes, roughness, water, shore) and over its `pic.*` metrics (the look: luma, colour
histogram, edges, band-pass energy, thin dark lines); lower is closer, 0 is retail. AGENTS.md rule 10: fix the shape before the
colour. `in` counts the metrics where ours falls inside the family band. A metric whose band is empty (p90 = p10) or undefined
for either side is left out. Each metric's gap counts at most GAP_CAP band widths in the means: red-3's waterline drew 230 thin dark
pixels in a million, 7 band widths on Red's narrow family band, and that one metric made up half of the window's look score. The
`furthest` list prints the uncapped gap.

With --base (the stats.json of an earlier run, such as the world's renders before a change) each score is followed by the base's
score and the change; a change below 0 is closer to retail. Exit 0 always: the numbers inform a judgement, they are not a gate.
"""
import argparse
import json
import math

GAP_CAP = 3.0   # a metric counts at most this many family band widths in a window's mean


def gaps(world, window):
    out = {}
    rng = world['family']['range']
    for key, r in rng.items():
        lo, hi = r.get('p10'), r.get('p90')
        a, b = window['retail'].get(key), window['ours'].get(key)
        if None in (lo, hi, a, b) or not all(math.isfinite(x) for x in (lo, hi, a, b)) or hi - lo <= 0:
            continue
        raw = abs(b - a) / (hi - lo)
        out[key] = {'gap': min(raw, GAP_CAP), 'raw': raw, 'retail': a, 'ours': b, 'inside': lo <= b <= hi}
    return out


def scores(g):
    part = lambda prefix: [v['gap'] for k, v in g.items() if k.startswith(prefix)]
    mean = lambda xs: sum(xs) / len(xs) if xs else float('nan')
    return {'shape': mean(part('height.')), 'look': mean(part('pic.')), 'inside': sum(v['inside'] for v in g.values()), 'total': len(g)}


def table(stats):
    out = {}
    for name, world in stats['worlds'].items():
        for window in world['windows']:
            g = gaps(world, window)
            out[window['name']] = {'world': name, 'gaps': g, **scores(g)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('stats')
    ap.add_argument('--base', default='')
    ap.add_argument('--worst', type=int, default=5, help='the metrics with the largest gap to list per window')
    args = ap.parse_args()
    now = table(json.load(open(args.stats)))
    base = table(json.load(open(args.base))) if args.base else {}
    fmt = lambda x: f'{x:5.2f}' if math.isfinite(x) else '  nan'
    for name, w in now.items():
        line = f"{name:16s} shape {fmt(w['shape'])}  look {fmt(w['look'])}  in band {w['inside']:2d}/{w['total']}"
        b = base.get(name)
        if b:
            line += f"   base shape {fmt(b['shape'])} ({w['shape'] - b['shape']:+.2f})  look {fmt(b['look'])} ({w['look'] - b['look']:+.2f})  in band {b['inside']}"
        print(line)
        worst = sorted(w['gaps'].items(), key=lambda kv: -kv[1]['raw'])[:args.worst]
        print('    furthest: ' + '; '.join(f"{k} {v['raw']:.2f}{' (counts ' + format(GAP_CAP, '.0f') + ')' if v['raw'] > GAP_CAP else ''} (retail {v['retail']:.3g}, ours {v['ours']:.3g})" for k, v in worst))
    if len(now) > 1:
        shape = [w['shape'] for w in now.values() if math.isfinite(w['shape'])]
        look = [w['look'] for w in now.values() if math.isfinite(w['look'])]
        line = f"{'mean':16s} shape {fmt(sum(shape) / len(shape))}  look {fmt(sum(look) / len(look))}"
        if base:
            bs = [base[n]['shape'] for n in now if n in base and math.isfinite(base[n]['shape'])]
            bl = [base[n]['look'] for n in now if n in base and math.isfinite(base[n]['look'])]
            if bs and bl:
                line += f"   base shape {fmt(sum(bs) / len(bs))}  look {fmt(sum(bl) / len(bl))}"
        print(line)


if __name__ == '__main__':
    main()
