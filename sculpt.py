#!/usr/bin/env python3
"""Local common-surface terrain experiment; no engine integration."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


HERE = Path(__file__).resolve().parent
SOURCES = {name: HERE / name for name in (
    'sculpt.html', 'sculpt.js', 'sculpt-renderer.js', 'sculpt-vert.wgsl',
    'sculpt-frag.wgsl', 'sculpt-common.wgsl', 'sculpt-weathering.js', 'sculpt-material-weathering.js',
    'relief-bake.wgsl', 'sculpt-sand.js')}


BIOME_NAMES = {'green': 'Green Planet', 'red': 'Red Planet', 'archipelago': 'Archipelago',
               'moon': 'Moon', 'zhon': 'Zhon', 'lava': 'Lava', 'desert': 'Painted Desert',
               'crystal': 'Crystal', 'ice': 'Ice'}


# Every map-wide knob's default (the World panel). A world preset is these
# plus its own overrides below, so each world has a value for every setting;
# a knob missing here is reported in the page's console.
KNOB_DEFAULTS = dict(
    groundTiles=16, groundPattern='', groundContrast=1, undulation=10, undulationScale=200, undulationCover=.45,
    reliefScale=28, reliefAmount=.5, reliefLumps=.7, reliefBranch=2, reliefWarp=10, reliefPatchy=1,
    reliefJitter=.8, gentleRelief=.6, plainRelief=1.2, reliefOctaves=5,
    flatShadow=0, flatOcclusion=.4, lightCap=1.13,
    faceVariation=.8, northFace=.7, mesaFlank=0, faceFill=.18, slopeTexture=.3, faceEdge=.8, gullyRock=.5, moss=0, crevice=0,
    boulders=0, boulderSize=9, boulderFoot=.5, boulderCluster=.6, boulderMoss=.35, boulderRound=0,
    debris=0, debrisReach=48, debrisSize=6, debrisSort=.8, repose=.6,
    sand=0, sandReach=.6, windStrength=.5, wind=20, sandPatchy=.7, sandTail=.6, sandDust=.5, sandGrass=.6,
    sandLight=.25, sandGrain=.8, ripple=7, rippleHeight=1.4,
    crackSeverity=.6, crackSpacing=40, crackLength=2, crackMajor=.8, crackMinor=.75, crackHairline=.6,
    crackBlocks=.6, crackWidth=1, crackJagged=.6, crackNetwork=.35, crackReach=.6, crackDark=.75, crackLit=.35,
    craterlets=3, craterEjecta=0, worms=0, rockCrown=0, apron=0,
    crystalForm=0, crystalStep=16, crystalSides=6, crystalSize=24, crystalCount=10, crystalTop=.2, crystalLean=.25,
    crystalVariation=.5,
    banding=0, bandSpacing=3.7, bandSoftness=.35, bandLine=.5, bandWater=0, sandBanding=0, sandBandSpacing=2,
    strata=0, strataSpacing=10, strataWarp=12, strataContrast=.6, strataGrain=1,
    fingers=0, shoreEdge=0, bandStyle=0, beachWidth=.6, shallowDepth=24, deepDepth=60, waterSoft=32, crispShore=1, bankRock=.25,
    dither=2, landDither=.25, paletteMix=0, microRock=1,
)
# Per-world overrides of KNOB_DEFAULTS (authored presets; shallowDepth and
# deepDepth come from each world's measured water ramp).
WORLD_KNOBS = {
    # Crack darkness calibrated on retail (measure/crack_lines.py, strong
    # and long line densities on slopes): Green's lines were ~2.5x retail's.
    # crackDark also darkens band lines, so bandLine keeps their darkness.
    'green': dict(banding=.8, bandLine=.84, crackDark=.4),
    # Red slopes keep the plain's albedo and are shaded by facing alone
    # (retail red planet / king of the hill: lit slopes 0.89-0.96 of level
    # luma at slope 0.4-0.8, ours 0.86 from material alone), with fine
    # contour rings rather than ribs: band-pass contrast on slopes 0.4-0.8
    # was 1.6x retail's, dark-line share 3x (repro/scenes/red.json).
    'red': dict(crackSeverity=.4, crackReach=.5, crackDark=.35, crackWidth=.7, banding=.3, bandLine=1,
                reliefAmount=.2, slopeTexture=0, microRock=0),
    'archipelago': dict(crackSeverity=.4, crackMajor=.6, banding=.5, crackDark=.55, bandLine=.68),
    # Painted Desert, measured on the retail map (measure/desert_*.py): beds
    # alternate every ~6 units; dark lines are shaded risers on 0.4% of lit
    # slopes, not cracks; the plain carries no lighting (luma vs gradient
    # R^2 0.000), so no undulation, lumps or occlusion; no drifts. Mesa
    # flanks: a narrow cap and wide even faces (cross-sections of the retail
    # mesa in repro/scenes/desert.json).
    'desert': dict(mesaFlank=1, paletteMix=1, strata=1, strataSpacing=6, strataWarp=4, strataContrast=1, banding=.4, bandSpacing=6,
                   bandLine=.2, strataGrain=.25, crackSeverity=0, crackMajor=.2, crackMinor=.1, crackHairline=0, crackBlocks=.1,
                   sand=0, undulation=0, plainRelief=0, flatOcclusion=0, reliefAmount=.15, gentleRelief=.2, gullyRock=0),
    # Moon slopes were too dark and smeared (retail mean luminance .773 vs
    # ours .708; dark share 19.8% vs 33%): fewer, lighter worm troughs.
    'moon': dict(crackSeverity=.35, crackMajor=.5, crackMinor=.5, crackBlocks=.4, craterlets=6, craterEjecta=.7,
                 worms=.4, undulation=4, plainRelief=.6, banding=.3, crackDark=.6, bandLine=.63),
    # Zhon: no sand ring round hills on grass; sand is painted (Sand cover)
    # and hills set in sand get sandy feet.
    'zhon': dict(crackSeverity=.4, crackMajor=.6, boulderRound=1, boulderMoss=0, rockCrown=1, apron=0, sandBanding=1,
                 beachWidth=.6, banding=.3, bandLine=.5, crackDark=.45),
    # Lava: one dark, low-chroma brown ground with no cracks, sand or
    # boulders on the level; striated dark cliffs; a molten sea with no
    # colour-by-depth ramp, so no depth averaging (authored from the
    # sections, see sculpt_section_biome.py 'lava'). Its bank ridges are
    # irregular, not banded (section measurement), so no contour bands.
    # Bank lines measured on the section-built retail maps (measure/lava_*):
    # ground-spaced dark lines from slope 0.15 up; ground-coloured faces;
    # rim, outline and lip at the coast. Worms gave way to the lines.
    'lava': dict(undulation=4, plainRelief=.6, crackSeverity=.4, crackNetwork=0, crackHairline=0, crackBlocks=.3,
                 beachWidth=0, waterSoft=0, bankRock=0, banding=1, bandStyle=1, bandSpacing=5, bandLine=.9,
                 northFace=.7, fingers=1, worms=0, shoreEdge=1, slopeTexture=0),
    # Crystal: dead-level violet ground (the flat sections sit at one height
    # or within 82-87), crater walls and rough ridges crazed by a near-black
    # polygonal crack web, plates rather than rills by eye, and no sand or
    # beach (authored from the sections, see
    # sculpt_section_biome.py 'crystal'). Its column fields are a separate
    # brush, not these knobs. The web's plates on the rough ridges measure
    # 14.7 px across at the median (max caliper 20; measure/
    # crystal_geometry.py), so the block size sits at the knob's 16-px floor.
    # Its Crystals brush makes column mounds: Voronoi columns with ~15 px
    # tops stepped ~16 units (measure/crystal_geometry.py).
    'crystal': dict(undulation=4, plainRelief=.6, crackSeverity=.7, crackNetwork=1, crackLength=1.25,
                    crackBlocks=.8, crackHairline=.3, crackDark=.9, crackSpacing=16, beachWidth=0,
                    crystalForm=1, crystalSize=15, crystalStep=16, crystalVariation=.35),
    # Ice: level snow (flats at exactly 85 and 170), rounded snow mounds whose
    # shaded faces are smooth slate streaks with no crack network, and a
    # pack-ice shelf instead of a beach; its banks into the water are white
    # floes, never the slate of the shaded hill faces (authored from the
    # sections, see sculpt_section_biome.py 'ice').
    # Its Crystals brush makes ice blocks: four-sided, flat-topped (top ~0.45
    # of the base), sides ~0.7 units/px, no lean (measure/ice_features.py).
    'ice': dict(undulation=4, plainRelief=.6, crackSeverity=.2, crackMajor=.4, crackMinor=.3, crackHairline=.2,
                crackBlocks=.2, beachWidth=0, bankRock=0, crystalForm=0, crystalSides=4, crystalTop=.45,
                crystalSize=220, crystalCount=1, crystalLean=0, crystalVariation=.2),
}


def biome_config(biome, assets):
    """Prepare one biome's materials in its own asset folder and return its
    page configuration, with texture URLs under /sculpt-assets/<biome>/."""
    from sculpt_fractures import make_fracture_field
    if biome in ('moon', 'zhon', 'lava', 'crystal', 'ice'):
        # Measured from a decoded section catalog (sculpt_section_biome.py).
        from sculpt_section_biome import prepare_section_biome
        config = prepare_section_biome(biome, assets)
    elif biome == 'archipelago':
        from sculpt_archipelago_materials import prepare_archipelago_assets
        config = prepare_archipelago_assets(assets)
    elif biome in ('red', 'desert'):
        # Painted Desert is an authored world on Red Planet's materials.
        from sculpt_red_materials import prepare_red_assets, prepare_structured_red_assets
        config = prepare_red_assets(assets)
        structured = prepare_structured_red_assets(assets)
        config['textures']['slopeStructured'] = structured['slope']['texture']
        # This biome's slope and exposed face are one cracked material family.
        config['textures']['rockStructured'] = structured['slope']['texture']
    else:
        from sculpt_materials import prepare_assets, DEFAULT_DATA
        from sculpt_slope_material import make_slope_material
        from sculpt_rock_layers import make_rock_layers
        config = prepare_assets(assets)
        slope = make_slope_material(DEFAULT_DATA, assets)
        config['textures']['slopeGrass'] = '/sculpt-assets/slope-grass.png'
        config['textures']['hillRock'] = '/sculpt-assets/slope-rock.png'
        config['material']['hillRockMeanRGB'] = slope['rockMeanRGB']
        make_rock_layers(DEFAULT_DATA, assets)
        config['textures']['rockWeathered'] = '/sculpt-assets/rock-weathered.png'
        config['textures']['rockFractured'] = '/sculpt-assets/rock-fractured.png'
        from ground_tiles import make_ground_tiles
        make_ground_tiles(assets, DEFAULT_DATA / 'corpus')
        config['textures']['groundTiles'] = '/sculpt-assets/ground-tiles.png'
    make_fracture_field(assets)
    config['textures']['fractures'] = '/sculpt-assets/fractures.png'
    # Palette lookup with two-entry mixes (rows 0-31 are the nearest entry,
    # as before); the shader uses the pair rows when Mix palette pairs is on.
    from palette_pairs import make_pair_lut
    make_pair_lut(assets)
    config['textures']['palette'] = '/sculpt-assets/palette-pairs.png'
    config.update(size=1024, grid=512, baseHeight=24, seaLevel=0, biomeId=biome, biome=BIOME_NAMES[biome])
    # Accepted Green Planet authoring profile. Explicit query values still
    # select older comparisons; plain /sculpt opens the reviewed treatment.
    config['defaults'] = dict(noise='ridged', coverage='form', rock='hill',
        lighting='front', forms='shouldered', surface='slopes', scene='compact',
        weather='broad', transition='soil', material='varied', edges='natural',
        fractures='40', scree='70', shade='separate')
    config['material'].update(materialWeathering=0.0, depositSpread=.65)
    if biome == 'green':
        # Water colour by depth measured on the retail Green coast sections.
        config['material'].update(shallowDepth=24, deepDepth=60)
    if biome in ('red', 'desert'):
        config['defaults'].update(surface='structured', transition='mineral', material='single', fractures='80', scree='0')
        config['material'].update(rockyCoasts=True, surfaceRelief=1.25, fractureDepth=1.25,
                                  slopeStart=.06, slopeFull=.30, slopeFloor=-4.0, slopeDry=5.0)
    elif biome == 'archipelago':
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
    elif biome == 'moon':
        # Craters are the Moon's feature and it has no water. Its slopes keep
        # the light ejecta material down to the level dust (authored profile).
        # Lunar dust is flat between craters: little broad relief, no cracks.
        config['defaults'].update(example='hills', material='single', fractures='0', scree='40')
        config['material'].update(rockyCoasts=False, surfaceRelief=.35, slopeFloor=-4.0, slopeDry=4.0)
    elif biome == 'zhon':
        # Zhon's level ground sits only ~3 height units above its measured
        # shoreline (sea 59, flats 62); 8 leaves the editor's water tools room,
        # as Archipelago's authored base does.
        config['baseHeight'] = 8
        config['defaults'].update(example='islands', material='single', fractures='20', scree='0')
        # Its slope art is sandy (streaked dune slopes): shown where sand
        # lies beneath and on ramps, which are sand in its sections.
        config['material'].update(rockyCoasts=False, slopeStart=.08, slopeFull=.40,
                                  slopeFloor=6.0, slopeDry=9.0, slopeSand=True, rampMaterial=1.0)
    elif biome == 'lava':
        # Lava's land stands ~21 units above its measured shoreline (sea 24,
        # flats 45), close to the default base of 24, which stays. Its coasts
        # interlock land and lava fingers; the ridged slope material runs
        # down the banks to the lava's edge, and the section slope class
        # starts at 3 units per 16-px cell (~.19 per px). Authored profile.
        # Faces between the bank lines keep the ground's colour; the dark
        # striated rock is for cliffs only (measured shaded luma 51/45/38 at
        # slopes 0.4/0.65/1.0). Lava does not wet the ground.
        config['defaults'].update(example='coasts', material='single', fractures='0', scree='0',
                                  faceSlope='1.4,2.2', rockShare='0.1,0.8')
        config['material'].update(rockyCoasts=False, surfaceRelief=.6, slopeStart=.08, slopeFull=.25,
                                  slopeFloor=-4.0, slopeDry=2.0, rockSlope=2.4, wetBand=1.01)
    elif biome == 'crystal':
        # Crystal's land stands 20 units above the sea its retail maps set
        # (land 85, sea 65 on all four), close to the default base of 24,
        # which stays. Its maps are mostly water with column-covered islands
        # and hills. The section slope class starts at 2 units per 16-px
        # cell (~.125 per px) and the crack-webbed bank runs down to the
        # shelf. Authored profile.
        config['defaults'].update(example='islands', material='single', fractures='40', scree='0')
        # Column tops: violet palette entries 220/221 (lit ~luma 60-78).
        config['material'].update(rockyCoasts=False, surfaceRelief=.6, slopeStart=.08, slopeFull=.25,
                                  slopeFloor=-4.0, slopeDry=2.0, crystalRGB=[112, 84, 140])
    elif biome == 'ice':
        # Ice's snow stands 20 units above its measured shoreline (sea 65,
        # flats 85; retail maps set 75 and draw the floe shelf below it), so
        # the default base of 24 stays. Snow slopes stay white to the floes;
        # slope class from 3 units per 16-px cell (~.19 per px). Authored
        # profile.
        config['defaults'].update(example='coasts', material='single', fractures='0', scree='0')
        # Ice blocks: snow tops (216,231,253).
        config['material'].update(rockyCoasts=False, surfaceRelief=.6, slopeStart=.1, slopeFull=.3,
                                  slopeFloor=-4.0, slopeDry=4.0, crystalRGB=[205, 220, 245])
    knobs = {**KNOB_DEFAULTS, 'shallowDepth': config['material'].get('shallowDepth', 2),
             'deepDepth': config['material'].get('deepDepth', 42), **WORLD_KNOBS.get(biome, {})}
    config['defaults'].update({k: str(v) for k, v in knobs.items()})
    config['knobs'] = sorted(knobs)
    if biome == 'zhon':
        # Zhon's domes are blue-grey (retail sections: mean (43,57,81), median
        # luminance 52); its rock art renders neutral grey, so the world
        # defaults its rock colour to match.
        config['colors'] = {'rock': '#3d5174'}
    if biome == 'desert':
        # Measured on the retail map. Its tans are 50/50 mixes of two palette
        # entries (orange 20+178, cool 84+65), which nearest-colour cannot
        # make, so the world stays full colour until the palette stage mixes
        # index pairs. Bed colour slots: 1 orange (189,143,105), 2 cool
        # band and cap (190,198,185), 3 upper rock (lit ~(159,152,135)).
        config['strataColors'] = [[189, 143, 105], [190, 198, 185], [150, 144, 128], [175, 111, 90], [120, 112, 100]]
        # Zones by height above the plain: orange with cool bands (share
        # ~0.2 low, ~0.4 by 17), the pale cap from ~56-60 (share 0.95), grey
        # rock with orange lines above ~69.
        config['strataZones'] = [[1, 0, 1, .2], [17, 0, 1, .4], [53, 0, 1, .4], [58, 0, 1, .95], [69, 2, 0, .3]]
        config['defaults']['example'] = 'mesas'
        # The plain: exact-index tiles from the retail map's level ground,
        # when the map has been exported (see ground_tiles.py).
        retail = Path('/private/tmp/nanolathe-map-editor/retail-desert/painted_desert-e2c3dad3')
        if retail.is_dir():
            from ground_tiles import make_ground_tiles
            tiles = make_ground_tiles(assets, retail, name='ground-tiles', per_map=2000, skip=(), above_sea=0, tolerance=2,
                                      max_height=8, max_vocab=32)
            config['textures']['groundTiles'] = '/sculpt-assets/ground-tiles.png'
            # Retail mixes each bed from the same ramps when shaded (orange
            # is mauve 19-22 over yellow 177-181, the cap greys 83-86 with
            # cream 65-67 and mint 50-51); over the whole palette, shading
            # walked the orange onto grey 86 + bright orange 198, which the
            # map never uses. Pairs come only from the entries of the map's
            # raised ground (99%) and its plain tiles.
            from palette_pairs import make_pair_lut, retail_entries
            make_pair_lut(assets, name='palette-pairs-desert.png', entries=retail_entries(retail) + tiles['vocabulary'])
            config['textures']['palette'] = '/sculpt-assets/palette-pairs-desert.png'
    config['assetBase'] = f'/sculpt-assets/{biome}/'
    config['textures'] = {k: v.replace('/sculpt-assets/', config['assetBase'], 1) for k, v in config['textures'].items()}
    config['biomes'] = BIOME_NAMES
    return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--biomes', default='green,red,archipelago,moon,zhon,lava,desert,crystal,ice',
                        help='comma-separated biomes to prepare; the first is the default')
    parser.add_argument('--assets-root', type=Path, default=Path('/private/tmp/nanolathe-map-editor'),
                        help='each biome prepares its materials in <root>/assets-<biome>')
    args = parser.parse_args()
    biomes = [b for b in args.biomes.split(',') if b in BIOME_NAMES]
    assets = {b: args.assets_root / f'assets-{b}' for b in biomes}
    configs = {}
    for b in biomes:
        # A world whose source data is missing (e.g. a section catalog) is
        # skipped with a message rather than stopping the server.
        try:
            configs[b] = biome_config(b, assets[b])
        except (FileNotFoundError, OSError, ValueError) as err:
            print(f'skipping world {b}: {err}', flush=True)
    biomes = [b for b in biomes if b in configs]
    # Any world may take another's ground pattern (World panel); the
    # pattern's mean is replaced by the world's ground colour.
    patterns = {b: {'name': BIOME_NAMES[b], 'grass': configs[b]['textures']['grass'],
                    'groundTiles': configs[b]['textures'].get('groundTiles')} for b in biomes}
    for config in configs.values():
        config['biomes'] = {b: BIOME_NAMES[b] for b in biomes}
        config['groundPatterns'] = patterns

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlsplit(self.path).path
            content_type = 'text/plain; charset=utf-8'
            if path == '/sculpt-config.json':
                biome = parse_qs(urlsplit(self.path).query).get('biome', [biomes[0]])[0]
                body = json.dumps(configs.get(biome, configs[biomes[0]])).encode()
                content_type = 'application/json'
            else:
                name = path.strip('/')
                if name in ('', 'sculpt'):
                    name = 'sculpt.html'
                file = SOURCES.get(name)
                if path.startswith('/sculpt-assets/'):
                    biome, _, leaf = path.removeprefix('/sculpt-assets/').partition('/')
                    if biome in configs:
                        allowed = {v.rsplit('/', 1)[-1] for v in configs[biome]['textures'].values()}
                        allowed.update(('rock-restrained.png', 'rock-structural.png', 'noise-ridged-gaussian.png'))
                        if leaf in allowed:
                            file = assets[biome] / leaf
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
