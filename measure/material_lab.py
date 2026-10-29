"""Lab histogram distance per surface class (card H3 round 2, item 2): ours against retail's same class.
  material_lab.py <root> [<root> ...]  (roots hold green-1..3 as repro/all.sh writes them; the first also holds the retail pictures)"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'repro'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
here = Path(__file__).resolve().parent
st = load('stats', here.parent / 'repro' / 'stats.py')
sys.argv = [sys.argv[0]] + sys.argv[1:]
src = open(here / 'material_classes.py').read().split('def main')[0]
exec(src)
roots = [Path(a) for a in sys.argv[1:]]
for w in (1, 2, 3):
    d0 = roots[0] / f'green-{w}'
    ret = np.asarray(Image.open(d0 / 'retail.png').convert('RGB'))
    sr = slope_map(np.load(d0 / 'heights.npy'), 16)
    for name, lo, hi in CLASSES:
        def mask(s):
            m = (s >= lo) & (s < hi); m[:40] = m[-40:] = False; m[:, :40] = m[:, -40:] = False; return m
        rh = st.lab_histogram(ret, mask(sr))
        out = []
        for r in roots:
            o = json.loads((r / f'green-{w}' / 'ours-heights.json').read_text())
            g = np.array(o['heights'], float).reshape(o['grid'], o['grid'])
            img = np.asarray(Image.open(r / f'green-{w}' / 'ours.png').convert('RGB'))
            out.append(st.chi2(st.lab_histogram(img, mask(slope_map(g - o['sea'], 2))), rh))
        print(f'green-{w} {name:12s}', ' '.join(f'{r.name}: {v:.3f}' for r, v in zip(roots, out)))
