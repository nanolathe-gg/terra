import {TerrainRenderer} from './sculpt-renderer.js';
import {quickMaterialField} from './sculpt-material-weathering.js';

// Offline authoring policy. These brushes are new geometry, not retail rules.
const $ = id => document.getElementById(id);
const canvas = $('terrain'), overlay = $('overlay'), ink = overlay.getContext('2d');
const experiment = new URLSearchParams(location.search);
let LOCAL_KEY = 'nanolathe-terrain-sculpt-v3' + (experiment.has('scratch')?'-'+experiment.get('scratch'):'');
const NATURAL_COAST = experiment.get('coast')!=='restrained';
const MIN_HEIGHT = -90, MAX_HEIGHT = 300;
const HELP = {
  plateau:'Paint a level crest above the height where this stroke begins. New strokes can build on top.',
  hill:'Paint a rounded ridge along any path. A later stroke adds more height to the existing ground.',
  mountain:'Paint a narrower, peaked ridge. New strokes add to the existing height, without a flat summit.',
  ramp:'Draw between terrain levels. A smooth centre joins the endpoint heights with rounded approaches; shoulder roughness stays outside the route. Longer paths make gentler grades.',
  deep:NATURAL_COAST?'Guide a deep channel. Coast freedom varies the banks; Automatic shallows controls extra shelves. The centre stays deep until you paint over it.':'Set the bed to −55. A whole stroke has one depth; holding still does not keep digging.',
  shallow:'Set the bed to −7. Paint through deep water to make a shallow passage, or through land to make shallows.',
  smooth:'Blend the starting surface toward its local average. Repeat a new stroke for more smoothing.',
  lower:'Lower the starting surface by the chosen amount. New strokes can dig farther.',
  offset:'Paint an area to raise or lower by the chosen height. Its edge is natural and its softness sets cliff or slope; the ground keeps its own relief.',
  crater:'Strike a crater: a bowl below the ground where you click, a raised rim and a fading apron. Drag for an elongated crater.',
  move:'Click a shape to select it; drag to move it, Shift+drag up or down to change its height. Drag the round handle to rotate and the square one to scale, or use , . and [ ]. Delete removes it.'
};
let config, renderer, heights, protection, routes, cracks, grid, size, spacing, noise;
let weatherWorker, weatherJob=0, weatherBase=null, refined=null, refinedBase=null, weatherState='pending';
let tool='plateau', seed=2701, refinementSeed=2701, stroke=null, pan=null, cursor=null, space=false, pointerId=null, loading=false;
let history=[], historyIndex=-1, framePending=false, heightDirty=true, needsDraw=true;
let revision=0, renderedRevision=-1, fitView=true, autosaveTimer, ready=false;
let paintingIntervals=[],lastPaintingRAF=null;
let lastWaterStroke=null;
// Biomes choose starting values for the same brushes. These presets can be
// borrowed independently of the canvas materials and then edited per tool.
const TOOL_PRESETS={
  green:{crater:{roughness:60},plateau:{roughness:40},hill:{roughness:35},mountain:{roughness:45},ramp:{roughness:18},deep:{roughness:45},shallow:{roughness:18}},
  red:{crater:{roughness:65,softness:40},plateau:{roughness:50,softness:35},hill:{roughness:50,softness:40},mountain:{roughness:55,softness:30},ramp:{roughness:22},deep:{roughness:55,bankWidth:38,shelves:45},shallow:{roughness:25}},
  moon:{crater:{roughness:65,softness:45},plateau:{roughness:45,softness:45},hill:{roughness:40,softness:55},mountain:{roughness:50,softness:40},ramp:{roughness:18},deep:{roughness:50},shallow:{roughness:20}},
  zhon:{crater:{roughness:55,softness:60},plateau:{roughness:45,softness:55},hill:{roughness:30,softness:35},mountain:{roughness:45,softness:55},ramp:{roughness:18},deep:{roughness:60,bankWidth:70,beachFlatness:75,shelves:70},shallow:{roughness:30,bankWidth:70,beachFlatness:75}},
  archipelago:{crater:{roughness:60,softness:65},plateau:{roughness:45,softness:72},hill:{roughness:35,softness:78},mountain:{roughness:45,softness:65},ramp:{roughness:18},deep:{roughness:60,bankWidth:78,beachFlatness:80,shelves:90},shallow:{roughness:30,bankWidth:75,beachFlatness:80}}
};
const TOOL_FIELDS={cracks:['cracks',0,100],diameter:['diameter',40,400],amount:['amount',-80,160],roughness:['roughness',0,100],shelves:['shelves',0,100],bankWidth:['bank-width',0,100],beachFlatness:['beach-flatness',0,100],softness:['softness',0,100]};
let toolSettings={};
const clamp=(v,a,b) => Math.max(a,Math.min(b,v));
const smooth=(a,b,v) => { const t=clamp((v-a)/(b-a),0,1); return t*t*(3-2*t); };
// Rounded authored knots preserve a long shoulder and a short exposed face.
// Zero slope at the crown avoids the knife edge of a skewed power-law dome.
const hillKnots=[.67,.78,.89,1],hillRise=[1,.34,.02,0];
const hillTangents=hillKnots.map((_,i) => {
  if (!i || i===hillKnots.length-1) return 0;
  const a=(hillRise[i]-hillRise[i-1])/(hillKnots[i]-hillKnots[i-1]);
  const b=(hillRise[i+1]-hillRise[i])/(hillKnots[i+1]-hillKnots[i]);
  return a*b>0?2*a*b/(a+b):0;
});
function hillSection(t) {
  if (t<=0 || t>=1) return 0;
  if (t<=.67) return smooth(0,.67,t);
  let i=0; while (hillKnots[i+1]<t) i++;
  const width=hillKnots[i+1]-hillKnots[i],u=(t-hillKnots[i])/width,u2=u*u,u3=u2*u;
  return (2*u3-3*u2+1)*hillRise[i]+(u3-2*u2+u)*width*hillTangents[i]
    +(-2*u3+3*u2)*hillRise[i+1]+(u3-u2)*width*hillTangents[i+1];
}
const hillLift=(s,i) => 1+s.rough*(.75*s.noise.coastWidth[i]+.30*s.noise.detail[i]);

function error(message='') { $('error').textContent=message; $('error').hidden=!message; }
function status(message) { $('status').textContent=message; }
// Height slider range per shape kind; Raise / lower is signed.
const amountRange=kind => kind==='offset'?[-80,80]:kind==='smooth'?[5,100]:[5,160];
function toolDefaults(kind,preset=config?.biomeId||'green') {
  return {cracks:{hill:40,mountain:60,plateau:50,crater:30,offset:40}[kind]??0,diameter:200,amount:kind==='offset'?20:70,roughness:35,shelves:25,bankWidth:50,beachFlatness:50,softness:50,shallowMode:'passage',preset,...TOOL_PRESETS[preset]?.[kind]};
}
function rememberTool(custom=false) {
  const state={...toolSettings[tool],shallowMode:$('shallow-mode').value};
  for (const [key,[id]] of Object.entries(TOOL_FIELDS)) state[key]=Number($(id).value);
  if (custom) state.preset='custom';
  toolSettings[tool]=state;
}
function showTool(state) {
  [$('amount').min,$('amount').max]=amountRange(tool).map(String);
  for (const [key,[id,lo,hi]] of Object.entries(TOOL_FIELDS)) if (Number.isFinite(state[key])) $(id).value=clamp(state[key],lo,hi);
  $('shallow-mode').value=state.shallowMode==='area'?'area':'passage';
  $('tool-style').value=Object.hasOwn(TOOL_PRESETS,state.preset)?state.preset:'custom';
}
function updateControls() {
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed',String(b.dataset.tool===tool));
  // With Move active, show the selected shape's own controls.
  const activeTool=tool;
  if (tool==='move') tool=nodes[selected]?.params?nodes[selected].kind:'move';
  try {
  const fixed=['deep','shallow','ramp'].includes(tool);
  $('amount-control').hidden=fixed;
  $('amount-label').textContent=tool==='smooth'?'Strength':tool==='lower'?'Lower by':tool==='crater'?'Depth':tool==='offset'?'Height change':'Rise';
  const [lo,hi]=amountRange(tool); $('amount').min=String(lo); $('amount').max=String(hi);
  $('amount').value=String(clamp(Number($('amount').value),lo,hi));
  const amountNow=Number($('amount').value);
  $('amount-value').textContent=tool==='smooth'?amountNow+'%':tool==='offset'?(amountNow<0?'−':'+')+Math.abs(amountNow):(tool==='lower'?'−':'+')+amountNow;
  $('diameter-value').textContent=$('diameter').value+' units';
  $('roughness-value').textContent=$('roughness').value+'%';
  $('roughness-label').textContent=tool==='ramp'?'Shoulder freedom':tool==='deep' && NATURAL_COAST?'Coast freedom':tool==='plateau' && experiment.get('edges')==='natural'?'Edge freedom':'Roughness';
  $('shelves-control').hidden=tool!=='deep' || !NATURAL_COAST;
  $('shallow-mode-control').hidden=tool!=='shallow';
  $('shelves-value').textContent=$('shelves').value+'%';
  $('bank-control').hidden=!['deep','shallow'].includes(tool);
  $('beach-control').hidden=!['deep','shallow'].includes(tool);
  $('softness-control').hidden=!['plateau','hill','mountain','crater','offset'].includes(tool);
  $('cracks-control').hidden=!['plateau','hill','mountain','crater','offset'].includes(tool);
  $('cracks-value').textContent=$('cracks').value+'%';
  $('bank-value').textContent=$('bank-width').value+'%';
  $('beach-value').textContent=$('beach-flatness').value+'%';
  $('softness-value').textContent=$('softness').value+'%';
  $('relief-value').textContent=$('relief').value+'%';
  $('ring-value').textContent=$('mineral-ring').value+'%';
  $('ring-spread-value').textContent=$('ring-spread').value+'%';
  $('ring-variation-value').textContent=$('ring-variation').value+'%';
  $('material-weathering-value').textContent=$('material-weathering').value+'%';
  $('deposit-spread-value').textContent=$('deposit-spread').value+'%';
  $('transition-detail-value').textContent=$('transition-detail').value+'%';
  $('tool-style').value=toolSettings[tool]?.preset||'custom';
  $('fractures-value').textContent=$('fractures').value+'%';
  $('scree-value').textContent=$('scree').value+'%';
  $('water-edit').hidden=true;
  $('water-reapply').disabled=!lastWaterStroke || Boolean(stroke) || lastWaterStroke.kind!==tool;
  $('tool-help').textContent=tool==='shallow' && $('shallow-mode').value==='passage'
    ?'Raise the underwater bed to −7 for a shallow passage. Existing land and shallower banks keep their shape.'
    :HELP[tool];
  $('undo').disabled=!ready || Boolean(stroke) || historyIndex<=0;
  $('redo').disabled=!ready || Boolean(stroke) || historyIndex>=history.length-1;
  $('export').disabled=!canExport();
  $('fit').setAttribute('aria-pressed',String(fitView)); $('one').setAttribute('aria-pressed',String(!fitView));
  } finally { tool=activeTool; }
  if (tool==='move') { $('tool-help').textContent=HELP.move; $('amount-control').hidden=selected<0 || ['deep','shallow','ramp'].includes(nodes[selected]?.kind); }
  // Say what the brush controls change: the next stroke, or a selected shape.
  const editing=selected>=0 && nodes[selected]?.params;
  $('brush-panel').classList.toggle('editing',Boolean(editing));
  $('brush-title').textContent=editing?`Selected · ${NODE_NAMES[nodes[selected].kind]||nodes[selected].kind} #${selected+1}`:tool==='move'?'Move':`Brush · new ${NODE_NAMES[tool]||tool}`;
  $('brush-scope').textContent=editing?'These controls edit the selected shape. Choose a tool to draw a new one.':tool==='move'?'Click a shape to select and edit it.':'Settings for your next stroke.';
}

function canExport() {
  return ready && !loading && !stroke && renderedRevision===revision && (!$('weather').checked || weatherState==='ready');
}

function hash(x,y,s) {
  let n=Math.imul(x,374761393)^Math.imul(y,668265263)^s;
  n=Math.imul(n^(n>>>13),1274126177); return ((n^(n>>>16))>>>0)/4294967295*2-1;
}
function valueNoise(x,y,s) {
  const ix=Math.floor(x),iy=Math.floor(y),tx=smooth(0,1,x-ix),ty=smooth(0,1,y-iy);
  const a=hash(ix,iy,s),b=hash(ix+1,iy,s),c=hash(ix,iy+1,s),d=hash(ix+1,iy+1,s);
  return (a+(b-a)*tx)*(1-ty)+(c+(d-c)*tx)*ty;
}
// Brush noise fields: two octaves each, as (wavelength, weight, salt).
const NOISE_FIELDS={x:[[95,.7,0x1863],[37,.3,0x32a7]],y:[[95,.7,0x73c1],[37,.3,0x9e15]],detail:[[64,.65,0x5b39],[23,.35,0x2ac9]],
  coastX:[[210,.65,0x5e17],[75,.35,0x37ab]],coastY:[[210,.65,0x84d1],[75,.35,0x192f]],coastWidth:[[180,.65,0x73b9],[55,.35,0x4f25]],shelf:[[170,.75,0x986d],[48,.25,0x62f3]]};
