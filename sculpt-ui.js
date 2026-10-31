// Presentation helpers; terrain state and history stay in sculpt.js.
const $=id=>document.getElementById(id);
const paths={
 move:'M5 3l14 10-7 1-3 7z',plateau:'M2 20l5-12h10l5 12M7 8V5h10v3',hill:'M2 20Q12 0 22 20',mountain:'M2 21L10 4l4 7 3-4 5 14M7 10l3 3 3-3',ramp:'M3 19L21 5v14z',deep:'M2 7q3 4 6 0t6 0t8 0M2 13q3 4 6 0t6 0t8 0M2 19q3 4 6 0t6 0t8 0',shallow:'M2 11q3 4 6 0t6 0t8 0M2 17q3 4 6 0t6 0t8 0',smooth:'M2 17q5-14 10-4t10-4',offset:'M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5',crater:'M2 13q10 14 20 0M2 13q3-6 7 0t13 0',fissure:'M14 2l-6 7 8 2-7 5 3 6',erase:'M3 14L13 3l8 8-9 10H9zM7 10l9 8M12 21h10',crystal:'M12 2l7 7-2 11-5 3-5-3-2-11zM12 2v21M5 9h14',sand:'M3 16q6-9 12-3t7-1M3 21h1m5-2h1m5 2h1m4-3h1',grass:'M12 22V8M12 16Q3 16 3 6q9 0 9 10M12 13q0-9 9-9 0 9-9 9',paint:'M15 3l6 6-10 10-6-6zM4 16q-4 5 1 6 5 0 3-4',features:'M12 2l9 6v9l-9 5-9-5V8zM3 8l9 6 9-6M12 14v8'};
