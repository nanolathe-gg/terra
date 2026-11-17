import {worldControlRequirement,WORLD_PRIMARY_CONTROLS} from './sculpt-control-schema.js';
import {mountWorkspace} from './sculpt-workspace.js';
import {COLUMN_BEDS,COLUMN_SECTIONS,COLUMN_SLOTS,FIRST_SECTION} from './sculpt-column.js';
import {mountFind} from './sculpt-find.js';
// Presentation helpers; terrain state and history stay in sculpt.js.
const $=id=>document.getElementById(id);
export function mountEditorUI(){
 const app=document.querySelector('.app');
 // Which panels show, and whether the tool rail is expanded into the palette (every tool in view): one remembered object.
 let panels={tools:true,inspector:true,palette:false},beforeFocus=null;
 try{panels={...panels,...JSON.parse(localStorage.getItem('terraform-editor-panels')||'{}')};}catch{}
 const savePanels=()=>{try{localStorage.setItem('terraform-editor-panels',JSON.stringify(panels));}catch{}};
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
  savePanels();
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
 // Pick (picking) and Features or Starts (features) stand in for the tool in hand while they are on.
 const syncTools=(active,selected,locked,features,picking=false)=>{
  for(const b of grouped.querySelectorAll('button')){
   b.disabled=locked;if(b.classList.contains('rail-button'))continue;
   b.setAttribute('aria-pressed',String(picking?b.id==='pick-tool':features?b.id===(features==='starts'?'starts-tool':'feature-tool'):b.dataset.tool===active));
  }
  // A rail button is lit while the tool in hand is one of its group.
  for(const r of rails)r.classList.toggle('has-current',!features&&!picking&&Boolean(r.parentElement.querySelector(`[data-tool="${CSS.escape(active||'')}"]`)));
 };
 mountWorkspace();
 // The side panel: Build (the tool or the selection) or World.
 const tabs=[...document.querySelectorAll('.mode-switch [role="tab"]')];
 function activate(tab){for(const t of tabs){const active=t===tab;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;$(t.getAttribute('aria-controls')).hidden=!active;}app.classList.toggle('world-mode',tab.id==='tab-world');if(tab.id!=='tab-tool')setLarge(false);}
 for(const t of tabs){t.onclick=()=>{if($('inspector-sidebar').hidden)togglePanel('inspector');activate(t);};t.onkeydown=e=>{const i=tabs.indexOf(t);let j;if(e.key==='ArrowRight')j=(i+1)%tabs.length;if(e.key==='ArrowLeft')j=(i+tabs.length-1)%tabs.length;if(e.key==='Home')j=0;if(e.key==='End')j=tabs.length-1;if(j!==undefined){e.preventDefault();activate(tabs[j]);tabs[j].focus();}};}
 // The surfaces: the Map menu, View, Export and the Shapes list each open from their own button, in a fixed place. The three menus
 // close when another opens or the pointer goes down elsewhere; the Shapes list stays while you work on the map. A menu closes with
 // the Share link folded inside it, so the next opening makes a new link.
 const surfaces=[['tab-map','pane-map',true],['open-graphics','pane-graphics',true],['open-export','pane-export',true],['tab-objects','pane-objects',false]];
 function setSurface(button,pane,open){$(pane).hidden=!open;$(button).setAttribute('aria-expanded',String(open));if(!open)for(const d of $(pane).querySelectorAll('details.share-menu[open]'))d.open=false;}
 function closeSurfaces(menusOnly=false){let any=false;for(const [button,pane,menu] of surfaces)if(!$(pane).hidden&&(menu||!menusOnly)){setSurface(button,pane,false);any=true;}return any;}
 for(const [button,pane,menu] of surfaces)$(button).onclick=()=>{const open=$(pane).hidden;if(menu)closeSurfaces(true);closeFlyouts();setSurface(button,pane,open);};
 // The Map menu's file actions close it: New opens its dialog, Open a file picker, Save a download.
 $('pane-map').addEventListener('click',e=>{if(e.target.closest('#new-map,#load,#save'))setSurface('tab-map','pane-map',false);});
 // The View button names the view in use (Art, Clay or Passability), whichever script presses it.
 const views=['view-rendered','view-clay','view-passability'].map($),showView=()=>{$('view-name').textContent=(views.find(b=>b.getAttribute('aria-pressed')==='true')||views[0]).textContent;};
 new MutationObserver(showView).observe($('pane-graphics').querySelector('.view-switch'),{attributes:true,subtree:true,attributeFilter:['aria-pressed']});showView();
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
 // Escape closes what is open on top of the editor, one thing a press, innermost first: Find, a tool flyout, a folded menu (Share link
 // inside the Map menu, say), a menu, the full-size curves.
 const find=mountFind();
 const closeTop=()=>find.close()||closeFlyouts()||[...document.querySelectorAll('details.top-menu[open],details.share-menu[open],details.status-details[open]')].some(d=>(d.open=false,true))||closeSurfaces(true)||setLarge(false);
 for(const [id,on] of [['view-rendered',false],['view-clay',true]])$(id).onclick=()=>{$('clay').checked=on;$('clay').dispatchEvent(new Event('change'));};
 updateLayout();
 return {toggleFocus,exitFocus,syncTools,closeTop,focused,get terrainBudget(){return panels.terrainBudget;},setTerrainBudget(value){panels.terrainBudget=value;if(beforeFocus)beforeFocus.terrainBudget=value;savePanels();}};
}
// Each effect owns its controlling value and its dependent parameters. Zero
// means off; switching back on restores the last value for this tool/selection.
// buildRow(field) returns a new control row; each row is created for its group and placed there once.
export function groupToolControls(fields,buildRow){
 const groups=[],details=[],claimed=new Set(['groundPreset']),field=key=>fields.find(f=>f[0]===key);
 const build=keys=>keys.map(field).filter(Boolean).map(f=>{claimed.add(f[0]);return buildRow(f);});
 // The card's own sections (written in index.html): each generated row is created into its section's slot, in this order.
 const placed={'card-profile-rows':['lean','facing'],'card-size-rows':['heightReference','elevation','combine','routeSmooth','paintChannel'],'card-rock-rows':['rockPreset','styleVegetation'],
  'card-outline-rows':['wander','widthVary','heightVary','varySize','wallVary','varyFoot','varyMiddle','faceVariation','crestTaper']};
 const rows=Object.fromEntries(Object.entries(placed).map(([slot,keys])=>{const made=build(keys);$(slot).append(...made);return [slot,made];}));
 const own=id=>$(id).closest('.control');
 for(const [id,controls] of [['card-profile',[$('section-preview-control'),...rows['card-profile-rows']]],['card-size',[own('diameter'),own('amount'),own('roughness'),own('softness'),...rows['card-size-rows']]],
  ['card-rock',[...rows['card-rock-rows'],$('lf-ground-control'),$('cracks-control')]],['card-outline',rows['card-outline-rows']],['card-advanced',[$('seed-control'),own('tool-style')]]])groups.push({d:$(id),controls,fixed:true});
 // Details: optional parts of a shape, each a group. Closed, a group is a chip; a group with a master row (its amount, where 0 is off)
 // turns on from its chip and off from the switch in its heading. [master key, title, rows, open at first]
 const definitions=[
 ['gullies','Gullies',['gullies','gullySize','talus','talusLumps']],
 ['','Hard beds',['beds','bedSoft']],
 ['','Steps',['stepReference','terraces','ledge','terraceJitter','breakup','layerPx','layerRiser','layerVary','layerCircle','lavaSpread','lavaCircleVary','layerJag']],
 ['rimGaps','Gaps',['rimGaps','rimGapWidth','rimGapDepth']],
 ['scatterCount','Copies',['scatterCount','scatterSpread','scatterSize','scatterVary']],
 ['spurCount','Spurs',['spurCount','spurLength','spurSpread','spurWidth','spurTaper','spurHeight','spurForks','spurBulb','crestVary']],
 ['iceFacets','Facets',['iceFacets','facetForm','facetSurface','iceFacetSize','crystalStep','crystalTiers','crystalFacet','crystalSizeVar','crystalSides','crystalStretch','crystalTop','crystalVariation','crystalAlign','bergJitter','bergBreak','bergRough']],
 ['','Impact',['ejecta','buckling','secondaries','secondaryDistance']],
 ['','Shore',['fingers','fingerSize','fingerVary','fingerInlet','riverDepth','shorePlates','plateMaterial','plateWaterPx','plateLandPx','plateSize','plateGap','plateHeight','plateVary','frostNeedles','crystalShoreSeam','waterDeep','waterShore','surf']],
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
  // The chip of a part that is off adds it (at the value it last had, or its default) and opens its rows. A summary is not locked by the
  // editor's fieldset as the switch is, so the chip asks the switch.
  summary.addEventListener('click',e=>{if(d.open||Number(master.value)!==0)return;e.preventDefault();if(box.matches(':disabled'))return;box.checked=true;box.dispatchEvent(new Event('change'));});
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

// Where each World setting sits: "Section/Tab" (a section without tabs ends in "/"). index.html holds one container per home
// (data-home); a row is created straight into its home, under the name of its group. repro/world-homes.test.mjs holds every key to one home.
export const WORLD_HOMES={
 'Ground/Pattern':'groundPatch groundPatchSize',
 'Surface/':'highland highFrom highReach baseBand baseBandLow baseBandHigh baseBandWander baseBandGaps',
 'Ground/Bumps & relief':'reliefScale reliefAmount reliefLumps reliefBranch reliefWarp reliefPatchy reliefJitter gentleRelief plainRelief lumpRelief reliefOctaves worms',
 'Ground/Terrain shape':'undulation undulationScale undulationCover undulationArt faceSteep',
 'Ground/Slope cover':'hillLight slopeTexture slopeMarks wrinkles',
 'Ground/Low ground':'lowReach lowGrain',
 'Vegetation/':'lushness soilRim plantRelief',
 'Rock types/Colors & recipe':'absorbDepth shadowTint',
 'Rock types/Exposure & relief':'rockFace faceRock rockFaceFrom faceExtrude faceMass rockCrown',
 'Rock types/Blocks & joints':'faceWhole faceWholeLarge faceRegular faceBlock faceBlockSize faceStretch faceBlockHeight faceJointTilt faceScaleVary faceBreak faceRound faceJoint faceJointWidth faceSecondary faceContinuity faceLean',
 'Rock types/Layers':'strata strataContrast strataGrain bedDip bedDipDir bedCycleVary faceBedVary faceBed faceLedge faceRun faceFold faceSpall faceLamina faceLaminaSize faceLayers faceGrass',
 'Rock types/Weathering':'faceWear faceCrease faceCreaseSize faceScratch faceScratchSize faceScratchLength faceScratchAngle faceClast faceClastSize faceDetailPatch runoff runoffScale runoffConcentration runoffCut runoffStain',
 'Rock types/Surface & crust':'shineRock shineRockSharp shineRockRough shineRockScale faceShade faceTone faceFresh faceRind faceRindDepth faceRindTone faceRindWarmth faceRindRough faceMineral faceStrata faceWet',
 'Rock types/Stones & debris':'looseSize stoneSort stoneRound stoneSlab debrisAmount debrisReach debrisDepth',
 'Rock types/Cracks & bands':'crackSeverity crackSpacing crackMajor crackMinor crackHairline crackBlocks crackWidth crackNetwork crackDark banding',
 'Rock types/Special surfaces':'pockmark pockSize moonCups moonCupSize moonCupDepth cupStretch moonRibs moonRibDepth moonRibDark moonFolds moonFoldSpacing iceCrystal iceCrest iceSnow iceFall iceApron gougeWeb',
 'Cliffs & stones/Where rock shows':'rimReach shoreRock shoreShelf',
 'Cliffs & stones/Loose stones':'looseSupply boulders looseKnoll',
 'Cliffs & stones/Bands':'bandSoftness bandWater sandBanding sandBandSpacing layerCrease desertCapFlat',
 'Cliffs & stones/Special surfaces':'iceFrost lavaCrust lavaPillow lavaChip lavaVeins lavaCalm lavaDusk iceSoft',
 'Sand/':'sandCrown sand sandLee wind sandDust sandGrass sandLight ripple rippleHeight',
 'Water & shores/Depths & edges':'shallowDepth deepDepth waterSoft crispShore deepEdge stepSoftPx shelfWander shoalRag shoalStairs shoalShoreSoft',
 'Water & shores/Shore & beach':'coastRamp beachWidth apron shoreEdge bankRock frostGaps frostGapReach frostGapSize frostGapDepth',
 'Water & shores/Water bed':'bedTint bedBright bedContrast bedRelief bedCracks bedCrackSize bedFlat',
 'Water & shores/Mineral fringe':'ringFade ringContrast ringCount ringSize ringShift ringShiftDir ringScatter ringWobble ringLobe ringFill ringPatch ringPatchSize ringTone',
 'Rain & erosion/':'erosionRain wetSwath wetGround',
 'Light & shine/Sun & shade':'faceFill flatShadow flatOcclusion lightCap shadeDepth sunTilt sunHeight ambient creaseShade',
 'Light & shine/Shine':'shineOutside shineSlopeGate shineStretch shineWhite shineGround shineGroundSharp shineGroundRough shineGroundScale shineSlope shineSlopeSharp shineSlopeRough shineSlopeScale shineSand shineSandSharp shineSandRough shineSandScale shineCrystal shineCrystalSharp shineCrystalRough shineCrystalScale shineGate shineHeadroom',
};
const homeOf=new Map(Object.entries(WORLD_HOMES).flatMap(([home,keys])=>keys.split(' ').map(key=>[key,home])));
export const worldHome=key=>homeOf.get(key)||'World/';   // a key without a home still shows, in the World section
const homeRows=home=>document.querySelector(`#knobs [data-home="${home}"] .world-rows`);
// A World group: a titled block created in the home of its rows. A group whose rows have different homes gets a block in each.
// Its rows carry `search` as data-search-group.
const worldBlocks=new Map();
export function worldGroup(name,key){
 const home=worldHome(key),id=home+'|'+name;
 if(!worldBlocks.has(id)){const block=document.createElement('div'),heading=document.createElement('h3');block.className='world-subsection';heading.textContent=name;block.append(heading);homeRows(home).append(block);worldBlocks.set(id,{block,search:name});}
 return worldBlocks.get(id);
}
// The World panel: sections down its side, tabs in the larger ones (static in index.html). A press shows one section and one of its tabs.
// With a search, every tab that holds a match shows under its own name, and the fixed blocks (colors, pickers, notes) step aside.
export function mountWorldControlIndex(root,values=()=>({})){
 const search=$('world-control-search'),studio=root.closest('.world-studio'),input=search.querySelector('#world-search'),fine=search.querySelector('#world-fine');
 const lists=[...studio.querySelectorAll('[role="tablist"]')],panels=[...root.querySelectorAll('.world-tab')],sections=[...root.querySelectorAll('.world-section')];
 let shineMaterial='Ground';
 const shine=$('shine-materials');
 shine.addEventListener('click',e=>{const b=e.target.closest('[data-shine-material]');if(!b)return;shineMaterial=b.dataset.shineMaterial;for(const button of shine.children)button.setAttribute('aria-pressed',String(button===b));sync();});
 const revealed=new Set();
 const sync=()=>{const query=input.value.trim().toLowerCase(),current=values(),rows=[...root.querySelectorAll('[data-knob]')];let visible=0;
  for(const row of rows){const key=row.dataset.knob,reason=worldControlRequirement(key,current),control=row.querySelector('input[type=range],select');control.disabled=Boolean(reason);row.classList.toggle('control-inactive',Boolean(reason));let note=row.querySelector('.control-requirement');if(!note){note=document.createElement('p');note.className='small control-requirement';row.append(note);}note.textContent=reason;note.hidden=!reason;
   const text=(row.dataset.knob+' '+row.dataset.searchGroup).toLowerCase(),material=key.match(/^shine(Ground|Slope|Sand|Crystal)(?:Sharp|Rough|Scale)?$/)?.[1];
   row.hidden=query?!text.includes(query):(!fine.checked&&!WORLD_PRIMARY_CONTROLS.has(key))||(material&&material!==shineMaterial);row.dataset.eligible=String(!row.hidden);if(!row.hidden)visible++;}
  for(const block of root.querySelectorAll('.world-subsection')){
   const groups=new Map();for(const row of block.querySelectorAll('[data-knob]')){if(row.dataset.eligible!=='true'||!row.classList.contains('control-inactive'))continue;const reason=row.querySelector('.control-requirement').textContent;if(!groups.has(reason))groups.set(reason,[]);groups.get(reason).push(row);}
   block.querySelectorAll('.unavailable-summary').forEach(el=>el.remove());
   if(!query)for(const [reason,group] of groups){const key=block.querySelector('h3').textContent+'|'+reason,open=revealed.has(key),summary=document.createElement('div'),button=document.createElement('button');summary.className='unavailable-summary';button.type='button';button.textContent=`${open?'Hide':'Show'} ${group.length} unavailable setting${group.length===1?'':'s'}`;button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-controls',group.map(row=>'knob-'+row.dataset.knob+'-row').join(' '));button.onclick=()=>{if(open)revealed.delete(key);else revealed.add(key);sync();[...block.querySelectorAll('.unavailable-summary button')].find(b=>b.dataset.reason===reason)?.focus();};button.dataset.reason=reason;summary.append(button,document.createTextNode(reason));block.append(summary);for(const row of group){row.id='knob-'+row.dataset.knob+'-row';row.hidden=!open;}}
  }
  for(const block of root.querySelectorAll('.world-subsection'))block.hidden=![...block.querySelectorAll('[data-knob]')].some(r=>r.dataset.eligible==='true');
  studio.classList.toggle('searching',Boolean(query));
  // A tab or a section shows when it is the chosen one; in a search, when it holds a match.
  const chosen=el=>$(el.getAttribute('aria-labelledby'))?.getAttribute('aria-selected')!=='false',matches=el=>[...el.querySelectorAll('[data-knob]')].some(r=>!r.hidden);
  for(const panel of panels){if(panel.id)panel.hidden=query?!matches(panel):!chosen(panel);panel.classList.toggle('no-match',Boolean(query)&&!matches(panel));}
  for(const section of sections)section.hidden=query?!matches(section):!chosen(section);
  $('world-control-count').textContent=query?`${visible} matching settings`:fine.checked?`${rows.length} settings`:`${visible} main settings of ${rows.length}`;
 };
 for(const list of lists){const tabs=[...list.querySelectorAll(':scope > [role="tab"]')];
  const pick=tab=>{for(const t of tabs){const on=t===tab;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;}sync();};
  list.addEventListener('click',e=>{const tab=e.target.closest('[role="tab"]');if(tab&&list.contains(tab))pick(tab);});
  list.addEventListener('keydown',e=>{const k={ArrowDown:1,ArrowRight:1,ArrowUp:-1,ArrowLeft:-1}[e.key];if(!k)return;const at=tabs.indexOf(document.activeElement);if(at<0)return;e.preventDefault();const next=tabs[(at+k+tabs.length)%tabs.length];pick(next);next.focus();});
 }
 input.addEventListener('input',sync);fine.addEventListener('change',sync);sync();return sync;
}

export function mountColumnPanel(read,change,commit,reset){
 const panel=$('column-panel'),body=panel.querySelector('.column-body'),note=panel.querySelector('[role="status"]'),restore=panel.querySelector('#column-fields > button');
 $('column-open').onclick=()=>{panel.hidden=false;$('column-open').setAttribute('aria-expanded','true');$('column-done').focus();};
 const closeColumn=()=>{panel.hidden=true;$('column-open').setAttribute('aria-expanded','false');};
 $('column-done').onclick=()=>{closeColumn();$('column-open').focus();};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){closeColumn();e.stopImmediatePropagation();$('column-open').focus();}},true);
 new MutationObserver(()=>{if($('pane-world').hidden||$('wpane-rock-types').hidden)closeColumn();}).observe($('pane-world'),{attributes:true,subtree:true,attributeFilter:['hidden']});
 const syncLock=()=>{$('column-fields').disabled=$('world-editor').disabled;if($('inspector-sidebar').hidden)closeColumn();};
 new MutationObserver(syncLock).observe($('world-editor'),{attributes:true,attributeFilter:['disabled']});
 new MutationObserver(syncLock).observe($('inspector-sidebar'),{attributes:true,attributeFilter:['hidden']});syncLock();
 const at=(column,path)=>path.reduce((v,k)=>v[k],column);
 function drawStack(){const {column}=read(),sections=column?.sections||[];
  const stack=$('column-stack');stack.replaceChildren();for(const [i,section] of [...sections.entries()].reverse()){for(const [j,bed] of [...section.beds.entries()].reverse()){const swatch=document.createElement('div');swatch.style.flex=String(bed[0]);const rgb=column?.colors?.[bed[2]];swatch.style.background=rgb?`rgb(${rgb.join(',')})`:read().bedColors[bed[2]];swatch.style.marginRight=`${(1-bed[1])*14}px`;swatch.title=`Section ${i+1}, bed ${j+1}: thickness ${bed[0]}, hardness ${bed[1]}, slot ${bed[2]+1}`;swatch.textContent=`${i+1}.${j+1}`;stack.append(swatch);}}stack.hidden=!sections.length;
 }
 const state=()=>{drawStack();$('column-title').textContent='Rock column of '+$('rock-current-name').textContent;const {edited}=read();restore.disabled=!edited;note.textContent=edited?'Map column edited.':'Using the world column unchanged.';};
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
  const {column}=read();body.replaceChildren();state();
  // The column's sections (a world or map without any has no column, and adds one here).
  const path=['sections'];
  const sections=column?.sections||[],beds=sections.reduce((n,s)=>n+s.beds.length,0),slots=column?.colors?.length||COLUMN_SLOTS;

  const edit=fn=>()=>reshape(c=>{const parent=at(c,path.slice(0,-1));parent[path.at(-1)]??=[];fn(parent[path.at(-1)]);});
  if(!sections.length){
   const p=document.createElement('p');p.className='small';p.textContent='This map has no rock column. Strata, the Base band (in Surface) and Cap color paint its beds: add one to use them.';body.append(p);
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
  const bands=column?.bands;if(bands){const group=document.createElement('div');group.className='column-options';const h=document.createElement('h4');h.textContent='Contour bands';body.append(h,group);field(group,'Height step',['bands',0],{min:.001});field(group,'Line strength',['bands',1],{min:0,max:1});}
  const options=document.createElement('div');options.className='column-options';body.append(options);
  if(column?.origin!==undefined)field(options,'Count height from',['origin'],{choices:[['plain','Dry plain'],['sea','Sea level']]});
  if(column?.wander?.value!==undefined)field(options,'Bed wander',['wander','value']);
  column?.wander?.terrain?.forEach((_,i)=>field(options,['Broad wander','Medium wander','Fine wander'][i],['wander','terrain',i]));
  if(column?.colors){const colors=document.createElement('details');colors.className='feature-group';colors.open=true;colors.innerHTML='<summary>Material slot colors</summary>';const fields=document.createElement('div');fields.className='column-options';colors.append(fields);column.colors.forEach((_,i)=>field(fields,`Slot ${i+1}`,['colors',i],{color:true}));body.append(colors);}
 }
 restore.onclick=()=>{reset();sync();};sync();return sync;
}
