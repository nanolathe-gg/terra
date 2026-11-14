import {stepTypes,materialRenderKey,OUTPUT_KEYS} from './sculpt-material-steps.js';
import {mountMaterialSteps} from './sculpt-material-step-panel.js';
import {TEXTURE_COLORS,textureControlRequirement} from './sculpt-texture-model.js';
import {GROUND_PRESETS,GROUND_CONTROLS,copyGroundRecipe,addGround,duplicateGround,renameGround,setGround,groundRecipeText,parseGroundRecipe} from './sculpt-ground-presets.js';
import {GroundPreview} from './sculpt-ground-preview.js';
const $=id=>document.getElementById(id);
// All rows live in index.html. This controller only fills choices and values.
export function mountGroundPanel(host){
 let selected=0,previewKey='',previewContext='',resetContext=-1,shown=false;
 const dialog=$('material-editor'),noiseHelp=$('material-stage-noise').querySelector('.material-stage-help').textContent;let opener=null;
 const preview=new GroundPreview($('ground-preview'));
 const material=()=>host.grounds().find(p=>p.slot===selected);
 const recipe=material;
 const editRecipe=p=>setGround(host.grounds(),selected,p);
 const note=text=>{$('ground-presets-note').textContent=text;$('ground-presets-note').hidden=!text;};
 const fail=fn=>async()=>{try{await fn();note('');}catch(e){refresh();note(e.message);}};
 const change=grounds=>{host.edit(grounds);refresh();};
 const choose=slot=>{selected=slot;refresh();};
 const hex=value=>'#'+(Array.isArray(value)?value:host.renderer().paletteIndexed[value]).map(n=>Math.round(n).toString(16).padStart(2,'0')).join('');
 const nearest=color=>{const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));let best=0,dist=Infinity;host.renderer().paletteIndexed.forEach((c,i)=>{const d=c.reduce((sum,n,k)=>sum+(n-rgb[k])**2,0);if(d<dist){dist=d;best=i;}});return best;};
 function refreshPreview(){
  if(!shown||!dialog.open)return;const r=host.renderer();let p=material();
  const selectedStep=stepPanel.selected(),inspect=$('material-view').value==='step';
  if(inspect&&p&&selectedStep){const row=recipe(),at=row.steps.findIndex(s=>s.id===selectedStep.id);p=structuredClone(p);p.knobs.textureDither=0;p.steps=p.steps.slice(0,at+1).filter(s=>s.type!=='output');if(selectedStep.type==='output')p.steps.push({...selectedStep,target:'color'});else p.steps.push({id:'preview-output',name:'Step preview',type:'output',source:selectedStep.id,target:'color'});}
  const view={channel:inspect?8:Number($('material-view').value),height:Number($('preview-height').value),slope:Number($('preview-slope').value)};
  const key=JSON.stringify([materialRenderKey(p),r.variant.toString(),r.colorOverrides,view]);if(key===previewKey)return;previewKey=key;
  $('ground-preview-count').textContent='Rendering the material sample…';
  preview.request(r,p,(error,count)=>{
   if(error){previewKey='';$('ground-preview-count').textContent='Sample unavailable: '+error.message;return;}
   $('ground-preview-count').textContent=count.draft?'Live preview · palette dithering follows when editing stops.':`${count.distinct} distinct tiles · ${count.pool} px repeat · repeat seam at center.`;
  },view);
 }
 function refresh(){
  const grounds=host.grounds();if(!grounds.some(p=>p.slot===selected))selected=0;
  const m=material();const p=recipe(),full=grounds.length>=7;
  const context=selected+':'+Boolean(m?.worldWater);if(previewContext!==context){previewContext=context;$('preview-height').value=m?.worldWater?host.renderer().config.seaLevel-64:host.renderer().config.baseHeight;$('preview-height-value').textContent=$('preview-height').value;}
  for(const [id,role,label] of [['ground-world-default','worldGround','Original world ground'],['water-material','worldWater','Original world water']]){$(id).replaceChildren(new Option(label,'0'),...grounds.map(g=>new Option(g.name,String(g.slot))));$(id).value=String(grounds.find(g=>g[role])?.slot??0);}
  $('water-material-edit').disabled=!grounds.some(g=>g.worldWater);
  $('ground-presets').replaceChildren(new Option('World ground','0'),...grounds.map(p=>new Option(p.name,String(p.slot))));$('ground-presets').value=String(selected);
  $('ground-name').value=m?.name||'World ground';
  for(const id of ['ground-name','ground-rename','ground-delete','ground-copy']){$(id).disabled=!p;$(id).title=p?'':'Choose a starting material to edit its graph.';}
  for(const id of ['ground-add','ground-duplicate','ground-paste']){$(id).disabled=full||(id==='ground-duplicate'&&!p);$(id).title=full?'The map already has seven ground presets.':id==='ground-duplicate'&&!p?'Select a map preset to duplicate.':'';}
  $('ground-recipe-fields').disabled=!p;$('ground-recipe-fields').hidden=!p;
  $('ground-world-note').hidden=!!p;if(!p)for(const tab of tabs)tab.hidden=false;
  if(resetContext!==selected){resetContext=selected;$('material-reset-preset').value=GROUND_PRESETS[m?.presetKey]?m.presetKey:'';}
  $('material-reset-preset').disabled=!m;$('material-reset').disabled=!m||!GROUND_PRESETS[$('material-reset-preset').value];$('material-reset').title=$('material-reset').disabled?'Choose a starting preset to restore.':'Restore the selected preset. Undo can recover your edits.';
  if(p){
   const resolved=p;const surface=stepPanel.selected()?.type==='surface';
   for(const tab of tabs)tab.hidden=!surface&&['material-tab-noise','material-tab-phase','material-tab-filter','material-tab-color','material-tab-bump'].includes(tab.id);
   if(tabs.some(tab=>tab.hidden&&tab.getAttribute('aria-selected')==='true'))pick($('material-tab-step'));
   $('material-stage-noise').querySelector('.material-stage-help').textContent=noiseHelp;
   $('material-palette-note').textContent='Palette error diffusion runs after the graph’s color output.';
   for(const[key]of GROUND_CONTROLS){
    const input=$('ground-'+key),value=(OUTPUT_KEYS.includes(key)?m:resolved).knobs[key];input.value=value;$('ground-'+key+'-value').textContent=+value.toFixed(3);
    const parent=key.startsWith('plate')||['borderProfile','crackWidth','rimCurl','secondaryCracks'].includes(key)?'plateAmount':key.startsWith('bump')?'bumpAmount':key.startsWith('scratch')?'scratchAmount':key.startsWith('quiet')?'quietAmount':key.startsWith('vein')?'veinAmount':key.startsWith('pebble')?'pebbleAmount':key.startsWith('cushion')?'cushionAmount':key.startsWith('ripple')?'rippleAmount':key==='toneSize'?'toneVariation':['sharpness','roughness','roughnessScale'].includes(key)?'gloss':null;
    const noGrain=['grainStretch','grainDirection'].includes(key)&&!['grainFine','grainMedium','grainBroad'].some(k=>p.knobs[k]>0);
    const noReliefGrain=key==='grainRelief'&&!['grainFine','grainMedium','grainBroad'].some(k=>p.knobs[k]>0);
    const sameGrainColors=key==='grainColorMix'&&p.ramp.every((v,i)=>String(v)===String(p.variationRamp[i]));
    const inherited=false;input.closest('.control').hidden=false;
    const textureReason=textureControlRequirement(key,OUTPUT_KEYS.includes(key)?m.knobs:resolved.knobs),textureOff=!!textureReason;
    const off=textureOff||sameGrainColors||noReliefGrain||noGrain||(key==='grainDirection'?p.knobs.grainStretch===1:parent&&parent!==key&&p.knobs[parent]===0);
    input.disabled=!!off;const reason=$('ground-'+key+'-reason');reason.hidden=!off;reason.textContent=textureOff?textureReason:sameGrainColors?'Choose an alternate grain color different from the main ramp to mix colors.':noReliefGrain?'Raise Fine grain, Medium grain, or Broad grain above 0 to shape grain relief.':noGrain?'Raise a grain amount above 0 to use this setting.':key==='grainDirection'&&off?'Raise Grain stretch above 1 to choose a direction.':off?'Raise '+$('ground-'+parent).closest('.control').querySelector('label').firstChild.textContent.trim()+' above 0 to use this setting.':'';
   }
   for(const key of Object.keys(TEXTURE_COLORS)){const scale=['fineLow','fineHigh','markTint'].includes(key)?127.5:1;const el=$('texture-color-'+key);el.value=hex(resolved.textureColors[key].map(v=>v*scale));el.disabled=false;el.closest('.color-row').hidden=el.disabled;el.title='';}
   $('texture-palette').value=m.texturePalette.map(hex).join(' ');
   resolved.ramp.forEach((entry,i)=>{$('ground-ramp-'+i).value=hex(entry);$('ground-ramp-'+i).title=`Tone ${i+1}: RGB ${entry}`;});
   resolved.variationRamp.forEach((entry,i)=>{$('ground-variation-'+i).value=hex(entry);$('ground-variation-'+i).title=`Alternate tone ${i+1}: RGB ${entry}`;});$('ground-line').value=hex(resolved.line);for(const id of ['ground-line',...Array.from({length:16},(_,i)=>'ground-ramp-'+i),...Array.from({length:16},(_,i)=>'ground-variation-'+i)]){$(id).disabled=false;}
  }
  stepPanel.refresh();const type=p?stepTypes(p.steps).get(stepPanel.selected()?.id):null;$('material-view-step').disabled=!p||['position','surface'].includes(type);$('material-view-step').title=$('material-view-step').disabled?'Select a grayscale or color step.':'';if($('material-view').value==='step'&&$('material-view-step').disabled)$('material-view').value='0';refreshPreview();
 }
 const commit=()=>host.checkpoint();
 for(const [id,role]of [['ground-world-default','worldGround'],['water-material','worldWater']])$(id).onchange=fail(()=>{const slot=Number($(id).value);change(host.grounds().map(p=>({...p,[role]:p.slot===slot})));commit();});
 function open(slot,from){opener=from;if(slot!==undefined&&slot!==selected){selected=slot;}else if(!recipe())selected=host.grounds()[0]?.slot??0;refresh();pick($('material-tab-step'));if(!dialog.open){host.suspend(true);dialog.showModal();}shown=true;refreshPreview();}
 const close=()=>{dialog.close();shown=false;previewKey='';preview.cancel();host.suspend(false);opener?.focus();};
 $('material-open').onclick=()=>open(undefined,$('material-open'));
 $('materials-toolbar').onclick=()=>open(undefined,$('materials-toolbar'));
 $('water-material-edit').onclick=()=>open(Number($('water-material').value),$('water-material-edit'));
 $('material-done').onclick=close;
 dialog.oncancel=e=>{e.preventDefault();close();};
 // Modal shortcuts cannot leak through to terrain selection or tool shortcuts.
 dialog.onkeydown=e=>{if(e.defaultPrevented)return;if(e.key==='Escape'){e.preventDefault();close();}
  else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&!e.target.matches('input,textarea')){e.preventDefault();$(e.shiftKey?'redo':'undo').click();}
  e.stopPropagation();};
 $('material-undo').onclick=()=>$('undo').click();$('material-redo').onclick=()=>$('redo').click();
 const lock=()=>{$('materials-toolbar').disabled=$('editor').disabled;$('material-editor-fields').disabled=$('editor').disabled;$('material-undo').disabled=$('undo').disabled;$('material-redo').disabled=$('redo').disabled;};
 const locks=new MutationObserver(lock);for(const id of ['editor','undo','redo'])locks.observe($(id),{attributes:true,attributeFilter:['disabled']});lock();
 const tabs=[...dialog.querySelectorAll('[role="tab"]')];
 const stepPanel=mountMaterialSteps({recipe,context:()=>selected,edit:p=>{change(editRecipe(p));},commit,show:()=>{refresh();pick($('material-tab-step'));},note});
 const pick=tab=>{for(const t of tabs){const on=t===tab;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;$(t.getAttribute('aria-controls')).hidden=!on;}};
 for(const t of tabs){t.onclick=()=>pick(t);t.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const available=tabs.filter(tab=>!tab.hidden),i=available.indexOf(t),next=e.key==='Home'?available[0]:e.key==='End'?available.at(-1):available[(i+(e.key==='ArrowRight'?1:available.length-1))%available.length];pick(next);next.focus();};}
 for(const key of Object.keys(TEXTURE_COLORS)){$('texture-color-'+key).oninput=fail(()=>{const p=copyGroundRecipe(recipe()),scale=['fineLow','fineHigh','markTint'].includes(key)?127.5:1;p.textureColors[key]=[1,3,5].map(i=>parseInt($('texture-color-'+key).value.slice(i,i+2),16)/scale);change(editRecipe(p));});$('texture-color-'+key).onchange=commit;}
 $('texture-palette').onchange=fail(()=>{const colors=$('texture-palette').value.trim().split(/[\s,]+/).filter(Boolean);if(colors.some(c=>!/^#[0-9a-f]{6}$/i.test(c)))throw Error('Use hex colors such as #4263a0.');const p=copyGroundRecipe(material());p.texturePalette=colors.map(nearest);change(setGround(host.grounds(),selected,p));commit();});
 $('ground-presets').onchange=()=>choose(Number($('ground-presets').value));
 $('ground-add').onchange=fail(()=>{const key=$('ground-add').value;$('ground-add').value='';if(!key)return;const p=GROUND_PRESETS[key],added=addGround(host.grounds(),p,p.name);selected=added.slot;change(added.grounds);commit();});
 $('ground-duplicate').onclick=fail(()=>{const added=duplicateGround(host.grounds(),selected);selected=added.slot;change(added.grounds);commit();});
 $('ground-rename').onclick=fail(()=>{change(renameGround(host.grounds(),selected,$('ground-name').value));commit();});
 $('ground-name').onkeydown=e=>{if(e.key==='Enter')$('ground-rename').click();};
 $('ground-delete').onclick=fail(()=>{host.delete(selected);selected=0;refresh();});
 $('ground-copy').onclick=fail(async()=>{await navigator.clipboard.writeText(groundRecipeText(material()));host.status('Copied the ground recipe.');});
 $('ground-paste').onclick=fail(async()=>{const p=parseGroundRecipe(await navigator.clipboard.readText()),added=addGround(host.grounds(),p,p.name);selected=added.slot;change(added.grounds);commit();});
 for(const[key]of GROUND_CONTROLS){
  const input=$('ground-'+key);input.oninput=fail(()=>{const p=recipe();if(!p)return;if(OUTPUT_KEYS.includes(key)){const m=material();change(setGround(host.grounds(),selected,{...m,knobs:{...m.knobs,[key]:Number(input.value)}}));}
   else change(editRecipe({...p,knobs:{...p.knobs,[key]:Number(input.value)}}));});input.onchange=commit;
 }
 for(let i=0;i<33;i++){
  const input=$(i===32?'ground-line':i>=16?'ground-variation-'+(i-16):'ground-ramp-'+i);
  input.oninput=fail(()=>{const p=copyGroundRecipe(recipe()),rgb=[1,3,5].map(j=>parseInt(input.value.slice(j,j+2),16));if(i===32)p.line=rgb;else if(i>=16)p.variationRamp[i-16]=rgb;else p.ramp[i]=rgb;change(editRecipe(p));});input.onchange=commit;
 }

 $('material-reset-preset').onchange=()=>refresh();
 $('material-reset').onclick=fail(()=>{const preset=GROUND_PRESETS[$('material-reset-preset').value];if(!preset||!material())return;change(setGround(host.grounds(),selected,preset));commit();});
 $('material-view').onchange=()=>refreshPreview();
 for(const key of ['height','slope']){$('preview-'+key).oninput=()=>{$('preview-'+key+'-value').textContent=$('preview-'+key).value;refreshPreview();};$('preview-'+key+'-value').textContent=$('preview-'+key).value;}

 const observer=new IntersectionObserver(entries=>{shown=entries[0].isIntersecting;if(shown)refreshPreview();});observer.observe($('ground-preview'));
 if(dialog.open){shown=true;host.suspend(true);}
 refresh();return {refresh,refreshPreview,dispose(){if(!dialog.open)host.suspend(false);observer.disconnect();locks.disconnect();stepPanel.dispose();preview.dispose();}};
}