const noiseValue=(field,s,x,y) => { const [[w1,a1,k1],[w2,a2,k2]]=NOISE_FIELDS[field]; return a1*valueNoise(x/w1,y/w1,s^k1)+a2*valueNoise(x/w2,y/w2,s^k2); };
function makeNoise(s) {
  // Noise is a fixed world-space field, never generated anew per draw or dab.
  const out={};
  for (const field of Object.keys(NOISE_FIELDS)) {
    const a=out[field]=new Float32Array(grid*grid);
    for (let z=0;z<grid;z++) for (let col=0;col<grid;col++) a[z*grid+col]=noiseValue(field,s,col*spacing,z*spacing);
  }
  return out;
}
// A shape's frame maps its authoring coordinates to the world: moving,
// rotating or scaling a shape changes the frame, and its brush noise is read
// through the inverse, so the shape keeps its own outline and character.
// [a,b,c,d,e,f]: world = (a·x + c·y + e, b·x + d·y + f). Absent = identity.
const IDENTITY=[1,0,0,1,0,0];
const compose=(m,n) => [m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
const invert=m => { const det=m[0]*m[3]-m[1]*m[2],a=m[3]/det,b=-m[1]/det,c=-m[2]/det,d=m[0]/det; return [a,b,c,d,-(a*m[4]+c*m[5]),-(b*m[4]+d*m[5])]; };
const applyFrame=(m,x,y) => ({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]});
const about=(pivot,m) => compose([1,0,0,1,pivot.x,pivot.y],compose(m,[1,0,0,1,-pivot.x,-pivot.y]));
const rotation=a => [Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0];
const scaling=k => [k,0,0,k,0,0];
const isIdentity=m => !m || m.every((v,i) => Math.abs(v-IDENTITY[i])<1e-9);
// Noise for a framed shape, gathered from the seed's world grid at each
// cell's authoring position (nearest cell; the fields are smooth), within
// rect only. Positions off the map are evaluated directly.
const framedBuffers=new WeakMap();
function framedNoise(node,seed,frame,rect) {
  const world=noiseFor(seed),inv=invert(frame);
  let out=framedBuffers.get(node);
  if (!out) { out={}; for (const field of Object.keys(NOISE_FIELDS)) out[field]=new Float32Array(grid*grid); framedBuffers.set(node,out); }
  const fields=Object.keys(NOISE_FIELDS);
  for (let y=rect.y0;y<=rect.y1;y++) for (let x=rect.x0;x<=rect.x1;x++) {
    const i=y*grid+x,wx=x*spacing,wy=y*spacing,lx=inv[0]*wx+inv[2]*wy+inv[4],ly=inv[1]*wx+inv[3]*wy+inv[5];
    const gx=Math.round(lx/spacing),gy=Math.round(ly/spacing);
    if (gx>=0 && gy>=0 && gx<grid && gy<grid) { const j=gy*grid+gx; for (const field of fields) out[field][i]=world[field][j]; }
    else for (const field of fields) out[field][i]=noiseValue(field,seed,lx,ly);
  }
  return out;
}
function sample(field,x,y) {
  const gx=clamp(x/spacing,0,grid-1),gy=clamp(y/spacing,0,grid-1),ix=Math.floor(gx),iy=Math.floor(gy);
  const jx=Math.min(ix+1,grid-1),jy=Math.min(iy+1,grid-1),fx=gx-ix,fy=gy-iy;
  return (field[iy*grid+ix]*(1-fx)+field[iy*grid+jx]*fx)*(1-fy)+(field[jy*grid+ix]*(1-fx)+field[jy*grid+jx]*fx)*fy;
}
function blurred(field,radius) {
  const tmp=new Float32Array(field.length),out=new Float32Array(field.length),width=2*radius+1;
  for (let y=0;y<grid;y++) {
    const row=y*grid; let sum=0;
    for (let k=-radius;k<=radius;k++) sum+=field[row+clamp(k,0,grid-1)];
    for (let x=0;x<grid;x++) { tmp[row+x]=sum/width; sum+=field[row+clamp(x+radius+1,0,grid-1)]-field[row+clamp(x-radius,0,grid-1)]; }
  }
  for (let x=0;x<grid;x++) {
    let sum=0; for (let k=-radius;k<=radius;k++) sum+=tmp[clamp(k,0,grid-1)*grid+x];
    for (let y=0;y<grid;y++) { out[y*grid+x]=sum/width; sum+=tmp[clamp(y+radius+1,0,grid-1)*grid+x]-tmp[clamp(y-radius,0,grid-1)*grid+x]; }
  }
  return out;
}
function startStroke(kind,p,options={}) {
  applySeedControl();
  const radius=options.radius ?? Number($('diameter').value)/2;
  const base=heights.slice();
  const strokeSeed=options.seed ?? seed,frame=isIdentity(options.frame)?null:options.frame;
  const strokeNoise=frame?framedNoise(options.node,strokeSeed,frame,options.rect):noiseFor(strokeSeed);
  // Directions drawn from noise live in the authoring frame; turn them with it.
  const turn=frame?Math.atan2(frame[1],frame[0]):0;
  const faceAngle=Math.PI/2+sample(strokeNoise.coastX,p.x,p.y)*1.8+turn;
  return {kind,base,protectBase:protection.slice(),routeBase:routes.slice(),crackBase:cracks.slice(),cracks:options.cracks ?? Number($('cracks').value)/100,radius,amount:options.amount ?? Number($('amount').value),rough:options.rough ?? Number($('roughness').value)/100,
    bankWidth:options.bankWidth ?? Number($('bank-width').value)/100,softness:options.softness ?? Number($('softness').value)/100,
    beachFlatness:options.beachFlatness ?? Number($('beach-flatness').value)/100,
    shelves:options.shelves ?? (experiment.has('shelves')?Number(experiment.get('shelves')):Number($('shelves').value)/100),shallowMode:options.shallowMode ?? $('shallow-mode').value,path:[p],
    face:[Math.cos(faceAngle),Math.sin(faceAngle)],
    noise:strokeNoise,seed:strokeSeed,craterOffset:[Math.cos(strokeSeed%628/100+turn),Math.sin(strokeSeed%628/100+turn)],rot:[Math.cos(turn),Math.sin(turn)],inv:frame?invert(frame):null,craterlets:options.craterlets??(experiment.has('craterlets')?Number(experiment.get('craterlets')):3),craterEjecta:options.craterEjecta??(experiment.has('craterEjecta')?Number(experiment.get('craterEjecta')):0),baseline:sample(base,p.x,p.y),weights:new Float32Array(heights.length),
    distances:kind==='hill' && experiment.get('forms')==='shouldered'?new Float32Array(heights.length).fill(Infinity):null,start:p,last:p,end:p,
    smoothTarget:kind==='smooth'?blurred(base,clamp(Math.round(radius/(spacing*7)),1,24)):null};
}
function dab(s,p,spanEnd=null,frameStart=null,frameEnd=null) {
  const naturalWater=s.kind==='deep' && NATURAL_COAST;
  const naturalPlateau=(s.kind==='plateau' || s.kind==='offset') && experiment.get('edges')==='natural';
  const shoulderedHill=s.kind==='hill' && experiment.get('forms')==='shouldered';
  const waterTool=s.kind==='deep' || s.kind==='shallow';
  const bankScale=waterTool?2**((s.bankWidth-.5)*1.3):1;
  const faceWidth=.66+(s.softness-.5)*.9,backWidth=s.softness===.5?1.34:2-faceWidth;
  const radius=s.radius,amp=s.rough*radius*(naturalWater ? 1.1 : naturalPlateau ? .95 : shoulderedHill ? .85 : s.kind==='crater' ? .45 : .2);
  const macro=naturalWater || naturalPlateau;
  const noiseX=macro?s.noise.coastX:s.noise.x,noiseY=macro?s.noise.coastY:s.noise.y;
  const nx=sample(noiseX,p.x,p.y),ny=sample(noiseY,p.x,p.y);
  const spanX=spanEnd?spanEnd.x-p.x:0,spanY=spanEnd?spanEnd.y-p.y:0,spanLength2=spanX*spanX+spanY*spanY;
  let face=s.face;
  if (shoulderedHill && spanLength2>0) {
    s.faceSide ??= (-spanY*s.face[0]+spanX*s.face[1])<0?-1:1;
    const length=Math.sqrt(spanLength2),sign=s.faceSide;
    face=[-spanY/length*sign,spanX/length*sign];
  }
  const crater=s.kind==='crater';
  // URL knobs are read once per dab, never per cell (a lookup per cell was
  // half the cost of moving a lake).
  const coreEdge=experiment.has('coreEdge')?Number(experiment.get('coreEdge')):.38;
  const faceVariation=experiment.has('faceVariation')?Number(experiment.get('faceVariation')):.8;
  const bumpy=['hill','mountain','lower'].includes(s.kind);
  const extent=crater?radius*1.9*(1+.45*s.rough)+2*amp:radius*(naturalWater?Math.min(1.9,1+s.rough*1.6):naturalPlateau?Math.min(1.7,1+s.rough*1.3):shoulderedHill?Math.max(1.4,backWidth):1)*bankScale+2*amp;
  let x0=clamp(Math.floor((Math.min(p.x,spanEnd?.x??p.x)-extent)/spacing),0,grid-1),x1=clamp(Math.ceil((Math.max(p.x,spanEnd?.x??p.x)+extent)/spacing),0,grid-1);
  let y0=clamp(Math.floor((Math.min(p.y,spanEnd?.y??p.y)-extent)/spacing),0,grid-1),y1=clamp(Math.ceil((Math.max(p.y,spanEnd?.y??p.y)+extent)/spacing),0,grid-1);
  if (clip) { x0=Math.max(x0,clip.x0); x1=Math.min(x1,clip.x1); y0=Math.max(y0,clip.y0); y1=Math.min(y1,clip.y1); }
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) {
    const i=y*grid+x,wx=x*spacing,wy=y*spacing,inv=s.inv;
    // Authoring-frame position for noise evaluated directly from position.
    const lx=inv?inv[0]*wx+inv[2]*wy+inv[4]:wx,ly=inv?inv[1]*wx+inv[3]*wy+inv[5]:wy;
    const t=spanLength2?clamp(((wx-p.x)*spanX+(wy-p.y)*spanY)/spanLength2,0,1):0;
    const cx=p.x+spanX*t,cy=p.y+spanY*t;
    if (crater) {
      // Retail lunar craters: a lobed outline, a rim that rises and falls
      // (with gaps), an off-centre lumpy bowl and an uneven apron. All of the
      // variation is position-based noise from the crater's own seed.
      const sc=Math.max(radius*.55,8),n0=valueNoise(lx/(radius*.95),ly/(radius*.95),s.seed^0x4a7),n1=valueNoise(lx/sc,ly/sc,s.seed^0x1c3),n2=valueNoise(lx/(sc*.6),ly/(sc*.6),s.seed^0x2d9);
      const lobe=1+s.rough*(.38*n0+.22*n1+.1*n2);
      const off=s.craterOffset;
      const dx=wx-cx-off[0]*radius*.32*s.rough,dy=wy-cy-off[1]*radius*.32*s.rough;
      const rr=Math.hypot(wx-cx,wy-cy)/(radius*lobe),rb=Math.hypot(dx,dy)/(radius*lobe);
      if (rr>=1.9) continue;
      const influence=1-rr/1.9;
      if (influence<=s.weights[i]) continue;
      s.weights[i]=influence;
      const floorEdge=.25+.45*(1-s.softness);
      const rimNoise=valueNoise(lx/(sc*.8),ly/(sc*.8),s.seed^0x3e1);
      // Low-frequency rim noise lets whole sectors of rim sink away.
      const rimHeight=s.amount*.34*clamp(1.1*(rimNoise*.5+.5)+.5*n0*s.rough-.15*s.rough,0,1.5);
      const rimWidth=(.16+.2*s.softness)*(1+.35*n2);
      const bowl=rb<1?1-smooth(floorEdge,1,rb):0;
      const apronReach=1-smooth(1.15+.35*n1,1.85,rr);
      const rim=rr<1?Math.exp(-(((rr-1)/rimWidth)**2)):Math.exp(-(((rr-1)/(rimWidth*2.4))**2))*apronReach;
      const lumps=s.rough*(6*n2+3*n1+2*s.noise.detail[i])*(rr<1.3?1:0);
      // Ejecta: beyond the rim the throw-out breaks into scattered,
      // ragged patches that thin outward (retail lunar sections).
      let ejecta=0;
      if (s.craterEjecta>0 && rr>.8) {
        const e1=valueNoise(lx/(sc*.32),ly/(sc*.32),s.seed^0x6e7),e2=valueNoise(lx/(sc*.14),ly/(sc*.14),s.seed^0x1b5);
        const reach=1.25+.45*(n0*.5+.5);
        ejecta=s.craterEjecta*s.amount*.16*smooth(-.05,.45,e1*.7+e2*.3)*(1-smooth(1.0,reach+.25,rr))*smooth(.8,1.0,rr)*(.6+.4*e2);
      }
      const floor=Math.max(s.baseline-s.amount,Math.min(s.baseline,config.seaLevel+4));
      const target=s.baseline+rimHeight*rim-(s.baseline-floor)*bowl+lumps*(.4+.6*bowl);
      const blend=smooth(0,.15,1-rr);
      const value=(rr<1?s.base[i]+(target-s.base[i])*blend+(rr>=.85?(rimHeight*rim+lumps*.4)*(1-blend):0):s.base[i]+rimHeight*rim+lumps*.3*apronReach)+ejecta;
      // A crater on dry ground stays dry: floor lumps never dip into the sea.
      heights[i]=clamp(s.base[i]>config.seaLevel+1?Math.max(value,config.seaLevel+1.5):value,MIN_HEIGHT,MAX_HEIGHT);
      protection[i]=s.protectBase[i]*(1-smooth(0,.3,influence)); routes[i]=s.routeBase[i]*(1-smooth(0,.3,influence));
      continue;
    }
    if (shoulderedHill) {
      const d2=(wx-cx)**2+(wy-cy)**2;
      if (d2>s.distances[i]) continue;
      s.distances[i]=d2;
    }
    // Outline displacement, turned with the shape's frame.
    const ex=noiseX[i]-(spanLength2?sample(noiseX,cx,cy):nx),ey=noiseY[i]-(spanLength2?sample(noiseY,cx,cy):ny);
    const dx=wx-cx+amp*(s.rot[0]*ex-s.rot[1]*ey);
    const dy=wy-cy+amp*(s.rot[1]*ex+s.rot[0]*ey);
    // The line anchors the channel; broad world-space fields move its banks
    // independently and vary its width. Repeated dabs do not add fresh noise.
    const width=naturalWater?clamp(1+s.rough*1.6*s.noise.coastWidth[i],.45,1.9):naturalPlateau?clamp(1+s.rough*1.3*s.noise.coastWidth[i],.55,1.7):1;
    const r=Math.sqrt(dx*dx+dy*dy)/(radius*width*bankScale);
    // A continuous deep core follows the unwarped stroke. Automatic shelves
    // cannot close it; an explicit later shallow-water stroke can cross it.
    const core=naturalWater?1-smooth(.20,coreEdge,Math.sqrt((wx-p.x)**2+(wy-p.y)**2)/radius):0;
    if (r>=1 && !core && !shoulderedHill) continue;
    let w;
    if (s.kind==='plateau' || s.kind==='offset') {
      // Independently vary shoulder width around the level core. An irregular
      // outline with an identical cross-section still makes a uniform rim.
      // Face width varies along the outline at a broad scale too, so a cliff
      // band does not keep one width round a smooth arc (blind round 3).
      const broadFace=valueNoise(lx/(radius*1.3),ly/(radius*1.3),s.seed^0x5f1);
      const originalShoulder=naturalPlateau?clamp(.56+s.rough*(s.noise.detail[i]+.30*s.noise.coastWidth[i])+faceVariation*.22*broadFace,.18,.88):.62;
      const shoulder=clamp(originalShoulder-(s.softness-.5)*.6,.15,.90);
      w=1-smooth(shoulder,1,r);
    }
    else if (s.kind==='deep' || s.kind==='shallow') w=1-smooth(.10,1,r);
    else if (s.kind==='hill') {
      if (shoulderedHill) {
        // Authored approximation of native shoulder/face asymmetry, not a
        // recovered universal profile. The path anchors a common crest, so
        // turning the local shoulder direction cannot split that crest.
        let fx=face[0],fy=face[1];
        if (frameStart) {
          fx=frameStart[0]*(1-t)+frameEnd[0]*t; fy=frameStart[1]*(1-t)+frameEnd[1]*t;
          const length=Math.hypot(fx,fy);
          if (length>1e-5) { fx/=length; fy/=length; } else { fx=face[0]; fy=face[1]; }
        }
        const localRadius=radius*(1+s.rough*.75*s.noise.shelf[i]);
        const u=(dx*fx+dy*fy)/localRadius;
        const v=(-dx*fy+dy*fx)/localRadius;
        const cross=u-s.rough*.18*s.noise.detail[i];
        const along=cross/(cross<0?backWidth:faceWidth);
        const sideWidth2=1-along*along;
        const section=s.softness===.5?(cross+1.34)/2:cross<0?.67*(1+cross/backWidth):.67+.33*cross/faceWidth;
        w=sideWidth2>v*v?hillSection(section)*(1-v*v/sideWidth2)**2:0;
      } else w=(1-r*r)**2;
    }
    else if (s.kind==='mountain') w=(1-r*r)**(3.5*2**((.5-s.softness)*1.5));
    else w=1-smooth(0,1,r);
    if (bumpy && !shoulderedHill) w=clamp(w*(1+s.rough*.09*s.noise.detail[i]),0,1);
    // Most brushes union influences; the swept hill instead uses its nearest
    // curve section. Neither adds height merely because the pointer dwells.
    const influence=Math.max(w,core);
    if (!shoulderedHill && influence<=s.weights[i]) continue;
    s.weights[i]=influence; const base=s.base[i]; let value=base;
    if (s.kind==='plateau') value=base+(s.baseline+s.amount+s.rough*3*s.noise.detail[i]-base)*w;
    else if (s.kind==='offset') value=base+s.amount*w;
    else if (s.kind==='hill' || s.kind==='mountain') value=base+s.amount*w*(shoulderedHill?hillLift(s,i):1);
    else if (s.kind==='lower') value=base-s.amount*w;
    else if (s.kind==='deep' || s.kind==='shallow') {
      let bed=s.kind==='deep'?-55:-7;
      if (naturalWater) {
        // Uneven shelves belong to the bed, not a fixed-width blue outline.
        // The deepest centre follows the input; later shallow strokes still
        // set their own continuous bed and protection mask in the usual way.
        const shelf=smooth(-.15,.55,s.noise.shelf[i])*smooth(.08,.50,r);
        bed+=42*shelf*s.shelves;
      }
      value=base+(bed-base)*w;
      if (naturalWater && core) value=Math.min(value,base+(-55-base)*core);
      // Reshape only the dry part of an ordinary low bank. The waterline,
      // guided deep bed and elevated coastal terrain retain their positions.
      if (s.beachFlatness!==.5 && base>config.seaLevel && base<=config.baseHeight+1 && value>config.seaLevel) {
        const above=(value-config.seaLevel)/(base-config.seaLevel);
        value=config.seaLevel+(base-config.seaLevel)*above**(2**((s.beachFlatness-.5)*2.4));
      }
      // Passage authoring raises only the submerged bed. Keeping the existing
      // bank avoids a narrow canal cut into each dry-land approach.
      if (s.kind==='shallow' && s.shallowMode==='passage') value=Math.max(base,value);
    }
    else if (s.kind==='smooth') value=base+(s.smoothTarget[i]-base)*w*clamp(s.amount/100,0,1);
    heights[i]=clamp(value,MIN_HEIGHT,MAX_HEIGHT);
    if (s.kind!=='smooth' && value!==base) routes[i]=s.routeBase[i]*(1-influence);
    // Design intent survives weathering: buildable crests and shallow routes
    // are protected, while new hills reopen the affected slopes to weathering.
    if (s.kind==='shallow' && s.shallowMode==='passage' && value===base) protection[i]=s.protectBase[i];
    else if (s.kind==='plateau' || s.kind==='shallow') protection[i]=Math.max(s.protectBase[i]*(1-w),smooth(.65,.95,w));
    // A raised or lowered area keeps the ground's own protection; only its
    // new edge faces open to weathering.
    else if (s.kind==='offset') protection[i]=s.protectBase[i]*(1-4*w*(1-w));
    else if (s.kind!=='smooth') protection[i]=s.protectBase[i]*(1-influence);
  }
  heightDirty=true;
}
function extendStroke(s,p) {
  if (s.kind==='hill' && experiment.get('forms')==='shouldered') {
    if (Math.hypot(p.x-s.last.x,p.y-s.last.y)<.2) return;
    // The first span replaces the point preview once its direction is known.
    // Exact nearest points along each segment avoid a cadence of round dabs.
    if (!s.hasSpan) { heights.set(s.base); protection.set(s.protectBase); routes.set(s.routeBase); s.weights.fill(0); s.distances.fill(Infinity); s.hasSpan=true; }
    dab(s,s.last,p); s.last=p; s.end=p; s.path.push(p); return;
  }
  const count=Math.max(1,Math.ceil(Math.hypot(p.x-s.last.x,p.y-s.last.y)/(s.radius/5)));
  for (let k=1;k<=count;k++) { const t=k/count; dab(s,{x:s.last.x+(p.x-s.last.x)*t,y:s.last.y+(p.y-s.last.y)*t}); }
  s.last=p; s.end=p; s.path.push(p);
}
function settleHill(s) {
  if (s.kind!=='hill' || experiment.get('forms')!=='shouldered' || s.path.length<3) return;
  // Round guidance corners before sweeping the final ridge. The live field is
  // still drawn immediately; release replaces its abrupt segment junctions.
  let path=[s.path[0]];
  for (const p of s.path.slice(1,-1)) {
    const last=path[path.length-1];
    if (Math.hypot(p.x-last.x,p.y-last.y)>s.radius*.16) path.push(p);
  }
  path.push(s.path[s.path.length-1]);
  for (let pass=0;pass<2;pass++) {
    const next=[path[0]];
    for (let i=0;i<path.length-1;i++) {
      const a=path[i],b=path[i+1];
      next.push({x:.75*a.x+.25*b.x,y:.75*a.y+.25*b.y}, {x:.25*a.x+.75*b.x,y:.25*a.y+.75*b.y});
    }
    next.push(path[path.length-1]); path=next;
  }
  const frames=path.map((p,i) => {
    const a=path[Math.max(0,i-1)],b=path[Math.min(path.length-1,i+1)];
    const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
    return [-dy/length*s.faceSide,dx/length*s.faceSide];
  });
  heights.set(s.base); protection.set(s.protectBase); s.weights.fill(0); s.distances.fill(Infinity);
  for (let i=0;i<path.length-1;i++) dab(s,path[i],path[i+1],frames[i],frames[i+1]);
  // Only the newly added influence is softened across nearest-section seams;
  // the terrain under it, including a plateau or a shore, is not blurred.
  const joined=blurred(blurred(s.weights,2),2);
  const c=clip||{x0:0,y0:0,x1:grid-1,y1:grid-1};
  for (let y=c.y0;y<=c.y1;y++) for (let i=y*grid+c.x0,end=y*grid+c.x1;i<=end;i++) {
    heights[i]=clamp(s.base[i]+s.amount*joined[i]*hillLift(s,i),MIN_HEIGHT,MAX_HEIGHT);
    protection[i]=s.protectBase[i]*(1-joined[i]);
    routes[i]=s.routeBase[i]*(1-joined[i]);
  }
}
function reapplyWater() {
  if (!ready || stroke || !lastWaterStroke || lastWaterStroke.kind!==tool) return;
  const old=lastWaterStroke,points=old.path;
  cancelWeather(); heights.set(old.base); protection.set(old.protectBase); routes.set(old.routeBase);
  const next=startStroke(old.kind,points[0]);
  dab(next,points[0]); for (const p of points.slice(1)) extendStroke(next,p);
  lastWaterStroke=next; markChanged(); checkpoint(); schedule(); queueWeather();
  status('Updated the last water stroke from its original path.');
}
function rampSegment(s,a,b) {
  // Cache nearest coverage only around the appended segment. Earlier spans
  // never need another nearest-segment search while the pointer is moving.
  s.rampField ??= {distance:new Float32Array(heights.length).fill(Infinity),along:new Float32Array(heights.length),touched:[],length:0};
  const field=s.rampField,dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
  if (length2<1e-8) return;
  const length=Math.sqrt(length2),radius=s.radius,amp=s.rough*radius*.14;
  let x0=clamp(Math.floor((Math.min(a.x,b.x)-radius-2*amp)/spacing),0,grid-1),x1=clamp(Math.ceil((Math.max(a.x,b.x)+radius+2*amp)/spacing),0,grid-1);
  let y0=clamp(Math.floor((Math.min(a.y,b.y)-radius-2*amp)/spacing),0,grid-1),y1=clamp(Math.ceil((Math.max(a.y,b.y)+radius+2*amp)/spacing),0,grid-1);
  if (clip) { x0=Math.max(x0,clip.x0); x1=Math.min(x1,clip.x1); y0=Math.max(y0,clip.y0); y1=Math.min(y1,clip.y1); }
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) {
    const i=y*grid+x,wx=x*spacing,wy=y*spacing,t=clamp(((wx-a.x)*dx+(wy-a.y)*dy)/length2,0,1);
    const cx=a.x+dx*t,cy=a.y+dy*t;
    const plainDistance=Math.hypot(wx-cx,wy-cy);
    // The graded centre follows the curve exactly. Only the outer shoulder
    // borrows the brush's outline variation; it cannot buckle the grade.
    const edgeNoise=smooth(.55,1,plainDistance/radius)*amp;
    const ex=s.noise.x[i]-sample(s.noise.x,cx,cy),ey=s.noise.y[i]-sample(s.noise.y,cx,cy);
    const distance=Math.hypot(wx-cx+edgeNoise*(s.rot[0]*ex-s.rot[1]*ey),wy-cy+edgeNoise*(s.rot[1]*ex+s.rot[0]*ey));
    if (distance>=radius || distance>=field.distance[i]) continue;
    if (field.distance[i]===Infinity) field.touched.push(i);
    field.distance[i]=distance; field.along[i]=field.length+t*length;
    s.weights[i]=1-smooth(.55,1,distance/radius);
  }
  field.length+=length;
}
function gradeRamp(s) {
  const field=s.rampField;
  if (!field?.length) return;
  const ah=sample(s.base,s.start.x,s.start.y),bh=sample(s.base,s.end.x,s.end.y);
  // A new endpoint changes the grade along the whole path, but only covered
  // samples are visited. Heights always come from the captured starting field.
  for (const i of field.touched) {
    const w=s.weights[i],t=clamp(field.along[i]/field.length,0,1);
    // Integrate a short eased approach at each end, with constant grade in
    // between. This avoids a crease at a level endpoint without doming the path.
    const ease=Math.min(.18,s.radius/field.length);
    const grade=t<ease?t*t/(2*ease*(1-ease)):t>1-ease?1-(1-t)*(1-t)/(2*ease*(1-ease)):(t-ease*.5)/(1-ease);
    const level=ah+(bh-ah)*grade;
    heights[i]=clamp(s.base[i]+(level-s.base[i])*w,MIN_HEIGHT,MAX_HEIGHT);
    // Joining routes retain the earlier smooth corridor through this ramp's
    // shoulder; a partial overlap must not reopen it to cracks or weathering.
    protection[i]=Math.max(s.protectBase[i],smooth(.55,.92,w));
    routes[i]=Math.max(s.routeBase[i],smooth(.30,.92,w));
  }
  heightDirty=true;
}
function ramp(s,p) {
  if (Math.hypot(p.x-s.end.x,p.y-s.end.y)<1e-4) return;
  rampSegment(s,s.end,p); s.last=p; s.end=p; s.path.push(p); gradeRamp(s);
}
function settleRamp(s) {
  if (s.kind!=='ramp' || s.path.length<3) return;
  // Decimate pointer cadence before two corner-cutting passes. Exact endpoints
  // survive, so their original heights still determine the finished grade.
  let path=[s.path[0]];
  for (const p of s.path.slice(1,-1)) {
    const last=path[path.length-1];
    if (Math.hypot(p.x-last.x,p.y-last.y)>s.radius*.12) path.push(p);
  }
  path.push(s.path[s.path.length-1]);
  for (let pass=0;pass<2;pass++) {
    const next=[path[0]];
    for (let i=0;i<path.length-1;i++) {
      const a=path[i],b=path[i+1];
      next.push({x:.75*a.x+.25*b.x,y:.75*a.y+.25*b.y},{x:.25*a.x+.75*b.x,y:.25*a.y+.75*b.y});
    }
    next.push(path[path.length-1]); path=next;
  }
  heights.set(s.base); protection.set(s.protectBase); routes.set(s.routeBase); s.weights.fill(0);
  s.rampField.distance.fill(Infinity); s.rampField.touched.length=0; s.rampField.length=0;
  for (let i=0;i<path.length-1;i++) rampSegment(s,path[i],path[i+1]);
  s.path=path; gradeRamp(s);
}

