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
