// Material transport for the authoring preview, independent of height erosion.
// It produces coverage data, not changed heights or a retail physics claim.
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

// Exposed material (source), slope gradient and concave resting places
// (basin), shared by the full transport and the quick edit preview.
function materialSources(request) {
  const {height,grid,size,baseHeight=24,seaLevel=0}=request;
  const profile=request.materialProfile||{};
  const spacing=(size-1)/(grid-1),n=height.length;
  const source=new Float32Array(n),gx=new Float32Array(n),gy=new Float32Array(n),basin=new Float32Array(n);
  const floor=profile.rockyCoasts?seaLevel:baseHeight;
  const minerals=profile.mineral===true,elevated=profile.elevatedCover||[0,30,0];
  for (let y=0;y<grid;y++) {
    for (let x=0;x<grid;x++) {
      const i=y*grid+x,h=height[i],l=height[y*grid+Math.max(0,x-1)],r=height[y*grid+Math.min(grid-1,x+1)],
        u=height[Math.max(0,y-1)*grid+x],d=height[Math.min(grid-1,y+1)*grid+x];
      gx[i]=(r-l)/(2*spacing); gy[i]=(d-u)/(2*spacing);
      const slope=Math.sqrt(gx[i]*gx[i]+gy[i]*gy[i]);
      let cover=smooth(profile.transportSlopeStart??(minerals ? .07 : .60),profile.transportSlopeFull??(minerals ? .55 : 1.35),slope);
      if (minerals) {
        const raised=smooth(baseHeight+elevated[0],baseHeight+elevated[1],h);
        cover=cover*(1-elevated[2])+Math.max(Math.min(cover,.28),raised)*elevated[2];
      }
      // Ordinary low banks do not become sources of dry hill debris.
      cover*=smooth(floor+.3,floor+(profile.rockyCoasts?3:6),h);
      source[i]=cover;
      // Concave resting places favour fine ground cover between exposed ribs.
      basin[i]=smooth(.005,.12,(l+r+u+d-4*h)/(spacing*spacing));
    }
  }
  return {source,gx,gy,basin,spacing,n};
}

// Three running box means approximate one Gaussian of the given sigma.
function boxBlur(input,grid,sigma) {
  const radius=Math.max(1,Math.round((Math.sqrt(4*sigma*sigma+1)-1)/2)),width=2*radius+1,last=grid-1;
  let a=Float32Array.from(input),b=new Float32Array(input.length);
  for (let pass=0;pass<3;pass++) for (let axis=0;axis<2;axis++) {
    const along=axis?grid:1,across=axis?1:grid;
    for (let line=0;line<grid;line++) {
      const o=line*across;
      let sum=0; for (let k=-radius;k<=radius;k++) sum+=a[o+(k<0?0:k>last?last:k)*along];
      for (let k=0;k<grid;k++) {
        b[o+k*along]=sum/width;
        const add=k+radius+1,drop=k-radius;
        sum+=a[o+(add>last?last:add)*along]-a[o+(drop<0?0:drop)*along];
      }
    }
    [a,b]=[b,a];
  }
  return a;
}
// Cluster noise depends only on position and seed; reuse it between edits.
let clusterCache=null;
function clusterField(grid,spacing,seed) {
  if (clusterCache?.grid===grid && clusterCache.seed===seed) return clusterCache.field;
  const field=new Float32Array(grid*grid);
  for (let y=0;y<grid;y++) for (let x=0;x<grid;x++) { const wx=x*spacing,wy=y*spacing; field[y*grid+x]=.65*noise(wx/31,wy/31,seed^0x941a)+.35*noise(wx/11,wy/11,seed^0x4b79); }
  clusterCache={grid,seed,field}; return field;
}

// A fast stand-in for weatherMaterials while a shape is being edited: the
// same sources and soft cover, with arrivals approximated by spreading the
// sources downhill-agnostically over the deposit reach. Rough, but it keeps
// a biome's exposed material in place instead of dropping it mid-edit.
export function quickMaterialField(request) {
  const {height,grid,seed=1,seaLevel=0}=request,spread=clamp(request.depositSpread??.65,0,1);
  const {source,basin,spacing,n}=materialSources(request);
  const soft=boxBlur(source,grid,(9+spread*17)/spacing);
  const reach=boxBlur(source,grid,(14+spread*30)/spacing),cluster=clusterField(grid,spacing,seed);
  const field=new Float32Array(n*4);
  for (let y=0;y<grid;y++) for (let x=0;x<grid;x++) {
    const i=y*grid+x; if (height[i]<=seaLevel+.2) continue;
    const clusters=cluster[i];
    field[i*4]=1-Math.exp(-reach[i]*(1-source[i]*.5));
    field[i*4+1]=clamp(((1-source[i])*.22+basin[i]*.6)*(.35+clusters*1.1),0,1);
    field[i*4+2]=soft[i];
    field[i*4+3]=source[i];
  }
  return field;
}

