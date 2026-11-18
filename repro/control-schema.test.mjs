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

test('Vegetation relief acts where a surface layer grows plants',async()=>{
 const {worldControlRequirement:requirement}=await import('../sculpt-control-schema.js');
 assert.match(requirement('plantRelief',{plants:0}),/No surface layer grows plants/);
 assert.equal(requirement('plantRelief',{plants:1}),'');
});

test('world dependencies explain bypasses without biome gates',async()=>{
 const {worldControlRequirement:requirement}=await import('../sculpt-control-schema.js');
 // The column's tilt moves its beds, which the draw shows as the strata colours: it needs a column and Strata; its direction needs a tilt.
 for(const key of ['bedDip','bedDipDir'])assert.match(requirement(key,{column:0,bedDip:1,strata:1}),/Add a rock column in the Rock column panel/,key);
 for(const key of ['bedDip','bedDipDir'])assert.match(requirement(key,{column:1,bedDip:1,strata:0}),/Layer color coverage in Rock types/,key);
 assert.equal(requirement('bedDip',{column:1,strata:1}),'');
 assert.match(requirement('bedDipDir',{column:1,strata:1,bedDip:0}),/Set Bed tilt/);
 assert.equal(requirement('bedDipDir',{column:1,strata:1,bedDip:.5}),'');
 assert.match(requirement('undulationCover',{undulation:0}),/Undulation height/);
 assert.equal(requirement('undulationCover',{undulation:8}),'');
 assert.match(requirement('undulationArt',{undulation:0}),/Undulation height/);
 assert.equal(requirement('undulationArt',{undulation:8}),'');
 // Low ground's reach serves its tint and its grain.
 assert.match(requirement('lowReach',{lowGrain:1}),/Lower Grain kept/);
 assert.equal(requirement('lowReach',{lowGrain:.5}),'');
 assert.equal(requirement('lowGrain',{}),'');
 assert.equal(requirement('looseSize',{looseSupply:0}),'','painted scatter still uses size when the world Supply is zero');
 assert.equal(requirement('bandSoftness',{banding:0}),'','painted banding still uses the riser share when the world strength is zero');
});

