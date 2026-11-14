import {mountMaterialGraph} from './sculpt-material-graph.js';
import {STEP_TYPES,STEP_LABELS,stepParams,NOISE_TYPES,COMBINES,OUTPUTS,MAX_STEPS,orderSteps,makeStep,stepTypes} from './sculpt-material-steps.js';
const $=id=>document.getElementById(id);
export function mountMaterialSteps(host){
 let selectedId=null;
 const graphHelp='Drag nodes to move; drag empty space to pan. Connect output to input. Click an input to disconnect; scroll to zoom.';
 const selected=()=>host.recipe()?.steps.find(s=>s.id===selectedId)??host.recipe()?.steps[0];
 const fail=fn=>()=>{try{fn();host.note('');$('graph-help').textContent=graphHelp;}catch(e){host.note(e.message);document.getElementById('graph-help').textContent=e.message;refresh();}};
 const edit=fn=>{const recipe=structuredClone(host.recipe());if(!recipe)return;fn(recipe.steps);recipe.steps=orderSteps(recipe.steps);host.edit(recipe);};
 const change=fn=>{edit(fn);host.commit();};
 const mutate=fn=>edit(steps=>fn(steps.find(s=>s.id===selected().id)));
 const options=(id,list,value)=>{const el=$(id);el.replaceChildren(...list.map(([v,label])=>new Option(label,v)));el.value=value??'';};
 options('step-add',[['','＋ Add node'],...STEP_TYPES.filter(k=>!['surface','channel'].includes(k)).map(k=>[k,STEP_LABELS[k]])],'');
 options('step-kind',Object.entries(NOISE_TYPES),'fractal');
 options('step-operation',COMBINES.map(k=>[k,k[0].toUpperCase()+k.slice(1)]),'blend');options('step-target',OUTPUTS.map(k=>[k,k[0].toUpperCase()+k.slice(1)]),'color');options('step-stops',[[2,'Two colors'],[3,'Three colors'],[16,'Sixteen colors']],2);
 function refresh(){
  const recipe=host.recipe(),steps=recipe?.steps??[],s=selected(),at=steps.indexOf(s);selectedId=s?.id??null;
  $('step-delete').disabled=!s;$('step-add').disabled=steps.length>=MAX_STEPS||!recipe;$('step-duplicate').disabled=!s||steps.length>=MAX_STEPS||s.type==='output';$('step-duplicate').title=s?.type==='output'?'Each channel has one output. Add another output channel instead.':'';graph.refresh();
  if(!s)return;
  $('step-name').value=s.name;$('step-enabled').checked=s.enabled;
  const help={transform:'Distort the coordinates used by a noise generator. Connect this step as that generator’s source.',noise:'Generate a grayscale field. Color and height can use this same field independently.',dots:'Generate a grayscale spot mask. Combine and color it using ordinary steps.',surface:'Edit these procedural surface primitives in the Pattern, Distortion, Filter, and Bump tabs. Extract components to reuse their height or pigment.',constant:'Provide a uniform grayscale value.',remap:'Reshape a grayscale field before mapping it to color or height.',combine:'Combine grayscale or color values. A grayscale input can scale or mask a color input.',gradient:'Map grayscale to color. Brightness above 1 supports lightening multipliers.',channel:'Extract one component as a grayscale field.',output:'Connect a field to a material channel. Lighting uses the combined height; palette treatment follows color composition.'};
  $('step-help').textContent=help[s.type]+(!s.enabled?' This node is disabled. Operations pass their source through; generators produce zero.':'');
  const types=stepTypes(steps),prior=steps.filter(p=>p.id!==s.id).filter(p=>p.type!=='output');
  for(const key of ['source','other','mask']){
   const shown=key==='source'?!['constant','surface'].includes(s.type)&&!(s.type==='noise'&&s.kind==='pixel'):s.type==='combine';$('step-'+key+'-row').hidden=!shown;
   const allowed=prior.filter(p=>{const t=types.get(p.id);if(key==='mask'||s.type==='dots'||['gradient','remap'].includes(s.type))return t==='scalar';if(['transform','noise'].includes(s.type))return t==='position';if(s.type==='channel')return t==='surface'||t==='color';if(s.type==='output'&&s.target!=='color')return t==='scalar';return t==='scalar'||t==='color';});
   const blank=key==='mask'?'No mask (1)':key==='source'&&['transform','noise'].includes(s.type)?'World coordinates':'Zero';options('step-'+key,[['',blank+' · disconnected'],...allowed.map(p=>[p.id,p.name])],s[key]);$('step-'+key+'-disconnect').disabled=!s[key];
  }
  $('step-operation-row').hidden=s.type!=='combine';$('step-operation').value=s.operation??'blend';$('step-target-row').hidden=s.type!=='output';$('step-target').value=s.target??'color';for(const option of $('step-target').options)option.disabled=steps.some(n=>n.id!==s.id&&n.type==='output'&&n.enabled&&n.target===option.value);$('step-stops-row').hidden=s.type!=='gradient';$('step-stops').value=s.colors?.length??2;
  $('step-kind-row').hidden=s.type!=='noise';$('step-kind').value=s.kind??'fractal';
  const params=stepParams(s);for(let i=0;i<16;i++){const row=$('step-param-row-'+i),spec=params[i];row.hidden=!spec;if(!spec)continue;const [key,label,min,max]=spec,input=$('step-param-'+i);$('step-param-label-'+i).textContent=label;input.min=min;input.max=max;input.step=key==='channel'?'1':'0.001';input.value=s.params[key];$('step-param-value-'+i).textContent=+s.params[key].toFixed(4);}
  $('step-colors').hidden=s.type!=='gradient';for(let i=0;i<16;i++){const c=s.colors?.[i];$('step-color-row-'+i).hidden=!c;if(!c)continue;const gain=Math.max(1,...c);$('step-color-'+i).value='#'+c.map(v=>Math.round(v/gain*255).toString(16).padStart(2,'0')).join('');$('step-color-gain-'+i).value=gain;}
 }
 $('step-kind').onchange=fail(()=>{mutate(s=>{s.kind=$('step-kind').value;if(s.kind==='pixel')s.source=null;});host.commit();});
 for(const key of ['source','other','mask'])$('step-'+key+'-disconnect').onclick=fail(()=>{mutate(s=>{s[key]=null;});host.commit();});
 $('step-name').onchange=fail(()=>{mutate(s=>{s.name=$('step-name').value;});host.commit();});
 for(const key of ['source','other','mask','operation','target'])$('step-'+key).onchange=fail(()=>{mutate(s=>{s[key]=$('step-'+key).value||null;});host.commit();});
 for(let i=0;i<16;i++){$('step-param-'+i).oninput=fail(()=>mutate(s=>{s.params[stepParams(s)[i][0]]=Number($('step-param-'+i).value);}));$('step-param-'+i).onchange=()=>host.commit();
  const color=fail(()=>{mutate(s=>{const hex=$('step-color-'+i).value,gain=Number($('step-color-gain-'+i).value);s.colors[i]=[1,3,5].map(j=>parseInt(hex.slice(j,j+2),16)/255*gain);});});$('step-color-'+i).oninput=color;$('step-color-gain-'+i).oninput=color;for(const id of ['step-color-','step-color-gain-'])$(id+i).onchange=()=>host.commit();
 }
 $('step-stops').onchange=fail(()=>{mutate(s=>{const old=s.colors,n=Number($('step-stops').value);s.colors=Array.from({length:n},(_,i)=>{const t=i/(n-1)*(old.length-1),a=Math.floor(t),b=Math.min(old.length-1,a+1);return old[a].map((v,j)=>v+(old[b][j]-v)*(t-a));});});host.commit();});
 const remove=fail(()=>change(steps=>{if(!selected())return;const id=selected().id;const at=steps.findIndex(s=>s.id===id);steps.splice(at,1);for(const s of steps)for(const key of ['source','other','mask'])if(s[key]===id)s[key]=null;if(!steps.length)steps.push(makeStep('constant'));selectedId=steps[Math.max(0,at-1)]?.id;}));
 $('step-delete').onclick=remove;
 $('step-enabled').onchange=fail(()=>{mutate(s=>{s.enabled=$('step-enabled').checked;});host.commit();});
 $('step-duplicate').onclick=fail(()=>change(steps=>{const old=steps.find(s=>s.id===selectedId),copy=structuredClone(old);copy.id=makeStep(old.type,steps).id;copy.name=(copy.name+' copy').slice(0,80);steps.splice(steps.indexOf(old)+1,0,copy);selectedId=copy.id;}));
 $('step-add').onchange=fail(()=>{const type=$('step-add').value;$('step-add').value='';if(!type)return;change(steps=>{const step=makeStep(type,steps);steps.push(step);selectedId=step.id;});host.show();});
 const graph=mountMaterialGraph({recipe:host.recipe,context:host.context,selected,choose:id=>{selectedId=id;host.show();},
  connect:failConnect,move:failMove,remove,
  toggle:id=>fail(()=>change(steps=>{const s=steps.find(s=>s.id===id);s.enabled=!s.enabled;}))(),
  arrange:positions=>fail(()=>change(steps=>{for(const s of steps)s.position=positions.get(s.id);}))(),
 });
 function failConnect(source,target,key){fail(()=>change(steps=>{steps.find(s=>s.id===target)[key]=source;}))();}
 function failMove(id,position){fail(()=>change(steps=>{steps.find(s=>s.id===id).position=position;}))();}
 return {refresh,selected,dispose:()=>graph.dispose()};
}
