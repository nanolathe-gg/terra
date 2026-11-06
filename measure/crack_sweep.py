"""Render editor scenes under knob overrides and measure them (crack_lines).

  crack_sweep.py OUT_DIR WORLD NAME [knob=value ...]  [-- NAME2 knob=value ...]

Each named configuration renders the 'mixed' and 'hills' examples at two
seeds on the server at SCULPT_PORT (default 8824), with heights, through
capture/capture.mjs (CAPTURE_PORT, default 9454), then prints and stores
the per-image median table as OUT_DIR/WORLD-NAME.json.
"""
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlencode

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import crack_lines as cl  # noqa: E402
import slope_texture as st  # noqa: E402

PORT = int(os.environ.get('SCULPT_PORT', 8824))
SCENES = [('mixed', 101), ('mixed', 202), ('hills', 101), ('hills', 202)]


def scenes(world, name, knobs, scene_list=SCENES):
    out = []
    for example, seed in scene_list:
        q = {'biome': world, 'scratch': f'cal-{world}-{name}', 'example': example, **knobs}
        out.append({'name': f'{world}-{name}-{example}-{seed}', 'heights': True, 'seed': seed, 'example': example,
                    'url': f'http://127.0.0.1:{PORT}/sculpt.html?{urlencode(q)}'})
    return out


def run(out_dir, world, configs, scene_list=SCENES):
    """configs: list of (name, knobs). Captures all in one Chrome session."""
    out_dir = Path(out_dir)
    batch = out_dir / f'batch-{world}-{configs[0][0]}-{scene_list[0][0]}'
    batch.mkdir(parents=True, exist_ok=True)
    manifest = {'scenes': [s for name, knobs in configs for s in scenes(world, name, knobs, scene_list)]}
    (batch / 'scenes.json').write_text(json.dumps(manifest, indent=1))
    env = {**os.environ, 'CAPTURE_PORT': os.environ.get('CAPTURE_PORT', '9454')}
    subprocess.run(['node', str(HERE.parent / 'capture' / 'capture.mjs'), str(batch / 'scenes.json'), str(batch)],
                   check=True, env=env, stdout=subprocess.DEVNULL)
    results = {}
    for name, knobs in configs:
        acc = cl.Acc()
        textures, levels, data = [], [], []
        for s in scenes(world, name, knobs, scene_list):
            stem = batch / s['name']
            rgb, slope, valid = cl.ours(str(stem) + '.png', str(stem) + '.heights.json')
            acc.add(rgb, slope, valid, name=s['name'])
            levels.append(st.ground_level(cl.luma(rgb), slope, valid))
            data.append((rgb, slope, valid))
            # Heights dumps are large; keep only the renders unless asked.
            if not os.environ.get('KEEP_HEIGHTS'):
                Path(str(stem) + '.heights.json').unlink()
        med = acc.table(median=True)
        world_level = float(np.median([x for x in levels if x]))
        texture = st.median_table([st.measure(rgb, sl, v, lv or world_level) for (rgb, sl, v), lv in zip(data, levels)])
        results[name] = med
        (out_dir / f'{world}-{name}.json').write_text(json.dumps({'world': world, 'name': name, 'knobs': knobs,
                                                                  'median': med, 'pooled': acc.table(),
                                                                  'texture': texture}, indent=1))
        print(cl.fmt(med, f'{world} {name} {knobs}'), flush=True)
        if os.environ.get('TEXTURE'):
            print(st.fmt(texture, '  texture'), flush=True)
    return results


if __name__ == '__main__':
    out_dir, world, *rest = sys.argv[1:]
    configs, cur = [], None
    for tok in rest:
        if tok == '--':
            cur = None
        elif '=' in tok and cur is not None:
            k, v = tok.split('=', 1)
            cur[1][k] = v
        else:
            cur = (tok, {})
            configs.append(cur)
    # SCENES=example:seed,... overrides the default scene list.
    scene_list = [(e, int(v)) for e, v in (x.split(':') for x in os.environ['SCENES'].split(','))] \
        if os.environ.get('SCENES') else SCENES
    run(out_dir, world, configs, scene_list)
