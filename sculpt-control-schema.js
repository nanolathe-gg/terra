import {strokeKnots,sampleKnots,landformSteps,landformShore,landformMakesWater,landformDigs} from './sculpt-shape-presets.js';
import {isRiver} from './sculpt-river.js';
// Presentation names and applicability belong to features, never to worlds.
export const WORLD_CHOICES={deepEdge:[[0,'Ramp'],[1,'Hard step']],paletteMix:[[0,'Nearest color'],[1,'Mix color pairs']]};
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
  if(['layerPx','layerRiser','layerVary','layerJag'].includes(key))return on&&shore;
  if(key==='lavaSpread')return on&&shore&&!circular;
  // Surf works a shore, which only a stroke that makes water has.
  if(key==='surf')return landformMakesWater(p);
  // Gullies cut only into ground a landform raises, and Cut to never raises it.
  if(['gullies','gullySize'].includes(key))return Math.round(Number(p.combine||0))!==1;
  // Talus rests on ground the stroke raises, so it works with the plain Raise choice only.
  if(key==='talus')return Math.round(Number(p.combine||0))===0;
  // Hard beds stand in ground the stroke raises (the plain Raise choice), and their strength shows once there is a bed.
  if(key==='beds')return Math.round(Number(p.combine||0))===0;
  if(key==='bedSoft')return Math.round(Number(p.combine||0))===0&&Math.round(Number(p.beds)||0)>=1;
  // Variation along the wall works on the Wander, the Gullies and the Hard beds: it shows once one of them is on. A river's path is its channel.
  if(key==='wallVary')return !isRiver(p)&&(Number(p.wander)>0||Number(p.gullies)>0||Math.round(Number(p.beds)||0)>=1);
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
 // A stroke's Soft bank takes the world's shore rock away, so it shows once the world has some.
 if(key==='waterShore')return Number(world.shoreRock)>0||Number(world.shoreShelf)>0;
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

