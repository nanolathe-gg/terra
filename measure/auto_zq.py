"""Set the rank quantiles (`zq`) of a table's lit materials to their own field's, as the table's layers make them (card H14c).

A dev tool. The lab fits a lit material alone (layer 0); in a world's table the same material is another layer and has another noise
salt, so its field's quantiles move a little. This runs the engine's own z pass (measure/swatch.mjs --auto-zq) over the whole table and
writes each lit material's zq, taken from the material's first layer, into `model`.

  auto_zq.py <materials/<world>.json> [--cdp 9682]
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
args = sys.argv[1:]
cdp = '9682'
if '--cdp' in args:
    i = args.index('--cdp'); cdp = args[i + 1]; del args[i:i + 2]
path = Path(args[0])
table = json.loads(path.read_text())
# A fixed scratch folder per port (the swatch page's Chrome profile stays in it and is reused), not a folder removed afterwards.
out = Path('/private/tmp/auto-zq-' + cdp)
if True:
    r = subprocess.run(['node', str(HERE / 'swatch.mjs'), str(path), str(out), '--auto-zq', '--cdp', cdp], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stdout + r.stderr)
    meta = json.loads((out / 'meta.json').read_text())
seen = set()
for layer, name in enumerate(table['order']):
    if name in seen:
        continue
    seen.add(name)
    q = meta['zq'].get(str(layer))
    if q:
        table['model'][name]['zq'] = [round(v, 4) for v in q]
        print(f'{name}: zq set from layer {layer}')
path.write_text(json.dumps(table, indent=1) + '\n')