function markViewChanged() { revision++; needsDraw=true; renderedRevision=-1; $('export').disabled=true; }
function markChanged() { markViewChanged(); heightDirty=true; error(); }

// Shapes are nodes: kind, path, parameters and seed. The map is rebuilt by
// replaying nodes in order, so relative heights follow the ground beneath
// (a hill on a plateau rises with it). prefix[i] keeps the surface before
// node i, so an edit replays only from the edited node onward.
let nodes=[], prefix=[], selected=-1, moving=null, pendingEval=-1, pendingRect=null;
const noiseCache=new Map();
function noiseFor(s) { if (!noiseCache.has(s)) { noiseCache.set(s,makeNoise(s)); if (noiseCache.size>16) noiseCache.delete(noiseCache.keys().next().value); } return noiseCache.get(s); }
const NODE_NAMES={ground:'Ground undulation',crater:'Crater',offset:'Raise / lower',plateau:'Plateau',hill:'Hill',mountain:'Mountain',ramp:'Ramp',deep:'Deep water',shallow:'Shallow water',smooth:'Smooth',lower:'Lower',raster:'Imported surface',compact:'Height scale'};
function strokeParams(s) { return {radius:s.radius,amount:s.amount,rough:s.rough,bankWidth:s.bankWidth,softness:s.softness,beachFlatness:s.beachFlatness,shelves:s.shelves,shallowMode:s.shallowMode,craterlets:s.craterlets,craterEjecta:s.craterEjecta,cracks:s.cracks}; }
function applyNode(n) {
  if (n.hidden) return;
  if (n.kind==='raster') { for (const i of clipCells()) { heights[i]=n.heights[i]; protection[i]=n.protection[i]; routes[i]=n.routes[i]; } return; }
  if (n.kind==='ground') {
    // Broad, low undulation of dry ground, as retail maps have: about half of
    // retail dry land is gently sloped rather than dead level. Protected
    // crests, ramps and passages keep their authored surface.
    const amp=n.amplitude??8,wave=n.wavelength??160,cover=n.coverage??.5,s=n.seed??1;
    for (const i of clipCells()) {
      const x=i%grid,y=(i-x)/grid,h=heights[i];
      if (h<=config.seaLevel+1) continue;
      const wx=x*spacing,wy=y*spacing;
      const v=.6*valueNoise(wx/wave,wy/wave,s^0x51a3)+.3*valueNoise(wx*2.1/wave,wy*2.1/wave,s^0x2b7d)+.1*valueNoise(wx*4.3/wave,wy*4.3/wave,s^0x6c11);
      // Retail dry land is bimodal: about half dead level, half rolling. A
      // broad mask confines the undulation to patches.
      const threshold=(.5-cover)*1.2,patch=smooth(threshold-.15,threshold+.15,valueNoise(wx/(wave*3.2),wy/(wave*3.2),s^0x7f4b));
      // Dry ground stays dry: undulation never opens new ponds.
      const next=h+amp*v*patch*(1-protection[i])*smooth(config.seaLevel+1,config.seaLevel+8,h);
      heights[i]=clamp(Math.max(next,Math.min(h,config.seaLevel+1.5)),MIN_HEIGHT,MAX_HEIGHT);
    }
    return;
  }
  if (n.kind==='compact') { for (const i of clipCells()) if (heights[i]>config.baseHeight) heights[i]=config.baseHeight+(heights[i]-config.baseHeight)*n.factor; return; }
  const pts=n.points,b=nodeBounds(n),c=clip||{x0:0,y0:0,x1:grid-1,y1:grid-1};
  const s=startStroke(n.kind,pts[0],{...n.params,seed:n.seed,frame:n.frame,node:n,
    rect:{x0:Math.max(b.x0,c.x0),y0:Math.max(b.y0,c.y0),x1:Math.min(b.x1,c.x1),y1:Math.min(b.y1,c.y1)}});
  if (n.kind==='ramp') { for (const p of pts.slice(1)) ramp(s,p); settleRamp(s); return; }
  if (n.kind==='hill' && experiment.get('forms')==='shouldered' && experiment.get('replay')!=='full') {
    // The settled ridge replaces every live dab, so replay goes straight to
    // it: the same accepted path and face side, without the discarded pass.
    const path=[pts[0]];
    for (const p of pts.slice(1)) if (Math.hypot(p.x-path[path.length-1].x,p.y-path[path.length-1].y)>=.2) path.push(p);
    if (path.length>=3) {
      const sx=path[1].x-path[0].x,sy=path[1].y-path[0].y;
      s.faceSide=(-sy*s.face[0]+sx*s.face[1])<0?-1:1; s.path=path; s.last=s.end=path[path.length-1];
      settleHill(s); applyCracks(s); return;
    }
  }
  dab(s,pts[0]); for (const p of pts.slice(1)) extendStroke(s,p); settleHill(s);
  if (n.kind==='crater') addCraterlets(n,s);
  applyCracks(s);
}
function applyCracks(s) {
  // A shape marks where cracks may open: its own influence times its Cracks
  // amount. The bake carves the fissures from this field.
  if (!(s.cracks>0) || !['hill','mountain','plateau','crater','offset'].includes(s.kind)) return;
  for (const i of clipCells()) if (s.weights[i]>0) cracks[i]=Math.max(cracks[i],Math.min(1,s.weights[i]*1.6)*s.cracks);
}
const craterletKeys=new WeakMap();
function addCraterlets(n,s) {
  // Small satellite craters around the rim and apron, as on retail Moon
  // sections. Positions, sizes and depths come from the crater's seed.
  const count=Math.round(s.craterlets||0),c=n.points[n.points.length>>1];
  const framed=!isIdentity(n.frame),turn=framed?Math.atan2(n.frame[1],n.frame[0]):0;
  let keys=craterletKeys.get(n); if (!keys) craterletKeys.set(n,keys=[]);
  for (let k=0;k<count;k++) {
    const h=(a) => { let x=Math.imul((s.seed>>>0)+k*7919+a*104729,2654435761)>>>0; x^=x>>>15; x=Math.imul(x,2246822519)>>>0; return (x>>>0)/4294967296; };
    const angle=h(1)*Math.PI*2+turn,dist=s.radius*(.9+h(2)*1.1),small=s.radius*(.1+.22*h(3));
    const p={x:clamp(c.x+Math.cos(angle)*dist,0,size-1),y:clamp(c.y+Math.sin(angle)*dist,0,size-1)};
    let rect=null;
    if (framed) {
      const reach=small*3+12*spacing,box=clip||{x0:0,y0:0,x1:grid-1,y1:grid-1};
      rect={x0:Math.max(box.x0,Math.floor((p.x-reach)/spacing)),y0:Math.max(box.y0,Math.floor((p.y-reach)/spacing)),x1:Math.min(box.x1,Math.ceil((p.x+reach)/spacing)),y1:Math.min(box.y1,Math.ceil((p.y+reach)/spacing))};
      keys[k] ??= {};
    }
    const t=startStroke('crater',p,{...n.params,radius:small,amount:s.amount*(.25+.3*h(4)),seed:(s.seed+k*2654435761)>>>0,craterlets:0,frame:n.frame,node:keys[k],rect});
    dab(t,p);
  }
}
function snapshot() { return {h:heights.slice(),p:protection.slice(),r:routes.slice(),c:cracks.slice()}; }
function addNode(n) { prefix[nodes.length]=snapshot(); nodes.push(n); applyNode(n); }
let lastEvalMs=0;
// Region-limited replay. clip is the rectangle (grid cells, inclusive) that
// node application may compute; with no clip, the whole grid.
let clip=null;
function* clipCells() {
  const c=clip||{x0:0,y0:0,x1:grid-1,y1:grid-1};
  for (let y=c.y0;y<=c.y1;y++) for (let x=c.x0;x<=c.x1;x++) yield y*grid+x;
}
function nodeBounds(n) {
  // World-space reach of a shape, from the same extents its brush uses,
  // plus a few cells for the hill's softening blur.
  if (!n.points) return {x0:0,y0:0,x1:grid-1,y1:grid-1};
  const q=n.params||{},radius=q.radius||40,rough=q.rough??.35,soft=q.softness??.5;
  const bank=['deep','shallow'].includes(n.kind)?2**(((q.bankWidth??.5)-.5)*1.3):1;
  const back=soft===.5?1.34:2-(.66+(soft-.5)*.9);
  const reach={plateau:Math.min(1.7,1+rough*1.3)+1.9*rough,offset:Math.min(1.7,1+rough*1.3)+1.9*rough,hill:Math.max(1.4,back)*1.75+1.7*rough,deep:Math.min(1.9,1+rough*1.6)*bank+2.2*rough,
    shallow:bank+.4*rough,crater:2.9*(1+.45*rough)+.9*rough,ramp:1+.28*rough}[n.kind] ?? 1+.4*rough;
  const r=radius*reach+12*spacing;
  let ax=Infinity,ay=Infinity,bx=-Infinity,by=-Infinity;
  for (const p of n.points) { ax=Math.min(ax,p.x); ay=Math.min(ay,p.y); bx=Math.max(bx,p.x); by=Math.max(by,p.y); }
  return {x0:clamp(Math.floor((ax-r)/spacing),0,grid-1),y0:clamp(Math.floor((ay-r)/spacing),0,grid-1),x1:clamp(Math.ceil((bx+r)/spacing),0,grid-1),y1:clamp(Math.ceil((by+r)/spacing),0,grid-1)};
}
const unionRect=(a,b) => !a?b:!b?a:{x0:Math.min(a.x0,b.x0),y0:Math.min(a.y0,b.y0),x1:Math.max(a.x1,b.x1),y1:Math.max(a.y1,b.y1)};
const overlaps=(a,b) => a.x0<=b.x1 && b.x0<=a.x1 && a.y0<=b.y1 && b.y0<=a.y1;
function copyRect(src,dst,r) { for (let y=r.y0;y<=r.y1;y++) dst.set(src.subarray(y*grid+r.x0,y*grid+r.x1+1),y*grid+r.x0); }
// TODO(perf): dragging a map-wide lake still costs ~80 ms a frame, two thirds
// of it in dab(): swept water and plateau strokes are replayed as many
// overlapping dabs. Settle by evaluating a stroke as one pass over the
// distance to its path, and by moving node replay to a worker (or a coarse
// grid while dragging) so the view never waits on it.
function evaluateRegion(from,rect) {
  // Replays nodes from 'from' inside rect only. Each node is computed over a
  // margin (for neighbourhood steps such as the hill's softening blur) and
  // the margin is put back, so nothing outside rect changes.
  const inner=rect,margin=6;
  const outer={x0:Math.max(0,inner.x0-margin),y0:Math.max(0,inner.y0-margin),x1:Math.min(grid-1,inner.x1+margin),y1:Math.min(grid-1,inner.y1+margin)};
  copyRect(prefix[from].h,heights,inner); copyRect(prefix[from].p,protection,inner); copyRect(prefix[from].r,routes,inner); copyRect(prefix[from].c,cracks,inner);
  const saveH=new Float32Array(heights.length),saveP=new Float32Array(heights.length),saveR=new Float32Array(heights.length),saveC=new Float32Array(heights.length);
  for (let i=from;i<nodes.length;i++) {
    if (!prefix[i]) prefix[i]=snapshot(); else { copyRect(heights,prefix[i].h,inner); copyRect(protection,prefix[i].p,inner); copyRect(routes,prefix[i].r,inner); copyRect(cracks,prefix[i].c,inner); }
    if (!overlaps(nodeBounds(nodes[i]),outer)) continue;
    copyRect(heights,saveH,outer); copyRect(protection,saveP,outer); copyRect(routes,saveR,outer); copyRect(cracks,saveC,outer);
    clip=outer; try { applyNode(nodes[i]); } finally { clip=null; }
    for (const band of [{x0:outer.x0,y0:outer.y0,x1:outer.x1,y1:inner.y0-1},{x0:outer.x0,y0:inner.y1+1,x1:outer.x1,y1:outer.y1},
                        {x0:outer.x0,y0:inner.y0,x1:inner.x0-1,y1:inner.y1},{x0:inner.x1+1,y0:inner.y0,x1:outer.x1,y1:inner.y1}]) {
      if (band.x0>band.x1 || band.y0>band.y1) continue;
      copyRect(saveH,heights,band); copyRect(saveP,protection,band); copyRect(saveR,routes,band); copyRect(saveC,cracks,band);
    }
  }
  prefix.length=nodes.length; heightDirty=true; markChanged();
}
function evaluate(from=0,rect=null) {
  const evalStart=performance.now();
  if (rect && from>0 && prefix[from] && prefix.length>=nodes.length) { evaluateRegion(from,rect); lastEvalMs=performance.now()-evalStart; return; }
  from=Math.max(0,Math.min(from,nodes.length));
  if (from>0 && prefix[from]) { heights.set(prefix[from].h); protection.set(prefix[from].p); routes.set(prefix[from].r); cracks.set(prefix[from].c); }
  else { from=0; heights.fill(config.baseHeight); protection.fill(0); routes.fill(0); cracks.fill(0); }
  for (let i=from;i<nodes.length;i++) { prefix[i]=snapshot(); applyNode(nodes[i]); }
  prefix.length=nodes.length; heightDirty=true; markChanged();
  lastEvalMs=performance.now()-evalStart;
}
function cloneNodes(list=nodes) { return list.map(n => ({...n,points:n.points?.map(p => ({...p})),params:n.params?{...n.params}:undefined})); }
function nodeDistance(n,p) {
  if (!n.points) return Infinity;
  let best=Infinity;
  for (let i=0;i<n.points.length;i++) {
    const a=n.points[i],b=n.points[Math.min(i+1,n.points.length-1)],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
    const t=l2?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/l2,0,1):0;
    best=Math.min(best,Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t));
  }
  return best;
}
// Moving, rotating and scaling a shape: the gesture's transform applies to
// the shape as it was when the gesture began, path and frame together.
function nodeState(n) { return {points:n.points.map(q => ({...q})),frame:n.frame||IDENTITY,radius:n.params?.radius,amount:n.params?.amount}; }
function transformNode(n,start,m) {
  n.points=start.points.map(q => { const r=applyFrame(m,q.x,q.y); return {x:clamp(r.x,0,size-1),y:clamp(r.y,0,size-1)}; });
  n.frame=compose(m,start.frame);
  if (n.params && start.radius) n.params={...n.params,radius:clamp(start.radius*Math.hypot(m[0],m[1]),4,600)};
}
function nodePivot(n) {
  let ax=Infinity,ay=Infinity,bx=-Infinity,by=-Infinity;
  for (const p of n.points) { ax=Math.min(ax,p.x); ay=Math.min(ay,p.y); bx=Math.max(bx,p.x); by=Math.max(by,p.y); }
  return {x:(ax+bx)/2,y:(ay+by)/2,reach:Math.hypot(bx-ax,by-ay)/2+(n.params?.radius||40)};
}
// Handle positions on the overlay: round rotates, square scales.
function nodeHandles(n) {
  const c=nodePivot(n),lift=(Math.max(config.seaLevel,sample(heights,c.x,c.y))-config.baseHeight)*.5;
  const r=Math.min(c.reach,size*.45),inside=v => clamp(v,12,size-12);
  return {pivot:c,centre:{cx:c.x,cy:c.y-lift},rotate:{cx:inside(c.x),cy:inside(c.y-lift-r)},scale:{cx:inside(c.x+r*.707),cy:inside(c.y-lift+r*.707)},radius:r};
}
function changeSelected(edit) {
  const n=nodes[selected]; if (!n?.points || stroke || moving) return;
  const before=nodeBounds(n); cancelWeather(); edit(n);
  pendingRect=unionRect(pendingRect,unionRect(before,nodeBounds(n))); pendingEval=pendingEval<0?selected:Math.min(pendingEval,selected);
  flushEval(); markViewChanged(); checkpoint(); queueWeather(); selectNode(selected); schedule();
}
function pickNode(p) {
  let best=-1,bestScore=Infinity;
  nodes.forEach((n,i) => { const d=nodeDistance(n,p),reach=Math.max(24,(n.params?.radius||40)); if (d<reach && d/reach<bestScore) { bestScore=d/reach; best=i; } });
  return best;
}
function selectNode(i) {
  selected=i;
  const n=nodes[i];
  if (n && n.params && HELP[n.kind]) {
    if (tool!=='move') { rememberTool(); tool=n.kind; }
    const p=n.params;
    const [lo,hi]=amountRange(n.kind); $('amount').min=String(lo); $('amount').max=String(hi);
    $('diameter').value=clamp(p.radius*2,40,400); $('amount').value=clamp(p.amount,lo,hi); $('roughness').value=clamp(Math.round(p.rough*100),0,100);
    $('softness').value=Math.round(p.softness*100); $('bank-width').value=Math.round(p.bankWidth*100); $('beach-flatness').value=Math.round(p.beachFlatness*100);
    $('shelves').value=Math.round(p.shelves*100); $('shallow-mode').value=p.shallowMode==='area'?'area':'passage'; $('cracks').value=Math.round((p.cracks||0)*100);
  }
  renderLayers(); updateControls(); schedule(false);
  if (n) status(`Editing ${NODE_NAMES[n.kind]||n.kind} #${i+1}: sliders change this shape. Draw to start a new one.`);
}
function editSelectedFromControls() {
  const n=nodes[selected]; if (!n || !n.params) return;
  const before=nodeBounds(n);
  n.params={...n.params,radius:Number($('diameter').value)/2,amount:Number($('amount').value),rough:Number($('roughness').value)/100,
    softness:Number($('softness').value)/100,bankWidth:Number($('bank-width').value)/100,beachFlatness:Number($('beach-flatness').value)/100,
    shelves:Number($('shelves').value)/100,shallowMode:$('shallow-mode').value,cracks:Number($('cracks').value)/100};
  pendingRect=unionRect(pendingRect,unionRect(before,nodeBounds(n)));
  cancelWeather(); pendingEval=pendingEval<0?selected:Math.min(pendingEval,selected); schedule();
}
function renderLayers() {
  const list=$('layers'); if (!list) return;
  list.replaceChildren(...nodes.map((n,i) => {
    const item=document.createElement('li');
    item.textContent=`${NODE_NAMES[n.kind]||n.kind}${n.hidden?' (hidden)':''}`;
    item.className=i===selected?'selected':'';
    item.addEventListener('click',() => selectNode(i===selected?-1:i));
    return item;
  }));
  for (const id of ['node-seed','node-delete','node-up','node-down','node-hide']) $(id).disabled=selected<0;
}
function nodeAction(kind) {
  const i=selected; if (i<0 || stroke) return;
  cancelWeather();
  if (kind==='delete') { nodes.splice(i,1); selected=-1; evaluate(i); }
  else if (kind==='hide') { nodes[i].hidden=!nodes[i].hidden; evaluate(i); }
  else if (kind==='seed') { if (nodes[i].seed===undefined) return; nodes[i].seed=(Math.random()*4294967295)>>>0; evaluate(i); }
  else if (kind==='up' && i>0) { [nodes[i-1],nodes[i]]=[nodes[i],nodes[i-1]]; selected=i-1; evaluate(i-1); }
  else if (kind==='down' && i<nodes.length-1) { [nodes[i+1],nodes[i]]=[nodes[i],nodes[i+1]]; selected=i+1; evaluate(i); }
  checkpoint(); renderLayers(); schedule(); queueWeather();
}
// Apply a pending node edit now, so history and refinement see it.
function flushEval() { if (pendingEval>=0) { const from=pendingEval,rect=pendingRect; pendingEval=-1; pendingRect=null; evaluate(from,rect); } }
function checkpoint() {
  flushEval();
  history.splice(historyIndex+1); history.push({nodes:cloneNodes(),refinementSeed}); if (history.length>48) history.shift(); historyIndex=history.length-1;
  renderLayers(); updateControls(); persistLater();
}
function moveHistory(delta) {
  const next=historyIndex+delta; if (!ready || stroke || next<0 || next>=history.length) return;
  lastWaterStroke=null; cancelWeather(); nodes=cloneNodes(history[next].nodes); prefix=[]; selected=-1; refinementSeed=history[next].refinementSeed; historyIndex=next;
  evaluate(0); renderLayers(); updateControls(); persistLater(); status(delta<0?'Undid the last change.':'Restored the change.'); schedule(); queueWeather();
}

