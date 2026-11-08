import test from 'node:test';
import assert from 'node:assert/strict';
import {shapeControlAvailable as available} from '../sculpt-control-schema.js';
import {KNOBS} from '../sculpt-knobs.js';
import {SHAPE_FIELDS} from '../sculpt-scene.js';
import {prepareNode} from '../sculpt-gpu-fields.js';

test('a landform takes facets unless its coast pass is on',()=>{
 assert.equal(available('iceFacetSize','landform',{iceFacets:1}),true);
 assert.equal(available('iceFacetSize','landform',{iceFacets:0}),false);
 assert.equal(available('iceFacets','landform',{iceFacets:1,fingers:1}),false);
 assert.equal(available('iceFacets','landform',{stepReference:1,terraces:4}),false);
 assert.equal(available('iceFacets','landform',{stepReference:0,terraces:4}),true);
});
test('faceted forms and shoreline materials keep their own dependent controls',()=>{
 // lfcrystal: a landform's Facet shape and each shape's rows show once facets are on, by the shape (never by the world or the stroke's palette entry).
 assert.equal(available('facetForm','landform',{iceFacets:0}),false);
 assert.equal(available('facetForm','landform',{iceFacets:.6}),true);
 assert.equal(available('crystalStep','landform',{iceFacets:.6,facetForm:1}),true);
 assert.equal(available('crystalStep','landform',{iceFacets:.6,facetForm:2}),false);
 assert.equal(available('crystalTop','landform',{iceFacets:.6,facetForm:2}),true);
 assert.equal(available('crystalTop','landform',{iceFacets:0,facetForm:2}),false);
 assert.equal(available('crystalTiers','landform',{iceFacets:.6,facetForm:0}),false);
 assert.equal(available('crystalTiers','landform',{iceFacets:.6,facetForm:2}),true);
 assert.equal(available('bergRough','landform',{iceFacets:.6,facetForm:2,stepReference:1,terraces:4}),false);
 // One Facets feature: Surface and width for every shape, Step height for angular facets and columns, and a landform that digs takes angular facets.
 assert.equal(available('facetSurface','landform',{iceFacets:.6,facetForm:0}),true);
 assert.equal(available('facetSurface','landform',{iceFacets:0}),false);
 assert.equal(available('crystalStep','landform',{iceFacets:.6,facetForm:0}),true);
 const dig={iceFacets:1,heightReference:2,elevation:-18};
 assert.equal(available('facetForm','landform',{...dig,facetForm:2}),false);
 assert.equal(available('crystalStep','landform',{...dig,facetForm:2}),true);
 assert.equal(available('crystalTop','landform',{...dig,facetForm:2}),false);
 assert.equal(available('facetForm','landform',{iceFacets:1,heightReference:2,elevation:12}),true);
 // lfimpact2: Buckling shows on a landform that digs, as the engine draws it there only.
 assert.equal(available('buckling','landform',dig),true);
 assert.equal(available('buckling','landform',{heightReference:2,elevation:12}),false);
 assert.equal(available('buckling','landform',{heightReference:0,elevation:-18}),false);
 // Secondaries' distance shows once there is a secondary.
 assert.equal(available('secondaryDistance','landform',{secondaries:0}),false);
 assert.equal(available('secondaryDistance','landform',{secondaries:1}),true);
 assert.equal(available('frostNeedles','landform',{shorePlates:1,plateMaterial:1}),false);
 assert.equal(available('frostNeedles','landform',{shorePlates:1,plateMaterial:2}),true);
 assert.equal(available('crystalShoreSeam','landform',{shorePlates:1,plateMaterial:2}),false);
});
test('erase all masks includes all eight local style planes',()=>{
 const context={seed:1,baseHeight:99,sea:75,params:n=>new Proxy(n.params,{get:(q,k)=>q[k]??0})};
 const prepared=prepareNode({kind:'paint',seed:1,points:[{x:40,y:40}],params:{radius:20,amount:100,paintChannel:7,softness:.5}}, {grid:256,spacing:1},context);
 const writes=prepared.writes;
 assert.ok(writes,'paint preparation exposes mask writes');
 assert.deepEqual(writes.map(w=>w[0]),Array.from({length:18},(_,i)=>i));
 assert.ok(writes.every(w=>w[1]===0));
});
test('labels and group names name no world',()=>{
 // Labels and group names describe features, never worlds (AGENTS.md rule 7): the tables hold the names the panel shows.
 const named=/\b(Archipelago|Moon|Lava|Red|Green|Ice|Crystal|Desert|Zhon)\b/;
 for(const [group,list] of KNOBS){assert.ok(!named.test(group),group);for(const [key,label] of list)assert.ok(!named.test(label),`${key}: ${label}`);}
 for(const [key,,label] of SHAPE_FIELDS)assert.ok(!named.test(label),`${key}: ${label}`);
});

