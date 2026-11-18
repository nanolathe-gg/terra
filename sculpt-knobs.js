// The World panel's rows and what moving one does, without the DOM. The page (sculpt.js buildKnobs, setKnob, buildWorldPanel) and the headless
// host (repro/headless.mjs, which measure/world_controls.mjs sweeps under Node) apply a world knob and pick a world color with the same code, and
// read the facts the panel enables a row by (worldPanelValues, which sculpt-control-schema.js worldControlRequirement reads) from one function.
import {columnHasCapBed,columnRows,colorTone} from './sculpt-column.js';

// Surface knobs: each writes the page address and the renderer's variant,
// then the renderer re-reads its uniforms and re-bakes its fields.
export const KNOBS = [
  ['Ground', [['groundPatch','Ground patches (damp and dusty tones)',0,1,.05,0],['groundPatchSize','Patch size (px)',60,400,10,200],['undulation','Undulation height',0,16,.5,0],['undulationScale','Undulation size (px)',48,400,8,200],['undulationCover','Undulating share of land',0,1,.05,.45],['undulationArt','Undulation in the art',0,1,.05,1],['faceSteep','Landform face steepness',1,4,.1,1]]],
  // Low ground: the ground from the sea up to Reach above it, and the shallows, keep Grain kept of their grain (its color is a surface layer).
  ['Low ground', [['lowReach','Reach (height above the sea)',.5,40,.5,6],['lowGrain','Grain kept (low ground and water)',0,1,.05,1]]],
  ['Ground detail', [['reliefScale','Scale (px)',8,64,1,28],['reliefAmount','Relief strength',0,1.2,.05,.5],['reliefLumps','Lumps',0,1,.05,.7],
    ['reliefWarp','Warp (px)',0,24,1,10],['reliefPatchy','Patchiness',0,1,.05,1],['gentleRelief','Gentle-slope relief',0,1,.05,.6],['plainRelief','Ground bumps',0,3,.05,1.2],['lumpRelief','Painted ground bumps',0,8,.1,4],['worms','Wormy relief on slopes',0,1,.05,0]]],
  ['Lighting', [['flatShadow','Cast shadow on level ground',0,1,.05,0],['flatOcclusion','Occlusion on level ground',0,1,.05,.4],['lightCap','Highlight cap',1,1.6,.01,1.13],['shadeDepth','Directional shading kept',0,1,.05,1],['sunTilt','Light from the south',-1,1,.05,1],['sunHeight','Sun height (degrees above the horizon)',20,75,1,45.2],['ambient','Ambient light',0,.8,.02,.42],['creaseShade','Shade in creases (gully and valley floors, any facing)',0,1,.05,0]]],
  ['Vegetation & flowers', [['lushness','Lushness',-1,1,.05,0],['soilRim','Bare soil where cover thins',0,1,.05,0],['erosionRain','Rain (wets channels and hollows, and wears the ground)',0,2,.05,1],['wetSwath','Moisture',0,1,.05,0],['wetGround','Wet ground: darker and glossy where water lies',0,1,.05,0],['plantRelief','Vegetation relief',0,2,.05,1]]],
  ['Material coverage', [['hillLight','Slope-cover brightness',.6,1.6,.01,1],['ringFade','Fringe fade length',0,2,.05,0],['faceFill','Fill light on shaded faces',0,.5,.02,0],['rockCrown','Bare rock to the crown',0,1,.05,0],['sandCrown','Painted sand to the crown (sand bars)',0,1,.05,0],['slopeTexture','Sampled slope texture',0,1,.05,.3],['slopeMarks','Dark slope marks',0,1,.05,0],['wrinkles','Joined slope wrinkles',0,1,.05,0]]],
  ['Shine', [['shineStretch','Grain streak length (x its width)',1,8,.25,1],['shineWhite','Highlight whiteness (0 material hue, 1 white)',0,1,.05,.35]]],
  ['Shine: ground', [['shineGround','Gloss (highlight strength)',0,2,.05,0],['shineGroundSharp','Reflection sharpness (polish)',2,200,2,24],['shineGroundRough','Micro roughness (grain slope)',0,2,.05,0],['shineGroundScale','Grain width (px)',1,24,.5,6]]],
  ['Shine: slope cover', [['shineSlope','Gloss (highlight strength)',0,2,.05,0],['shineSlopeSharp','Reflection sharpness (polish)',2,200,2,24],['shineSlopeRough','Micro roughness (grain slope)',0,2,.05,0],['shineSlopeScale','Grain width (px)',1,24,.5,6]]],
  ['Shine: rock', [['shineRock','Gloss (highlight strength)',0,2,.05,0],['shineRockSharp','Reflection sharpness (polish)',2,200,2,24],['shineRockRough','Micro roughness (grain slope)',0,2,.05,0],['shineRockScale','Grain width (px)',1,24,.5,6],['shineOutside','Rock glints kept outside painted rock',0,1,.05,1]]],
  ['Shine: sand', [['shineSand','Gloss (highlight strength)',0,2,.05,0],['shineSandSharp','Reflection sharpness (polish)',2,200,2,24],['shineSandRough','Micro roughness (grain slope)',0,2,.05,0],['shineSandScale','Grain width (px)',1,24,.5,6]]],
  ['Shine: crystal', [['shineCrystal','Gloss (highlight strength)',0,2,.05,0],['shineCrystalSharp','Reflection sharpness (polish)',2,200,2,24],['shineCrystalRough','Micro roughness (grain slope)',0,2,.05,0],['shineCrystalScale','Grain width (px)',1,24,.5,6]]],
  ['Loose stone', [['looseSupply','Supply',0,1,.05,0],['looseSize','Size (median, px)',2,24,1,6],['boulders','Boulders under walls',0,1,.05,0],['stoneSort','Size sorting',0,1,.05,.6],['stoneRound','Rounded fragments (share)',0,1,.05,0],['stoneSlab','Flat fragments (share)',0,1,.05,.05],['looseKnoll','Knolls (share of stones that are ground rings around a hollow)',0,1,.05,0]]],
  ['Sand', [['sand','Deposit supply',0,2,.05,0],
    ['sandLee','Wind drifts (sand in the lee of rises)',0,2,.05,0],['wind','Wind toward (degrees; ripples and drifts)',0,360,5,20],['sandDust','Dusting tint',0,1,.05,.5],['sandGrass','Vegetation through sand',0,1,.05,.6],['sandLight','Weathered lightness',0,1,.05,.25],
    ['ripple','Ripple length (px)',0,16,1,7],['rippleHeight','Ripple height',0,3,.1,1.4]]],
  ['Cracks', [['crackSeverity','Crack depth (above 1 the fine fractures fill in)',0,1.5,.05,.6],['crackSpacing','Crack spacing (px)',16,96,2,40],
    ['crackMajor','Major cracks',0,1,.05,.8],['crackMinor','Minor cracks',0,1,.05,.75],['crackHairline','Hairline crazing',0,1,.05,.6],['crackBlocks','Facets (block relief)',0,1.5,.05,.6],
    ['crackWidth','Width (px)',.5,2.5,.1,1],['crackNetwork','Majors: rills to plates',0,1,.05,.35],
    ['crackDark','Floor darkness',0,1,.05,.75]]],
  ['Contour bands', [['banding','Strength',0,1,.05,0],['bandSoftness','Riser share',.05,1,.05,.35],['bandWater','Rings in water color',0,1,.05,0],['sandBanding','Streaks on sand and ramps',0,1,.05,0],['sandBandSpacing','Streak height step',.3,4,.1,2]]],
  // The rock column's beds (their colours and hardness) tilt by Bed tilt toward its direction.
  ['Strata', [['strata','Layer color coverage (0.5 rock, 1 whole outcrop)',0,1,.05,0],['strataContrast','Color strength',0,1,.05,.6],['strataGrain','Bed grain',0,1,.05,1],
    ['bedDip','Bed tilt (height per px; 2 north: level rows)',-4,4,.05,0],['bedDipDir','Bed tilt toward (deg, 0 east, 90 south)',0,360,5,90]]],
  ['Water', [['coastRamp','Coast ramp (share of the drawn slope kept)',.05,1,.05,1],['beachWidth','Beach width (worlds with beaches)',0,2,.05,.6],['apron','Sand apron round raised rock (px)',0,120,2,0],['shallowDepth','Shallow until depth',0,60,1,24],['deepDepth','Deep from depth',10,100,1,60],['waterSoft','Color depth averaging (px)',0,64,2,32],['crispShore','Crisp waterline (shore to shallow)',0,1,.05,1],['deepEdge','Hard shallow-to-deep step (0 ramp)',0,1,1,0],['bedTint','Bed tint strength',0,1,.05,.85],['bedBright','Tinted bed brightness',.5,1.5,.02,1],['bedContrast','Bed light carried through the tint',0,1.5,.05,1],['bedRelief','Bed lumps (lit relief under shallows)',0,3,.05,0],['bedCracks','Cracked bed (dried-mud polygons seen through the shallows)',0,1,.05,0],['bedCrackSize','Cracked bed: polygon size (px)',8,96,1,36],['shoreEdge','Waterline rim and lip',0,1,.05,0],['bankRock','Rock on low banks',0,1,.05,.25]]],
  // Card E8: the gray band at the foot of the raised ground (strata color 5); its heights are above the plain.
  // World › Surface's built-in settings: the strength and placement of the Highland ground and Base band layers (docs/SURFACE_LAYERS.md).
  ['Highland ground', [['highland','Strength (the world’s highland material on raised ground)',0,1,.05,0],['highFrom','From (rise above the plain)',0,120,1,8],['highReach','Fade (height units)',1,60,1,10]]],
  ['Base band', [['baseBand','Gray band strength',0,1,.05,0],['baseBandLow','Window from (height)',0,12,.5,4],['baseBandHigh','Window to (height)',1,16,.5,6.5],['baseBandWander','Window drift (height)',0,4,.25,1],['baseBandGaps','Share missing',0,.9,.05,.45]]],
  // Card G4: the pale cap kept as one sheet.
  ['Cap color', [['desertCapFlat','Uniform cap color',0,1,.05,0]]],
  // Card E9: rock faces; every default is the earlier look.
  // The voxel solid (engine-volume.wgsl): one rock for every face steep enough, relief in the art's own pixels lit by the sun and the sky.
  ['Rock relief', [['rockFace','Depth',0,4,.1,2],['faceRock',"Rock share of steep faces",0,1,.05,.9],
    ['rockFaceFrom','Starts at slope',.2,2,.05,.6],['rimReach','Bare rock at rims (px)',0,80,2,0],['shoreRock','Rock at shores (px inland)',0,96,2,0],['shoreShelf','Rock shelf under water (px out)',0,96,2,0],['faceExtrude','Extrusion bias: inset to projecting',-1,1,.05,0],
    ['faceMass','Broad bulges and alcoves',0,3,.05,1]]],
  ['Rock blocks', [['faceWhole','Whole blocks (share of blocks)',0,1,.05,0],['faceWholeLarge','Whole large blocks (share of blocks)',0,1,.05,0],['faceRegular','Block regularity (0 scattered, 1 a grid)',0,1,.05,0],
    ['faceBlock','Block offsets and tilts',0,6,.1,3],['faceBlockSize','Block size (px)',4,48,1,11],
    ['faceStretch','Block length / width',.25,4,.05,1],['faceBlockHeight','Block height / layer height (blocks are never under 3.5 units tall)',.25,6,.05,1],
    ['faceJointTilt','Joint tilt from vertical (deg)',-65,65,1,0],['faceScaleVary','Block size variation',0,1,.05,0],
    ['faceBreak','Block release',0,1,.05,0],['faceRound','Rounded blocks',0,1,.05,0],['faceJoint','Joint depth',0,3,.05,.35],
    ['faceJointWidth','Joint opening width',.25,3,.05,1],['faceSecondary','Secondary fracture depth',0,2,.05,.35],['faceContinuity','Fracture continuity',0,1,.05,1],
    ['faceLean','Joint orientation from north-south (deg)',-45,45,1,28]]],
  ['Rock layers', [['bedCycleVary','Variation between repeated beds',0,1,.05,0],['faceBedVary','Layer waviness',0,3,.05,1],['faceBed','Layer thickness (height)',2,30,.5,5.5],['faceLedge','Hard-layer ledges',0,4,.05,2.2],
    ['faceRun','Layer variation length (px)',20,300,5,90],['faceFold','Fold amplitude (height)',0,48,1,0],['faceSpall','Broken layer edges',0,4,.1,0],['faceLamina','Fine layer relief',0,3,.05,0],
    ['faceLaminaSize','Fine layer spacing (height units)',6,16,.5,6],['faceLayers','Soil-covered terraces',0,2,.05,0],
    ['faceGrass','Grass on ledges and flat tops',0,1,.05,.8]]],
  ['Rock weathering & detail', [['faceWear','Weathering: rounded edges, open joints',0,1,.05,.35],
    ['faceCrease','Pitting',0,6,.1,2.5],['faceCreaseSize','Pit size (px)',3,24,1,6],
    ['faceScratch','Scratches and water grooves',0,6,.1,2.5],['faceScratchSize','Groove spacing (px)',3,20,.5,7],
    ['faceScratchLength','Groove length (px)',4,160,2,50],['faceScratchAngle','Groove tilt from vertical (deg)',-90,90,5,0],
    ['faceClast','Embedded fragment relief',0,4,.1,0],['faceClastSize','Embedded fragment size (px)',3,32,1,12],
    ['faceDetailPatch','Fine detail clustering',0,1,.05,0]]],
  ['Rock runoff', [['runoff','Runoff exposure',0,2,.05,0],['runoffScale','Catchment variation size (px)',8,80,2,24],
    ['runoffConcentration','Channel concentration',0,1,.05,.65],['runoffCut','Channel incision',0,8,.1,2],['runoffStain','Mineral staining',0,1,.05,.5]]],
  ['Rock debris', [['debrisAmount','Cliff debris accumulation',0,2,.05,0],['debrisReach','Rockfall reach (px)',8,96,2,56],['debrisDepth','Accumulated bed thickness',0,12,.25,4]]],
  // B4: translucent rock (ice, crystal, an invented stone); 0 is the rock exactly as before.
  ['Rock translucency', [['absorbDepth','Color deepens with thickness',0,1,.05,0],['shadowTint','Colored cast shadow',0,1,.05,0]]],
  ['Rock surface', [['faceShade','Shadow and crevice depth',0,1,.05,.85],['faceTone','Color variation between blocks',0,.5,.01,.12],
    ['faceFresh','Fresh fracture contrast',0,1,.05,0],['faceRind','Weathered crust coverage',0,1,.05,0],
    ['faceRindDepth','Weathering penetration (art units)',0,20,.25,6],['faceRindTone','Crust lightness (dark to bleached)',-.65,.65,.05,-.22],
    ['faceRindWarmth','Crust oxidation',0,1,.05,.35],['faceRindRough','Crust finish (0 polished, 1 rough)',0,1,.05,.65],
    ['faceMineral','Mineral contrast',0,1,.05,0],['faceStrata','Layer tint: lighter and darker',0,.5,.01,0],['faceWet','Wetness: darker rock, smoother reflections',0,1,.05,0]]],
  // Water detail: the shallow-to-deep step, the shallow bed and the waterline (cards E11, G1).
  ['Water detail', [['stepSoftPx','Threshold edge softness (px)',1,40,1,1],['shelfWander','Shelf wander (depth units)',0,40,1,0],['bedFlat','Bed lit by its own relief only',0,1,.05,0],['shoalRag','Shallow-to-deep notches (px)',0,16,.5,0],['shoalStairs','Hard waterline stairs (px)',0,6,.1,0],['shoalShoreSoft','Waterline blur (px)',0,12,.5,0]]],
  // Contour fringe: lines along the mineral fringe and offset copies of it (cards E11, G3).
  ['Contour fringe', [['ringContrast','Fringe contour lines: contrast',0,1,.05,0],['ringCount','Fringe contour lines: count',1,30,1,7],['ringSize','Fringe contour lines: reach',.1,2,.05,1],['ringShift','Offset between copies (px; 0: concentric lines)',0,30,.5,0],['ringShiftDir','Drift direction (deg clockwise from east)',0,360,5,315],['ringScatter','Direction wander (share of a half turn)',0,1,.05,.5],['ringWobble','Outline waver (px)',0,10,.5,3],['ringLobe','Lobe size (px)',8,60,1,22],['ringFill','Pale tint where copies overlap',0,1,.05,0],['ringPatch','Reach varies along the outline',0,1,.05,0],['ringPatchSize','Reach variation size (px)',30,400,5,120]]],
  // Card E10: crust on hills and creases at terrace feet.
  ['Pillow crust', [['lavaCrust','Pillow crust strength',0,1,.05,0],['lavaPillow','Pillow size (px)',16,80,1,34],['lavaChip','Chip size (px)',3,12,.5,5.5],['lavaVeins','Veins hanging down the slope',0,1,.05,0],['lavaCalm','Replace fine relief with crust',0,1,.05,.6],['lavaDusk','Shade away from light',0,2,.05,0]]],
  ['Terrace creases', [['layerCrease','Dark crease at each step foot, any facing',0,1,.05,0],['shineSlopeGate','Shine only on slopes above (0: everywhere)',0,1.5,.05,0]]],
  // Card E6: where roughness shows, and the body dimmed between glints.
  ['Shine: gate and headroom', [['shineGate','Roughness only on raised ground and slopes',0,1,.05,0],['shineHeadroom','Dim the body between glints (near-white surface)',0,1,.05,0]]],
  ['Surface pits', [['pockmark','Dark pits on raised ground and slopes',0,1,.05,0],['pockSize','Pit spacing (px)',3,12,.5,5]]],
  // Card G8: cups, ribs and folds on steep faces.
  ['Cups, ribs & folds', [['moonCups','Slope cups',0,1,.05,0],['moonCupSize','Cup spacing (px)',3,12,.5,5.5],['moonCupDepth','Cup depth (wall steepness)',.4,3,.1,1.4],['cupStretch','Cup stretch into strokes (1: pits)',1,3,.1,1],['moonRibs','Slope ribs',0,1,.05,0],['moonRibDepth','Stroke steepness',.2,3,.1,1],['moonRibDark','Darker where turned from the sun',0,.9,.05,0],['moonFolds','Contour folds',0,1,.05,0],['moonFoldSpacing','Fold spacing (height units)',.3,3,.1,.9]]],
  ['Mineral faces', [['iceCrystal','Straight face fibres',0,1,.05,0],['gougeWeb','Gouges across crystal formations',0,1,.05,0],['iceCrest','Cap lumps',0,1,.05,0]]],
  // Card G6: rounded light, caps and face finish on raised ground.
  ['Cap & face finish', [['iceSoft','Rounded lighting',0,1,.05,0],['iceSnow','Snow on level caps',0,1,.05,0],['iceFall','Slope fibres',0,1,.05,0],['iceApron','Hatched foot apron',0,1,.05,0]]],
  ['Needle lines', [['iceFrost','Needle hairlines',0,1,.05,0]]],
  ['Shore pockets', [['frostGaps','Melt pockets: share of cells at the coast',0,.6,.01,.17],['frostGapReach','Melt pockets: reach inland (share of the band)',.2,1.2,.05,.65],['frostGapSize','Melt pockets: size (px)',3,24,1,11],['frostGapDepth','Melt pockets: depth below the sea',.5,6,.1,3]]],
];