// While a shape is edited the material transport is too slow to rerun, so a
// quick approximation stands in: biomes whose colours come from it (the
// Archipelago's dark hills) keep roughly their final look instead of
// turning pale until refinement finishes.
const materialPreview=() => experiment.get('deposits')!=='off' && Number($('material-weathering').value)>0;
function quickMaterials() {
  if (!renderer || !materialPreview()) { renderer?.setMaterialField(); return; }
  renderer.setMaterialField(quickMaterialField({height:heights,grid,size,seed:refinementSeed,baseHeight:config.baseHeight,seaLevel:config.seaLevel,
    depositSpread:Number($('deposit-spread').value)/100,materialProfile:{...config.material,mineral:renderer.variant.get('transition')==='mineral'}}));
}
function cancelWeather() {
  weatherJob++; weatherBase=null;
  quickMaterials();
  weatherWorker?.postMessage({cancel:true,job:weatherJob});
  weatherState=$('weather').checked?'pending':'disabled';
  $('weather-state').textContent=$('weather').checked?'Refinement paused while editing.':'Weathering off · authored surface';
  updateControls();
}
function previewHeight() {
  if (!refined || !refinedBase || !$('weather').checked) return heights;
  const display=heights.slice();
  for (let i=0;i<display.length;i++) display[i]+=(refined[i]-refinedBase[i])*(1-smooth(0,10,Math.abs(heights[i]-refinedBase[i])))*(1-routes[i]);
  return display;
}
function queueWeather() {
  flushEval();
  if (!$('weather').checked) {
    weatherState='disabled'; $('weather-state').textContent='Weathering off · authored surface'; updateControls(); return;
  }
  weatherState='pending'; renderedRevision=-1; updateControls();
  if (stroke) { $('weather-state').textContent='Refinement paused while editing.'; return; }
  try {
    if (!weatherWorker) startWeatherWorker();
    const job=++weatherJob;
    weatherBase=heights.slice();
    $('weather-state').textContent='Refining exposed slopes…';
    const profile=experiment.get('weather')==='broad'?'broad':undefined;
    weatherWorker.postMessage({job,height:weatherBase,protect:protection,grid,size,seed:refinementSeed,strength:0.35,profile,baseHeight:config.baseHeight,talus:Number($('scree').value)/100,seaLevel:config.seaLevel,materialWeathering:experiment.get('deposits')==='off'?0:Number($('material-weathering').value)/100,depositSpread:Number($('deposit-spread').value)/100,materialProfile:{...config.material,mineral:renderer.variant.get('transition')==='mineral'},
      sand:Number(experiment.get('sand')||0),sandReach:Number(experiment.get('sandReach')??.6),sandPatchy:Number(experiment.get('sandPatchy')??.7),sandTail:Number(experiment.get('sandTail')??.6),windStrength:Number(experiment.get('windStrength')??.5),windAngle:Number(experiment.get('wind')??20)});
  } catch (err) { failWeather(err.message); }
}
function failWeather(message) {
  weatherJob++; weatherBase=null; weatherWorker?.terminate(); weatherWorker=null;
  weatherState=$('weather').checked?'failed':'disabled';
  $('weather-state').textContent=$('weather').checked
    ?`Weathering failed: ${message}. Turn Weathering off to export the authored surface, then on to retry.`
    :'Weathering off · authored surface';
  updateControls();
}
function startWeatherWorker() {
  const worker=new Worker('/sculpt-weathering.js',{type:'module'}); weatherWorker=worker;
  worker.onmessage=event => {
    const data=event.data;
    if (worker!==weatherWorker || data.job!==weatherJob || stroke || !$('weather').checked) return;
    if (data.error) { failWeather(data.error); return; }
    refined=data.height; refinedBase=weatherBase;
    renderer.setHeight(refined,grid); renderer.setRoutes(routes,cracks); renderer.setWeather(data.flow,data.deposit,data.talus,data.sand);
    if (data.materialField) renderer.setMaterialField(data.materialField);
    heightDirty=false;
    if (data.done) { weatherState='ready'; renderedRevision=-1; updateControls(); }
    $('weather-state').textContent=data.done?`Weathered edges · ${Math.round(data.milliseconds)} ms`:data.progress>=.93?'Settling surface materials…':`Refining exposed slopes · ${Math.round(data.progress*100)}%`;
    schedule();
  };
  worker.onerror=event => { if (worker===weatherWorker) failWeather(event.message || 'worker unavailable'); };
}
function schedule(draw=true) { if (draw) needsDraw=true; if (!framePending) { framePending=true; requestAnimationFrame(frame); } }
function drawTiming(stats,elapsed,quality) {
  const ms=Number.isFinite(stats?.milliseconds)?stats.milliseconds:elapsed;
  const gpu=Number.isFinite(stats?.gpuMilliseconds)?` · GPU ${stats.gpuMilliseconds.toFixed(1)} ms (recent)`:'';
  const interval=paintingIntervals.length?` · stroke RAF ${(paintingIntervals.reduce((sum,v) => sum+v,0)/paintingIntervals.length).toFixed(1)} ms`:' · stroke RAF —';
  $('timing').textContent=`Draw ${ms.toFixed(1)} ms CPU${gpu}${interval} · shapes ${lastEvalMs.toFixed(1)} ms · ${quality}`;
}
function frame(timestamp) {
  framePending=false; if (!renderer) return;
  if (stroke) { if (lastPaintingRAF!==null) { paintingIntervals.push(timestamp-lastPaintingRAF); if (paintingIntervals.length>10) paintingIntervals.shift(); } lastPaintingRAF=timestamp; }
  else lastPaintingRAF=null;
  try {
    flushEval();
    if (heightDirty) { renderer.setHeight(previewHeight(),grid); renderer.setRoutes(routes,cracks); if ((stroke || moving) && materialPreview()) quickMaterials(); heightDirty=false; }
    if (needsDraw || stroke || moving) {
      const quality=stroke||moving?'preview':'full',start=performance.now();
      const stats=renderer.draw({quality,clay:$('clay').checked,light:$('light').value,fractures:Number($('fractures').value)/100,scree:Number($('scree').value)/100,detail:Number($('relief').value)/100,ring:Number($('mineral-ring').value)/100,ringSpread:Number($('ring-spread').value)/100,ringVariation:Number($('ring-variation').value)/100,fringeStyle:$('fringe-style').value,materialWeathering:Number($('material-weathering').value)/100,transitionDetail:Number($('transition-detail').value)/100});
      drawTiming(stats,performance.now()-start,quality);
      if (!stroke && !moving) { renderedRevision=revision; updateControls(); }
      needsDraw=false;
    }
    drawOverlay();
  } catch (err) { error(err.message); status('Rendering failed. Your heightfield remains available to save.'); return; }
  if (stroke || moving) schedule();
}
function drawOverlay() {
  ink.clearRect(0,0,size,size);
  if (cursor && !pan && !space && tool!=='move') {
    ink.strokeStyle='#b8eef3'; ink.fillStyle='#a7e6f00c'; ink.lineWidth=1.5;
    ink.beginPath(); ink.arc(cursor.cx,cursor.cy,stroke?.radius ?? Number($('diameter').value)/2,0,Math.PI*2); ink.fill(); ink.stroke();
    ink.beginPath(); ink.moveTo(cursor.cx-4,cursor.cy); ink.lineTo(cursor.cx+4,cursor.cy); ink.moveTo(cursor.cx,cursor.cy-4); ink.lineTo(cursor.cx,cursor.cy+4); ink.stroke();
  }
  if (selected>=0 && nodes[selected]?.points && !stroke) {
    ink.strokeStyle='#f3d36b'; ink.lineWidth=2; ink.beginPath();
    for (const [i,p] of nodes[selected].points.entries()) {
      const y=p.y-(Math.max(config.seaLevel,sample(heights,p.x,p.y))-config.baseHeight)*.5;
      if (i) ink.lineTo(p.x,y); else ink.moveTo(p.x,y);
    }
    ink.stroke();
  }
  if (tool==='move' && selected>=0 && nodes[selected]?.points && !stroke) {
    const hd=nodeHandles(nodes[selected]);
    ink.strokeStyle='#f3d36b88'; ink.lineWidth=1; ink.setLineDash([4,5]);
    ink.beginPath(); ink.arc(hd.centre.cx,hd.centre.cy,hd.radius,0,Math.PI*2); ink.stroke(); ink.setLineDash([]);
    ink.fillStyle='#f3d36b'; ink.strokeStyle='#1d2416'; ink.lineWidth=1.5;
    ink.beginPath(); ink.moveTo(hd.centre.cx,hd.centre.cy); ink.lineTo(hd.rotate.cx,hd.rotate.cy); ink.strokeStyle='#f3d36b88'; ink.stroke(); ink.strokeStyle='#1d2416';
    ink.beginPath(); ink.arc(hd.rotate.cx,hd.rotate.cy,7,0,Math.PI*2); ink.fill(); ink.stroke();
    ink.fillRect(hd.scale.cx-6,hd.scale.cy-6,12,12); ink.strokeRect(hd.scale.cx-6,hd.scale.cy-6,12,12);
  }
  if (stroke?.kind==='ramp') {
    ink.strokeStyle='#d4eda8'; ink.lineWidth=2; ink.setLineDash([6,5]); ink.beginPath();
    for (const [i,p] of stroke.path.entries()) {
      const y=p.y-(Math.max(config.seaLevel,sample(heights,p.x,p.y))-config.baseHeight)*.5;
      if (i) ink.lineTo(p.x,y); else ink.moveTo(p.x,y);
    }
    ink.stroke(); ink.setLineDash([]);
  }
  overlay.style.cursor=pan?'grabbing':space?'grab':tool==='move'?(moving?'grabbing':'default'):'none';
}
function screenPoint(event) { const r=canvas.getBoundingClientRect(); return {cx:(event.clientX-r.left)*canvas.width/r.width,cy:(event.clientY-r.top)*canvas.height/r.height}; }
function picked(screen) {
  let p;
  if (stroke?.kind==='ramp') {
    // The rendered ramp moves under the cursor as it is graded. Pick against
    // its captured surface instead, avoiding a feedback drift at the endpoint.
    const wx=screen.cx/canvas.width*size,sy=screen.cy/canvas.height*size;
    const projected=y => y-(Math.max(config.seaLevel,sample(stroke.base,wx,y))-config.baseHeight)*.5-sy;
    let previousY=sy+170,previous=projected(previousY);
    for (let y=previousY-2;y>=sy-80;y-=2) {
      const value=projected(y);
      if (value<=0 && previous>=0) {
        p=[wx,previousY-2*previous/Math.max(1e-6,previous-value)]; break;
      }
      previous=value; previousY=y;
    }
    p ??= [wx,sy];
  } else p=renderer.pick(screen.cx,screen.cy);
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  return {x:clamp(p[0],0,size-1),y:clamp(p[1],0,size-1)};
}
overlay.addEventListener('pointerdown',event => {
  if (!ready || loading || stroke || pan || ![0,1].includes(event.button)) return;
  event.preventDefault(); overlay.focus({preventScroll:true}); cursor=screenPoint(event);
  if (space || event.button===1) pan={x:event.clientX,y:event.clientY,left:$('viewport').scrollLeft,top:$('viewport').scrollTop};
  else {
    const p=picked(cursor); if (!p) return;
    if (tool==='move') {
      // A selected shape's handles take precedence over picking.
      let mode=null,i=-1;
      if (selected>=0 && nodes[selected]?.points) {
        const hd=nodeHandles(nodes[selected]),near=q => Math.hypot(cursor.cx-q.cx,cursor.cy-q.cy)<11;
        if (near(hd.rotate)) mode='rotate'; else if (near(hd.scale)) mode='scale';
        if (mode) i=selected;
      }
      if (!mode) { i=pickNode(p); selectNode(i); mode=event.shiftKey?'height':'move'; }
      if (i>=0 && nodes[i].points) {
        if (mode==='height' && (!nodes[i].params || ['deep','shallow','ramp'].includes(nodes[i].kind))) mode='move';
        cancelWeather(); moving={index:i,mode,start:p,screen:{...cursor},pivot:nodePivot(nodes[i]),state:nodeState(nodes[i])};
      }
      pointerId=event.pointerId; overlay.setPointerCapture(event.pointerId); schedule(); return;
    }
    if (selected>=0) { selected=-1; renderLayers(); }
    cancelWeather();
    stroke=startStroke(tool,p); stroke.screenStart=cursor; paintingIntervals=[]; lastPaintingRAF=null; markChanged();
    if (tool!=='ramp') dab(stroke,p);
    status(tool==='ramp'?'Draw a curved route toward the other terrain level.':'Sculpting · preview draw every animation frame.'); updateControls();
  }
  pointerId=event.pointerId; overlay.setPointerCapture(event.pointerId); schedule();
});
overlay.addEventListener('pointermove',event => {
  if (!ready || (pointerId!==null && event.pointerId!==pointerId)) return; cursor=screenPoint(event);
  if (pan) { $('viewport').scrollLeft=pan.left+pan.x-event.clientX; $('viewport').scrollTop=pan.top+pan.y-event.clientY; }
  else if (moving) {
    const p=picked(cursor),n=nodes[moving.index],before=nodeBounds(n),c=moving.pivot,a=moving.start;
    if (moving.mode==='height') {
      // Drag up to raise, down to lower: half a height unit per pixel.
      const [lo,hi]=amountRange(n.kind);
      n.params={...n.params,amount:clamp(Math.round(moving.state.amount+(moving.screen.cy-cursor.cy)*.5),lo,hi)};
      $('amount').value=n.params.amount; updateControls();
    } else if (p) {
      const m=moving.mode==='rotate'?about(c,rotation(Math.atan2(p.y-c.y,p.x-c.x)-Math.atan2(a.y-c.y,a.x-c.x)))
        :moving.mode==='scale'?about(c,scaling(clamp(Math.hypot(p.x-c.x,p.y-c.y)/Math.max(4,Math.hypot(a.x-c.x,a.y-c.y)),.2,5)))
        :[1,0,0,1,p.x-a.x,p.y-a.y];
      transformNode(n,moving.state,m);
      if (moving.mode==='scale') $('diameter').value=clamp(n.params.radius*2,40,400);
    }
    pendingRect=unionRect(pendingRect,unionRect(before,nodeBounds(n))); pendingEval=pendingEval<0?moving.index:Math.min(pendingEval,moving.index);
  }
  else if (stroke) { const p=picked(cursor); if (p) { if (stroke.kind==='ramp') ramp(stroke,p); else extendStroke(stroke,p); } }
  schedule(Boolean(stroke));
});
function endPointer(event) {
  if (pointerId!==event.pointerId) return;
  if (moving) { moving=null; pointerId=null; if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId); flushEval(); markViewChanged(); checkpoint(); queueWeather(); updateControls(); schedule(); return; }
  if (stroke && event.type==='pointerup') { cursor=screenPoint(event); const p=picked(cursor); if (p) { if (stroke.kind==='ramp') ramp(stroke,p); else extendStroke(stroke,p); } }
  const hadStroke=Boolean(stroke);
  const rawPath=stroke?stroke.path.map(p => ({...p})):null;
  if (stroke) { settleHill(stroke); settleRamp(stroke); if (stroke.kind==='crater') addCraterlets({points:rawPath,params:strokeParams(stroke)},stroke); }
  if (stroke) { applyCracks(stroke); prefix[nodes.length]={h:stroke.base,p:stroke.protectBase,r:stroke.routeBase,c:stroke.crackBase}; nodes.push({kind:stroke.kind,points:rawPath,params:strokeParams(stroke),seed:stroke.seed}); prefix.length=nodes.length; renderLayers(); }
  if (stroke) lastWaterStroke=['deep','shallow'].includes(stroke.kind)?stroke:null;
  stroke=null; pan=null; pointerId=null;
  if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
  if (hadStroke) { checkpoint(); status('Stroke complete · full-detail draw.'); queueWeather(); }
  updateControls(); schedule();
}
overlay.addEventListener('pointerup',endPointer); overlay.addEventListener('pointercancel',endPointer);
overlay.addEventListener('lostpointercapture',event => { if (stroke || pan || moving) endPointer(event); });
overlay.addEventListener('pointerleave',() => { if (!stroke && !pan) cursor=null; schedule(false); }); overlay.addEventListener('contextmenu',event => event.preventDefault());
function resize() {
  if (!config) return; const viewport=$('viewport');
  const scale=fitView?Math.max(.05,Math.min((viewport.clientWidth-28)/size,(viewport.clientHeight-28)/size)):1;
  $('stage').style.width=size*scale+'px'; $('stage').style.height=size*scale+'px';
  if (fitView) { viewport.scrollLeft=viewport.scrollTop=0; } updateControls(); schedule();
}

