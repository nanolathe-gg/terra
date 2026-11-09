// Exercise the shared editor engine: deterministic voxel art, budget partitions,
// relief changing the solid, and the unchanged gameplay height lattice.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openHost,openScene,weather,renderWindow,windowHeights,knob,slider} from './headless.mjs';
await openHost();
const authored=JSON.parse(readFileSync(new URL('./scenes/green-4.json',import.meta.url),'utf8'));
const s=await openScene(authored,'biome=green&mapX=4&mapY=4&scratch=voxel-check&gpuMB=512&heapMB=1536');
const different=(a,b)=>{let n=0,max=0;for(let i=0;i<a.length;i+=4){let d=Math.max(...[0,1,2].map(k=>Math.abs(a[i+k]-b[i+k])));if(d)n++;max=Math.max(max,d);}return{pixels:n,max};};
try{
 await weather(s);
 const h=await windowHeights(s,{samples:64,step:8});
 const rect={x:256,y:256,width:512,height:256,tile:512,options:s.drawOptions({clay:true})};
 s.renderer.setBudgetMB(256);const a=await renderWindow(s,rect),wide={...s.renderer.stats().voxel};
 const repeat=await renderWindow(s,rect);assert.deepEqual(repeat,a,'identical renders must match byte for byte');
 s.renderer.setBudgetMB(96);const b=await renderWindow(s,rect),tight={...s.renderer.stats().voxel};
 const partition=different(a,b);assert.equal(partition.pixels,0,JSON.stringify({partition,wide,tight}));
 assert.ok(s.renderer.stats().peakBudgetedBytes<=256*1048576,'tracked resources exceed the largest budget');
 assert.ok(s.renderer.stats().budgetedBytes<=96*1048576,'final resources exceed the current budget');
 assert.ok(s.renderer.stats().byKind.loose>=s.renderer.looseBuffer.size,'the resized stone and vegetation mask must count toward the budget');
 await knob(s,'rockFace',0);const flat=await renderWindow(s,rect),relief=different(b,flat);
 assert.ok(relief.pixels>rect.width*rect.height*.05,'rock depth must visibly shape clay');
 await knob(s,'rockFace',.0001);const nearZero=await renderWindow(s,rect);
 const continuity=nearZero.reduce((sum,v,i)=>sum+Math.abs(v-flat[i]),0)/nearZero.length;
 assert.ok(continuity<.1,'zero depth must be the continuous limit of the same solid');
 assert.deepEqual(await windowHeights(s,{samples:64,step:8}),h,'art voxels must preserve exported gameplay heights');
 assert.deepEqual(s.errors,[]);
 console.log(JSON.stringify({repeatPixels:0,partition,relief,continuity,wide,tight,gameplayHeightChanges:0,memory:s.renderer.stats().budgetedBytes}));
}finally{s.dispose();}

// Painted rock on a level plain must acquire actual relief, not just a color.
const painted=await openScene({biome:'green',ground:true,strokes:[['paint',[[512,512]],{card:{diameter:300,amount:100,softness:30,paintChannel:1}}]]},
 'biome=green&mapX=4&mapY=4&erosion=0&undulation=0&plainRelief=0&reliefAmount=0&faceLayers=0');
try{
 const rect={x:384,y:384,width:256,height:256,options:painted.drawOptions({clay:true})};
 await knob(painted,'rockFace',0);const flat=await renderWindow(painted,rect);
 await knob(painted,'rockFace',2);const rock=await renderWindow(painted,rect),relief=different(flat,rock);
 assert.ok(relief.pixels>256*256*.05,'painted rock must shape the voxel solid on flat ground');
 assert.deepEqual(painted.errors,[]);console.log(JSON.stringify({paintedRelief:relief}));
}finally{painted.dispose();}

// Existing editor controls must reach the voxel solid and its cliff material.
// Disable the older baked detail so a working height-only brush cannot hide a
// disconnected volume control. All edits use the same scene replay as the UI.
const card={diameter:200,heightReference:2,elevation:120,combine:0,wander:0,widthVary:0,heightVary:0,cracks:0,curve:{form:'lfPlateau'},styleVegetation:0};
const land=['landform',[[512,512]],{card}];
const tools=await openScene({biome:'green',ground:false,strokes:[land]},
 'biome=green&mapX=4&mapY=4&erosion=0&reliefAmount=0&faceLayers=0&looseSupply=0&sand=0&sea=0');
try{
 const rect={x:384,y:352,width:256,height:256},clay=()=>({...rect,options:tools.drawOptions({clay:true})});
 const meaningful=(a,b,label)=>{const d=different(a,b);assert.ok(d.pixels>rect.width*rect.height*.05,`${label}: ${JSON.stringify(d)}`);return d.pixels;};
 const heights=await windowHeights(tools,{samples:64,step:8});
 await knob(tools,'rockFace',0);const smooth=await renderWindow(tools,clay());
 await knob(tools,'rockFace',2);const normal=await renderWindow(tools,clay()),art=await renderWindow(tools,rect);
 await slider(tools,'relief',0);const zero=await renderWindow(tools,clay());
 assert.deepEqual(zero,smooth,'Surface relief 0 must remove voxel displacement and wear');
 const surface=meaningful(zero,normal,'Surface relief');
 await slider(tools,'relief',.0001);const tiny=await renderWindow(tools,clay());
 assert.ok(tiny.reduce((n,v,i)=>n+Math.abs(v-zero[i]),0)/tiny.length<.1,'Surface relief must be continuous at zero');
 await slider(tools,'relief',100);
 const paint=channel=>tools.play([land,['paint',[[512,512]],{card:{diameter:600,amount:100,softness:0,roughness:0,paintChannel:channel}}]],{ground:false});
 paint(9);const weaker=await renderWindow(tools,clay());
 assert.deepEqual(weaker,smooth,'Relief weaker must remove voxel displacement and wear inside its stroke');
 paint(8);const stronger=await renderWindow(tools,clay());
 const reliefPaint=meaningful(normal,stronger,'Relief stronger');
 // The mask must also remain identical when export changes the render tiles.
 tools.play([land,['paint',[[512,512]],{card:{diameter:180,amount:100,softness:70,roughness:40,paintChannel:8}}]],{ground:false});
 const feathered=await renderWindow(tools,clay());
 assert.deepEqual(await renderWindow(tools,{...clay(),tile:128}),feathered,'feathered voxel relief must be independent of render partition');
 paint(25);const less=await renderWindow(tools,rect);
 paint(24);const more=await renderWindow(tools,rect);
 const exposureLess=meaningful(art,less,'Rock exposure less'),exposureMore=meaningful(less,more,'Rock exposure range');
 assert.deepEqual(await windowHeights(tools,{samples:64,step:8}),heights,'surface paint must preserve gameplay heights');
 // A dry cut is entirely below the plain. It still needs actual rocky banks.
 tools.play([['landform',[[512,512]],{card:{...card,elevation:-7,combine:1}}]],{ground:false});
 await knob(tools,'rockFace',0);const smoothBank=await renderWindow(tools,clay());
 await knob(tools,'rockFace',2);const rockBank=await renderWindow(tools,clay());
 const cut=meaningful(smoothBank,rockBank,'dry cut bank');
 assert.deepEqual(tools.errors,[]);
 console.log(JSON.stringify({toolPixels:{surface,reliefPaint,exposureLess,exposureMore,cut},paintPartitionChanges:0,paintGameplayHeightChanges:0}));
}finally{tools.dispose();}
