// Render help examples at a fixed crop through the editor's shape, Time and draw passes.
import {KNOBS} from '../sculpt-knobs.js';
import {WORLD_CHOICES} from '../sculpt-control-schema.js';
import {SHAPE_FIELDS, SURFACE_SLIDER_IDS, sliderRange} from '../sculpt-scene.js';
import {HELP_CONTROLS, HELP_FRAME, HELP_CARD} from '../sculpt-help-examples.js';
import {openHost, openScene, scene, knob, slider, renderWindow, pickColor, weather} from './headless.mjs';
import {LIBRARY, addMaterial} from '../sculpt-materials.js';
import {encodePng} from './png.mjs';

const path = [[440, 500], [548, 462], [683, 511]];
const crop = {x: 298, y: 332, width: 520, height: 380, tile: 520};
const stroke = (tool, points, card) => [tool, points, {card, seed: 2701}];
const feature = (tool, card = {}, points = path) => stroke(tool, points, card);
const ridge = feature('hill', {diameter: 235, elevation: 177, heightReference: 0, gullies: 54, gullySize: 55, cracks: 84, wander: 13});
const wall = feature('plateau', {diameter: 290, elevation: 192, heightReference: 0, gullies: 36, cracks: 78});
const pond = feature('deep', {diameter: 250, heightReference: 1, elevation: -55, combine: 1}, [[350, 616], [581, 671], [729, 634]]);
const sand = feature('sand', {diameter: 188, amount: 90}, [[450, 617], [645, 617]]);
const crystal = feature('crystal', {diameter: 245, iceFacets: 85, iceFacetSize: 40, facetForm: 2, facetSurface: 1});
const coast = feature('deep', {diameter: 315, heightReference: 1, elevation: -65, combine: 1, lean: 100}, [[399, 528], [556, 500], [711, 521]]);
const steps = feature('plateau', {diameter: 270, heightReference: 0, elevation: 189, terraces: 5, ledge: 70});
const bankSteps = feature('deep', {diameter: 315, heightReference: 1, elevation: -48, combine: 1, terraces: 4, ledge: 65, stepReference: 1});
const brush = (key, value) => feature('paint', {diameter: 140, amount: value, paintChannel: key});
// A gently wiggling shoreline with a steep rise directly above the low banks.
const coastHeight = ['heights', [], {
  width: 33, height: 33, cell: 24, x: 176, y: 144, offset: -32,
  image: Buffer.from(Array.from({length: 33 * 33}, (_, i) => {
    const x = i % 33, y = Math.floor(i / 33);
    return Math.max(0, Math.min(175, Math.round(32 + (y - 16 + Math.sin(x * .36) * 2) * 23)));
  })).toString('base64'),
}];
const full = [ridge, pond, sand];
const rockBase = {rockFace: 2.4, faceRock: .95, rockFaceFrom: .32, faceJoint: .95, faceBlock: 3.5, faceLedge: 2.3, faceGrass: .18};
const rockWeather = {...rockBase, faceBreak: .5, faceSpall: .8, faceRind: .7, faceFresh: .65, faceWet: .5, faceClast: 1.8, faceMineral: .6, shineRock: .45, runoff: 1.1, debrisAmount: .45};
const sandBase = {sand: 1.15, sandLee: 1.1, debrisAmount: 1.1, ripple: 9, rippleHeight: 2, sandDust: .6};
const waterBase = {shallowDepth: 19, deepDepth: 44, crispShore: 1, bedTint: .8, bedCracks: .85, shoreRock: 40, shoreShelf: 36, rockFace: 2};
const shineBase = {shineGround: 1, shineGroundRough: .7, shineSlope: 1, shineSlopeRough: .7, shineRock: 1.3, shineRockRough: .5, shineSand: 1.2, shineSandRough: .7, shineCrystal: 1.4, shineCrystalRough: .6, slopeTexture: .85};

