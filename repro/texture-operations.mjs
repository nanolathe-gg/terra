// Small GPU impact check for the new noise, phase, and filter controls.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openHost,openScene,renderWindow} from './headless.mjs';
import {GROUND_PRESETS,addGround} from '../sculpt-ground-presets.js';
import {encodePng} from './png.mjs';
await openHost();
const out='/private/tmp/texture-operations';mkdirSync(out,{recursive:true});
const grounds=addGround([],GROUND_PRESETS['rust-mottling'],'Noise study').grounds;
grounds[0].worldGround=true;grounds[0].knobs.textureDither=0;grounds[0].knobs.patternWarp=4;
const s=await openScene({biome:'red',ground:false,grounds,strokes:[]},'biome=red&mapX=2&mapY=2&palette=off');
const rect={x:256,y:256,width:128,height:128},report={};
try{
 const baseline=await renderWindow(s,rect);writeFileSync(out+'/baseline.png',encodePng(128,128,baseline));
 const cases={patternOctaves:3,patternLinear:1,phaseOctaves:3,phaseAxis:1,patternInvert:1,patternClip:1,patternSine:1,patternSineFrequency:3};
 for(const [key,value] of Object.entries(cases)){
  const recipe=structuredClone(grounds);let before=baseline;
  if(key==='patternSineFrequency'){recipe[0].knobs.patternSine=1;s.setGrounds(recipe);before=await renderWindow(s,rect);}
  recipe[0].knobs[key]=value;s.setGrounds(recipe);const after=await renderWindow(s,rect);
  let changed=0;for(let i=0;i<after.length;i+=4)if(Math.max(...[0,1,2].map(c=>Math.abs(after[i+c]-before[i+c])))>=3)changed++;
  const fraction=changed/(128*128);assert.ok(fraction>=.05,`${key}: visible change in at least 5% of pixels`);report[key]=Number((fraction*100).toFixed(1));
  writeFileSync(out+'/'+key+'.png',encodePng(128,128,after));
 }
 s.setGrounds(grounds);assert.deepEqual(await renderWindow(s,rect),baseline,'neutral controls restore the original recipe');assert.deepEqual(s.errors,[]);
 writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({changedPixelPercent:report,gpuErrors:s.errors}));
}finally{s.dispose();}process.exit(0);