// The ground node's field each undulation row sets.
const UNDULATION={undulation:'amplitude',undulationScale:'wavelength',undulationCover:'coverage',undulationArt:'art'};
// World settings the shape reads (sculpt-scene.js shapeContext: the frost gaps and the talus slope), so the shape runs again from the first node.
const SHAPE_KNOBS=new Set(['frostGaps','frostGapReach','frostGapSize','frostGapDepth','talusAngle','coastRamp','faceSteep']);
// A world knob's change. The value goes into the page's settings (its address, which the shape context and a scene's ground node read) and
// the renderer's settings, whose uniforms it re-reads; the answer says what else the change needs, for the host to carry out on its own
// fields: `reload` (the ground textures and a borrowed beach are chosen when the renderer starts, so nothing else is set), `evaluate` (the shape again from that
// node: the undulation rows edit the ground node in `nodes`, or put one first when Undulation height turns on), `checkpoint` (an undo step for
// that edit) and `weather` (the Time pass again; alone, for the deposit supply, which changes the generated deposit field, and the rain).
const TRACKED_WORLD_INPUTS=new Set([...KNOBS.flatMap(([,rows])=>rows.map(([key])=>key)),'palette','erosion','erosionAge','erosionEnvelope','wetReach','talusFull','wearFull','flowK']);
export function applyKnob({key,value,settings,renderer,nodes,seed,sync=true}) {
  const previous=renderer.variant.get(key);
  settings.set(key,value);
  if (key==='beachFrom') return {reload:true};
  renderer.variant.set(key,value);
  const unknown=!TRACKED_WORLD_INPUTS.has(key)&&String(previous)!==String(value),change=sync?renderer.applyKnobs():null,result=value=>({...value,...(change?{change}:{}),...(!sync&&unknown?{unknownInput:key}:{})});
  // Current rows are covered by the computed comparison and declared channels.
  // An unfamiliar non-uniform input is conservative, never silently a no-op.
  if(change&&!change.fields.length&&!change.channels.length&&!TRACKED_WORLD_INPUTS.has(key)&&String(previous)!==String(value)){
    change.channels.push({name:key,stage:'A'});change.stage='A';
  }
  if (Object.hasOwn(UNDULATION,key)) {
    const i=nodes.findIndex(n => n.kind==='ground');
    if (i>=0) { nodes[i][UNDULATION[key]]=Number(value); return result({evaluate:i,checkpoint:true,weather:true}); }
    if (key==='undulation' && Number(value)>0) { nodes.unshift({kind:'ground',amplitude:Number(value),wavelength:160,art:settings.has('undulationArt')?Number(settings.get('undulationArt')):1,seed:seed^0x9e37}); return result({evaluate:0,checkpoint:true,weather:true}); }
    return result({});
  }
  if (SHAPE_KNOBS.has(key)) return result({evaluate:0,weather:true});
  if (key==='sand' || key==='erosionRain') return result({weather:true});
  return result({});
}

