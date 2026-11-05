// Artist workspace prototype. Reuses the editor's controls, events and history.
import {mountHelp} from './sculpt-help.js';
const $=id=>document.getElementById(id);
const element=(tag,cls,html='')=>{const e=document.createElement(tag);e.className=cls;e.innerHTML=html;return e;};

export function mountWorkspace(){
  const app=document.querySelector('.app'),tabs=document.querySelector('.inspector-tabs'),content=document.querySelector('.inspector-content');
  const pane=(name,label)=>{const tab=element('button','',label);tab.id='tab-'+name;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','pane-'+name);tab.setAttribute('aria-selected','false');tab.tabIndex=-1;tabs.append(tab);const p=element('section','');p.id='pane-'+name;p.setAttribute('role','tabpanel');p.setAttribute('aria-labelledby',tab.id);p.hidden=true;content.append(p);return p;};
  const tools=pane('tool','Tool'),objects=pane('objects','Shapes');
  tabs.prepend($('tab-tool'));tabs.append($('tab-objects'));
  const palette=document.querySelector('.tool-palette');$('tools-sidebar').append(palette);tools.append($('editor'));
  objects.append(document.querySelector('.layers-panel'));
  const dock=element('section','curve-dock');dock.id='curve-dock';dock.setAttribute('aria-label','Navigator and shape curves');
  dock.append(document.querySelector('.minimap-panel'));
  const empty=element('div','curve-empty','<strong>Shape curves</strong><span>Select a landform tool or a landform on the map to edit its cross-section and height along the path.</span>');empty.id='curve-empty';dock.append(empty);app.insertBefore(dock,document.querySelector('footer'));
  document.querySelector('.minimap-panel .panel-heading').innerHTML='<h2>Navigator</h2><span>Drag to pan</span>';
  $('seed-randomize').textContent='↻ Reroll';$('seed-randomize').title='Reroll this shape’s seed. Curves and settings stay the same.';
  const settings=$('pane-graphics');settings.querySelector('h2').textContent='Editor settings';
  const preferences=element('section','editor-preferences','<h3>Drawing</h3>');settings.prepend(preferences);
  preferences.append($('seed-vary-control'),$('simplify-strokes').closest('label'));
  $('drawing-options').querySelectorAll('p.small').forEach(p=>{if(p.id!=='drawing-target')p.remove();});
  preferences.append($('weathered-view-control'));$('weathered-view-control').lastChild.textContent=' Preview weathered detail';
  const weather=element('label','view-toggle','');weather.append($('weather'),document.createTextNode('Weathering'));weather.title='Apply terrain weathering to this map, including export.';
  const grid=element('label','view-toggle','<input id="tile-grid" type="checkbox">Tile grid');grid.title='16 px height-cell grid in map coordinates; heavier lines every 128 px.';
  const view=document.querySelector('.view-tools');view.append(grid,weather);
  const zoomOut=element('button','','−'),zoomIn=element('button','','+');zoomOut.id='zoom-out';zoomIn.id='zoom-in';zoomOut.setAttribute('aria-label','Zoom out');zoomIn.setAttribute('aria-label','Zoom in');
  $('zoom').before(zoomOut);$('zoom').after(zoomIn);
  const zoomBy=factor=>{const camera=window.sculptCanvas;if(!camera)return;const s=camera.view().scale,levels=[.25,.5,1,2,4];camera.zoom(factor>1?(levels.find(v=>v>s+.001)??4):([...levels].reverse().find(v=>v<s-.001)??.25));};
  zoomOut.onclick=()=>zoomBy(.5);zoomIn.onclick=()=>zoomBy(2);
  $('view-rendered').textContent='Art';
  for(const [name,label] of [['export','Export'],['graphics','Settings']]){const tab=$('tab-'+name);tab.hidden=true;const b=element('button','',label);b.id='open-'+name;b.onclick=()=>{if($('inspector-sidebar').hidden)$('toggle-inspector').click();tab.click();};document.querySelector('.top-actions').append(b);}
  document.querySelector('.version').textContent='PROTOTYPE';
  document.querySelector('.tool-palette').addEventListener('click',e=>{if(e.target.closest('button')){if($('inspector-sidebar').hidden)$('toggle-inspector').click();$('tab-tool').click();}});
  let lastLock;
  const lock=()=>{const disabled=$('editor').disabled;if(lastLock===disabled)return;lastLock=disabled;dock.classList.toggle('is-disabled',disabled);dock.querySelectorAll('button,select').forEach(e=>{if(disabled){e.dataset.wasDisabled=String(e.disabled);e.disabled=true;}else if(e.dataset.wasDisabled!==undefined){e.disabled=e.dataset.wasDisabled==='true';delete e.dataset.wasDisabled;}});palette.querySelectorAll('button').forEach(b=>{b.disabled=disabled;});};
  new MutationObserver(lock).observe($('editor'),{attributes:true,attributeFilter:['disabled']});lock();
  mountHelp();
  const enhance=root=>{if(root instanceof Element){if(root.matches('.control'))compactControl(root);root.querySelectorAll('.control').forEach(compactControl);}};
  enhance(document.body);
  new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)enhance(n);}).observe(app,{childList:true,subtree:true});
}

