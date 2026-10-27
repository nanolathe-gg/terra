#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec2 aPosition;
out vec2 vWorld;
out float vHeight;
/*COMMON*/
void main() {
    vec2 p = aPosition * (uSize - 1.0);
    float height = surfaceHeight(p);
    // Orthographic oblique view, with explicit depth ordering at folded faces.
    float visible = max(uSea, height);
    float screenY = p.y - (visible - uBase) * 0.5;
    gl_Position = vec4(p.x / uSize * 2.0 - 1.0,
                       1.0 - screenY / uSize * 2.0,
                       -(p.y + visible * 2.0) / (uSize + 700.0), 1.0);
    vWorld = p;
    vHeight = height;
}
