import {worldControlRequirement,WORLD_PRIMARY_CONTROLS} from './sculpt-control-schema.js';
import {mountWorkspace} from './sculpt-workspace.js';
import {COLUMN_BEDS,COLUMN_SECTIONS,COLUMN_SLOTS,FIRST_SECTION} from './sculpt-column.js';
// Presentation helpers; terrain state and history stay in sculpt.js.
const $=id=>document.getElementById(id);
export function mountEditorUI(){
 const app=document.querySelector('.app');
 // Which panels show, and whether the tool rail is expanded into the palette (every tool in view): one remembered object.
 let panels={tools:true,inspector:true,palette:false},beforeFocus=null;
 try{panels={...panels,...JSON.parse(localStorage.getItem('terraform-editor-panels')||'{}')};}catch{}
 const focused=()=>beforeFocus!==null;
 function updateLayout(){
  const showTools=!focused()&&panels.tools,showInspector=!focused()&&panels.inspector;
  app.classList.toggle('tools-collapsed',!showTools);app.classList.toggle('inspector-collapsed',!showInspector);app.classList.toggle('palette-open',Boolean(panels.palette));
  $('tools-sidebar').hidden=!showTools;$('inspector-sidebar').hidden=!showInspector;
  for(const [id,on,label] of [['toggle-tools',showTools,'tools'],['toggle-inspector',showInspector,'side panel']]){const b=$(id);b.setAttribute('aria-expanded',String(on));b.title=`${on?'Hide':'Show'} ${label}`;}
  $('focus-canvas').setAttribute('aria-pressed',String(focused()));$('focus-canvas').querySelector('span').textContent=focused()?'Restore':'Focus';
  const pin=$('palette-toggle');pin.setAttribute('aria-pressed',String(Boolean(panels.palette)));pin.firstElementChild.textContent=panels.palette?'«':'»';pin.lastElementChild.textContent=panels.palette?'Collapse':'Expand';
  pin.title=panels.palette?'Collapse the tools to a rail':'Keep every tool in view, with its picture and name';
  if(panels.palette||!showTools)closeFlyouts();
  if(!showInspector)setLarge(false);
  try{localStorage.setItem('terraform-editor-panels',JSON.stringify(panels));}catch{}
 }
 function togglePanel(name){if(focused()){panels={...panels,tools:false,inspector:false};beforeFocus=null;}panels[name]=!panels[name];updateLayout();}
 function exitFocus(){if(!focused())return false;panels=beforeFocus;beforeFocus=null;updateLayout();return true;}
 function toggleFocus(){if(!exitFocus()){beforeFocus={...panels};closeSurfaces();updateLayout();}}
 $('toggle-tools').onclick=()=>togglePanel('tools');$('toggle-inspector').onclick=()=>togglePanel('inspector');$('focus-canvas').onclick=toggleFocus;
 $('palette-toggle').onclick=()=>{panels.palette=!panels.palette;updateLayout();};
 // The rail: Land, Water and Brushes each open their tools beside the rail; one is open at a time, and picking a tool closes it.
 const grouped=document.querySelector('.tool-groups'),rails=[...grouped.querySelectorAll('.rail-button')];
 function closeFlyouts(){let any=false;for(const r of rails){if(r.getAttribute('aria-expanded')==='true')any=true;r.setAttribute('aria-expanded','false');}return any;}
 for(const r of rails)r.onclick=()=>{if(panels.palette)return;const open=r.getAttribute('aria-expanded')==='true';closeFlyouts();closeSurfaces();r.setAttribute('aria-expanded',String(!open));};
 grouped.addEventListener('click',e=>{if(e.target.closest('.tool-flyout button'))closeFlyouts();});
 const syncTools=(active,selected,locked,features)=>{
  for(const b of grouped.querySelectorAll('button')){
   b.disabled=locked;if(b.classList.contains('rail-button'))continue;
   b.setAttribute('aria-pressed',String(features?b.id==='feature-tool':b.dataset.tool===active));
  }
  // A rail button is lit while the tool in hand is one of its group.
  for(const r of rails)r.classList.toggle('has-current',!features&&Boolean(r.parentElement.querySelector(`[data-tool="${CSS.escape(active||'')}"]`)));
 };
 mountWorkspace();
 // The side panel: Build (the tool or the selection) or World.
 const tabs=[...document.querySelectorAll('[role="tab"]')];
 function activate(tab){for(const t of tabs){const active=t===tab;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;$(t.getAttribute('aria-controls')).hidden=!active;}if(tab.id!=='tab-tool')setLarge(false);}
 for(const t of tabs){t.onclick=()=>{if($('inspector-sidebar').hidden)togglePanel('inspector');activate(t);};t.onkeydown=e=>{const i=tabs.indexOf(t);let j;if(e.key==='ArrowRight')j=(i+1)%tabs.length;if(e.key==='ArrowLeft')j=(i+tabs.length-1)%tabs.length;if(e.key==='Home')j=0;if(e.key==='End')j=tabs.length-1;if(j!==undefined){e.preventDefault();activate(tabs[j]);tabs[j].focus();}};}
 // The surfaces: the Map menu, Settings, Export and the Shapes list each open from their own button, in a fixed place. The three menus
 // close when another opens or the pointer goes down elsewhere; the Shapes list stays while you work on the map.
 const surfaces=[['tab-map','pane-map',true],['open-graphics','pane-graphics',true],['open-export','pane-export',true],['tab-objects','pane-objects',false]];
 function setSurface(button,pane,open){$(pane).hidden=!open;$(button).setAttribute('aria-expanded',String(open));}
 function closeSurfaces(menusOnly=false){let any=false;for(const [button,pane,menu] of surfaces)if(!$(pane).hidden&&(menu||!menusOnly)){setSurface(button,pane,false);any=true;}return any;}
 for(const [button,pane,menu] of surfaces)$(button).onclick=()=>{const open=$(pane).hidden;if(menu)closeSurfaces(true);closeFlyouts();setSurface(button,pane,open);};
 document.addEventListener('pointerdown',e=>{
  const t=e.target instanceof Element?e.target:null;if(!t)return;
  if(!t.closest('.tool-group'))closeFlyouts();
  for(const [button,pane,menu] of surfaces)if(menu&&!$(pane).hidden&&!t.closest('#'+pane)&&!t.closest('#'+button))setSurface(button,pane,false);
  for(const d of document.querySelectorAll('details.top-menu[open]'))if(!d.contains(t))d.open=false;
 },true);
 // The curve editors at full size: the same element, laid over the map view while the button is pressed.
 function setLarge(on){if(app.classList.contains('curves-large')===on)return false;app.classList.toggle('curves-large',on);$('curve-large').setAttribute('aria-pressed',String(on));$('curve-large').textContent=on?'✕ Close':'⤢ Full size';return true;}
 $('curve-large').onclick=()=>setLarge(!app.classList.contains('curves-large'));
 new MutationObserver(()=>{if($('section-preview-control').hidden)setLarge(false);}).observe($('section-preview-control'),{attributes:true,attributeFilter:['hidden']});
 // The curves are rows of the card's Profile section: folding it away closes them at full size too.
 $('card-profile').addEventListener('toggle',()=>{if(!$('card-profile').open)setLarge(false);});
 // Escape closes what is open on top of the editor, one thing a press: a tool flyout, a menu, the full-size curves.
 const closeTop=()=>closeFlyouts()||closeSurfaces(true)||[...document.querySelectorAll('details.top-menu[open],details.share-menu[open],details.status-details[open]')].some(d=>(d.open=false,true))||setLarge(false);
 for(const [id,on] of [['view-rendered',false],['view-clay',true]])$(id).onclick=()=>{$('clay').checked=on;$('clay').dispatchEvent(new Event('change'));};
 updateLayout();
 return {toggleFocus,exitFocus,syncTools,closeTop,focused};
}
// Each effect owns its controlling value and its dependent parameters. Zero
// means off; switching back on restores the last value for this tool/selection.
// buildRow(field) returns a new control row; each row is created for its group and placed there once.
export function groupToolControls(fields,buildRow){
 const groups=[],details=[],claimed=new Set(),field=key=>fields.find(f=>f[0]===key);
 const build=keys=>keys.map(field).filter(Boolean).map(f=>{claimed.add(f[0]);return buildRow(f);});
 // The card's own sections (written in sculpt.html): each generated row is created into its section's slot, in this order.
 const placed={'card-profile-rows':['lean','facing'],'card-size-rows':['heightReference','elevation','combine','routeSmooth','paintChannel'],'card-rock-rows':['rockPreset','styleVegetation'],
  'card-outline-rows':['wander','widthVary','heightVary','varySize','wallVary','varyFoot','varyMiddle','faceVariation','crestTaper']};
 const rows=Object.fromEntries(Object.entries(placed).map(([slot,keys])=>{const made=build(keys);$(slot).append(...made);return [slot,made];}));
 const own=id=>$(id).closest('.control');
 for(const [id,controls] of [['card-profile',[$('section-preview-control'),...rows['card-profile-rows']]],['card-size',[own('diameter'),own('amount'),own('roughness'),own('softness'),...rows['card-size-rows']]],
  ['card-rock',[...rows['card-rock-rows'],$('cracks-control')]],['card-outline',rows['card-outline-rows']],['card-advanced',[$('seed-control'),own('tool-style')]]])groups.push({d:$(id),controls,fixed:true});
 // Details: optional parts of a shape, each a group. Closed, a group is a chip; a group with a master row (its amount, where 0 is off)
 // turns on from its chip and off from the switch in its heading. [master key, title, rows, open at first]
 const definitions=[
 ['gullies','Gullies',['gullies','gullySize','talus']],
 ['','Hard beds',['beds','bedSoft']],
 ['','Steps',['stepReference','terraces','ledge','terraceJitter','breakup','layerPx','layerRiser','layerVary','layerCircle','lavaSpread','lavaCircleVary','layerJag']],
 ['spurCount','Spurs',['spurCount','spurLength','spurSpread','spurWidth','spurTaper','spurHeight','spurForks','spurBulb','crestVary']],
 ['iceFacets','Facets',['iceFacets','facetForm','facetSurface','iceFacetSize','crystalStep','crystalTiers','crystalFacet','crystalSizeVar','crystalSides','crystalTop','crystalVariation','crystalAlign','bergJitter','bergBreak','bergRough']],
 ['','Impact',['ejecta','buckling','secondaries','secondaryDistance']],
 ['','Shore',['fingers','fingerSize','shorePlates','plateMaterial','plateWaterPx','plateLandPx','plateSize','plateGap','plateHeight','plateVary','frostNeedles','crystalShoreSeam','waterDeep','waterShore','surf']],
 ['','Cut',['fissureWidth','fissureJag','fissureTaper','fissureCrack','fissureDark'],true],
 ['fissureBranches','Branches',['fissureBranches','fissureBranchLen','fissureBranchSpread']],['fissureNetwork','Fracture network',['fissureNetwork','fissureCell']]
 ];
 function make(title,controls,masterId=null,first=false){
  const d=document.createElement('details');d.className='feature-group';d.dataset.part=title;const summary=document.createElement('summary');summary.textContent=title;d.append(summary);const body=document.createElement('div');body.className='feature-body';d.append(body);body.append(...controls);
  const g={d,controls,first,memory:new Map(),lastContext:null};groups.push(g);details.push(g);
  if(!masterId)return;
  const box=document.createElement('input');box.type='checkbox';box.setAttribute('aria-label',`Enable ${title}`);summary.append(box);d.classList.add('has-master');
  const master=g.master=d.querySelector('#'+masterId);g.box=box;
  box.addEventListener('click',e=>e.stopPropagation());
  box.addEventListener('change',()=>{const key=d.dataset.context,previous=Number(master.value);if(!box.checked&&previous!==0)g.memory.set(key,previous);master.value=box.checked?(g.memory.get(key)||(master.tagName==='SELECT'?[...master.options].find(o=>Number(o.value)!==0)?.value:Math.max(Number(master.step)||1,Math.min(Number(master.max),Number(master.max)*.5)))):0;master.dispatchEvent(new Event('input',{bubbles:true}));master.dispatchEvent(new Event('change',{bubbles:true}));d.open=box.checked;});
  // The chip of a part that is off adds it (at the value it last had, or its default) and opens its rows.
  summary.addEventListener('click',e=>{if(d.open||Number(master.value)!==0)return;e.preventDefault();box.checked=true;box.dispatchEvent(new Event('change'));});
 }
 for(const [key,label,keys,first] of definitions){if(!keys.some(field))continue;make(label,build(keys),key?field(key)[1]:null,first);}
 // A row no section or part names gets a part of its own, as before.
 for(const f of fields){const [key,id,label,,lo]=f;if(claimed.has(key))continue;make(label.replace(/ \(.*$/,''),[buildRow(f)],lo<=0?id:null);}
 $('shape-options').append(...details.map(g=>g.d));
 // Called on each tool or selection change and on each edit. A section or part with no row to show hides. The card's sections keep the
 // openness the artist left them in; a part opens when it is on (or is the tool's main part) as its shape comes up, and an edit never
 // closes one: only its switch does.
 return context=>{
  for(const g of groups){
   g.d.hidden=g.controls.every(c=>c.hidden);if(g.fixed)continue;g.d.dataset.context=context;
   if(!g.master){if(g.lastContext!==context)g.d.open=Boolean(g.first);g.lastContext=context;continue;}
   const on=Number(g.master.value)!==0;if(on)g.memory.set(context,Number(g.master.value));g.box.checked=on;g.d.classList.toggle('is-off',!on);if(g.lastContext!==context)g.d.open=on;g.lastContext=context;
  }
  $('card-details').hidden=details.every(g=>g.d.hidden);
 };
}

// One level of open sections keeps related controls together for scrolling.
const worldSection=name=>['Shine: rock','Loose stone'].includes(name)?'Rock & cliffs':/Light|Shine/.test(name)?'Lighting':/Ground|Vegetation|Material coverage/.test(name)?'Ground & vegetation':/Water|Shore|Needle|Contour fringe|Terrace creases/.test(name)?'Water & shores':/Rock|Strata|Cracks|Contour bands|Microfacets/.test(name)?'Rock & cliffs':'Materials & texture';
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
 const state=()=>{const {edited}=read();restore.disabled=!edited;note.textContent=edited?'Map column edited.':'Using the world column unchanged.';};
 function field(parent,label,path,{min,max,step='any',choices,color=false}={}){
  const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement(choices?'select':'input');input.dataset.columnPath=path.join('.');input.setAttribute('aria-label',label);
  const value=at(read().column,path);if(choices){input.replaceChildren(...choices.map(([v,text])=>new Option(text,v)));input.value=value;}
  else{input.type=color?'color':'number';input.required=true;input.value=color?'#'+value.map(v=>Math.round(v).toString(16).padStart(2,'0')).join(''):value;input.step=step;if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;}
  input.oninput=()=>{input.setCustomValidity('');if(!input.checkValidity()){note.textContent='Enter a value within the displayed limits.';return;}const column=structuredClone(read().column),target=at(column,path.slice(0,-1));target[path.at(-1)]=color?[1,3,5].map(i=>parseInt(input.value.slice(i,i+2),16)):choices?input.value:Number(input.value);if(choices&&typeof value==='number')target[path.at(-1)]=Number(input.value);
   try{change(column);state();}catch(err){input.setCustomValidity(err.message);note.textContent=err.message;}
  };
  input.onchange=()=>{commit();if(!input.checkValidity())sync();};wrap.append(input);parent.append(wrap);return input;
 }
 // A section or bed added or removed: the edited copy is one change and one undo step, and the panel is drawn again for the new rows.
 function reshape(edit){const column=structuredClone(read().column||{});edit(column);try{change(column);commit();}catch(err){note.textContent=err.message;return;}sync();}
 function button(parent,text,label,onclick,disabled=false){const b=document.createElement('button');b.type='button';b.textContent=text;if(label)b.setAttribute('aria-label',label);b.disabled=disabled;b.onclick=onclick;parent.append(b);return b;}
 function sync(){
  const {column,variant}=read();body.replaceChildren();state();
  // The sections the active row draws: a variant's own row, else the column's (a world or map without any has no column, and adds one here).
  const row=column?.variants?.[variant]||{},prefix=key=>row[key]?['variants',variant,key]:[key],path=prefix('sections');
  const sections=row.sections||column?.sections||[],beds=sections.reduce((n,s)=>n+s.beds.length,0),slots=column?.colors?.length||COLUMN_SLOTS;
  const edit=fn=>()=>reshape(c=>{const parent=at(c,path.slice(0,-1));parent[path.at(-1)]??=[];fn(parent[path.at(-1)]);});
  if(variant){const p=document.createElement('p');p.className='small';p.textContent=`Column row: ${$('variant-select').selectedOptions[0]?.textContent||variant}`;body.append(p);}
  if(!sections.length){
   const p=document.createElement('p');p.className='small';p.textContent='This map has no rock column. Strata, the Foot color band and Cap color paint its beds: add one to use them.';body.append(p);
   button(body,'Add a rock column','',edit(list=>list.push(structuredClone(FIRST_SECTION))));
  }
  for(const [s,section] of sections.entries()){
   const group=document.createElement('div');group.className='column-section';const heading=document.createElement('h4');heading.textContent=`Section ${s+1}`;group.append(heading);
   button(heading,'Remove',`Remove section ${s+1}`,edit(list=>list.splice(s,1)));
   field(group,'Starts at height',[...path,s,'start']);
   const table=document.createElement('table');table.innerHTML='<thead><tr><th>Thickness</th><th>Hardness</th><th>Material</th><th><span class="sr-only">Remove</span></th></tr></thead>';const tbody=document.createElement('tbody');table.append(tbody);group.append(table);
   for(const [b] of section.beds.entries()){const tr=document.createElement('tr');for(const [i,label,options] of [[0,'thickness',{min:.001}],[1,'hardness',{min:0,max:1}],[2,'material',{choices:Array.from({length:slots},(_,i)=>[i,`Slot ${i+1}`])}]]){const td=document.createElement('td');const input=field(td,`Section ${s+1}, bed ${b+1} ${label}`,[...path,s,'beds',b,i],options);input.parentNode.firstChild.textContent='';tr.append(td);}
    const td=document.createElement('td');button(td,'\u00d7',`Remove section ${s+1}, bed ${b+1}`,edit(list=>list[s].beds.splice(b,1)),section.beds.length<2);tr.append(td);tbody.append(tr);}
   // A new bed repeats the section's last one; the uniforms hold COLUMN_BEDS in all.
   button(group,'Add bed',`Add a bed to section ${s+1}`,edit(list=>list[s].beds.push([...section.beds.at(-1)])),beds>=COLUMN_BEDS);
   body.append(group);
  }
  // A new section starts 16 units above the last and repeats its beds, as many as the uniforms have room for.
  if(sections.length)button(body,'Add section','',edit(list=>list.push({start:sections.at(-1).start+16,beds:structuredClone(sections.at(-1).beds.slice(0,COLUMN_BEDS-beds))})),sections.length>=COLUMN_SECTIONS||beds>=COLUMN_BEDS);
  const bands=row.bands||column?.bands;if(bands){const group=document.createElement('div');group.className='column-options';const h=document.createElement('h4');h.textContent='Contour bands';body.append(h,group);field(group,'Height step',[...prefix('bands'),0],{min:.001});field(group,'Line strength',[...prefix('bands'),1],{min:0,max:1});}
  const options=document.createElement('div');options.className='column-options';body.append(options);
  if(column?.origin!==undefined)field(options,'Count height from',['origin'],{choices:[['plain','Dry plain'],['sea','Sea level']]});
  if(column?.wander?.value!==undefined)field(options,'Bed wander',['wander','value']);
  column?.wander?.terrain?.forEach((_,i)=>field(options,['Broad wander','Medium wander','Fine wander'][i],['wander','terrain',i]));
  if(column?.colors){const colors=document.createElement('details');colors.className='feature-group';colors.open=true;colors.innerHTML='<summary>Material slot colors</summary>';const fields=document.createElement('div');fields.className='column-options';colors.append(fields);column.colors.forEach((_,i)=>field(fields,`Slot ${i+1}`,['colors',i],{color:true}));body.append(colors);}
 }
 restore.onclick=()=>{reset();sync();};sync();return sync;
}