// The Colors panel's rows, [key, label]. Shallow water is a tone of the world's water material (waterTone), the lights are colors.
export const COLOR_KEYS=[['shallowTone','Shallow water'],['sun','Sun color'],['sky','Sky color']];
// The rows this world shows.
export const colorRows=(config,settings) => COLOR_KEYS;
// A world's own base colors after a row is picked (a hex, or Shallow water's tone) or cleared (null): a color the server sets is then
// explicitly off (null, the texture's own color), any other is dropped.
export function pickWorldColor(config,own,key,hex) {
  if (hex) return {...own,[key]:hex};
  if (config.colors?.[key]) return {...own,[key]:null};
  const {[key]:_,...rest}=own; return rest;
}

// A shape's own water choices, which turn the hard step and the ramp on inside its footprint whatever the world says (engine-frag.wgsl's `pick`).
export function strokeWaterPicks(nodes) {
  const water=nodes.filter(n=>n.kind==='landform'),picked=(key,...choices)=>water.some(n=>choices.includes(Math.round(n.params?.[key]||0)))?1:0;
  return {deepEdge:picked('waterDeep',1),fadedEdge:picked('waterDeep',2)};
}
// A world's water tone, a shift of its water material's mean (sculpt-column.js colorTone) that the draw adds to that mean, so it follows
// the material: `shallow`, the shallows' tint, or `mid`, the third color. The world's data holds it (materials/<world>.json water:
// shallowTone, midTone: the measured color less the material's drawn mean); data without one gives its color less its table mean
// (shallowMeanRGB or shallowRGB, midRGB, against meanRGB). Null where the world has no such color.
export function waterTone(config,which) {
  const w=config.water||{},own=w[which+'Tone'];
  if(own)return [...own];
  const color=which==='shallow'?w.shallowMeanRGB||w.shallowRGB:w.midRGB,mean=w.meanRGB||w.deepRGB;
  return color&&mean?colorTone(mean.map(v=>v/255),color.map(v=>v/255)):null;
}
// A chosen shallow-water tone replaces the data's, retaining the lit bed, and uses two depth tones rather than the optional third.
// Deep water has no color of its own here: it is the world's water material.
export const waterColored=colors => Boolean(colors.shallowTone);
// How many tones the world's water has: 1 where shallow and deep are one colour, 3 where a third colour follows the depth, else 2; a picked base color makes it 2.
export function waterTones(config,colors) {
  const w=config.water||{};
  if(waterColored(colors))return 2;
  return w.midRGB&&config.material?.midDepth?3:w.shallow===w.deep&&String(w.shallowRGB)===String(w.deepRGB)?1:2;
}
// engine-frag.wgsl's sediment transition: at full Material weathering its color (built from the ground, before the slope cover is mixed in) replaces the slope cover's outright.
// `weathering`: Weathering is on and the world runs a Time pass; `materialWeathering`: the Material weathering slider (0 to 100).
export function slopeReplaced({config,renderer,weathering,materialWeathering}) { const own=renderer.variant; return Boolean(renderer.transitionBody&&config.material?.groundFringe===true&&weathering&&own.get('transition')==='mineral'&&materialWeathering>=100); }
// What worldControlRequirement may read: the renderer's settings, a stroke's water choices counted as the switch they turn on, and the facts of the world's material that no slider sets.
// The column facts read the active column (config.column: the map's own from the Rock column panel, else the world's).
export function worldPanelValues(facts) {
  const {config,renderer,nodes,colors}=facts,layers=config.layers||[],own=Object.fromEntries(renderer.variant),picks=strokeWaterPicks(nodes);
  // plants: the surface layers that grow plants (a layer's `plants`, docs/SURFACE_LAYERS.md), which Vegetation relief scales.
  return {...own,plants:(config.surface||[]).filter(l=>l?.plants?.amount>0).length,highMaterial:(facts.materials||[]).some(m=>m.worldHigh)?1:0,stonePaint:nodes.some(n=>n.kind==='paint'&&[5,6].includes(n.params?.paintChannel))?1:0,deepEdge:Math.max(Number(own.deepEdge)||0,picks.deepEdge),rampWater:Number(own.deepEdge)>0?picks.fadedEdge:1,waterTones:waterTones(config,colors),waterColored:waterColored(colors)?1:0,slopeReplaced:slopeReplaced(facts)?1:0,column:columnRows(config.column).starts.length?1:0,repeatBeds:Math.max(0,...columnRows(config.column).starts.map(s=>s[2])),capBed:columnHasCapBed(config.column)?1:0,ringLayer:layers.includes('ring')?1:0,beachLayer:layers.includes('beach')?1:0,slopeSand:config.material?.slopeSand?1:0};
}

