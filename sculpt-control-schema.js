import {isShouldered} from './sculpt-shape-presets.js';
// Presentation names and applicability belong to features, never to worlds.
// Historical persistence keys are compatibility identifiers for existing v4-v6
// recipes, not world-gated algorithms. All presentation uses feature names.
export const RETIRED_WORLD_CONTROLS=new Set(['sandReach','windStrength','sandPatchy','sandTail']);
// Experiment 4 left this off: it darkens broad faces instead of making useful
// crevices. Preserve recipes, but require fresh visual evidence before exposure.
export const PARKED_WORLD_CONTROLS=new Set(['crevice']);
export const WORLD_GROUP_NAMES={
 'Light':'Lighting','Faces':'Material coverage','Desert foot band':'Foot colour band','Desert caps':'Cap colour',
 'Shallow water, round 2':'Water detail','Shallow water, round 3':'Water detail',
 'Fringe lines (Archipelago)':'Contour fringe','Fringe copies (Archipelago)':'Contour fringe',
 'Lava hill rock':'Pillow crust','Lava banks':'Terrace creases','Pockmarks (Moon)':'Surface pits',
 'Moon surface':'Cups, ribs & folds','Ice mountains':'Mineral faces','Ice blocks and mesas':'Cap & face finish',
 'Ice frost lines':'Needle lines','Ice frost band':'Shore pockets',
 'Rock face: follows the slope':'Structure orientation','Rock face: gullies and ribs':'Gullies & ribs','Rock face: scratches':'Scratches','Rock face: facets':'Microfacets'
};
export const WORLD_CHOICES={bandStyle:[[0,'Tonal steps'],[1,'Bank lines']],stepSharp:[[0,'Smooth transition'],[1,'Depth threshold']],cliffFollow:[[0,'Fixed directions'],[1,'Follow terrain']],paletteMix:[[0,'Nearest colour'],[1,'Mix colour pairs']]};
const LABELS={sand:'Deposit supply',wind:'Ripple direction (degrees)',sandGrass:'Vegetation through sand',hillLight:'Slope-cover brightness',ringFade:'Fringe fade length',slopeMarks:'Dark slope marks',wrinkles:'Joined slope wrinkles',
 desertCapFlat:'Uniform cap colour',rockMoss:'Vegetation tint in rock',shoreEdge:'Waterline rim and lip',
 stepSharp:'Threshold depth transition',bedDots:'Bed speckles',crackedStep:'Cracked-bed transition depth',shoalGrain:'Grain through water tint',shoalShoreSoft:'Waterline blur (px)',
 lavaCrust:'Pillow crust strength',lavaCalm:'Replace fine relief with crust',lavaDusk:'Shade away from light',
 moonCups:'Slope cups',moonRibs:'Slope ribs',moonFolds:'Contour folds',
 iceSlate:'Slate faces',iceCrystal:'Straight face fibres',iceCrest:'Cap lumps',iceSoft:'Rounded lighting',iceSnow:'Snow on level caps',iceFall:'Slope fibres',iceApron:'Hatched foot apron',iceFrost:'Needle hairlines',
 crystalForm:'Form',crystalSize:'Element width (px)',crystalCount:'Elements per cluster',crystalSides:'Polygon sides',crystalTop:'Flat top share',crystalLean:'Apex lean',
 crystalTiers:'Stepped column tops',crystalAlign:'Align blocks to shape',bergFace:'Face steepness',bergJitter:'Outline jitter',bergBreak:'Corner cuts',bergRough:'Face roughness',bergTilt:'Top tilt',bergFlat:'Level top share',bergTiltDir:'Tilt direction (degrees)',
 craterFacets:'Bowl facets',crystalCraterPx:'Facet width (px)',crystalCraterStep:'Facet step height',crystalCraterSkin:'Fine seam shading',crystalShoreScale:'Slab size multiplier',crystalShoreSeam:'Slab seam weight',
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
 if(kind==='crystal'){
  if(['crystalTiers','crystalStep','crystalFacet','crystalSizeVar','crystalSmooth'].includes(key))return form===1;
  if(['crystalCount','crystalSides','crystalVariation'].includes(key))return form!==1;
  if(['crystalTop','crystalLean'].includes(key))return form===0;
  if(['crystalAlign','bergFace','bergJitter','bergBreak','bergRough','bergTilt','bergFlat','bergTiltDir'].includes(key))return form===2&&(!['bergFlat','bergTiltDir'].includes(key)||p.bergTilt>0);
 }
 if(['plateWaterPx','plateLandPx','plateSize','plateGap','plateHeight','plateMaterial','frostNeedles','crystalShoreScale','crystalShoreSeam'].includes(key))return plates&&(key==='frostNeedles'?!slab:key.startsWith('crystalShore')?slab:true);
 if(['crystalCraterPx','crystalCraterStep','crystalCraterSkin'].includes(key))return p.craterFacets>0;
 if(key==='iceFacetSize')return kind==='mountain'&&p.iceFacets>0;
 if(['ledge','terraceJitter'].includes(key))return p.terraces>0;
 if(['lavaMeander','lavaSpread'].includes(key))return p.shoreLayers>0&&p.layerStyle<.5;
 if(['layerCircle','lavaCircleVary'].includes(key))return p.shoreLayers>0&&p.layerStyle>=.5;
 return true;
}

