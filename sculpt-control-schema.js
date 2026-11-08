import {strokeKnots,sampleKnots,landformSteps,landformShore,landformMakesWater,landformDigs} from './sculpt-shape-presets.js';
import {isRiver} from './sculpt-river.js';
// Presentation names and applicability belong to features, never to worlds.
export const WORLD_GROUP_NAMES={
 'Light':'Lighting','Relief':'Ground detail','Faces':'Material coverage','Desert foot band':'Foot color band','Desert caps':'Cap color',
 'Shallow water, round 2':'Water detail','Shallow water, round 3':'Water detail',
 'Fringe lines (Archipelago)':'Contour fringe','Fringe copies (Archipelago)':'Contour fringe',
 'Lava hill rock':'Pillow crust','Lava banks':'Terrace creases','Pockmarks (Moon)':'Surface pits',
 'Moon surface':'Cups, ribs & folds','Ice mountains':'Mineral faces','Ice blocks and mesas':'Cap & face finish',
 'Ice frost lines':'Needle lines','Ice frost band':'Shore pockets',
 'Rock face: follows the slope':'Structure orientation','Rock face: gullies and ribs':'Gullies & ribs','Rock face: facets':'Microfacets'
};
export const WORLD_CHOICES={deepEdge:[[0,'Ramp'],[1,'Hard step']],cliffFollow:[[0,'Fixed directions'],[1,'Follow terrain']],paletteMix:[[0,'Nearest color'],[1,'Mix color pairs']]};
const LABELS={plainRelief:'Ground bumps',lumpRelief:'Painted ground bumps',rockOrder:'Rock structure',rockStain:'Stain',sunTilt:'Light from the south',ambient:'Ambient light',sand:'Deposit supply',wind:'Ripple direction (degrees)',sandGrass:'Vegetation through sand',hillLight:'Slope-cover brightness',ringFade:'Fringe fade length',slopeMarks:'Dark slope marks',wrinkles:'Joined slope wrinkles',
 desertCapFlat:'Uniform cap color',rockMoss:'Vegetation tint in rock',wetSwath:'Moisture',lushness:'Lushness',shoreEdge:'Waterline rim and lip',
 bedDots:'Bed speckles',crackedStep:'Cracked-bed transition depth',shoalGrain:'Grain through water tint',shoalShoreSoft:'Waterline blur (px)',
 lavaCrust:'Pillow crust strength',lavaCalm:'Replace fine relief with crust',lavaDusk:'Shade away from light',
 moonCups:'Slope cups',moonRibs:'Slope ribs',moonFolds:'Contour folds',
 iceSlate:'Slate faces',iceCrystal:'Straight face fibres',iceCrest:'Cap lumps',iceSoft:'Rounded lighting',iceSnow:'Snow on level caps',iceFall:'Slope fibres',iceApron:'Hatched foot apron',iceFrost:'Needle hairlines',
 crystalSides:'Polygon sides',crystalTop:'Flat top share',
 crystalTiers:'Level tops',crystalAlign:'Align to the path',crystalStep:'Step height',crystalFacet:'Top tilt',crystalSizeVar:'Size mix',facetForm:'Facet shape',bergJitter:'Outline jitter',bergBreak:'Corner cuts',bergRough:'Face roughness',
 crystalShoreSeam:'Slab seam weight',plateVary:'Slab variety',
 iceFacets:'Facets',iceFacetSize:'Facet width (px)',lavaSpread:'Layer width spread',lavaCircleVary:'Circular bite variation',
 fissureNetwork:'Cut layout',plateMaterial:'Shore structure',fingers:'Shore lobes',fingerSize:'Lobe size',
 styleVegetation:'Local vegetation',
};
export function controlLabel(key,label){return LABELS[key]||label.replace(/ \((?:Archipelago|Moon|Lava|Red|Green|Ice|Crystal)(?:[^)]*)\)/g,'').replace(/\bice\b/gi,'surface');}
// Facets: each Facet shape's own rows (0 angular facets, 1 stepped columns, 2 prisms); Step height serves angular facets and columns, Level tops columns and prisms.
const FACET_SHAPE_KEYS=[[],['crystalFacet','crystalSizeVar'],['crystalSides','crystalTop','crystalVariation','crystalAlign','bergJitter','bergBreak','bergRough']];
export const LANDFORM_FACET_KEYS=['crystalStep','crystalTiers',...FACET_SHAPE_KEYS.flat()];
export function shapeControlAvailable(key,kind,p){
 // A landform has its own width (the diameter), softness-free presets and variation (card H27).
 if(kind==='landform'&&['softness','faceVariation'].includes(key))return false;
 if(kind==='landform'){
  const shore=Number(p.stepReference)>0,circular=Number(p.stepReference)===2,on=Number(p.terraces)>0;
  if(['ledge','terraceJitter'].includes(key))return on;
  if(key==='breakup')return on&&!shore;
  if(['layerPx','layerRiser','layerVary'].includes(key))return on&&shore;
  if(key==='lavaSpread')return on&&shore&&!circular;
  // Surf works a shore, which only a stroke that makes water has.
  if(key==='surf')return landformMakesWater(p);
  // Gullies cut only into ground a landform raises, and Cut to never raises it.
  if(['gullies','gullySize'].includes(key))return Math.round(Number(p.combine||0))!==1;
  // Talus rests on ground the stroke raises, so it works with the plain Raise choice only.
  if(key==='talus')return Math.round(Number(p.combine||0))===0;
  if(['layerCircle','lavaCircleVary'].includes(key))return on&&circular;
  // A river's path is its channel, carried by its migration; an impact would read that path as its track (lfcrater).
  if(['ejecta','secondaries'].includes(key))return !isRiver(p);
  // lfimpact2: the ground buckles beyond the rim of a shape that digs into the ground it lands on (the engine's bucklingOn); its help says so.
  if(key==='buckling')return !isRiver(p)&&landformDigs(p);
  // Secondaries' distance places the secondaries: it shows once there is one (its help says so).
  if(key==='secondaryDistance')return !isRiver(p)&&Math.round(Number(p.secondaries)||0)>=1;
  // Spur variation acts on spurs: it shows once Spurs is on (its help says so).
  if(key==='crestVary')return Math.round(Number(p.spurCount)||0)>=1;
 }

 const plates=p.shorePlates>0,slab=p.plateMaterial<2;
 // The face wanders on the shoulder of Reset ground and the cover brushes.
 if(key==='faceVariation')return ['erase','paint','sand','grass'].includes(kind);
 // p.world is what worldControlRequirement reads.
 const world=p.world||{};
 // A stroke's edge choice moves the step only where the step's deep share is drawn; its own Lit bed draws it.
 if(key==='waterDeep'&&!deepShows(world,[1,3].includes(Math.round(p.waterBed||0))))return false;
 // A side to lean toward means something once the two sides differ: a Lean other than 1, or different front and back sections.
 if(key==='facing'&&kind==='landform'){
  if(p.lean>0&&p.lean!==1)return true;
  // Facing swaps the two sides; equal widths and equal sampled sections have no direction to choose.
  const k=strokeKnots(kind,p);if(!k.back)return false;
  const front=sampleKnots(k.knots),back=sampleKnots(k.back);return front.some((v,i)=>v!==back[i]);
 }
 if(key==='facing')return p.lean>0;
 if(['plateWaterPx','plateLandPx','plateSize','plateGap','plateHeight','plateMaterial','frostNeedles','crystalShoreSeam','plateVary'].includes(key))return plates&&(key==='frostNeedles'?!slab:key==='crystalShoreSeam'||key==='plateVary'?slab:true);
 // A landform's coast pass and its facets are one pass over its result; shore features take it.
 if(kind==='landform'&&['iceFacets','iceFacetSize','facetForm','facetSurface',...LANDFORM_FACET_KEYS].includes(key)&&landformShore(landformSteps(p)))return false;
 if(['iceFacetSize','facetSurface'].includes(key))return p.iceFacets>0;
 // A landform that digs takes angular facets (fitted to its own surface up and down), so it has no shape to choose.
 const dig=landformDigs(p),fs=dig?0:Math.round(Number(p.facetForm)||0);
 if(key==='facetForm')return p.iceFacets>0&&!dig;
 // Each shape's own rows show once facets are on and that shape is chosen.
 if(kind==='landform'&&LANDFORM_FACET_KEYS.includes(key))return p.iceFacets>0&&(key==='crystalStep'?fs<=1:key==='crystalTiers'?fs>=1:FACET_SHAPE_KEYS[fs].includes(key));
 return true;
}

