// Artist workspace. Reuses the editor's controls, events and history.
import {mountHelp} from './sculpt-help.js';
const $=id=>document.getElementById(id);

export function mountWorkspace(){
  const palette=document.querySelector('.tool-palette');
  const zoomBy=factor=>{const camera=window.sculptCanvas;if(!camera)return;const s=camera.view().scale,levels=[.25,.5,1,2,4];camera.zoom(factor>1?(levels.find(v=>v>s+.001)??4):([...levels].reverse().find(v=>v<s-.001)??.25));};
  $('zoom-out').onclick=()=>zoomBy(.5);$('zoom-in').onclick=()=>zoomBy(2);
  // Picking a tool shows its settings: the side panel opens on Build.
  palette.addEventListener('click',e=>{if(e.target.closest('[data-tool],#feature-tool'))$('tab-tool').click();});
  // The palette sits outside the #editor fieldset, so it follows the editor's lock here. (The curve editors are inside it; their
  // canvases lock by the stylesheet.)
  let lastLock;
  const lock=()=>{const disabled=$('editor').disabled;if(lastLock===disabled)return;lastLock=disabled;palette.querySelectorAll('button').forEach(b=>{b.disabled=disabled;});};
  new MutationObserver(lock).observe($('editor'),{attributes:true,attributeFilter:['disabled']});
  mountHelp();
  // The page's own sliders are written in the compact form; generated ones come from controlRow.
  document.querySelectorAll('.control[data-compact]').forEach(attachScrub);
}

// A generated control row. A slider takes the compact form the page's own sliders are written in: the label and a
// typed-value field inside the .scrub bar, the native range beside it holding the value and emitting the events.
// `label` is the label's HTML, `range` the range's attributes; `choices` ([value, text]) makes a select instead,
// with `select` its extra attributes.
export function controlRow({id,label,range='',choices=null,select='',help=null}){
  const row=document.createElement('div');row.className='control';
  const note=help===null?'':`<p class="small">${help}</p>`;
  if(choices){row.innerHTML=`<label for="${id}">${label}</label><select id="${id}"${select}>${choices.map(([v,text])=>`<option value="${v}">${text}</option>`).join('')}</select>${note}`;return row;}
  row.dataset.compact='true';
  row.innerHTML=`<div class="scrub" tabindex="0" role="slider" data-source="${id}"><label for="${id}">${label}</label><input class="scrub-entry" type="number" hidden></div><input id="${id}" class="scrub-native" type="range" ${range} tabindex="-1" aria-hidden="true">${note}`;
  attachScrub(row);return row;
}

