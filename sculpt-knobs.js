// The World panel's rows and what moving one does, without the DOM. The page (sculpt.js buildKnobs, setKnob, buildWorldPanel) and the headless
// host (repro/headless.mjs, which measure/world_controls.mjs sweeps under Node) apply a world knob and pick a world color with the same code, and
// read the facts the panel enables a row by (worldPanelValues, which sculpt-control-schema.js worldControlRequirement reads) from one function.
import {columnHasCapBed,columnRows} from './sculpt-column.js';
import {ROCK_TYPES,rockFacts} from './sculpt-material-model.js';

// Surface knobs: each writes the page address and the renderer's variant,
// then the renderer re-reads its uniforms and re-bakes its fields.
export const KNOBS = [
  ['Ground', [['groundTiles','Unique ground tiles',1,16,1,16],['groundContrast','Pattern contrast',0,2,.05,1],['undulation','Undulation height',0,16,.5,10],['undulationScale','Undulation size (px)',48,400,8,200],['undulationCover','Undulating share of land',0,1,.05,.45]]],
  ['Ground detail', [['reliefScale','Scale (px)',8,64,1,28],['reliefAmount','Strength',0,1.2,.05,.5],['reliefLumps','Lumps',0,1,.05,.7],
    ['reliefBranch','Branching',0,4,.1,2],['reliefWarp','Warp (px)',0,24,1,10],['reliefPatchy','Patchiness',0,1,.05,1],['reliefJitter','Rib irregularity',0,1,.05,.8],['gentleRelief','Gentle-slope relief',0,1,.05,.6],['plainRelief','Ground bumps',0,3,.05,1.2],['lumpRelief','Painted ground bumps',0,8,.1,4],['reliefOctaves','Octaves',1,6,1,5],['worms','Wormy relief on slopes',0,1,.05,0]]],
  ['Lighting', [['flatShadow','Cast shadow on level ground',0,1,.05,0],['flatOcclusion','Occlusion on level ground',0,1,.05,.4],['lightCap','Highlight cap',1,1.6,.01,1.13],['shadeDepth','Directional shading kept',0,1,.05,1],['sunTilt','Light from the south',-1,1,.05,1],['ambient','Ambient light',0,.8,.02,.42]]],
  ['Vegetation & flowers', [['vegetationCover','Vegetation cover (0 off)',0,2,.05,1],['lushness','Lushness',-1,1,.05,0],['erosionRain','Rain (wets channels and hollows, and wears the ground)',0,2,.05,1],['wetSwath','Moisture',0,1,.05,0],['plantRelief','Vegetation relief',0,2,.05,1],['flowerDensity','Flower density',0,4,.05,1]]],
  ['Material coverage', [['microRock','Moss and rock interleaved on faces (0: one material)',0,1,.05,1],['hillLight','Slope-cover brightness',.6,1.6,.01,1],['ringFade','Fringe fade length',0,2,.05,0],['faceFill','Fill light on shaded faces',0,.5,.02,0],['rockCrown','Bare rock to the crown',0,1,.05,0],['sandCrown','Painted sand to the crown (sand bars)',0,1,.05,0],['slopeTexture','Sampled slope texture',0,1,.05,.3],['faceEdge','Edge breakup',0,2,.05,.8],['gullyRock','Rock in gullies',0,2,.05,.5],['moss','Moss from ground',0,1,.05,0],['slopeMarks','Dark slope marks',0,1,.05,0],['wrinkles','Joined slope wrinkles',0,1,.05,0]]],
  ['Shine', [['shineStretch','Grain streak length (x its width)',1,8,.25,1],['shineWhite','Highlight whiteness (0 material hue, 1 white)',0,1,.05,.35]]],
  ['Shine: ground', [['shineGround','Gloss (highlight strength)',0,2,.05,0],['shineGroundSharp','Sharpness (lobe exponent)',2,200,2,24],['shineGroundRough','Roughness (grain slope)',0,2,.05,0],['shineGroundScale','Grain width (px)',1,24,.5,6]]],
  ['Shine: slope cover', [['shineSlope','Gloss (highlight strength)',0,2,.05,0],['shineSlopeSharp','Sharpness (lobe exponent)',2,200,2,24],['shineSlopeRough','Roughness (grain slope)',0,2,.05,0],['shineSlopeScale','Grain width (px)',1,24,.5,6]]],
  ['Shine: rock', [['shineRock','Gloss (highlight strength)',0,2,.05,0],['shineRockSharp','Sharpness (lobe exponent)',2,200,2,24],['shineRockRough','Roughness (grain slope)',0,2,.05,0],['shineRockScale','Grain width (px)',1,24,.5,6]]],
  ['Shine: sand', [['shineSand','Gloss (highlight strength)',0,2,.05,0],['shineSandSharp','Sharpness (lobe exponent)',2,200,2,24],['shineSandRough','Roughness (grain slope)',0,2,.05,0],['shineSandScale','Grain width (px)',1,24,.5,6]]],
  ['Shine: crystal', [['shineCrystal','Gloss (highlight strength)',0,2,.05,0],['shineCrystalSharp','Sharpness (lobe exponent)',2,200,2,24],['shineCrystalRough','Roughness (grain slope)',0,2,.05,0],['shineCrystalScale','Grain width (px)',1,24,.5,6]]],
  ['Loose stone', [['looseSupply','Supply',0,1,.05,0],['looseSize','Size (median, px)',2,24,1,6]]],
  ['Sand', [['sand','Deposit supply',0,2,.05,0],
    ['wind','Ripple direction (degrees)',0,360,5,20],['sandDust','Dusting tint',0,1,.05,.5],['sandGrass','Vegetation through sand',0,1,.05,.6],['sandLight','Weathered lightness',0,1,.05,.25],['sandGrain','Rock grain in sand',0,1,.05,.8],
    ['ripple','Ripple length (px)',0,16,1,7],['rippleHeight','Ripple height',0,3,.1,1.4]]],
  ['Cracks', [['crackSeverity','Frost (crack depth; above 1 the fine fractures fill in)',0,1.5,.05,.6],['crackSpacing','Block size (px)',16,96,2,40],
    ['crackMajor','Major cracks',0,1,.05,.8],['crackMinor','Minor cracks',0,1,.05,.75],['crackHairline','Hairline crazing',0,1,.05,.6],['crackBlocks','Facets (block relief)',0,1.5,.05,.6],
    ['crackWidth','Width (px)',.5,2.5,.1,1],['crackNetwork','Majors: rills to plates',0,1,.05,.35],
    ['crackDark','Floor darkness',0,1,.05,.75]]],
  ['Rock structure', [['rockOrder','Rock structure',0,1,.05,0],['rockFrom','Beds and joints from slope (painted rock always)',.3,2,.05,.6],['bedSpacing','Bed thickness (px along the ground, or height units)',3,80,1,12],['bedHeight','Beds spaced by height (0 px along the ground)',0,1,.05,0],['bedVary','Bed thickness variation',0,1,.05,.5],
    ['bedDip','Bed tilt (height per px; 2 north: level rows)',-4,4,.05,0],['bedDipDir','Bed tilt toward (deg, 0 east, 90 south)',0,360,5,90],['bedLedge','Ledges (step strength; above 1 taller lips and notches)',0,2,.05,.5],
    ['grooveSpacing','Joint and gully spacing (px)',12,120,2,36],['grooveAngle','Joint and gully lean from north-south (deg)',-60,60,1,0],['grooveRun','Joint and gully length (px)',30,400,10,120]]],
  ['Contour bands', [['banding','Strength',0,1,.05,0],['bandSoftness','Riser share',.05,1,.05,.35],['bandWater','Rings in water color',0,1,.05,0],['sandBanding','Streaks on sand and ramps',0,1,.05,0],['sandBandSpacing','Streak height step',.3,4,.1,2]]],
  ['Strata', [['strata','Strength (painted beds)',0,1,.05,0],['strataContrast','Color strength',0,1,.05,.6],['strataGrain','Bed grain',0,1,.05,1]]],
  ['Water', [['beachWidth','Beach width (worlds with beaches)',0,2,.05,.6],['apron','Sand apron round raised rock (px)',0,120,2,0],['shallowDepth','Shallow until depth',0,60,1,24],['deepDepth','Deep from depth',10,100,1,60],['waterSoft','Color depth averaging (px)',0,64,2,32],['crispShore','Crisp waterline (shore to shallow)',0,1,.05,1],['deepEdge','Hard shallow-to-deep step (0 ramp)',0,1,1,0],['bedLit','Lit bed under shallow water (0 noise water)',0,1,.05,0],['bedTint','Bed tint strength',0,1,.05,.85],['bedBright','Tinted bed brightness',.5,1.5,.02,1],['bedContrast','Bed light carried through the tint',0,1.5,.05,1],['bedRelief','Bed lumps (lit relief under shallows)',0,3,.05,0],['shoreEdge','Waterline rim and lip',0,1,.05,0],['bankRock','Rock on low banks',0,1,.05,.25]]],
  ['Palette', [['paletteMix','Mix palette pairs (0 nearest, 1 pairs)',0,1,1,0],['dither','Dither (water)',0,4,.1,2],['landDither','Land dither share',0,1,.05,.25]]],
  // Card E8: the gray band at the foot of the raised ground (strata color 5); its heights are above the plain.
  ['Foot color band', [['baseBand','Gray band strength',0,1,.05,0],['baseBandLow','Window from (height)',0,12,.5,4],['baseBandHigh','Window to (height)',1,16,.5,6.5],['baseBandWander','Window drift (height)',0,4,.25,1],['baseBandGaps','Share missing',0,.9,.05,.45]]],
  // Card G4: the pale cap kept as one sheet.
  ['Cap color', [['desertCapFlat','Uniform cap color',0,1,.05,0]]],
  // Card E9: rock faces; every default is the earlier look.
  ['Rock face', [['rockMoss','Vegetation tint in rock',0,1,.05,1],['rockDetail','Rock tile blotch contrast (1 as drawn, 0 flat)',0,1,.05,1],['faceRelief','Rock relief lit on walls that face the viewer (0: world-space look)',0,1,.05,1],['shineOutside','Rock glints kept outside painted rock',0,1,.05,1],
    ['bedPunch','Beds differ in strength',0,1,.05,0]]],
  ['Gullies & ribs', [['gullyDepth','Gully depth (height; 0 none)',0,16,.5,0],['gullyWidth','Gully width (px)',4,40,1,14],
    ['rockStain','Stain',0,3,.05,0],['ribTilt','Rib tilt (height per px)',0,1,.02,0]]],
  // Card P10: the rock model's blocks: the Rock type (the world's own or a named type, sculpt-material-model.js ROCK_TYPES), then its size, age and joints.
  ['Rock face: blocks', [['rockType','Rock type',0,ROCK_TYPES.length,1,0],['rockScale','Block size (share of the rock type\'s)',.4,3,.05,1],['rockAge','Age (rounds edges, opens joints, wears chips)',0,1,.05,.5],['rockOpen','Open joints (joint depth and crevice darkness, share of the rock type\'s)',0,2,.05,1]]],
  // G2: rock faces follow the slope; every default is the earlier look.
  ['Structure orientation', [['cliffFollow','Beds on the contours, joints down the fall line (0 fixed screen directions)',0,1,1,0],['cliffReach','Fall line smoothing radius (px)',6,60,1,20],['cliffWide','Wide fall line radius, level ground under rock (px)',20,160,2,56],['cliffFlat','Slope under which structure fades into broken rock',0,.3,.005,.04],['cliffRise','Bed riser height (units; 0 the bed\'s own)',0,40,1,0],['cliffBed','Beds follow the smoothed ground (0 the grid\'s own bumps)',0,1,.05,.5],['cliffStagger','Joints offset from bed to bed (share of spacing)',0,.8,.05,0],['cliffDomain','Joint lattice patch size (px)',30,240,5,90]]],
  // Water detail: the shallow-to-deep step, the shallow bed and the waterline (cards E11, G1).
  ['Water detail', [['stepSoftPx','Threshold edge softness (px)',1,40,1,1],['shelfWander','Shelf wander (depth units)',0,40,1,0],['bedFlat','Bed lit by its own relief only',0,1,.05,0],['bedDots','Bed speckles',0,1,.02,0],['bedDotCell','Dot spacing (px)',6,40,1,14],['crackedStep','Cracked-bed transition depth',0,60,1,0],['shoalBump','Lit bumps in the bed (slope)',0,6,.1,0],['shoalBumpPx','Bump size (px)',2,16,.5,6],['shoalGrain','Grain through water tint',0,1,.05,0],['shoalRag','Shallow-to-deep notches (px)',0,16,.5,0],['shoalStairs','Hard waterline stairs (px)',0,6,.1,0],['shoalShoreSoft','Waterline blur (px)',0,12,.5,0]]],
  // Contour fringe: lines along the mineral fringe and offset copies of it (cards E11, G3).
  ['Contour fringe', [['ringContrast','Fringe contour lines: contrast',0,1,.05,0],['ringCount','Fringe contour lines: count',1,30,1,7],['ringSize','Fringe contour lines: reach',.1,2,.05,1],['ringShift','Offset between copies (px; 0: concentric lines)',0,30,.5,0],['ringShiftDir','Drift direction (deg clockwise from east)',0,360,5,315],['ringScatter','Direction wander (share of a half turn)',0,1,.05,.5],['ringWobble','Outline waver (px)',0,10,.5,3],['ringLobe','Lobe size (px)',8,60,1,22],['ringFill','Pale tint where copies overlap',0,1,.05,0],['ringPatch','Reach varies along the outline',0,1,.05,0],['ringPatchSize','Reach variation size (px)',30,400,5,120],['ringTone','Retail rose, paler outward',0,1,.05,0]]],
  // Card E10: crust on hills and creases at terrace feet.
  ['Pillow crust', [['lavaCrust','Pillow crust strength',0,1,.05,0],['lavaPillow','Pillow size (px)',16,80,1,34],['lavaChip','Chip size (px)',3,12,.5,5.5],['lavaVeins','Veins hanging down the slope',0,1,.05,0],['lavaCalm','Replace fine relief with crust',0,1,.05,.6],['lavaDusk','Shade away from light',0,2,.05,0]]],
  ['Terrace creases', [['layerCrease','Dark crease at each step foot, any facing',0,1,.05,0],['shineSlopeGate','Shine only on slopes above (0: everywhere)',0,1.5,.05,0]]],
  // Card E6: where roughness shows, and the body dimmed between glints.
  ['Shine: gate and headroom', [['shineGate','Roughness only on raised ground and slopes',0,1,.05,0],['shineHeadroom','Dim the body between glints (near-white surface)',0,1,.05,0]]],
  ['Surface pits', [['pockmark','Dark pits on raised ground and slopes',0,1,.05,0],['pockSize','Pit spacing (px)',3,12,.5,5]]],
  // Card G8: cups, ribs and folds on steep faces.
  ['Cups, ribs & folds', [['moonCups','Slope cups',0,1,.05,0],['moonCupSize','Cup spacing (px)',3,12,.5,5.5],['moonCupDepth','Cup depth (wall steepness)',.4,3,.1,1.4],['moonRibs','Slope ribs',0,1,.05,0],['moonRibDepth','Stroke steepness',.2,3,.1,1],['moonRibDark','Darker where turned from the sun',0,.9,.05,0],['moonFolds','Contour folds',0,1,.05,0],['moonFoldSpacing','Fold spacing (height units)',.3,3,.1,.9]]],
  ['Mineral faces', [['iceSlate','Slate faces',0,1,.05,0],['mineralDetail','Rock art contrast',0,2,.05,1],['iceCrystal','Straight face fibres',0,1,.05,0],['iceCrest','Cap lumps',0,1,.05,0]]],
  // Card G6: rounded light, caps and face finish on raised ground.
  ['Cap & face finish', [['iceSoft','Rounded lighting',0,1,.05,0],['iceSnow','Snow on level caps',0,1,.05,0],['iceFall','Slope fibres',0,1,.05,0],['iceApron','Hatched foot apron',0,1,.05,0]]],
  ['Needle lines', [['iceFrost','Needle hairlines',0,1,.05,0]]],
  ['Shore pockets', [['frostGaps','Melt pockets: share of cells at the coast',0,.6,.01,.17],['frostGapReach','Melt pockets: reach inland (share of the band)',.2,1.2,.05,.65],['frostGapSize','Melt pockets: size (px)',3,24,1,11],['frostGapDepth','Melt pockets: depth below the sea',.5,6,.1,3]]],
];