// The two water switches a deep or shallow stroke can also turn on for its own footprint (worldPanelValues passes that in).
const HARD_STEP='Hard shallow-to-deep step, or a water stroke\'s Hard edge',LIT_BED='Lit bed under shallow water, or a water stroke\'s Lit bed';
// The step's deep share reaches a pixel only where something draws it: two water tones, a lit bed (a world's or a stroke's), a crystal slab's shallows
// (worldPanelValues passes the facts in). With one colour, or a third that follows the depth, nothing else reads it.
const deepShows=(v,litStroke=false)=>Number(v.waterTones??2)===2||Number(v.bedLit)>0||litStroke||Number(v.crystalShallow)>0;
const deepIdle=v=>`This world's water has ${Number(v.waterTones)===3?'a third colour that follows the depth':'one colour'}, so the shallow-to-deep step shows only where a lit bed or crystal shallows draw it. Enable Lit bed under shallow water, or give a water stroke a Lit bed, to use this setting.`;
const RAMP_IDLE='The ramp is drawn only where the step is off: choose Ramp in Hard shallow-to-deep step, or give a water stroke a Faded edge, to use this setting.';
// A Shallow water or Deep water base color (Colors panel) draws the water as two flat tones with the step's deep share between them, and skips the lit bed
// and the third colour (worldPanelValues passes `waterColored`, and `waterTones` is 2). The bed's rows then draw nothing; a lit bed still sets how much
// palette dither the hard step's shallows take.
const LIT_REPLACED='A Shallow water or Deep water color replaces the lit bed: clear it in Colors to use this setting.';
const CRACKED_BED='Give a water stroke the Cracked bed look (Shallow water look) to use this setting.';
// Dependencies describe pipeline features, never the active world. Search still
// finds an inactive setting and explains what must be enabled to use it.
export function worldControlRequirement(key,v){
 const n=k=>Number(v[k]??0),joints=()=>n('rockJoint')*n('rockOpen'),needs=(parent,label)=>worldControlRequirement(parent,v)||(n(parent)<=0?`Enable ${label} to use this setting.`:'');   // a parent that is itself idle names its own reason first
 if(['vegetationCover','plantRelief','flowerDensity'].includes(key)){
  if(!n('groundCover'))return 'This world has no ground-cover material.';
  if(key==='vegetationCover')return '';
  if(Number(v.vegetationCover??1)<=0)return 'Raise Vegetation cover to use this setting.';
  if(key==='flowerDensity')return n('flowers')?'':'This ground-cover material has no flowers.';
  if(!n('plants'))return 'This ground-cover material has no plant relief.';
 }
 if(['undulationScale','undulationCover'].includes(key))return needs('undulation','Undulation height');
 if((['bedHeight','bedVary','bedPunch'].includes(key)||key==='bedSpacing'&&n('cliffRise')<=0)&&n('column')>0)return 'The authored bed profile supplies this value. Random bed controls do not apply.';   // with a Riser height a column's ledge scales by bed thickness over this spacing
 if(['strata','strataContrast','strataGrain'].includes(key)&&n('column')<=0)return 'This world has no rock column.';
 if(key==='bedDipDir')return worldControlRequirement('bedDip',v)||(n('bedDip')===0?'Set Bed tilt above or below zero to choose its direction.':'');
 if(['bedSpacing','bedHeight','bedVary','bedDip','bedDipDir','bedLedge','grooveSpacing','grooveAngle','grooveRun','bedPunch','gullyDepth','gullyWidth','rockStain','ribTilt','rockScale','rockAge','rockOpen'].includes(key)&&n('rockOrder')<=0)return 'Enable ordered Rock structure to use this setting.';
 // The lines' places are cut by joints and gullies, and the ribs between gullies stand on the same lines; their length matters only to a cut.
 if(['grooveSpacing','grooveAngle'].includes(key))return joints()>0||n('gullyDepth')>0||n('ribTilt')>0?'':'Set Open joints, Gully depth or Rib tilt above zero (and use a rock type with joint lines) to use this setting.';
 if(key==='grooveRun')return joints()>0||n('gullyDepth')>0?'':'Set Open joints or Gully depth above zero (and use a rock type with joint lines) to use this setting.';
 if(['rockScale','rockAge'].includes(key)&&n('rockCells')<=0)return 'This rock type has no blocks; Size and Age shape them.';
 if(key==='rockOpen'&&n('rockCells')<=0&&n('rockJoint')<=0)return 'This rock type has no blocks and no joint lines to open.';
 if(key==='cliffStagger')return n('rockOrder')<=0?'Enable ordered Rock structure to use this setting.':n('cliffFollow')<=0?'Choose Follow terrain in Structure orientation to use this setting.':(joints()>0?'':'This rock type has no open joint lines; raise Open joints or choose a rock type with joint lines.');
 if(key==='sandBandSpacing')return needs('sandBanding','Streaks on sand and ramps');
 if(key==='bedDotCell')return needs('bedDots','Bed speckles');
 if(key==='pockSize')return needs('pockmark','Surface pits');
 if(/^moonCup/.test(key)&&key!=='moonCups')return needs('moonCups','Slope cups');
 if(/^moonRib/.test(key)&&key!=='moonRibs')return needs('moonRibs','Slope ribs');
 if(key==='moonFoldSpacing')return needs('moonFolds','Contour folds');
 if(['lavaPillow','lavaChip','lavaVeins','lavaCalm'].includes(key))return needs('lavaCrust','Pillow crust strength');
 if(['frostGapReach','frostGapSize','frostGapDepth'].includes(key))return needs('frostGaps','Shore pockets');
 if(key==='gullyWidth')return needs('gullyDepth','Gully depth');
 if(key==='rockStain'&&n('gullyDepth')<=0&&n('rockCurtains')<=0)return 'Enable Gully depth or use a rock type with ledge stains to use this setting.';
 // Beds and joints draw only in ordered rock, and the bed profile only where a ledge or lip gives it relief.
 if(['rockFrom','cliffFollow','cliffReach','cliffWide','cliffFlat','cliffRise','cliffBed','cliffStagger','cliffDomain'].includes(key)&&n('rockOrder')<=0)return 'Enable ordered Rock structure to use this setting.';
 if(['cliffReach','cliffWide','cliffFlat','cliffBed','cliffDomain'].includes(key)&&n('cliffFollow')<=0)return 'Choose Follow terrain in Structure orientation to use this setting.';
 // A joint's stagger is keyed on its bed and blocks read the bed height, so the beds' shape outlives their relief there.
 const bedsMoveJoints=joints()>0&&n('cliffFollow')>0&&n('cliffStagger')>0&&['bedSpacing','bedHeight','bedVary','bedDip','cliffBed'].includes(key);
 if(['bedSpacing','bedHeight','bedVary','bedDip','bedPunch','cliffRise','cliffBed'].includes(key)&&n('bedLedge')<=0&&!bedsMoveJoints)return 'Set Ledges above zero in Rock structure to give the beds relief.';
 // Colour beds and the bands on them need the strata switch, and the band and cap rows a rock column to bed.
 if(['strataContrast','strataGrain'].includes(key))return needs('strata','Strength (painted beds) in Strata');
 // Cap color holds level ground to one bed only in a section of two beds where one fills over 88 percent of the cycle (worldPanelValues passes capBed in).
 if(['baseBand','desertCapFlat'].includes(key)){const r=n('column')<=0?'This world has no rock column.':needs('strata','Strength (painted beds) in Strata');return r||(key==='desertCapFlat'&&n('capBed')<=0?'The rock column has no cap bed: a section of two beds where one fills over 88 percent of the cycle. Edit the column to add one.':'');}
 if(['baseBandLow','baseBandHigh','baseBandWander','baseBandGaps'].includes(key))return needs('baseBand','Gray band strength');
 // Shine: a lobe needs its material's gloss, a grain its roughness; the shared rows need some material shining.
 // The slope group's weight is the larger of the faces' moss share (microRock) and the slope cover scaled by Sampled slope texture (a sandy slope scales it by its own sand instead).
 // With neither it has no share, and its gloss does not wake the pass (uShineOn, sculpt-renderer.js).
 const noSlopeShare=(n('slopeTexture')<=0||n('groundCover')>0)&&n('slopeSand')<=0&&Number(v.microRock??1)<=0;
 if(noSlopeShare&&/^shineSlope(Sharp|Scale|Rough)?$/.test(key))return 'This world\'s faces are one material and Sampled slope texture is 0, so the slope cover has no share to shine. Raise Sampled slope texture to use this setting.';
 const shine=['Ground','Slope','Rock','Sand','Crystal'].filter(m=>m!=='Slope'||!noSlopeShare),shiny=shine.some(m=>n('shine'+m)>0),rough=shine.some(m=>n('shine'+m+'Rough')>0);
 const lobe=/^shine(Ground|Slope|Rock|Sand|Crystal)(Sharp|Scale)$/.exec(key);
 if(lobe)return needs('shine'+lobe[1]+(lobe[2]==='Sharp'?'':'Rough'),(lobe[2]==='Sharp'?'Gloss':'Roughness')+' in Shine: '+({Ground:'ground',Slope:'slope cover',Rock:'rock',Sand:'sand',Crystal:'crystal'})[lobe[1]]);
 if(['shineWhite','shineHeadroom'].includes(key))return shiny?'':'Set a Gloss above zero in one of the Shine groups to use this setting.';
 if(key==='shineStretch')return rough?'':'Set a Roughness above zero in one of the Shine groups to use this setting.';
 if(['shineGate','shineOutside','shineSlopeGate'].includes(key))return shiny||rough?'':'Set a Gloss or Roughness above zero in one of the Shine groups to use this setting.';
 if(['faceEdge','gullyRock','iceSlate'].includes(key)&&Number(v.microRock??1)<=0)return 'This world\'s faces are one material, not rock and moss interleaved, so there is nothing for this setting to place.';
 // A world with a beach keeps the Sand brush for its bars, so the sand these rows draw comes only from the weathering's supply.
 if(['wind','ripple','rippleHeight','sandDust','sandGrain','sandGrass','sandLight'].includes(key)&&n('beachLayer')>0)return needs('sand','Weathering supply in Sand');
 // Water wets the ground only where the Time pass has rain; the worlds that run it with rain off have no wetness map to read.
 if(key==='wetSwath'&&n('erosionRain')<=0)return 'This world\'s weathering has no rain, so no ground is wet. Moisture has nothing to move.';
 if(key==='slopeTexture'&&n('groundCover')>0)return 'This world\'s ground-cover table decides its slope cover.';
 if(key==='slopeTexture'&&n('slopeSand')>0)return 'The slopes of this world are sand, which has no texture to scale.';
 // The sediment transition is built from the ground and replaces the slope cover's color outright at 100 percent Material weathering (worldPanelValues passes slopeReplaced); the texture then scales only the slope's share of the shine.
 if(key==='slopeTexture'&&n('slopeReplaced')>0&&!shiny&&!rough)return 'The sediment transition replaces the slope color at 100 percent Material weathering, so this scales only the slope\'s gloss. Lower Material weathering, or set a Gloss or Roughness above zero in one of the Shine groups, to use this setting.';
 // The palette's ordered dither runs only when colors are not mixed in pairs.
 if(['dither','landDither'].includes(key)&&n('paletteMix')>0)return 'Choose Nearest color in the Palette to use this setting.';
 // The water: the lit bed is the only place the bed's rows draw, the hard step the only place the step's rows do.
 if(['bedTint','bedBright','bedContrast','bedFlat','bedDots','shoalGrain'].includes(key))return n('waterColored')>0?LIT_REPLACED:needs('bedLit',LIT_BED);
 if(key==='bedLit'&&n('waterColored')>0)return n('deepEdge')>0&&n('paletteMix')<=0&&n('dither')>0?'':LIT_REPLACED;
 if(key==='deepEdge')return deepShows(v)?'':deepIdle(v);
 if(['shallowDepth','deepDepth'].includes(key))return Number(v.waterTones)===3||deepShows(v)?'':deepIdle(v);   // a third colour is cut by these depths whatever the step does
 if(['waterSoft','bandWater'].includes(key))return Number(v.waterTones)===3?'':!deepShows(v)?deepIdle(v):n('rampWater')>0?'':RAMP_IDLE;
 if(['stepSoftPx','shelfWander','shoalRag'].includes(key))return needs('deepEdge',HARD_STEP);
 // The waterline's stairs and blur are drawn only by a crisp waterline, and a blur replaces the stairs (engine-frag.wgsl, the shore's crisp cut).
 if(key==='shoalShoreSoft')return needs('crispShore','Crisp waterline');
 if(key==='shoalStairs')return needs('crispShore','Crisp waterline')||(n('shoalShoreSoft')>0?'Waterline blur replaces the stairs. Set it to 0 to use this setting.':'');
 if(key==='crackedStep')return needs('deepEdge',HARD_STEP)||(n('crackedBed')>0?'':CRACKED_BED);
 if(key==='shoalBump')return n('waterColored')>0?LIT_REPLACED:needs('bedLit',LIT_BED)||needs('deepEdge',HARD_STEP);
 if(key==='shoalBumpPx')return needs('shoalBump','Lit bumps in the bed');
 if(/^ring[A-Z]/.test(key)&&n('ringLayer')<=0)return 'This world draws no mineral fringe.';
 if(key==='beachWidth'&&n('beachLayer')<=0)return 'This world has no beach layer.';
 if(key==='groundTiles'&&n('groundTiled')<=0)return 'This world\'s ground is one texture, not tiles. Choose another world\'s Ground pattern to use this setting.';
 if(key==='ringShiftDir'||key==='ringScatter')return needs('ringShift','Offset between copies');
 if(key==='ringPatchSize')return needs('ringPatch','Reach variation');
 return '';
}

