/* Bounded heightfield weathering for the authoring prototype, not retail rules.
 * Background: Mei/Decaudin/Hu, Fast Hydraulic Erosion Simulation and
 * Visualization on GPU (2007), and Stava et al., Interactive Terrain Modeling
 * Using Hydraulic Erosion (2008):
 * https://www-evasion.imag.fr/Publications/2007/MDH07/FastErosion_PG07.pdf
 * https://cs.purdue.edu/cgvlab/www/publications/Stava08SCA/
 * This independently authored droplet approximation is not either paper's
 * shallow-water solver. Bounds and protection preserve compact authored forms;
 * they establish no movement, building or simulation-passability guarantee.
 */

import {weatherMaterials} from './sculpt-material-weathering.js';
import {transportSand} from './sculpt-sand.js';

const CHUNK_MS=8, PUBLISH_MS=85;
const clamp=(v,a,b) => Math.max(a,Math.min(b,v));
const smooth=(a,b,v) => { const t=clamp((v-a)/(b-a),0,1); return t*t*(3-2*t); };
const yieldTask=() => new Promise(resolve => setTimeout(resolve,0));
let latestJob=-1, pending=null, running=false;

self.onmessage=event => {
  const request=event.data;
  if (!request || !Number.isSafeInteger(request.job) || request.job<=latestJob) return;
  latestJob=request.job;
  if (request.cancel) { pending=null; return; }
  const {height,grid,size,protect}=request;
  // Card D phase 1: a 4x4 map plus its projection apron is 1168 samples wide.
  if (!(height instanceof Float32Array) || !Number.isInteger(grid) || grid<2 || grid>1168 || height.length!==grid*grid || !Number.isFinite(size) || size<=1 || (protect!==undefined && (!(protect instanceof Float32Array) || protect.length!==height.length))) {
    throw new Error('Weathering requires a square Float32Array heightfield and matching optional protection.');
  }
  pending=request;
  if (!running) drain();
};

async function drain() {
  running=true;
  try { while (pending) { const request=pending; pending=null; await weather(request); } }
  catch (error) {
    if (typeof self.reportError==='function') self.reportError(error);
    else setTimeout(() => { throw error; },0);
  }
  finally { running=false; }
}

function hash(x,y,seed) {
  let n=Math.imul(x,374761393)^Math.imul(y,668265263)^seed;
  n=Math.imul(n^(n>>>13),1274126177); return ((n^(n>>>16))>>>0)/4294967295*2-1;
}
function noise(x,y,seed) {
  const ix=Math.floor(x),iy=Math.floor(y),fx=smooth(0,1,x-ix),fy=smooth(0,1,y-iy);
  const a=hash(ix,iy,seed),b=hash(ix+1,iy,seed),c=hash(ix,iy+1,seed),d=hash(ix+1,iy+1,seed);
  return (a+(b-a)*fx)*(1-fy)+(c+(d-c)*fx)*fy;
}

