// Periodic procedural pigment fields shared by ground and water recipes.
fn textureGradient(p:vec2f,size:f32,salt:f32)->f32 {
 let n=max(1.0,round(u.pool/size));let q=poolPos(p)/u.pool*n;let c=floor(q);let t=fract(q);let fade=t*t*t*(t*(t*6.0-15.0)+10.0);
 var values:array<f32,4>;for(var i=0u;i<4u;i++){let off=vec2f(f32(i&1u),f32(i>>1u));let a=cellHash(poolWrap(c+off,n)+salt).x*6.2831853;values[i]=dot(vec2f(cos(a),sin(a)),t-off);}
 return mix(mix(values[0],values[1],fade.x),mix(values[2],values[3],fade.x),fade.y)*1.41421356;
}
fn textureStreakAt(p:vec2f,size:f32,axis:u32)->f32 {
 let r=u.ground[gs & groundMask];let diagonal=(axis%2u)==1u;let n=max(vec2f(1),round(vec2f(u.pool)/(vec2f(size,size*r.patternLength/r.patternSize)*select(1.0,1.41421356,diagonal))));
 let v=poolPos(p);var point=v;switch(axis%4u){case 1u:{point=vec2f(v.x-v.y,v.x+v.y);}case 2u:{point=vec2f(v.y,-v.x);}case 3u:{point=vec2f(v.x+v.y,v.y-v.x);}default:{}}let q=point/u.pool*n;let c=floor(q);let t=fract(q);let fade=t*t*t*(t*(t*6.0-15.0)+10.0);
 var values:array<f32,4>;for(var i=0u;i<4u;i++){let off=vec2f(f32(i&1u),f32(i>>1u));let cell=c+off;let h=cellHash(cell-floor(cell/n)*n+379.0);let g=dot(vec2f(cos(h.x*6.2831853),sin(h.x*6.2831853)),t-off)*1.8+.5;values[i]=mix(h.x,g,r.patternGradient);}
 return mix(mix(values[0],values[1],fade.x),mix(values[2],values[3],fade.x),fade.y);
}
fn textureStreakBase(p:vec2f,size:f32)->f32 {
 let angle=u.ground[gs & groundMask].patternDirection/45.0;let a=u32(floor(angle));return mix(textureStreakAt(p,size,a),textureStreakAt(p,size,a+1u),fract(angle));
}
fn textureBasis(p:vec2f,size:f32)->f32 {
 let r=u.ground[gs & groundMask];let g=textureGradient(p,size,379.0);
 var field=mix(.5+.5*groundNoise(p,size,379.0),.5+.65*g,r.patternGradient);
 field=mix(field,abs(g)*1.8,r.patternTurbulence);
 if(r.patternCells>0.0){let n=max(1.0,round(u.pool/size));let c=groundCell(poolPos(p)/u.pool*n,n,379.0,1.0);field=mix(field,clamp(1.0-c.radius,0.0,1.0),r.patternCells);}
 if(r.patternStreak>0.0){let angle=r.patternDirection*.01745329252;let offset=vec2f(cos(angle),-sin(angle))*size*.35;let base=textureStreakBase(p,size);let slope=.5+(textureStreakBase(p+offset,size)-textureStreakBase(p-offset,size))/.7;field=mix(field,mix(base,slope,r.patternSlope),r.patternStreak);}
 return clamp(field,0.0,1.0);
}
fn textureMarks(p:vec2f)->f32 {
 let r=u.ground[gs & groundMask];let n=max(1.0,round(u.pool/r.markSpacing));let size=u.pool/n;let q=poolPos(p)/size;let c=floor(q);var result=0.0;
 for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){
  let cell=c+vec2f(f32(x),f32(y));let id=poolWrap(cell,n);let h=cellHash(id+643.0);let v=cellHash(id+671.0);
  let point=cell+.5+(h-.5)*r.markScatter;let radius=r.markSize*(.7+.6*v.x);let d=length(q-point)*size;
  let keep=smoothstep(v.y-.04,v.y+.04,r.markDensity)*smoothstep(0.0,.04,r.markDensity);
  result=max(result,keep*mix(1.0,.4+.6*cellHash(id+743.0).x,r.markVariation)*(1.0-smoothstep(radius*r.markCore,radius,d)));
 }}
 let noisy=1.0-smoothstep(r.markLow,r.markHigh,.5+.5*groundNoise(p,r.markNoiseSize,643.0));
 return mix(result,noisy,r.markNoise);
}
fn textureRecipe(p:vec2f)->vec4f {
 let r=u.ground[gs & groundMask];let warp=vec2f(textureGradient(p,r.patternWarpSize,311.0),textureGradient(p,r.patternWarpSize,347.0))*r.patternWarp;
 let q=p+warp;let a=textureBasis(q,r.patternSize);let b=textureBasis(q+vec2f(17,39),r.patternSize/2.0);
 let coarse=mix(mix(a,b,r.patternDetail),.5+.5*groundNoise(p,r.patternMottleSize,827.0),r.patternMottle);
 let fpoint=mix(p,q,r.textureFineWarp)+vec2f(61,97);
 let fine=mix(.5+.5*groundNoise(fpoint,r.textureFineSize,379.0),.5+.65*textureGradient(fpoint,r.textureFineSize,379.0),r.textureFineGradient);
 let pigment=pow(smoothstep(r.patternLow,r.patternHigh,clamp(coarse+(fine-.5)*r.textureFineStructure,0.0,1.0)),r.patternPower);
 let marks=clamp(textureMarks(p)*r.markAmount*mix(1.0,2.0*smoothstep(.2,.8,coarse),r.markFollow),0.0,1.0);
 return vec4f(pigment*r.textureHeight+groundNoise(p,1.0,197.0)*r.textureGrainHeight-marks*r.texturePitDepth,pigment,marks,fine);
}
