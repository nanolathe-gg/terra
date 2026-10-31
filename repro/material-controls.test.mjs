import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {materialRows,MM_ROWS} from '../sculpt-material-model.js';
const table=JSON.parse(fs.readFileSync(new URL('../materials/green.json',import.meta.url)));
test('live placement defaults preserve the accepted material table exactly',()=>{
 const original=materialRows(table),live=materialRows(table,new URLSearchParams({faceEdge:'.8',gullyRock:'.5',rockOrder:'1'}));
 assert.deepEqual(live,original);
});
test('placement edits change only intended table cells, including valid zero',()=>{
 const old=materialRows(table),live=materialRows(table,new URLSearchParams({faceEdge:'0',gullyRock:'1.5',rockOrder:'.4'})),base=MM_ROWS*table.order.length;
 assert.equal(live[base+6][2],0);assert.equal(live[base+9][0],1.5);assert.equal(live[base+9][1],.4);
 const changed=[];for(let r=0;r<old.length;r++)for(let c=0;c<4;c++)if(old[r][c]!==live[r][c])changed.push([r,c]);
 assert.deepEqual(changed,[[base+6,2],[base+9,0],[base+9,1]]);
 assert.deepEqual(materialRows(table,new URLSearchParams({faceEdge:'bad',faceSlope:'bad,1',faceScore:'1,2'})),old);
});
test('global bed spacing scales authored zones without changing the preset',async()=>{
 const {strataZoneWidths}=await import('../sculpt-material-model.js');
 const config={presetDefaults:{strataSpacing:6},defaults:{strataSpacing:12},strataZoneSpacing:[6,6,0,11]};
 assert.deepEqual(strataZoneWidths(config,6),[6,6,0,11]);
 assert.deepEqual(strataZoneWidths(config,null),[6,6,0,11]);
 assert.deepEqual(strataZoneWidths(config,undefined),[6,6,0,11]);
 assert.deepEqual(strataZoneWidths(config,12),[12,12,0,22]);
 assert.deepEqual(strataZoneWidths(config,3),[3,3,0,5.5]);
 assert.deepEqual(strataZoneWidths({defaults:{strataSpacing:10}},10),[]);
});
