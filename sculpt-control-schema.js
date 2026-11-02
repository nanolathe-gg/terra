import {isShouldered} from './sculpt-shape-presets.js';
// Presentation names and applicability belong to features, never to worlds.
// Historical persistence keys are compatibility identifiers for existing v4-v6
// recipes, not world-gated algorithms. All presentation uses feature names.
// Experiment 4 left this off: it darkens broad faces instead of making useful
// crevices. Preserve recipes, but require fresh visual evidence before exposure.
export const PARKED_WORLD_CONTROLS=new Set(['crevice']);
export const WORLD_GROUP_NAMES={
 'Light':'Lighting','Faces':'Material coverage','Desert foot band':'Foot color band','Desert caps':'Cap color',
 'Shallow water, round 2':'Water detail','Shallow water, round 3':'Water detail',
 'Fringe lines (Archipelago)':'Contour fringe','Fringe copies (Archipelago)':'Contour fringe',
 'Lava hill rock':'Pillow crust','Lava banks':'Terrace creases','Pockmarks (Moon)':'Surface pits',
 'Moon surface':'Cups, ribs & folds','Ice mountains':'Mineral faces','Ice blocks and mesas':'Cap & face finish',
 'Ice frost lines':'Needle lines','Ice frost band':'Shore pockets',
 'Rock face: follows the slope':'Structure orientation','Rock face: gullies and ribs':'Gullies & ribs','Rock face: facets':'Microfacets'
};
export const WORLD_CHOICES={stepSharp:[[0,'Smooth transition'],[1,'Depth threshold']],cliffFollow:[[0,'Fixed directions'],[1,'Follow terrain']],paletteMix:[[0,'Nearest color'],[1,'Mix color pairs']]};
const LABELS={sand:'Deposit supply',wind:'Ripple direction (degrees)',sandGrass:'Vegetation through sand',hillLight:'Slope-cover brightness',ringFade:'Fringe fade length',slopeMarks:'Dark slope marks',wrinkles:'Joined slope wrinkles',
 desertCapFlat:'Uniform cap color',rockMoss:'Vegetation tint in rock',shoreEdge:'Waterline rim and lip',
 stepSharp:'Threshold depth transition',bedDots:'Bed speckles',crackedStep:'Cracked-bed transition depth',shoalGrain:'Grain through water tint',shoalShoreSoft:'Waterline blur (px)',
 lavaCrust:'Pillow crust strength',lavaCalm:'Replace fine relief with crust',lavaDusk:'Shade away from light',
 moonCups:'Slope cups',moonRibs:'Slope ribs',moonFolds:'Contour folds',
 iceSlate:'Slate faces',iceCrystal:'Straight face fibres',iceCrest:'Cap lumps',iceSoft:'Rounded lighting',iceSnow:'Snow on level caps',iceFall:'Slope fibres',iceApron:'Hatched foot apron',iceFrost:'Needle hairlines',
 crystalForm:'Form',crystalSize:'Element width (px)',crystalCount:'Elements per cluster',crystalSides:'Polygon sides',crystalTop:'Flat top share',crystalLean:'Apex lean',
 crystalTiers:'Stepped column tops',crystalAlign:'Align blocks to shape',bergFace:'Face steepness',bergJitter:'Outline jitter',bergBreak:'Corner cuts',bergRough:'Face roughness',bergTilt:'Top tilt',bergFlat:'Level top share',bergTiltDir:'Tilt direction (degrees)',
 craterFacets:'Bowl facets',crystalCraterPx:'Facet width (px)',crystalCraterStep:'Facet step height',crystalCraterSkin:'Fine seam shading',crystalShoreSeam:'Slab seam weight',plateVary:'Slab variety',
 iceFacets:'Angular facets',iceFacetSize:'Facet width (px)',moonLobes:'Outline lobes',lavaMeander:'Layer meander',lavaSpread:'Layer width spread',lavaCircleVary:'Circular bite variation',
 fissureNetwork:'Cut layout',plateMaterial:'Shore structure',fingers:'Shore lobes',fingerAmount:'Lobe coverage',fingerSize:'Lobe size',fingerSpread:'Lobe clustering',fingerHeight:'Lobe height',
 styleErosion:'Local relaxation',styleDeposits:'Local deposits',styleVegetation:'Local vegetation',styleExposure:'Local rock exposure',
};
export function controlLabel(key,label){return LABELS[key]||label.replace(/ \((?:Archipelago|Moon|Lava|Red|Green|Ice|Crystal)(?:[^)]*)\)/g,'').replace(/\bice\b/gi,'surface');}
export function shapeControlAvailable(key,kind,p){
 const form=Math.round(p.crystalForm||0),plates=p.shorePlates>0,slab=p.plateMaterial<2,ridge=Math.round(p.spurCount)>=1||p.crestJag>0||p.crestVary>0||p.crestTaper>0;
 const sharedFace=['plateau','offset','erase','paint','sand','grass'].includes(kind)&&!(p.facePx>0),shoulderedHill=isShouldered(kind,p,ridge);
 // The classic shouldered ridge uses a different footprint; its settled path
 // bypasses these foot effects. Custom/variable ridges use the shared profile.
 if(shoulderedHill&&['baseVary','baseBump','faceVariation'].includes(key))return false;
 // The face wanders on a share face (its shoulder) or a px one; softness reads the shoulder, a hill's widths, and the forms that follow it.
 if(key==='faceVariation')return sharedFace||p.facePx>0;
 if(key==='softness')return sharedFace||shoulderedHill||(!p.curve?.knots&&['mountain','cliff'].includes(p.curve?.form||(kind==='mountain'?'mountain':'')));
 if(key==='moonLobes'&&p.baseVary>0)return false;
 // p.world is what worldControlRequirement reads. A face share needs faces of rock and moss; deposits need sand or stones that a world can lay down, and a beach keeps the Sand brush for its bars.
 const world=p.world||{};
 if(key==='styleFace'&&Number(world.microRock??1)<=0)return false;
 if(key==='styleDeposits'&&world.beachLayer>0&&!(Number(world.sand)>0)&&!(Number(world.stoneDensity)>0))return false;
 // A hill leans on its own, and a plateau or offset too until a Face width takes that away; the other kinds lean only once Lean is above 0, so a side to lean toward means nothing before.
 if(key==='facing')return kind==='hill'||['plateau','offset'].includes(kind)&&!(p.facePx>0)||p.lean>0;
 if(kind==='crystal'){
  if(['crystalTiers','crystalStep','crystalFacet','crystalSizeVar','crystalSmooth'].includes(key))return form===1;
  if(['crystalCount','crystalSides','crystalVariation'].includes(key))return form!==1;
  if(['crystalTop','crystalLean'].includes(key))return form===0;
  if(['crystalAlign','bergFace','bergJitter','bergBreak','bergRough','bergTilt','bergFlat','bergTiltDir'].includes(key))return form===2&&(!['bergFlat','bergTiltDir'].includes(key)||p.bergTilt>0);
 }
 if(['plateWaterPx','plateLandPx','plateSize','plateGap','plateHeight','plateMaterial','frostNeedles','crystalShoreSeam','plateVary'].includes(key))return plates&&(key==='frostNeedles'?!slab:key==='crystalShoreSeam'||key==='plateVary'?slab:true);
 if(['crystalCraterPx','crystalCraterStep','crystalCraterSkin'].includes(key))return p.craterFacets>0;
 if(key==='iceFacetSize')return kind==='mountain'&&p.iceFacets>0;
 if(['ledge','terraceJitter'].includes(key))return p.terraces>0;
 if(['lavaMeander','lavaSpread'].includes(key))return p.shoreLayers>0&&p.layerStyle<.5;
 if(['layerCircle','lavaCircleVary'].includes(key))return p.shoreLayers>0&&p.layerStyle>=.5;
 return true;
}