export function mountCurveDock(){
  const root=$('section-preview-control'),section=element('section','curve-pane'),along=$('along-block');
  $('curve-reset').textContent='Reset';$('along-reset').textContent='Reset';
  const heading=element('div','curve-heading','<h2>Cross-section</h2>');heading.append($('curve-form'));
  const actions=element('div','curve-actions');actions.append($('curve-link'),$('curve-mirror'),$('curve-reset'),$('curve-lean'));
  section.append(heading,$('section-preview'),actions);
  const alongHeading=element('div','curve-heading','<h2>Length vs. height</h2><span>Start → end of path</span>');
  const alongActions=element('div','curve-actions');alongActions.append($('along-reset'));alongActions.append(element('span','','Double-click: add point · Shift-click: remove'));
  const alongCanvas=$('along-preview');along.replaceChildren(alongHeading,alongCanvas,alongActions);along.className='curve-pane';
  root.replaceChildren(section,along);root.className='curve-editors';$('curve-dock').append(root);
  // Existing IDs retain all of the curve editor's pointer handlers.
  $('section-preview').title='Drag points to shape the section. Click the line to add a point. Shift-click a point to remove it. Drag the diamond to lean.';
  $('along-preview').title='Drag points to change height along the path. Double-click the line to add a point. Shift-click to remove it.';
  const sync=()=>{$('curve-empty').hidden=!root.hidden;};new MutationObserver(sync).observe(root,{attributes:true,attributeFilter:['hidden']});sync();
}

function compactControl(row){
  const source=row.querySelector(':scope > input[type=range]'),label=row.querySelector(':scope > label');
  if(!source||!label||row.dataset.compact)return;
  row.dataset.compact='true';const title=label.cloneNode(true);title.querySelector('output')?.remove();
  const name=title.textContent.trim(),scrub=element('div','scrub');scrub.tabIndex=0;scrub.setAttribute('role','slider');scrub.setAttribute('aria-label',name);scrub.dataset.source=source.id;
  const input=element('input','scrub-entry');input.type='number';input.setAttribute('aria-label',name);input.hidden=true;
  row.insertBefore(scrub,label);scrub.append(label,input);source.classList.add('scrub-native');source.tabIndex=-1;
  let pointer=null,editing=false,original=0;
  const disabled=()=>source.matches(':disabled');
  const sync=()=>{const lo=Number(source.min),hi=Number(source.max),v=Number(source.value);scrub.style.setProperty('--fill',`${100*(v-lo)/(hi-lo||1)}%`);scrub.setAttribute('aria-valuemin',lo);scrub.setAttribute('aria-valuemax',hi);scrub.setAttribute('aria-valuenow',v);scrub.setAttribute('aria-valuetext',label.querySelector('output')?.textContent||String(v));scrub.setAttribute('aria-disabled',String(disabled()));scrub.tabIndex=disabled()?-1:0;input.min=source.min;input.max=source.max;input.step=source.step;};
  const apply=v=>{const step=Number(source.step)||1,lo=Number(source.min),hi=Number(source.max);source.value=String(Math.max(lo,Math.min(hi,lo+Math.round((v-lo)/step)*step)));source.dispatchEvent(new Event('input',{bubbles:true}));sync();};
  const commit=()=>source.dispatchEvent(new Event('change',{bubbles:true}));
  const type=()=>{editing=true;original=Number(source.value);input.hidden=false;input.value=source.value;input.focus();input.select();};
  const finish=cancel=>{if(!editing)return;editing=false;if(!cancel&&input.value.trim()&&Number.isFinite(input.valueAsNumber)){apply(input.valueAsNumber);if(Number(source.value)!==original)commit();}input.hidden=true;scrub.focus({preventScroll:true});};
  scrub.addEventListener('pointerdown',e=>{if(e.target===input||disabled()||e.button!==0)return;e.preventDefault();pointer={id:e.pointerId,x:e.clientX,value:Number(source.value),moved:false};scrub.setPointerCapture(e.pointerId);scrub.focus({preventScroll:true});});
  scrub.addEventListener('pointermove',e=>{if(pointer?.id!==e.pointerId)return;const dx=e.clientX-pointer.x;if(!pointer.moved&&Math.abs(dx)<4)return;pointer.moved=true;const span=Number(source.max)-Number(source.min);apply(pointer.value+dx*span/240*(e.shiftKey?.1:1));});
  const end=e=>{if(pointer?.id!==e.pointerId)return;const p=pointer;pointer=null;if(scrub.hasPointerCapture(e.pointerId))scrub.releasePointerCapture(e.pointerId);if(p.moved){if(e.type==='pointercancel')apply(p.value);commit();}else if(e.type==='pointerup')type();};
  scrub.addEventListener('pointerup',end);scrub.addEventListener('pointercancel',end);scrub.addEventListener('lostpointercapture',end);
  scrub.addEventListener('keydown',e=>{if(e.target===input||disabled())return;const step=Number(source.step)||1,delta={ArrowRight:step,ArrowUp:step,ArrowLeft:-step,ArrowDown:-step,PageUp:step*10,PageDown:-step*10}[e.key];if(delta!==undefined||['Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();apply(e.key==='Home'?Number(source.min):e.key==='End'?Number(source.max):Number(source.value)+delta);commit();}else if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();type();}});
  input.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();finish(false);}if(e.key==='Escape'){e.preventDefault();finish(true);}});input.addEventListener('blur',()=>finish(false));
  source.addEventListener('input',sync);source.addEventListener('change',sync);
  new MutationObserver(sync).observe(label,{childList:true,subtree:true,characterData:true});new MutationObserver(sync).observe(source,{attributes:true,attributeFilter:['disabled','min','max','step']});sync();
}
