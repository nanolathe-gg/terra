package terrain

import (
	"github.com/gogpu/wgpu"
	"strings"
)

// Canonical type spellings work around naga's bitcast shorthand parser gap.
// They denote exactly the same WGSL types; expressions and arithmetic are intact.
func CanonicalWGSL(source string) string {
	for _, p := range []struct{ from, to string }{{"vec2u", "vec2<u32>"}, {"vec3u", "vec3<u32>"}, {"vec4u", "vec4<u32>"}, {"vec2i", "vec2<i32>"}, {"vec3i", "vec3<i32>"}, {"vec4i", "vec4<i32>"}, {"vec2f", "vec2<f32>"}, {"vec3f", "vec3<f32>"}, {"vec4f", "vec4<f32>"}} {
		source = strings.ReplaceAll(source, "bitcast<"+p.from+">", "bitcast<"+p.to+">")
	}
	return source
}
func (g *GPU) Shader(label, source string) (*wgpu.ShaderModule, error) {
	return g.Device.CreateShaderModule(&wgpu.ShaderModuleDescriptor{Label: label, WGSL: CanonicalWGSL(source)})
}
