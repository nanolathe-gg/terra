import test from 'node:test';
import assert from 'node:assert/strict';
import {shapeControlAvailable as available,controlLabel,PARKED_WORLD_CONTROLS} from '../sculpt-control-schema.js';
import {prepareNode} from '../sculpt-gpu-fields.js';

test('a hill exposes foot effects only as a ridge',()=>{
 assert.equal(available('baseVary','hill',{}),false);
 assert.equal(available('baseBump','hill',{crestJag:.2}),true);
 assert.equal(available('baseVary','hill',{spurCount:3}),true);
 assert.equal(available('moonLobes','mountain',{baseVary:15}),false);
 assert.equal(available('iceFacetSize','hill',{iceFacets:1}),false);
 assert.equal(available('iceFacetSize','mountain',{iceFacets:1}),true);
});
test('faceted forms and shoreline materials keep their own dependent controls',()=>{
 assert.equal(available('crystalTiers','crystal',{crystalForm:0}),false);
 assert.equal(available('crystalTiers','crystal',{crystalForm:1}),true);
 assert.equal(available('crystalCount','crystal',{crystalForm:1}),false);
 assert.equal(available('bergTiltDir','crystal',{crystalForm:2,bergTilt:0}),false);
 assert.equal(available('bergTiltDir','crystal',{crystalForm:2,bergTilt:.2}),true);
 assert.equal(available('frostNeedles','deep',{shorePlates:1,plateMaterial:1}),false);
 assert.equal(available('frostNeedles','deep',{shorePlates:1,plateMaterial:2}),true);
 assert.equal(available('crystalShoreSeam','deep',{shorePlates:1,plateMaterial:2}),false);
});
test('erase all masks includes all eight local style planes',()=>{
 const context={seed:1,baseHeight:99,sea:75,params:n=>new Proxy(n.params,{get:(q,k)=>q[k]??0})};
 const prepared=prepareNode({kind:'paint',seed:1,points:[{x:40,y:40}],params:{radius:20,amount:100,paintChannel:7,softness:.5}}, {grid:256,spacing:1},context);
 const writes=prepared.writes;
 assert.ok(writes,'paint preparation exposes mask writes');
 assert.deepEqual(writes.map(w=>w[0]),Array.from({length:18},(_,i)=>i));
 assert.ok(writes.every(w=>w[1]===0));
});
test('the parked control is only crevice',()=>{
 assert.deepEqual([...PARKED_WORLD_CONTROLS],['crevice']);
 assert.equal(controlLabel('moonCups','Moon cups'),'Slope cups');
 assert.equal(controlLabel('iceSoft','Ice lighting'),'Rounded lighting');
});

test('world dependencies explain bypasses without biome gates',async()=>{
 const {worldControlRequirement:requirement}=await import('../sculpt-control-schema.js');
 assert.match(requirement('bedVary',{column:1,rockOrder:1}),/authored bed profile/);
 assert.equal(requirement('bedVary',{column:0,rockOrder:1,bedLedge:.5}),'');
 assert.match(requirement('undulationCover',{undulation:0}),/Undulation height/);
 assert.equal(requirement('undulationCover',{undulation:8}),'');
 assert.match(requirement('grooveSpacing',{rockOrder:0,gullyDepth:1}),/Rock structure/);
 assert.match(requirement('grooveRun',{rockOrder:1,jointDepth:0,gullyDepth:0}),/Joint depth or Gully depth/);
 assert.equal(requirement('grooveRun',{rockOrder:1,jointDepth:2}),'');
 assert.equal(requirement('grooveRun',{rockOrder:1,jointDepth:0,gullyDepth:4}),'');   // Green cuts gullies and no joints
 assert.match(requirement('grooveSpacing',{rockOrder:1,jointDepth:0,gullyDepth:0,ribTilt:0}),/Joint depth, Gully depth or Rib tilt/);
 assert.equal(requirement('grooveSpacing',{rockOrder:1,jointDepth:0,gullyDepth:0,ribTilt:.2}),'');   // ribs stand between the lines
 assert.match(requirement('grooveRun',{rockOrder:1,jointDepth:0,gullyDepth:0,ribTilt:.2}),/Joint depth or Gully depth/);   // a rib cuts nothing
 assert.match(requirement('cliffStagger',{rockOrder:1,cliffFollow:0,jointDepth:2}),/Follow terrain/);
 assert.match(requirement('cliffStagger',{rockOrder:1,cliffFollow:1,jointDepth:0}),/Joint depth/);
 assert.equal(requirement('cliffStagger',{rockOrder:1,cliffFollow:1,jointDepth:2}),'');
 assert.equal(requirement('boulderSize',{boulders:0}),'','painted scatter still uses size when global density is zero');
 assert.equal(requirement('bandSoftness',{banding:0}),'','painted banding still uses the riser share when the world strength is zero');
});

