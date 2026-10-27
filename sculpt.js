import {TerrainRenderer} from './sculpt-renderer.js';

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
  lower:'Lower the starting surface by the chosen amount. New strokes can dig farther.'
};
let config, renderer, heights, protection, routes, grid, size, spacing, noise;
let weatherWorker, weatherJob=0, weatherBase=null, refined=null, refinedBase=null, weatherState='pending';
let tool='plateau', seed=2701, refinementSeed=2701, stroke=null, pan=null, cursor=null, space=false, pointerId=null, loading=false;
let history=[], historyIndex=-1, framePending=false, heightDirty=true, needsDraw=true;
let revision=0, renderedRevision=-1, fitView=true, autosaveTimer, ready=false;
let paintingIntervals=[],lastPaintingRAF=null;
let lastWaterStroke=null;
// Biomes choose starting values for the same brushes. These presets can be
// borrowed independently of the canvas materials and then edited per tool.
const TOOL_PRESETS={
  green:{plateau:{roughness:40},hill:{roughness:35},mountain:{roughness:45},ramp:{roughness:18},deep:{roughness:45},shallow:{roughness:18}},
  red:{plateau:{roughness:50,softness:35},hill:{roughness:50,softness:40},mountain:{roughness:55,softness:30},ramp:{roughness:22},deep:{roughness:55,bankWidth:38,shelves:45},shallow:{roughness:25}},
  archipelago:{plateau:{roughness:45,softness:72},hill:{roughness:35,softness:78},mountain:{roughness:45,softness:65},ramp:{roughness:18},deep:{roughness:60,bankWidth:78,beachFlatness:80,shelves:90},shallow:{roughness:30,bankWidth:75,beachFlatness:80}}
};
const TOOL_FIELDS={diameter:['diameter',40,400],amount:['amount',5,160],roughness:['roughness',0,100],shelves:['shelves',0,100],bankWidth:['bank-width',0,100],beachFlatness:['beach-flatness',0,100],softness:['softness',0,100]};
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
function toolDefaults(kind,preset=config?.biomeId||'green') {
  return {diameter:200,amount:70,roughness:35,shelves:25,bankWidth:50,beachFlatness:50,softness:50,shallowMode:'passage',preset,...TOOL_PRESETS[preset]?.[kind]};
}
function rememberTool(custom=false) {
  const state={...toolSettings[tool],shallowMode:$('shallow-mode').value};
  for (const [key,[id]] of Object.entries(TOOL_FIELDS)) state[key]=Number($(id).value);
  if (custom) state.preset='custom';
  toolSettings[tool]=state;
}
function showTool(state) {
  $('amount').max=tool==='smooth'?'100':'160';
  for (const [key,[id,lo,hi]] of Object.entries(TOOL_FIELDS)) if (Number.isFinite(state[key])) $(id).value=clamp(state[key],lo,hi);
  $('shallow-mode').value=state.shallowMode==='area'?'area':'passage';
  $('tool-style').value=Object.hasOwn(TOOL_PRESETS,state.preset)?state.preset:'custom';
}
function updateControls() {
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed',String(b.dataset.tool===tool));
  const fixed=['deep','shallow','ramp'].includes(tool);
  $('amount-control').hidden=fixed;
  $('amount-label').textContent=tool==='smooth'?'Strength':tool==='lower'?'Lower by':'Rise';
  $('amount').max=tool==='smooth'?'100':'160';
  if (Number($('amount').value)>Number($('amount').max)) $('amount').value=$('amount').max;
  $('amount-value').textContent=tool==='smooth'?$('amount').value+'%':(tool==='lower'?'−':'+')+$('amount').value;
  $('diameter-value').textContent=$('diameter').value+' units';
  $('roughness-value').textContent=$('roughness').value+'%';
  $('roughness-label').textContent=tool==='ramp'?'Shoulder freedom':tool==='deep' && NATURAL_COAST?'Coast freedom':tool==='plateau' && experiment.get('edges')==='natural'?'Edge freedom':'Roughness';
  $('shelves-control').hidden=tool!=='deep' || !NATURAL_COAST;
  $('shallow-mode-control').hidden=tool!=='shallow';
  $('shelves-value').textContent=$('shelves').value+'%';
  $('bank-control').hidden=!['deep','shallow'].includes(tool);
  $('beach-control').hidden=!['deep','shallow'].includes(tool);
  $('softness-control').hidden=!['plateau','hill','mountain'].includes(tool);
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
  $('water-edit').hidden=!['deep','shallow'].includes(tool);
  $('water-reapply').disabled=!lastWaterStroke || Boolean(stroke) || lastWaterStroke.kind!==tool;
  $('tool-help').textContent=tool==='shallow' && $('shallow-mode').value==='passage'
    ?'Raise the underwater bed to −7 for a shallow passage. Existing land and shallower banks keep their shape.'
    :HELP[tool];
  $('undo').disabled=!ready || Boolean(stroke) || historyIndex<=0;
  $('redo').disabled=!ready || Boolean(stroke) || historyIndex>=history.length-1;
  $('export').disabled=!canExport();
  $('fit').setAttribute('aria-pressed',String(fitView)); $('one').setAttribute('aria-pressed',String(!fitView));
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
function makeNoise(s) {
  // Noise is a fixed world-space field, never generated anew per draw or dab.
  const x=new Float32Array(grid*grid),y=new Float32Array(grid*grid),detail=new Float32Array(grid*grid);
  const coastX=new Float32Array(grid*grid),coastY=new Float32Array(grid*grid),coastWidth=new Float32Array(grid*grid),shelf=new Float32Array(grid*grid);
  for (let z=0;z<grid;z++) for (let col=0;col<grid;col++) {
    const i=z*grid+col,wx=col*spacing,wy=z*spacing;
    x[i]=.7*valueNoise(wx/95,wy/95,s^0x1863)+.3*valueNoise(wx/37,wy/37,s^0x32a7);
    y[i]=.7*valueNoise(wx/95,wy/95,s^0x73c1)+.3*valueNoise(wx/37,wy/37,s^0x9e15);
    detail[i]=.65*valueNoise(wx/64,wy/64,s^0x5b39)+.35*valueNoise(wx/23,wy/23,s^0x2ac9);
    coastX[i]=.65*valueNoise(wx/210,wy/210,s^0x5e17)+.35*valueNoise(wx/75,wy/75,s^0x37ab);
    coastY[i]=.65*valueNoise(wx/210,wy/210,s^0x84d1)+.35*valueNoise(wx/75,wy/75,s^0x192f);
    coastWidth[i]=.65*valueNoise(wx/180,wy/180,s^0x73b9)+.35*valueNoise(wx/55,wy/55,s^0x4f25);
    shelf[i]=.75*valueNoise(wx/170,wy/170,s^0x986d)+.25*valueNoise(wx/48,wy/48,s^0x62f3);
  }
  return {x,y,detail,coastX,coastY,coastWidth,shelf};
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
  const faceAngle=Math.PI/2+sample(noise.coastX,p.x,p.y)*1.8;
  return {kind,base,protectBase:protection.slice(),routeBase:routes.slice(),radius,amount:options.amount ?? Number($('amount').value),rough:options.rough ?? Number($('roughness').value)/100,
    bankWidth:options.bankWidth ?? Number($('bank-width').value)/100,softness:options.softness ?? Number($('softness').value)/100,
    beachFlatness:options.beachFlatness ?? Number($('beach-flatness').value)/100,
    shelves:options.shelves ?? (experiment.has('shelves')?Number(experiment.get('shelves')):Number($('shelves').value)/100),shallowMode:options.shallowMode ?? $('shallow-mode').value,path:[p],
    face:[Math.cos(faceAngle),Math.sin(faceAngle)],
    noise,baseline:sample(base,p.x,p.y),weights:new Float32Array(heights.length),
    distances:kind==='hill' && experiment.get('forms')==='shouldered'?new Float32Array(heights.length).fill(Infinity):null,start:p,last:p,end:p,
    smoothTarget:kind==='smooth'?blurred(base,clamp(Math.round(radius/(spacing*7)),1,24)):null};
}
function dab(s,p,spanEnd=null,frameStart=null,frameEnd=null) {
  const naturalWater=s.kind==='deep' && NATURAL_COAST;
  const naturalPlateau=s.kind==='plateau' && experiment.get('edges')==='natural';
  const shoulderedHill=s.kind==='hill' && experiment.get('forms')==='shouldered';
  const waterTool=s.kind==='deep' || s.kind==='shallow';
  const bankScale=waterTool?2**((s.bankWidth-.5)*1.3):1;
  const faceWidth=.66+(s.softness-.5)*.9,backWidth=s.softness===.5?1.34:2-faceWidth;
  const radius=s.radius,amp=s.rough*radius*(naturalWater ? 1.1 : naturalPlateau ? .95 : shoulderedHill ? .85 : .2);
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
  const extent=radius*(naturalWater?Math.min(1.9,1+s.rough*1.6):naturalPlateau?Math.min(1.7,1+s.rough*1.3):shoulderedHill?Math.max(1.4,backWidth):1)*bankScale+2*amp;
  const x0=clamp(Math.floor((Math.min(p.x,spanEnd?.x??p.x)-extent)/spacing),0,grid-1),x1=clamp(Math.ceil((Math.max(p.x,spanEnd?.x??p.x)+extent)/spacing),0,grid-1);
  const y0=clamp(Math.floor((Math.min(p.y,spanEnd?.y??p.y)-extent)/spacing),0,grid-1),y1=clamp(Math.ceil((Math.max(p.y,spanEnd?.y??p.y)+extent)/spacing),0,grid-1);
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) {
    const i=y*grid+x,wx=x*spacing,wy=y*spacing;
    const t=spanLength2?clamp(((wx-p.x)*spanX+(wy-p.y)*spanY)/spanLength2,0,1):0;
    const cx=p.x+spanX*t,cy=p.y+spanY*t;
    if (shoulderedHill) {
      const d2=(wx-cx)**2+(wy-cy)**2;
      if (d2>s.distances[i]) continue;
      s.distances[i]=d2;
    }
    const dx=wx-cx+amp*(noiseX[i]-(spanLength2?sample(noiseX,cx,cy):nx));
    const dy=wy-cy+amp*(noiseY[i]-(spanLength2?sample(noiseY,cx,cy):ny));
    // The line anchors the channel; broad world-space fields move its banks
    // independently and vary its width. Repeated dabs do not add fresh noise.
    const width=naturalWater?clamp(1+s.rough*1.6*s.noise.coastWidth[i],.45,1.9):naturalPlateau?clamp(1+s.rough*1.3*s.noise.coastWidth[i],.55,1.7):1;
    const r=Math.hypot(dx,dy)/(radius*width*bankScale);
    // A continuous deep core follows the unwarped stroke. Automatic shelves
    // cannot close it; an explicit later shallow-water stroke can cross it.
    const core=naturalWater?1-smooth(.20,.38,Math.hypot(x*spacing-p.x,y*spacing-p.y)/radius):0;
    if (r>=1 && !core && !shoulderedHill) continue;
    let w;
    if (s.kind==='plateau') {
      // Independently vary shoulder width around the level core. An irregular
      // outline with an identical cross-section still makes a uniform rim.
      const originalShoulder=naturalPlateau?clamp(.56+s.rough*(s.noise.detail[i]+.30*s.noise.coastWidth[i]),.22,.84):.62;
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
    if (['hill','mountain','lower'].includes(s.kind) && !shoulderedHill) w=clamp(w*(1+s.rough*.09*s.noise.detail[i]),0,1);
    // Most brushes union influences; the swept hill instead uses its nearest
    // curve section. Neither adds height merely because the pointer dwells.
    const influence=Math.max(w,core);
    if (!shoulderedHill && influence<=s.weights[i]) continue;
    s.weights[i]=influence; const base=s.base[i]; let value=base;
    if (s.kind==='plateau') value=base+(s.baseline+s.amount+s.rough*3*s.noise.detail[i]-base)*w;
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
  for (let i=0;i<heights.length;i++) {
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
  const x0=clamp(Math.floor((Math.min(a.x,b.x)-radius-2*amp)/spacing),0,grid-1),x1=clamp(Math.ceil((Math.max(a.x,b.x)+radius+2*amp)/spacing),0,grid-1);
  const y0=clamp(Math.floor((Math.min(a.y,b.y)-radius-2*amp)/spacing),0,grid-1),y1=clamp(Math.ceil((Math.max(a.y,b.y)+radius+2*amp)/spacing),0,grid-1);
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) {
    const i=y*grid+x,wx=x*spacing,wy=y*spacing,t=clamp(((wx-a.x)*dx+(wy-a.y)*dy)/length2,0,1);
    const cx=a.x+dx*t,cy=a.y+dy*t;
    const plainDistance=Math.hypot(wx-cx,wy-cy);
    // The graded centre follows the curve exactly. Only the outer shoulder
    // borrows the brush's outline variation; it cannot buckle the grade.
    const edgeNoise=smooth(.55,1,plainDistance/radius)*amp;
    const distance=Math.hypot(wx-cx+edgeNoise*(s.noise.x[i]-sample(s.noise.x,cx,cy)),wy-cy+edgeNoise*(s.noise.y[i]-sample(s.noise.y,cx,cy)));
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
function checkpoint() {
  const current=history[historyIndex];
  if (!current || refinementSeed!==current.refinementSeed || heights.some((v,i) => v!==current.height[i]) || routes.some((v,i) => v!==current.routes[i])) { history.splice(historyIndex+1); history.push({height:heights.slice(),protect:protection.slice(),routes:routes.slice(),refinementSeed}); if (history.length>24) history.shift(); historyIndex=history.length-1; }
  updateControls(); persistLater();
}
function moveHistory(delta) {
  const next=historyIndex+delta; if (!ready || stroke || next<0 || next>=history.length) return;
  lastWaterStroke=null; cancelWeather(); heights.set(history[next].height); protection.set(history[next].protect); routes.set(history[next].routes); refinementSeed=history[next].refinementSeed; historyIndex=next; markChanged(); updateControls(); persistLater(); status(delta<0?'Undid the last sculpt stroke.':'Restored the sculpt stroke.'); schedule(); queueWeather();
}

function cancelWeather() {
  weatherJob++; weatherBase=null;
  renderer?.setMaterialField();
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
    weatherWorker.postMessage({job,height:weatherBase,protect:protection,grid,size,seed:refinementSeed,strength:0.35,profile,baseHeight:config.baseHeight,talus:Number($('scree').value)/100,seaLevel:config.seaLevel,materialWeathering:experiment.get('deposits')==='off'?0:Number($('material-weathering').value)/100,depositSpread:Number($('deposit-spread').value)/100,materialProfile:{...config.material,mineral:renderer.variant.get('transition')==='mineral'}});
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
    renderer.setHeight(refined,grid); renderer.setRoutes(routes); renderer.setWeather(data.flow,data.deposit,data.talus);
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
  $('timing').textContent=`Draw ${ms.toFixed(1)} ms CPU${gpu}${interval} · ${quality}`;
}
function frame(timestamp) {
  framePending=false; if (!renderer) return;
  if (stroke) { if (lastPaintingRAF!==null) { paintingIntervals.push(timestamp-lastPaintingRAF); if (paintingIntervals.length>10) paintingIntervals.shift(); } lastPaintingRAF=timestamp; }
  else lastPaintingRAF=null;
  try {
    if (heightDirty) { renderer.setHeight(previewHeight(),grid); renderer.setRoutes(routes); heightDirty=false; }
    if (needsDraw || stroke) {
      const quality=stroke?'preview':'full',start=performance.now();
      const stats=renderer.draw({quality,clay:$('clay').checked,light:$('light').value,fractures:Number($('fractures').value)/100,scree:Number($('scree').value)/100,detail:Number($('relief').value)/100,ring:Number($('mineral-ring').value)/100,ringSpread:Number($('ring-spread').value)/100,ringVariation:Number($('ring-variation').value)/100,fringeStyle:$('fringe-style').value,materialWeathering:Number($('material-weathering').value)/100,transitionDetail:Number($('transition-detail').value)/100});
      drawTiming(stats,performance.now()-start,quality);
      if (!stroke) { renderedRevision=revision; updateControls(); }
      needsDraw=false;
    }
    drawOverlay();
  } catch (err) { error(err.message); status('Rendering failed. Your heightfield remains available to save.'); return; }
  if (stroke) schedule();
}
function drawOverlay() {
  ink.clearRect(0,0,size,size);
  if (cursor && !pan && !space) {
    ink.strokeStyle='#b8eef3'; ink.fillStyle='#a7e6f00c'; ink.lineWidth=1.5;
    ink.beginPath(); ink.arc(cursor.cx,cursor.cy,stroke?.radius ?? Number($('diameter').value)/2,0,Math.PI*2); ink.fill(); ink.stroke();
    ink.beginPath(); ink.moveTo(cursor.cx-4,cursor.cy); ink.lineTo(cursor.cx+4,cursor.cy); ink.moveTo(cursor.cx,cursor.cy-4); ink.lineTo(cursor.cx,cursor.cy+4); ink.stroke();
  }
  if (stroke?.kind==='ramp') {
    ink.strokeStyle='#d4eda8'; ink.lineWidth=2; ink.setLineDash([6,5]); ink.beginPath();
    for (const [i,p] of stroke.path.entries()) {
      const y=p.y-(Math.max(config.seaLevel,sample(heights,p.x,p.y))-config.baseHeight)*.5;
      if (i) ink.lineTo(p.x,y); else ink.moveTo(p.x,y);
    }
    ink.stroke(); ink.setLineDash([]);
  }
  overlay.style.cursor=pan?'grabbing':space?'grab':'none';
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
  else if (stroke) { const p=picked(cursor); if (p) { if (stroke.kind==='ramp') ramp(stroke,p); else extendStroke(stroke,p); } }
  schedule(Boolean(stroke));
});
function endPointer(event) {
  if (pointerId!==event.pointerId) return;
  if (stroke && event.type==='pointerup') { cursor=screenPoint(event); const p=picked(cursor); if (p) { if (stroke.kind==='ramp') ramp(stroke,p); else extendStroke(stroke,p); } }
  const hadStroke=Boolean(stroke);
  if (stroke) { settleHill(stroke); settleRamp(stroke); }
  if (stroke) lastWaterStroke=['deep','shallow'].includes(stroke.kind)?stroke:null;
  stroke=null; pan=null; pointerId=null;
  if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId);
  if (hadStroke) { checkpoint(); status('Stroke complete · full-detail draw.'); queueWeather(); }
  updateControls(); schedule();
}
overlay.addEventListener('pointerup',endPointer); overlay.addEventListener('pointercancel',endPointer);
overlay.addEventListener('lostpointercapture',event => { if (stroke || pan) endPointer(event); });
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
  // exercise the biome's default shapes; saved maps always retain their heights.
  const island=experiment.get('example')==='islands';
  const s=startStroke(kind,points[0],{bankWidth:island?defaults.bankWidth/100:.5,beachFlatness:island?defaults.beachFlatness/100:.5,softness:experiment.has('soft')?Number(experiment.get('soft')):island?defaults.softness/100:.5,...options}); dab(s,points[0]); for (const p of points.slice(1)) extendStroke(s,p);
  settleHill(s);
}
function demoRamp(points,options) {
  const s=startStroke('ramp',points[0],options);
  for (const p of points.slice(1)) ramp(s,p);
  settleRamp(s);
}
function mixedScene() {
  applySeedControl(); refinementSeed=seed;
  lastWaterStroke=null; cancelWeather(); refined=refinedBase=null; renderer?.setWeather(); heights.fill(config.baseHeight); protection.fill(0); routes.fill(0);
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
  const s=startStroke('ramp',{x:280,y:350},{radius:65,rough:.22}); ramp(s,{x:430,y:535});
  if (experiment.get('scene')==='compact') {
    for (let i=0;i<heights.length;i++) if (heights[i]>config.baseHeight)
      heights[i]=config.baseHeight+(heights[i]-config.baseHeight)*.60;
  }
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
  return {format:'nanolathe-terrain-sculpt',version:3,biome:config.biomeId||'green',size,grid,baseHeight:config.baseHeight,seaLevel:config.seaLevel,seed,refinementSeed,
    toolSettings,bankWidth:Number($('bank-width').value),softness:Number($('softness').value),relief:Number($('relief').value),
    beachFlatness:Number($('beach-flatness').value),mineralRing:Number($('mineral-ring').value),ringSpread:Number($('ring-spread').value),
    ringVariation:Number($('ring-variation').value),fringeStyle:$('fringe-style').value,materialWeathering:Number($('material-weathering').value),depositSpread:Number($('deposit-spread').value),transitionDetail:Number($('transition-detail').value),
    tool,diameter:Number($('diameter').value),amount:Number($('amount').value),roughness:Number($('roughness').value),shelves:Number($('shelves').value),shallowMode:$('shallow-mode').value,fractures:Number($('fractures').value),scree:Number($('scree').value),weather:$('weather').checked,clay:$('clay').checked,light:$('light').value,encoding:'float32-le/base64',heights:encodedHeights(),protection:encodedHeights(protection),routes:encodedHeights(routes)};
}
function persistLater() {
  if (experiment.has('scratch')) { $('save-state').textContent='Comparison sketch · use Save sketch to keep it.'; return; }
  clearTimeout(autosaveTimer); autosaveTimer=setTimeout(() => {
    if (stroke || loading) { persistLater(); return; }
    try { localStorage.setItem(LOCAL_KEY,JSON.stringify(sketch())); $('save-state').textContent='Sculpt sketch autosaved locally · v3. Existing painter sketches are untouched.'; }
    catch (_) { $('save-state').textContent='Local autosave unavailable. Use Save sketch to keep this heightfield.'; }
  },450);
}
function loadSketch(s) {
  if (!s || s.format!=='nanolathe-terrain-sculpt' || s.version!==3 || s.size!==size || s.grid!==grid || s.encoding!=='float32-le/base64' || typeof s.heights!=='string' || s.heights.length>heights.length*6) throw new Error('Load a v3 sculpt sketch with the same canvas and grid size. Painter sketches use a different format.');
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
  if (Number.isFinite(s.amount)) $('amount').value=clamp(s.amount,5,160);
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
  markChanged(); updateControls();
}
function download(blob,name) { const url=URL.createObjectURL(blob),a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); }
for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click',() => { if (stroke) return; rememberTool(); tool=b.dataset.tool; showTool(toolSettings[tool]); updateControls(); schedule(); persistLater(); });
for (const id of ['diameter','amount','roughness','shelves','bank-width','beach-flatness','softness']) $(id).addEventListener('input',() => { rememberTool(true); updateControls(); schedule(); persistLater(); });
$('tool-style').addEventListener('change',() => { const preset=$('tool-style').value; if (!Object.hasOwn(TOOL_PRESETS,preset)) return; toolSettings[tool]=toolDefaults(tool,preset); showTool(toolSettings[tool]); updateControls(); schedule(); persistLater(); });
for (const id of ['relief','transition-detail']) $(id).addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); persistLater(); });
for (const id of ['mineral-ring','ring-spread','ring-variation']) $(id).addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); persistLater(); });
for(const id of ['material-weathering','deposit-spread']) $(id).addEventListener('input',()=>{markViewChanged();updateControls();schedule();queueWeather();persistLater();});
$('fringe-style').addEventListener('change',() => { markViewChanged(); schedule(); persistLater(); });
$('fractures').addEventListener('input',() => { markViewChanged(); updateControls(); schedule(); persistLater(); });
$('shallow-mode').addEventListener('change',() => { rememberTool(true); updateControls(); persistLater(); });
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
$('blank').addEventListener('click',() => { if (stroke) return; applySeedControl(); refinementSeed=seed; lastWaterStroke=null; cancelWeather(); refined=refinedBase=null; renderer.setWeather(); heights.fill(config.baseHeight); protection.fill(0); routes.fill(0); markChanged(); checkpoint(); status('Blank dry ground.'); schedule(); queueWeather(); });
$('save').addEventListener('click',() => { if (!stroke) download(new Blob([JSON.stringify(sketch())],{type:'application/json'}),'terrain-sculpt-v3.json'); });
$('load').addEventListener('click',() => { if (!stroke) $('file').click(); });
$('file').addEventListener('change',async () => {
  const file=$('file').files[0]; $('file').value=''; if (!file || stroke) return;
  loading=true; $('editor').disabled=true;
  try { if (file.size>10000000) throw new Error('This sculpt sketch is too large to load.'); loadSketch(JSON.parse(await file.text())); checkpoint(); status('Loaded the v3 sculpt heightfield.'); schedule(); queueWeather(); } catch (err) { error(err.message); }
  finally { loading=false; $('editor').disabled=false; updateControls(); }
});
$('export').addEventListener('click',() => {
  if (!canExport()) return;
  try {
    if (heightDirty) { renderer.setHeight(previewHeight(),grid); renderer.setRoutes(routes); heightDirty=false; }
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
});
window.addEventListener('keyup',event => { if (event.code==='Space') { space=false; schedule(false); } });
window.addEventListener('blur',() => { space=false; cursor=null; schedule(false); }); new ResizeObserver(resize).observe($('viewport'));


// Surface knobs: each writes the page address and the renderer's variant,
// then the renderer re-reads its uniforms and re-bakes its fields.
const KNOBS = [
  ['Relief', [['reliefScale','Scale (px)',8,64,1,28],['reliefAmount','Strength',0,1.2,.05,.5],['reliefLumps','Lumps',0,1,.05,.7],
    ['reliefBranch','Branching',0,4,.1,2],['reliefWarp','Warp (px)',0,24,1,10],['reliefPatchy','Patchiness',0,1,.05,1],['reliefOctaves','Octaves',1,6,1,5]]],
  ['Faces', [['slopeTexture','Sampled slope texture',0,1,.05,.3],['faceEdge','Edge breakup',0,2,.05,.8],['gullyRock','Rock in gullies',0,2,.05,.5],['moss','Moss from ground',0,1,.05,0],['crevice','Crevices',0,1,.05,0],['lightCap','Highlight cap',1,1.6,.01,1.13]]],
  ['Boulders', [['boulders','Density',0,1,.05,0],['boulderSize','Size (px)',4,24,1,9],['boulderFoot','From cliff feet',0,1,.05,.5],
    ['boulderCluster','Clustering',0,1,.05,.6],['boulderMoss','Mossy tops',0,1,.05,.35]]],
  ['Debris', [['debris','Amount',0,1,.05,0],['debrisReach','Reach (px)',16,128,4,48],['debrisSize','Size (px)',3,12,1,6],['debrisSort','Sorting',0,1,.05,.8],['repose','Rest slope',.3,1,.05,.6]]],
  ['Sand', [['sand','Amount',0,1,.05,0],['beach','Beach height',0,30,1,10],['basinSand','In hollows',0,1,.05,.6],['drift','Wind drifts',0,1,.05,.45],
    ['wind','Wind toward (deg)',0,360,5,20],['ripple','Ripple length (px)',0,16,1,7],['rippleHeight','Ripple height',0,3,.1,1.4],['sandGrain','Grain',0,.5,.01,.22]]],
  ['Water', [['shallowDepth','Shallow until depth',0,60,1,24],['deepDepth','Deep from depth',10,100,1,60]]],
  ['Palette', [['dither','Dither (water)',0,4,.1,2],['landDither','Land dither share',0,1,.05,.25]]],
];
function buildKnobs() {
  const root = $('knobs'), params = new URLSearchParams(location.search);
  const toggle = (key, label, on, off, isOn) => {
    const row = document.createElement('label'); row.className = 'small'; row.style.display = 'flex'; row.style.gap = '6px';
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = isOn;
    box.addEventListener('change', () => setKnob(key, box.checked ? on : off));
    row.append(box, label); root.append(row);
  };
  toggle('detail', 'Fall-line surface (off: lab look)', 'fall', 'lab', params.get('detail') !== 'lab');
  toggle('palette', 'TA palette', 'nearest', 'off', params.get('palette') !== 'off');
  for (const [group, knobs] of KNOBS) {
    const title = document.createElement('h3'); title.textContent = group; root.append(title);
    for (const [key, label, min, max, step, value] of knobs) {
      const wrap = document.createElement('div'); wrap.className = 'control';
      const id = 'knob-' + key, current = params.has(key) ? Number(params.get(key)) : value;
      wrap.innerHTML = `<label for="${id}">${label} <output>${current}</output></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${current}">`;
      const input = wrap.querySelector('input'), out = wrap.querySelector('output');
      input.addEventListener('input', () => { out.textContent = input.value; setKnob(key, input.value); });
      root.append(wrap);
    }
  }
}
function setKnob(key, value) {
  const url = new URL(location.href); url.searchParams.set(key, value); window.history.replaceState(null, '', url);
  experiment.set(key, value);
  renderer.variant.set(key, value); renderer.applyKnobs(); markViewChanged(); schedule();
}
async function boot() {
  try {
    const response=await fetch('/sculpt-config.json'); if (!response.ok) throw new Error('Could not load the sculpt configuration.'); config=await response.json();
    if (config.size!==1024 || !Number.isInteger(config.grid) || config.grid<2 || config.grid>1024 || !Number.isFinite(config.baseHeight) || !Number.isFinite(config.seaLevel)) throw new Error('Unsupported sculpt configuration.');
    if (config.biomeId && config.biomeId!=='green') LOCAL_KEY+='-'+config.biomeId;
    document.querySelector('.topbar h2').textContent=(config.biome||'Green Planet')+' terrain';
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
    size=config.size; grid=config.grid; spacing=(size-1)/(grid-1); heights=new Float32Array(grid*grid); protection=new Float32Array(grid*grid); routes=new Float32Array(grid*grid); heights.fill(config.baseHeight);
    canvas.width=canvas.height=overlay.width=overlay.height=size; seed=Number($('seed').value); refinementSeed=seed; noise=makeNoise(seed);
    renderer=await TerrainRenderer.create(canvas,config);
    buildKnobs();
    $('fracture-control').hidden=!config.textures.fractures;
    $('fractures').value=clamp(Number(experiment.get('fractures'))||0,0,100);
    $('scree').value=clamp(Number(experiment.get('scree'))||0,0,100);
    let saved=null; try { if (!experiment.has('scratch')) saved=localStorage.getItem(LOCAL_KEY); } catch (_) {}
    if (saved) { try { loadSketch(JSON.parse(saved)); status('Restored your v3 sculpt sketch.'); } catch (err) { mixedScene(); error('Saved sculpt sketch could not be loaded: '+err.message+' The saved copy is retained until you edit.'); status('Mixed example shown.'); } }
    else { mixedScene(); status('Mixed scene ready · paint any continuous shape.'); }
    ready=true; $('editor').disabled=false; history=[{height:heights.slice(),protect:protection.slice(),routes:routes.slice(),refinementSeed}]; historyIndex=0;
    $('levels').textContent=`Dry base ${config.baseHeight} · sea ${config.seaLevel} · heights ${MIN_HEIGHT}…${MAX_HEIGHT}`;
    updateControls(); resize(); schedule(); queueWeather();
  } catch (err) { error(err.message); status('The experimental renderer could not start.'); }
}
// Read-only hook for capture tools: the displayed (refined) heights.
window.sculptDebug = {heights: () => Array.from(previewHeight()), get grid() { return grid; }, get size() { return size; }, get base() { return config.baseHeight; }, get sea() { return config.seaLevel; }};
boot();
