// Material graphs. One compute pass evaluates a material's node graph once per texel of its repeat and writes unlit color, art height
// and shine. Every field wraps at the repeat (graphPeriod), so the tile joins itself on all sides. No light enters this pass: the
// renderer lights the height afterwards. sculpt-materials.js compiles a graph into the straight-line calls pasted at MATERIAL_PROGRAM;
// node numbers stay in the materialGraphs buffer, so dragging a control never recompiles a pipeline.
/*COMMON*/
var<private> graphPeriod:f32;
var<private> graphRow:u32;
fn graphPos(p:vec2f)->vec2f{return poolWrap(p,graphPeriod);}
fn graphPixel(p:vec2f)->vec2f{return poolWrap(floor(p),graphPeriod);}
fn node(i:u32)->MaterialStep{return materialGraphs[graphRow].steps[i];}
fn arg(s:MaterialStep,index:u32)->f32{return s.args[index/4u][index%4u];}
// A seed moves a field's lattice or its hash: 0 is the field the node always had.
fn seeded(salt:f32,seed:f32)->f32{return salt+37.0*seed;}
// A color read by a gray input: its brightness (Rec. 709 weights), the same number in every channel.
fn graphGray(c:vec4f)->vec4f{return vec4f(dot(c.rgb,vec3f(.2126,.7152,.0722)));}

// Smooth value noise on a lattice that divides the repeat. Neighboring lattice counts blend, so a size edit stays continuous.
fn smoothCount(p:vec2f,n:f32,salt:f32)->f32{return wrapNoise(graphPos(p)*(n/graphPeriod)+salt,n);}
fn smoothNoise(p:vec2f,size:f32,salt:f32)->f32{
 let count=max(1.0,graphPeriod/max(1.0,size));let n=exp2(floor(log2(count)));
 return mix(smoothCount(p,n,salt),smoothCount(p,n*2.0,salt),fract(log2(count)));
}
fn gradientNoise(p:vec2f,size:f32,salt:f32)->f32{
 let n=max(1.0,round(graphPeriod/size));let q=graphPos(p)/graphPeriod*n;let c=floor(q);let t=fract(q);let fade=t*t*t*(t*(t*6.0-15.0)+10.0);
 var values:array<f32,4>;for(var i=0u;i<4u;i++){let off=vec2f(f32(i&1u),f32(i>>1u));let a=cellHash(poolWrap(c+off,n)+salt).x*6.2831853;values[i]=dot(vec2f(cos(a),sin(a)),t-off);}
 return mix(mix(values[0],values[1],fade.x),mix(values[2],values[3],fade.x),fade.y)*1.41421356;
}
struct GraphCell{radius:f32,edge:f32,id:vec2f}
// The nearest scattered point of a wrapped lattice and the distance to the border with its neighbor. Jitter is how far a point strays from
// its cell's middle, up to .5 of a cell each way (0 a square grid).
fn graphCell(q:vec2f,n:f32,salt:f32,jitter:f32)->GraphCell{
 let g=floor(q);let f=q-g;var mr=vec2f(0);var mb=vec2f(0);var md=8.0;
 for(var j=-1;j<=1;j++){for(var i=-1;i<=1;i++){
  let b=vec2f(f32(i),f32(j));let r=b+.5+(cellHash(poolWrap(g+b,n)+salt)-.5)*jitter-f;
  let d=dot(r,r);if(d<md){md=d;mr=r;mb=b;}
 }}
 var edge=8.0;
 for(var j=-2;j<=2;j++){for(var i=-2;i<=2;i++){
  let b=mb+vec2f(f32(i),f32(j));let r=b+.5+(cellHash(poolWrap(g+b,n)+salt)-.5)*jitter-f;let dr=r-mr;
  if(dot(dr,dr)>1e-6){edge=min(edge,dot(.5*(mr+r),normalize(dr)));}
 }}
 return GraphCell(sqrt(md),edge,poolWrap(g+mb,n));
}
// Stretched lattice noise along a direction w (x right, y down; Direction d is the line (sin d, cos d)): the lattice is turned by the integer
// matrix with rows (w.y, -w.x) and (w.x, w.y), so it still divides the repeat, and its cells are long along w. WAVE_DIRS holds the sixteen
// directions of integer vectors up to 3 long a side between 0 and 180 degrees (WAVE_ANGLES); a Direction between two blends the two, 7 to 18
// degrees apart. 0, 45, 90 and 135 are the four turns the node always had.
const WAVE_DIRS=array<vec2f,17>(vec2f(0,1),vec2f(1,3),vec2f(1,2),vec2f(2,3),vec2f(1,1),vec2f(3,2),vec2f(2,1),vec2f(3,1),vec2f(-1,0),
 vec2f(-3,1),vec2f(-2,1),vec2f(-3,2),vec2f(-1,1),vec2f(-2,3),vec2f(-1,2),vec2f(-1,3),vec2f(0,1));