// Slider behavior for a compact row: drag, click to set (after the double-click delay), double-click or Enter to
// type, arrow keys, Shift for fine drags, and the native range's disabled state.
function attachScrub(row){
  const scrub=row.querySelector(':scope > .scrub'),label=scrub.querySelector(':scope > label'),input=scrub.querySelector(':scope > .scrub-entry'),source=row.querySelector(':scope > input[type=range]');
  let pointer=null,editing=false,clickTimer=null,clickValue=null;
  const cancelClick=()=>{clearTimeout(clickTimer);clickTimer=null;clickValue=null;document.removeEventListener('pointerdown',nextPointer,true);};
  const disabled=()=>source.matches(':disabled');
  const sync=()=>{const lo=Number(source.min),hi=Number(source.max),v=Number(source.value),title=label.cloneNode(true);title.querySelector('output')?.remove();const name=title.textContent.trim();scrub.setAttribute('aria-label',name);input.setAttribute('aria-label',name);scrub.style.setProperty('--fill',`${100*(v-lo)/(hi-lo||1)}%`);scrub.setAttribute('aria-valuemin',lo);scrub.setAttribute('aria-valuemax',hi);scrub.setAttribute('aria-valuenow',v);scrub.setAttribute('aria-valuetext',label.querySelector('output')?.textContent||String(v));scrub.setAttribute('aria-disabled',String(disabled()));scrub.tabIndex=disabled()?-1:0;input.min=source.min;input.max=source.max;input.step=source.step;input.disabled=disabled();if(disabled()&&editing)finish(true);};
  // A no-op must not emit input: the renderer pauses weathering until change.
  const apply=v=>{if(disabled())return false;const before=source.value,wasUnset=source.dataset.unset==='true',step=Number(source.step)||1,lo=Number(source.min),hi=Number(source.max);source.value=String(Math.max(lo,Math.min(hi,lo+Math.round((v-lo)/step)*step)));if(source.value===before&&!wasUnset)return false;if(wasUnset)source.dataset.unset='false';source.dispatchEvent(new Event('input',{bubbles:true}));sync();return true;};
  const commit=()=>source.dispatchEvent(new Event('change',{bubbles:true}));
  const flushClick=()=>{const value=clickValue;cancelClick();if(value!==null&&apply(value))commit();};
  // Finish a pending click before another control or shape can change context.
  const nextPointer=e=>{if(scrub.contains(e.target))cancelClick();else flushClick();};
  const type=()=>{cancelClick();if(disabled())return;editing=true;scrub.removeAttribute('role');input.hidden=false;input.value=source.dataset.unset==='true'?'':source.value;input.placeholder=source.dataset.unsetLabel||'';input.focus();input.select();};
  const finish=(cancel,focus=false)=>{if(!editing)return;editing=false;
    if(!cancel&&!disabled()){
      // Optional recipe values share this same slider: clearing typed entry
      // restores the inherited value; choosing zero is an explicit override.
      if(!input.value.trim()&&source.dataset.allowEmpty==='true'){
        if(source.dataset.unset!=='true'){source.dataset.unset='true';commit();}
      }else if(input.value.trim()&&Number.isFinite(input.valueAsNumber)&&apply(input.valueAsNumber))commit();
    }
    input.hidden=true;scrub.setAttribute('role','slider');if(focus)scrub.focus({preventScroll:true});
  };
  scrub.addEventListener('pointerdown',e=>{if(e.target===input||disabled()||e.button!==0)return;cancelClick();e.preventDefault();pointer={id:e.pointerId,x:e.clientX,raw:Number(source.value),moved:false,changed:false};scrub.setPointerCapture(e.pointerId);scrub.focus({preventScroll:true});});
  scrub.addEventListener('pointermove',e=>{if(pointer?.id!==e.pointerId)return;const dx=e.clientX-pointer.x;if(!pointer.moved&&Math.abs(dx)<4)return;pointer.moved=true;pointer.x=e.clientX;const lo=Number(source.min),hi=Number(source.max);pointer.raw=Math.max(lo,Math.min(hi,pointer.raw+dx*(hi-lo)/240*(e.shiftKey?.1:1)));pointer.changed=apply(pointer.raw)||pointer.changed;});
  // Cancellation finishes the last visible value, just like a native range.
  const end=e=>{if(pointer?.id!==e.pointerId)return;const p=pointer;pointer=null;if(scrub.hasPointerCapture(e.pointerId))scrub.releasePointerCapture(e.pointerId);if(p.changed)commit();else if(!p.moved&&e.type==='pointerup'){const r=scrub.getBoundingClientRect(),lo=Number(source.min),hi=Number(source.max),value=lo+(hi-lo)*(e.clientX-r.left)/r.width;
    // Let a second click enter text without first changing the terrain.
    clickValue=value;document.addEventListener('pointerdown',nextPointer,true);clickTimer=setTimeout(flushClick,300);
  }};
  scrub.addEventListener('pointerup',end);scrub.addEventListener('pointercancel',end);scrub.addEventListener('lostpointercapture',end);
  scrub.addEventListener('dblclick',e=>{if(e.target===input||disabled())return;e.preventDefault();e.stopPropagation();type();});
  scrub.addEventListener('keydown',e=>{if(e.target===input||disabled())return;const step=Number(source.step)||1,delta={ArrowRight:step,ArrowUp:step,ArrowLeft:-step,ArrowDown:-step,PageUp:step*10,PageDown:-step*10}[e.key];if(delta!==undefined||['Home','End'].includes(e.key)){cancelClick();e.preventDefault();e.stopPropagation();if(apply(e.key==='Home'?Number(source.min):e.key==='End'?Number(source.max):Number(source.value)+delta))commit();}else if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();type();}});
  input.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();finish(false,true);}if(e.key==='Escape'){e.preventDefault();finish(true,true);}});input.addEventListener('blur',()=>finish(false));
  source.addEventListener('input',sync);source.addEventListener('change',sync);
  new MutationObserver(sync).observe(label,{childList:true,subtree:true,characterData:true});new MutationObserver(sync).observe(source,{attributes:true,attributeFilter:['disabled','min','max','step']});sync();
}