test('every world can turn vegetation on, and flowers stay independent of relief',async()=>{
 const {worldControlRequirement:requirement}=await import('../sculpt-control-schema.js');
 // Vegetation cover above 0 is the switch; every world has a table, so Vegetation cover itself is never idle.
 for(const v of [{},{vegetationCover:0},{vegetationCover:1}])assert.equal(requirement('vegetationCover',v),'');
 for(const key of ['plantRelief','flowerDensity']){assert.match(requirement(key,{vegetationCover:0}),/Raise Vegetation cover/);assert.equal(requirement(key,{vegetationCover:1}),'');}
 assert.equal(requirement('flowerDensity',{vegetationCover:1,plantRelief:0}),'');
 // Flowers are dots in the ground's color, which the sediment transition replaces at 100 percent Material weathering; the plants' relief still shows.
 assert.match(requirement('flowerDensity',{vegetationCover:1,slopeReplaced:1}),/Lower Material weathering/);assert.equal(requirement('plantRelief',{vegetationCover:1,slopeReplaced:1}),'');
});

test('world dependencies explain bypasses without biome gates',async()=>{
 const {worldControlRequirement:requirement}=await import('../sculpt-control-schema.js');
 assert.match(requirement('bedVary',{column:1,rockOrder:1}),/authored bed profile/);
 assert.equal(requirement('bedVary',{column:0,rockOrder:1,bedLedge:.5}),'');
 assert.match(requirement('undulationCover',{undulation:0}),/Undulation height/);
 assert.equal(requirement('undulationCover',{undulation:8}),'');
 assert.match(requirement('undulationArt',{undulation:0}),/Undulation height/);
 assert.equal(requirement('undulationArt',{undulation:8}),'');
 assert.match(requirement('grooveSpacing',{rockOrder:0,gullyDepth:1}),/Rock structure/);
 assert.match(requirement('grooveRun',{rockOrder:1,rockJoint:0,rockOpen:1,gullyDepth:0}),/Open joints or Gully depth/);
 assert.equal(requirement('grooveRun',{rockOrder:1,rockJoint:2,rockOpen:1}),'');
 assert.equal(requirement('grooveRun',{rockOrder:1,rockJoint:0,rockOpen:1,gullyDepth:4}),'');   // Green cuts gullies and no joints
 assert.match(requirement('grooveSpacing',{rockOrder:1,rockJoint:0,rockOpen:1,gullyDepth:0,ribTilt:0}),/Open joints, Gully depth or Rib tilt/);
 assert.equal(requirement('grooveSpacing',{rockOrder:1,rockJoint:0,rockOpen:1,gullyDepth:0,ribTilt:.2}),'');   // ribs stand between the lines
 assert.match(requirement('grooveRun',{rockOrder:1,rockJoint:0,rockOpen:1,gullyDepth:0,ribTilt:.2}),/Open joints or Gully depth/);   // a rib cuts nothing
 assert.match(requirement('cliffStagger',{rockOrder:1,cliffFollow:0,rockJoint:2,rockOpen:1}),/Follow terrain/);
 assert.match(requirement('cliffStagger',{rockOrder:1,cliffFollow:1,rockJoint:0,rockOpen:1}),/joint lines/);
 assert.equal(requirement('cliffStagger',{rockOrder:1,cliffFollow:1,rockJoint:2,rockOpen:1}),'');
 assert.equal(requirement('looseSize',{looseSupply:0}),'','painted scatter still uses size when the world Supply is zero');
 assert.equal(requirement('bandSoftness',{banding:0}),'','painted banding still uses the riser share when the world strength is zero');
});

