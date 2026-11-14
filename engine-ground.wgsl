// Pool-periodic ground generator. Output is height, ramp position, tone, line.
// No light enters this pass. The solid lights the height after the chunk bake.
/*COMMON*/
var<private> graphPeriod:f32;
fn graphPos(p:vec2f)->vec2f{return poolWrap(p,graphPeriod);}
fn graphPixel(p:vec2f)->vec2f{return poolWrap(floor(p),graphPeriod);}
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
fn groundNoiseCount(p:vec2f,n:f32,salt:f32)->f32{return wrapNoise(graphPos(p)*(n/graphPeriod)+salt,n);}
fn groundNoise(p:vec2f,size:f32,salt:f32)->f32{
 let count=max(1.0,graphPeriod/max(1.0,size));let n=exp2(floor(log2(count)));
 return mix(groundNoiseCount(p,n,salt),groundNoiseCount(p,n*2.0,salt),fract(log2(count)));
}
// Integer torus shears keep directional grain periodic. Orientation blends
// neighboring fields instead of rotating coordinates off the pool lattice.
fn groundGrainCount(p:vec2f,n:vec2f,salt:f32)->f32 {
 let q=graphPos(p)/graphPeriod*n+salt;let c=floor(q);let f=fract(q);let fade=f*f*(3.0-2.0*f);
 let a=c-floor(c/n)*n;let b=c+vec2f(1,0);let d=c+vec2f(0,1);let e=c+vec2f(1,1);
 return mix(mix(cellHash(a).x,cellHash(b-floor(b/n)*n).x,fade.x),mix(cellHash(d-floor(d/n)*n).x,cellHash(e-floor(e/n)*n).x,fade.x),fade.y)*2.0-1.0;
}
fn groundGrainAxis(p:vec2f,size:f32,stretch:f32,axis:u32,salt:f32)->f32 {
 var q=p;switch(axis%4u){case 1u:{q=vec2f(p.x,p.y-p.x);}case 2u:{q=p.yx;}case 3u:{q=vec2f(p.y,p.x+p.y);}default:{}}
 let count=max(vec2f(1),vec2f(graphPeriod)/vec2f(size*stretch,size));let n=exp2(floor(log2(count)));let f=fract(log2(count));
 return mix(mix(groundGrainCount(q,n,salt),groundGrainCount(q,n*vec2f(2,1),salt),f.x),mix(groundGrainCount(q,n*vec2f(1,2),salt),groundGrainCount(q,n*2.0,salt),f.x),f.y);
}
fn groundGrain(p:vec2f,size:f32,salt:f32)->f32 {
 let r=layerRecipe;let plain=groundNoise(p,size,salt);
 if(r.grainStretch<=1.0){return plain;}
 let angle=r.grainDirection/45.0;let axis=u32(floor(angle));
 let directed=mix(groundGrainAxis(p,size,r.grainStretch,axis,salt),groundGrainAxis(p,size,r.grainStretch,axis+1u,salt),fract(angle));
 return mix(plain,directed,1.0-exp(-(r.grainStretch-1.0)));
}
fn groundPlateCount(p:vec2f,n:f32)->vec4f {
 let r=layerRecipe;let size=graphPeriod/n;
 let cell=groundCell(graphPos(p)/size,n,3.7,r.plateVariation);
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
  let small=groundCell(graphPos(p)/size*3.0+.37,n*3.0,9.1,r.plateVariation);
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
 let q=graphPos(p)/graphPeriod*counts;let cell=floor(q);var value=0.0;
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
 let count=max(vec2f(1),vec2f(graphPeriod)/vec2f(size*stretch,size));let n=exp2(floor(log2(count)));let f=fract(log2(count));
 return mix(mix(groundBumpCount(p,n),groundBumpCount(p,n*vec2f(2,1)),f.x),mix(groundBumpCount(p,n*vec2f(1,2)),groundBumpCount(p,n*2.0),f.x),f.y);
}
// Connected scratch lanes ported from mmScratchLanes; the solid supplies normals.
fn groundScratchCount(p:vec2f,count:f32,length:f32,width:f32,salt:f32)->f32 {
 let size=graphPeriod/count;let x=p.x/size;let cell=floor(x);var total=0.0;
 for(var j=-1;j<=1;j++){
  let lane=cell+f32(j);let wrapped=lane-floor(lane/count)*count;let character=cellHash(vec2f(wrapped,0)+salt).x;
  let wave=groundNoise(vec2f((wrapped+.5)*size,p.y),max(length*(.7+.6*character),4.0),salt);
  let distance=(x-lane-.5-.24*(character-.5)-.45*wave)*size;
  let radius=min(.5+.5*width,.9*size);let f=max(1.0-distance*distance/(radius*radius),0.0);
  let cover=min(width,1.0)*f*f*f;total+=cover*(1.0-total);
 }return total;
}
fn groundScratches(p:vec2f)->f32 {
 let r=layerRecipe;let count=max(1.0,graphPeriod/r.scratchSpacing);let n=exp2(floor(log2(count)));let f=fract(log2(count));
 let q=graphPos(p);let a=mix(groundScratchCount(q,n,r.scratchLength,r.scratchWidth,63.0),groundScratchCount(q,n*2.0,r.scratchLength,r.scratchWidth,63.0),f);
 let shear=vec2f(q.x+q.y,q.y);let b=mix(groundScratchCount(shear,n,r.scratchLength,r.scratchWidth,79.0),groundScratchCount(shear,n*2.0,r.scratchLength,r.scratchWidth,79.0),f);
 let gate=smoothstep(-.4,.4,groundNoise(q,r.scratchLength*2.0,94.0));
 return mix(a*.7,max(a,b),r.scratchConnect)*mix(gate,1.0,r.scratchConnect);
}
fn groundPebbleCount(p:vec2f,n:f32,roundness:f32)->f32 {
 let c=groundCell(graphPos(p)/graphPeriod*n,n,151.0,1.0);
 let radius=.24+.18*cellHash(c.id+157.0).x;
 let d=c.radius/radius;let dome=sqrt(max(0.0,1.0-d*d));let pointed=max(0.0,1.0-d);
 return mix(pointed,dome,roundness)*(.6+.4*cellHash(c.id+163.0).y);
}
fn groundPebbles(p:vec2f,size:f32,roundness:f32)->f32 {
 let count=max(1.0,graphPeriod/size);let n=exp2(floor(log2(count)));
 return mix(groundPebbleCount(p,n,roundness),groundPebbleCount(p,n*2.0,roundness),fract(log2(count)));
}
fn groundVeinCount(p:vec2f,n:f32,width:f32)->f32 {
 let c=groundCell(graphPos(p)/graphPeriod*n,n,173.0,1.0);let edge=c.edge*graphPeriod/n;
 return (1.0-smoothstep(max(0.0,width-.5),width+.5,edge))*min(width,1.0);
}
fn groundVeins(p:vec2f,size:f32,width:f32)->f32 {
 let count=max(1.0,graphPeriod/size);let n=exp2(floor(log2(count)));
 return mix(groundVeinCount(p,n,width),groundVeinCount(p,n*2.0,width),fract(log2(count)));
}
fn groundRippleCount(p:vec2f,n:f32,asymmetry:f32)->f32 {
 let phase=6.2831853*(graphPos(p).x/graphPeriod*n+.15*groundNoise(p,48.0,181.0));
 return (sin(phase)+.4*asymmetry*sin(phase*2.0))/(1.0+.4*asymmetry);
}
fn groundRipples(p:vec2f,size:f32,asymmetry:f32)->f32 {
 let count=max(1.0,graphPeriod/size);let n=exp2(floor(log2(count)));
 return mix(groundRippleCount(p,n,asymmetry),groundRippleCount(p,n*2.0,asymmetry),fract(log2(count)));
}
var<private> layerRecipe:Ground;
/*TEXTURE_PATTERN*/
fn groundRecipe(p:vec2f)->vec4f {
 let r=layerRecipe;var out=vec4f(0,.5,0,0);
 if(r.plateAmount>0.0){
  let count=max(1.0,graphPeriod/r.plateSize);let n=exp2(floor(log2(count)));
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
// Match the truncating half-float material-field storage used by the renderer.
// Keep this precision boundary before color mapping, not on the final RGB.
fn sampledHalf(v:vec2f)->vec2f {
 let bits=pack2x16float(v);let rounded=unpack2x16float(bits);
 let low=(bits&65535u)-select(0u,1u,abs(rounded.x)>abs(v.x));
 let high=(bits>>16u)-select(0u,1u,abs(rounded.y)>abs(v.y));
 return unpack2x16float(low|(high<<16u));
}
fn stepArg(s:MaterialStep,index:u32)->f32 {return s.args[index/4u][index%4u];}
fn stepColor(s:MaterialStep,index:u32)->vec3f {let n=2u+index*3u;return vec3f(stepArg(s,n),stepArg(s,n+1u),stepArg(s,n+2u));}
// Scalar and RGB operations share their arithmetic. A scalar is broadcast to
// all components; coloring is explicit and never selected by a preset name.
fn stepConstant(s:MaterialStep)->vec4f {
 let x=stepArg(s,0u);
return vec4f(x);
}

fn stepRemap(s:MaterialStep,a:vec4f)->vec4f {
 let x=stepArg(s,0u);

   var v=pow(smoothstep(x,stepArg(s,1u),clamp(a.x,0.0,1.0)),stepArg(s,2u));
   v=mix(v,1.0-v,stepArg(s,3u));v=mix(v,step(.5,v),stepArg(s,4u));v=mix(v,.5-.5*cos(v*6.2831853*stepArg(s,6u)),stepArg(s,5u));return vec4f(v);

}

fn stepCombine(s:MaterialStep,a:vec4f,b:vec4f,c:vec4f)->vec4f {
 let x=stepArg(s,0u);

   let v=b-vec4f(stepArg(s,1u));let w=x*c.x;
   switch(s.code.w){
    case 0:{return mix(a,v,w);}case 1:{return a+v*w;}case 2:{return a*mix(vec4f(1),v,w);}
    case 3:{return a-v*w;}case 4:{return mix(a,min(a,v),w);}case 5:{return mix(a,max(a,v),w);}
    case 7:{return mix(a,1.0-(1.0-a)*(1.0-v),w);}default:{return mix(a,v,w);}
   }

}

fn stepGradient(s:MaterialStep,a:vec4f)->vec4f {
 let x=stepArg(s,0u);

   let n=u32(stepArg(s,1u));let t=a.x;var rgb=vec3f(0);
   if(n==3u){let lo=mix(clamp(t*2.0,0.0,1.0),smoothstep(0.0,.5,t),x);let hi=mix(clamp((t-.5)*2.0,0.0,1.0),smoothstep(.5,1.0,t),x);rgb=mix(mix(stepColor(s,0u),stepColor(s,1u),lo),stepColor(s,2u),hi);}
   else if(n==2u){rgb=mix(stepColor(s,0u),stepColor(s,1u),mix(t,smoothstep(0.0,1.0,t),x));}
   else{let t2=clamp(t,0.0,1.0)*f32(n-1u);let i=u32(floor(t2));rgb=mix(stepColor(s,i),stepColor(s,min(i+1u,n-1u)),mix(fract(t2),smoothstep(0.0,1.0,fract(t2)),x));}
   return vec4f(rgb,1);

}

fn stepChannel(s:MaterialStep,a:vec4f)->vec4f {
 let x=stepArg(s,0u);
return vec4f(a[u32(x)]);
}

fn stepHash(s:MaterialStep,p:vec2f)->vec4f {
 let x=stepArg(s,0u);
return vec4f(cellHash(graphPixel(p)+vec2f(211.0,317.0)).x);
}

fn stepOutput(s:MaterialStep,a:vec4f)->vec4f {
 let x=stepArg(s,0u);
return a*x+vec4f(stepArg(s,1u));
}

@group(1) @binding(0) var groundOut:texture_storage_2d_array<rgba32float,write>;
@group(1) @binding(2) var maskOut:texture_storage_2d_array<rgba16float,write>;
@group(1) @binding(1) var<uniform> groundJob:vec4u;
// The compiler calls only the operations present in the graph. Keeping unrelated
// surface primitives out of the reachable shader also avoids Metal optimizer
// failures from a large switch containing every possible generator.
fn stepTransform(s:MaterialStep,a:vec4f,point:vec2f)->vec4f {
 var v=vec4f(0);let q=select(point,a.xy,s.links.x>=0);
layerRecipe.patternWarp=stepArg(s,0u);layerRecipe.patternWarpSize=stepArg(s,1u);layerRecipe.phaseOctaves=stepArg(s,2u);layerRecipe.phaseAxis=stepArg(s,3u);let r=layerRecipe;v=vec4f(q+texturePhase(q,r.patternWarpSize,r.phaseOctaves)*vec2f(1.0-max(r.phaseAxis,0.0),1.0+min(r.phaseAxis,0.0))*r.patternWarp,0,0);
 return v;
}

fn stepNoise(s:MaterialStep,a:vec4f,point:vec2f)->vec4f {
 var v=vec4f(0);let q=select(point,a.xy,s.links.x>=0);
layerRecipe.patternSize=stepArg(s,0u);layerRecipe.patternDetail=stepArg(s,1u);layerRecipe.patternGradient=stepArg(s,2u);layerRecipe.patternLinear=stepArg(s,3u);layerRecipe.patternTurbulence=stepArg(s,4u);layerRecipe.patternCells=stepArg(s,5u);layerRecipe.patternStreak=stepArg(s,6u);layerRecipe.patternLength=stepArg(s,7u);layerRecipe.patternDirection=stepArg(s,8u);layerRecipe.patternSlope=stepArg(s,9u);layerRecipe.patternOctaves=stepArg(s,10u);layerRecipe.patternMottle=stepArg(s,11u);layerRecipe.patternMottleSize=stepArg(s,12u);let r=layerRecipe;let aa=textureOctaves(q,r.patternSize,r.patternOctaves);let bb=textureOctaves(q+vec2f(17,39),r.patternSize/2.0,r.patternOctaves);v=vec4f(mix(mix(aa,bb,r.patternDetail),.5+.5*groundNoise(point,r.patternMottleSize,827.0),r.patternMottle));
 return v;
}

fn stepFine(s:MaterialStep,a:vec4f,point:vec2f)->vec4f {
 var v=vec4f(0);let q=select(point,a.xy,s.links.x>=0);
layerRecipe.textureFineSize=stepArg(s,0u);layerRecipe.textureFineGradient=stepArg(s,1u);layerRecipe.textureFineWarp=stepArg(s,2u);let r=layerRecipe;let fpoint=mix(point,q,r.textureFineWarp)+vec2f(61,97);v=vec4f(mix(.5+.5*groundNoise(fpoint,r.textureFineSize,379.0),.5+.65*textureGradient(fpoint,r.textureFineSize,379.0),r.textureFineGradient));
 return v;
}

fn stepDots(s:MaterialStep,a:vec4f,point:vec2f)->vec4f {
 var v=vec4f(0);let q=select(point,a.xy,s.links.x>=0);
layerRecipe.markAmount=stepArg(s,0u);layerRecipe.markSize=stepArg(s,1u);layerRecipe.markSpacing=stepArg(s,2u);layerRecipe.markDensity=stepArg(s,3u);layerRecipe.markScatter=stepArg(s,4u);layerRecipe.markCore=stepArg(s,5u);layerRecipe.markVariation=stepArg(s,6u);layerRecipe.markFollow=stepArg(s,7u);layerRecipe.markNoise=stepArg(s,8u);layerRecipe.markNoiseSize=stepArg(s,9u);layerRecipe.markLow=stepArg(s,10u);layerRecipe.markHigh=stepArg(s,11u);let r=layerRecipe;v=vec4f(clamp(textureMarks(point)*r.markAmount*mix(1.0,2.0*smoothstep(.2,.8,a.x),r.markFollow),0.0,1.0));
 return v;
}

fn stepSurface(s:MaterialStep,a:vec4f,point:vec2f)->vec4f {
 var v=vec4f(0);let q=select(point,a.xy,s.links.x>=0);
v=groundRecipe(point);
 return v;
}
@compute @workgroup_size(8,8)
fn groundMain(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(groundOut))){return;}
 graphPeriod=f32(textureDimensions(groundOut).x);
 gs=groundJob.x;let graph=materialGraphs[groundJob.z];
 let point=vec2f(id.xy);
 /*MATERIAL_PROGRAM*/
 textureStore(groundOut,vec2i(id.xy),i32(groundJob.y),vec4f(color,height));
 textureStore(maskOut,vec2i(id.xy),i32(groundJob.y),vec4f(finish,1));
}
