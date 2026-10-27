#!/usr/bin/env python3
"""Local common-surface terrain experiment; no engine integration."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


HERE = Path(__file__).resolve().parent
SOURCES = {name: HERE / name for name in (
    'sculpt.html', 'sculpt.js', 'sculpt-renderer.js', 'sculpt.vert',
    'sculpt.frag', 'sculpt-common.glsl', 'sculpt-weathering.js', 'sculpt-material-weathering.js',
    'relief-bake.frag', 'sculpt-sand.js')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--biome', choices=('green', 'red', 'archipelago'), default='green')
    parser.add_argument('--assets', type=Path)
    args = parser.parse_args()
    if args.assets is None:
        args.assets = Path({'green': '/private/tmp/terrain-sculpt-lab/assets',
                            'red': '/private/tmp/red-planet-materials',
                            'archipelago': '/private/tmp/archipelago-materials'}[args.biome])
    from sculpt_fractures import make_fracture_field
    if args.biome == 'archipelago':
        from sculpt_archipelago_materials import prepare_archipelago_assets
        config = prepare_archipelago_assets(args.assets)
    elif args.biome == 'red':
        from sculpt_red_materials import prepare_red_assets, prepare_structured_red_assets
        config = prepare_red_assets(args.assets)
        structured = prepare_structured_red_assets(args.assets)
        config['textures']['slopeStructured'] = structured['slope']['texture']
        # This biome's slope and exposed face are one cracked material family.
        config['textures']['rockStructured'] = structured['slope']['texture']
    else:
        from sculpt_materials import prepare_assets, DEFAULT_DATA
        from sculpt_slope_material import make_slope_material
        from sculpt_rock_layers import make_rock_layers
        config = prepare_assets(args.assets)
        slope = make_slope_material(DEFAULT_DATA, args.assets)
        config['textures']['slopeGrass'] = '/sculpt-assets/slope-grass.png'
        config['textures']['hillRock'] = '/sculpt-assets/slope-rock.png'
        config['material']['hillRockMeanRGB'] = slope['rockMeanRGB']
        make_rock_layers(DEFAULT_DATA, args.assets)
        config['textures']['rockWeathered'] = '/sculpt-assets/rock-weathered.png'
        config['textures']['rockFractured'] = '/sculpt-assets/rock-fractured.png'
        from ground_tiles import make_ground_tiles
        make_ground_tiles(args.assets, DEFAULT_DATA / 'corpus')
        config['textures']['groundTiles'] = '/sculpt-assets/ground-tiles.png'
    make_fracture_field(args.assets)
    config['textures']['fractures'] = '/sculpt-assets/fractures.png'
    config.update(size=1024, grid=512, baseHeight=24, seaLevel=0,
                  biomeId=args.biome, biome={'red': 'Red Planet', 'green': 'Green Planet',
                                            'archipelago': 'Archipelago'}[args.biome])
    # Accepted Green Planet authoring profile. Explicit query values still
    # select older comparisons; plain /sculpt opens the reviewed treatment.
    config['defaults'] = dict(noise='ridged', coverage='form', rock='hill',
        lighting='front', forms='shouldered', surface='slopes', scene='compact',
        weather='broad', transition='soil', material='varied', edges='natural',
        fractures='40', scree='70', shade='separate')
    config['material'].update(materialWeathering=0.0, depositSpread=.65)
    if args.biome == 'red':
        config['defaults'].update(surface='structured', transition='mineral', material='single', fractures='80', scree='0')
        config['material'].update(rockyCoasts=True, surfaceRelief=1.25, fractureDepth=1.25,
                                  slopeStart=.06, slopeFull=.30, slopeFloor=-4.0, slopeDry=5.0)
    elif args.biome == 'archipelago':
        # Low sandy islands need little rise above water. This is an authored
        # scene default, not an inferred conversion of native section heights.
        config['baseHeight'] = 8
        config['defaults'].update(surface='structured', transition='mineral', material='single',
                                  fractures='20', scree='0', example='islands')
        config['material'].update(rockyCoasts=False, surfaceRelief=.45, fractureDepth=.35,
                                  slopeStart=.08, slopeFull=.35, slopeFloor=6.0, slopeDry=8.0,
                                  slopeOnLowBanks=False, elevatedCover=[0, 30, .92], rampMaterial=1.0,
                                  groundFringe=True, ringAmount=.95, ringSpread=.7, ringVariation=.75,
                                  fringeSignal=[1, -1, 0, 0], fringeRange=[.08, .28], materialWeathering=1.0,
                                  transitionDetail=.65)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlsplit(self.path).path
            content_type = 'text/plain; charset=utf-8'
            if path == '/sculpt-config.json':
                body = json.dumps(config).encode()
                content_type = 'application/json'
            else:
                name = path.strip('/')
                if name in ('', 'sculpt'):
                    name = 'sculpt.html'
                file = SOURCES.get(name)
                if path.startswith('/sculpt-assets/'):
                    leaf = path.removeprefix('/sculpt-assets/')
                    allowed = {v.rsplit('/', 1)[-1] for v in config['textures'].values()}
                    allowed.update(('rock-restrained.png', 'rock-structural.png', 'noise-ridged-gaussian.png'))
                    if leaf in allowed:
                        file = args.assets / leaf
                if file is None or not file.is_file():
                    self.send_error(404)
                    return
                body = file.read_bytes()
                if file.suffix == '.html': content_type = 'text/html; charset=utf-8'
                if file.suffix == '.js': content_type = 'text/javascript; charset=utf-8'
                if file.suffix == '.png': content_type = 'image/png'
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, fmt, *args):
            if args and str(args[1]) not in ('200', '304'):
                super().log_message(fmt, *args)

    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Shared-surface sculptor: http://127.0.0.1:{args.port}/sculpt', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