async function weather(request) {
  // Transport also works at sea 0: otherwise the coarser Float32 spacing at
  // a raised datum changes droplet paths after repeated erosion/deposition.
  const outputSea=request.seaLevel??0;
  if (outputSea) request={...request,height:request.height.map(h => h-outputSea),baseHeight:request.baseHeight-outputSea,seaLevel:0};
  const started=performance.now(),{job,grid,size}=request,n=grid*grid,spacing=(size-1)/(grid-1);
  const seaLevel=request.seaLevel??0,MIN_HEIGHT=seaLevel-90,MAX_HEIGHT=seaLevel+300;
  const broad=request.profile==='broad';
  const intensity=clamp(Number.isFinite(request.strength)?request.strength:1,0,2),budgetScale=Math.min(1,intensity);
  const talusAmount=clamp(Number.isFinite(request.talus)?request.talus:0,0,1);
  const baseHeight=Number.isFinite(request.baseHeight)?request.baseHeight:24;
  // Input buffers remain untouched. Only fresh output snapshots are transferred.
  const original=request.height.slice(),height=original.slice();
  const gradient=new Float32Array(n),mobility=new Float32Array(n),lower=original.slice(),upper=original.slice();
  const flow=new Float32Array(n),deposited=new Float32Array(n);
  const apron=talusAmount>0?new Float32Array(n):null;
  const deltaX=broad?new Float32Array(n):null,weightX=broad?new Float32Array(n):null;
  let activeCount=0;
  const protection=request.protect;
  let rng=(Number.isFinite(request.seed)?request.seed:1)>>>0;
  rng=(rng^0x6c8e9cf5)>>>0 || 1;
  const random=() => { rng^=rng<<13; rng^=rng>>>17; rng^=rng<<5; return (rng>>>0)/4294967296; };
  const seed=(Number.isFinite(request.seed)?request.seed:1)>>>0;
  let materialField=null,sandField=null;
  const cancelled=() => latestJob!==job;
  let deadline=performance.now()+CHUNK_MS,lastPublished=started;
  async function pause() {
    await yieldTask(); deadline=performance.now()+CHUNK_MS; return cancelled();
  }
  async function deriveApron() {
    // Authored geometry support, not particle sediment or a random texture.
    // Higher steep samples contribute only to a 24-world-unit dry-foot collar.
    const shoreLow=Math.max(seaLevel+12,baseHeight-6),reach=24,range=Math.ceil(reach/spacing),offsets=[];
    const strongest=new Float32Array(n),mass=new Float32Array(n),vx=new Float32Array(n),vy=new Float32Array(n);
    for (let dy=-range;dy<=range;dy++) for (let dx=-range;dx<=range;dx++) {
      const cells=Math.hypot(dx,dy),distance=cells*spacing;
      if (distance>0 && distance<reach) offsets.push([dx,dy,dx/cells,dy/cells,1-smooth(4,reach,distance)]);
    }
    // Even soft authored protection is kept clear: it is how the UI identifies
    // ramp grades and plateau interiors that heights alone cannot distinguish.
    for (let i=0;i<n;i++) {
      if (original[i]>shoreLow && !(protection && protection[i]>0))
        apron[i]=smooth(shoreLow,shoreLow+6,original[i])*(1-smooth(.16,.52,gradient[i]));
      if ((i&32767)===32767 && performance.now()>=deadline && await pause()) return false;
    }
    for (let y=0;y<grid;y++) {
      for (let x=0;x<grid;x++) {
        const source=y*grid+x,steep=smooth(.8,1.35,gradient[source]);
        if (steep>0 && original[source]>shoreLow+12 && !(protection && protection[source]>0)) {
          for (const [dx,dy,ux,uy,distanceWeight] of offsets) {
            const xx=x+dx,yy=y+dy;
            if (xx<0 || yy<0 || xx>=grid || yy>=grid) continue;
            const foot=yy*grid+xx;
            if (!apron[foot]) continue;
            const weight=steep*distanceWeight*smooth(12,28,original[source]-original[foot]);
            if (weight<=0) continue;
            strongest[foot]=Math.max(strongest[foot],weight);
            mass[foot]+=weight; vx[foot]+=weight*ux; vy[foot]+=weight*uy;
          }
        }
        if ((x&15)===15 && performance.now()>=deadline && await pause()) return false;
      }
    }
    for (let i=0;i<n;i++) {
      // Converging higher-ground directions favor pockets and interrupted fans.
      // Uniform straight or convex walls can yield little apron rather than a
      // continuous decorative belt. No additional noise breaks the geometry.
      const convergence=mass[i]>0?clamp(1-Math.hypot(vx[i],vy[i])/mass[i],0,1):0;
      apron[i]*=talusAmount*smooth(.02,.26,strongest[i])*smooth(.08,.25,convergence);
      if ((i&32767)===32767 && performance.now()>=deadline && await pause()) return false;
    }
    return !cancelled();
  }
  async function softenBroadDelta(output) {
    if (!activeCount) return true;
    // A world-sized, masked Gaussian acts only on the weathering difference.
    // It merges weak neighboring gutters and their deposits without blurring
    // authored crowns, ramp grades, water beds or the original hill silhouette.
    const radius=Math.max(1,Math.ceil(6/spacing)),kernel=[];
    for (let k=-radius;k<=radius;k++) kernel.push(Math.exp(-.5*(k*spacing/3)**2));
    for (let y=0;y<grid;y++) {
      for (let x=0;x<grid;x++) {
        const i=y*grid+x; let delta=0,total=0;
        for (let k=-radius;k<=radius;k++) {
          const j=y*grid+clamp(x+k,0,grid-1),w=kernel[k+radius]*mobility[j];
          delta+=(height[j]-original[j])*w; total+=w;
        }
        deltaX[i]=delta; weightX[i]=total;
      }
      if ((y&3)===3 && performance.now()>=deadline && await pause()) return false;
    }
    for (let y=0;y<grid;y++) {
      for (let x=0;x<grid;x++) {
        const i=y*grid+x;
        if (!mobility[i] || original[i]<=seaLevel) { output[i]=original[i]; continue; }
        const blend=.65*(1-smooth(.55,1.1,gradient[i]));
        if (!blend) continue;
        let delta=0,total=0;
        for (let k=-radius;k<=radius;k++) {
          const j=clamp(y+k,0,grid-1)*grid+x,w=kernel[k+radius];
          delta+=deltaX[j]*w; total+=weightX[j]*w;
        }
        if (total>0) {
          const raw=height[i]-original[i];
          output[i]=clamp(original[i]+raw+(delta/total-raw)*blend,lower[i],upper[i]);
        }
      }
      if ((y&3)===3 && performance.now()>=deadline && await pause()) return false;
    }
    return !cancelled();
  }
  async function publish(progress,done=false) {
    if (cancelled()) return false;
    const output=height.slice(),f=new Float32Array(n),d=new Float32Array(n),t=new Float32Array(n);
    if (broad && !await softenBroadDelta(output)) return false;
    for (let i=0;i<n;i++) {
      // Fixed saturating scales keep coverage stable between progress updates.
      f[i]=flow[i]/(flow[i]+4); d[i]=deposited[i]/(deposited[i]+1.2);
      // The apron is an optional derived output. It does not alter authored
      // samples, protection, hydraulic transport, or the existing off result.
      if (apron) { t[i]=apron[i]; output[i]=clamp(output[i]+3.5*t[i],MIN_HEIGHT,MAX_HEIGHT); }
      if (outputSea) output[i]+=outputSea;
      if ((i&32767)===32767 && performance.now()>=deadline && await pause()) return false;
    }
    if (cancelled()) return false;
    const transfers=[output.buffer,f.buffer,d.buffer,t.buffer];
    if (materialField) transfers.push(materialField.buffer);
    const sand=sandField?sandField.slice():null; if (sand) transfers.push(sand.buffer);
    self.postMessage({job,progress,height:output,flow:f,deposit:d,talus:t,sand,materialField,milliseconds:performance.now()-started,done},transfers);
    lastPublished=performance.now(); deadline=lastPublished+CHUNK_MS; return true;
  }

  // Central slope is measured in world height/world distance, independent of grid.
  for (let y=0;y<grid;y++) {
    for (let x=0;x<grid;x++) {
      const i=y*grid+x,h=original[i];
      if (!Number.isFinite(h) || h<MIN_HEIGHT || h>MAX_HEIGHT) throw new Error('Weathering height is outside the authoring range.');
      const lx=Math.max(0,x-1),rx=Math.min(grid-1,x+1),ty=Math.max(0,y-1),by=Math.min(grid-1,y+1);
      gradient[i]=Math.hypot((original[y*grid+rx]-original[y*grid+lx])/((rx-lx)*spacing),(original[by*grid+x]-original[ty*grid+x])/((by-ty)*spacing));
    }
    if ((y&3)===3 && performance.now()>=deadline && await pause()) return;
  }
  // One-cell transition collars can receive a foot deposit; broad level interiors
  // and every originally submerged sample stay exactly unchanged.
  for (let y=0;y<grid;y++) {
    for (let x=0;x<grid;x++) {
      const i=y*grid+x,p=protection?protection[i]:0;
      if (protection && !Number.isFinite(p)) throw new Error('Weathering protection must be finite.');
      if (!intensity || original[i]<=seaLevel || p>=1) continue;
      let slope=gradient[i];
      for (let yy=Math.max(0,y-1);yy<=Math.min(grid-1,y+1);yy++) for (let xx=Math.max(0,x-1);xx<=Math.min(grid-1,x+1);xx++) slope=Math.max(slope,gradient[yy*grid+xx]);
      const weight=smooth(.035,.20,slope)*(1-clamp(p,0,1));
      mobility[i]=weight;
      if (weight<=0) continue;
      const steep=smooth(.7,1.5,slope);
      lower[i]=Math.max(MIN_HEIGHT,original[i]-(4+8*steep)*budgetScale*weight);
      upper[i]=Math.min(MAX_HEIGHT,original[i]+(2.5+2.5*steep)*budgetScale*weight);
      // Small coherent slope relief seeds drainage without texturing level tops.
      const wx=x*spacing,wy=y*spacing;
      const detail=.5*noise(wx/77,wy/77,seed^0x3281)+.33*noise(wx/27,wy/27,seed^0x91b3)+.17*noise(wx/10,wy/10,seed^0x2fa5);
      height[i]=clamp(original[i]+1.6*budgetScale*weight*smooth(.1,.9,slope)*detail,lower[i],upper[i]);
      if (weight>.04) activeCount++;
    }
    if ((y&3)===3 && performance.now()>=deadline && await pause()) return;
  }
  if (apron && !await deriveApron()) return;
  async function finish() {
    if (request.sand>0) {
      sandField=await transportSand(request,height,pause);
      if (cancelled()) return;
    }
    if (request.materialWeathering>0) {
      if (!await publish(.93)) return;
      const surface=height.slice();
      if (broad && !await softenBroadDelta(surface)) return;
      materialField=await weatherMaterials({...request,height:surface},pause);
      if (!materialField || cancelled()) return;
    }
    await publish(1,true);
  }
  if (request.eroded) {
    // H2: the GPU pass (sculpt-erosion.js) did the hydraulic and thermal work within the bounds above; its height, flow
    // and deposit stand in for the droplets and the talus passes, and the apron, sand and material field run as always.
    height.set(request.eroded.map(h => h-outputSea)); flow.set(request.erodedFlow); deposited.set(request.erodedDeposit);
    await finish(); return;
  }
  if (!activeCount || !intensity) { await finish(); return; }
  if (!await publish(.06)) return;

  // Reused sample slots avoid allocating objects at every particle step.
  const sample=new Float64Array(3),nextSample=new Float64Array(3);
  function read(x,y,out) {
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,i=iy*grid+ix;
    const a=height[i],b=height[i+1],c=height[i+grid],d=height[i+grid+1];
    out[0]=(a+(b-a)*fx)*(1-fy)+(c+(d-c)*fx)*fy;
    out[1]=((b-a)*(1-fy)+(d-c)*fy)/spacing;
    out[2]=((c-a)*(1-fx)+(d-b)*fx)/spacing;
  }
  function traceFlow(x,y,water) {
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,i=iy*grid+ix;
    flow[i]+=water*(1-fx)*(1-fy)*mobility[i]; flow[i+1]+=water*fx*(1-fy)*mobility[i+1];
    flow[i+grid]+=water*(1-fx)*fy*mobility[i+grid]; flow[i+grid+1]+=water*fx*fy*mobility[i+grid+1];
  }
  function deposit(x,y,amount) {
    if (!(amount>0)) return 0;
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,i=iy*grid+ix;
    const ids=[i,i+1,i+grid,i+grid+1],weights=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy];
    let total=0;
    for (let k=0;k<4;k++) { weights[k]*=mobility[ids[k]]; if (upper[ids[k]]-height[ids[k]]<=1e-6) weights[k]=0; total+=weights[k]; }
    if (total<=0) return 0;
    let added=0;
    for (let k=0;k<4;k++) { const at=ids[k],part=Math.min(amount*weights[k]/total,Math.max(0,upper[at]-height[at])); height[at]=Math.min(upper[at],height[at]+part); deposited[at]+=part; added+=part; }
    return added;
  }
  const erosionRadius=Math.max(1.1,3.5/spacing),radius2=erosionRadius*erosionRadius;
  function erode(x,y,amount) {
    // The optional comparison spreads gentle runoff over a wider continuous
    // footprint; steep faces retain the original compact particle footprint.
    const gentle=broad?1-smooth(.65,1.1,gradient[Math.floor(y)*grid+Math.floor(x)]):0;
    const radius=broad?erosionRadius+(Math.max(erosionRadius,6/spacing)-erosionRadius)*gentle:erosionRadius;
    const footprint2=broad?radius*radius:radius2;
    const x0=Math.max(0,Math.ceil(x-radius)),x1=Math.min(grid-1,Math.floor(x+radius));
    const y0=Math.max(0,Math.ceil(y-radius)),y1=Math.min(grid-1,Math.floor(y+radius));
    let total=0;
    for (let yy=y0;yy<=y1;yy++) for (let xx=x0;xx<=x1;xx++) {
      const i=yy*grid+xx,w=1-((xx-x)**2+(yy-y)**2)/footprint2;
      if (w>0 && height[i]>lower[i]+1e-6) total+=w*mobility[i];
    }
    if (total<=0) return 0;
    let removed=0;
    for (let yy=y0;yy<=y1;yy++) for (let xx=x0;xx<=x1;xx++) {
      const i=yy*grid+xx,w=1-((xx-x)**2+(yy-y)**2)/footprint2;
      if (w<=0 || mobility[i]<=0) continue;
      const part=Math.min(amount*w*mobility[i]/total,Math.max(0,height[i]-lower[i]));
      height[i]=Math.max(lower[i],height[i]-part); removed+=part;
    }
    return removed;
  }

  const step=clamp(2.5/spacing,.45,1.1),stepWorld=step*spacing;
  function droplet(x,y,rain) {
    let dx=0,dy=0,speed=.6,water=rain,sediment=0;
    for (let life=0;life<44;life++) {
      read(x,y,sample);
      if (sample[0]<=seaLevel) break;
      const gx=sample[1],gy=sample[2],slope=Math.hypot(gx,gy);
      if (slope<.006) { deposit(x,y,sediment); break; }
      dx=.22*dx-.78*gx; dy=.22*dy-.78*gy;
      const norm=Math.hypot(dx,dy); if (norm<1e-8) { deposit(x,y,sediment); break; }
      dx/=norm; dy/=norm;
      let nx=x+dx*step,ny=y+dy*step;
      if (nx<0 || ny<0 || nx>=grid-1 || ny>=grid-1) break;
      read(nx,ny,nextSample);
      // Inertia may approach a bank; retry pure downhill rather than travel up it.
      if (nextSample[0]>sample[0]+.001) {
        dx=-gx/slope; dy=-gy/slope; nx=x+dx*step; ny=y+dy*step;
        if (nx<0 || ny<0 || nx>=grid-1 || ny>=grid-1) break;
        read(nx,ny,nextSample);
        if (nextSample[0]>sample[0]+.001) { deposit(x,y,sediment); break; }
      }
      const fall=Math.max(0,sample[0]-nextSample[0]),capacity=Math.max(.015,fall/stepWorld)*speed*water*3.5;
      traceFlow(x,y,water);
      if (nextSample[0]<=seaLevel) { deposit(x,y,sediment); break; }
      if (sediment>capacity) sediment-=deposit(x,y,(sediment-capacity)*.32);
      else sediment+=erode(x,y,Math.min((capacity-sediment)*.18,Math.max(.012,fall*.25),1.4));
      speed=Math.sqrt(Math.max(.04,speed*speed+fall*.30)); water*=.96;
      x=nx; y=ny;
      if (life===43 || water<.15) { deposit(x,y,sediment); break; }
    }
  }
  // Rain is anchored to the whole world, not the current weatherable list.
  // A local edit cannot reshuffle rainfall over otherwise unrelated features.
  const count=Math.min(120000,Math.max(1,Math.round(n*.36*intensity)));
  for (let drop=0;drop<count;drop++) {
    const x=random()*(grid-1),y=random()*(grid-1),rain=.85+.30*random();
    if (mobility[Math.floor(y)*grid+Math.floor(x)]>.04) droplet(x,y,rain);
    // Chunk boundaries never alter particle order or random consumption.
    if ((drop&15)===15 && performance.now()>=deadline) {
      if (performance.now()-lastPublished>=PUBLISH_MS && !await publish(.06+.85*(drop+1)/count)) return;
      if (await pause()) return;
    }
  }

  // Two restrained talus passes exchange only available material between
  // weatherable samples. Four pair directions include both diagonals; reversing
  // traversal on pass two reduces scan bias without stochastic height spikes.
  const neighbours=[[1,0,1],[0,1,1],[1,1,Math.SQRT2],[-1,1,Math.SQRT2]];
  for (let pass=0;pass<2;pass++) {
    for (let row=0;row<grid;row++) {
      const y=pass?grid-1-row:row;
      for (let col=0;col<grid;col++) {
        const x=pass?grid-1-col:col,a=y*grid+x;
        if (!mobility[a]) continue;
        for (const [dx,dy,length] of neighbours) {
          const xx=x+dx,yy=y+dy; if (xx<0 || xx>=grid || yy<0 || yy>=grid) continue;
          const b=yy*grid+xx; if (!mobility[b]) continue;
          const high=height[a]>=height[b]?a:b,low=high===a?b:a;
          const excess=height[high]-height[low]-1.15*length*spacing;
          if (excess<=0) continue;
          const amount=Math.min(excess*.045,.09*intensity,height[high]-lower[high],upper[low]-height[low])*Math.min(mobility[a],mobility[b]);
          if (amount<=0) continue;
          height[high]=Math.max(lower[high],height[high]-amount); height[low]=Math.min(upper[low],height[low]+amount); deposited[low]+=amount;
        }
      }
      if ((row&3)===3 && performance.now()>=deadline && await pause()) return;
    }
  }
  await finish();
}