export async function weatherMaterials(request, pause) {
  const {height,grid,size,seed=1,baseHeight=24,seaLevel=0}=request;
  const profile=request.materialProfile||{},spread=clamp(request.depositSpread??.65,0,1);
  const n=height.length;
  const deposits=new Float32Array(n),flow=new Float32Array(n);
  let deadline=performance.now()+10;
  async function checkpoint() {
    if (performance.now()<deadline) return false;
    const cancelled=await pause(); deadline=performance.now()+10; return cancelled;
  }
  const {source,gx,gy,basin,spacing}=materialSources(request);
  if (await checkpoint()) return null;
  function sample(a,x,y) {
    x=clamp(x,0,grid-1.001); y=clamp(y,0,grid-1.001);
    const xx=Math.floor(x),yy=Math.floor(y),fx=x-xx,fy=y-yy,i=yy*grid+xx;
    return (a[i]*(1-fx)+a[i+1]*fx)*(1-fy)+(a[i+grid]*(1-fx)+a[i+grid+1]*fx)*fy;
  }
  function scatter(a,x,y,value) {
    const xx=Math.floor(x),yy=Math.floor(y),fx=x-xx,fy=y-yy,i=yy*grid+xx;
    a[i]+=value*(1-fx)*(1-fy); a[i+1]+=value*fx*(1-fy);
    a[i+grid]+=value*(1-fx)*fy; a[i+grid+1]+=value*fx*fy;
  }
  async function blur(input,sigmaWorld) {
    const sigma=Math.max(.6,sigmaWorld/spacing),radius=Math.ceil(sigma*2.5),kernel=[];
    let total=0;
    for(let k=-radius;k<=radius;k++){const w=Math.exp(-.5*(k/sigma)**2);kernel.push(w);total+=w;}
    const temp=new Float32Array(n),out=new Float32Array(n);
    for(let axis=0;axis<2;axis++) {
      const from=axis?temp:input,to=axis?out:temp;
      for(let y=0;y<grid;y++) {
        for(let x=0;x<grid;x++) {
          let v=0;
          for(let k=-radius;k<=radius;k++) v+=from[axis?clamp(y+k,0,grid-1)*grid+x:y*grid+clamp(x+k,0,grid-1)]*kernel[k+radius];
          to[y*grid+x]=v/total;
        }
        if ((y&7)===7 && await checkpoint()) return null;
      }
    }
    return out;
  }
  // Seeded world-space rain carries a material tracer downhill. Momentum lets
  // it spread across a foot before settling; no protected grade is displaced.
  let rng=(seed^0x4e91ad7b)>>>0||1;
  const random=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return(rng>>>0)/4294967296;};
  const count=Math.round(n*.52),step=2.5/spacing,reach=28+spread*85;
  for(let drop=0;drop<count;drop++) {
    let x=random()*(grid-2)+.5,y=random()*(grid-2)+.5;
    const start=sample(source,x,y),sx=sample(gx,x,y),sy=sample(gy,x,y),slope=Math.hypot(sx,sy);
    const ticket=random();
    if(start<.04 || slope<.04 || ticket>start) continue;
    let dx=-sx/slope,dy=-sy/slope,mass=.35+start*.65,travel=0;
    for(let life=0;life<90 && mass>.006;life++) {
      const h=sample(height,x,y),xx=sample(gx,x,y),yy=sample(gy,x,y),grade=Math.hypot(xx,yy);
      if(h<=seaLevel+.2) break;
      if(grade>.018) {dx=dx*.78-xx/Math.max(.08,grade)*.22;dy=dy*.78-yy/Math.max(.08,grade)*.22;}
      const bend=(noise(x*spacing/23,y*spacing/23,seed^0x6173)-.5)*.20;
      const vx=dx-dy*bend,vy=dy+dx*bend,norm=Math.hypot(vx,vy);
      dx=vx/norm;dy=vy/norm;
      const nx=x+dx*step,ny=y+dy*step;
      if(nx<0||ny<0||nx>=grid-1||ny>=grid-1) break;
      const next=sample(height,nx,ny),rise=next-h;
      if(rise>.65) {scatter(deposits,x,y,mass);break;}
      scatter(flow,x,y,start*.12);
      const settling=.012+.17*(1-smooth(.03,.55,grade))+.06*smooth(reach*.4,reach,travel);
      const put=mass*settling; scatter(deposits,x,y,put);mass-=put;
      x=nx;y=ny;travel+=2.5;
      if(travel>reach || life===89) {scatter(deposits,x,y,mass);break;}
    }
    if((drop&255)===255 && await checkpoint()) return null;
  }
  const soft=await blur(source,9+spread*17); if(!soft)return null;
  const settled=await blur(deposits,2.6); if(!settled)return null;
  const broad=await blur(deposits,9); if(!broad)return null;
  const runoff=await blur(flow,3.5); if(!runoff)return null;
  const field=new Float32Array(n*4);
  for(let y=0;y<grid;y++) {
    for(let x=0;x<grid;x++) {
      const i=y*grid+x,h=height[i],wx=x*spacing,wy=y*spacing;
      if(h<=seaLevel+.2)continue;
      const clusters=.65*noise(wx/31,wy/31,seed^0x941a)+.35*noise(wx/11,wy/11,seed^0x4b79);
      const arrival=1-Math.exp(-(settled[i]*.75+broad[i]*.25)*2.8);
      const soil=(1-source[i])*.22+basin[i]*.6+runoff[i]/(runoff[i]+3)*.26;
      field[i*4]=arrival;
      field[i*4+1]=clamp(soil*(.35+clusters*1.1),0,1);
      field[i*4+2]=soft[i];
      field[i*4+3]=source[i];
    }
    if((y&15)===15 && await checkpoint())return null;
  }
  return field;
}