// The switch a water stroke can also turn on for its own footprint (worldPanelValues passes that in).
const HARD_STEP='Hard shallow-to-deep step, or a water stroke\'s Hard edge';
const RAMP_IDLE='The ramp is drawn only where the step is off: choose Ramp in Hard shallow-to-deep step, or give a water stroke a Faded edge, to use this setting.';
const NO_COLUMN='Add a rock column in the Rock column panel to use this setting.';
// Dependencies describe pipeline features, never the active world. Search still
// finds an inactive setting and explains what must be enabled to use it.
export function worldControlRequirement(key,v){
 const n=k=>Number(v[k]??0),needs=(parent,label)=>worldControlRequirement(parent,v)||(n(parent)<=0?`Enable ${label} to use this setting.`:'');   // a parent that is itself idle names its own reason first
 if(['faceJointWidth','faceSecondary','faceContinuity'].includes(key))return needs('faceJoint','Joint depth');
 if(['faceWhole','faceWholeLarge'].includes(key))return needs('rockFace','Rock relief: Depth');
 if(key==='sandLee')return needs('sand','Deposit supply in Sand');
 if(key==='groundPatchSize')return needs('groundPatch','Ground patches');
 if(key==='faceRegular')return worldControlRequirement('faceBlockSize',v);   // it moves every block and joint, as Joint spacing does
 if(key==='faceDetailPatch')return needs('rockFace','Rock relief: Depth')||(Math.max(n('faceCrease'),n('faceGrit'),n('faceScratch'))>0?'':'Raise Pitting, Grit relief, or Scratches and water grooves to cluster fine detail.');
 const fractures=Math.max(n('faceBreak'),n('faceSpall'),n('faceJoint'));
 if(key==='faceRind')return needs('rockFace','Rock relief: Depth');
 if(key==='faceFresh')return needs('rockFace','Rock relief: Depth')||(fractures>0?'':'Raise Block release, Broken layer edges, or Joint depth to expose fresh rock.');
 if(key==='faceRindDepth')return needs('rockFace','Rock relief: Depth')||(Math.max(n('faceFresh'),n('faceRind'))>0&&fractures>0?'':'Enable fresh fractures or a weathered crust, with Block release, Broken layer edges, or Joint depth.');
 if(['faceRindTone','faceRindWarmth','faceRindRough'].includes(key)){const parent=needs('faceRind','Weathered crust coverage');return parent||(key==='faceRindRough'&&Math.max(n('shineRock'),n('shineRockRough'),n('faceWet'))<=0?'Raise rock Gloss, Micro roughness, or Wetness to see the crust finish.':'');}
 if(key==='faceClastSize')return needs('faceClast','Embedded fragment relief');
 if(key==='faceClast')return n('rockFace')>0||n('faceMineral')>0?'':'Raise Rock relief: Depth or Mineral contrast to use embedded fragments.';
 if(key==='faceGritSize')return n('faceGrit')*n('rockFace')>0||n('faceMineral')>0||(n('faceRind')*n('rockFace')>0&&(n('faceRindRough')>0||n('shineRockRough')>0)&&Math.max(n('shineRock'),n('shineRockRough'),n('faceWet'))>0)?'':'Raise Grit relief, Mineral contrast, or a lit weathered crust to use Grit size.';
 if(key==='faceRound')return n('rockFace')*n('faceBlock')>0||(n('faceClast')>0&&Math.max(n('rockFace'),n('faceMineral'))>0)?'':'Raise Block offsets and tilts with Rock relief: Depth, or enable embedded fragments, to round the rock.';
 if(['faceBreak','faceJointTilt','faceScaleVary','faceStretch','faceBlockHeight'].includes(key))return n('rockFace')>0||(n('debrisAmount')>0&&(key==='faceBreak'||n('faceBreak')>0))?'':'Raise Rock relief: Depth or enable cliff debris with Block release.';
 if(['faceSpall','rimReach','shoreRock','shoreShelf','shoreRock','shoreShelf'].includes(key))return needs('rockFace','Rock relief: Depth');
 if(key==='runoffCut')return needs('runoff','Runoff exposure')||needs('rockFace','Rock relief: Depth');
 if(['runoffScale','runoffConcentration','runoffStain'].includes(key))return needs('runoff','Runoff exposure');
 if(['debrisReach','debrisDepth'].includes(key))return needs('debrisAmount','Cliff debris accumulation');
 if(key==='stoneRound'&&n('stoneSlab')>=1)return 'Reduce Flat fragments below 100% to round the remaining fragments.';
 if(['stoneSort','stoneRound','stoneSlab'].includes(key))return Math.max(n('looseSupply'),n('debrisAmount'),n('stonePaint'),n('boulders'))>0?'':'Raise loose-stone Supply, Boulders or Cliff debris accumulation, or paint Denser scatter, to shape the stones.';
 // Rows that shape the rock's relief do nothing while it is flat (Depth 0); amount, placement, grass and colour act at any depth.
 if(['faceLaminaSize','faceScratchLength','faceScratchAngle'].includes(key)){
  const parent={faceLaminaSize:'faceLamina',faceScratchLength:'faceScratch',faceScratchAngle:'faceScratch'}[key];
  const label={faceLamina:'Fine layer relief',faceScratch:'Scratches and water grooves'}[parent];
  return needs(parent,label);
 }
 if(['faceJoint','faceExtrude','faceLamina'].includes(key))return needs('rockFace','Rock relief: Depth');
 if(['faceCreaseSize','faceCrease','faceBlock','faceLedge','faceScratch','faceScratchSize','faceGrit','faceWear','faceShade','faceLayers','faceMass'].includes(key))return n('rockFace')>0?'':'Raise Rock relief: Depth to use this setting.';
 if(['faceBlockSize','faceLean'].includes(key))return n('rockFace')>0||n('faceTone')>0||(n('debrisAmount')>0&&(key==='faceBlockSize'||n('faceBreak')>0))?'':'Raise Rock relief: Depth or Color variation to use this setting.';
 if(key==='bedCycleVary'&&n('repeatBeds')<2&&v.repeatBeds!==undefined)return 'Add at least two beds to a Rock column section to vary their repetition.';
 if(['faceBedVary','bedCycleVary'].includes(key))return n('column')<=0?NO_COLUMN:(Math.max(n('rockFace'),n('strata'),n('faceStrata'),n('faceWet'),n('debrisAmount'))>0?'':'Raise rock relief or layer color coverage to vary the beds.');
 if(key==='faceRun'&&n('faceFold')>0)return '';
 if(['faceBed','faceRun'].includes(key))return n('debrisAmount')>0||n('strata')>0||n('rockFace')>0||(n('column')>0&&(n('faceStrata')>0||n('faceWet')>0))?'':'Raise Rock relief: Depth, Layer tint, or Wetness to use this setting.';
 // Every world has a ground-cover table (sculpt.py DEFAULT_GROUND_COVER): Vegetation cover above 0 turns it on.
 const cover=n('vegetationCover')>0;
 if(['plantRelief','flowerDensity'].includes(key)&&!cover)return 'Raise Vegetation cover to use this setting.';
 // The sediment transition, at 100 percent Material weathering, replaces the ground's color outright (worldPanelValues' slopeReplaced), and the
 // flowers are dots in that color; the plants' relief is baked into the height and still shows.
 if(key==='flowerDensity'&&n('slopeReplaced')>0)return 'The sediment transition replaces the ground\'s color at 100 percent Material weathering, so no flower shows. Lower Material weathering to use this setting.';
 if(['plantRelief','flowerDensity'].includes(key))return '';
 if(['undulationScale','undulationCover','undulationArt'].includes(key))return needs('undulation','Undulation height');
 if(key==='lowReach')return n('lowTint')>0||Number(v.lowGrain??1)<1?'':'Raise Tint or lower Grain kept in Low ground to use this setting.';
 // Strata, the foot band and the cap color the beds of a rock column: the world's own, or one the map adds (the Rock column panel; worldPanelValues passes the active one).
 if(['strata','strataContrast','strataGrain'].includes(key)&&n('column')<=0)return NO_COLUMN;
 // Tilt deforms the voxel rock and its mineral coordinates as well as the column's colored beds.
 if(['bedDip','bedDipDir'].includes(key)&&Math.max(n('rockFace'),n('faceTone'),n('faceStrata'),n('faceWet'),n('debrisAmount'))<=0){const r=n('column')<=0?NO_COLUMN:needs('strata','Layer color coverage in Strata');if(r)return r;}
 if(key==='bedDipDir')return n('bedDip')===0&&n('faceFold')<=0?'Set Bed tilt above or below zero, or raise Fold amplitude, to choose its direction.':'';
 if(key==='sandBandSpacing')return needs('sandBanding','Streaks on sand and ramps');
 if(key==='pockSize')return needs('pockmark','Surface pits');
 if((/^moonCup/.test(key)&&key!=='moonCups')||key==='cupStretch')return needs('moonCups','Slope cups');
 if(/^moonRib/.test(key)&&key!=='moonRibs')return needs('moonRibs','Slope ribs');
 if(key==='moonFoldSpacing')return needs('moonFolds','Contour folds');
 if(['lavaPillow','lavaChip','lavaVeins','lavaCalm'].includes(key))return needs('lavaCrust','Pillow crust strength');
 if(['frostGapReach','frostGapSize','frostGapDepth'].includes(key))return needs('frostGaps','Shore pockets');
 // Colour beds and the bands on them need the strata switch, and the band and cap rows a rock column to bed.
 if(['strataContrast','strataGrain'].includes(key))return needs('strata','Layer color coverage in Strata');
 // Cap color holds level ground to one bed only in a section of two beds where one fills over 88 percent of the cycle (worldPanelValues passes capBed in).
 if(['baseBand','desertCapFlat'].includes(key)){const r=n('column')<=0?NO_COLUMN:needs('strata','Layer color coverage in Strata');return r||(key==='desertCapFlat'&&n('capBed')<=0?'The rock column has no cap bed: a section of two beds where one fills over 88 percent of the cycle. Add or edit one in the Rock column panel to use this setting.':'');}
 if(['baseBandLow','baseBandHigh','baseBandWander','baseBandGaps'].includes(key))return needs('baseBand','Gray band strength');
 // Shine: a lobe needs its material's gloss, a grain its roughness; the shared rows need some material shining.
 // The slope group's weight is the slope cover scaled by Sampled slope texture (a sandy slope scales it by its own sand instead). With none it
 // has no share, and its gloss does not wake the pass (uShineOn, sculpt-renderer.js).
 const noSlopeShare=(n('slopeTexture')<=0||cover)&&n('slopeSand')<=0;
 if(noSlopeShare&&/^shineSlope(Sharp|Scale|Rough)?$/.test(key))return cover?'The ground cover decides the slope cover while Vegetation cover is above 0, so the slope cover has no share to shine.':'Sampled slope texture is 0, so the slope cover has no share to shine. Raise Sampled slope texture to use this setting.';
 const shine=['Ground','Slope','Rock','Sand','Crystal'].filter(m=>m!=='Slope'||!noSlopeShare),shiny=shine.some(m=>n('shine'+m)>0),rough=shine.some(m=>n('shine'+m+'Rough')>0);
 const lobe=/^shine(Ground|Slope|Rock|Sand|Crystal)(Sharp|Scale)$/.exec(key);
 if(lobe)return needs('shine'+lobe[1]+(lobe[2]==='Sharp'?'':'Rough'),(lobe[2]==='Sharp'?'Gloss':'Roughness')+' in Shine: '+({Ground:'ground',Slope:'slope cover',Rock:'rock',Sand:'sand',Crystal:'crystal'})[lobe[1]]);
 if(['shineWhite','shineHeadroom'].includes(key))return shiny?'':'Set a Gloss above zero in one of the Shine groups to use this setting.';
 if(key==='shineStretch')return rough?'':'Set a Roughness above zero in one of the Shine groups to use this setting.';
 if(['shineGate','shineOutside','shineSlopeGate'].includes(key))return shiny||rough?'':'Set a Gloss or Roughness above zero in one of the Shine groups to use this setting.';
 // A world with a beach keeps the Sand brush for its bars, so the sand these rows draw comes only from the weathering's supply.
 if(key==='sandLight'&&n('debrisAmount')>0)return '';
 if(['wind','ripple','rippleHeight','sandDust','sandGrain','sandGrass','sandLight'].includes(key)&&n('beachLayer')>0)return needs('sand','Weathering supply in Sand');
 // Water wets the ground only where the Time pass has rain; the worlds that run it with rain off have no wetness map to read.
 if(key==='wetSwath'&&n('erosionRain')<=0)return 'With no rain no ground is wet, so Moisture has nothing to move. Raise Rain to use this setting.';
 if(key==='slopeTexture'&&cover)return 'The ground cover decides the slope cover while Vegetation cover is above 0.';
 if(key==='slopeTexture'&&n('slopeSand')>0)return 'The slopes of this world are sand, which has no texture to scale.';
 // The sediment transition is built from the ground and replaces the slope cover's color outright at 100 percent Material weathering (worldPanelValues passes slopeReplaced); the texture then scales only the slope's share of the shine.
 // (A slope gloss counts here even while the texture is 0: raising the texture gives the slope its share.)
 if(key==='slopeTexture'&&n('slopeReplaced')>0&&!shiny&&!rough&&n('shineSlope')<=0&&n('shineSlopeRough')<=0)return 'The sediment transition replaces the slope color at 100 percent Material weathering, so this scales only the slope\'s gloss. Lower Material weathering, or set a Gloss or Roughness above zero in one of the Shine groups, to use this setting.';
 // The palette's ordered dither runs only when colors are not mixed in pairs.
 if(['dither','landDither'].includes(key)&&n('paletteMix')>0)return 'Choose Nearest color in the Palette to use this setting.';
 // The water: the hard step is the only place the step's rows draw; the ramp's rows draw only where the step is off.
 if(['waterSoft','bandWater'].includes(key))return Number(v.waterTones)===3?'':n('rampWater')>0?'':RAMP_IDLE;
 if(['stepSoftPx','shelfWander','shoalRag'].includes(key))return needs('deepEdge',HARD_STEP);
 // The waterline's stairs and blur are drawn only by a crisp waterline, and a blur replaces the stairs (engine-frag.wgsl, the shore's crisp cut).
 if(key==='shoalShoreSoft')return needs('crispShore','Crisp waterline');
 if(key==='shoalStairs')return needs('crispShore','Crisp waterline')||(n('shoalShoreSoft')>0?'Waterline blur replaces the stairs. Set it to 0 to use this setting.':'');
 if(/^ring[A-Z]/.test(key)&&n('ringLayer')<=0)return 'This world draws no mineral fringe.';
 if(key==='beachWidth'&&n('beachLayer')<=0)return 'This world has no beach of its own. Choose another world\'s Beach in Colors & base pattern to use this setting.';
 if(key==='groundTiles'&&n('groundTiled')<=0)return 'This world\'s ground is one texture, not tiles. Choose another world\'s Ground pattern to use this setting.';
 if(key==='ringShiftDir'||key==='ringScatter')return needs('ringShift','Offset between copies');
 if(key==='ringPatchSize')return needs('ringPatch','Reach variation');
 return '';
}

