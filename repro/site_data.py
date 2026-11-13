"""Data access for the optional Python audit/benchmark hosts; Go generates all configs."""
import json
import subprocess
import tempfile
from pathlib import Path


def load_site(root):
    root = Path(root).resolve()
    manifest = json.loads((root / 'site.json').read_text())
    with tempfile.TemporaryDirectory(prefix='terraform-configs-') as directory:
        subprocess.run(['go', 'run', './cmd/terraform', '--dump-configs', directory], cwd=root, check=True)
        generated = {str(p.relative_to(directory)): p.read_bytes() for p in Path(directory).rglob('*.json')}
    configs = {w['id']: json.loads(generated[f"config/{w['id']}.json"]) for w in manifest['worlds']}
    sources = {name: root / name for name in manifest['sources']}
    for world in manifest['worlds']:
        name = f"materials/{world['id']}.json"
        sources[name] = root / name
    sources['materials/palette.json'] = root / 'materials/palette.json'
    for file in (root / 'ui-previews').iterdir():
        if file.suffix in ('.png', '.json'):
            sources[f'ui-previews/{file.name}'] = file
    return configs, generated, sources