// Dependencies describe pipeline features, never the active world. Search still
// finds an inactive setting and explains what must be enabled to use it.
export function worldControlRequirement(key,v){
 const n=k=>Number(v[k]??0),needs=(parent,label)=>n(parent)<=0?`Enable ${label} to use this setting.`:'';
 if(['undulationScale','undulationCover'].includes(key))return needs('undulation','Undulation height');
 if(['bedHeight','bedVary','bedPunch','bedFlow'].includes(key)&&n('column')>0)return 'The authored bed profile supplies this value. Random bed controls do not apply.';
 if(['strata','strataContrast','strataGrain'].includes(key)&&n('column')<=0)return 'This world has no rock column.';
 if(key==='bedDipDir'&&n('bedDip')===0)return 'Set Bed tilt above or below zero to choose its direction.';
 if(['bedSpacing','bedHeight','bedVary','bedDip','bedDipDir','bedLedge','bedLip','jointSpacing','jointAngle','jointDepth','jointRun','jointGaps','bedFlow','bedBend','bedPunch','gullyDepth','gullySpacing','gullyWidth','gullyAngle','gullyRun','gullyGaps','gullyShade','ribTilt','scratchDepth','scratchSpacing','scratchAngle','scratchRun','scratchGaps','facetTilt','facetSize','facetStretch','facetStep','facetSeam','facetSkew','facetCoarse'].includes(key)&&n('rockOrder')<=0)return 'Enable ordered Rock structure to use this setting.';
 if(['bandWidth','bandRelief','bandWander','bandGaps'].includes(key)&&n('bandStyle')<.5)return 'Choose Bank lines in Contour bands to use this setting.';
 if(key==='sandBandSpacing')return needs('sandBanding','Streaks on sand and ramps');
 if(key==='bedMottleScale')return needs('bedMottle','Bed mottle');
 if(key==='bedDotCell')return needs('bedDots','Bed speckles');
 if(key==='pockSize')return needs('pockmark','Surface pits');
 if(/^moonCup/.test(key)&&key!=='moonCups')return needs('moonCups','Slope cups');
 if(/^moonRib/.test(key)&&key!=='moonRibs')return needs('moonRibs','Slope ribs');
 if(key==='moonFoldSpacing')return needs('moonFolds','Contour folds');
 if(['lavaPillow','lavaChip','lavaVeins','lavaCalm','lavaDusk'].includes(key))return needs('lavaCrust','Pillow crust strength');
 if(['frostGapReach','frostGapSize','frostGapDepth'].includes(key))return needs('frostGaps','Shore pockets');
 if(['scratchSpacing','scratchAngle','scratchRun','scratchGaps'].includes(key))return needs('scratchDepth','Scratch depth');
 if(['gullySpacing','gullyWidth','gullyAngle','gullyRun','gullyGaps','gullyShade'].includes(key))return needs('gullyDepth','Gully depth');
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
 'banding','bandStyle','sandBanding','strata','strataContrast',
 'beachWidth','apron','shallowDepth','deepDepth','crispShore','deepEdge','deepEdgeDepth','bedLit','bedTint','bedBright','bedContrast','bedRelief','shoreEdge',
 'baseBand','desertCapFlat','rockMoss','rockDetail','gullyDepth','gullySpacing','scratchDepth','facetTilt','facetSize','cliffFollow',
 'stepSharp','shelfWander','bedFlat','bedMottle','bedDots','crackedStep','crackedContrast','shoalBump','shoalGrain',
 'ringContrast','ringCount','ringSize','ringShift','ringTone',
 'lavaCrust','lavaPillow','lavaVeins','layerCrease','pockmark',
 'moonCups','moonRibs','moonFolds','iceSlate','mineralDetail','iceCrystal','iceCrest','iceSoft','iceSnow','iceFall','iceApron','iceFrost','frostGaps'
]);