function demoStroke(kind,points,options) {
  const defaults=toolDefaults(kind);
  // Older reviewed examples keep their authored geometry. New island scenes
  // exercise the biome's default shapes.
  const island=experiment.get('example')==='islands';
  const probe=startStroke(kind,points[0],{cracks:(experiment.has('hillCracks')?Number(experiment.get('hillCracks')):1)*defaults.cracks/100,bankWidth:island?defaults.bankWidth/100:.5,beachFlatness:island?defaults.beachFlatness/100:.5,softness:experiment.has('soft')?Number(experiment.get('soft')):island?defaults.softness/100:.5,...options});
  addNode({kind,points:points.map(p => ({...p})),params:strokeParams(probe),seed:probe.seed});
}
function demoRamp(points,options) {
  const probe=startStroke('ramp',points[0],options);
  addNode({kind:'ramp',points:points.map(p => ({...p})),params:strokeParams(probe),seed:probe.seed});
}
function mixedScene() {
  applySeedControl(); refinementSeed=seed;
  lastWaterStroke=null; cancelWeather(); refined=refinedBase=null; renderer?.setWeather(); heights.fill(config.baseHeight); protection.fill(0); routes.fill(0);
  nodes=[]; prefix=[]; selected=-1;
  addGroundNode();
  if (experiment.get('example')==='islands') {
    demoStroke('deep',[{x:50,y:0},{x:100,y:300},{x:35,y:650},{x:150,y:1023}],{radius:150,rough:.6,shelves:.9});
    demoStroke('deep',[{x:0,y:900},{x:450,y:910},{x:1023,y:850}],{radius:165,rough:.55,shelves:.8});
    demoStroke('deep',[{x:1023,y:0},{x:960,y:280},{x:960,y:570},{x:1023,y:1023}],{radius:125,rough:.5,shelves:.85});
    demoStroke('deep',[{x:105,y:575},{x:320,y:630},{x:470,y:760}],{radius:90,rough:.5,shelves:.8});
    demoStroke('shallow',[{x:55,y:270},{x:115,y:365}],{radius:60,rough:.3,shallowMode:'area'});
    demoStroke('shallow',[{x:600,y:910},{x:735,y:910}],{radius:70,rough:.3,shallowMode:'area'});
    demoStroke('hill',[{x:440,y:240},{x:555,y:285}],{radius:95,amount:38,rough:.35});
    demoStroke('hill',[{x:680,y:420},{x:730,y:455}],{radius:54,amount:26,rough:.45});
    demoStroke('plateau',[{x:450,y:470},{x:550,y:480}],{radius:82,amount:40,rough:.4});
    demoRamp([{x:525,y:480},{x:600,y:535},{x:640,y:595}],{radius:32,rough:.18});
    markChanged(); return;
  }
  if (experiment.get('example')==='intersections') {
    // Deliberately small joins exercise the same freehand brushes as the editor.
    demoStroke('plateau',[{x:210,y:230},{x:340,y:245},{x:420,y:330},{x:530,y:315}],{radius:65,amount:54,rough:.5});
    demoStroke('plateau',[{x:215,y:230},{x:260,y:235}],{radius:70,amount:30,rough:.4});
    demoStroke('hill',[{x:230,y:227},{x:262,y:238}],{radius:35,amount:24,rough:.5});
    demoRamp([{x:520,y:315},{x:575,y:355},{x:545,y:415},{x:605,y:460}],{radius:25,rough:.18});
    demoStroke('hill',[{x:180,y:430},{x:240,y:470},{x:320,y:445}],{radius:27,amount:28,rough:.5});
    demoStroke('mountain',[{x:755,y:230},{x:805,y:315}],{radius:62,amount:70,rough:.5});
    demoStroke('plateau',[{x:760,y:500},{x:855,y:525}],{radius:115,amount:65,rough:.5});
    demoStroke('deep',[{x:0,y:690},{x:300,y:675},{x:650,y:700},{x:1023,y:695}],{radius:145,rough:.55});
    demoStroke('shallow',[{x:485,y:495},{x:470,y:825}],{radius:33,rough:.3,shallowMode:'passage'});
    markChanged(); return;
  }
  if (experiment.get('example')==='joins') {
    // Compact relative levels leave room to judge their joins against grass.
    demoStroke('plateau',[{x:270,y:290},{x:420,y:310}],{radius:112,amount:42,rough:.32});
    demoStroke('plateau',[{x:285,y:275},{x:320,y:270}],{radius:67,amount:38,rough:.26});
    demoRamp([{x:305,y:280},{x:360,y:295},{x:425,y:300}],{radius:27,rough:.14});
    demoRamp([{x:430,y:325},{x:485,y:370},{x:450,y:440},{x:505,y:500},{x:610,y:535}],{radius:38,rough:.18});
    demoStroke('hill',[{x:190,y:590},{x:250,y:560},{x:315,y:595},{x:365,y:655}],{radius:39,amount:35,rough:.35});
    markChanged(); return;
  }
  if (experiment.get('example')==='coasts') {
    // Ordinary banks and a raised plateau cut by the same channel make the
    // elevation-dependent coastal materials visible in one comparison.
    demoStroke('plateau',[{x:690,y:320},{x:830,y:350}],{radius:140,amount:85,rough:.5});
    demoStroke('hill',[{x:230,y:250},{x:310,y:275}],{radius:82,amount:35,rough:.45});
    demoStroke('deep',[{x:0,y:530},{x:320,y:500},{x:700,y:520},{x:1023,y:550}],{radius:165,rough:.45});
    demoStroke('shallow',[{x:465,y:320},{x:485,y:750}],{radius:45,rough:.22,shallowMode:'area'});
    markChanged(); return;
  }
  if (experiment.get('example')==='hills') {
    // Same authored strokes for profile comparisons at native feature scales.
    demoStroke('hill',[{x:210,y:245}],{radius:76,amount:55,rough:.45});
    demoStroke('hill',[{x:610,y:180},{x:720,y:225},{x:800,y:190}],{radius:82,amount:55,rough:.45});
    demoStroke('hill',[{x:165,y:565},{x:240,y:610},{x:310,y:710}],{radius:48,amount:45,rough:.5});
    demoStroke('hill',[{x:650,y:620},{x:730,y:680}],{radius:118,amount:38,rough:.45});
    markChanged(); return;
  }
  demoStroke('deep',[{x:70,y:760},{x:260,y:710},{x:450,y:680},{x:650,y:730},{x:850,y:870},{x:1023,y:880}],{radius:150,rough:.35});
  demoStroke('shallow',[{x:440,y:560},{x:455,y:810}],{radius:49,rough:.18,shallowMode:'area'});
  demoStroke('plateau',[{x:220,y:250},{x:330,y:255},{x:350,y:350},{x:250,y:390}],{radius:98,amount:80,rough:.4});
  demoStroke('hill',[{x:260,y:280},{x:275,y:295}],{radius:65,amount:40,rough:.35});
  demoStroke('hill',[{x:590,y:290},{x:680,y:340},{x:750,y:470}],{radius:115,amount:80,rough:.45});
  demoStroke('mountain',[{x:800,y:160},{x:860,y:250}],{radius:100,amount:150,rough:.5});
  demoRamp([{x:280,y:350},{x:430,y:535}],{radius:65,rough:.22});
  if (experiment.get('scene')==='compact') addNode({kind:'compact',factor:.60});
  markChanged();
}
function encodedHeights(field=heights) {
  const bytes=new Uint8Array(field.length*4),view=new DataView(bytes.buffer);
  for (let i=0;i<field.length;i++) view.setFloat32(i*4,field[i],true);
  let text=''; for (let i=0;i<bytes.length;i+=32768) text+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(text);
}
function sketch() {
  applySeedControl();
  rememberTool();
  return {format:'nanolathe-terrain-sculpt',version:4,nodes:serializeNodes(),biome:config.biomeId||'green',size,grid,baseHeight:config.baseHeight,seaLevel:config.seaLevel,seed,refinementSeed,
    toolSettings,bankWidth:Number($('bank-width').value),softness:Number($('softness').value),relief:Number($('relief').value),
    beachFlatness:Number($('beach-flatness').value),mineralRing:Number($('mineral-ring').value),ringSpread:Number($('ring-spread').value),
    ringVariation:Number($('ring-variation').value),fringeStyle:$('fringe-style').value,materialWeathering:Number($('material-weathering').value),depositSpread:Number($('deposit-spread').value),transitionDetail:Number($('transition-detail').value),
    tool,diameter:Number($('diameter').value),amount:Number($('amount').value),roughness:Number($('roughness').value),shelves:Number($('shelves').value),shallowMode:$('shallow-mode').value,fractures:Number($('fractures').value),scree:Number($('scree').value),weather:$('weather').checked,clay:$('clay').checked,light:$('light').value,encoding:'float32-le/base64',heights:encodedHeights(),protection:encodedHeights(protection),routes:encodedHeights(routes)};
}
function persistLater() {
  if (experiment.has('scratch')) { $('save-state').textContent='Comparison sketch · use Save sketch to keep it.'; return; }
  clearTimeout(autosaveTimer); autosaveTimer=setTimeout(() => {
    if (stroke || loading) { persistLater(); return; }
    try { localStorage.setItem(LOCAL_KEY,JSON.stringify(sketch())); $('save-state').textContent='Terrain recipe autosaved locally.'; }
    catch (_) { $('save-state').textContent='Local autosave unavailable. Use Save sketch to keep this heightfield.'; }
  },450);
}
function loadSketch(s) {
  if (!s || s.format!=='nanolathe-terrain-sculpt' || ![3,4].includes(s.version) || s.size!==size || s.grid!==grid || s.encoding!=='float32-le/base64' || typeof s.heights!=='string' || s.heights.length>heights.length*6) throw new Error('Load a v3 sculpt sketch with the same canvas and grid size. Painter sketches use a different format.');
  const binary=atob(s.heights); if (binary.length!==heights.length*4) throw new Error('The saved heightfield has the wrong length.');
  const bytes=Uint8Array.from(binary,c => c.charCodeAt(0)),view=new DataView(bytes.buffer),next=new Float32Array(heights.length);
  for (let i=0;i<next.length;i++) { const v=view.getFloat32(i*4,true); if (!Number.isFinite(v) || v<MIN_HEIGHT || v>MAX_HEIGHT) throw new Error('The sketch contains an invalid terrain height.'); next[i]=v; }
  const nextProtect=new Float32Array(next.length);
  if (s.protection) {
    const raw=atob(s.protection); if (raw.length!==next.length*4) throw new Error('Invalid protected-surface mask.');
    const buffer=Uint8Array.from(raw,c=>c.charCodeAt(0)),values=new DataView(buffer.buffer);
    for (let i=0;i<next.length;i++) { const v=values.getFloat32(i*4,true); if (!Number.isFinite(v)||v<0||v>1) throw new Error('Invalid protected-surface value.'); nextProtect[i]=v; }
  }
  const nextRoutes=new Float32Array(next.length);
  if (s.routes) {
    const raw=atob(s.routes); if (raw.length!==next.length*4) throw new Error('Invalid ramp surface mask.');
    const values=new DataView(Uint8Array.from(raw,c=>c.charCodeAt(0)).buffer);
    for (let i=0;i<next.length;i++) { const v=values.getFloat32(i*4,true); if (!Number.isFinite(v)||v<0||v>1) throw new Error('Invalid ramp surface value.'); nextRoutes[i]=v; }
  }
  lastWaterStroke=null; cancelWeather(); refined=refinedBase=null; renderer?.setWeather();
  heights.set(next); protection.set(nextProtect); routes.set(nextRoutes); seed=Number.isInteger(s.seed)?clamp(s.seed,0,4294967295):2701; $('seed').value=seed; noise=makeNoise(seed);
  refinementSeed=Number.isInteger(s.refinementSeed)?clamp(s.refinementSeed,0,4294967295):seed;
  if (Object.hasOwn(HELP,s.tool)) tool=s.tool;
  for (const kind of Object.keys(HELP)) {
    const restored={...toolDefaults(kind)},saved=s.toolSettings?.[kind];
    if (saved && typeof saved==='object') {
      for (const [key,[,lo,hi]] of Object.entries(TOOL_FIELDS)) if (Number.isFinite(saved[key])) restored[key]=clamp(saved[key],lo,hi);
      restored.preset=Object.hasOwn(TOOL_PRESETS,saved.preset)?saved.preset:'custom';
      restored.shallowMode=saved.shallowMode==='area'?'area':'passage';
    }
    toolSettings[kind]=restored;
  }
  showTool(toolSettings[tool]);
  if (Number.isFinite(s.diameter)) $('diameter').value=clamp(s.diameter,40,400);
  if (Number.isFinite(s.amount)) $('amount').value=clamp(s.amount,...amountRange(tool));
  if (Number.isFinite(s.roughness)) $('roughness').value=clamp(s.roughness,0,100);
  if (Number.isFinite(s.shelves)) $('shelves').value=clamp(s.shelves,0,100);
  $('shallow-mode').value=s.shallowMode==='passage'?'passage':'area';
  $('fractures').value=Number.isFinite(s.fractures)?clamp(s.fractures,0,100):0;
  $('scree').value=Number.isFinite(s.scree)?clamp(s.scree,0,100):0;
  $('bank-width').value=Number.isFinite(s.bankWidth)?clamp(s.bankWidth,0,100):50;
  $('beach-flatness').value=Number.isFinite(s.beachFlatness)?clamp(s.beachFlatness,0,100):50;
  $('softness').value=Number.isFinite(s.softness)?clamp(s.softness,0,100):50;
  $('relief').value=Number.isFinite(s.relief)?clamp(s.relief,0,160):Math.round((config.material?.surfaceRelief??1)*100);
  $('mineral-ring').value=Number.isFinite(s.mineralRing)?clamp(s.mineralRing,0,100):Math.round((config.material?.ringAmount??0)*100);
  $('ring-spread').value=Number.isFinite(s.ringSpread)?clamp(s.ringSpread,0,100):Math.round((config.material?.ringSpread??.65)*100);
  $('material-weathering').value=Number.isFinite(s.materialWeathering)?clamp(s.materialWeathering,0,100):Math.round((config.material?.materialWeathering??0)*100);
  $('deposit-spread').value=Number.isFinite(s.depositSpread)?clamp(s.depositSpread,0,100):Math.round((config.material?.depositSpread??.65)*100);
  $('transition-detail').value=Number.isFinite(s.transitionDetail)?clamp(s.transitionDetail,0,100):Math.round((config.material?.transitionDetail??.65)*100);
  $('ring-variation').value=Number.isFinite(s.ringVariation)?clamp(s.ringVariation,0,100):Math.round((config.material?.ringVariation??.7)*100);
  $('fringe-style').value=config.textures.mineralRings&&(s.fringeStyle==='rings'||!config.textures.mineralRing)?'rings':'veins';
  rememberTool(!s.toolSettings);
  if (typeof s.weather==='boolean') $('weather').checked=s.weather;
  if (typeof s.clay==='boolean') $('clay').checked=s.clay;
  if (['original','alternate'].includes(s.light)) $('light').value=s.light;
  // A v4 recipe rebuilds from its nodes; a v3 sketch becomes one raster node.
  nodes=s.version===4 && Array.isArray(s.nodes)?deserializeNodes(s.nodes):[{kind:'raster',heights:heights.slice(),protection:protection.slice(),routes:routes.slice()}];
  prefix=[]; selected=-1; evaluate(0); renderLayers();
  markChanged(); updateControls();
}
function addGroundNode() {
  const amplitude=experiment.has('undulation')?Number(experiment.get('undulation')):10;
  if (amplitude>0) addNode({kind:'ground',amplitude,wavelength:experiment.has('undulationScale')?Number(experiment.get('undulationScale')):200,coverage:experiment.has('undulationCover')?Number(experiment.get('undulationCover')):.45,seed:seed^0x9e37});
}
function serializeNodes() {
  return nodes.map(n => n.kind==='raster'?{kind:'raster',hidden:n.hidden,heights:encodedHeights(n.heights),protection:encodedHeights(n.protection),routes:encodedHeights(n.routes)}:{...n,points:n.points?.map(p => ({x:p.x,y:p.y}))});
}
function deserializeNodes(list) {
  const decode=text => { const raw=atob(text),view=new DataView(Uint8Array.from(raw,c => c.charCodeAt(0)).buffer),out=new Float32Array(raw.length/4); for (let i=0;i<out.length;i++) out[i]=view.getFloat32(i*4,true); return out; };
  return list.filter(n => n && (NODE_NAMES[n.kind])).map(n => n.kind==='raster'?{kind:'raster',hidden:Boolean(n.hidden),heights:decode(n.heights),protection:decode(n.protection),routes:decode(n.routes)}:{kind:n.kind,hidden:Boolean(n.hidden),factor:n.factor,amplitude:n.amplitude,wavelength:n.wavelength,coverage:n.coverage,seed:n.seed,params:n.params,points:n.points,frame:Array.isArray(n.frame) && n.frame.length===6 && n.frame.every(Number.isFinite)?n.frame:undefined});
}
function download(blob,name) { const url=URL.createObjectURL(blob),a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); }
for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click',() => { if (stroke) return; rememberTool(); tool=b.dataset.tool; if (tool!=='move' && selected>=0) { selected=-1; renderLayers(); } showTool(toolSettings[tool]); updateControls(); schedule(); persistLater(); });
for (const id of ['diameter','amount','roughness','shelves','bank-width','beach-flatness','softness','cracks']) $(id).addEventListener('input',() => { rememberTool(true); updateControls(); schedule(); persistLater(); if (selected>=0) editSelectedFromControls(); });
for (const id of ['diameter','amount','roughness','shelves','bank-width','beach-flatness','softness','cracks']) $(id).addEventListener('change',() => { if (selected>=0) { checkpoint(); queueWeather(); } });
for (const [id,kind] of [['node-seed','seed'],['node-delete','delete'],['node-up','up'],['node-down','down'],['node-hide','hide']]) $(id).addEventListener('click',() => nodeAction(kind));
$('tool-style').addEventListener('change',() => { const preset=$('tool-style').value; if (!Object.hasOwn(TOOL_PRESETS,preset)) return; toolSettings[tool]=toolDefaults(tool,preset); showTool(toolSettings[tool]); updateControls(); schedule(); persistLater(); });
for (const id of ['relief','transition-detail']) $(id).addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); persistLater(); });
for (const id of ['mineral-ring','ring-spread','ring-variation']) $(id).addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); persistLater(); });
for(const id of ['material-weathering','deposit-spread']) $(id).addEventListener('input',()=>{markViewChanged();updateControls();schedule();queueWeather();persistLater();});
$('fringe-style').addEventListener('change',() => { markViewChanged(); schedule(); persistLater(); });
$('fractures').addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); persistLater(); });
$('shallow-mode').addEventListener('change',() => { rememberTool(true); updateControls(); persistLater(); if (selected>=0) { editSelectedFromControls(); checkpoint(); queueWeather(); } });
$('scree').addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); queueWeather(); persistLater(); });
$('water-reapply').addEventListener('click',reapplyWater);
function applySeedControl() {
  const next=clamp(Math.trunc(Number($('seed').value) || 0),0,4294967295);
  if (next!==seed) { seed=next; if (config) noise=makeNoise(seed); }
  $('seed').value=seed;
}
$('seed').addEventListener('change',() => { applySeedControl(); schedule(); persistLater(); });
for (const id of ['clay','light']) $(id).addEventListener('change',() => { markViewChanged(); schedule(); persistLater(); });
$('weather').addEventListener('change',() => {
  cancelWeather(); markViewChanged();
  if (!$('weather').checked) renderer.setWeather();
  heightDirty=true; schedule(); queueWeather(); persistLater();
});
$('fit').addEventListener('click',() => { fitView=true; resize(); }); $('one').addEventListener('click',() => { fitView=false; resize(); });
$('undo').addEventListener('click',() => moveHistory(-1)); $('redo').addEventListener('click',() => moveHistory(1));
$('demo').addEventListener('click',() => {
  if (stroke) return;
  experiment.set('example',$('example').value); mixedScene(); checkpoint();
  status('Example loaded · sculpt across the joins.'); schedule(); queueWeather();
});
$('blank').addEventListener('click',() => { if (stroke) return; applySeedControl(); refinementSeed=seed; lastWaterStroke=null; cancelWeather(); refined=refinedBase=null; renderer.setWeather(); heights.fill(config.baseHeight); protection.fill(0); routes.fill(0); nodes=[]; prefix=[]; selected=-1; addGroundNode(); markChanged(); checkpoint(); status('Blank dry ground.'); schedule(); queueWeather(); });
$('save').addEventListener('click',() => { if (!stroke) download(new Blob([JSON.stringify(sketch())],{type:'application/json'}),'terrain-sculpt-v3.json'); });
$('load').addEventListener('click',() => { if (!stroke) $('file').click(); });
$('file').addEventListener('change',async () => {
  const file=$('file').files[0]; $('file').value=''; if (!file || stroke) return;
  loading=true; $('editor').disabled=true;
  try { if (file.size>10000000) throw new Error('This sculpt sketch is too large to load.'); loadSketch(JSON.parse(await file.text())); checkpoint(); status('Loaded the saved terrain.'); schedule(); queueWeather(); } catch (err) { error(err.message); }
  finally { loading=false; $('editor').disabled=false; updateControls(); }
});
$('export').addEventListener('click',() => {
  if (!canExport()) return;
  try {
    if (heightDirty) { renderer.setHeight(previewHeight(),grid); renderer.setRoutes(routes,cracks); heightDirty=false; }
    const start=performance.now(),stats=renderer.draw({quality:'full',clay:$('clay').checked,light:$('light').value,fractures:Number($('fractures').value)/100,scree:Number($('scree').value)/100,detail:Number($('relief').value)/100,ring:Number($('mineral-ring').value)/100,ringSpread:Number($('ring-spread').value)/100,ringVariation:Number($('ring-variation').value)/100,fringeStyle:$('fringe-style').value,materialWeathering:Number($('material-weathering').value)/100,transitionDetail:Number($('transition-detail').value)/100}),rev=revision,job=weatherJob;
    drawTiming(stats,performance.now()-start,'full');
    canvas.toBlob(blob => { if (!blob) error('PNG export is unavailable for this renderer.'); else if (revision!==rev || weatherJob!==job || !canExport()) error('The terrain changed during export. Export the finished view again.'); else download(blob,'terrain-sculpt.png'); },'image/png');
  } catch (err) { error(err.message); }
});
const typing=target => target instanceof HTMLElement && (['INPUT','SELECT','TEXTAREA'].includes(target.tagName) || target.isContentEditable);
window.addEventListener('keydown',event => {
  if (typing(event.target)) return;
  if (event.code==='Space' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); space=true; schedule(false); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='z') { event.preventDefault(); moveHistory(event.shiftKey?1:-1); }
  if ((event.key==='Delete' || event.key==='Backspace') && selected>=0 && !stroke && !moving) { event.preventDefault(); nodeAction('delete'); status('Deleted the selected shape.'); }
  // Rotate , . (15°), scale [ ] (10%), height PageUp / PageDown (5).
  const turn={',':-Math.PI/12,'.':Math.PI/12}[event.key],grow={'[':1/1.1,']':1.1}[event.key],lift={PageUp:5,PageDown:-5}[event.key];
  if (selected>=0 && nodes[selected]?.points && (turn || grow || lift) && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    changeSelected(n => {
      if (lift) { if (n.params && !['deep','shallow','ramp'].includes(n.kind)) n.params={...n.params,amount:clamp(n.params.amount+lift,...amountRange(n.kind))}; return; }
      transformNode(n,nodeState(n),about(nodePivot(n),turn?rotation(turn):scaling(grow)));
    });
  }
});
window.addEventListener('keyup',event => { if (event.code==='Space') { space=false; schedule(false); } });
window.addEventListener('blur',() => { space=false; cursor=null; schedule(false); }); new ResizeObserver(resize).observe($('viewport'));


