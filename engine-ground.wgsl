// Pool-periodic ground generator. Output is height, ramp position, tone, line.
// No light enters this pass. The solid lights the height after the chunk bake.
/*COMMON*/
struct GroundCell { radius:f32, edge:f32, id:vec2f, other:vec2f, offset:vec2f }
// Ported from prototype/ground-spike's poolCellAt: neighbors wrap their IDs,
// while distances stay local so the pool boundary is an ordinary cell border.
fn groundCell(q:vec2f,n:f32,salt:f32,variation:f32)->GroundCell {
 let g=floor(q);let f=q-g;var mr=vec2f(0);var mb=vec2f(0);var md=8.0;
 for(var j=-1;j<=1;j++){for(var i=-1;i<=1;i++){
  let b=vec2f(f32(i),f32(j));let r=b+.5+(cellHash(poolWrap(g+b,n)+salt)-.5)*.8*variation-f;
  let d=dot(r,r);if(d<md){md=d;mr=r;mb=b;}
 }}
 var edge=8.0;var other=vec2f(0);
 for(var j=-2;j<=2;j++){for(var i=-2;i<=2;i++){
  let b=mb+vec2f(f32(i),f32(j));let r=b+.5+(cellHash(poolWrap(g+b,n)+salt)-.5)*.8*variation-f;let dr=r-mr;
  if(dot(dr,dr)>1e-6){let e=dot(.5*(mr+r),normalize(dr));if(e<edge){edge=e;other=poolWrap(g+b,n);}}
 }}
 return GroundCell(sqrt(md),edge,poolWrap(g+mb,n),other,-mr);
}
fn groundBorder(a:vec2f,b:vec2f)->f32{return cellHash(a+b+.37*a*b+5.1).x;}
fn groundNoiseCount(p:vec2f,n:f32,salt:f32)->f32{return wrapNoise(poolPos(p)*(n/u.pool)+salt,n);}
fn groundNoise(p:vec2f,size:f32,salt:f32)->f32{
 let count=max(1.0,u.pool/max(1.0,size));let n=exp2(floor(log2(count)));
 return mix(groundNoiseCount(p,n,salt),groundNoiseCount(p,n*2.0,salt),fract(log2(count)));
}
// Integer torus shears keep directional grain periodic. Orientation blends
// neighboring fields instead of rotating coordinates off the pool lattice.
fn groundGrainCount(p:vec2f,n:vec2f,salt:f32)->f32 {
 let q=poolPos(p)/u.pool*n+salt;let c=floor(q);let f=fract(q);let fade=f*f*(3.0-2.0*f);
 let a=c-floor(c/n)*n;let b=c+vec2f(1,0);let d=c+vec2f(0,1);let e=c+vec2f(1,1);
 return mix(mix(cellHash(a).x,cellHash(b-floor(b/n)*n).x,fade.x),mix(cellHash(d-floor(d/n)*n).x,cellHash(e-floor(e/n)*n).x,fade.x),fade.y)*2.0-1.0;
}
fn groundGrainAxis(p:vec2f,size:f32,stretch:f32,axis:u32,salt:f32)->f32 {
 var q=p;switch(axis%4u){case 1u:{q=vec2f(p.x,p.y-p.x);}case 2u:{q=p.yx;}case 3u:{q=vec2f(p.y,p.x+p.y);}default:{}}
 let count=max(vec2f(1),vec2f(u.pool)/vec2f(size*stretch,size));let n=exp2(floor(log2(count)));let f=fract(log2(count));
 return mix(mix(groundGrainCount(q,n,salt),groundGrainCount(q,n*vec2f(2,1),salt),f.x),mix(groundGrainCount(q,n*vec2f(1,2),salt),groundGrainCount(q,n*2.0,salt),f.x),f.y);
}
fn groundGrain(p:vec2f,size:f32,salt:f32)->f32 {
 let r=u.ground[gs & groundMask];let plain=groundNoise(p,size,salt);
 if(r.grainStretch<=1.0){return plain;}
 let angle=r.grainDirection/45.0;let axis=u32(floor(angle));
 let directed=mix(groundGrainAxis(p,size,r.grainStretch,axis,salt),groundGrainAxis(p,size,r.grainStretch,axis+1u,salt),fract(angle));
 return mix(plain,directed,1.0-exp(-(r.grainStretch-1.0)));
}
fn groundPlateCount(p:vec2f,n:f32)->vec4f {
 let r=u.ground[gs & groundMask];let size=u.pool/n;
 let cell=groundCell(poolPos(p)/size,n,3.7,r.plateVariation);
 let e=cell.edge*size;let hash=cellHash(cell.id+11.3);let gape=groundBorder(cell.id,cell.other);
 let width=r.crackWidth*(.35+.65*gape);
 let line=(1.0-smoothstep(max(0.0,width-.5),width+.5,e))*min(width,1.0);
 let rim=pow(1.0-smoothstep(width,width+size*.15,e),2.0);
 let profile=(1.0-smoothstep(0.0,size*.45,cell.radius*size))*r.plateProfile;
 let border=(1.0-smoothstep(0.0,width+2.2,e))*r.borderProfile;
 var height=profile+border*.5+rim*r.rimCurl;
 height+=dot(cellHash(cell.id+5.5)-.5,cell.offset)*r.plateTilt;
 var crack=line;
 if(r.secondaryCracks>0.0){
  let small=groundCell(poolPos(p)/size*3.0+.37,n*3.0,9.1,r.plateVariation);
  let e2=small.edge*size/3.0;
  let open=r.secondaryCracks*smoothstep(width+1.0,width+4.0,e)*(1.0-smoothstep(.35,.85,groundBorder(small.id,small.other)));
  let seam=1.0-smoothstep(.1,.9,e2);height-=open*seam*.25;crack=max(crack,open*seam);
 }
 return vec4f(height,profile*.15,(hash.x-.5)*2.0,crack);
}
// Rounded compact bumps ported from mmBumpField (base-material-editor).
// Blend adjacent octave lattices on both axes. Neighboring integer counts
// churned too much of the picture during a small size or stretch step.
fn groundBumpCount(p:vec2f,counts:vec2f)->f32 {
 let q=poolPos(p)/u.pool*counts;let cell=floor(q);var value=0.0;
 for(var j=-1;j<=1;j++){for(var i=-1;i<=1;i++){
  let c=cell+vec2f(f32(i),f32(j));let id=c-floor(c/counts)*counts;
  let h=cellHash(id+17.1);let point=c+.15+.7*h;let d=q-point;
  let major=.75+.25*cellHash(id+23.0).x;let minor=.45+.35*cellHash(id+31.0).y;
  let angle=6.2831853*cellHash(id+51.0).x;let axis=vec2f(cos(angle),sin(angle));
  let local=vec2f(dot(d,axis),dot(d,vec2f(-axis.y,axis.x)))/vec2f(major,minor);
  let f=max(1.0-dot(local,local),0.0);value+=(.45+1.1*h.y)*f*f*f;
 }}return value;
}
fn groundBumps(p:vec2f,size:f32,stretch:f32)->f32 {
 let count=max(vec2f(1),vec2f(u.pool)/vec2f(size*stretch,size));let n=exp2(floor(log2(count)));let f=fract(log2(count));
 return mix(mix(groundBumpCount(p,n),groundBumpCount(p,n*vec2f(2,1)),f.x),mix(groundBumpCount(p,n*vec2f(1,2)),groundBumpCount(p,n*2.0),f.x),f.y);
}
// Connected scratch lanes ported from mmScratchLanes; the solid supplies normals.
fn groundScratchCount(p:vec2f,count:f32,length:f32,width:f32,salt:f32)->f32 {
 let size=u.pool/count;let x=p.x/size;let cell=floor(x);var total=0.0;
 for(var j=-1;j<=1;j++){
  let lane=cell+f32(j);let wrapped=lane-floor(lane/count)*count;let character=cellHash(vec2f(wrapped,0)+salt).x;
  let wave=groundNoise(vec2f((wrapped+.5)*size,p.y),max(length*(.7+.6*character),4.0),salt);
  let distance=(x-lane-.5-.24*(character-.5)-.45*wave)*size;
  let radius=min(.5+.5*width,.9*size);let f=max(1.0-distance*distance/(radius*radius),0.0);
  let cover=min(width,1.0)*f*f*f;total+=cover*(1.0-total);
 }return total;
}
fn groundScratches(p:vec2f)->f32 {
 let r=u.ground[gs & groundMask];let count=max(1.0,u.pool/r.scratchSpacing);let n=exp2(floor(log2(count)));let f=fract(log2(count));
 let q=poolPos(p);let a=mix(groundScratchCount(q,n,r.scratchLength,r.scratchWidth,63.0),groundScratchCount(q,n*2.0,r.scratchLength,r.scratchWidth,63.0),f);
 let shear=vec2f(q.x+q.y,q.y);let b=mix(groundScratchCount(shear,n,r.scratchLength,r.scratchWidth,79.0),groundScratchCount(shear,n*2.0,r.scratchLength,r.scratchWidth,79.0),f);
 let gate=smoothstep(-.4,.4,groundNoise(q,r.scratchLength*2.0,94.0));
 return mix(a*.7,max(a,b),r.scratchConnect)*mix(gate,1.0,r.scratchConnect);
}
fn groundPebbleCount(p:vec2f,n:f32,roundness:f32)->f32 {
 let c=groundCell(poolPos(p)/u.pool*n,n,151.0,1.0);
 let radius=.24+.18*cellHash(c.id+157.0).x;
 let d=c.radius/radius;let dome=sqrt(max(0.0,1.0-d*d));let pointed=max(0.0,1.0-d);
 return mix(pointed,dome,roundness)*(.6+.4*cellHash(c.id+163.0).y);
}
fn groundPebbles(p:vec2f,size:f32,roundness:f32)->f32 {
 let count=max(1.0,u.pool/size);let n=exp2(floor(log2(count)));
 return mix(groundPebbleCount(p,n,roundness),groundPebbleCount(p,n*2.0,roundness),fract(log2(count)));
}
fn groundVeinCount(p:vec2f,n:f32,width:f32)->f32 {
 let c=groundCell(poolPos(p)/u.pool*n,n,173.0,1.0);let edge=c.edge*u.pool/n;
 return (1.0-smoothstep(max(0.0,width-.5),width+.5,edge))*min(width,1.0);
}
fn groundVeins(p:vec2f,size:f32,width:f32)->f32 {
 let count=max(1.0,u.pool/size);let n=exp2(floor(log2(count)));
 return mix(groundVeinCount(p,n,width),groundVeinCount(p,n*2.0,width),fract(log2(count)));
}
fn groundRippleCount(p:vec2f,n:f32,asymmetry:f32)->f32 {
 let phase=6.2831853*(poolPos(p).x/u.pool*n+.15*groundNoise(p,48.0,181.0));
 return (sin(phase)+.4*asymmetry*sin(phase*2.0))/(1.0+.4*asymmetry);
}
fn groundRipples(p:vec2f,size:f32,asymmetry:f32)->f32 {
 let count=max(1.0,u.pool/size);let n=exp2(floor(log2(count)));
 return mix(groundRippleCount(p,n,asymmetry),groundRippleCount(p,n*2.0,asymmetry),fract(log2(count)));
}
/*TEXTURE_PATTERN*/
fn groundRecipe(p:vec2f)->vec4f {
 let r=u.ground[gs & groundMask];var out=vec4f(0,.5,0,0);
 if(r.plateAmount>0.0){
  let count=max(1.0,u.pool/r.plateSize);let n=exp2(floor(log2(count)));
  let plates=mix(groundPlateCount(p,n),groundPlateCount(p,n*2.0),fract(log2(count)));
  out.x=plates.x*r.plateAmount;out.y+=plates.y*min(r.plateAmount,1.0);out.z=plates.z*r.toneVariation;out.w=plates.w*min(r.plateAmount,1.0)*r.lineStrength;
 }
 if(r.bumpAmount>0.0){out.x+=(groundBumps(p,r.bumpSize,r.bumpStretch)-.35)*r.bumpAmount;}
 if(r.scratchAmount>0.0){let scratch=groundScratches(p);out.x-=scratch*r.scratchAmount;out.w=max(out.w,scratch*min(r.scratchAmount,1.0)*r.lineStrength);}
 // All three bands shape color and, with Grain relief, real art height.
 // Fine pigment and fine height use independent fields; larger color
 // patches can still follow the medium and broad forms.
 var shapedGrain=0.0;
 if(r.grainFine>0.0){let v=groundGrain(p,1.0,101.0)*r.grainFine;out.y+=v*.35;shapedGrain+=groundGrain(p,1.0,197.0)*r.grainFine;}
 if(r.grainMedium>0.0){let v=groundGrain(p,3.0,113.0)*r.grainMedium;out.y+=v*.35;shapedGrain+=v;}
 if(r.grainBroad>0.0){let v=groundGrain(p,9.0,127.0)*r.grainBroad;out.y+=v*.35;shapedGrain+=v;}
 if(r.grainRelief>0.0){out.x+=shapedGrain*r.grainRelief/max(1.0,r.grainFine+r.grainMedium+r.grainBroad);}
 if(r.veinAmount>0.0){out.w=max(out.w,groundVeins(p,r.veinSpacing,r.veinWidth)*r.veinAmount*r.lineStrength);}
 if(r.pebbleAmount>0.0){let h=groundPebbles(p,r.pebbleSize,r.pebbleRound);out.x+=h*r.pebbleAmount;out.y+=h*.15*min(r.pebbleAmount,1.0);}
 if(r.cushionAmount>0.0){let h=1.0-exp(-groundBumps(p,r.cushionSize,1.0)*2.0);out.x+=h*r.cushionAmount;out.y+=h*.1*min(r.cushionAmount,1.0);}
 if(r.rippleAmount>0.0){out.x+=groundRipples(p,r.rippleSize,r.rippleAsymmetry)*r.rippleAmount;}
 if(r.toneVariation>0.0){out.z+=groundNoise(p,r.toneSize,191.0)*r.toneVariation*.4;}
 if(r.quietAmount>0.0){let activity=mix(1.0,smoothstep(-.55,.55,groundNoise(p,r.quietSize,137.0)),r.quietAmount);out.x*=activity;out.y=mix(.5,out.y,activity);out.w*=activity;}
 out.x=clamp(out.x,-8.0,8.0);out.y=clamp(out.y,0.0,1.0);out.w=clamp(out.w,0.0,1.0);if(r.patternAmount>0.0){let pattern=textureRecipe(p);let combined=mix(out,pattern,r.patternAmount);return vec4f(out.x+pattern.x*r.patternAmount,combined.yzw);}return out;
}
@group(1) @binding(0) var groundOut:texture_storage_2d_array<rgba16float,write>;
@group(1) @binding(1) var<uniform> groundJob:vec4u;
@compute @workgroup_size(8,8)
fn groundMain(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(groundOut))){return;}
 gs=groundJob.x;textureStore(groundOut,vec2i(id.xy),i32(groundJob.y),groundRecipe(vec2f(id.xy)));
}
