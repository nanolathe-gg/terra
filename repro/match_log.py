"""Retail match harness: the trial log. repro/match.sh calls `record` after each trial; agents and reviewers call `show`.

  match_log.py record <trial-dir> --ledger FILE --kind trial|probe|holdout --note TEXT [--query Q] [--commit SHA] [--diff FILE]
  match_log.py show --ledger FILE [--last N]

`record` reads <trial-dir>/stats/stats.json (retail_gap.py's shape and look per window) and <trial-dir>/classes/classes.json
(match_classes.py's findings), appends one JSON line to the ledger and prints the trial against the base (the first trial of the
same kind: trial-000 for trials and probes, holdout-000 for the held-out window) and against the previous trial: scores per window,
the findings that cleared and the ones that appeared since the base, and the largest findings left. Lower scores are closer to retail.
"""
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from retail_gap import table  # noqa: E402


def mean(xs):
    xs = [x for x in xs if isinstance(x, (int, float)) and math.isfinite(x)]
    return sum(xs) / len(xs) if xs else float('nan')


def entries(ledger):
    p = Path(ledger)
    if not p.exists():
        return []
    return [json.loads(line) for line in p.read_text().splitlines() if line.strip()]


def fmt(x):
    return f'{x:.2f}' if isinstance(x, (int, float)) and math.isfinite(x) else ' nan'


def delta(a, b):
    return f'{a - b:+.2f}' if all(isinstance(v, (int, float)) and math.isfinite(v) for v in (a, b)) else '   '


LABELS = {'luma': 'luma', 'spread': 'spread', 'band2': 'grain 2px', 'band8': 'texture 8px', 'band32': 'patches 32px', 'edges': 'edges', 'lines': 'lines'}


def class_moves(base_dir, trial_dir, window, top=4):
    """The largest changes in ours' per-class numbers against the base, with retail's for reference, so a probe shows what a control
    moves even when no finding crosses a threshold."""
    try:
        b = json.loads((Path(base_dir) / 'classes' / 'classes.json').read_text())[window]['classes']
        n = json.loads((Path(trial_dir) / 'classes' / 'classes.json').read_text())[window]['classes']
    except (OSError, KeyError, ValueError):
        return []
    out = []
    for cls, v in n.items():
        o, ob, r = v['ours'], b.get(cls, {}).get('ours', {}), v['retail']
        for k, label in LABELS.items():
            if k not in o or k not in ob:
                continue
            x, y = ob[k], o[k]
            if k == 'luma':
                size = abs(y - x) / 4.0
                text = f"{cls} {label} {x:.0f}->{y:.0f} (retail {r.get(k, float('nan')):.0f})"
            else:
                if max(x, y) <= 1e-4:
                    continue
                size = abs(math.log((y + 1e-4) / (x + 1e-4))) / math.log(1.1)
                text = f"{cls} {label} {x:.3g}->{y:.3g} (retail {r.get(k, float('nan')):.3g})"
            if size >= 1:
                out.append((size, text))
    out.sort(key=lambda s: -s[0])
    return [t for _, t in out[:top]]


