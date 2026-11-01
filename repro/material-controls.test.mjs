import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tablePlacementRows} from '../sculpt-material-model.js';
const table=JSON.parse(fs.readFileSync(new URL('../materials/green.json',import.meta.url)));
test('live placement defaults preserve the accepted material table exactly',()=>{
 const original=tablePlacementRows(table),live=tablePlacementRows(table,new URLSearchParams({faceEdge:'.8',gullyRock:'.5',rockOrder:'1'}));
 assert.deepEqual(live,original);
});
test('placement edits change only intended table cells, including valid zero',()=>{
 const old=tablePlacementRows(table),live=tablePlacementRows(table,new URLSearchParams({faceEdge:'0',gullyRock:'1.5',rockOrder:'.4'})),base=0;
 assert.equal(live[base+6][2],0);assert.equal(live[base+9][0],1.5);assert.equal(live[base+9][1],.4);
 const changed=[];for(let r=0;r<old.length;r++)for(let c=0;c<4;c++)if(old[r][c]!==live[r][c])changed.push([r,c]);
 assert.deepEqual(changed,[[base+6,2],[base+9,0],[base+9,1]]);
 assert.deepEqual(tablePlacementRows(table,new URLSearchParams({faceEdge:'bad',faceSlope:'bad,1',faceScore:'1,2'})),old);
});
