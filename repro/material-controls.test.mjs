import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tablePlacementRows,groundCoverRows,COVER_ROWS} from '../sculpt-material-model.js';
const table=JSON.parse(fs.readFileSync(new URL('../materials/green.json',import.meta.url)));
test('live placement defaults preserve the accepted material table exactly',()=>{
 const original=tablePlacementRows(table),live=tablePlacementRows(table,new URLSearchParams({faceEdge:'.8',gullyRock:'.5',rockOrder:'1'}));
 assert.deepEqual(live,original);
});

const cover={wet:[.25,.9],dry:.4,soil:{slope:[.6,1.6],convex:.5,deposit:.3},patch:22,moisture:{perSwath:.5,swathRef:.35,shade:.28},ground:[55,93,27],
 classes:Array.from({length:7},(_,i)=>({rgb:[20+i,40+i,60+i],grain:.1,strength:i+1,lush:i/2,moisture:[0,1,2,3],soil:[0,1,2,3],light:[0,1,2,3]})),
 plants:{tuft:4,shrub:2,shrubs:1.5,flowers:{density:.15,palette:[[236,232,214,4],[255,214,64,3],[170,120,215,1],[225,80,60,1]]}}};
test('neutral vegetation controls preserve material values and ignore invalid numbers',()=>{
 const neutral=new URLSearchParams({vegetationCover:1,plantRelief:1,flowerDensity:1}),original=groundCoverRows(cover);
 assert.deepEqual(groundCoverRows(cover,neutral),original);
 assert.deepEqual(groundCoverRows(cover,new URLSearchParams({vegetationCover:'bad',plantRelief:'Infinity'})),original);
 assert.deepEqual(groundCoverRows(null,neutral,{flower1:[1,0,1]}),Array.from({length:COVER_ROWS},()=>[0,0,0,0]));
});
test('vegetation controls change only their material rows, including zero',()=>{
 const snapshot=structuredClone(cover),original=groundCoverRows(cover),live=groundCoverRows(cover,new URLSearchParams({vegetationCover:0,plantRelief:.5,flowerDensity:3}));
 assert.equal(live[5][0],original[5][0],'bare soil stays present');
 for(let i=1;i<7;i++)assert.equal(live[5+5*i][0],0);
 assert.deepEqual(live[39],[2,1,0,.15*3]);
 const changed=live.flatMap((r,i)=>r.some((v,j)=>v!==original[i][j])?[i]:[]);
 assert.deepEqual(changed,[10,15,20,25,30,35,39]);
 assert.deepEqual(cover,snapshot,'editing a world must not modify its material preset');
});
test('flower colors retain species weights and coexist with density changes',()=>{
 const live=groundCoverRows(cover,new URLSearchParams({flowerDensity:2}),{flower2:[.1,.2,.3]});
 assert.deepEqual(live[41],[.1,.2,.3,3]);assert.equal(live[39][3],.3);
 assert.deepEqual(live[40],[236/255,232/255,214/255,4]);
 assert.deepEqual(groundCoverRows(cover)[41],[1,214/255,64/255,3]);
});
test('placement edits change only intended table cells, including valid zero',()=>{
 const old=tablePlacementRows(table),live=tablePlacementRows(table,new URLSearchParams({faceEdge:'0',gullyRock:'1.5',rockOrder:'.4'})),base=0;
 assert.equal(live[base+6][2],0);assert.equal(live[base+9][0],1.5);assert.equal(live[base+9][1],.4);
 const changed=[];for(let r=0;r<old.length;r++)for(let c=0;c<4;c++)if(old[r][c]!==live[r][c])changed.push([r,c]);
 assert.deepEqual(changed,[[base+6,2],[base+9,0],[base+9,1]]);
 assert.deepEqual(tablePlacementRows(table,new URLSearchParams({faceEdge:'bad',faceSlope:'bad,1',faceScore:'1,2'})),old);
});
