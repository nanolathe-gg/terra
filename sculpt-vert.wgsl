// WGSL port of the former sculpt.vert.
/*COMMON*/
@vertex
fn vertexMain(@location(0) aPosition: vec2f) -> VertexOut {
    let p = aPosition * (u.size - 1.0);
    let height = surfaceHeight(p);
    // Orthographic oblique view, with explicit depth ordering at folded faces.
    let visible = max(u.sea, height);
    let screenY = p.y - (visible - u.base) * 0.5;
    // The GLSL depth ran over clip -1..1; WebGPU's clip depth is 0..1, so
    // map it as GL's depth range does: (z + 1) / 2.
    let depth = -(p.y + visible * 2.0) / (u.size + 700.0);
    var o: VertexOut;
    o.position = vec4f(p.x / u.size * 2.0 - 1.0,
                       1.0 - screenY / u.size * 2.0,
                       (depth + 1.0) * 0.5, 1.0);
    o.world = p;
    o.height = height;
    return o;
}
