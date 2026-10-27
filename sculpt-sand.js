// Sand from weathering, for the authoring preview. Rock faces weather into
// grains; water carries them downhill along the surface and drops them where
// the ground flattens, in hollows and at the shore; wind then hops loose
// grains downwind and lets them settle mostly in the lee of the terrain.
// The wind step is a continuous form of the slab model of Werner (1995,
// "Eolian dunes: computer simulations and attractor interpretation"): slabs
// hop a fixed length downwind and settle with a higher chance in shadow
// zones. Output is sand cover only; authored heights are never changed.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};

export async function transportSand(request, height, pause) {
  const {grid,size,seaLevel=0}=request,n=grid*grid,spacing=(size-1)/(grid-1);
  const supply=clamp(request.sand??0,0,2),reach=clamp(request.sandReach??.6,0,1);
  const windStrength=clamp(request.windStrength??.5,0,1),windAngle=(request.windAngle??20)*Math.PI/180;
  const protect=request.protect;
  if (!(supply>0)) return null;
  let deadline=performance.now()+10;
  const checkpoint=async () => { if (performance.now()<deadline) return false; const stop=await pause(); deadline=performance.now()+10; return stop; };
  const at=(x,y) => height[clamp(Math.round(y),0,grid-1)*grid+clamp(Math.round(x),0,grid-1)];
  const sand=new Float32Array(n);
  // Water: trace grains from each weathering face cell down the steepest
  // descent. A share settles at every step, more where the slope eases;
  // all of it settles in a pit or on reaching the water.
  const maxSteps=Math.round(4+reach*60);
  for (let y=1;y<grid-1;y+=2) {
    for (let x=1;x<grid-1;x+=2) {
      const i=y*grid+x,h=height[i];
      if (h<seaLevel+2) continue;
      const gx=(height[i+1]-height[i-1])/(2*spacing),gy=(height[i+grid]-height[i-grid])/(2*spacing);
      const source=smooth(.8,1.6,Math.hypot(gx,gy))*(1-(protect?protect[i]:0));
      if (source<.02) continue;
      let px=x,py=y,load=source*supply;
      for (let step=0;step<maxSteps && load>.002;step++) {
        let best=0,bx=0,by=0;
        const hc=at(px,py);
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
          const drop=(hc-at(px+dx,py+dy))/Math.hypot(dx,dy);
          if (drop>best) { best=drop; bx=dx; by=dy; }
        }
        const j=clamp(Math.round(py),0,grid-1)*grid+clamp(Math.round(px),0,grid-1);
        if (!best || hc<seaLevel+.5) { sand[j]+=load; break; }
        const slope=best/spacing;
        const settle=load*(.04+.5*(1-smooth(.15,.9,slope)));
        sand[j]+=settle; load-=settle; px+=bx; py+=by;
      }
    }
    if (await checkpoint()) return null;
  }
  // Wind: loose sand hops downwind; it settles readily in shadow behind
  // rising ground, and more easily on sand than on bare ground.
  const wx=Math.cos(windAngle),wy=Math.sin(windAngle);
  if (windStrength>0) {
    const hop=Math.max(1,Math.round(3+windStrength*5)),sweeps=Math.round(2+windStrength*6);
    const shadow=new Float32Array(n),surface=new Float32Array(n);
    for (let sweep=0;sweep<sweeps;sweep++) {
      for (let i=0;i<n;i++) surface[i]=height[i]+sand[i]*3;
      for (let y=0;y<grid;y++) {
        for (let x=0;x<grid;x++) {
          const i=y*grid+x; let s=0;
          // Sheltered if ground upwind rises above a 15 degree line.
          for (let d=1;d<=10;d++) {
            const ux=Math.round(x-wx*d*2),uy=Math.round(y-wy*d*2);
            if (ux<0 || uy<0 || ux>=grid || uy>=grid) break;
            s=Math.max(s,(surface[uy*grid+ux]-surface[i])/(d*2*spacing)-.27);
          }
          shadow[i]=smooth(0,.25,s);
        }
        if ((y&7)===7 && await checkpoint()) return null;
      }
      const next=sand.slice();
      for (let y=0;y<grid;y++) {
        for (let x=0;x<grid;x++) {
          const i=y*grid+x;
          if (sand[i]<.001 || height[i]<seaLevel+.5) continue;
          // Sheltered sand stays put; exposed sand is lifted.
          let moving=sand[i]*windStrength*.5*(1-shadow[i]);
          next[i]-=moving;
          let px=x,py=y;
          for (let k=0;k<4 && moving>.0005;k++) {
            px+=wx*hop; py+=wy*hop;
            const tx=Math.round(px),ty=Math.round(py);
            if (tx<0 || ty<0 || tx>=grid || ty>=grid) { moving=0; break; }
            const j=ty*grid+tx;
            if (height[j]<seaLevel+.5) { break; }
            const stick=clamp(.3+.6*shadow[j]+.4*smooth(0,.3,sand[j]),0,1);
            next[j]+=moving*stick; moving*=1-stick;
          }
          // Sand that falls into water rests at the waterline it reached.
          if (moving>0) { const j=clamp(Math.round(py-wy*hop),0,grid-1)*grid+clamp(Math.round(px-wx*hop),0,grid-1); next[j]+=moving; }
        }
        if ((y&15)===15 && await checkpoint()) return null;
      }
      sand.set(next);
    }
  }
  // One light blur removes single-cell speckle; then saturate to cover.
  const out=new Float32Array(n);
  for (let y=0;y<grid;y++) for (let x=0;x<grid;x++) {
    const i=y*grid+x; let s=sand[i]*4,w=4;
    if (x>0) { s+=sand[i-1]; w++; } if (x<grid-1) { s+=sand[i+1]; w++; }
    if (y>0) { s+=sand[i-grid]; w++; } if (y<grid-1) { s+=sand[i+grid]; w++; }
    const v=s/w; out[i]=height[i]<seaLevel-1?0:v/(v+.35);
  }
  return out;
}
