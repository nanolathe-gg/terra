//go:build js && wasm

package terrain

import (
	"context"
	"encoding/binary"
	"fmt"
	"syscall/js"

	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
)

// browserPresenter holds one reusable GPU canvas. transferToImageBitmap moves
// the completed image to the UI without mapping terrain pixels into Go memory.
type browserPresenter struct {
	done           <-chan error
	canvas         js.Value
	surface        *wgpu.Surface
	width, height  int
	pipeline       *wgpu.RenderPipeline
	layout         *wgpu.BindGroupLayout
	pipelineLayout *wgpu.PipelineLayout
	shader         *wgpu.ShaderModule
	uniform        *wgpu.Buffer
}

func (p *browserPresenter) Bytes() int {
	n := p.width * p.height * 4
	if p.uniform != nil {
		n += 16
	}
	return n
}
func (p *browserPresenter) Release() {
	if p.surface != nil {
		p.surface.Release()
	}
	if p.pipeline != nil {
		p.pipeline.Release()
		p.pipelineLayout.Release()
		p.layout.Release()
		p.shader.Release()
		p.uniform.Release()
	}
}
func (s *SceneRenderer) PresentBitmap(ctx context.Context, width, height int) (js.Value, error) {
	return s.renderer.PresentBitmap(ctx, width, height)
}

func (r *Renderer) PresentBitmap(ctx context.Context, width, height int) (bitmap js.Value, err error) {
	bitmap = js.Undefined()
	defer recoverError(&err)
	defer r.GPU.scope()(&err)
	if err = ctx.Err(); err != nil {
		return
	}
	if r.Color == nil || width < 1 || height < 1 {
		return bitmap, fmt.Errorf("no rendered terrain image to present")
	}
	// The working estimate already includes one output staging image. Replace
	// that reservation with the canvas and allow one independent bitmap snapshot.
	budget := number(r.Config, "gpuBudgetBytes", number(r.Config, "gpuBudgetMB", number(r.Config, "gpuMB", 512))*1048576)
	required := float64(r.LastProfile.WorkingBytes+r.FixedBytes()-r.presentationBytes()) + float64(max(0, width*height*8+16-r.Width*r.Height*4))
	if required > budget {
		return bitmap, fmt.Errorf("terrain presentation needs %.1f MiB, budget %.1f MiB", required/1048576, budget/1048576)
	}
	p, _ := r.presentation.(*browserPresenter)
	if p == nil {
		p = &browserPresenter{canvas: js.Global().Get("OffscreenCanvas").New(width, height)}
		p.surface = must(r.GPU.Instance.CreateSurfaceFromCanvas(p.canvas))
		r.presentation = p
	}
	if p.width != width || p.height != height {
		check(p.surface.Configure(r.GPU.Device, &wgpu.SurfaceConfiguration{Width: uint32(width), Height: uint32(height), Format: gputypes.TextureFormatRGBA8Unorm, Usage: gputypes.TextureUsageCopyDst | gputypes.TextureUsageRenderAttachment, PresentMode: gputypes.PresentModeFifo, AlphaMode: gputypes.CompositeAlphaModeOpaque}))
		p.width, p.height = width, height
	}
	frame, _, e := p.surface.GetCurrentTexture()
	if e != nil {
		return bitmap, e
	}
	enc := must(r.GPU.Device.CreateCommandEncoder(nil))
	if r.Width == width && r.Height == height {
		enc.CopyTextureToTexture(r.Color, frame.Texture(), []wgpu.TextureCopy{{Size: wgpu.Extent3D{Width: uint32(width), Height: uint32(height), DepthOrArrayLayers: 1}}})
	} else {
		p.initReduction(r.GPU)
		data := make([]byte, 16)
		for i, n := range []int{r.Width, r.Height, width, height} {
			binary.LittleEndian.PutUint32(data[i*4:], uint32(n))
		}
		check(r.GPU.Queue.WriteBuffer(p.uniform, 0, data))
		view := must(r.GPU.Device.CreateTextureView(r.Color, nil))
		defer view.Release()
		target := must(r.GPU.Device.CreateTextureView(frame.Texture(), nil))
		defer target.Release()
		group := must(r.GPU.Device.CreateBindGroup(&wgpu.BindGroupDescriptor{Layout: p.layout, Entries: []wgpu.BindGroupEntry{{Binding: 0, TextureView: view}, {Binding: 1, Buffer: p.uniform}}}))
		defer group.Release()
		pass := must(enc.BeginRenderPass(&wgpu.RenderPassDescriptor{ColorAttachments: []wgpu.RenderPassColorAttachment{{View: target, LoadOp: gputypes.LoadOpClear, StoreOp: gputypes.StoreOpStore}}}))
		pass.SetPipeline(p.pipeline)
		pass.SetBindGroup(0, group, nil)
		pass.Draw(gputypes.DrawArgs{VertexCount: 3, InstanceCount: 1})
		check(pass.End())
	}
	check(r.GPU.Submit(enc))
	completion := make(chan error, 1)
	r.GPU.Queue.OnSubmittedWorkDone(func(err error) { completion <- err; close(completion) })
	p.done = completion
	check(p.surface.Present(frame))
	return p.canvas.Call("transferToImageBitmap"), nil
}
func (p *browserPresenter) initReduction(g *GPU) {
	if p.pipeline != nil {
		return
	}
	p.shader = must(g.Device.CreateShaderModule(&wgpu.ShaderModuleDescriptor{Label: "terrain presentation integer box reduction", WGSL: presentReduction}))
	p.layout = must(g.Device.CreateBindGroupLayout(&wgpu.BindGroupLayoutDescriptor{Entries: []gputypes.BindGroupLayoutEntry{{Binding: 0, Visibility: gputypes.ShaderStageFragment, Texture: &gputypes.TextureBindingLayout{SampleType: gputypes.TextureSampleTypeFloat, ViewDimension: gputypes.TextureViewDimension2D}}, {Binding: 1, Visibility: gputypes.ShaderStageFragment, Buffer: &gputypes.BufferBindingLayout{Type: gputypes.BufferBindingTypeUniform}}}}))
	p.pipelineLayout = must(g.Device.CreatePipelineLayout(&wgpu.PipelineLayoutDescriptor{BindGroupLayouts: []*wgpu.BindGroupLayout{p.layout}}))
	p.uniform = must(g.Allocate("presentation reduction dimensions", 16, gputypes.BufferUsageUniform|gputypes.BufferUsageCopyDst))
	p.pipeline = must(g.Device.CreateRenderPipeline(&wgpu.RenderPipelineDescriptor{Label: "terrain presentation reduction", Layout: p.pipelineLayout, Vertex: wgpu.VertexState{Module: p.shader, EntryPoint: "vertexMain"}, Fragment: &wgpu.FragmentState{Module: p.shader, EntryPoint: "fragmentMain", Targets: []gputypes.ColorTargetState{{Format: gputypes.TextureFormatRGBA8Unorm, WriteMask: gputypes.ColorWriteMaskAll}}}, Primitive: gputypes.PrimitiveState{Topology: gputypes.PrimitiveTopologyTriangleList}, Multisample: gputypes.MultisampleState{Count: 1, Mask: 0xffffffff}}))
}

