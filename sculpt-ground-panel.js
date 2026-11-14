import {materialLayers,resolveMaterialLayers,adjustmentOwns,replaceMaterialLayers,copyLayerSettings,LAYER_CONTROLS,OUTPUT_KEYS,patternSettings} from './sculpt-material-layers.js';
import {TEXTURE_COLORS,textureControlRequirement} from './sculpt-texture-model.js';
import {GROUND_PRESETS,GROUND_CONTROLS,copyGroundRecipe,addGround,duplicateGround,renameGround,setGround,groundRecipeText,parseGroundRecipe} from './sculpt-ground-presets.js';
import {GroundPreview} from './sculpt-ground-preview.js';
const $=id=>document.getElementById(id);
// All rows live in index.html. This controller only fills choices and values.
export function mountGroundPanel(host){
 let selected=0,selectedLayer=0,previewKey='',previewContext='',resetContext=-1,shown=false;
 const dialog=$('material-editor'),noiseHelp=$('material-stage-noise').querySelector('.material-stage-help').textContent;let opener=null;
 const preview=new GroundPreview($('ground-preview'));
 const material=()=>host.grounds().find(p=>p.slot===selected);
 const recipe=()=>material()?materialLayers(material())[selectedLayer]:null;
 const editRecipe=p=>{const m=material(),rows=materialLayers(m);rows[selectedLayer]=p;return setGround(host.grounds(),selected,replaceMaterialLayers(m,rows));};
 const note=text=>{$('ground-presets-note').textContent=text;$('ground-presets-note').hidden=!text;};
 const fail=fn=>async()=>{try{await fn();note('');}catch(e){refresh();note(e.message);}};
 const change=grounds=>{host.edit(grounds);refresh();};
 const choose=slot=>{selected=slot;selectedLayer=0;refresh();};
 const hex=value=>'#'+(Array.isArray(value)?value:host.renderer().paletteIndexed[value]).map(n=>Math.round(n).toString(16).padStart(2,'0')).join('');
 const nearest=color=>{const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));let best=0,dist=Infinity;host.renderer().paletteIndexed.forEach((c,i)=>{const d=c.reduce((sum,n,k)=>sum+(n-rgb[k])**2,0);if(d<dist){dist=d;best=i;}});return best;};
 function refreshPreview(){
  if(!shown||!dialog.open)return;const r=host.renderer(),p=material();
  const view={channel:Number($('material-view').value),height:Number($('preview-height').value),slope:Number($('preview-slope').value)};
  const key=JSON.stringify([p,r.variant.toString(),r.colorOverrides,view]);if(key===previewKey)return;previewKey=key;
  $('ground-preview-count').textContent='Rendering the material sample…';
  preview.request(r,p,(error,count)=>{
   if(error){previewKey='';$('ground-preview-count').textContent='Sample unavailable: '+error.message;return;}
   $('ground-preview-count').textContent=`${count.draft?'Draft · palette grain follows when editing stops. ':''}${count.distinct} distinct tiles in this ${count.tiles}-tile sample · ${count.pool} px repeat · at most ${count.perLevel.toLocaleString()} tiles per flat height across the full repeat. The repeat seam crosses the center.`;
  },view);
 }
 function refresh(){
  const grounds=host.grounds();if(!grounds.some(p=>p.slot===selected))selected=0;
  const m=material();selectedLayer=Math.min(selectedLayer,Math.max(0,(m?materialLayers(m).length:1)-1));const p=recipe(),full=grounds.length>=7;
  const context=selected+':'+Boolean(m?.worldWater);if(previewContext!==context){previewContext=context;$('preview-height').value=m?.worldWater?host.renderer().config.seaLevel-64:host.renderer().config.baseHeight;$('preview-height-value').textContent=$('preview-height').value;}
  for(const [id,role,label] of [['ground-world-default','worldGround','Original world ground'],['water-material','worldWater','Original world water']]){$(id).replaceChildren(new Option(label,'0'),...grounds.map(g=>new Option(g.name,String(g.slot))));$(id).value=String(grounds.find(g=>g[role])?.slot??0);}
  $('water-material-edit').disabled=!grounds.some(g=>g.worldWater);
  $('ground-presets').replaceChildren(new Option('World ground','0'),...grounds.map(p=>new Option(p.name,String(p.slot))));$('ground-presets').value=String(selected);
  $('ground-name').value=m?.name||'World ground';
  for(const id of ['ground-name','ground-rename','ground-delete','ground-copy']){$(id).disabled=!p;$(id).title=p?'':'Select a map preset first. World ground uses the Pattern controls below.';}
  for(const id of ['ground-add','ground-duplicate','ground-paste']){$(id).disabled=full||(id==='ground-duplicate'&&!p);$(id).title=full?'The map already has seven ground presets.':id==='ground-duplicate'&&!p?'Select a map preset to duplicate.':'';}
  $('ground-recipe-fields').disabled=!p;$('ground-recipe-fields').hidden=!p;
  $('ground-world-note').hidden=!!p;if(!p)for(const tab of tabs)tab.hidden=false;
  $('material-layer-list').disabled=!m;
  for(const row of $('material-layers').children){const i=Number(row.dataset.layerIndex),layer=m&&materialLayers(m)[i]?.layer;row.hidden=!layer;if(!layer)continue;const button=row.querySelector('button'),toggle=row.querySelector('input');button.textContent=layer.name;button.setAttribute('aria-pressed',String(i===selectedLayer));toggle.checked=layer.visible;toggle.setAttribute('aria-label','Show '+layer.name);}
  if(resetContext!==selected){resetContext=selected;$('material-reset-preset').value=GROUND_PRESETS[m?.presetKey]?m.presetKey:'';}
  $('material-reset-preset').disabled=!m;$('material-reset').disabled=!m||!GROUND_PRESETS[$('material-reset-preset').value];$('material-reset').title=$('material-reset').disabled?'Choose a starting preset to restore.':'Restore the selected preset. Undo can recover your edits.';
  const count=m?materialLayers(m).length:0;
  $('layer-up').disabled=selectedLayer===0;$('layer-down').disabled=selectedLayer>=count-1;$('layer-delete').disabled=count<=1;
  $('layer-add').disabled=$('layer-duplicate').disabled=count>=8;
  $('layer-add').title=count>=8?'A material holds at most eight layers.':'';
  if(p){
   const resolved=resolveMaterialLayers(m)[selectedLayer],adjustment=p.layer.effect!=='material';
   for(const tab of tabs){tab.hidden=adjustment&&(['material-tab-phase','material-tab-filter','material-tab-bump'].includes(tab.id)||p.layer.effect==='detail'&&tab.id==='material-tab-color');}
   if(tabs.some(tab=>tab.hidden&&tab.getAttribute('aria-selected')==='true'))pick($('material-tab-noise'));
   $('material-stage-noise').querySelector('.material-stage-help').textContent=adjustment?'Edit this adjustment’s grain or dots here. Scale, distortion, filtering, and seed follow the preceding pattern layer.':noiseHelp;
   for(const group of $('material-stage-color').querySelectorAll('details.feature-group'))group.hidden=adjustment&&group.querySelector('summary').textContent==='Relief colors';
   for(const group of $('material-stage-noise').querySelectorAll('details.feature-group')){const label=group.querySelector('summary').textContent;group.hidden=p.layer.effect!=='material'&&(label==='Base noise'||label==='Marks'&&p.layer.effect!=='dots'||label==='Fine grain'&&p.layer.effect==='dots');}
   $('layer-name').value=p.layer.name;$('layer-pattern').value='';$('layer-pattern').disabled=adjustment;$('layer-pattern').title=adjustment?'Choose the base pattern on the preceding color-pattern layer.':'';
   for(const key of ['effect','blend','mask','maskPattern'])$('layer-'+key).value=p.layer[key];
   const effectHelp={material:'Compose this layer’s color and relief with the layers below.', 'fine-tint':'Multiply the layers below by the Fine grain tint. Bright tint values can exceed white. Distortion follows the preceding pattern.',dots:'Apply the Marks color or multiplier to the layers below. Follow light areas uses the preceding pattern.',detail:'Add fine detail before coloring the preceding pattern. Its scale, distortion, and colors follow that pattern automatically.'};
   const source=materialLayers(m).slice(0,selectedLayer).findLast(row=>row.layer.effect==='material'&&row.layer.color>0);
   $('layer-effect-help').textContent=effectHelp[p.layer.effect]+(p.layer.effect==='material'?'':source?' Follows '+source.layer.name+'.':' Move this adjustment after a color-pattern layer to use it.');$('layer-blend').disabled=p.layer.effect!=='material';$('layer-blend').title=p.layer.effect==='material'?'':effectHelp[p.layer.effect];
   const procedural=p.layer.mask==='procedural' ,terrain=['height','slope'].includes(p.layer.mask),masked=p.layer.mask!=='everywhere';
   $('layer-maskPattern').closest('.control').hidden=!procedural;$('layer-maskPattern').disabled=!procedural;$('layer-maskPattern').title=procedural?'':'Choose Procedural mask to use a mask pattern.';
   for(const [key]of LAYER_CONTROLS){const el=$('layer-'+key);const value=p.layer.effect!=='material'&&['seed','height','surface'].includes(key)?resolved.layer[key]:p.layer[key];el.value=value;$('layer-'+key+'-value').textContent=+value.toFixed(3);
    const inheritedLayer=p.layer.effect!=='material'&&['seed','height','surface'].includes(key);
    const off=inheritedLayer|| (key.startsWith('terrain')?!terrain:key.startsWith('mask')?(!masked||!['maskAmount','maskInvert'].includes(key)&&!procedural):false);
    el.closest('.control').hidden=key.startsWith('terrain')?!terrain:key.startsWith('mask')&&!['maskAmount','maskInvert'].includes(key)?!procedural:false;
    el.disabled=off;const reason=$('layer-'+key+'-reason');reason.hidden=!off;reason.textContent=inheritedLayer?(key==='seed'?'Seed follows the preceding pattern.':'This adjustment affects color; use a Color and relief layer for this channel.'):off?'Choose '+(key.startsWith('terrain')?'a terrain range mask.':key==='maskAmount'||key==='maskInvert'?'a mask.':'Procedural mask.') :'';
   }
   $('layer-mask-help').textContent=terrain?(p.layer.mask==='height'?'Height ranges use authored terrain height in art units.':'Slope ranges use degrees, from flat (0) to vertical (90).'):'The mask uses the same periodic pattern tools as a layer.';
   const terrainPalette=materialLayers(m).some(row=>['height','slope'].includes(row.layer.mask)&&row.layer.maskAmount>0);
   $('material-palette-note').textContent=terrainPalette?'Terrain masks reuse the repeatable diffusion grain and reduce the final terrain-dependent colors to the palette.':'Repeatable stacks use full-repeat error diffusion.';
   for(const[key]of GROUND_CONTROLS){
    const input=$('ground-'+key),value=(OUTPUT_KEYS.includes(key)?m:resolved).knobs[key];input.value=value;$('ground-'+key+'-value').textContent=+value.toFixed(3);
    const parent=key.startsWith('plate')||['borderProfile','crackWidth','rimCurl','secondaryCracks'].includes(key)?'plateAmount':key.startsWith('bump')?'bumpAmount':key.startsWith('scratch')?'scratchAmount':key.startsWith('quiet')?'quietAmount':key.startsWith('vein')?'veinAmount':key.startsWith('pebble')?'pebbleAmount':key.startsWith('cushion')?'cushionAmount':key.startsWith('ripple')?'rippleAmount':key==='toneSize'?'toneVariation':['sharpness','roughness','roughnessScale'].includes(key)?'gloss':null;
    const noGrain=['grainStretch','grainDirection'].includes(key)&&!['grainFine','grainMedium','grainBroad'].some(k=>p.knobs[k]>0);
    const noReliefGrain=key==='grainRelief'&&!['grainFine','grainMedium','grainBroad'].some(k=>p.knobs[k]>0);
    const sameGrainColors=key==='grainColorMix'&&p.ramp.every((v,i)=>String(v)===String(p.variationRamp[i]));
    const inherited=!OUTPUT_KEYS.includes(key)&&!adjustmentOwns(p.layer.effect,key);input.closest('.control').hidden=inherited;
    const textureReason=inherited?'This adjustment inherits the preceding pattern. Edit this setting on that pattern layer.':textureControlRequirement(key,OUTPUT_KEYS.includes(key)?m.knobs:resolved.knobs),textureOff=!!textureReason;
    const off=textureOff||sameGrainColors||noReliefGrain||noGrain||(key==='grainDirection'?p.knobs.grainStretch===1:parent&&parent!==key&&p.knobs[parent]===0);
    input.disabled=!!off;const reason=$('ground-'+key+'-reason');reason.hidden=!off;reason.textContent=textureOff?textureReason:sameGrainColors?'Choose an alternate grain color different from the main ramp to mix colors.':noReliefGrain?'Raise Fine grain, Medium grain, or Broad grain above 0 to shape grain relief.':noGrain?'Raise a grain amount above 0 to use this setting.':key==='grainDirection'&&off?'Raise Grain stretch above 1 to choose a direction.':off?'Raise '+$('ground-'+parent).closest('.control').querySelector('label').firstChild.textContent.trim()+' above 0 to use this setting.':'';
   }
   for(const key of Object.keys(TEXTURE_COLORS)){const scale=['fineLow','fineHigh','markTint'].includes(key)?127.5:1;const el=$('texture-color-'+key);el.value=hex(resolved.textureColors[key].map(v=>v*scale));el.disabled=p.layer.effect==='detail'||p.layer.effect==='fine-tint'&&!['fineLow','fineHigh'].includes(key)||p.layer.effect==='dots'&&!['mark','markTint'].includes(key);el.closest('.color-row').hidden=el.disabled;el.title=el.disabled?'This adjustment uses only its own grain or dot colors; edit the underlying colors on the pattern layer.':'';}
   $('texture-palette').value=m.texturePalette.map(hex).join(' ');
   resolved.ramp.forEach((entry,i)=>{$('ground-ramp-'+i).value=hex(entry);$('ground-ramp-'+i).title=`Tone ${i+1}: RGB ${entry}`;});
   resolved.variationRamp.forEach((entry,i)=>{$('ground-variation-'+i).value=hex(entry);$('ground-variation-'+i).title=`Alternate tone ${i+1}: RGB ${entry}`;});$('ground-line').value=hex(resolved.line);for(const id of ['ground-line',...Array.from({length:16},(_,i)=>'ground-ramp-'+i),...Array.from({length:16},(_,i)=>'ground-variation-'+i)]){$(id).disabled=p.layer.effect!=='material';$(id).title=p.layer.effect==='material'?'':'Edit relief colors on the preceding pattern layer.';}
  }
  refreshPreview();
 }
 const commit=()=>host.checkpoint();
 for(const [id,role]of [['ground-world-default','worldGround'],['water-material','worldWater']])$(id).onchange=fail(()=>{const slot=Number($(id).value);change(host.grounds().map(p=>({...p,[role]:p.slot===slot})));commit();});
 function open(slot,from){opener=from;if(slot!==undefined&&slot!==selected){selected=slot;selectedLayer=0;}else if(!recipe())selected=host.grounds()[0]?.slot??0;refresh();if(!dialog.open){host.suspend(true);dialog.showModal();}shown=true;refreshPreview();}
 const close=()=>{dialog.close();shown=false;previewKey='';preview.cancel();host.suspend(false);opener?.focus();};
 $('material-open').onclick=()=>open(undefined,$('material-open'));
 $('water-material-edit').onclick=()=>open(Number($('water-material').value),$('water-material-edit'));
 $('material-done').onclick=close;
 dialog.oncancel=e=>{e.preventDefault();close();};
 // Modal shortcuts cannot leak through to terrain selection or tool shortcuts.
 dialog.onkeydown=e=>{if(e.defaultPrevented)return;if(e.key==='Escape'){e.preventDefault();close();}
  else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&!e.target.matches('input,textarea')){e.preventDefault();$(e.shiftKey?'redo':'undo').click();}
  e.stopPropagation();};
 $('material-undo').onclick=()=>$('undo').click();$('material-redo').onclick=()=>$('redo').click();
 const lock=()=>{$('material-editor-fields').disabled=$('editor').disabled;$('material-undo').disabled=$('undo').disabled;$('material-redo').disabled=$('redo').disabled;};
 const locks=new MutationObserver(lock);for(const id of ['editor','undo','redo'])locks.observe($(id),{attributes:true,attributeFilter:['disabled']});lock();
 const tabs=[...dialog.querySelectorAll('[role="tab"]')];
 const pick=tab=>{for(const t of tabs){const on=t===tab;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;$(t.getAttribute('aria-controls')).hidden=!on;}};
 for(const t of tabs){t.onclick=()=>pick(t);t.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const available=tabs.filter(tab=>!tab.hidden),i=available.indexOf(t),next=e.key==='Home'?available[0]:e.key==='End'?available.at(-1):available[(i+(e.key==='ArrowRight'?1:available.length-1))%available.length];pick(next);next.focus();};}
 for(const key of Object.keys(TEXTURE_COLORS)){$('texture-color-'+key).oninput=fail(()=>{const p=copyGroundRecipe(recipe()),scale=['fineLow','fineHigh','markTint'].includes(key)?127.5:1;p.textureColors[key]=[1,3,5].map(i=>parseInt($('texture-color-'+key).value.slice(i,i+2),16)/scale);change(editRecipe(p));});$('texture-color-'+key).onchange=commit;}
 $('texture-palette').onchange=fail(()=>{const colors=$('texture-palette').value.trim().split(/[\s,]+/).filter(Boolean);if(colors.some(c=>!/^#[0-9a-f]{6}$/i.test(c)))throw Error('Use hex colors such as #4263a0.');const p=copyGroundRecipe(material());p.texturePalette=colors.map(nearest);change(setGround(host.grounds(),selected,p));commit();});
 $('ground-presets').onchange=()=>choose(Number($('ground-presets').value));
 $('ground-add').onchange=fail(()=>{const key=$('ground-add').value;$('ground-add').value='';if(!key)return;const p=GROUND_PRESETS[key],added=addGround(host.grounds(),p,p.name);selected=added.slot;selectedLayer=0;change(added.grounds);commit();});
 $('ground-duplicate').onclick=fail(()=>{const added=duplicateGround(host.grounds(),selected);selected=added.slot;selectedLayer=0;change(added.grounds);commit();});
 $('ground-rename').onclick=fail(()=>{change(renameGround(host.grounds(),selected,$('ground-name').value));commit();});
 $('ground-name').onkeydown=e=>{if(e.key==='Enter')$('ground-rename').click();};
 $('ground-delete').onclick=fail(()=>{host.delete(selected);selected=0;refresh();});
 $('ground-copy').onclick=fail(async()=>{await navigator.clipboard.writeText(groundRecipeText(material()));host.status('Copied the ground recipe.');});
 $('ground-paste').onclick=fail(async()=>{const p=parseGroundRecipe(await navigator.clipboard.readText()),added=addGround(host.grounds(),p,p.name);selected=added.slot;selectedLayer=0;change(added.grounds);commit();});
 for(const[key]of GROUND_CONTROLS){
  const input=$('ground-'+key);input.oninput=fail(()=>{const p=recipe();if(!p)return;if(OUTPUT_KEYS.includes(key)){const m=material();change(setGround(host.grounds(),selected,{...m,knobs:{...m.knobs,[key]:Number(input.value)}}));}
   else change(editRecipe({...p,knobs:{...p.knobs,[key]:Number(input.value)}}));});input.onchange=commit;
 }
 for(let i=0;i<33;i++){
  const input=$(i===32?'ground-line':i>=16?'ground-variation-'+(i-16):'ground-ramp-'+i);
  input.oninput=fail(()=>{const p=copyGroundRecipe(recipe()),rgb=[1,3,5].map(j=>parseInt(input.value.slice(j,j+2),16));if(i===32)p.line=rgb;else if(i>=16)p.variationRamp[i-16]=rgb;else p.ramp[i]=rgb;change(editRecipe(p));});input.onchange=commit;
 }

 $('material-reset-preset').onchange=()=>refresh();
 $('material-reset').onclick=fail(()=>{const preset=GROUND_PRESETS[$('material-reset-preset').value];if(!preset||!material())return;selectedLayer=0;change(setGround(host.grounds(),selected,preset));commit();});
 for(const row of $('material-layers').children){const index=Number(row.dataset.layerIndex);row.querySelector('button').onclick=()=>{selectedLayer=index;refresh();};row.querySelector('input').onchange=fail(()=>{const m=material(),rows=materialLayers(m).map(p=>structuredClone(p));rows[index].layer.visible=row.querySelector('input').checked;change(setGround(host.grounds(),selected,replaceMaterialLayers(m,rows)));commit();});}
 let dragged=-1;
 const clearDrop=()=>{for(const row of $('material-layers').children)delete row.dataset.drop;};
 for(const row of $('material-layers').children){
  row.ondragstart=e=>{if(!material()||row.hidden){e.preventDefault();return;}dragged=Number(row.dataset.layerIndex);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(dragged));};
  row.ondragover=e=>{if(dragged<0)return;e.preventDefault();e.dataTransfer.dropEffect='move';clearDrop();row.dataset.drop=e.clientY<row.getBoundingClientRect().top+row.offsetHeight/2?'before':'after';};
  row.ondragend=()=>{dragged=-1;clearDrop();};
  row.ondrop=e=>{e.preventDefault();const from=dragged;dragged=-1;const boundary=Number(row.dataset.layerIndex)+(row.dataset.drop==='after'?1:0),to=boundary-(from<boundary?1:0);clearDrop();if(from<0||to===from)return;fail(()=>stackEdit(rows=>{const [moved]=rows.splice(from,1);rows.splice(to,0,moved);selectedLayer=to;}))();};
 }

 const layerEdit=fn=>{const p=copyGroundRecipe(recipe());fn(p);change(editRecipe(p));};
 for(const [key]of LAYER_CONTROLS){$('layer-'+key).oninput=fail(()=>layerEdit(p=>{p.layer[key]=Number($('layer-'+key).value);}));$('layer-'+key).onchange=commit;}
 for(const key of ['name','effect','blend','mask','maskPattern'])$('layer-'+key).onchange=fail(()=>{layerEdit(p=>{p.layer[key]=$('layer-'+key).value;if(key==='effect'&&p.layer.effect!=='material'){p.layer.height=0;p.layer.surface=0;p.layer.seed=0;}});commit();});
 $('layer-pattern').onchange=fail(()=>{const kind=$('layer-pattern').value;if(kind){layerEdit(p=>Object.assign(p.knobs,patternSettings(kind)));commit();}});
 const stackEdit=fn=>{const m=material(),rows=materialLayers(m).map(p=>structuredClone(p));fn(rows);change(setGround(host.grounds(),selected,replaceMaterialLayers(m,rows)));commit();};
 for(const [id,delta]of [['layer-up',-1],['layer-down',1]])$(id).onclick=fail(()=>stackEdit(rows=>{const at=selectedLayer+delta;if(at<0||at>=rows.length)return;[rows[selectedLayer],rows[at]]=[rows[at],rows[selectedLayer]];selectedLayer=at;}));
 $('layer-delete').onclick=fail(()=>stackEdit(rows=>{if(rows.length===1)return;rows.splice(selectedLayer,1);selectedLayer=Math.max(0,selectedLayer-1);}));
 $('layer-duplicate').onclick=fail(()=>stackEdit(rows=>{const p=structuredClone(rows[selectedLayer]);p.layer.name=(p.layer.name+' copy').slice(0,80);rows.splice(++selectedLayer,0,p);}));
 $('layer-add').onchange=fail(()=>{const kind=$('layer-add').value;$('layer-add').value='';if(!kind)return;stackEdit(rows=>{
  const m=material(),p=copyGroundRecipe({knobs:{...patternSettings(kind),textureHeight:kind==='spots'?2:0},ramp:m.ramp,line:m.line,textureColors:m.textureColors});
  p.layer=copyLayerSettings({name:{clouds:'Cloudy color',cells:'Cellular patches',spots:'Scattered pits',ridges:'Ridges',waves:'Water streaks',grain:'Fine grain'}[kind],opacity:.5,height:kind==='spots'?-1:1,seed:rows.length*13,blend:kind==='spots'?'multiply':'normal'});
  rows.push(p);selectedLayer=rows.length-1;
 });});
 $('material-view').onchange=()=>refreshPreview();
 for(const key of ['height','slope']){$('preview-'+key).oninput=()=>{$('preview-'+key+'-value').textContent=$('preview-'+key).value;refreshPreview();};$('preview-'+key+'-value').textContent=$('preview-'+key).value;}

 const observer=new IntersectionObserver(entries=>{shown=entries[0].isIntersecting;if(shown)refreshPreview();});observer.observe($('ground-preview'));
 if(dialog.open){shown=true;host.suspend(true);}
 refresh();return {refresh,refreshPreview,dispose(){host.suspend(false);observer.disconnect();locks.disconnect();preview.dispose();}};
}
