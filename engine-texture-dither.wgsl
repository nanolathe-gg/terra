// Canonical full-repeat diffusion, processed in 128-row wavefronts. The
// dependency order x+2*y puts left and all previous-row inputs before a pixel.
// Each invocation writes only its own error; barriers make the next wave see it.
/*COMMON*/
@group(1) @binding(0) var pigmentOut:texture_storage_2d_array<rgba8unorm,write>;
@group(1) @binding(1) var<storage,read_write> errors:array<vec4f>;
@group(1) @binding(2) var<uniform> job:vec4u; // slot, layer, first row, row count
var<workgroup> metrics:array<vec3f,32>;
fn diffusionMetric(v:vec3f,gamma:f32)->vec3f {return pow(clamp(v/255.0,vec3f(0),vec3f(1)),vec3f(gamma));}
@compute @workgroup_size(128)
fn diffuseMaterial(@builtin(local_invocation_index) lane:u32){
 let r=u.ground[job.x & groundMask];let width=textureDimensions(pigmentOut).x;let stride=width+2u;let rows=min(job.w,width-job.z);
 let weights=vec3f(r.paletteRed,r.paletteGreen,r.paletteBlue);
 let right=mix(7.0/16.0,9.0/17.0,r.diffusionMix);let left=mix(3.0/16.0,2.0/17.0,r.diffusionMix);
 let down=mix(5.0/16.0,6.0/17.0,r.diffusionMix);let diag=mix(1.0/16.0,0.0,r.diffusionMix);
 if(lane<u32(r.texturePaletteCount)){metrics[lane]=diffusionMetric(r.texturePalette[lane].rgb*255.0,r.paletteGamma);}
 workgroupBarrier();
 for(var wave=0u;wave<width+2u*(rows-1u);wave++){
  let x=i32(wave)-2*i32(lane);
  if(lane<rows&&x>=0&&x<i32(width)){
   let at=(lane+1u)*stride+u32(x)+1u;let prev=at-stride;
   let p=vec2u(u32(x),job.z+lane);
   let raw=round(clamp(materialRaw(vec2f(p),job.x,0.0,0.0,false),vec3f(0),vec3f(1))*255.0);
   let value=raw+(((errors[prev-1u].rgb*diag+errors[prev].rgb*down)+errors[prev+1u].rgb*left)+errors[at-1u].rgb*right);
   let metric=diffusionMetric(value,r.paletteGamma);var best=r.texturePalette[0].rgb;var distance=1e20;
   for(var k=0u;k<u32(r.texturePaletteCount);k++){
    let delta=metrics[k]-metric;let d=dot(delta*delta,weights);
    if(d<distance){distance=d;best=r.texturePalette[k].rgb;}
   }
   errors[at]=vec4f(value-best*255.0,0);
   textureStore(pigmentOut,vec2i(p),i32(job.y),vec4f(best,1));
  }
  storageBarrier();
 }
 // Keep the final row for the next dispatch; border errors remain zero.
 for(var x=lane;x<stride;x+=128u){errors[x]=errors[rows*stride+x];}
}