test('H22b: rows that act only once another is on say so, and come back when it is',async()=>{
 const {worldControlRequirement:requirement}=await import('../sculpt-control-schema.js');
 const shows=(key,on)=>assert.equal(requirement(key,on),'',key);
 // shine: a lobe needs its material's gloss, a grain its roughness, the shared rows any shining material
 assert.match(requirement('shineRockSharp',{shineRock:0}),/Gloss in Shine: rock/);
 shows('shineRockSharp',{shineRock:.5});
 assert.match(requirement('shineSandScale',{shineSandRough:0,shineSand:1}),/Roughness in Shine: sand/);
 shows('shineSandScale',{shineSandRough:.3});
 assert.match(requirement('shineWhite',{shineRockRough:1}),/Gloss/);
 shows('shineWhite',{shineCrystal:.2});
 assert.match(requirement('shineStretch',{shineGround:1}),/Roughness/);
 shows('shineStretch',{shineSlopeRough:.2});
 assert.match(requirement('shineGate',{}),/Gloss or Roughness/);
 shows('shineGate',{shineSlopeRough:.2});
 shows('shineGate',{shineGround:.2});
 // ordered rock: the follow-the-slope family, the facets and the bed profile
 assert.match(requirement('rockFrom',{rockOrder:0}),/Rock structure/);
 shows('rockFrom',{rockOrder:1});
 assert.match(requirement('cliffReach',{rockOrder:1,cliffFollow:0}),/Follow terrain/);
 shows('cliffReach',{rockOrder:1,cliffFollow:1});
 assert.match(requirement('facetCoarse',{rockOrder:1,facetTilt:0}),/Facet tilt/);
 shows('facetCoarse',{rockOrder:1,facetTilt:.5});
 assert.match(requirement('cliffFine',{rockOrder:1,cliffFollow:1,facetTilt:0}),/Facet tilt/);
 assert.match(requirement('cliffRise',{rockOrder:1,bedLedge:0}),/Ledge above zero/);
 assert.match(requirement('bedSpacing',{rockOrder:1,bedLedge:0}),/Ledge above zero/);
 shows('bedSpacing',{rockOrder:1,jointDepth:2,cliffFollow:1,cliffStagger:.5});   // a joint's stagger is keyed on its bed
 assert.match(requirement('cliffRise',{rockOrder:1,jointDepth:2,cliffFollow:1,cliffStagger:.5}),/Ledge above zero/,'the rise is relief only');
 shows('cliffBed',{rockOrder:1,cliffFollow:1,blocks:.5});   // blocks read the bed height
 shows('bedSpacing',{rockOrder:1,bedLedge:.5});
 // strata: bands and caps need a column and the strata switch
 assert.match(requirement('baseBand',{column:0,strata:1}),/no rock column/);
 assert.match(requirement('baseBand',{column:1,strata:0}),/Strata/);
 shows('baseBand',{column:1,strata:.5});
 assert.match(requirement('desertCapFlat',{column:1,strata:.5,capBed:0}),/no cap bed/);   // Green's column has eight beds in one section, so its caps hold nothing
 shows('desertCapFlat',{column:1,strata:.5,capBed:1});
 assert.match(requirement('baseBandGaps',{column:1,strata:1,baseBand:0}),/Gray band/);
 shows('baseBandGaps',{column:1,strata:1,baseBand:.5});
 assert.match(requirement('baseBandGaps',{column:1,strata:0,baseBand:.5}),/Strata/);
 assert.match(requirement('bedSpacing',{column:1,rockOrder:1,bedLedge:1}),/authored bed profile/);
 shows('bedSpacing',{column:1,rockOrder:1,bedLedge:1,cliffRise:8});   // a column's ledge scales by thickness over spacing once it has a rise
 assert.equal(requirement('boulderFoot',{boulders:0}),'','painted scatter sources its stones by this at Density 0, as it reads boulderSize');
 assert.equal(requirement('lavaDusk',{lavaCrust:0}),'','the dusk darkens any rock turned from the sun, crust or none');
 assert.match(requirement('faceEdge',{microRock:0}),/one material/);
 shows('gullyRock',{microRock:.7});
 shows('iceSlate',{});   // the world table's default is interleaved
 assert.match(requirement('ripple',{beachLayer:1,sand:0}),/Weathering supply/);
 shows('ripple',{beachLayer:1,sand:.5});
 shows('ripple',{beachLayer:0,sand:0});   // the Sand brush feeds it where there is no beach
 assert.match(requirement('crackedStep',{stepSharp:0,deepEdge:1}),/true threshold/);
 assert.match(requirement('strataContrast',{column:1,strata:0}),/Strata/);
 shows('strataContrast',{column:1,strata:.4});
 // water: the lit bed, the hard step, the threshold step
 assert.match(requirement('bedDots',{bedLit:0}),/Lit bed/);
 shows('bedDots',{bedLit:.5});
 assert.match(requirement('stepSharp',{deepEdge:0}),/Hard shallow-to-deep step/);
 shows('stepSharp',{deepEdge:1});
 assert.match(requirement('shelfWander',{deepEdge:1,stepSharp:0}),/true threshold/);
 shows('shelfWander',{deepEdge:1,stepSharp:1});
 assert.match(requirement('shelfWander',{deepEdge:0,stepSharp:1}),/Hard shallow-to-deep step/,'a parent that is itself idle names its own reason');
 assert.match(requirement('shelfScale',{deepEdge:1,stepSharp:1,shelfWander:0}),/Shelf wander/);
 shows('shelfScale',{deepEdge:1,stepSharp:1,shelfWander:5});
 assert.match(requirement('shoalBump',{bedLit:1,deepEdge:0}),/Hard shallow-to-deep step/);
 assert.match(requirement('shoalBump',{bedLit:0,deepEdge:1}),/Lit bed/);
 shows('shoalBump',{bedLit:1,deepEdge:1});
 shows('shoalBumpPx',{bedLit:1,deepEdge:1,shoalBump:2});
 assert.match(requirement('lavaCreaseVary',{layerCrease:0}),/crease/);
 shows('lavaCreaseVary',{layerCrease:.5});
 // facts of the world's material the panel passes in with the settings
 assert.match(requirement('ringContrast',{ringLayer:0}),/no mineral fringe/);
 shows('ringContrast',{ringLayer:1});
 assert.match(requirement('ringShiftDir',{ringLayer:1,ringShift:0}),/Offset between copies/);
 assert.match(requirement('beachWidth',{beachLayer:0}),/no beach/);
 shows('beachWidth',{beachLayer:1});
 assert.match(requirement('groundTiles',{groundTiled:0}),/Ground pattern/);
 shows('groundTiles',{groundTiled:1});
 assert.equal(requirement('repose',{debris:0}),'','partial Denser scatter reads it at Amount 0');
 assert.match(requirement('slopeTexture',{slopeSand:1}),/sand/);
 shows('slopeTexture',{slopeSand:0});
 assert.match(requirement('dither',{paletteMix:1}),/Nearest color/);
 shows('dither',{paletteMix:0});
 assert.match(requirement('shoalDither',{paletteMix:0,deepEdge:0}),/Hard shallow-to-deep step/);
 shows('shoalDither',{paletteMix:0,deepEdge:1});
 assert.equal(available('facing','mountain',{lean:0}),false);
 assert.equal(available('facing','mountain',{lean:2}),true);
 assert.equal(available('facing','hill',{lean:0}),true,'a hill leans on its own');
 assert.equal(available('facing','plateau',{lean:0}),true,'a plateau leans on its own');
 assert.equal(available('styleFace','hill',{world:{microRock:0}}),false,'faces of one material have no rock share to set');
 assert.equal(available('styleFace','hill',{world:{microRock:1}}),true);
 assert.equal(available('styleFace','hill',{}),true);
 assert.equal(available('styleDeposits','hill',{world:{beachLayer:1,sand:0}}),false,'a beach keeps the Sand brush for its bars');
 assert.equal(available('styleDeposits','hill',{world:{beachLayer:1,sand:.5}}),true);
 assert.equal(available('styleDeposits','hill',{world:{beachLayer:1,sand:0,stoneDensity:.2}}),true);
 assert.equal(available('styleDeposits','hill',{world:{beachLayer:0,sand:0}}),true);
 assert.equal(available('facing','plateau',{lean:0,facePx:6}),false,'until a Face width takes that away');
 assert.equal(available('facing','plateau',{lean:2,facePx:6}),true);
});
