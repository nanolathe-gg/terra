import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tablePlacementRows,groundCoverRows,groundCoverOn,recolorRGB,COVER_ROWS} from '../sculpt-material-model.js';
const table=JSON.parse(fs.readFileSync(new URL('../materials/green.json',import.meta.url)));
test('the placement rows are the table\'s own: where rock shows off the rock face, six rows',()=>{
 const q=table.placement,rows=tablePlacementRows(table);
 assert.equal(rows.length,6);
 assert.deepEqual(rows[0],[q.rock.slope,q.rock.formSlope,q.rock.convexity,q.rock.convexityRange]);
 assert.deepEqual(rows[5],[q.route.from,q.route.to,0,0]);
 assert.equal(q.face,undefined,'the face blend went with the rock face: the table has no face rows');
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
test('vegetation controls change only their material rows, and Vegetation cover 0 turns the cover off',()=>{
 const snapshot=structuredClone(cover),original=groundCoverRows(cover),live=groundCoverRows(cover,new URLSearchParams({vegetationCover:.5,plantRelief:.5,flowerDensity:3}));
 assert.equal(live[5][0],original[5][0],'bare soil stays present');
 for(let i=1;i<7;i++)assert.equal(live[5+5*i][0],original[5+5*i][0]*.5);
 assert.deepEqual(live[39],[2,1,.75,.15*3]);
 const changed=live.flatMap((r,i)=>r.some((v,j)=>v!==original[i][j])?[i]:[]);
 assert.deepEqual(changed,[10,15,20,25,30,35,39]);
 assert.deepEqual(cover,snapshot,'editing a world must not modify its material preset');
 const off=new URLSearchParams({vegetationCover:0});
 assert.equal(groundCoverOn(cover,off),false);assert.equal(groundCoverOn(null,new URLSearchParams()),false);assert.equal(groundCoverOn(cover,new URLSearchParams()),true);
 assert.deepEqual(groundCoverRows(cover,off),Array.from({length:COVER_ROWS},()=>[0,0,0,0]),'off is the same rows as no table');
});
test('a table with no ground of its own reads the world\'s, and its bare soil is that ground',()=>{
 const {ground,...rest}=cover,own=structuredClone(rest);delete own.classes[0].rgb;own.classes[0].bare=true;
 const rows=groundCoverRows(own,null,{},[.2,.3,.4]);
 assert.deepEqual(rows[3],[.2,.3,.4,0]);assert.deepEqual(rows[4],[.2,.3,.4,.1]);assert.deepEqual(rows[9],[...cover.classes[1].rgb.map(v=>v/255),.1]);
});
test('the Vegetation color moves every class but bare soil, keeping their steps',()=>{
 const own={...structuredClone(cover),color:[55,95,27]};own.classes[0].bare=true;
 const base=groundCoverRows(own),pick=[.7,.25,.1],rows=groundCoverRows(own,null,{vegetation:pick});
 assert.deepEqual(rows[4],base[4],'bare soil keeps its colour');
 for(let i=1;i<7;i++)assert.deepEqual(rows[4+5*i].slice(0,3),recolorRGB(base[4+5*i].slice(0,3),[55/255,95/255,27/255],pick));
 // The table's own colour goes to the pick; no pick leaves every row as it is.
 recolorRGB([55/255,95/255,27/255],[55/255,95/255,27/255],pick).forEach((v,i)=>assert.ok(Math.abs(v-pick[i])<1e-9));
 assert.deepEqual(groundCoverRows(own,null,{}),base);
});
test('flower colors retain species weights and coexist with density changes',()=>{
 const live=groundCoverRows(cover,new URLSearchParams({flowerDensity:2}),{flower2:[.1,.2,.3]});
 assert.deepEqual(live[41],[.1,.2,.3,3]);assert.equal(live[39][3],.3);
 assert.deepEqual(live[40],[236/255,232/255,214/255,4]);
 assert.deepEqual(groundCoverRows(cover)[41],[1,214/255,64/255,3]);
});
