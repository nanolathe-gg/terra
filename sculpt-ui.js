import {controlLabel,worldControlRequirement,WORLD_PRIMARY_CONTROLS} from './sculpt-control-schema.js';
import {mountWorkspace} from './sculpt-workspace.js';
// Presentation helpers; terrain state and history stay in sculpt.js.
const $=id=>document.getElementById(id);
export function mountEditorUI(){
 const app=document.querySelector('.app');
 let panels={tools:true,inspector:true},beforeFocus=null;
 try{panels={...panels,...JSON.parse(localStorage.getItem('terraform-editor-panels')||'{}')};}catch{}
 const focused=()=>beforeFocus!==null;
 function updateLayout(){
  const showTools=!focused()&&panels.tools,showInspector=!focused()&&panels.inspector;
  app.classList.toggle('tools-collapsed',!showTools);app.classList.toggle('inspector-collapsed',!showInspector);
  $('tools-sidebar').hidden=!showTools;$('inspector-sidebar').hidden=!showInspector;
  for(const [id,on,label] of [['toggle-tools',showTools,'tools'],['toggle-inspector',showInspector,'inspector']]){const b=$(id);b.setAttribute('aria-expanded',String(on));b.title=`${on?'Hide':'Show'} ${label}`;}
  $('focus-canvas').setAttribute('aria-pressed',String(focused()));$('focus-canvas').querySelector('span').textContent=focused()?'Restore':'Focus';
  try{localStorage.setItem('terraform-editor-panels',JSON.stringify(panels));}catch{}
 }
 function togglePanel(name){if(focused()){panels={tools:false,inspector:false};beforeFocus=null;}panels[name]=!panels[name];updateLayout();}
 function exitFocus(){if(!focused())return false;panels=beforeFocus;beforeFocus=null;updateLayout();return true;}
 function toggleFocus(){if(!exitFocus()){beforeFocus={...panels};updateLayout();}}
 $('toggle-tools').onclick=()=>togglePanel('tools');$('toggle-inspector').onclick=()=>togglePanel('inspector');$('focus-canvas').onclick=toggleFocus;
 updateLayout();
 const grouped=document.querySelector('.tool-groups');
 const syncTools=(active,selected,locked,features)=>{
  for(const b of grouped.querySelectorAll('button')){b.disabled=locked;b.setAttribute('aria-pressed',String(features?b.id==='feature-tool':b.dataset.tool===active));}
 };
 mountWorkspace();
 const tabs=[...document.querySelectorAll('[role="tab"]')],visibleTabs=tabs.filter(t=>!t.hidden);
 function activate(tab){for(const t of tabs){const active=t===tab;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;$(t.getAttribute('aria-controls')).hidden=!active;}}
 for(const t of tabs){t.onclick=()=>activate(t);t.onkeydown=e=>{const i=visibleTabs.indexOf(t);let j;if(e.key==='ArrowRight')j=(i+1)%visibleTabs.length;if(e.key==='ArrowLeft')j=(i+visibleTabs.length-1)%visibleTabs.length;if(e.key==='Home')j=0;if(e.key==='End')j=visibleTabs.length-1;if(j!==undefined){e.preventDefault();activate(visibleTabs[j]);visibleTabs[j].focus();}};}
 for(const [id,on] of [['view-rendered',false],['view-clay',true]])$(id).onclick=()=>{$('clay').checked=on;$('clay').dispatchEvent(new Event('change'));};
 return {toggleFocus,exitFocus,syncTools};
}
// Each effect owns its controlling value and its dependent parameters. Zero
// means off; switching back on restores the last value for this tool/selection.
// buildRow(field) returns a new control row; each row is created for its group and placed there once.
export function groupToolControls(fields,buildRow){
 const root=$('shape-options'),groups=[],claimed=new Set(),created=[];
 const definitions=[
 ['','Height',['heightReference','elevation','combine','routeSmooth']],
 ['','Cross-section',['lean','facing']],
 ['','Variation',['wander','widthVary','heightVary','varySize','varyFoot','varyMiddle']],
 ['gullies','Gullies',['gullies','gullySize','talus']],
 ['','Impact',['ejecta','secondaries']],
 ['','Variability',['faceVariation']],
 ['fingers','Shore lobes',['fingers','fingerSize']],
 ['','Steps',['stepReference','terraces','ledge','terraceJitter','breakup','layerPx','layerRiser','layerVary','layerCircle','lavaSpread','lavaCircleVary']],
 ['spurCount','Spurs',['spurCount','spurLength','spurSpread','spurWidth','spurTaper','spurHeight','spurForks','spurBulb']],
 ['rimSectors','Rim sectors',['rimSectors','rimUnequal']],['rimGaps','Rim gaps',['rimGaps','rimGapWidth']],
 ['fissureBranches','Branches',['fissureBranches','fissureBranchLen','fissureBranchSpread']],['fissureNetwork','Fracture network',['fissureNetwork','fissureCell']],
 ['shorePlates','Shore plates',['shorePlates','plateWaterPx','plateLandPx','plateSize','plateGap','plateHeight','plateMaterial','frostNeedles','crystalShoreSeam','plateVary']],
 [null,'Faceted form',['crystalForm','crystalSides','crystalSize','crystalCount','crystalTop','crystalLean','crystalVariation']],
 [null,'Column structure',['crystalTiers','crystalStep','crystalFacet','crystalSizeVar','crystalSmooth']],
 [null,'Planar block',['crystalAlign','bergFace','bergJitter','bergBreak','bergRough','bergTilt','bergTiltDir','bergFlat']],
 [null,'Water appearance',['waterDeep','waterBed']],
 [null,'Surf',['surf']],
 [null,'Crest variation',['crestJag','crestVary','crestTaper']],
 ['craterFacets','Bowl facets',['craterFacets','crystalCraterPx','crystalCraterStep','crystalCraterSkin']],['iceFacets','Angular facets',['iceFacets','iceFacetSize']]
 ];
 function wire(d,controls,master=null){
  const memory=new Map(),box=master?d.querySelector(':scope > summary > input'):undefined;
  if(master){box.addEventListener('click',e=>e.stopPropagation());box.addEventListener('change',()=>{const key=d.dataset.context,previous=Number(master.value);if(!box.checked&&previous!==0)memory.set(key,previous);master.value=box.checked?(memory.get(key)||(master.tagName==='SELECT'?[...master.options].find(o=>Number(o.value)!==0)?.value:Math.max(Number(master.step)||1,Math.min(Number(master.max),Number(master.max)*.5)))):0;master.dispatchEvent(new Event('input',{bubbles:true}));master.dispatchEvent(new Event('change',{bubbles:true}));if(box.checked)d.open=true;});}
  groups.push({d,controls,master,box,memory,lastContext:null});
 }
 function make(title,rows,masterId=null){
  const d=document.createElement('details');d.className='feature-group';const summary=document.createElement('summary');summary.textContent=title;d.append(summary);const body=document.createElement('div');body.className='feature-body';d.append(body);body.append(...rows);
  if(masterId){const box=document.createElement('input');box.type='checkbox';box.setAttribute('aria-label',`Enable ${title}`);summary.append(box);}
  created.push(d);wire(d,rows,masterId?d.querySelector('#'+masterId):null);
 }
 const basics=document.querySelector('#brush-panel > .brush-basics');wire(basics,['tool-style','diameter','amount','roughness','softness'].map(id=>$(id).closest('.control')));
 for(const [key,label,keys] of definitions){const present=fields.filter(f=>keys.includes(f[0]));if(!present.length)continue;present.forEach(f=>claimed.add(f[0]));make(label,present.map(buildRow),key?present.find(f=>f[0]===key)[1]:null);}
 for(const field of fields){const [key,id,label,,lo]=field;if(claimed.has(key))continue;make(controlLabel(key,label).replace(/ \(.*$/,''),[buildRow(field)],lo<=0&&!['crystalForm','bergTiltDir'].includes(key)?id:null);}
 // The generated groups go ahead of Cracks, the one group the page declares in #shape-options.
 root.prepend(...created);
 wire($('cracks-control').closest('details'),[$('cracks-control')],$('cracks'));
 // Choose initial openness on tool/selection changes; value edits never collapse a section.
 return context=>{for(const g of groups){g.d.hidden=g.controls.every(c=>c.hidden);g.d.dataset.context=context;if(!g.master){if(g.lastContext!==context&&!g.d.classList.contains('brush-basics'))g.d.open=g.controls.some(c=>c.id==='crystal-form-control'||c.id==='paint-channel-control'||(!$('lf-elevation-control').hidden&&['lf-elevation-control','section-preview-control','lf-wander-control'].includes(c.id)));g.lastContext=context;continue;}const on=Number(g.master.value)!==0;if(on)g.memory.set(context,Number(g.master.value));g.box.checked=on;g.d.classList.toggle('is-off',!on);if(g.lastContext!==context)g.d.open=on;g.lastContext=context;}};
}

// One level of open sections keeps related controls together for scrolling.
const worldSection=name=>/Light|Shine/.test(name)?'Lighting':/Ground|Vegetation|Material coverage/.test(name)?'Ground & vegetation':/Water|Shore|Needle|Contour fringe|Terrace creases/.test(name)?'Water & shores':/Rock|Strata|Cracks|Contour bands|Gullies|Structure orientation|Microfacets/.test(name)?'Rock & cliffs':'Materials & texture';
// A World group: a titled block created in its section. Its rows carry `search` as data-search-group.
export function worldGroup(name){
 const block=document.createElement('div'),heading=document.createElement('h3');block.className='world-subsection';heading.textContent=name;block.append(heading);
 [...$('knobs').children].find(section=>section.dataset.group===worldSection(name)).append(block);
 return {block,search:`${name} ${worldSection(name)}`};
}
export function mountWorldControlIndex(root,values=()=>({})){
 const search=$('world-control-search'),blocks=[...root.querySelectorAll('.world-subsection')];
 const groups=[...root.children],input=search.querySelector('#world-search'),fine=search.querySelector('#world-fine');let previous=null,lastQuery='';
 const sync=()=>{const query=input.value.trim().toLowerCase(),current=values(),worldRows=[...root.querySelectorAll('[data-knob]')],rows=[...worldRows,...document.querySelectorAll('#rendering-host [data-knob]')];let visible=0;if(query&&!previous)previous=new Map(groups.map(d=>[d,d.open]));
  for(const row of rows){const reason=worldControlRequirement(row.dataset.knob,current),control=row.querySelector('input[type=range],select');control.disabled=Boolean(reason);row.classList.toggle('control-inactive',Boolean(reason));let note=row.querySelector('.control-requirement');if(!note){note=document.createElement('p');note.className='small control-requirement';row.append(note);}note.textContent=reason;note.hidden=!reason;const group=row.closest('.knobs-group'),text=(row.textContent+' '+row.dataset.searchGroup+' '+group.dataset.group).toLowerCase();if(!root.contains(row))continue;   // the Palette rows live with the rendering switches: disabled with a reason, never filtered
  row.hidden=query?!text.includes(query):!fine.checked&&!WORLD_PRIMARY_CONTROLS.has(row.dataset.knob);if(!row.hidden)visible++;}
  for(const block of blocks)block.hidden=![...block.querySelectorAll('[data-knob]')].some(r=>!r.hidden);
  for(const group of groups){group.hidden=![...group.querySelectorAll('[data-knob]')].some(r=>!r.hidden);if(query&&query!==lastQuery&&!group.hidden)group.open=true;}
  if(!query&&previous){for(const [d,open] of previous)d.open=open;previous=null;}
  lastQuery=query;$('world-control-count').textContent=query?`${visible} matching settings`:fine.checked?`${worldRows.length} settings · including fine controls`:`${visible} primary settings · ${worldRows.length} total`;
 };input.addEventListener('input',sync);fine.addEventListener('change',sync);sync();return sync;
}

export function mountColumnPanel(read,change,commit,reset){
 const panel=$('column-panel'),body=panel.querySelector('.column-body'),note=panel.querySelector(':scope > [role="status"]'),restore=panel.querySelector(':scope > button');
 const at=(column,path)=>path.reduce((v,k)=>v[k],column);
 function field(parent,label,path,{min,max,step='any',choices,color=false}={}){
  const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement(choices?'select':'input');input.dataset.columnPath=path.join('.');input.setAttribute('aria-label',label);
  const value=at(read().column,path);if(choices){input.replaceChildren(...choices.map(([v,text])=>new Option(text,v)));input.value=value;}
  else{input.type=color?'color':'number';input.required=true;input.value=color?'#'+value.map(v=>Math.round(v).toString(16).padStart(2,'0')).join(''):value;input.step=step;if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;}
  input.oninput=()=>{input.setCustomValidity('');if(!input.checkValidity()){note.textContent='Enter a value within the displayed limits.';return;}const column=structuredClone(read().column),target=at(column,path.slice(0,-1));target[path.at(-1)]=color?[1,3,5].map(i=>parseInt(input.value.slice(i,i+2),16)):choices?input.value:Number(input.value);if(choices&&typeof value==='number')target[path.at(-1)]=Number(input.value);
   try{change(column);restore.disabled=!read().edited;note.textContent=read().edited?'Map column edited.':'Using the world column unchanged.';}catch(err){input.setCustomValidity(err.message);note.textContent=err.message;}
  };
  input.onchange=()=>{commit();if(!input.checkValidity())sync();};wrap.append(input);parent.append(wrap);return input;
 }
 function sync(){
  const {column,variant,edited}=read();panel.hidden=!column;body.replaceChildren();if(!column)return;const row=column.variants?.[variant]||{},prefix=key=>row[key]?['variants',variant,key]:[key];
  note.textContent=edited?'Map column edited.':'Using the world column unchanged.';restore.disabled=!edited;
  if(variant){const p=document.createElement('p');p.className='small';p.textContent=`Column row: ${$('variant-select').selectedOptions[0]?.textContent||variant}`;body.append(p);}
  for(const [s,section] of (row.sections||column.sections||[]).entries()){
   const group=document.createElement('div');group.className='column-section';const heading=document.createElement('h4');heading.textContent=`Section ${s+1}`;group.append(heading);field(group,'Starts at height',[...prefix('sections'),s,'start']);
   const table=document.createElement('table');table.innerHTML='<thead><tr><th>Thickness</th><th>Hardness</th><th>Material</th></tr></thead>';const tbody=document.createElement('tbody');table.append(tbody);group.append(table);
   for(const [b] of section.beds.entries()){const tr=document.createElement('tr');for(const [i,label,options] of [[0,'thickness',{min:.001}],[1,'hardness',{min:0,max:1}],[2,'material',{choices:Array.from({length:column.colors?.length||5},(_,i)=>[i,`Slot ${i+1}`])}]]){const td=document.createElement('td');const input=field(td,`Section ${s+1}, bed ${b+1} ${label}`,[...prefix('sections'),s,'beds',b,i],options);input.parentNode.firstChild.textContent='';tr.append(td);}tbody.append(tr);}body.append(group);
  }
  const bands=row.bands||column.bands;if(bands){const group=document.createElement('div');group.className='column-options';const h=document.createElement('h4');h.textContent='Contour bands';body.append(h,group);field(group,'Height step',[...prefix('bands'),0],{min:.001});field(group,'Line strength',[...prefix('bands'),1],{min:0,max:1});}
  const options=document.createElement('div');options.className='column-options';body.append(options);
  if(column.origin!==undefined)field(options,'Count height from',['origin'],{choices:[['plain','Dry plain'],['sea','Sea level']]});
  if(column.wander?.value!==undefined)field(options,'Bed wander',['wander','value']);
  column.wander?.terrain?.forEach((_,i)=>field(options,['Broad wander','Medium wander','Fine wander'][i],['wander','terrain',i]));
  if(column.colors){const colors=document.createElement('details');colors.className='feature-group';colors.open=true;colors.innerHTML='<summary>Material slot colors</summary>';const fields=document.createElement('div');fields.className='column-options';colors.append(fields);column.colors.forEach((_,i)=>field(fields,`Slot ${i+1}`,['colors',i],{color:true}));body.append(colors);}
 }
 restore.onclick=()=>{reset();sync();};sync();return sync;
}
