"""Verify full-resolution captures against an independent baseline."""
import argparse, json
from pathlib import Path
import numpy as np
from PIL import Image

p=argparse.ArgumentParser()
p.add_argument('--before',type=Path,required=True)
p.add_argument('--after',type=Path,required=True)
p.add_argument('--out',type=Path,required=True)
a=p.parse_args();rows=[]
for f in sorted(a.before.glob('*.png')):
    x=np.asarray(Image.open(f).convert('RGB')).astype(np.int16)
    y=np.asarray(Image.open(a.after/f.name).convert('RGB')).astype(np.int16)
    if not x.max()>2 or not y.max()>2:
        raise ValueError(f'Empty capture: {f.name}')
    h=f.stem+'-heights.json'
    hx=np.asarray(json.loads((a.before/h).read_text()))
    hy=np.asarray(json.loads((a.after/h).read_text()))
    rows.append(dict(scene=f.stem,maxRGB=int(np.abs(x-y).max()),changedChannels=int(np.count_nonzero(x-y)),meanRGB=float(np.abs(x-y).mean()),maxHeight=float(np.abs(hx-hy).max())))
if len(rows)!=27: raise ValueError(f'Expected 27 scenes, found {len(rows)}')
a.out.write_text(json.dumps(rows,indent=2)+'\n')
changed=[r for r in rows if r['maxRGB'] or r['maxHeight']]
print(f'{len(rows)-len(changed)}/27 exact image and sampled-height matches')
if changed:
    print(json.dumps(changed,indent=2));raise SystemExit(1)
