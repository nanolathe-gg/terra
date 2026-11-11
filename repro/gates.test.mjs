import test from 'node:test';
import assert from 'node:assert/strict';
import {extractGates,gateValues,gateKey} from '../sculpt-gates.js';
const fields=new Map([
 ['layered',{offset:0,kind:'i',count:1,width:1}],
 ['rillDepth',{offset:4,kind:'f',count:1,width:1}],
 ['columnTerrain',{offset:16,kind:'f',count:1,width:4}],
 ['chunkScale',{offset:32,kind:'f',count:1,width:1}],
 ['paintOn',{offset:36,kind:'i',count:1,width:1}],
 ['strataColors',{offset:48,kind:'f',count:5,width:4}],
]);
test('comparisons with a constant become override bools; other reads stay uniforms',()=>{
 const src='if (u.layered != 0) { x = u.rillDepth * 2.0; }\nif (u.rillDepth <= 0.0 || u.columnTerrain.y > 0.5) { return; }\nlet n = select(a, b, u.layered == 1);';
 const {source,gates}=extractGates(src,fields);
 assert.match(source,/if \(gate_layered_ne_0\) \{ x = u\.rillDepth \* 2\.0; \}/);
 assert.match(source,/gate_rillDepth_le_0p0 \|\| gate_columnTerrainy_gt_0p5/);
 assert.match(source,/select\(a, b, gate_layered_eq_1\)/);
 assert.deepEqual([...gates.keys()].sort(),['gate_columnTerrainy_gt_0p5','gate_layered_eq_1','gate_layered_ne_0','gate_rillDepth_le_0p0']);
 for(const id of gates.keys())assert.match(source,new RegExp(`override ${id}: bool;`));
});
test('per-chunk uniforms, GPU-written flags, arrays and arithmetic on the right stay uniform reads',()=>{
 const src='if (u.chunkScale>1.0) {}\nif (u.paintOn != 0) {}\nif (u.rillDepth > 0.0 * k) {}\nif (u.strataColors.x > 0.0) {}';
 const {source,gates}=extractGates(src,fields);
 assert.equal(gates.size,0);
 assert.equal(source.split('\n').slice(0,4).join('\n'),src);
});
test('gate values (1 or 0: pipeline constants are numbers) follow the uniform data, and the key follows the values',()=>{
 const {gates}=extractGates('if (u.layered != 0) {}\nif (u.rillDepth <= 0.0) {}',fields);
 const view=new DataView(new ArrayBuffer(64));
 let v=gateValues(gates,view);
 assert.deepEqual(v,{gate_layered_ne_0:0,gate_rillDepth_le_0p0:1});
 view.setInt32(0,1,true);view.setFloat32(4,0.25,true);
 v=gateValues(gates,view);
 assert.deepEqual(v,{gate_layered_ne_0:1,gate_rillDepth_le_0p0:0});
 assert.equal(gateKey(v,['gate_layered_ne_0','gate_rillDepth_le_0p0']),'10');
});
// Rock recipes (engine-common.wgsl struct Rock): a test of a recipe number is a gate on the slots in use.
const rockFields=new Map([['rock',{offset:64,kind:'struct',count:16,stride:16,members:new Map([['faceClast',{offset:0,kind:'f',width:1}],['columnCount',{offset:4,kind:'i',width:1}]])}]]);
test('a recipe number tested against a constant is its constant where every slot in use answers alike, else the point\'s own test',()=>{
 const {source,gates}=extractGates('if(u.rock[rs & rockMask].faceClast<=0.0){}\nif (u.rock[rs & rockMask].columnCount > 0) {}\nlet n = u.rock[rs & rockMask].faceClast * 2.0;\noverride rockMask: u32 = 15u;',rockFields);
 assert.match(source,/if\(\(gate_rock_faceClast_le_0p0 \|\| \(gate_rock_faceClast_le_0p0_mixed && u\.rock\[rs & rockMask\]\.faceClast<=0\.0\)\)\)\{\}/);
 assert.match(source,/\(gate_rock_columnCount_gt_0 \|\| \(gate_rock_columnCount_gt_0_mixed && u\.rock\[rs & rockMask\]\.columnCount > 0\)\)/);
 assert.match(source,/let n = u\.rock\[rs & rockMask\]\.faceClast \* 2\.0;/);
 const view=new DataView(new ArrayBuffer(64+16*16));
 view.setFloat32(64,0,true);view.setInt32(68,3,true);view.setFloat32(80,2,true);view.setInt32(84,3,true);   // slot 0: no fragments; slot 1: fragments
 assert.deepEqual(gateValues(gates,view,[0]),{gate_rock_faceClast_le_0p0:1,gate_rock_faceClast_le_0p0_mixed:0,gate_rock_columnCount_gt_0:1,gate_rock_columnCount_gt_0_mixed:0,rockMask:0});
 assert.deepEqual(gateValues(gates,view,[0,1]),{gate_rock_faceClast_le_0p0:0,gate_rock_faceClast_le_0p0_mixed:1,gate_rock_columnCount_gt_0:1,gate_rock_columnCount_gt_0_mixed:0,rockMask:15});
});
test('with the world\'s own rock alone every rock test of the draw and the bake is a constant, slot 0\'s answer, and every read is slot 0\'s',async()=>{
 const {readFileSync}=await import('node:fs'),{preprocess,uniformLayout}=await import('../sculpt-renderer.js');
 const file=name=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8'),common=file('engine-common.wgsl');
 const layout=uniformLayout(preprocess(common,'',new Set()));
 const parts=[extractGates(preprocess(file('engine-frag.wgsl').replace('/*VOLUME*/',file('engine-volume.wgsl')),common,new Set(['VOLUME_RENDER'])),layout.fields),extractGates(preprocess(file('engine-bake.wgsl'),common,new Set(['BAKE'])),layout.fields)];
 const view=new DataView(new ArrayBuffer(layout.size)),table=layout.fields.get('rock');
 for(const {source,gates} of parts){
  // Every test of a recipe number against a constant is a gate (only the _mixed branch reads the slot), and every read of the table is masked.
  assert.equal(source.replace(/_mixed && u\.rock\[rs & rockMask\]\.\w+\s*(>=|<=|==|!=|>|<)\s*-?[\d.]+/g,'').match(/u\.rock\[rs & rockMask\]\.\w+\s*(>=|<=|==|!=|>|<)\s*-?\d/g),null);
  assert.equal(source.match(/u\.rock\[(?![^\]]*& rockMask\])/g),null);
  const rock=[...gates.values()].filter(g=>g.stride);
  assert.ok(rock.length>=5);
  for(const value of [0,1]){
   for(const g of rock)g.kind==='i'?view.setInt32(g.offset,value,true):view.setFloat32(g.offset,value,true);
   const v=gateValues(gates,view,[0]);
   assert.equal(v.rockMask,0);
   for(const g of rock){
    assert.equal(v[g.id+'_mixed'],0,g.id);
    assert.equal(v[g.id],({'>':value>g.constant,'<':value<g.constant,'>=':value>=g.constant,'<=':value<=g.constant,'==':value===g.constant,'!=':value!==g.constant})[g.op]?1:0,g.id);
   }
  }
  assert.equal(table.stride%16,0);
 }
});