// Surface knobs: each writes the page address and the renderer's variant,
// then the renderer re-reads its uniforms and re-bakes its fields.
const KNOBS = [
  ['Ground', [['groundTiles','Unique ground tiles',1,16,1,16],['undulation','Undulation height',0,16,.5,10],['undulationScale','Undulation size (px)',48,400,8,200],['undulationCover','Undulating share of land',0,1,.05,.45]]],
  ['Relief', [['reliefScale','Scale (px)',8,64,1,28],['reliefAmount','Strength',0,1.2,.05,.5],['reliefLumps','Lumps',0,1,.05,.7],
    ['reliefBranch','Branching',0,4,.1,2],['reliefWarp','Warp (px)',0,24,1,10],['reliefPatchy','Patchiness',0,1,.05,1],['reliefJitter','Rib irregularity',0,1,.05,.8],['gentleRelief','Gentle-slope relief',0,1,.05,.6],['plainRelief','Level-ground lumps',0,3,.05,1.2],['reliefOctaves','Octaves',1,6,1,5]]],
  ['Light', [['flatShadow','Cast shadow on level ground',0,1,.05,0],['flatOcclusion','Occlusion on level ground',0,1,.05,.4],['lightCap','Highlight cap',1,1.6,.01,1.13]]],
  ['Faces', [['faceVariation','Face width variation (new plateaus)',0,1.5,.05,.8],['rockCrown','Bare rock to the crown',0,1,.05,0],['slopeTexture','Sampled slope texture',0,1,.05,.3],['faceEdge','Edge breakup',0,2,.05,.8],['gullyRock','Rock in gullies',0,2,.05,.5],['moss','Moss from ground',0,1,.05,0],['crevice','Crevices',0,1,.05,0]]],
  ['Boulders', [['boulders','Density',0,1,.05,0],['boulderSize','Size (px)',4,24,1,9],['boulderFoot','From cliff feet',0,1,.05,.5],
    ['boulderCluster','Clustering',0,1,.05,.6],['boulderMoss','Mossy tops',0,1,.05,.35],['boulderRound','Roundness',0,1,.05,0]]],
  ['Debris', [['debris','Amount',0,1,.05,0],['debrisReach','Reach (px)',16,128,4,48],['debrisSize','Size (px)',3,12,1,6],['debrisSort','Sorting',0,1,.05,.8],['repose','Rest slope',.3,1,.05,.6]]],
  ['Sand', [['sand','Weathering supply',0,2,.05,0],['sandReach','Water transport',0,1,.05,.6],['windStrength','Wind strength',0,1,.05,.5],
    ['wind','Wind toward (deg)',0,360,5,20],['sandPatchy','Patchiness (flows and piles)',0,1,.05,.7],['sandTail','Fines carried beyond',0,1,.05,.6],['sandDust','Dusting tint',0,1,.05,.5],['sandGrass','Grass regrowing over sand',0,1,.05,.6],['sandLight','Weathered lightness',0,1,.05,.25],['sandGrain','Rock grain in sand',0,1,.05,.8],
    ['ripple','Ripple length (px)',0,16,1,7],['rippleHeight','Ripple height',0,3,.1,1.4]]],
  ['Cracks', [['crackSeverity','Depth',0,1,.05,.6],['crackSpacing','Block size (px)',16,96,2,40],['crackLength','Length down the slope',1,4,.25,2],
    ['crackMajor','Major cracks',0,1,.05,.8],['crackMinor','Minor cracks',0,1,.05,.75],['crackHairline','Hairline crazing',0,1,.05,.6],['crackBlocks','Facets (block relief)',0,1.5,.05,.6],
    ['crackWidth','Width (px)',.5,2.5,.1,1],['crackJagged','Jaggedness',0,1,.05,.6],['crackNetwork','Majors: rills to plates',0,1,.05,.35],['crackReach','Reach onto gentle slopes',0,1,.05,.6],
    ['crackDark','Floor darkness',0,1,.05,.75],['crackLit','Lit wall',0,1,.05,.35]]],
  ['Contour bands', [['banding','Strength',0,1,.05,0],['bandSpacing','Height per band',1,12,.25,3.7],['bandSoftness','Riser share',.05,1,.05,.35],['bandLine','Line darkness',0,1,.05,.5],['bandWater','Rings in water colour',0,1,.05,0]]],
  ['Craters', [['craterlets','Craterlets per crater (new craters)',0,12,1,3],['craterEjecta','Ejecta (new craters)',0,1,.05,0],['worms','Wormy relief on slopes',0,1,.05,0]]],
  ['Water', [['beachWidth','Beach width (worlds with beaches)',0,2,.05,.6],['apron','Sand apron round raised rock (px)',0,120,2,0],['shallowDepth','Shallow until depth',0,60,1,24],['deepDepth','Deep from depth',10,100,1,60],['waterSoft','Colour depth averaging (px)',0,64,2,32],['crispShore','Crisp waterline',0,1,.05,1],['bankRock','Rock on low banks',0,1,.05,.25]]],
  ['Palette', [['dither','Dither (water)',0,4,.1,2],['landDither','Land dither share',0,1,.05,.25]]],
];
// Worlds. A world is a biome's materials (prepared per biome by the server)
// plus the map-wide settings and base colours chosen for it. Built-in worlds
// can be adjusted; New world copies the current one under a new name. Kept in
// this browser (localStorage) and exportable as JSON.
const WORLD_STORE='nanolathe-map-editor-worlds';
const COLOR_KEYS=[['ground','Ground'],['slope','Slope cover'],['rock','Rock'],['sand','Sand'],['beach','Beach'],['shallow','Shallow water'],['deep','Deep water']];
let worlds={},worldId=null;
function loadWorlds() { try { worlds=JSON.parse(localStorage.getItem(WORLD_STORE)||'{}')||{}; } catch (_) { worlds={}; } }
function saveWorlds() { try { localStorage.setItem(WORLD_STORE,JSON.stringify(worlds)); } catch (_) {} }
function activeWorld() { return worlds[worldId] ??= {name:config.biome,base:config.biomeId,colors:{},knobs:{}}; }
const hexColor=c => '#'+c.map(v => Math.round(clamp(v,0,1)*255).toString(16).padStart(2,'0')).join('');
const rgbColor=h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16)/255);
function worldColors() { const out={}; for (const [k,v] of Object.entries(activeWorld().colors||{})) if (/^#[0-9a-f]{6}$/i.test(v)) out[k]=rgbColor(v); return out; }
function defaultColor(key) {
  const m=renderer.means,w=config.water||{},mat=config.material||{};
  const rgb=v => v&&v.map(x => x/255);
  return {ground:m.ground,slope:m.slope,rock:m.rock,sand:m.rock&&m.rock.map(v => v+(1-v)*.3),beach:rgb(mat.beachRGB),shallow:rgb(w.shallowRGB),deep:rgb(w.deepRGB)}[key]||[.5,.5,.5];
}
function goToWorld(base,id) {
  const url=new URL(location.origin+location.pathname); url.searchParams.set('biome',base); if (id && id!==base) url.searchParams.set('world',id); location.href=url.toString();
}
function buildWorldPanel() {
  const world=activeWorld();
  $('world-name').textContent=world.name;
  const select=$('biome-select');
  const builtIn=Object.entries(config.biomes||{}).map(([id,name]) => new Option(name,'biome:'+id,false,worldId===id));
  const custom=Object.entries(worlds).filter(([id,w]) => !(id in (config.biomes||{})) && w.base in (config.biomes||{})).map(([id,w]) => new Option(w.name+' (custom)','world:'+id,false,worldId===id));
  select.replaceChildren(...builtIn,...custom);
  select.onchange=() => { const [kind,id]=select.value.split(':'); if (kind==='biome') goToWorld(id); else goToWorld(worlds[id].base,id); };
  const rows=$('world-colors'); rows.replaceChildren();
  for (const [key,label] of COLOR_KEYS) {
    if (key==='beach' && !config.textures.beach) continue;
    const row=document.createElement('div'); row.className='color-row';
    const set=world.colors?.[key];
    row.innerHTML=`<span>${label}</span><input type="checkbox" aria-label="Use a base colour for ${label}"${set?' checked':''}><input type="color" aria-label="${label} base colour" value="${set||hexColor(defaultColor(key))}">`;
    const [box,pick]=row.querySelectorAll('input');
    const apply=() => { if (box.checked) world.colors[key]=pick.value; else delete world.colors[key]; saveWorlds(); renderer.setColors(worldColors()); markViewChanged(); schedule(); };
    box.addEventListener('change',apply); pick.addEventListener('input',() => { box.checked=true; apply(); });
    rows.append(row);
  }
  $('world-reset').onclick=() => { world.colors={}; saveWorlds(); buildWorldPanel(); renderer.setColors({}); markViewChanged(); schedule(); };
  $('world-new').onclick=() => {
    const name=$('world-new-name').value.trim(); if (!name) { $('world-new-name').focus(); status('Name the new world first.'); return; }
    const id=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24)+'-'+Math.random().toString(36).slice(2,6);
    const knobs={...world.knobs}; for (const [,list] of KNOBS) for (const [key] of list) if (experiment.has(key)) knobs[key]=experiment.get(key);
    worlds[id]={name,base:config.biomeId,colors:{...world.colors},knobs}; saveWorlds(); goToWorld(config.biomeId,id);
  };
  $('world-export').onclick=() => download(new Blob([JSON.stringify({format:'nanolathe-map-world',version:1,world:{...world,knobs:{...world.knobs}}},null,1)],{type:'application/json'}),(world.name||'world').replace(/[^\w-]+/g,'_')+'.world.json');
  $('world-import').onclick=() => $('world-file').click();
  $('world-file').onchange=async () => {
    try {
      const data=JSON.parse(await $('world-file').files[0].text()),w=data?.world;
      if (data?.format!=='nanolathe-map-world' || !w || typeof w.name!=='string' || !(w.base in (config.biomes||{}))) throw new Error('Not a world file for a world this server has.');
      const id=w.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,24)+'-'+Math.random().toString(36).slice(2,6);
      worlds[id]={name:w.name,base:w.base,colors:Object.fromEntries(Object.entries(w.colors||{}).filter(([,v]) => /^#[0-9a-f]{6}$/i.test(v))),knobs:Object.fromEntries(Object.entries(w.knobs||{}).map(([k,v]) => [k,String(v)]))};
      saveWorlds(); goToWorld(w.base,id);
    } catch (err) { error(err.message); }
  };
  const isCustom=!(worldId in (config.biomes||{}));
  $('world-delete').textContent=isCustom?'Delete this world':'Restore built-in settings';
  $('world-delete').onclick=() => { delete worlds[worldId]; saveWorlds(); goToWorld(config.biomeId); };
}

// Crack styles set several crack knobs at once; each stays editable.
const CRACK_STYLES={
  'Retail Green':{crackSeverity:.6,crackSpacing:40,crackLength:2,crackMajor:.8,crackMinor:.75,crackHairline:.6,crackBlocks:.6,crackWidth:1,crackJagged:.6,crackNetwork:.35,crackReach:.6,crackDark:.75,crackLit:.35},
  'Hairline':{crackSeverity:.35,crackSpacing:30,crackLength:2,crackMajor:.5,crackMinor:.5,crackHairline:1,crackBlocks:.2,crackWidth:.7,crackJagged:.6,crackNetwork:.2,crackReach:.6,crackDark:.7,crackLit:.25},
  'Plates (Gaea rock)':{crackSeverity:.7,crackSpacing:48,crackLength:1.25,crackMajor:.9,crackMinor:.9,crackHairline:.7,crackBlocks:1,crackWidth:1,crackJagged:.7,crackNetwork:1,crackReach:.9,crackDark:.8,crackLit:.45},
  'Deep fissures':{crackSeverity:.9,crackSpacing:56,crackLength:3,crackMajor:1,crackMinor:.4,crackHairline:.3,crackBlocks:.5,crackWidth:1.5,crackJagged:.6,crackNetwork:0,crackReach:.8,crackDark:.85,crackLit:.4},
};
function buildKnobs() {
  const root = $('knobs'), params = experiment;
  const group = (title, open = false) => { const d = document.createElement('details'); d.className = 'knobs-group'; d.open = open; const t = document.createElement('summary'); t.textContent = title; d.append(t); root.append(d); return d; };
  const render = group('Rendering');
  const toggle = (key, label, on, off, isOn) => {
    const row = document.createElement('label'); row.className = 'small'; row.style.display = 'flex'; row.style.gap = '6px';
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = isOn;
    box.addEventListener('change', () => setKnob(key, box.checked ? on : off));
    row.append(box, label); render.append(row);
  };
  toggle('detail', 'Fall-line surface (off: lab look)', 'fall', 'lab', params.get('detail') !== 'lab');
  toggle('palette', 'TA palette', 'nearest', 'off', params.get('palette') !== 'off');
  toggle('ground', 'Procedural ground tiles (off: lab texture)', 'tiles', 'texture', params.get('ground') !== 'texture');
  // Every knob needs a world default (sculpt.py KNOB_DEFAULTS).
  const missing = KNOBS.flatMap(([, list]) => list.map(k => k[0])).filter(k => !(k in (config.defaults || {})));
  if (missing.length) console.warn('Knobs without a world default:', missing.join(', '));
  for (const [title, knobs] of KNOBS) {
    const box = group(title, title === 'Cracks');
    if (title === 'Cracks') {
      const wrap = document.createElement('div'); wrap.className = 'control';
      wrap.innerHTML = `<label for="crack-style">Style</label><select id="crack-style" style="width:100%"><option value="">Choose a style…</option>${Object.keys(CRACK_STYLES).map(k => `<option>${k}</option>`).join('')}</select><p class="small">How much each shape cracks is its own Cracks slider (Shape panel).</p>`;
      wrap.querySelector('select').addEventListener('change', event => {
        const style = CRACK_STYLES[event.target.value]; if (!style) return;
        for (const [key, value] of Object.entries(style)) {
          const input = $('knob-' + key); if (input) { input.value = value; input.previousElementSibling.querySelector('output').textContent = value; }
          setKnob(key, value);
        }
      });
      box.append(wrap);
    }
    for (const [key, label, min, max, step, value] of knobs) {
      const wrap = document.createElement('div'); wrap.className = 'control';
      const id = 'knob-' + key, current = params.has(key) ? Number(params.get(key)) : value;
      wrap.innerHTML = `<label for="${id}">${label} <output>${current}</output></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${current}">`;
      const input = wrap.querySelector('input'), out = wrap.querySelector('output');
      input.addEventListener('input', () => { out.textContent = input.value; setKnob(key, input.value); });
      box.append(wrap);
    }
  }
}
function setKnob(key, value) {
  const url = new URL(location.href); url.searchParams.set(key, value); window.history.replaceState(null, '', url);
  experiment.set(key, value);
  if (config) { activeWorld().knobs[key] = String(value); saveWorlds(); }
  // Textures are chosen when the renderer starts, so this switch reloads.
  if (key === 'ground') { location.reload(); return; }
  renderer.variant.set(key, value); renderer.applyKnobs(); markViewChanged(); schedule();
  if (key==='detail') $('fracture-control').hidden=!config.textures.fractures || value!=='lab';
  if (key==='undulation' || key==='undulationScale' || key==='undulationCover') {
    const i=nodes.findIndex(n => n.kind==='ground');
    if (i>=0) { nodes[i][{undulation:'amplitude',undulationScale:'wavelength',undulationCover:'coverage'}[key]]=Number(value); cancelWeather(); evaluate(i); checkpoint(); queueWeather(); }
    else if (key==='undulation' && Number(value)>0) { nodes.unshift({kind:'ground',amplitude:Number(value),wavelength:160,seed:seed^0x9e37}); prefix=[]; cancelWeather(); evaluate(0); checkpoint(); queueWeather(); }
    return;
  }
  // Transport knobs change where sand is carried, so the worker re-runs.
  if (['sand','sandReach','windStrength','wind','sandPatchy','sandTail'].includes(key)) { cancelWeather(); queueWeather(); }
}
async function boot() {
  try {
    const response=await fetch('/sculpt-config.json'+(experiment.has('biome')?'?biome='+encodeURIComponent(experiment.get('biome')):'')); if (!response.ok) throw new Error('Could not load the sculpt configuration.'); config=await response.json();
    if (config.size!==1024 || !Number.isInteger(config.grid) || config.grid<2 || config.grid>1024 || !Number.isFinite(config.baseHeight) || !Number.isFinite(config.seaLevel)) throw new Error('Unsupported sculpt configuration.');
    if (config.biomeId && config.biomeId!=='green') LOCAL_KEY+='-'+config.biomeId;
    document.querySelector('.topbar h2').textContent=(config.biome||'Green Planet')+' terrain';
    // The world: built-in (the biome itself) or a custom one based on it.
    // Its remembered settings come before the biome's own defaults.
    loadWorlds();
    worldId=experiment.has('world') && worlds[experiment.get('world')]?.base===config.biomeId?experiment.get('world'):config.biomeId;
    if (worldId!==config.biomeId) LOCAL_KEY+='-'+worldId;
    config.defaults={...config.defaults,...(worlds[worldId]?.knobs||{})};
    if (worldId!==config.biomeId) document.querySelector('.topbar h2').textContent=worlds[worldId].name+' terrain';
    for (const [key,value] of Object.entries(config.defaults || {})) if (!experiment.has(key)) experiment.set(key,value);
    $('example').value=['joins','coasts','hills','intersections','islands'].includes(experiment.get('example'))?experiment.get('example'):'mixed';
    for (const kind of Object.keys(HELP)) toolSettings[kind]=toolDefaults(kind);
    showTool(toolSettings[tool]);
    $('relief').value=Math.round((config.material?.surfaceRelief??1)*100);
    $('material-weathering').value=Math.round((config.material?.materialWeathering??0)*100);
    $('deposit-spread').value=Math.round((config.material?.depositSpread??.65)*100);
    $('transition-detail').value=Math.round((config.material?.transitionDetail??.65)*100);
    $('transition-detail-control').hidden=!config.textures.transitionBody;
    $('ring-controls').hidden=!config.textures.mineralRing && !config.textures.mineralRings;
    $('fringe-style').querySelector('[value="veins"]').disabled=!config.textures.mineralRing;
    $('fringe-style').querySelector('[value="rings"]').disabled=!config.textures.mineralRings;
    $('fringe-style').value=!config.textures.mineralRing&&config.textures.mineralRings?'rings':'veins';
    $('mineral-ring').value=Math.round((config.material?.ringAmount??0)*100);
    $('ring-spread').value=Math.round((config.material?.ringSpread??.65)*100);
    $('ring-variation').value=Math.round((config.material?.ringVariation??.7)*100);
    size=config.size; grid=config.grid; spacing=(size-1)/(grid-1); heights=new Float32Array(grid*grid); protection=new Float32Array(grid*grid); routes=new Float32Array(grid*grid); cracks=new Float32Array(grid*grid); heights.fill(config.baseHeight);
    canvas.width=canvas.height=overlay.width=overlay.height=size; seed=Number($('seed').value); refinementSeed=seed; noise=makeNoise(seed);
    renderer=await TerrainRenderer.create(canvas,config);
    renderer.setColors(worldColors());
    buildKnobs(); buildWorldPanel();
    // The fracture texture only applies to the lab surface; the fall-line
    // surface draws its cracks in the bake (Cracks knobs).
    $('fracture-control').hidden=!config.textures.fractures || experiment.get('detail')!=='lab';
    $('fractures').value=clamp(Number(experiment.get('fractures'))||0,0,100);
    $('scree').value=clamp(Number(experiment.get('scree'))||0,0,100);
    let saved=null; try { if (!experiment.has('scratch')) saved=localStorage.getItem(LOCAL_KEY); } catch (_) {}
    if (saved) { try { loadSketch(JSON.parse(saved)); status('Restored your saved terrain.'); } catch (err) { mixedScene(); error('Saved sculpt sketch could not be loaded: '+err.message+' The saved copy is retained until you edit.'); status('Mixed example shown.'); } }
    else { mixedScene(); status('Mixed scene ready · paint any continuous shape.'); }
    ready=true; $('editor').disabled=false; $('world-editor').disabled=false; history=[{nodes:cloneNodes(),refinementSeed}]; historyIndex=0; renderLayers();
    $('levels').textContent=`Dry base ${config.baseHeight} · sea ${config.seaLevel} · heights ${MIN_HEIGHT}…${MAX_HEIGHT}`;
    updateControls(); resize(); schedule(); queueWeather();
  } catch (err) { error(err.message); status('The experimental renderer could not start.'); }
}
// Read-only hook for capture tools: the displayed (refined) heights.
window.sculptDebug = {bakeMs: (quality='full') => { const gl=renderer.gl,px=new Float32Array(4),sync=() => { gl.bindFramebuffer(gl.FRAMEBUFFER,renderer.fieldsFramebuffer); gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,px); gl.bindFramebuffer(gl.FRAMEBUFFER,null); }; sync(); const t=performance.now(); renderer.bakeFields(quality); sync(); return performance.now()-t; }, heights: () => Array.from(previewHeight()), authored: () => Array.from(heights), replayAll: () => { flushEval(); const before=heights.slice(); prefix=[]; evaluate(0); let worst=0; for (let i=0;i<before.length;i++) worst=Math.max(worst,Math.abs(before[i]-heights[i])); return worst; }, nodes: () => JSON.parse(JSON.stringify(serializeNodes())), get grid() { return grid; }, get size() { return size; }, get base() { return config.baseHeight; }, get sea() { return config.seaLevel; }};
boot();
