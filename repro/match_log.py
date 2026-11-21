"""Retail match harness: the trial log. repro/match.sh calls `record` after each trial; agents and reviewers call `show`.

  match_log.py record <trial-dir> --ledger FILE --kind trial|probe|holdout --note TEXT [--query Q] [--commit SHA] [--diff FILE]
                      [--base DIR] [--repo DIR --world NAME]
  match_log.py show --ledger FILE [--last N]

`record` reads <trial-dir>/stats/stats.json (retail_gap.py's shape and look per window) and <trial-dir>/classes/classes.json
(match_classes.py's findings), appends one JSON line to the ledger and prints the trial against the base (the first trial of the
same kind: trial-000 for trials and probes, holdout-000 for the held-out window) and against the previous trial: scores per window,
the findings that cleared and the ones that appeared since the base, and the largest findings left. Lower scores are closer to retail.
A trial may render some of the windows (match.sh --window): its means and comparisons cover those windows only.

A finding counts as cleared only when its gap is clearly inside the threshold (size CLEAR or less, in threshold units) or fell by a
third; one that slipped just under the threshold is listed apart, as not a clear. With --repo and --world, each trial records which
levers it moved (the world file's sections, each material in textures.json, each window's scene, the query), and `show` counts the
trials per kind of lever, so a reviewer sees what was explored.
"""
import argparse
import hashlib
import json
import math
import re
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


CLEAR = .8   # a cleared finding's gap is at most this, in threshold units (1 is the threshold), or a third smaller than at the base

# The kinds of lever, by the part of the world data a trial changed (`levers`).
KINDS = [('world control', ('world.knobDefaults', 'world.engineDefaults', 'query')), ('rock type', ('world.rock',)),
         ('surface layer', ('world.surface',)), ('material', ('world.materials', 'textures:')), ('shape preset', ('world.shapes', 'world.tools')),
         ('contour lines', ('world.column',)), ('map (scene)', ('scene:',)), ('other world data', ('',))]


MAP_QUERY = ('query:undulation',)   # the map's own ground relief (undulation, undulationScale, ...): a scene's query keeps it


def kind_of(lever):
    if lever.startswith(MAP_QUERY):
        return 'map (scene)'
    return next(k for k, prefixes in KINDS if any(lever.startswith(p) for p in prefixes))


def fingerprints(repo, world, query):
    """A short hash of each part of the world data a trial can change: the world file's sections, each material in textures.json, each
    of the world's scenes, and each query key."""
    h = lambda v: hashlib.sha1(json.dumps(v, sort_keys=True).encode()).hexdigest()[:10]
    out = {}
    root = Path(repo)
    try:
        data = json.loads((root / 'materials' / f'{world}.json').read_text())
        for k, v in data.items():
            if k == 'world':
                out.update({f'world.{wk}': h(wv) for wk, wv in v.items()})
            else:
                out[k] = h(v)
        for k, v in json.loads((root / 'materials' / 'textures.json').read_text()).items():
            out[f'textures:{k}'] = h(v)
    except (OSError, ValueError):
        pass
    for f in sorted((root / 'repro' / 'scenes').glob(f'{world}-[0-9].json')):
        out[f'scene:{f.stem}'] = h(f.read_text())
    for part in (query or '').split('&'):
        if '=' in part:
            out[f"query:{part.split('=', 1)[0]}"] = part.split('=', 1)[1]
    return out


def levers_moved(now, before):
    """The files' parts whose fingerprint differs from the previous trial's, and this trial's own query keys (a query is not kept, so
    one the previous trial set and this one does not moves nothing)."""
    files = {k for k in set(now) | set(before) if not k.startswith('query:') and now.get(k) != before.get(k)}
    return sorted(files | {k for k in now if k.startswith('query:')})


def finding_sizes(classes, window):
    return {f'{c}:{m}': s for c, v in classes.get(window, {}).get('classes', {}).items() for m, s in v.get('sizes', {}).items()}


LABELS = {'luma': 'luma', 'dark': 'darkest', 'light': 'brightest', 'spread': 'spread', 'band2': 'grain 2px', 'band8': 'texture 8px', 'band32': 'patches 32px', 'edges': 'edges', 'lines': 'lines'}


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
            if k in ('luma', 'dark', 'light'):
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