// Each setting varies once while the fixture and the other settings stay fixed.
// The prerequisites bring the relevant terrain and material into view.
function worldExample(group, key) {
  if (key === 'beachWidth' || key === 'apron') return {world: 'zhon', strokes: key === 'apron' ? [wall] : [coast], base: {rockFace: 0, shoreRock: 0, shoreShelf: 0}};
  if (key === 'bankRock') return {world: 'green', strokes: [coastHeight], base: {erosion: 0, faceRock: .9, rockFaceFrom: 2, shoreRock: 0, shoreShelf: 0, coastRamp: 1}};
  if (group === 'Water' || group === 'Water detail')
    return {world: key === 'waterSoft' ? 'archipelago' : 'green', strokes: [coast], base: {...waterBase, deepEdge: Number(group === 'Water detail' && key !== 'shoalShoreSoft')}};
  if (group === 'Shore pockets' || key === 'iceFrost') return {world: 'ice', strokes: [feature('deep', {diameter: 325, heightReference: 1, elevation: -48, combine: 1, shorePlates: 1, plateMaterial: 2, plateLandPx: 100, plateWaterPx: 85, frostNeedles: 85, plateGap: 35})], base: {frostGaps: .45}};
  if (key === 'sandLight') return {world: 'green', strokes: [wall], base: {...rockBase, debrisAmount: 2, debrisDepth: 11, faceBreak: .9}};
  if (group === 'Sand') return {world: 'desert', strokes: [ridge, sand], base: sandBase};
  if (group === 'Strata' || group === 'Base band' || group === 'Cap color' || group === 'Rock layers')
    return {world: 'desert', strokes: [wall], base: {...rockBase, strata: .88, faceStrata: .18, faceLamina: 2.6, baseBand: .92, bedDip: 1.3, faceFold: 8}};
  if (group === 'Highland ground') return {world: 'lush', strokes: [ridge], base: {highland: 1, highFrom: 27, highReach: 30}};
  if (group === 'Pillow crust') return {world: 'lava', strokes: [steps], base: {lavaCrust: 1, lavaCalm: 1, lavaVeins: .8}};
  if (group === 'Cups, ribs & folds' || group === 'Surface pits') return {world: 'moon', strokes: [ridge], base: {moonCups: .8, moonRibs: .85, moonFolds: .9, pockmark: .85}};
  if (group === 'Cap & face finish') return {world: 'ice', strokes: [wall], base: {iceSnow: .45, iceCrest: .7}};
  if (group === 'Rock translucency' || group === 'Mineral faces') return {world: 'crystal', strokes: key === 'iceCrystal' ? [ridge] : [crystal], base: {flatShadow: 1}};
  if (group === 'Terrace creases') return {world: 'green', strokes: [key === 'layerCrease' ? bankSteps : steps], base: shineBase};
  if (group === 'Shine: sand') return {world: 'desert', strokes: [ridge, sand], base: {...sandBase, ...shineBase}};
  if (group.startsWith('Shine')) return {world: group.endsWith('crystal') ? 'crystal' : 'green', strokes: group.endsWith('crystal') ? [crystal] : [ridge], base: shineBase};
  if (group.startsWith('Rock')) return {world: 'green', strokes: ['shoreRock', 'shoreShelf'].includes(key) ? [coast] : [wall], base: rockWeather};
  if (group === 'Cracks') return {world: 'red', strokes: [wall], base: {crackSeverity: .88, crackMajor: 1, crackDark: .85}};
  if (group === 'Loose stone') return {world: 'green', strokes: [wall], base: {looseSupply: .85, boulders: .65, debrisAmount: .8}};
  if (group === 'Contour bands') return {world: 'desert', strokes: [ridge, sand], base: {...sandBase, banding: .92, bandLevel: 1.1, sandBanding: .85}};
  if (group === 'Vegetation & flowers') return {world: 'lush', strokes: full, base: {erosion: 1, erosionRain: 1.5, lushness: .2, wetSwath: .7}};
  if (group === 'Ground') return {world: 'green', strokes: [ridge], base: {groundPatch: .9, undulation: 10}};
  if (group === 'Low ground') return {world: 'green', strokes: full, base: {lowGrain: .1, lowReach: 16}};
  if (group === 'Ground detail') return {world: 'green', strokes: [ridge, brush(16, 95)], base: {reliefAmount: 1, reliefLumps: 1, gentleRelief: .95}};
  return {world: 'green', strokes: full, base: {flatShadow: 1, flatOcclusion: .6, sunHeight: 34}};
}