const WAVE_ANGLES=array<f32,17>(0.0,18.43495,26.56505,33.69007,45.0,56.30993,63.43495,71.56505,90.0,108.43495,116.56505,123.69007,135.0,146.30993,153.43495,161.56505,180.0);
fn waveAt(p:vec2f,size:f32,ratio:f32,w:vec2f,salt:f32)->f32{
 let len=length(w);let n=max(vec2f(1),round(vec2f(graphPeriod)/(vec2f(size,size*ratio)*len)));
 let v=graphPos(p);let point=vec2f(w.y*v.x-w.x*v.y,w.x*v.x+w.y*v.y);
 let q=point/graphPeriod*n;let c=floor(q);let t=fract(q);let fade=t*t*t*(t*(t*6.0-15.0)+10.0);
 var values:array<f32,4>;for(var i=0u;i<4u;i++){let cell=c+vec2f(f32(i&1u),f32(i>>1u));values[i]=cellHash(cell-floor(cell/n)*n+salt).x;}
 return mix(mix(values[0],values[1],fade.x),mix(values[2],values[3],fade.x),fade.y);
}
fn waveBase(p:vec2f,size:f32,ratio:f32,direction:f32,salt:f32)->f32{
 let d=direction-180.0*floor(direction/180.0);var i=0u;for(var k=1u;k<16u;k++){if(d>=WAVE_ANGLES[k]){i=k;}}
 let f=(d-WAVE_ANGLES[i])/(WAVE_ANGLES[i+1u]-WAVE_ANGLES[i]);
 if(f<=0.0){return waveAt(p,size,ratio,WAVE_DIRS[i],salt);}
 return mix(waveAt(p,size,ratio,WAVE_DIRS[i],salt),waveAt(p,size,ratio,WAVE_DIRS[i+1u],salt),f);
}
// One noise type at one size, in 0 to 1. kind: 0 smooth, 1 gradient, 2 billow, 3 cells, 4 cracks, 5 facets, 6 waves. extra: jitter for the
// cell types; length over the node's size, direction and crests for waves.
fn noiseBasis(kind:i32,p:vec2f,size:f32,salt:f32,extra:vec3f)->f32{
 switch kind{
  case 1:{return clamp(.5+.65*gradientNoise(p,size,salt),0.0,1.0);}
  case 2:{return clamp(abs(gradientNoise(p,size,salt))*1.8,0.0,1.0);}
  case 3,4,5:{
   let n=max(1.0,round(graphPeriod/size));let c=graphCell(graphPos(p)/graphPeriod*n,n,salt,extra.x);
   if(kind==4){return clamp(c.edge*2.0,0.0,1.0);}
   if(kind==5){return cellHash(c.id+salt+97.0).x;}
   return clamp(1.0-c.radius,0.0,1.0);
  }
  case 6:{
   let ratio=extra.x;let angle=extra.y*.01745329252;let offset=vec2f(cos(angle),-sin(angle))*size*.35;
   let base=waveBase(p,size,ratio,extra.y,salt);
   if(extra.z<=0.0){return clamp(base,0.0,1.0);}
   let slope=.5+(waveBase(p+offset,size,ratio,extra.y,salt)-waveBase(p-offset,size,ratio,extra.y,salt))/.7;
   return clamp(mix(base,slope,extra.z),0.0,1.0);
  }
  default:{return clamp(.5+.5*smoothNoise(p,size,salt),0.0,1.0);}
 }
}
// Broad layers add the same noise at twice the size and twice the weight, a layer at a time, so the slider is continuous.
fn noiseLayers(kind:i32,p:vec2f,size:f32,layers:f32,salt:f32,wave:vec3f)->f32{
 var sum=noiseBasis(kind,p,size,salt,wave);var total=1.0;
 for(var i=1u;i<=5u;i++){let amount=clamp(layers-f32(i)+1.0,0.0,1.0);if(amount<=0.0){break;}
  let scale=exp2(f32(i));let weight=scale*amount;sum+=noiseBasis(kind,p,size*scale,salt,wave)*weight;total+=weight;}
 return sum/total;
}
// Noise: size, detail, broad layers, seed, then jitter for the cell types, or length, direction and crests for waves. Detail mixes in a
// layer at half the size.
fn nNoise(s:MaterialStep,q:vec2f)->vec4f{
 let kind=s.code.z;let size=arg(s,0u);let salt=seeded(379.0,arg(s,3u));
 let wave=select(vec3f(arg(s,4u),0,0),vec3f(arg(s,4u)/max(size,.001),arg(s,5u),arg(s,6u)),kind==6);
 let a=noiseLayers(kind,q,size,arg(s,2u),salt,wave);
 if(arg(s,1u)<=0.0){return vec4f(a);}
 return vec4f(mix(a,noiseLayers(kind,q+vec2f(17,39),size/2.0,arg(s,2u),salt,wave),arg(s,1u)));
}
// Ridged: size, detail layers, detail strength, sharpness, seed.
fn nRidged(s:MaterialStep,q:vec2f)->vec4f{
 var total=0.0;var value=0.0;let salt=seeded(563.0,arg(s,4u));
 for(var i=0u;i<=5u;i++){
  let share=select(clamp(arg(s,1u)-f32(i)+1.0,0.0,1.0),1.0,i==0u);if(share<=0.0){break;}
  let weight=share*pow(max(.0001,arg(s,2u)),f32(i));
  value+=pow(clamp(1.0-abs(smoothNoise(q,arg(s,0u)/exp2(f32(i)),salt)),0.0,1.0),arg(s,3u))*weight;total+=weight;
 }return vec4f(value/total);
}
// Pixel: one random value a texel. seed.
fn nPixel(s:MaterialStep,q:vec2f)->vec4f{return vec4f(cellHash(graphPixel(q)+vec2f(211.0,317.0)+37.0*arg(s,0u)).x);}
// Scatter: spacing, radius, coverage, jitter, hardness, profile, size variation, tone variation, elongation, direction, direction variation, follow,
// seed. One shape a lattice cell, kept by chance (coverage). Elongation narrows a shape across its length, to no less than .6 px each side
// so a small streak still covers texels, and it stays inside its radius and the cells searched. Direction is a Waves noise's (across its
// crests), so a streak runs a quarter turn from it, parallel to that noise's streaks; each turns from it by its own share of Direction
// variation. A connected density field thins the shapes where it
// is dark (follow).
fn nScatter(s:MaterialStep,p:vec2f,density:vec4f,linked:bool)->vec4f{
 let n=max(1.0,round(graphPeriod/arg(s,0u)));let size=graphPeriod/n;let q=graphPos(p)/size;let c=floor(q);var result=0.0;let seed=37.0*arg(s,12u);
 for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){
  let cell=c+vec2f(f32(x),f32(y));let id=poolWrap(cell,n);let h=cellHash(id+643.0+seed);let v=cellHash(id+671.0+seed);
  let point=cell+.5+(h-.5)*arg(s,3u);let radius=arg(s,1u)*(1.0+arg(s,6u)*1.2*(v.x-.5));
  let angle=(arg(s,9u)+90.0+arg(s,10u)*180.0*(cellHash(id+811.0+seed).x-.5))*.01745329252;let along=vec2f(cos(angle),-sin(angle));
  let width=min(1.0,max(1.0-.92*arg(s,8u),.6/radius));let o=(q-point)*size;let d=select(length(vec2f(dot(o,along),dot(o,vec2f(-along.y,along.x))/width)),length(q-point)*size,arg(s,8u)<=0.0);
  let keep=smoothstep(v.y-.04,v.y+.04,arg(s,2u))*smoothstep(0.0,.04,arg(s,2u));
  let shape=pow(1.0-smoothstep(radius*arg(s,4u),radius,d),arg(s,5u));
  result=max(result,keep*mix(1.0,.4+.6*cellHash(id+743.0+seed).x,arg(s,7u))*shape);
 }}
 if(linked){result*=mix(1.0,2.0*smoothstep(.2,.8,density.x),arg(s,11u));}
 return vec4f(clamp(result,0.0,1.0));
}
// Warp: amount, size, broad layers, axis balance, seed. Moves the coordinates a later node reads.
fn warpField(p:vec2f,size:f32,layers:f32,seed:f32)->vec2f{
 let a=seeded(311.0,seed);let b=seeded(347.0,seed);
 var sum=vec2f(gradientNoise(p,size,a),gradientNoise(p,size,b));var total=1.0;
 for(var i=1u;i<=4u;i++){let amount=clamp(layers-f32(i)+1.0,0.0,1.0);if(amount<=0.0){break;}
  let scale=exp2(f32(i));let weight=scale*amount;sum+=vec2f(gradientNoise(p,size*scale,a),gradientNoise(p,size*scale,b))*weight;total+=weight;}
 return sum/total;
}
fn warpAxes(axis:f32)->vec2f{return vec2f(1.0-max(axis,0.0),1.0+min(axis,0.0));}
// by: the By input (1 when open) scales every warp's move.
fn nWarp(s:MaterialStep,q:vec2f,by:vec4f)->vec4f{return vec4f(q+warpField(q,arg(s,1u),arg(s,2u),arg(s,4u))*warpAxes(arg(s,3u))*arg(s,0u)*by.x,0,0);}
// Push: distance, direction. Moves the coordinates along one direction (x right, y down) by By times the distance.
fn nPush(s:MaterialStep,q:vec2f,by:vec4f)->vec4f{let a=arg(s,1u)*.01745329252;return vec4f(q+vec2f(cos(a),-sin(a))*arg(s,0u)*by.x,0,0);}
// Curl flow follows the perpendicular gradient of a scalar potential, in two midpoint steps, so shapes bend without tearing.
fn flowVelocity(p:vec2f,size:f32,layers:f32,salt:f32)->vec2f{
 var sum=vec2f(0);var total=0.0;
 for(var i=0u;i<=4u;i++){
  let amount=select(clamp(layers-f32(i)+1.0,0.0,1.0),1.0,i==0u);if(amount<=0.0){break;}
  let scale=size*exp2(f32(i));let e=max(.25,scale*.025);
  let dx=smoothNoise(p+vec2f(e,0),scale,salt)-smoothNoise(p-vec2f(e,0),scale,salt);
  let dy=smoothNoise(p+vec2f(0,e),scale,salt)-smoothNoise(p-vec2f(0,e),scale,salt);
  sum+=vec2f(dy,-dx)*(scale/(2.0*e))*amount;total+=amount;
 }return sum/total;
}
fn nFlow(s:MaterialStep,q0:vec2f,by:vec4f)->vec4f{
 var q=q0;let amount=arg(s,0u)*.5*warpAxes(arg(s,3u))*by.x;let salt=seeded(617.0,arg(s,4u));
 for(var i=0;i<2;i++){let mid=q+flowVelocity(q,arg(s,1u),arg(s,2u),salt)*amount*.5;q+=flowVelocity(mid,arg(s,1u),arg(s,2u),salt)*amount;}
 return vec4f(q,0,0);
}
// Levels: low, high, gamma, steps, terracing, invert. Terracing narrows each step's riser from the whole step (0, the value unchanged) to
// nothing (1, flat shelves), so the slider is continuous.
fn nLevels(s:MaterialStep,a:vec4f)->vec4f{
 var v=pow(smoothstep(arg(s,0u),arg(s,1u),clamp(a.x,0.0,1.0)),arg(s,2u));
 if(arg(s,4u)>0.0){
  let t=v*arg(s,3u);let k=floor(t);let rise=max(1.0-arg(s,4u),.0001);
  v=min(1.0,(k+clamp((t-k-(1.0-rise))/rise,0.0,1.0))/arg(s,3u));
 }
 return vec4f(mix(v,1.0-v,arg(s,5u)));
}
// Combine: amount, layer offset. A gray input is the same number in every channel, so gray and color mix freely.
fn nCombine(s:MaterialStep,a:vec4f,b:vec4f,mask:vec4f)->vec4f{
 let v=b-vec4f(arg(s,1u));let w=arg(s,0u)*mask.x;
 switch s.code.z{
  case 1:{return a+v*w;}case 2:{return a*mix(vec4f(1),v,w);}case 3:{return a-v*w;}
  case 4:{return mix(a,min(a,v),w);}case 5:{return mix(a,max(a,v),w);}case 6:{return mix(a,1.0-(1.0-a)*(1.0-v),w);}
  default:{return mix(a,v,w);}
 }
}
// Height blend: softness, bias. The layer shows where its height stands above the base's, as sand fills between stones.
fn nHeightBlend(s:MaterialStep,a:vec4f,b:vec4f,ha:vec4f,hb:vec4f)->vec4f{
 let soft=max(arg(s,0u),.001);return mix(a,b,smoothstep(-soft,soft,hb.x-ha.x+arg(s,1u)));
}
// Gradient: softness, stop count, then position and color for each stop, in order of position.
fn nGradient(s:MaterialStep,a:vec4f)->vec4f{
 let n=u32(arg(s,1u));let t=clamp(a.x,0.0,1.0);var rgb=vec3f(arg(s,3u),arg(s,4u),arg(s,5u));
 for(var i=1u;i<n;i++){
  let at=2u+i*4u;let lower=arg(s,at-4u);let upper=arg(s,at);if(t<=lower){break;}
  let color=vec3f(arg(s,at+1u),arg(s,at+2u),arg(s,at+3u));
  if(t>=upper){rgb=color;continue;}
  let f=(t-lower)/max(upper-lower,.0001);rgb=mix(vec3f(arg(s,at-3u),arg(s,at-2u),arg(s,at-1u)),color,mix(f,smoothstep(0.0,1.0,f),arg(s,0u)));
 }
 return vec4f(rgb,1);
}
// Color adjust: hue turn (degrees), saturation and brightness scales (0 leaves each), through a mask. In HSV, so a turn keeps the brightest
// channel; a color brightened above 1 keeps its gain.
fn graphHsv(c:vec3f)->vec3f{
 let hi=max(c.r,max(c.g,c.b));let d=hi-min(c.r,min(c.g,c.b));if(d<=1e-6){return vec3f(0,0,hi);}
 var h=select(select(4.0+(c.r-c.g)/d,2.0+(c.b-c.r)/d,hi==c.g),(c.g-c.b)/d,hi==c.r);
 return vec3f(fract(h/6.0),d/max(hi,1e-6),hi);
}
fn graphRgb(c:vec3f)->vec3f{return c.z*mix(vec3f(1),clamp(abs(fract(c.x+vec3f(1,2.0/3.0,1.0/3.0))*6.0-3.0)-1.0,vec3f(0),vec3f(1)),c.y);}
fn nAdjust(s:MaterialStep,a:vec4f,mask:vec4f)->vec4f{
 let hsv=graphHsv(a.rgb);let turned=graphRgb(vec3f(fract(hsv.x+arg(s,0u)/360.0),clamp(hsv.y*(1.0+arg(s,1u)),0.0,1.0),hsv.z*(1.0+arg(s,2u))));
 return vec4f(mix(a.rgb,turned,clamp(mask.x,0.0,1.0)),1);
}
// Light: direction, strength. A height's slope toward a light, .5 on the level, so it can tint color the way a lit bump does.
fn nLight(s:MaterialStep,east:f32,west:f32,south:f32,north:f32)->vec4f{
 let angle=arg(s,0u)*.01745329252;let toward=vec2f(cos(angle),-sin(angle));
 return vec4f(clamp(.5-.5*arg(s,1u)*dot(vec2f(east-west,south-north)*.5,toward),0.0,1.0));
}
// Cavity: radius, strength. Above .5 on crests and below it in hollows, from the height against its surroundings.
fn nCavity(s:MaterialStep,center:f32,east:f32,west:f32,south:f32,north:f32)->vec4f{
 return vec4f(clamp(.5+arg(s,1u)*(center-.25*(east+west+south+north)),0.0,1.0));
}
/*MATERIAL_TAPS*/
/*MATERIAL_MAIN*/
