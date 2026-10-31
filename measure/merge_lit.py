"""Put a fitted lit material into a world's table (card H14c).

A dev tool. A lit table (measure/lit-tables/<name>.json, from lit_lab.py / lit_fit.py) holds one material under its own name; this
copies that material's fitted `model` entry, and its measured `lit` block, onto a material of materials/<world>.json.

  merge_lit.py <materials/<world>.json> <material> <lit-table.json> <name>
"""
import json
import sys
from pathlib import Path

table_path, material, lit_path, name = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3]), sys.argv[4]
table = json.loads(table_path.read_text())
lit = json.loads(Path(lit_path).read_text())
table['model'][material] = lit['model'][name]
if 'lit' in lit['measured'][name]:
    table['measured'][material]['lit'] = lit['measured'][name]['lit']
table_path.write_text(json.dumps(table, indent=1) + '\n')
print(f'{table_path.name}: {material} now the lit material {name}')