# A gap stalls when this many attempts aimed at it since its best did not shrink it by IMPROVE, across STALL_KINDS kinds of lever or more.
# An attempt is one trial, or one probe sweep (consecutive probes of one control with one note). An attempt that declares its aims
# (match.sh --aim) counts for those gaps only; one without counts as aimed at a gap when it moved ours' number for it by more than MOVED (relative): a trial that leaves a gap alone is
# not an attempt at it. Declared aims make this exact; inferred ones also count side effects.
STALL_ATTEMPTS = 8
STALL_KINDS = 3
IMPROVE = .15
MOVED = .10
STALL_MIN = 1.25   # a gap this close to its threshold is a small finding: not followed for stalls


def sweep_key(e):
    return re.sub(r'^probe ([^=:]+)=[^:]*:', r'probe \1:', e.get('note', ''))


def attempts(es):
    out = []
    for e in es:
        if e.get('kind') not in ('trial', 'probe'):
            continue
        if e['kind'] == 'probe' and out and out[-1][-1]['kind'] == 'probe' and sweep_key(out[-1][-1]) == sweep_key(e):
            out[-1].append(e)
        else:
            out.append([e])
    return out


def sizes_of(e, ledger_dir):
    """Every class gap size of a trial, per window: the ledger's own, or (a trial recorded before sizes were) its classes.json."""
    if 'sizes' in e:
        return e['sizes']
    try:
        classes = json.loads((Path(ledger_dir) / e['trial'] / 'classes' / 'classes.json').read_text())
    except (OSError, ValueError):
        return {}
    e['sizes'] = {name: finding_sizes(classes, name) for name in e.get('windows', {})}
    return e['sizes']


def stalls(es, ledger_dir):
    """Per gap (window:class:metric) that is still a finding: its best size, the attempts aimed at it since that best, and the kinds of
    lever those attempts moved. Only gaps that were findings at the base, or that a trial declared as its aim, are followed."""
    att = attempts(es)
    if len(att) < 2:
        return []
    base = sizes_of(att[0][0], ledger_dir)
    keys = {f'{w}:{k}' for w, ks in base.items() for k, v in ks.items() if v >= 1}
    keys |= {k for a in att for e in a for k in e.get('aim', [])}
    out = []
    for key in sorted(keys):
        w, ck = key.split(':', 1)
        best = base.get(w, {}).get(ck)
        prev, since, best_at = best, [], att[0][0]['trial']
        for a in att[1:]:
            vals = [(sizes_of(e, ledger_dir).get(w, {}).get(ck), e) for e in a if w in e.get('windows', {})]
            vals = [(v, e) for v, e in vals if v is not None]
            if not vals:
                continue
            v, e = min(vals, key=lambda x: x[0])
            aims = {k for x in a for k in x.get('aim', [])}
            if best is None or v <= best * (1 - IMPROVE):
                best, best_at, since = v, e['trial'], []
            elif (key in aims) if aims else (prev is not None and abs(v - prev) > MOVED * max(prev, .1)):
                since.append(a)
            prev = v
        if best is None or best < STALL_MIN or len(since) < STALL_ATTEMPTS:
            continue
        kinds = sorted({kind_of(lever) for a in since for e in a for lever in e.get('levers', [])})
        out.append({'key': key, 'best': best, 'best_at': best_at, 'attempts': len(since), 'from': since[0][0]['trial'], 'kinds': kinds})
    return sorted(out, key=lambda s: -s['attempts'] * s['best'])