test('H22b: rows that act only once another is on say so, and come back when it is',async()=>{
 const {worldControlRequirement:requirement}=await import('../sculpt-control-schema.js');
 const shows=(key,on)=>assert.equal(requirement(key,on),'',key);
 // The blur needs a crisp waterline.
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
 shows('shineStretch',{shineSlopeRough:.2,slopeTexture:.3});
 assert.match(requirement('shineGate',{}),/Gloss or Roughness/);
 shows('shineGate',{shineSlopeRough:.2,slopeTexture:.3});
 shows('shineGate',{shineGround:.2});
 // strata: bands and caps need a column and the strata switch
 // a world without a column of its own: the reason names the panel that adds one
 for(const key of ['strata','strataContrast','strataGrain','baseBand','desertCapFlat'])assert.match(requirement(key,{column:0,strata:1}),/Add a rock column in the Rock column panel/,key);
 assert.match(requirement('desertCapFlat',{column:1,strata:1,capBed:0}),/Rock column panel/);
 assert.match(requirement('baseBand',{column:1,strata:0}),/Rock types › Layers/);
 shows('baseBand',{column:1,strata:.5});
 assert.match(requirement('desertCapFlat',{column:1,strata:.5,capBed:0}),/no cap bed/);   // Green's column has eight beds in one section, so its caps hold nothing
 shows('desertCapFlat',{column:1,strata:.5,capBed:1});
 assert.match(requirement('baseBandGaps',{column:1,strata:1,baseBand:0}),/Gray band/);
 shows('baseBandGaps',{column:1,strata:1,baseBand:.5});
 assert.match(requirement('baseBandGaps',{column:1,strata:0,baseBand:.5}),/Rock types › Layers/);
 assert.equal(requirement('lavaDusk',{lavaCrust:0}),'','the dusk darkens any rock turned from the sun, crust or none');
 assert.match(requirement('ripple',{beachLayer:1,sand:0}),/Weathering supply/);
 shows('ripple',{beachLayer:1,sand:.5});
 shows('ripple',{beachLayer:0,sand:0});   // the Sand brush feeds it where there is no beach
 assert.match(requirement('strataContrast',{column:1,strata:0}),/Rock types › Layers/);
 shows('strataContrast',{column:1,strata:.4});
 // water: the hard step, the threshold step
 assert.match(requirement('shelfWander',{deepEdge:0}),/Hard shallow-to-deep step/);
 shows('shelfWander',{deepEdge:1});
 // The bed is always lit: its controls show with chosen water colors too.
 for(const k of ['bedTint','bedBright','bedContrast','bedFlat','bedRelief'])shows(k,{waterColored:1});
 shows('bedTint',{waterColored:0});
 // Sampled slope texture: the sediment transition replaces the slope color at full Material weathering; the slope group's lobe rows need a share
 assert.match(requirement('slopeTexture',{slopeReplaced:1}),/Material weathering/);
 shows('slopeTexture',{slopeReplaced:1,shineSlope:.5});
 shows('slopeTexture',{slopeReplaced:0});
 for(const k of ['shineSlope','shineSlopeRough','shineSlopeSharp','shineSlopeScale'])assert.match(requirement(k,{shineSlope:1,shineSlopeRough:1,slopeTexture:0}),/Sampled slope texture/);
 assert.equal(requirement('shineSlopeGate',{shineSlope:1,slopeTexture:0}),requirement('shineSlopeGate',{}),'a slope group with no share is not a material shining');
 shows('shineSlopeGate',{shineSlope:1,slopeTexture:.3});
 shows('shineSlopeSharp',{shineSlope:1,slopeTexture:.3});
 shows('shineSlopeScale',{shineSlopeRough:1,slopeTexture:0,slopeSand:1});
 assert.match(requirement('shineRockSharp',{shineRock:0}),/Gloss/);
 shows('shineRockSharp',{shineRock:1,slopeTexture:0});
 // the bed is always lit, so the step's deep share is drawn whatever the water's tones
 for(const t of [1,2,3])shows('deepEdge',{waterTones:t});
 shows('shelfWander',{waterTones:1,deepEdge:1});
 // the ramp: a third colour is cut by the depths whatever the step does; two colours need the step off, or a Faded stroke
 shows('waterSoft',{waterTones:3,rampWater:0});
 assert.match(requirement('waterSoft',{waterTones:2,rampWater:0}),/Faded edge/);
 shows('waterSoft',{waterTones:2,rampWater:1});
 shows('waterSoft',{waterTones:1,rampWater:1});
 shows('shallowDepth',{waterTones:3});
 shows('deepDepth',{waterTones:2,rampWater:0,deepEdge:1});   // the hard step sits at their midpoint
 shows('shallowDepth',{waterTones:1});
 // a stroke's edge choice: the bed is always lit, so the step's deep share is always drawn
 assert.equal(available('waterDeep','landform',{world:{waterTones:1}}),true);
 assert.equal(available('waterDeep','landform',{world:{waterTones:3}}),true);
 assert.equal(available('waterDeep','landform',{world:{waterTones:2}}),true);
 assert.equal(available('waterDeep','landform',{world:{waterColored:1,waterTones:2}}),true,'a picked color makes two tones, so a stroke\'s edge shows');
 // facts of the world's material the panel passes in with the settings
 assert.match(requirement('beachWidth',{beachLayer:0}),/no beach of its own. Choose another world's Beach, above,/);
 shows('beachWidth',{beachLayer:1});
 assert.match(requirement('slopeTexture',{slopeSand:1}),/sand/);
 shows('slopeTexture',{slopeSand:0});
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
