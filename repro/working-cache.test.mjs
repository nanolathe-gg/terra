import test from 'node:test';
import assert from 'node:assert/strict';
import {ChunkTerrainRenderer} from '../sculpt-chunk-renderer.js';
test('working-cache eviction keeps active inputs and releases cached resources once',()=>{
 const r=Object.create(ChunkTerrainRenderer.prototype),make=()=>({destroyed:0,destroy(){this.destroyed++;}}),a=make(),b=make(),field=make(),color=make(),rock=make(),shared=make();
 r.colorTiles=new Set();r.colorTargets=new Map();
 r.resources=new Map([[a,20],[b,30],[field,10],[color,10],[rock,10]].map(([t,bytes])=>[t,{bytes,kind:'working'}]));r.resources.set(shared,{bytes:5,kind:'shared'});
 const input={textures:[a],used:2},idle={textures:[b],used:1},level={fieldsTexture:field,voxelColor:color,rock:{owned:[rock],final:rock,source:null,rim:null,key:'x'},used:3};
 r.inputSets=new Map([['active',input],['idle',idle]]);r.levelSets=new Map([[1,level]]);r.activeInput=input;r.activeLevel=level;r.fieldsTexture=field;r.voxelColor=color;
 r.rockWeather={...level.rock,clear(){for(const t of this.owned)r.release(t);this.owned=[];}};r.voxel={clear(){},dropPool(){},release(){}};r.bindGroups={};r.canvas={width:1,height:1};r.outputBytes=0;r.reservedBytes=0;r.budgetBytes=70;r.evictions=0;
 assert(r.makeWorkingRoom(10));assert.equal(b.destroyed,1);assert.equal(a.destroyed+field.destroyed+color.destroyed+rock.destroyed,0);assert.equal(r.inputSets.size,1);
 r.evict();for(const t of [a,b,field,color,rock])assert.equal(t.destroyed,1);assert.equal(shared.destroyed,0);assert.equal(r.inputSets.size+r.levelSets.size,0);
});