def stall_lines(es, ledger_dir, only=None, top=3):
    lines = []
    found = [s for s in stalls(es, ledger_dir) if not only or s['key'].split(':', 1)[0] in only]
    if top and len(found) > top:
        lines.append(f"  ({len(found) - top} more stalled or stalling gaps: match.sh --log lists them all)")
    for s in found[:top] if top else found:
        head = f"{s['key']} (gap {s['best']:.2f} at best, {s['best_at']}): {s['attempts']} attempts at it since {s['from']}"
        if len(s['kinds']) >= STALL_KINDS:
            lines.append(f"  STALLED {head}, moving {', '.join(s['kinds'])}, and none shrank it by {IMPROVE:.0%}. Stop tuning it: find which stage"
                         " carries it (match.sh --stages) and test the missing property with an oracle trial (--patch) before writing a proposal"
                         " (README.md, \"When a gap stalls\").")
        else:
            untried = [k for k, _ in KINDS if k not in s['kinds'] and k != 'other world data']
            lines.append(f"  STALLING {head}, but only {', '.join(s['kinds']) or 'no file change (queries)'} moved. Try another kind of lever"
                         f" ({', '.join(untried)}) before you call it stalled.")
    return lines


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
    prints = fingerprints(a.repo, a.world, a.query) if a.repo and a.world else {}
    e = {'trial': t.name, 'kind': a.kind, 'time': time.strftime('%Y-%m-%dT%H:%M:%S'), 'note': a.note, 'query': a.query,
         'commit': a.commit, 'diff_sha': hashlib.sha1(diff).hexdigest()[:12] if diff else '', 'diff_lines': diff.count(b'\n'),
         'shape': mean(w['shape'] for w in windows.values()), 'look': mean(w['look'] for w in windows.values()), 'windows': windows,
         'prints': prints, 'aim': [k for k in (a.aim or '').split(',') if k],
         'sizes': {name: finding_sizes(classes, name) for name in windows}}
    prior = entries(a.ledger)
    base_kind = 'holdout' if a.kind == 'holdout' else 'trial'
    base = next((p for p in prior if (p['kind'] == 'holdout') == (base_kind == 'holdout')), None)
    prev = next((p for p in reversed(prior) if (p['kind'] == 'holdout') == (base_kind == 'holdout')), None)
    e["levers"] = levers_moved(prints, prev.get('prints', {})) if prev and prints and prev.get('prints') else []
    with open(a.ledger, 'a') as fh:
        fh.write(json.dumps(e) + '\n')
    print(f"\n{e['trial']} ({a.kind}) {a.note!r}{'  query ' + a.query if a.query else ''}")
    print(f"  renders: the world files {'as committed at the base' if not diff else f'with {e["diff_lines"]} diff lines against the base (candidate.diff)'}"
          f"{' plus the query' if a.query else ''}. A query or probe is on top of every uncommitted edit.")
    if base and base is not e and all(abs(w['look'] - base['windows'].get(n, {}).get('look', -1)) < 1e-9 and abs(w['shape'] - base['windows'].get(n, {}).get('shape', -1)) < 1e-9 for n, w in windows.items()):
        print('  NOTE: renders exactly as the base on every window: this change reaches none of these windows (check gates, which rock the strokes use, or a scene query that overrides it).')
    if prev and prev.get('diff_sha') == e['diff_sha'] and prev.get('query', '') == e['query']:
        print(f"  WARNING: nothing changed since {prev['trial']} (same file diff, same query). Did your edit save? `git diff` shows what a trial renders.")
    if e['levers']:
        print(f"  moved since {prev['trial']}: " + ', '.join(e['levers']))
    if any(k.startswith(MAP_QUERY) for k in e['levers']):
        print("  (a map setting: to keep it, set it in that window's scene query, not in world.knobDefaults, which the scenes override)")
    if base and len(windows) < len(base['windows']) and any(kind_of(k) != 'map (scene)' for k in e['levers']):
        print(f"  WARNING: this moves world data every window uses, but rendered {len(windows)} of {len(base['windows'])} windows. Run it without --window before you keep it.")
    over = lambda p, key: mean(p['windows'][n][key] for n in windows if n in p['windows'])   # the same windows only
    line = f"  mean      shape {fmt(e['shape'])}  look {fmt(e['look'])}" + (f"  ({len(windows)} of {len(base['windows'])} windows)" if base and len(windows) < len(base['windows']) else '')
    if base:
        line += f"   vs base {base['trial']}: shape {delta(e['shape'], over(base, 'shape'))} look {delta(e['look'], over(base, 'look'))}"
    if prev and prev is not base and any(n in prev['windows'] for n in windows):
        line += f"   vs previous {prev['trial']}: shape {delta(e['shape'], over(prev, 'shape'))} look {delta(e['look'], over(prev, 'look'))}"
    print(line)
    base_classes = None
    if a.base:
        try:
            base_classes = json.loads((Path(a.base) / 'classes' / 'classes.json').read_text())
        except (OSError, ValueError):
            pass
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
                was, size = finding_sizes(base_classes or {}, name), finding_sizes(classes, name)
                clear = sorted(k for k in then - now if size.get(k, 0) <= CLEAR or size.get(k, 0) <= was.get(k, 9) * 2 / 3)
                slipped = sorted(k for k in then - now if k not in clear)
                if clear:
                    print(f"      cleared since base: {', '.join(clear)}")
                if slipped:
                    print(f"      just under the threshold (not a clear; gap {', '.join(f'{was.get(k, 0):.2f}->{size.get(k, 0):.2f}' for k in slipped)}): {', '.join(slipped)}")
            if now - then:
                print(f"      new since base:     {', '.join(sorted(now - then))}")
        for x in classes.get(name, {}).get('warnings', []):
            print(f"      WARNING: {x}")
        for f in w['findings'][:3]:
            print(f"      {f['size']:4.1f} {f['text']}")
        crops = classes.get(name, {}).get('crops', {})
        look_at = [f['key'].split(':')[0] for f in w['findings'][:3]] + [k.split(':')[0] for k in (now - then if b else set())]
        shown = [c for c in dict.fromkeys(look_at) if c in crops]
        if shown:
            print('      look: ' + ', '.join(crops[c] for c in shown))
        moved = class_moves(a.base, t, name) if a.base and Path(a.base).resolve() != t.resolve() else []
        if moved:
            print('      moved vs base (ours): ' + '; '.join(moved))
    ledger_dir = Path(a.ledger).parent
    for line in stall_lines(prior + [e], ledger_dir, only=set(windows)):
        print(line)
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
        # A trial of some windows (--window) has no mean comparable with a full trial's: its score is in its window's column.
        some = e['kind'] != 'holdout' and set(e['windows']) != set(names)
        shape, look = ('-', '-') if some else (fmt(e['shape']), fmt(e['look']))
        print(f"{e['trial']:12s} {e['kind']:8s} {shape:>5s} {look:>5s}  {per}  {e['note']}{' [' + e['query'] + ']' if e['query'] else ''}")
    print('(per-window columns are the look score, - where a trial did not render that window; lower is closer to retail. The mean'
          ' columns are - for a trial of some windows, and a holdout row\'s are its held-out window\'s)')
    counts = {}
    for e in es:
        for k in {kind_of(lever) for lever in e.get('levers', [])}:
            counts[k] = counts.get(k, 0) + 1
    if counts:
        print('trials per kind of lever (a trial counts once per kind it moved): ' + ', '.join(f'{k} {counts[k]}' for k, _ in KINDS if k in counts))
    for line in stall_lines(es, Path(a.ledger).parent, top=0):
        print(line)
    untried = [k for k, _ in KINDS if k not in counts and k != 'other world data']
    if untried:
        print(f"no trial yet moved: {', '.join(untried)}. A \"cannot\" in the report needs each kind tried or said why it cannot reach the gap (README.md)")
        if 'shape preset' in untried:
            print("  a shape preset reaches a window only as world.shapes.<kind> for a kind its strokes name (landform, hill, deep, ...), and only for"
                  " keys their cards leave out; a world's own shape (one with a `from`) is never named by a scene (REFERENCE.md, section 5)")


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
    r.add_argument('--repo', default='', help='the checkout, to record which levers a trial moved')
    r.add_argument('--world', default='')
    r.add_argument('--aim', default='', help='the findings this trial aims at, window:class:metric, comma separated (match.sh --aim)')
    s = sub.add_parser('show')
    s.add_argument('--ledger', required=True)
    s.add_argument('--last', type=int, default=0)
    a = ap.parse_args()
    (record if a.cmd == 'record' else show)(a)


if __name__ == '__main__':
    main()