def record(a):
    t = Path(a.trial)
    stats = json.loads((t / 'stats' / 'stats.json').read_text())
    classes = json.loads((t / 'classes' / 'classes.json').read_text())
    windows = {}
    for name, w in table(stats).items():
        f = classes.get(name, {}).get('findings', [])
        windows[name] = {'shape': w['shape'], 'look': w['look'], 'inside': w['inside'], 'total': w['total'],
                         'findings': [{'key': x['key'], 'size': x['size'], 'text': x['text']} for x in f]}
    diff = Path(a.diff).read_bytes() if a.diff and Path(a.diff).exists() else b''
    e = {'trial': t.name, 'kind': a.kind, 'time': time.strftime('%Y-%m-%dT%H:%M:%S'), 'note': a.note, 'query': a.query,
         'commit': a.commit, 'diff_sha': hashlib.sha1(diff).hexdigest()[:12] if diff else '', 'diff_lines': diff.count(b'\n'),
         'shape': mean(w['shape'] for w in windows.values()), 'look': mean(w['look'] for w in windows.values()), 'windows': windows}
    prior = entries(a.ledger)
    base_kind = 'holdout' if a.kind == 'holdout' else 'trial'
    base = next((p for p in prior if (p['kind'] == 'holdout') == (base_kind == 'holdout')), None)
    prev = next((p for p in reversed(prior) if (p['kind'] == 'holdout') == (base_kind == 'holdout')), None)
    with open(a.ledger, 'a') as fh:
        fh.write(json.dumps(e) + '\n')
    print(f"\n{e['trial']} ({a.kind}) {a.note!r}{'  query ' + a.query if a.query else ''}")
    if base and base is not e and all(abs(w['look'] - base['windows'].get(n, {}).get('look', -1)) < 1e-9 and abs(w['shape'] - base['windows'].get(n, {}).get('shape', -1)) < 1e-9 for n, w in windows.items()):
        print('  NOTE: renders exactly as the base on every window: this change reaches none of these windows (check gates, which rock the strokes use, or a scene query that overrides it).')
    if prev and prev.get('diff_sha') == e['diff_sha'] and prev.get('query', '') == e['query']:
        print(f"  WARNING: nothing changed since {prev['trial']} (same file diff, same query). Did your edit save? `git diff` shows what a trial renders.")
    line = f"  mean      shape {fmt(e['shape'])}  look {fmt(e['look'])}"
    if base:
        line += f"   vs base {base['trial']}: shape {delta(e['shape'], base['shape'])} look {delta(e['look'], base['look'])}"
    if prev and prev is not base:
        line += f"   vs previous {prev['trial']}: shape {delta(e['shape'], prev['shape'])} look {delta(e['look'], prev['look'])}"
    print(line)
    for name, w in windows.items():
        b = base['windows'].get(name) if base else None
        s = f"  {name:9s} shape {fmt(w['shape'])}  look {fmt(w['look'])}  in band {w['inside']}/{w['total']}"
        if b:
            s += f"   vs base: shape {delta(w['shape'], b['shape'])} look {delta(w['look'], b['look'])}"
        print(s)
        if b:
            now = {f['key'] for f in w['findings']}
            then = {f['key'] for f in b['findings']}
            if then - now:
                print(f"      cleared since base: {', '.join(sorted(then - now))}")
            if now - then:
                print(f"      new since base:     {', '.join(sorted(now - then))}")
        for f in w['findings'][:3]:
            print(f"      {f['size']:4.1f} {f['text']}")
        moved = class_moves(a.base, t, name) if a.base and Path(a.base).resolve() != t.resolve() else []
        if moved:
            print('      moved vs base (ours): ' + '; '.join(moved))
    print(f"  details: {t}/gap.txt, {t}/classes/classes.md, crops {t}/classes/crops/<window>/<class>.png, pairs {t}/scenes/<window>/pair.png")


def show(a):
    es = entries(a.ledger)
    if not es:
        print('no trials yet')
        return
    names = list(es[0]['windows'])
    print(f"{'trial':12s} {'kind':8s} {'shape':>5s} {'look':>5s}  " + ' '.join(f'{n[-9:]:>9s}' for n in names) + '  note')
    for e in es[-a.last:] if a.last else es:
        per = ' '.join(f"{fmt(e['windows'][n]['look']) if n in e['windows'] else '-':>9s}" for n in names)
        print(f"{e['trial']:12s} {e['kind']:8s} {fmt(e['shape']):>5s} {fmt(e['look']):>5s}  {per}  {e['note']}{' [' + e['query'] + ']' if e['query'] else ''}")
    print('(per-window columns are the look score; lower is closer to retail)')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('record')
    r.add_argument('trial')
    r.add_argument('--ledger', required=True)
    r.add_argument('--kind', default='trial', choices=['trial', 'probe', 'holdout'])
    r.add_argument('--note', default='')
    r.add_argument('--query', default='')
    r.add_argument('--commit', default='')
    r.add_argument('--diff', default='')
    r.add_argument('--base', default='', help='the base trial folder, for per-class changes')
    s = sub.add_parser('show')
    s.add_argument('--ledger', required=True)
    s.add_argument('--last', type=int, default=0)
    a = ap.parse_args()
    (record if a.cmd == 'record' else show)(a)


if __name__ == '__main__':
    main()