// Primary controls describe a visible feature. Fine tuning remains available
// explicitly (and through search), without filling the default inspector.
export const WORLD_PRIMARY_CONTROLS=new Set([
 'faceWhole','faceWholeLarge','faceRegular','sandLee','faceJointWidth','faceSecondary','faceContinuity','faceDetailPatch','faceFresh','faceRind','faceRindDepth','faceRindTone','faceRindWarmth','faceRindRough','faceBreak','faceBedVary','bedCycleVary','faceJointTilt','faceScaleVary','faceFold','faceSpall','faceClast','faceClastSize','faceMineral',
 'runoff','runoffScale','runoffConcentration','runoffCut','runoffStain','debrisAmount','debrisReach','debrisDepth','stoneSort','stoneRound','stoneSlab',
 'vegetationCover','plantRelief','flowerDensity',
 'bedDip','bedDipDir','faceStretch','faceBlockHeight','faceRound','faceJoint','faceExtrude','faceLamina','faceLaminaSize','faceScratchLength','faceScratchAngle','faceGritSize',
 'rockFace','faceRock','rockFaceFrom','rimReach','faceCreaseSize','faceCrease','faceBlock','faceBlockSize','faceBed','faceLedge','faceRun','faceScratch','faceScratchSize','faceLean','faceGrit','faceGrass','faceWear','faceShade','faceLayers','faceMass','faceTone','faceStrata','faceWet',
 'groundTiles','groundContrast','groundPatch','groundPatchSize','undulation','undulationScale','undulationCover','undulationArt','coastRamp','faceSteep','lowTint','lowReach','lowGrain',
 'reliefScale','reliefAmount','reliefLumps','gentleRelief','plainRelief','lumpRelief',
 'flatShadow','flatOcclusion','sunTilt','sunHeight','ambient','shadeDepth','lightCap','creaseShade',
 'hillLight','faceFill','rockCrown','sandCrown','slopeTexture','moss','erosionRain','wetSwath','wetGround','lushness','soilRim','slopeMarks','wrinkles',
 'shineRockSharp','shineRockRough','shineRockScale',
 'shineGround','shineSlope','shineRock','shineSand','shineCrystal',
 'looseSupply','looseSize','boulders','looseKnoll','sand','sandGrain','sandLight','ripple','rippleHeight','wind',
 'crackSeverity','crackSpacing',
 'banding','sandBanding','strata','strataContrast',
 'beachWidth','apron','shallowDepth','deepDepth','crispShore','deepEdge','bedTint','bedBright','bedContrast','bedRelief','shoreEdge',
 'baseBand','desertCapFlat',
 'shelfWander','bedFlat',
 'ringContrast','ringCount','ringSize','ringShift','ringTone',
 'lavaCrust','lavaPillow','lavaVeins','layerCrease','pockmark',
 'moonCups','moonRibs','moonFolds','iceCrystal','gougeWeb','iceCrest','iceSoft','iceSnow','iceFall','iceApron','iceFrost','frostGaps'
]);