const shores = new Set(['fingers','fingerSize','fingerVary','fingerInlet','layerPx','layerRiser','stepReference','layerVary','layerCircle','lavaSpread','lavaCircleVary','layerJag','shorePlates','plateWaterPx','plateLandPx','plateSize','plateGap','plateHeight','plateMaterial','frostNeedles','plateVary','crystalShoreSeam','waterDeep','waterShore']);
const impact = new Set(['ejecta','buckling','secondaries','secondaryDistance','rimGaps','rimGapWidth','rimGapDepth']);
const facet = new Set(['iceFacets','iceFacetSize','facetForm','facetSurface','crystalStep','crystalTiers','crystalFacet','crystalSizeVar','crystalSides','crystalStretch','crystalTop','crystalVariation','crystalAlign','bergJitter','bergBreak','bergRough']);
function shapeExample(key, kind) {
  if (shores.has(key)) {
    const terraces = key.startsWith('layer') || key.startsWith('lava') || key === 'stepReference';
    const plates = key.startsWith('plate') || ['shorePlates','frostNeedles','crystalShoreSeam'].includes(key);
    const circular = ['layerCircle','lavaCircleVary'].includes(key);
    return {world: key === 'frostNeedles' ? 'ice' : plates ? 'crystal' : 'green', tool: 'deep', base: {diameter: 315, elevation: -55, heightReference: 1, combine: 1, fingers: terraces ? 0 : 95, terraces: terraces ? 5 : 0, ledge: 65, stepReference: circular ? 2 : 1, shorePlates: Number(plates), plateMaterial: key === 'frostNeedles' ? 2 : 1, plateWaterPx: 96, plateLandPx: 84, plateSize: 36, plateGap: 30, plateHeight: 85, plateVary: 40},
      knobs: {shoreRock: 65, shoreShelf: 45, deepDepth: 38}};
  }
  if (facet.has(key)) return {world: 'crystal', tool: 'crystal', base: {diameter: 250, iceFacets: 90, iceFacetSize: 54, facetForm: ['crystalStep','crystalFacet','crystalSizeVar'].includes(key) ? 1 : 2, facetSurface: 1, crystalVariation: 45, crystalTiers: 75}};
  if (impact.has(key)) return {world: 'green', tool: 'crater', base: {diameter: key === 'secondaryDistance' ? 112 : 270, elevation: -48, heightReference: 2, combine: 2, secondaries: 12, secondaryDistance: 100, rimGaps: 4}, points: [[525, 494], [573, 521]]};
  if (kind === 'fissure') return {world: 'red', tool: 'fissure', before: [wall], base: {diameter: 260, amount: 32, fissureBranches: 4, fissureNetwork: key === 'fissureCell' ? 1 : 0, fissureWidth: 14}, knobs: {crackMajor: 1, crackSeverity: .9}};
  if (kind === 'erase' || kind === 'smooth') return {world: 'green', tool: kind, before: [steps], base: {diameter: 192, amount: 90}, points: [[512, 395], [547, 606]]};
  if (kind === 'paint' || kind === 'sand' || kind === 'grass') return {world: 'green', tool: kind, before: [ridge, ...(kind === 'grass' ? [sand] : [])], base: {diameter: 125, amount: 95}, points: [[533, 548], [681, 583]]};
  if (key === 'riverDepth') return {world: 'green', tool: 'river', base: {diameter: 75, wander: 8}};
  if (key === 'combine' || key === 'heightReference') return {world: 'green', tool: 'hill', before: [wall], base: {diameter: 180, elevation: key === 'combine' ? 125 : 45, heightReference: 0}, points: [[545, 392], [545, 587]]};
  if (key === 'groundEdge') return {world: 'green', tool: 'hill', base: {diameter: 270, elevation: 178, groundPreset: 23, wander: 20}};
  if (key === 'talusLumps') return {world: 'green', tool: 'hill', base: {diameter: 265, elevation: 210, talus: 165, gullies: 100, curve: {form: 'cliff'}}};
  if (key === 'routeSmooth') return {world: 'green', tool: 'ramp', base: {diameter: 245, elevation: 165, heightReference: 0, cracks: 95}};
  return {world: 'green', tool: 'hill', base: {...HELP_CARD, diameter: 235, elevation: 167, terraces: ['terraceJitter','breakup'].includes(key) ? 5 : 0, ledge: 65,
    wander: ['varyFoot','varyMiddle'].includes(key) ? 49 : 0, spurCount: key.startsWith('spur') || key === 'crestVary' ? 4 : 0, spurLength: 95, scatterCount: key.startsWith('scatter') ? 5 : 0, scatterSpread: 110, scatterSize: 45, lean: key === 'facing' ? 275 : 110, cracks: key === 'cracks' ? 0 : 35}};
}