// The ground node's field each undulation row sets.
const UNDULATION={undulation:'amplitude',undulationScale:'wavelength',undulationCover:'coverage'};
// World settings the shape reads (sculpt-scene.js shapeContext: the frost gaps and the talus slope), so the shape runs again from the first node.
const SHAPE_KNOBS=new Set(['frostGaps','frostGapReach','frostGapSize','frostGapDepth','talusAngle']);
// A world knob's change. The value goes into the page's settings (its address, which the shape context and a scene's ground node read) and
// the renderer's settings, whose uniforms it re-reads; the answer says what else the change needs, for the host to carry out on its own
// fields: `reload` (the ground textures and a borrowed beach are chosen when the renderer starts, so nothing else is set), `evaluate` (the shape again from that
// node: the undulation rows edit the ground node in `nodes`, or put one first when Undulation height turns on), `checkpoint` (an undo step for
// that edit) and `weather` (the Time pass again; alone, for the deposit supply, which changes the generated deposit field, and the rain).
export function applyKnob({key,value,settings,renderer,nodes,seed}) {
  settings.set(key,value);
  if (key==='ground' || key==='groundPattern' || key==='beachFrom') return {reload:true};
  renderer.variant.set(key,value); renderer.applyKnobs();
  if (Object.hasOwn(UNDULATION,key)) {
    const i=nodes.findIndex(n => n.kind==='ground');
    if (i>=0) { nodes[i][UNDULATION[key]]=Number(value); return {evaluate:i,checkpoint:true,weather:true}; }
    if (key==='undulation' && Number(value)>0) { nodes.unshift({kind:'ground',amplitude:Number(value),wavelength:160,seed:seed^0x9e37}); return {evaluate:0,checkpoint:true,weather:true}; }
    return {};
  }
  if (SHAPE_KNOBS.has(key)) return {evaluate:0,weather:true};
  if (key==='sand' || key==='erosionRain') return {weather:true};
  return {};
}

