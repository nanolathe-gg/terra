/*COMMON*/
// The terrain surface is intersected in the voxel volume for each output pixel.
@vertex fn vertexMain(@builtin(vertex_index) i:u32)->VertexOut {
    let p=vec2f(f32((i<<1u)&2u),f32(i&2u));var out:VertexOut;
    out.position=vec4f(p*2.0-1.0,0,1);return out;
}