const ranges = {
  facing: [1, 3, 5, 7], paintChannel: [1, 2, 3, 4, 5, 16, 18], groundPreset: [-1, 23], rockPreset: [-1, 1],
  spurLength: [0, 170], scatterSpread: [30, 145], scatterCount: [0, 6], scatterSize: [12, 55], secondaryDistance: [8, 20],
  iceFacetSize: [14, 115], fissureWidth: [4, 50], plateHeight: [0, 150], crystalStep: [0, 38], wind: [0, 180], bedDipDir: [0, 180],
  faceBed: [2, 20], undulationScale: [48, 360], amount: [0, 100],
};
const units = label => label.includes('(px') ? ' px' : /deg|degrees/.test(label) ? '°' : '';
function frames(key, label, lo, hi, step, choices, raw = false) {
  const range = ranges[key] ?? [lo, hi];
  const values = choices
    ? ranges[key] ?? choices.map(([v]) => v)
    : range.length > 2 ? range : [...new Set([range[0], range[0] + step * Math.round((range[1] - range[0]) / (2 * step)), range[1]].map(v => +v.toFixed(4)))];
  return values.map(value => ({value, label: (key === 'groundPreset' && value === 23 ? 'Example material' : key === 'rockPreset' && value === 1 ? 'Example rock' : choices?.find(([v]) => v === value)?.[1]) ?? `${value}${raw ? '%' : units(label)}`}));
}
const basicShapes = [
  ['cracks','cracks','Cracks',['landform'],0,100,5,100],
  ['amount','amount','Strength',['smooth'],0,100,1,1],
  ['roughness','roughness','Roughness',['erase'],0,100,1,100],
  ['softness','softness','Softness',['paint'],0,100,1,100],
];
const worldExamples = KNOBS.flatMap(([group, rows]) => rows.map(([key, label, lo, hi, step]) => ({
  id: 'knob-' + key, kind: 'world', key, ...worldExample(group, key),
  frames: frames(key, label, lo, hi, step, WORLD_CHOICES[key]),
})));
const shapeExamples = [...SHAPE_FIELDS, ...basicShapes]
  .filter(([, id]) => !Object.hasOwn(HELP_CONTROLS, id))
  .map(([key, id, label, [kind], lo, hi, step, scale, , choices]) => ({
    id, kind: 'shape', key, ...shapeExample(key, kind), exampleMaterial: ['groundPreset','groundEdge'].includes(key),
    frames: frames(key, label, lo, hi, step, choices, scale === 100 && !units(label)),
  }));
const surfaceExamples = SURFACE_SLIDER_IDS.map(id => ({
  id, kind: 'surface', key: id, world: id === 'transition-detail' ? 'archipelago' : 'green', strokes: full, base: {erosion: 1, erosionRain: 1.65, sand: .9},
  frames: frames(id, '', ...sliderRange(id), null, true),
}));
const colorExamples = [
  ['shallowTone', 'knob-shallowTone', [coast], ['#689ca6', '#497d59', '#b08657']],
  ['sun', 'knob-sun', full, ['#d9e9ff', '#fff4d8', '#ffe0aa']],
  ['sky', 'knob-sky', full, ['#e4edff', '#fff0da', '#cbb7df']],
].map(([key, id, strokes, values]) => ({
  key, id, strokes, kind: 'color', world: 'green', base: {}, frames: values.map(value => ({value, label: value})),
}));

function downsample(pixels) {
  const result = Buffer.alloc(HELP_FRAME.width * HELP_FRAME.height * 4);
  for (let y = 0; y < HELP_FRAME.height; y++) for (let x = 0; x < HELP_FRAME.width; x++) {
    const i = (2 * y * crop.width + 2 * x) * 4;
    for (let c = 0; c < 4; c++) result[(y * HELP_FRAME.width + x) * 4 + c] = Math.round((pixels[i + c] + pixels[i + c + 4] + pixels[i + c + crop.width * 4] + pixels[i + c + crop.width * 4 + 4]) / 4);
  }
  return result;
}