// Match resizeRGBA byte-for-byte, including uneven edge intervals and rounding.
const presentReduction = `
struct Dims {src:vec2u,dst:vec2u};
@group(0) @binding(0) var image:texture_2d<f32>;
@group(0) @binding(1) var<uniform> dims:Dims;
@vertex fn vertexMain(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
 let x=f32((i<<1u)&2u);let y=f32(i&2u);return vec4f(x*2.0-1.0,1.0-y*2.0,0.0,1.0);
}
@fragment fn fragmentMain(@builtin(position) p:vec4f)->@location(0) vec4f {
 let at=vec2u(p.xy);let lo=at*dims.src/dims.dst;
 let hi=min(dims.src,max(lo+vec2u(1u),(at+vec2u(1u))*dims.src/dims.dst));
 var sum=vec4u(0u);var n=0u;
 for(var y=lo.y;y<hi.y;y++){for(var x=lo.x;x<hi.x;x++){sum+=vec4u(round(textureLoad(image,vec2i(i32(x),i32(y)),0)*255.0));n++;}}
 return vec4f((sum+vec4u(n/2u))/vec4u(n))/255.0;
}`

// WaitView waits for the preceding image's captured queue fence. PresentBitmap
// does not wait for it: the worker sends that bitmap before awaiting this fence
// at the start of the next tile. Cancellation preserves the pending fence.
func (s *SceneRenderer) WaitView(ctx context.Context) error { return s.renderer.WaitView(ctx) }
func (r *Renderer) WaitView(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	p, _ := r.presentation.(*browserPresenter)
	if p == nil || p.done == nil {
		return ctx.Err()
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-p.done:
		p.done = nil
		return err
	}
}