// Latest values are applied together once per animation frame. Persistence
// waits for release or a quiet pause; handoffs flush before reading the recipe.
export function createWorldInputQueue({apply,commit,requestFrame=fn=>requestAnimationFrame(fn),cancelFrame=id=>cancelAnimationFrame(id),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}) {
  const values=new Map();let frame=0,timer=0,wantsCommit=false,needsCommit=false,running=false,applications=0,commits=0;
  const schedule=()=>{if(!frame)frame=requestFrame(drain);};
  function drain(){
    frame=0;if(running)return;running=true;
    try{
      if(values.size){const batch=[...values.values()];values.clear();applications++;apply(batch);}
      if(wantsCommit){wantsCommit=false;if(needsCommit){needsCommit=false;commits++;commit();}}
    }finally{running=false;}
    if(values.size)schedule();
  }
  function end(){if(timer){clearTimer(timer);timer=0;}wantsCommit=true;if(values.size||frame)schedule();else drain();}
  return {
    put(key,value){values.set(key,value);needsCommit=true;if(timer)clearTimer(timer);timer=setTimer(()=>{timer=0;end();},250);schedule();},
    end,
    flush(){if(running)return;if(frame){cancelFrame(frame);frame=0;}end();if(values.size){if(frame){cancelFrame(frame);frame=0;}drain();}},
    get pending(){return values.size>0||frame!==0;},
    get active(){return needsCommit||wantsCommit||values.size>0;},
    stats:()=>({pending:values.size,applications,commits}),
  };
}