// The two water switches a deep or shallow stroke can also turn on for its own footprint (worldPanelValues passes that in).
const HARD_STEP='Hard shallow-to-deep step, or a water stroke\'s Hard edge',LIT_BED='Lit bed under shallow water, or a water stroke\'s Lit bed';
// Dependencies describe pipeline features, never the active world. Search still
// finds an inactive setting and explains what must be enabled to use it.
export function worldControlRequirement(key,v){
 const n=k=>Number(v[k]??0),needs=(parent,label)=>worldControlRequirement(parent,v)||(n(parent)<=0?`Enable ${label} to use this setting.`:'');   // a parent that is itself idle names its own reason first
 if(['undulationScale','undulationCover'].includes(key))return needs('undulation','Undulation height');
 if((['bedHeight','bedVary','bedPunch'].includes(key)||key==='bedSpacing'&&n('cliffRise')<=0)&&n('column')>0)return 'The authored bed profile supplies this value. Random bed controls do not apply.';   // with a Riser height a column's ledge scales by bed thickness over this spacing
 if(['strata','strataContrast','strataGrain'].includes(key)&&n('column')<=0)return 'This world has no rock column.';
 if(key==='bedDipDir')return worldControlRequirement('bedDip',v)||(n('bedDip')===0?'Set Bed tilt above or below zero to choose its direction.':'');
 if(['bedSpacing','bedHeight','bedVary','bedDip','bedDipDir','bedLedge','jointDepth','grooveSpacing','grooveAngle','grooveRun','bedPunch','gullyDepth','gullyWidth','gullyShade','ribTilt','facetTilt','facetSize','facetStretch','facetStep','facetSeam','facetCoarse'].includes(key)&&n('rockOrder')<=0)return 'Enable ordered Rock structure to use this setting.';
 // The lines' places are cut by joints and gullies, and the ribs between gullies stand on the same lines; their length matters only to a cut.
 if(['grooveSpacing','grooveAngle'].includes(key))return n('jointDepth')>0||n('gullyDepth')>0||n('ribTilt')>0?'':'Set Joint depth, Gully depth or Rib tilt above zero to use this setting.';
 if(key==='grooveRun')return n('jointDepth')>0||n('gullyDepth')>0?'':'Set Joint depth or Gully depth above zero to use this setting.';
 if(key==='cliffStagger')return n('rockOrder')<=0?'Enable ordered Rock structure to use this setting.':n('cliffFollow')<=0?'Choose Follow terrain in Structure orientation to use this setting.':needs('jointDepth','Joint depth');
 if(key==='sandBandSpacing')return needs('sandBanding','Streaks on sand and ramps');
 if(key==='bedDotCell')return needs('bedDots','Bed speckles');
 if(key==='pockSize')return needs('pockmark','Surface pits');
 if(/^moonCup/.test(key)&&key!=='moonCups')return needs('moonCups','Slope cups');
 if(/^moonRib/.test(key)&&key!=='moonRibs')return needs('moonRibs','Slope ribs');
 if(key==='moonFoldSpacing')return needs('moonFolds','Contour folds');
 if(['lavaPillow','lavaChip','lavaVeins','lavaCalm'].includes(key))return needs('lavaCrust','Pillow crust strength');
 if(['frostGapReach','frostGapSize','frostGapDepth'].includes(key))return needs('frostGaps','Shore pockets');
 if(['gullyWidth','gullyShade'].includes(key))return needs('gullyDepth','Gully depth');
 // Beds and joints draw only in ordered rock, and the bed profile only where a ledge or lip gives it relief.
 if(['rockFrom','cliffFollow','cliffReach','cliffWide','cliffFlat','cliffRise','cliffBed','cliffStagger','cliffFine','cliffDomain'].includes(key)&&n('rockOrder')<=0)return 'Enable ordered Rock structure to use this setting.';
 if(['cliffReach','cliffWide','cliffFlat','cliffBed','cliffFine','cliffDomain'].includes(key)&&n('cliffFollow')<=0)return 'Choose Follow terrain in Structure orientation to use this setting.';
 if(['facetSize','facetStretch','facetStep','facetSeam','facetCoarse','cliffFine'].includes(key))return needs('facetTilt','Facet tilt');
 // A joint's stagger is keyed on its bed and blocks read the bed height, so the beds' shape outlives their relief there.
 const bedsMoveJoints=n('jointDepth')>0&&n('cliffFollow')>0&&n('cliffStagger')>0&&['bedSpacing','bedHeight','bedVary','bedDip','cliffBed'].includes(key),bedsMoveBlocks=n('blocks')>0&&key==='cliffBed';
 if(['bedSpacing','bedHeight','bedVary','bedDip','bedPunch','cliffRise','cliffBed'].includes(key)&&n('bedLedge')<=0&&!bedsMoveJoints&&!bedsMoveBlocks)return 'Set Ledge above zero in Rock structure to give the beds relief.';
 // Colour beds and the bands on them need the strata switch, and the band and cap rows a rock column to bed.
 if(['strataContrast','strataGrain'].includes(key))return needs('strata','Strength (painted beds) in Strata');
 if(['baseBand','desertCapFlat'].includes(key))return n('column')<=0?'This world has no rock column.':needs('strata','Strength (painted beds) in Strata');
 if(['baseBandLow','baseBandHigh','baseBandWander','baseBandGaps'].includes(key))return needs('baseBand','Gray band strength');
 // Shine: a lobe needs its material's gloss, a grain its roughness; the shared rows need some material shining.
 const shine=['Ground','Slope','Rock','Sand','Crystal'],shiny=shine.some(m=>n('shine'+m)>0),rough=shine.some(m=>n('shine'+m+'Rough')>0);
 const lobe=/^shine(Ground|Slope|Rock|Sand|Crystal)(Sharp|Scale)$/.exec(key);
 if(lobe)return needs('shine'+lobe[1]+(lobe[2]==='Sharp'?'':'Rough'),(lobe[2]==='Sharp'?'Gloss':'Roughness')+' in Shine: '+({Ground:'ground',Slope:'slope cover',Rock:'rock',Sand:'sand',Crystal:'crystal'})[lobe[1]]);
 if(['shineWhite','shineHeadroom'].includes(key))return shiny?'':'Set a Gloss above zero in one of the Shine groups to use this setting.';
 if(key==='shineStretch')return rough?'':'Set a Roughness above zero in one of the Shine groups to use this setting.';
 if(['shineGate','shineOutside','shineSlopeGate'].includes(key))return shiny||rough?'':'Set a Gloss or Roughness above zero in one of the Shine groups to use this setting.';
 if(['faceEdge','gullyRock','iceSlate'].includes(key)&&Number(v.microRock??1)<=0)return 'This world\'s faces are one material, not rock and moss interleaved, so there is nothing for this setting to place.';
 // A world with a beach keeps the Sand brush for its bars, so the sand these rows draw comes only from the weathering's supply.
 if(['wind','ripple','rippleHeight','sandDust','sandGrain','sandGrass','sandLight'].includes(key)&&n('beachLayer')>0)return needs('sand','Weathering supply in Sand');
 if(key==='crackedStep')return needs('stepSharp','Step is a true threshold');
 if(key==='crackedContrast')return needs('bedLit',LIT_BED);
 if(key==='slopeTexture'&&n('slopeSand')>0)return 'The slopes of this world are sand, which has no texture to scale.';
 // The palette's ordered dither runs only when colors are not mixed in pairs.
 if(['dither','landDither','shoalDither'].includes(key)&&n('paletteMix')>0)return 'Choose Nearest color in the Palette to use this setting.';
 if(key==='shoalDither')return needs('deepEdge',HARD_STEP);
 if(key==='lavaCreaseVary')return needs('layerCrease','Dark crease at each step foot');
 // The water: the lit bed is the only place the bed's rows draw, the hard step the only place the step's rows do.
 if(['bedTint','bedBright','bedContrast','bedFlat','bedDots','shoalGrain'].includes(key))return needs('bedLit',LIT_BED);
 if(['stepSharp','deepEdgeDepth'].includes(key))return needs('deepEdge',HARD_STEP);
 if(['stepSoftPx','shelfWander','shoalRag'].includes(key))return needs('stepSharp','Step is a true threshold');
 if(key==='shelfScale')return needs('shelfWander','Shelf wander');
 if(key==='shoalBump')return needs('bedLit',LIT_BED)||needs('deepEdge',HARD_STEP);
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
 'groundTiles','groundContrast','undulation','undulationScale','undulationCover',
 'reliefScale','reliefAmount','reliefLumps','gentleRelief','plainRelief','lumpRelief',
 'flatShadow','flatOcclusion','sunTilt','ambient','shadeDepth','lightCap',
 'hillLight','faceFill','rockCrown','sandCrown','slopeTexture','moss','slopeMarks','wrinkles',
 'shineGround','shineSlope','shineRock','shineSand','shineCrystal',
 'boulders','boulderSize','debris','sand','sandGrain','sandLight','ripple','rippleHeight','wind',
 'crackSeverity','crackSpacing','crackLength','crackStyle','rockOrder','rockFrom','bedSpacing','bedLedge','jointDepth',
 'banding','sandBanding','strata','strataContrast',
 'beachWidth','apron','shallowDepth','deepDepth','crispShore','deepEdge','deepEdgeDepth','bedLit','bedTint','bedBright','bedContrast','bedRelief','shoreEdge',
 'baseBand','desertCapFlat','rockMoss','rockDetail','faceRelief','gullyDepth','grooveSpacing','facetTilt','facetSize','cliffFollow',
 'stepSharp','shelfWander','bedFlat','bedDots','crackedStep','crackedContrast','shoalBump','shoalGrain',
 'ringContrast','ringCount','ringSize','ringShift','ringTone',
 'lavaCrust','lavaPillow','lavaVeins','layerCrease','pockmark',
 'moonCups','moonRibs','moonFolds','iceSlate','mineralDetail','iceCrystal','iceCrest','iceSoft','iceSnow','iceFall','iceApron','iceFrost','frostGaps'
]);
