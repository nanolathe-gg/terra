import {createTiledWeather,tiledWeatherEnabled} from './sculpt-tiled-weather.js';
const MB=1048576;
const union=(a,b)=>!a||!b?null:{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.max(a.x+a.width,b.x+b.width)-Math.min(a.x,b.x),height:Math.max(a.y+a.height,b.y+b.height)-Math.min(a.y,b.y)};
// The old global worker remains the owner of small maps. Large-map weather is
// lazy, but publication is awaited by both art export and TNT corner sampling.
export function mountMapWeather({api,config,params,enabled,active,forceTiled=false,onReady,onProgress}) {
  const size=config.worldSize??config.size,grid=config.worldGrid??config.grid,spacing=(size-1)/(grid-1),eligible=tiledWeatherEnabled(grid,forceTiled);
  let solver=null,key='',budget=256*MB,dirty=null,hasDirty=false;
  const originalRead=api.read,originalStats=api.stats,originalBuffers=api.residentBuffers,originalBudget=api.setBudget,originalEvict=api.evict;
  const usesTiles=()=>eligible&&enabled();
  function expandDirty(rect){if(!rect||!usesTiles())return rect;const pad=512*spacing,x=Math.max(0,rect.x-pad),y=Math.max(0,rect.y-pad);return{x,y,width:Math.min(size,rect.x+rect.width+pad)-x,height:Math.min(size,rect.y+rect.height+pad)-y};}
  function queue(){
    if(!usesTiles()){if(solver){solver.dispose();solver=null;key='';}return false;}
    if(active())return true;
    const next=params(),encoded=JSON.stringify(next),changed=key!==encoded;
    if(!solver){solver=createTiledWeather({read:api.readAuthored,readUniform:api.uniformAuthored,worldSize:size,worldGrid:grid,params:next,budget,forceTiled,onProgress,onReserve:()=>api.checkMemory?.()});}
    else if(changed)solver.invalidate(null,next);
    key=encoded;onReady(changed?null:hasDirty?expandDirty(dirty):null);dirty=null;hasDirty=false;return true;
  }
  const unsubscribe=api.subscribe(change=>{const rect=change?.rect??null;dirty=hasDirty?union(dirty,rect):rect;hasDirty=true;solver?.invalidate(rect);});
  api.readAsync=async(request,signal)=>{
    if(!usesTiles()||active())return originalRead(request);
    if(!solver)queue();return solver.read(request,signal);
  };
  api.expandDirty=expandDirty;
  api.evict=()=>{originalEvict?.();solver?.evict();};
  api.stats=()=>{const base=originalStats(),weather=solver?.stats();return{...base,tiledWeather:weather,residentBytes:base.residentBytes+(weather?.residentBytes??0),peakBytes:base.peakBytes+(weather?.peakBytes??0)};};
  api.residentBuffers=()=>{const buffers=new Set(originalBuffers?.()||[]);for(const buffer of solver?.buffers?.()||[])buffers.add(buffer);return[...buffers];};
  api.workingBytes=()=>solver?.stats().inflightBytes??0;
  api.setBudget=bytes=>{originalBudget(eligible?bytes*.6:bytes);budget=bytes*.4;solver?.setBudget(budget);};
  const cancel=()=>{if(solver)solver.cancel();};
  function dispose(){unsubscribe();solver?.dispose();solver=null;}
  window.addEventListener('pagehide',dispose,{once:true});
  return{queue,cancel,dispose,usesTiles,sample:(x,y)=>usesTiles()&&!active()?solver?.sampleCached(x,y)??null:null,stats:()=>solver?.stats()};
}