// The Colors panel's rows, [key, label].
export const COLOR_KEYS=[['ground','Ground'],['slope','Slope cover'],['rock','Rock'],['sand','Sand'],['beach','Beach'],['shallow','Shallow water'],['deep','Deep water'],['crystal','Crystal'],['vegetation','Vegetation'],...Array.from({length:4},(_,i)=>['flower'+(i+1),'Flower '+(i+1)]),['sun','Sun color'],['sky','Sky color'],['strata1','Strata 1'],['strata2','Strata 2'],['strata3','Strata 3'],['strata4','Strata 4'],['strata5','Strata 5']];
// The rows this world shows: Vegetation and a flower's where the world's ground-cover table has them (every world's has; they act once
// Vegetation cover is above 0), Beach only with a beach layer, the strata only on a
// world without a rock column whose address turns Strata on.
export const colorRows=(config,settings) => COLOR_KEYS.filter(([key]) => !(key.startsWith('flower')&&!config.material?.groundCover?.plants?.flowers?.palette?.[Number(key.slice(6))-1]) && !(key==='vegetation'&&!config.material?.groundCover?.color)
  && !(key==='beach'&&!config.layers.includes('beach')) && !(key.startsWith('strata')&&(config.column?.colors||!(Number(settings.get('strata'))>0))));
