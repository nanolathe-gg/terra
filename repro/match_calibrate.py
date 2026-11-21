"""Retail match harness: how often each class metric agrees with the people who judged the trials by eye.

  match_calibrate.py <ledger-dir>[:<branch>] ... [--repo DIR] [--min-move .15] [--out FILE.md]

A metric earns its weight by agreeing with the eye. For every judged change, this checks which way each class gap (match_classes.py
sizes, in threshold units) moved, and counts an agreement when it moved toward retail on a change the judge preferred (or away on one
the judge turned down). Only gaps that moved by --min-move or more count: a gap the change left alone says nothing.

The judgements, per ledger folder (repro/match.sh's <out>):
 - <ledger-dir>/verdicts.jsonl, one line per judged trial: {"trial": "trial-012", "verdict": "keep" | "drop", "by": "owner" |
   "reviewer" | "agent", "why": "..."} (match.sh --verdict writes it). A keep is compared with the kept state before it, a drop with
   the kept state it was tried on;
 - with :<branch>, the round's commits: the first trial id a commit message cites is a keep by its round agent (a round's own keeps are
   partly chosen by these same numbers, so they agree with the aimed gap by construction: read the owner's and reviewers' rows first).

Prints, per metric (and per metric and class), the number of judged moves and the share that agreed, with the label source, and the
metrics that agree less often than chance. Few owner verdicts exist yet: report agreement with its count, and treat a re-weighting it
suggests as a proposal for the owner, not a change to make.
"""
import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from match_log import entries, sizes_of  # noqa: E402


def branch_keeps(repo, branch):
    base = subprocess.run(['git', '-C', repo, 'merge-base', 'main', branch], capture_output=True, text=True).stdout.strip()
    log = subprocess.run(['git', '-C', repo, 'log', '--reverse', '--format=%x1e%B', f'{base}..{branch}'], capture_output=True, text=True).stdout
    out = []
    for msg in log.split('\x1e'):
        m = re.search(r'\b(trial-\d{3})\b', msg)
        if m and not msg.lstrip().startswith('docs'):
            out.append(m.group(1))
    return out


def judgements(d, branch, repo):
    """(trial, verdict, by) in trial order."""
    out = []
    v = d / 'verdicts.jsonl'
    if v.exists():
        for line in v.read_text().splitlines():
            if line.strip():
                j = json.loads(line)
                out.append((j['trial'], j['verdict'], j.get('by', 'agent')))
    if branch:
        seen = {t for t, _, _ in out}
        out += [(t, 'keep', 'agent (round commits)') for t in branch_keeps(repo, branch) if t not in seen]
    num = lambda t: int(t.split('-')[1])
    return sorted(set(out), key=lambda x: num(x[0]))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('ledgers', nargs='+')
    ap.add_argument('--repo', default=str(Path(__file__).resolve().parent.parent))
    ap.add_argument('--min-move', type=float, default=.15)
    ap.add_argument('--out', default='')
    a = ap.parse_args(argv)
    tally = defaultdict(lambda: [0, 0])          # (by, metric) -> [agree, n]
    tally_c = defaultdict(lambda: [0, 0])        # (by, metric, class)
    looks = defaultdict(lambda: [0, 0])
    pairs = 0
    for spec in a.ledgers:
        path, _, branch = spec.partition(':')
        d = Path(path)
        es = {e['trial']: e for e in entries(d / 'ledger.jsonl') if e.get('kind') in ('trial', 'probe')}
        if 'trial-000' not in es:
            print(f'{d}: no trial-000 in its ledger; skipped')
            continue
        kept = 'trial-000'
        for trial, verdict, by in judgements(d, branch, a.repo):
            if trial not in es:
                continue
            before, after = es[kept], es[trial]
            sb, sa = sizes_of(before, d), sizes_of(after, d)
            sign = -1 if verdict == 'keep' else 1      # a keep should shrink gaps, a drop is right when they grew
            for w in set(sb) & set(sa):
                for key, x in sb[w].items():
                    y = sa[w].get(key)
                    if y is None or abs(y - x) < a.min_move:
                        continue
                    cls, metric = key.split(':', 1)
                    ok = (y - x) * sign > 0
                    for t, k in ((tally, (by, metric)), (tally_c, (by, metric, cls))):
                        t[k][0] += ok
                        t[k][1] += 1
                lb, la = before['windows'].get(w, {}).get('look'), after['windows'].get(w, {}).get('look')
                if lb is not None and la is not None and abs(la - lb) >= .005:
                    looks[by][0] += (la - lb) * sign > 0
                    looks[by][1] += 1
            pairs += 1
            if verdict == 'keep':
                kept = trial
    lines = [f'# Metric agreement with judged trials ({pairs} judged changes, moves of {a.min_move} threshold units or more)', '']
    for by in sorted({k[0] for k in tally}):
        lines += [f'## Judged by {by}', '', '| metric | judged moves | agreed |', '| --- | --- | --- |']
        lb = looks.get(by)
        if lb and lb[1]:
            lines.append(f'| window look score | {lb[1]} | {lb[0] / lb[1]:.0%} |')
        rows = sorted(((m, v) for (b, m), v in tally.items() if b == by), key=lambda x: -x[1][1])
        lines += [f'| {m} | {v[1]} | {v[0] / v[1]:.0%} |' for m, v in rows]
        bad = [m for m, v in rows if v[1] >= 15 and v[0] / v[1] < .55]
        lines += ['', 'Agree no more often than chance (15 moves or more, under 55%): ' + (', '.join(bad) if bad else 'none'), '']
        lines += ['Per class (10 moves or more):', '']
        rows_c = sorted(((m, c, v) for (b, m, c), v in tally_c.items() if b == by and v[1] >= 10), key=lambda x: (x[0], -x[2][1]))
        lines += [f'- {m} on {c}: {v[1]} moves, {v[0] / v[1]:.0%} agreed' for m, c, v in rows_c]
        lines.append('')
    text = '\n'.join(lines)
    print(text)
    if a.out:
        Path(a.out).write_text(text)


if __name__ == '__main__':
    main()