test('H22b: rows that act only once another is on say so, and come back when it is',async()=>{
 const {worldControlRequirement:requirement}=await import('../sculpt-control-schema.js');
 const shows=(key,on)=>assert.equal(requirement(key,on),'',key);
 // the waterline: stairs and blur need a crisp waterline, and a blur replaces the stairs
 assert.match(requirement('shoalStairs',{crispShore:0}),/Crisp waterline/);
 assert.match(requirement('shoalStairs',{crispShore:1,shoalShoreSoft:4}),/Waterline blur replaces the stairs/);
 shows('shoalStairs',{crispShore:1,shoalShoreSoft:0});
 assert.match(requirement('shoalShoreSoft',{crispShore:0}),/Crisp waterline/);
 shows('shoalShoreSoft',{crispShore:.5});
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
 assert.match(requirement('rockScale',{rockOrder:0}),/Rock structure/);
 assert.match(requirement('rockAge',{rockOrder:1,rockCells:0}),/Choose a Rock type with blocks/);
 // Rock type (card P10): a named type's own numbers decide what it cuts, whatever the world's own (the facts worldPanelValues passes) say
 assert.match(requirement('rockType',{rockOrder:0,rockMoss:0}),/Rock structure, or raise Vegetation tint in rock/);
 shows('rockType',{rockOrder:1});
 shows('rockType',{rockOrder:0,rockMoss:1});   // its lichen grows on any rock face
 shows('rockAge',{rockOrder:0,rockMoss:1,rockType:1});   // and with Age
 assert.match(requirement('rockAge',{rockOrder:0,rockMoss:0,rockType:1}),/Rock structure/);
 assert.match(requirement('rockScale',{rockOrder:0,rockMoss:1,rockType:1}),/Rock structure/);
 shows('rockScale',{rockOrder:0,hillBlocks:.5,rockType:1});   // blocks on the hills (a world preset's hillBlocks)
 shows('rockAge',{rockOrder:1,rockCells:0,rockLichen:1,rockMoss:1});
 shows('rockAge',{rockOrder:1,rockCells:0,rockType:1});   // Granite cuts blocks
 shows('rockScale',{rockOrder:1,rockCells:0,rockType:3});
 shows('rockScale',{rockOrder:1,rockCells:1,rockType:0});   // 0: the world's own, here with blocks
 assert.match(requirement('cliffStagger',{rockOrder:1,cliffFollow:1,rockJoint:2,rockOpen:1,rockType:1}),/Choose a Rock type with joint lines/);   // Granite cuts none
 shows('cliffStagger',{rockOrder:1,cliffFollow:1,rockJoint:0,rockOpen:1,rockType:3});   // Basalt does
 assert.match(requirement('cliffStagger',{rockOrder:1,cliffFollow:1,rockOpen:0,rockType:3}),/Raise Open joints/);
 shows('grooveRun',{rockOrder:1,rockJoint:0,rockOpen:1,gullyDepth:0,rockType:2});   // Sandstone's joint lines
 shows('rockStain',{rockOrder:1,gullyDepth:0,rockCurtains:0,rockType:1});   // Granite's ledge stains
 // Stain (card P10) darkens gully floors and the rock type's ledge curtains: it needs ordered rock and one of the two
 assert.match(requirement('rockStain',{rockOrder:0,gullyDepth:4}),/Rock structure/);
 assert.match(requirement('rockStain',{rockOrder:1,gullyDepth:0,rockCurtains:0}),/Gully depth or choose a Rock type with ledge stains/);
 shows('rockStain',{rockOrder:1,gullyDepth:4,rockCurtains:0});
 shows('rockStain',{rockOrder:1,gullyDepth:0,rockCurtains:1});
 shows('rockScale',{rockOrder:1,rockCells:1});
 assert.match(requirement('cliffRise',{rockOrder:1,bedLedge:0}),/Ledges above zero/);
 assert.match(requirement('bedSpacing',{rockOrder:1,bedLedge:0}),/Ledges above zero/);
 shows('bedSpacing',{rockOrder:1,rockJoint:2,rockOpen:1,cliffFollow:1,cliffStagger:.5});   // a joint's stagger is keyed on its bed
 assert.match(requirement('cliffRise',{rockOrder:1,rockJoint:2,rockOpen:1,cliffFollow:1,cliffStagger:.5}),/Ledges above zero/,'the rise is relief only');
 shows('bedSpacing',{rockOrder:1,bedLedge:.5});
 // strata: bands and caps need a column and the strata switch
 // a world without a column of its own: the reason names the panel that adds one
 for(const key of ['strata','strataContrast','strataGrain','baseBand','desertCapFlat'])assert.match(requirement(key,{column:0,strata:1}),/Add a rock column in the Rock column panel/,key);
 assert.match(requirement('desertCapFlat',{column:1,strata:1,capBed:0}),/Rock column panel/);
 assert.match(requirement('baseBand',{column:1,strata:0}),/Strata/);
 shows('baseBand',{column:1,strata:.5});
 assert.match(requirement('desertCapFlat',{column:1,strata:.5,capBed:0}),/no cap bed/);   // Green's column has eight beds in one section, so its caps hold nothing
 shows('desertCapFlat',{column:1,strata:.5,capBed:1});
 assert.match(requirement('baseBandGaps',{column:1,strata:1,baseBand:0}),/Gray band/);
 shows('baseBandGaps',{column:1,strata:1,baseBand:.5});
 assert.match(requirement('baseBandGaps',{column:1,strata:0,baseBand:.5}),/Strata/);
 assert.match(requirement('bedSpacing',{column:1,rockOrder:1,bedLedge:1}),/authored bed profile/);
 shows('bedSpacing',{column:1,rockOrder:1,bedLedge:1,cliffRise:8});   // a column's ledge scales by thickness over spacing once it has a rise
 assert.equal(requirement('lavaDusk',{lavaCrust:0}),'','the dusk darkens any rock turned from the sun, crust or none');
 assert.match(requirement('faceEdge',{microRock:0}),/one material/);
 shows('gullyRock',{microRock:.7});
 shows('iceSlate',{});   // the world table's default is interleaved
 assert.match(requirement('ripple',{beachLayer:1,sand:0}),/Weathering supply/);
 shows('ripple',{beachLayer:1,sand:.5});
 shows('ripple',{beachLayer:0,sand:0});   // the Sand brush feeds it where there is no beach
 assert.match(requirement('crackedStep',{deepEdge:0,crackedBed:1}),/Hard shallow-to-deep step/);
 assert.match(requirement('crackedStep',{deepEdge:1,crackedBed:0}),/Cracked bed/);
 shows('crackedStep',{deepEdge:1,crackedBed:1});
 assert.match(requirement('strataContrast',{column:1,strata:0}),/Strata/);
 shows('strataContrast',{column:1,strata:.4});
 // water: the lit bed, the hard step, the threshold step
 assert.match(requirement('bedDots',{bedLit:0}),/Lit bed/);
 shows('bedDots',{bedLit:.5});
 assert.match(requirement('shelfWander',{deepEdge:0}),/Hard shallow-to-deep step/);
 shows('shelfWander',{deepEdge:1});
 assert.match(requirement('shoalBump',{bedLit:1,deepEdge:0}),/Hard shallow-to-deep step/);
 assert.match(requirement('shoalBump',{bedLit:0,deepEdge:1}),/Lit bed/);
 shows('shoalBump',{bedLit:1,deepEdge:1});
 shows('shoalBumpPx',{bedLit:1,deepEdge:1,shoalBump:2});
 // a picked Shallow water or Deep water color: the bed's rows draw nothing, the lit bed itself only through the hard step's palette dither
 for(const k of ['bedTint','bedBright','bedContrast','bedFlat','bedDots','shoalGrain'])assert.match(requirement(k,{bedLit:1,waterColored:1}),/Shallow water or Deep water color/);
 assert.match(requirement('shoalBump',{bedLit:1,deepEdge:1,waterColored:1}),/Colors/);
 assert.match(requirement('shoalBumpPx',{bedLit:1,deepEdge:1,shoalBump:2,waterColored:1}),/Colors/,'inherited from Lit bumps');
 assert.match(requirement('bedLit',{waterColored:1,deepEdge:0,dither:2}),/Colors/);
 assert.match(requirement('bedLit',{waterColored:1,deepEdge:1,dither:2,paletteMix:1}),/Colors/);
 shows('bedLit',{waterColored:1,deepEdge:1,dither:2});
 shows('bedTint',{waterColored:0,bedLit:1});
 // Sampled slope texture: the sediment transition replaces the slope color at full Material weathering; the slope group's lobe rows need a share
 assert.match(requirement('slopeTexture',{slopeReplaced:1}),/Material weathering/);
 shows('slopeTexture',{slopeReplaced:1,shineSlope:.5});
 shows('slopeTexture',{slopeReplaced:0});
 for(const k of ['shineSlope','shineSlopeRough','shineSlopeSharp','shineSlopeScale'])assert.match(requirement(k,{shineSlope:1,shineSlopeRough:1,slopeTexture:0,microRock:0}),/Sampled slope texture/);
 assert.equal(requirement('shineSlopeGate',{shineSlope:1,slopeTexture:0,microRock:0}),requirement('shineSlopeGate',{}),'a slope group with no share is not a material shining');
 shows('shineSlopeGate',{shineSlope:1,slopeTexture:.3,microRock:0});
 shows('shineSlopeSharp',{shineSlope:1,slopeTexture:.3,microRock:0});
 shows('shineSlopeSharp',{shineSlope:1,slopeTexture:0,microRock:1});
 shows('shineSlopeScale',{shineSlopeRough:1,slopeTexture:0,slopeSand:1,microRock:0});
 assert.match(requirement('shineRockSharp',{shineRock:0}),/Gloss/);
 shows('shineRockSharp',{shineRock:1,slopeTexture:0,microRock:0});
 // one water colour, or a third that follows the depth: the step shows only where something draws its deep share
 assert.match(requirement('deepEdge',{waterTones:1}),/one colour/);
 assert.match(requirement('deepEdge',{waterTones:3}),/third colour/);
 for(const lit of [{bedLit:.5},{crystalShallow:1}])shows('deepEdge',{waterTones:1,...lit});
 shows('deepEdge',{waterTones:2});
 assert.match(requirement('shelfWander',{waterTones:1,deepEdge:1}),/one colour/,'a parent that is itself idle names its own reason');
 shows('shelfWander',{waterTones:1,deepEdge:1,bedLit:1});
 // the ramp: a third colour is cut by the depths whatever the step does; two colours need the step off, or a Faded stroke
 shows('waterSoft',{waterTones:3,rampWater:0});
 assert.match(requirement('waterSoft',{waterTones:1,rampWater:1}),/one colour/);
 assert.match(requirement('bandWater',{waterTones:2,rampWater:0}),/Faded edge/);
 shows('bandWater',{waterTones:2,rampWater:1});
 shows('waterSoft',{waterTones:1,bedLit:1,rampWater:1});
 shows('shallowDepth',{waterTones:3});
 shows('deepDepth',{waterTones:2,rampWater:0,deepEdge:1});   // the hard step sits at their midpoint
 assert.match(requirement('shallowDepth',{waterTones:1}),/one colour/);
 // a stroke's edge choice, on its own Lit bed or the world's
 assert.equal(available('waterDeep','landform',{waterBed:0,world:{waterTones:1}}),false);
 assert.equal(available('waterDeep','landform',{waterBed:1,world:{waterTones:1}}),true);
 assert.equal(available('waterDeep','landform',{waterBed:0,world:{waterTones:3,bedLit:1}}),true);
 assert.equal(available('waterDeep','landform',{waterBed:0,world:{waterTones:2}}),true);
 // under a picked water color Lit bed and Noise water need the hard step, but Cracked bed still draws, so a stroke's bed row stays
 assert.equal(available('waterBed','landform',{waterDeep:2,world:{waterColored:1,waterTones:2}}),true);
 assert.equal(available('waterDeep','landform',{waterBed:0,world:{waterColored:1,waterTones:2}}),true,'a picked color makes two tones, so a stroke\'s edge shows');
 // facts of the world's material the panel passes in with the settings
 assert.match(requirement('ringContrast',{ringLayer:0}),/no mineral fringe/);
 shows('ringContrast',{ringLayer:1});
 assert.match(requirement('ringShiftDir',{ringLayer:1,ringShift:0}),/Offset between copies/);
 assert.match(requirement('beachWidth',{beachLayer:0}),/no beach of its own. Choose another world's Beach in Colors & base pattern/);
 shows('beachWidth',{beachLayer:1});
 assert.match(requirement('groundTiles',{groundTiled:0}),/Ground pattern/);
 shows('groundTiles',{groundTiled:1});
 assert.match(requirement('slopeTexture',{slopeSand:1}),/sand/);
 assert.match(requirement('slopeTexture',{vegetationCover:1}),/ground cover decides the slope cover/);
 shows('slopeTexture',{vegetationCover:0});
 shows('slopeTexture',{slopeSand:0});
 assert.match(requirement('dither',{paletteMix:1}),/Nearest color/);
 shows('dither',{paletteMix:0});
 assert.equal(available('facing','landform',{lean:0}),false,'equal sides have no side to lean toward');
 assert.equal(available('facing','landform',{lean:2}),true);
});

// A symmetric mesa cannot change by turning its identical sides; an unlinked plateau can, even at equal widths.
test('landform facing requires unequal widths or unequal sampled sections',()=>{
 const curve={form:'lfPlateau',knots:[[0,0],[.5,1],[1,1]]};
 for(const lean of [undefined,0,1])assert.equal(available('facing','landform',{lean,curve}),false);
 for(const lean of [.5,2])assert.equal(available('facing','landform',{lean,curve}),true);
 assert.equal(available('facing','landform',{lean:1,curve:{...curve,back:curve.knots.map(k=>[...k])}}),false);
 assert.equal(available('facing','landform',{lean:1,curve:{...curve,back:[[0,0],[.7,1],[1,1]]}}),true);
});
