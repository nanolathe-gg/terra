// The page has no free-memory counter. Choose a cautious budget from an
// optional device signal, the artist's explicit choice, and prior failures.
// The automatic budget stays at most 2048 MiB; the larger notches are an
// artist's explicit choice for a card with room (and the steps a failure at
// one of them comes down by).
export const TERRAIN_BUDGETS=[8192,6144,4096,3072,2048,1536,1024,768,512];
export const TERRAIN_BUDGET_MAX=16384;
export const lowerTerrainBudget=mb=>TERRAIN_BUDGETS.find(n=>n<mb)??null;
const valid=mb=>Number.isFinite(mb)&&mb>=128&&mb<=TERRAIN_BUDGET_MAX;
// The device memory to plan for, in GB: what the browser reports (navigator.deviceMemory: Chrome and Edge, rounded; Chrome 157 on an 18 GB Mac says
// 16), else a guess, since Safari and Firefox report none: an iPhone or iPad (iPadOS Safari presents itself as a Mac with a touch screen) is taken as
// 4 GB, anything else as 8. guessed says which. [The iPad branch is untested on a device.]
export function deviceMemory(nav=globalThis.navigator){
  const reported=nav?.deviceMemory;if(Number.isFinite(reported)&&reported>0)return {gb:reported,guessed:false};
  const ua=String(nav?.userAgent||''),touchApple=/iPhone|iPad|iPod/.test(ua)||/Macintosh/.test(ua)&&nav?.maxTouchPoints>1;
  return {gb:touchApple?4:8,guessed:true};
}
export function createTerrainBudget({explicit,deviceMemory,memoryGuessed=false,preference,save=()=>{}}={}){
  const automatic=Number.isFinite(deviceMemory)&&deviceMemory<=4?1024:2048;
  let mb=valid(explicit)?explicit:Math.min(automatic,TERRAIN_BUDGETS.includes(preference?.mb)?preference.mb:automatic),reason='';
  let choice=valid(explicit)?explicit:null,failedChoice=preference?.failedChoice??null;
  if(choice!==null&&choice===failedChoice&&TERRAIN_BUDGETS.includes(preference?.mb)){mb=Math.min(mb,preference.mb);reason=preference.reason||'remembered allocation failure';}
  const previous=preference?.trying;
  if(valid(previous)&&(!valid(explicit)||explicit===previous)){
    mb=Math.min(mb,lowerTerrainBudget(previous)??512);reason=preference?.mb<previous&&preference.reason?preference.reason:'lowered after an interrupted memory trial';
  }else if(!valid(explicit)&&mb<2048)reason=mb<automatic?(preference?.reason||'remembered memory budget'):memoryGuessed?'touch device without a memory signal':'smaller device memory signal';
  let trying=false,restarting=false,remembered=TERRAIN_BUDGETS.includes(preference?.mb)?preference.mb:automatic;
  const write=()=>save({mb:remembered,trying:trying?mb:null,reason,failedChoice});
  return {
    get mb(){return mb;},get reason(){return reason;},
    begin(){if(trying)return;trying=true;write();},
    // A reload or a closed tab ends the trial without a verdict. Only a page that died without
    // this event (a crash, or the browser discarding it) leaves the note that starts the next load lower.
    leave(){if(!trying||restarting)return;trying=false;write();},
    settled(){if(!trying)return;trying=false;remembered=Math.min(2048,Math.max(512,mb));write();},
    choose(value){if(!valid(value))throw Error('Invalid terrain memory budget.');mb=value;choice=value;failedChoice=null;reason='';trying=false;this.begin();},
    lower(why){const next=lowerTerrainBudget(mb);if(next===null)return false;failedChoice=choice;mb=next;reason='lowered after '+why;remembered=next;trying=true;write();return true;},
    restart(why){const failed=mb;if(!this.lower(why))return false;restarting=true;save({mb:remembered,trying:failed,reason,failedChoice});return true;},
  };
}
export class TerrainMemoryError extends Error {
  constructor(message='The terrain working set could not be allocated.'){super(message);this.name='TerrainMemoryError';}
}
// Close the device's scope before yielding: another async task cannot pop our
// scope or attribute its allocations to this request. Creation must be sync.
export async function terrainAllocation(device,create){
  if(!device.pushErrorScope||!device.popErrorScope)return create();
  device.pushErrorScope('out-of-memory');let result,caught;
  try{result=create();}catch(error){caught=error;}
  const pending=device.popErrorScope(),error=await pending;
  if(error)throw new TerrainMemoryError(error.message);
  if(caught)throw caught;return result;
}