// A world's own base colors after a row is picked (a hex) or cleared (null): a color the server sets is then explicitly off (null, the
// texture's own color), any other is dropped.
export function pickWorldColor(config,own,key,hex) {
  if (hex) return {...own,[key]:hex};
  if (config.colors?.[key]) return {...own,[key]:null};
  const {[key]:_,...rest}=own; return rest;
}

// A shape's own water choices, which turn the hard step, the ramp and the lit bed on inside its footprint whatever the world says (engine-frag.wgsl's `pick`).
export function strokeWaterPicks(nodes) {
  const water=nodes.filter(n=>n.kind==='landform'),picked=(key,...choices)=>water.some(n=>choices.includes(Math.round(n.params?.[key]||0)))?1:0;
  return {deepEdge:picked('waterDeep',1),fadedEdge:picked('waterDeep',2),bedLit:picked('waterBed',1,3),crackedBed:picked('waterBed',3)};
}
// A Shallow water or Deep water base color picked in the Colors panel (`colors`: the renderer's, sculpt-scene.js rendererColors): the water is then two flat tones, whatever the world's own (engine-frag.wgsl skips the lit bed and the third colour).
export const waterColored=colors => Boolean(colors.shallow||colors.deep);
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
// The column facts read the active column (config.column: the map's own from the Rock column panel, else the world's) and its variant row.
export function worldPanelValues(facts) {
  const {config,renderer,nodes,colors}=facts,layers=config.layers||[],own=Object.fromEntries(renderer.variant),picks=strokeWaterPicks(nodes);
  return {...own,deepEdge:Math.max(Number(own.deepEdge)||0,picks.deepEdge),bedLit:Math.max(Number(own.bedLit)||0,picks.bedLit),rampWater:Number(own.deepEdge)>0?picks.fadedEdge:1,crackedBed:picks.crackedBed,waterTones:waterTones(config,colors),waterColored:waterColored(colors)?1:0,slopeReplaced:slopeReplaced(facts)?1:0,column:columnRows(config.column,config.variant).starts.length?1:0,capBed:columnHasCapBed(config.column,config.variant)?1:0,ringLayer:layers.includes('ring')?1:0,beachLayer:layers.includes('beach')?1:0,groundTiled:renderer.groundTiled?1:0,slopeSand:config.material?.slopeSand?1:0,...rockFacts(config.material?.rock||{})};
}
