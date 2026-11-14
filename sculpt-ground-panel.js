import {GROUND_PRESETS,GROUND_CONTROLS,copyGroundRecipe,addGround,duplicateGround,renameGround,setGround,groundRecipeText,parseGroundRecipe} from './sculpt-ground-presets.js';
import {GroundPreview} from './sculpt-ground-preview.js';
const $=id=>document.getElementById(id);
// All rows live in sculpt.html. This controller only fills choices and values.
export function mountGroundPanel(host){
 let selected=0,previewKey='',shown=false;
 const preview=new GroundPreview($('ground-preview'));
 const recipe=()=>host.grounds().find(p=>p.slot===selected);
 const note=text=>{$('ground-presets-note').textContent=text;$('ground-presets-note').hidden=!text;};
 const fail=fn=>async()=>{try{await fn();note('');}catch(e){note(e.message);}};
 const change=grounds=>{host.edit(grounds);refresh();};
 const choose=slot=>{selected=slot;refresh();};
 const hex=index=>'#'+host.renderer().paletteIndexed[index].map(n=>Math.round(n).toString(16).padStart(2,'0')).join('');
 const nearest=color=>{const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));let best=0,dist=Infinity;host.renderer().paletteIndexed.forEach((c,i)=>{const d=c.reduce((sum,n,k)=>sum+(n-rgb[k])**2,0);if(d<dist){dist=d;best=i;}});return best;};
 function refreshPreview(){
  if(!shown)return;const r=host.renderer(),p=recipe();
  const neighbor=host.grounds().find(q=>q.slot!==selected);
  const key=JSON.stringify([p,neighbor,r.variant.toString(),r.colorOverrides]);if(key===previewKey)return;previewKey=key;
  $('ground-preview-count').textContent='Rendering the ground sample…';
  preview.request(r,p,neighbor,(error,count)=>{
   if(error){previewKey='';$('ground-preview-count').textContent='Sample unavailable: '+error.message;return;}
   $('ground-preview-count').textContent=`${count.distinct} distinct tiles in this 64-tile sample · ${count.pool} px repeat · at most ${count.perLevel.toLocaleString()} tiles per flat height across the full repeat. The repeat seam crosses the center.${count.edgeTiles?` A separate contact sample with ${count.neighbor} has ${count.edgeDistinct} distinct edge tiles in ${count.edgeTiles} slots.`:''}`;
  });
 }
 function refresh(){
  const grounds=host.grounds();if(!grounds.some(p=>p.slot===selected))selected=0;
  const p=recipe(),full=grounds.length>=7;
  $('ground-presets').replaceChildren(new Option('World ground','0'),...grounds.map(p=>new Option(p.name,String(p.slot))));$('ground-presets').value=String(selected);
  $('ground-name').value=p?.name||'World ground';
  for(const id of ['ground-name','ground-rename','ground-delete','ground-copy']){$(id).disabled=!p;$(id).title=p?'':'Select a map preset first. World ground uses the Pattern controls below.';}
  for(const id of ['ground-add','ground-duplicate','ground-paste']){$(id).disabled=full||(id==='ground-duplicate'&&!p);$(id).title=full?'The map already has seven ground presets.':id==='ground-duplicate'&&!p?'Select a map preset to duplicate.':'';}
  $('ground-recipe-fields').disabled=!p;$('ground-recipe-fields').hidden=!p;
  $('ground-world-note').hidden=!!p;
  if(p){
   for(const[key]of GROUND_CONTROLS){
    const input=$('ground-'+key);input.value=p.knobs[key];$('ground-'+key+'-value').textContent=+p.knobs[key].toFixed(3);
    const parent=key.startsWith('plate')||['borderProfile','crackWidth','rimCurl','secondaryCracks'].includes(key)?'plateAmount':key.startsWith('bump')?'bumpAmount':key.startsWith('scratch')?'scratchAmount':key.startsWith('quiet')?'quietAmount':key.startsWith('vein')?'veinAmount':key.startsWith('pebble')?'pebbleAmount':key.startsWith('cushion')?'cushionAmount':key.startsWith('ripple')?'rippleAmount':key==='toneSize'?'toneVariation':['sharpness','roughness','roughnessScale'].includes(key)?'gloss':null;
    const noGrain=['grainStretch','grainDirection'].includes(key)&&!['grainFine','grainMedium','grainBroad'].some(k=>p.knobs[k]>0);
    const noReliefGrain=key==='grainRelief'&&!['grainFine','grainMedium','grainBroad'].some(k=>p.knobs[k]>0);
    const sameGrainColors=key==='grainColorMix'&&p.ramp.every((v,i)=>v===p.variationRamp[i]);
    const off=sameGrainColors||noReliefGrain||noGrain||(key==='grainDirection'?p.knobs.grainStretch===1:parent&&parent!==key&&p.knobs[parent]===0);
    input.disabled=!!off;const reason=$('ground-'+key+'-reason');reason.hidden=!off;reason.textContent=sameGrainColors?'Choose an alternate grain color different from the main ramp to mix colors.':noReliefGrain?'Raise Fine grain, Medium grain, or Broad grain above 0 to shape grain relief.':noGrain?'Raise a grain amount above 0 to use this setting.':key==='grainDirection'&&off?'Raise Grain stretch above 1 to choose a direction.':off?'Raise '+$('ground-'+parent).previousElementSibling.firstChild.textContent.trim()+' above 0 to use this setting.':'';
   }
   p.ramp.forEach((entry,i)=>{$('ground-ramp-'+i).value=hex(entry);$('ground-ramp-'+i).title=`Tone ${i+1}: palette entry ${entry}`;});
   p.variationRamp.forEach((entry,i)=>{$('ground-variation-'+i).value=hex(entry);$('ground-variation-'+i).title=`Alternate tone ${i+1}: palette entry ${entry}`;});$('ground-line').value=hex(p.line);
  }
  refreshPreview();
 }
 const commit=()=>host.checkpoint();
 $('ground-presets').onchange=()=>choose(Number($('ground-presets').value));
 $('ground-add').onchange=fail(()=>{const key=$('ground-add').value;$('ground-add').value='';if(!key)return;const p=GROUND_PRESETS[key],added=addGround(host.grounds(),p,p.name);selected=added.slot;change(added.grounds);commit();});
 $('ground-duplicate').onclick=fail(()=>{const added=duplicateGround(host.grounds(),selected);selected=added.slot;change(added.grounds);commit();});
 $('ground-rename').onclick=fail(()=>{change(renameGround(host.grounds(),selected,$('ground-name').value));commit();});
 $('ground-name').onkeydown=e=>{if(e.key==='Enter')$('ground-rename').click();};
 $('ground-delete').onclick=fail(()=>{host.delete(selected);selected=0;refresh();});
 $('ground-copy').onclick=fail(async()=>{await navigator.clipboard.writeText(groundRecipeText(recipe()));host.status('Copied the ground recipe.');});
 $('ground-paste').onclick=fail(async()=>{const p=parseGroundRecipe(await navigator.clipboard.readText()),added=addGround(host.grounds(),p,p.name);selected=added.slot;change(added.grounds);commit();});
 for(const[key]of GROUND_CONTROLS){
  const input=$('ground-'+key);input.oninput=fail(()=>{const p=recipe();if(!p)return;change(setGround(host.grounds(),selected,{...p,knobs:{...p.knobs,[key]:Number(input.value)}}));});input.onchange=commit;
 }
 for(let i=0;i<33;i++){
  const input=$(i===32?'ground-line':i>=16?'ground-variation-'+(i-16):'ground-ramp-'+i);
  input.oninput=fail(()=>{const p=copyGroundRecipe(recipe()),index=nearest(input.value);if(i===32)p.line=index;else if(i>=16)p.variationRamp[i-16]=index;else p.ramp[i]=index;change(setGround(host.grounds(),selected,p));});input.onchange=commit;
 }
 const observer=new IntersectionObserver(entries=>{shown=entries[0].isIntersecting;if(shown)refreshPreview();});observer.observe($('ground-preview'));
 refresh();return {refresh,refreshPreview,dispose(){observer.disconnect();preview.dispose();}};
}