// Primary controls describe a visible feature. Fine tuning remains available
// explicitly (and through search), without filling the default inspector.
export const WORLD_PRIMARY_CONTROLS=new Set([
 'vegetationCover','plantRelief','flowerDensity',
 'groundTiles','groundContrast','undulation','undulationScale','undulationCover',
 'reliefScale','reliefAmount','reliefLumps','gentleRelief','plainRelief','lumpRelief',
 'flatShadow','flatOcclusion','sunTilt','ambient','shadeDepth','lightCap',
 'hillLight','faceFill','rockCrown','sandCrown','slopeTexture','moss','wetSwath','lushness','slopeMarks','wrinkles',
 'shineGround','shineSlope','shineRock','shineSand','shineCrystal',
 'looseSupply','looseSize','sand','sandGrain','sandLight','ripple','rippleHeight','wind',
 'crackSeverity','crackSpacing','rockOrder','rockFrom','bedSpacing','bedLedge','rockOpen',
 'banding','sandBanding','strata','strataContrast',
 'beachWidth','apron','shallowDepth','deepDepth','crispShore','deepEdge','bedLit','bedTint','bedBright','bedContrast','bedRelief','shoreEdge',
 'baseBand','desertCapFlat','rockMoss','rockStain','rockDetail','faceRelief','gullyDepth','grooveSpacing','rockScale','cliffFollow',
 'shelfWander','bedFlat','bedDots','crackedStep','shoalBump','shoalGrain',
 'ringContrast','ringCount','ringSize','ringShift','ringTone',
 'lavaCrust','lavaPillow','lavaVeins','layerCrease','pockmark',
 'moonCups','moonRibs','moonFolds','iceSlate','mineralDetail','iceCrystal','iceCrest','iceSoft','iceSnow','iceFall','iceApron','iceFrost','frostGaps'
]);
