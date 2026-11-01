"""H15 step D: put fitted forms in a world's table.

    python measure/write_forms.py <fit.json> <materials/world.json> name=land:30-80 [name=land:30-80 name=land:80+/land:30-80 ...] [--drop name,...]

Each spec names a form and the bin of fit_forms.py's output whose knots it takes (kind:bin); `/kind:bin` gives a back curve (the shouldered hill's other side).
Writes the table's top-level `forms` block (name -> {knots, back?}) and a line in `measured.forms` saying which maps and how many features each came from.
Forms already in the block stay unless named again or dropped.
"""
import json, sys
from pathlib import Path

args = [a for a in sys.argv[1:] if not a.startswith('--drop')]
drop = sys.argv[sys.argv.index('--drop') + 1].split(',') if '--drop' in sys.argv else []
if '--drop' in sys.argv: args.remove(sys.argv[sys.argv.index('--drop') + 1])
fit = json.loads(Path(args[0]).read_text())
path = Path(args[1])
table = json.loads(path.read_text())
forms = {k: v for k, v in table.get('forms', {}).items() if k not in drop}
src = {k: v for k, v in table.get('measured', {}).get('forms', {}).get('from', {}).items() if k in forms}
for spec in args[2:]:
    name, rest = spec.split('=')
    front, _, back = rest.partition('/')
    pick = lambda s: fit[s.split(':')[0]][s.split(':')[1]]
    f = pick(front)
    forms[name] = {'knots': f['knots']}
    if back: forms[name]['back'] = pick(back)['knots']
    src[name] = {'bin': front, 'features': f['features'], 'maps': f['maps'], **({'back': back} if back else {})}
table.pop('forms', None)
table['measured'].pop('forms', None)
if forms:
    table['measured']['forms'] = {'note': 'retail maps measured by measure/fit_forms.py (16-px cells, features by height bin, mean height share against distance share from the foot)',
                                  'from': src}
    table['forms'] = '@@'
text = json.dumps(table, indent=1)
if forms:
    body = ',\n'.join(f'  {json.dumps(k)}: ' + json.dumps(v, separators=(', ', ': ')) for k, v in forms.items())
    text = text.replace('"@@"', '{\n' + body + '\n }')
path.write_text(text + '\n')