const colors={move:'#e9e7d6',plateau:'#e6bb82',hill:'#b8d88d',mountain:'#b3bcca',ramp:'#e5cfa5',deep:'#7cb8e8',shallow:'#87d9da',smooth:'#c1acdf',offset:'#e3af9e',crater:'#d5a18b',fissure:'#eab481',erase:'#d1bbaa',crystal:'#aaa5ec',sand:'#ead095',grass:'#9ad09d',paint:'#df98c4',features:'#efc975'};
export function toolIcon(kind){return `<svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[kind]||paths.plateau}"/></svg>`;}
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
 const palette=document.querySelector('.tool-palette .tools');
 palette.prepend(palette.querySelector('[data-tool="move"]'));
 const feature=document.createElement('button');feature.id='feature-tool';feature.dataset.icon='features';feature.textContent='Features & starts';feature.setAttribute('aria-pressed','false');palette.append(feature);
 for(const b of palette.children){const label=b.textContent,kind=b.dataset.tool||b.dataset.icon;b.style.setProperty('--tool-color',colors[kind]);b.setAttribute('aria-label',label);b.title=label;b.innerHTML=toolIcon(kind)+`<span class="tool-label">${label}</span>`;}
 const grouped=document.createElement('div');grouped.className='tool-groups';
 const primary=document.createElement('div');primary.className='tools primary-tools';primary.setAttribute('role','group');primary.setAttribute('aria-label','Select and place');
 for(const kind of ['move','features']){const b=palette.querySelector(`[data-tool="${kind}"], [data-icon="${kind}"]`);b.querySelector('.tool-label').textContent=kind==='move'?'Select':'Features';if(kind==='move')b.title='Select · V';primary.append(b);}grouped.append(primary);
 for(const [label,kinds] of [['Land',['plateau','hill','mountain','ramp','offset','crater','fissure','crystal']],['Water',['deep','shallow']],['Surface',['smooth','erase','sand','grass','paint']]]){
  const section=document.createElement('div');section.className='tool-group';section.setAttribute('role','group');section.setAttribute('aria-label',label+' tools');
  const heading=document.createElement('span');heading.className='tool-group-label';heading.textContent=label;
  const buttons=document.createElement('div');buttons.className='tools';for(const kind of kinds)buttons.append(palette.querySelector(`[data-tool="${kind}"]`));
  section.append(heading,buttons);grouped.append(section);
 }
 palette.replaceWith(grouped);
 const surface=document.createElement('details');surface.className='panel';surface.innerHTML='<summary>Surface detail</summary>';
 for(const id of ['relief','transition-detail'])surface.append($(id).closest('.control'));surface.append($('ring-controls'));$('knobs').before(surface);
 const tabs=[...document.querySelectorAll('[role="tab"]')];
 function activate(tab){for(const t of tabs){const active=t===tab;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;$(t.getAttribute('aria-controls')).hidden=!active;}}
 for(const [i,t] of tabs.entries()){t.onclick=()=>activate(t);t.onkeydown=e=>{let j;if(e.key==='ArrowRight')j=(i+1)%tabs.length;if(e.key==='ArrowLeft')j=(i+tabs.length-1)%tabs.length;if(e.key==='Home')j=0;if(e.key==='End')j=tabs.length-1;if(j!==undefined){e.preventDefault();activate(tabs[j]);tabs[j].focus();}};}
 for(const [id,on] of [['view-rendered',false],['view-clay',true]])$(id).onclick=()=>{$('clay').checked=on;$('clay').dispatchEvent(new Event('change'));};
 return {toggleFocus,exitFocus};
}
// Each effect owns its controlling value and its dependent parameters. Zero
// means off; switching back on restores the last value for this tool/selection.
export function groupToolControls(fields){
 const root=$('shape-options'),groups=[],claimed=new Set();
 const definitions=[
 ['profile','Cross-section',['profile','apronPx','apronHeight','facePx','faceCurve','terraces','ledge','terraceJitter','lip','crown','shelfPx','shelfDepth','shelfSteps']],
 ['fingers','Finger coasts',['fingers','fingerAmount','fingerSize','fingerSpread','fingerHeight']],
 ['shoreLayers','Shore layers',['shoreLayers','layerPx','layerRiser','layerLedge','layerRough','layerStyle','layerVary','layerCircle','lavaMeander','lavaSpread','lavaCircleVary']],
 ['spurCount','Spurs',['spurCount','spurLength','spurSpread','spurWidth','spurTaper','spurHeight','spurForks','spurBulb']],
 ['rimSectors','Rim sectors',['rimSectors','rimUnequal']],['rimGaps','Rim gaps',['rimGaps','rimGapWidth']],
 ['fissureBranches','Branches',['fissureBranches','fissureBranchLen','fissureBranchSpread']],['fissureNetwork','Fracture network',['fissureNetwork','fissureCell']],
 ['shorePlates','Shore plates',['shorePlates','plateWaterPx','plateLandPx','plateSize','plateGap','plateHeight','plateMaterial','frostNeedles','crystalShoreScale','crystalShoreSeam']],
 ['maskChannel','Paint inside shape',['maskChannel','maskAmount']],['craterFacets','Crystal facets',['craterFacets','crystalCraterPx','crystalCraterStep','crystalCraterSkin']],['iceFacets','Angular facets',['iceFacets','iceFacetSize']]
 ];
 function make(title,controls,master=null){
  const d=document.createElement('details');d.className='feature-group';const summary=document.createElement('summary');summary.textContent=title;d.append(summary);const body=document.createElement('div');body.className='feature-body';d.append(body);for(const c of controls)body.append(c);
  const memory=new Map();let box;
  if(master){box=document.createElement('input');box.type='checkbox';box.setAttribute('aria-label',`Enable ${title}`);summary.append(box);box.addEventListener('click',e=>e.stopPropagation());box.addEventListener('change',()=>{const key=d.dataset.context,previous=Number(master.value);if(!box.checked&&previous!==0)memory.set(key,previous);master.value=box.checked?(memory.get(key)||(master.tagName==='SELECT'?[...master.options].find(o=>Number(o.value)!==0)?.value:Math.max(Number(master.step)||1,Math.min(Number(master.max),Number(master.max)*.5)))):0;master.dispatchEvent(new Event('input',{bubbles:true}));master.dispatchEvent(new Event('change',{bubbles:true}));d.open=box.checked;});}
  groups.push({d,controls,master,box,memory,lastContext:null,lastOn:null});return d;
 }
 const basicIds=['tool-style','diameter','amount','roughness','softness','bank-width','shallow-mode'];
 const basics=make('Brush settings',basicIds.map(id=>$(id).closest('.control')));basics.open=true;basics.classList.add('brush-basics');root.before(basics);
 basics.after(make('Seed',[$('seed').closest('.control')]));
 for(const [key,label,keys] of definitions){const present=fields.filter(f=>keys.includes(f[0]));if(!present.length)continue;present.forEach(f=>claimed.add(f[0]));const controls=present.map(f=>$(f[1]+'-control'));if(key==='profile')controls.push($('section-preview-control'));root.append(make(label,controls,$(present.find(f=>f[0]===key)[1])));}
 for(const [key,id,label,,lo] of fields){if(claimed.has(key))continue;root.append(make(label.replace(/ \(.*$/,''),[$(id+'-control')],lo<=0&&!['crystalForm','bergTiltDir','bankPx'].includes(key)?$(id):null));}
 for(const [id,label] of [['cracks','Cracks'],['shelves','Automatic shallows'],['beach-flatness','Beach flatness']])root.prepend(make(label,[$(id).closest('.control')],$(id)));
 return context=>{for(const g of groups){g.d.hidden=g.controls.every(c=>c.hidden);g.d.dataset.context=context;if(!g.master){if(g.lastContext!==context&&!g.d.classList.contains('brush-basics'))g.d.open=g.controls.some(c=>c.id==='crystal-form-control'||c.id==='paint-channel-control');g.lastContext=context;continue;}const on=Number(g.master.value)!==0;if(on)g.memory.set(context,Number(g.master.value));g.box.checked=on;g.d.classList.toggle('is-off',!on);if(g.lastContext!==context||g.lastOn!==on)g.d.open=on;g.lastContext=context;g.lastOn=on;}};
}