export async function renderControlPreviews(write) {
  await openHost();
  const examples = [...worldExamples, ...shapeExamples, ...surfaceExamples, ...colorExamples];
  const info = {};
  const worlds = Map.groupBy(examples, e => e.world);
  for (const [world, group] of worlds) {
    const query = new URLSearchParams({biome: world, mapX: 4, mapY: 4, palette: 'off'});
    const config = await (await fetch('config/' + world + '.json')).json();
    const surface = world === 'lush' ? [
      ...config.surface, {id: 'example-tufts', name: 'Grass tufts', stage: 'ground', plants: {kind: 'grass', amount: 1}, where: [{fact: 'aboveSea', from: 2, fade: 2}]},
    ] : undefined;
    const host = await openScene({biome: world, strokes: [], surface}, query);
    host.renderer.setBudgetMB(512);
    const baseline = new Map(host.renderer.variant);
    const initialSliders = {...host.sliders};
    let previous = new Set();
    try {
      for (const e of group) {
        const originalMaterials = host.materials;
        if (e.exampleMaterial) {
          const added = addMaterial(host.materials, LIBRARY['lush-swamp'], 'Example ground');
          host.setMaterials(added.materials.map(m => m.slot === added.slot ? {...m, slot: 23} : m));
        }
        const needed = e.kind === 'shape' ? {erosion: 0, ...e.knobs} : e.base;
        if (e.kind === 'surface') host.sliders['material-weathering'] = 72;
        for (const key of new Set([...previous, ...Object.keys(needed)])) {
          const value = needed[key] ?? baseline.get(key) ?? host.config.defaults[key] ?? 0;
          if (String(value) !== host.renderer.variant.get(key)) await knob(host, key, value);
        }
        const width = e.frames.length * HELP_FRAME.width;
        const atlas = Buffer.alloc(width * HELP_FRAME.height * 4);
        let first, moved = 0, changed = 0;
        if (e.kind !== 'shape') await scene(host, e.strokes);
        for (const [i, {value}] of e.frames.entries()) {
          if (e.kind === 'shape') await scene(host, [...(e.before ?? []), feature(e.tool, {...e.base, [e.key]: value}, e.points)]);
          if (e.kind === 'world') await knob(host, e.key, value);
          if (e.kind === 'surface') await slider(host, e.key, value);
          if (e.kind === 'color') await pickColor(host, e.key, value);
          const rgba = downsample(await renderWindow(host, crop));
          if (first) {
            let count = 0;
            for (let p = 0; p < rgba.length; p += 4) if ([0, 1, 2].some(c => Math.abs(rgba[p+c] - first[p+c]) > 8)) count++;
            moved = Math.max(moved, count);
            if (!rgba.equals(first)) changed++;
          } else first = rgba;
          for (let y = 0; y < HELP_FRAME.height; y++) {
            const row = y * HELP_FRAME.width * 4;
            rgba.copy(atlas, (y * width + i * HELP_FRAME.width) * 4, row, row + HELP_FRAME.width * 4);
          }
        }
        if (host.errors.length) throw Error(host.errors.join('\n'));
        if (e.kind === 'color') await pickColor(host, e.key, null);
        if (e.exampleMaterial) host.setMaterials(originalMaterials);
        if (e.kind === 'surface') Object.assign(host.sliders, initialSliders);
        previous = new Set([...Object.keys(needed), ...(e.kind === 'world' ? [e.key] : [])]);
        console.log(`${e.id} ${world} ${changed}/${e.frames.length - 1} changed · ${moved} pixels`);
        if (!changed) throw Error(`The example for ${e.id} has identical frames. Check the fixture and prerequisites.`);
        write(e.id + '.png', encodePng(width, HELP_FRAME.height, atlas));
        info[e.id] = e.frames;
      }
    } finally {
      await knob(host, 'erosion', 0, {weatherKeys: ['erosion']});
      host.dispose();
    }
  }
  return info;
}
