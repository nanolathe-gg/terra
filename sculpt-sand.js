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
function hash(x,y,seed) {
  let h=Math.imul(x,374761393)^Math.imul(y,668265263)^seed;
  h=Math.imul(h^(h>>>13),1274126177); return ((h^(h>>>16))>>>0)/4294967295;
}
function noise(x,y,seed) {
  const ix=Math.floor(x),iy=Math.floor(y),fx=smooth(0,1,x-ix),fy=smooth(0,1,y-iy);
  const a=hash(ix,iy,seed),b=hash(ix+1,iy,seed),c=hash(ix,iy+1,seed),d=hash(ix+1,iy+1,seed);
  return (a+(b-a)*fx)*(1-fy)+(c+(d-c)*fx)*fy;
}
// Three running box means approximate one Gaussian of the given sigma (cells).
function boxBlur(input,grid,sigma) {
  const radius=Math.max(1,Math.round((Math.sqrt(4*sigma*sigma+1)-1)/2)),width=2*radius+1,last=grid-1;
  let a=Float32Array.from(input),b=new Float32Array(input.length);
  for (let pass=0;pass<3;pass++) for (let axis=0;axis<2;axis++) {
    const along=axis?grid:1,across=axis?1:grid;
    for (let line=0;line<grid;line++) {
      const o=line*across;
      let sum=0; for (let k=-radius;k<=radius;k++) sum+=a[o+(k<0?0:k>last?last:k)*along];
      for (let k=0;k<grid;k++) { b[o+k*along]=sum/width; const add=k+radius+1,drop=k-radius; sum+=a[o+(add>last?last:add)*along]-a[o+(drop<0?0:drop)*along]; }
    }
    [a,b]=[b,a];
  }
  return a;
}

export async function transportSand(request, height, pause) {
  const {grid,size,seaLevel=0,seed=1}=request,n=grid*grid,spacing=(size-1)/(grid-1);
  // Patchiness: how much weathering varies from place to place (0: even).
  const patchy=clamp(request.sandPatchy??.7,0,1),tail=clamp(request.sandTail??.6,0,1);
  const vary=(x,y,scale,salt) => 1+patchy*(noise(x*spacing/scale,y*spacing/scale,seed^salt)*2-1)*.85;
  const supply=clamp(request.sand??0,0,2),reach=clamp(request.sandReach??.6,0,1);
  const windStrength=clamp(request.windStrength??.5,0,1),windAngle=(request.windAngle??20)*Math.PI/180;
  const protect=request.protect;
  if (!(supply>0)) return null;
  let deadline=performance.now()+10;
  const checkpoint=async () => { if (performance.now()<deadline) return false; const stop=await pause(); deadline=performance.now()+10; return stop; };
  const at=(x,y) => height[clamp(Math.round(y),0,grid-1)*grid+clamp(Math.round(x),0,grid-1)];
  const sand=new Float32Array(n);
  // Water: trace grains from each weathering face cell down the steepest
  // descent. Little settles on steep ground; as the slope eases, grains
  // settle over a runout length that varies from place to place, so some
  // streams carry far (tongues and fans) and others drop their load near the
  // foot (piles). On level ground grains keep their heading, wandering a
  // little, until the load is spent; all of it settles at the water.
  const maxSteps=Math.round(20+reach*140),runout=(6+reach*70)/spacing;
  for (let y=1;y<grid-1;y+=2) {
    for (let x=1;x<grid-1;x+=2) {
      const i=y*grid+x,h=height[i];
      if (h<seaLevel+2) continue;
      const gx=(height[i+1]-height[i-1])/(2*spacing),gy=(height[i+grid]-height[i-grid])/(2*spacing);
      // Rock weathers unevenly: some faces shed much more than others.
      const source=smooth(.8,1.6,Math.hypot(gx,gy))*(1-(protect?protect[i]:0))*vary(x,y,90,0x5a11);
      if (source<.02) continue;
      let px=x,py=y,load=source*supply,dx=0,dy=0;
      const length=runout*vary(x,y,60,0x2c47);
      for (let step=0;step<maxSteps && load>.002;step++) {
        const hc=at(px,py),j=clamp(Math.round(py),0,grid-1)*grid+clamp(Math.round(px),0,grid-1);
        if (hc<seaLevel+.5) { sand[j]+=load; break; }
        let best=0,bx=0,by=0;
        for (const [ox,oy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
          const drop=(hc-at(px+ox,py+oy))/Math.hypot(ox,oy);
          if (drop>best) { best=drop; bx=ox; by=oy; }
        }
        const slope=best/spacing;
        if (best>.05) { const l=Math.hypot(bx,by); dx=dx*.5+bx/l*.5; dy=dy*.5+by/l*.5; }
        else if (!dx && !dy) { sand[j]+=load; break; }
        // Wander, more on level ground.
        const turn=(noise(px*spacing/23,py*spacing/23,seed^0x6173)-.5)*(slope>.2?.4:1.1);
        const c=Math.cos(turn),sn=Math.sin(turn),nx=dx*c-dy*sn,ny=dx*sn+dy*c,norm=Math.hypot(nx,ny)||1;
        dx=nx/norm; dy=ny/norm;
        // Going uphill ends the run: the grains pond against the rise.
        if (at(px+dx,py+dy)>hc+.6) { sand[j]+=load; break; }
        // Sand also rests on the lower slopes (an apron up the foot), not
        // only once the ground levels out.
        const settle=load*(.015+(1-Math.exp(-1/length))*(1-smooth(.45,1.15,slope)));
        sand[j]+=settle; load-=settle; px+=dx; py+=dy;
        if (px<1 || py<1 || px>grid-2 || py>grid-2) break;
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
          // Sheltered sand stays put; exposed sand is lifted, more where
          // gusts are strong.
          const gust=vary(x,y,120,0x7e03);
          let moving=Math.min(sand[i],sand[i]*windStrength*.5*(1-shadow[i])*gust);
          next[i]-=moving;
          let px=x,py=y;
          const reachHop=hop*gust;
          for (let k=0;k<4 && moving>.0005;k++) {
            px+=wx*reachHop; py+=wy*reachHop;
            const tx=Math.round(px),ty=Math.round(py);
            if (tx<0 || ty<0 || tx>=grid || ty>=grid) { moving=0; break; }
            const j=ty*grid+tx;
            if (height[j]<seaLevel+.5) { break; }
            const stick=clamp(.3+.6*shadow[j]+.4*smooth(0,.3,sand[j]),0,1);
            next[j]+=moving*stick; moving*=1-stick;
          }
          // Sand that falls into water rests at the waterline it reached.
          if (moving>0) { const j=clamp(Math.round(py-wy*reachHop),0,grid-1)*grid+clamp(Math.round(px-wx*reachHop),0,grid-1); next[j]+=moving; }
        }
        if ((y&15)===15 && await checkpoint()) return null;
      }
      sand.set(next);
    }
  }
  // Sandiness: the deposit itself, softened a little, plus a wide thin
  // tail of fines carried beyond it, so sand thins into the ground over
  // tens of pixels instead of ending at a rim. 0 none, 1 deep sand; the
  // shader maps it to a colour dusting, then scattered grains, then cover.
  const near=boxBlur(sand,grid,1.5/spacing*2),far=boxBlur(sand,grid,(10+tail*40)/spacing);
  const out=new Float32Array(n);
  for (let i=0;i<n;i++) out[i]=height[i]<seaLevel-1?0:1-Math.exp(-(near[i]*1.6+far[i]*(1+tail*7)));
  return out;
}
