package terrain

import (
	"context"
	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
)

// The former Canvas2D mean used a 64x64 bilinear reduction, not the mean of
// all source pixels. Preserve that sampling on the GPU for chosen base colors.
const groundMeanSource = `@group(0) @binding(0) var src:texture_2d<f32>;
@group(0) @binding(1) var linear:sampler;
struct V { @builtin(position) position:vec4f, @location(0) uv:vec2f }
@vertex fn vertexMain(@builtin(vertex_index)i:u32)->V {let p=vec2f(f32((i<<1u)&2u),f32(i&2u));var o:V;o.position=vec4f(p*2.0-1.0,0.0,1.0);o.uv=vec2f(p.x,1.0-p.y);return o;}
@fragment fn fragmentMain(v:V)->@location(0) vec4f{return textureSampleLevel(src,linear,v.uv,0.0);}`

func (r *Renderer) groundMean() []float64 {
	g := r.GPU
	m := must(g.Shader("ground mean", groundMeanSource))
	defer m.Release()
	bgl := must(g.Device.CreateBindGroupLayout(&wgpu.BindGroupLayoutDescriptor{Entries: []gputypes.BindGroupLayoutEntry{{Binding: 0, Visibility: gputypes.ShaderStageFragment, Texture: &gputypes.TextureBindingLayout{SampleType: gputypes.TextureSampleTypeFloat, ViewDimension: gputypes.TextureViewDimension2D}}, {Binding: 1, Visibility: gputypes.ShaderStageFragment, Sampler: &gputypes.SamplerBindingLayout{Type: gputypes.SamplerBindingTypeFiltering}}}}))
	defer bgl.Release()
	layout := must(g.Device.CreatePipelineLayout(&wgpu.PipelineLayoutDescriptor{BindGroupLayouts: []*wgpu.BindGroupLayout{bgl}}))
	defer layout.Release()
	p := must(g.Device.CreateRenderPipeline(&wgpu.RenderPipelineDescriptor{Label: "ground mean", Layout: layout, Vertex: wgpu.VertexState{Module: m, EntryPoint: "vertexMain"}, Fragment: &wgpu.FragmentState{Module: m, EntryPoint: "fragmentMain", Targets: []gputypes.ColorTargetState{{Format: gputypes.TextureFormatRGBA8Unorm, WriteMask: gputypes.ColorWriteMaskAll}}}, Primitive: gputypes.PrimitiveState{Topology: gputypes.PrimitiveTopologyTriangleList}, Multisample: gputypes.MultisampleState{Count: 1, Mask: 0xffffffff}}))
	defer p.Release()
	tex := r.texture("ground mean reduction", 64, 64, 1, 1, gputypes.TextureFormatRGBA8Unorm, gputypes.TextureUsageRenderAttachment|gputypes.TextureUsageCopySrc)
	defer tex.Release()
	bg := must(g.Device.CreateBindGroup(&wgpu.BindGroupDescriptor{Layout: bgl, Entries: []wgpu.BindGroupEntry{{Binding: 0, TextureView: r.view(r.Grass, false, -1)}, {Binding: 1, Sampler: r.LinearClamp}}}))
	defer bg.Release()
	enc := must(g.Device.CreateCommandEncoder(nil))
	pass := must(enc.BeginRenderPass(&wgpu.RenderPassDescriptor{ColorAttachments: []wgpu.RenderPassColorAttachment{{View: r.view(tex, false, -1), LoadOp: gputypes.LoadOpClear, StoreOp: gputypes.StoreOpStore}}}))
	pass.SetPipeline(p)
	pass.SetBindGroup(0, bg, nil)
	pass.Draw(gputypes.DrawArgs{VertexCount: 3, InstanceCount: 1})
	check(pass.End())
	check(g.Submit(enc))
	data := must(r.ReadTexture(context.Background(), tex, 64, 64, 0, 0))
	sum := []float64{0, 0, 0}
	for i := 0; i < len(data); i += 4 {
		for c := range sum {
			sum[c] += float64(data[i+c])
		}
	}
	for c := range sum {
		sum[c] /= 4096 * 255
	}
	return sum
}
