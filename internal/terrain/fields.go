package terrain

import (
	"encoding/binary"
	"fmt"
	"math"
	"strings"

	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
)

// ShapePass is a single prepared GPU operation. Values are packed into the
// shader's Node uniform in declaration order; missing values default to zero.
type ShapePass struct {
	Entry       string
	Region      CellRect
	Values      map[string]float64
	OutputWords int
}
type ShapeEngine struct {
	gpu            *GPU
	layout         *wgpu.BindGroupLayout
	pipelineLayout *wgpu.PipelineLayout
	module         *wgpu.ShaderModule
	kernels        map[string]*wgpu.ComputePipeline
	prepared       *preparedGraph
	profile        *ShapeProfile
}

func shapeUniformSize() int { return (len(shapeFields)*4 + 255) &^ 255 }
func shapeSource(source string, pages bool) string {
	var b strings.Builder
	b.WriteString("struct Node {\n")
	for _, f := range shapeFields {
		typ := "f32"
		if f.kind == 'u' {
			typ = "u32"
		} else if f.kind == 'i' {
			typ = "i32"
		}
		fmt.Fprintf(&b, "  %s: %s,\n", f.name, typ)
	}
	b.WriteString("}\n")
	source = strings.Replace(source, "/*NODE_STRUCT*/", b.String(), 1)
	source = strings.Replace(source, "/*CV_N*/", "const CV_N = 64.0;", 1)
	return Preprocess(source, "", map[string]bool{"PAGES": pages})
}

// NewShapeEngine creates the shared binding layout used by all shape passes.
func NewShapeEngine(g *GPU, source string, pages bool) (*ShapeEngine, error) {
	entries := make([]gputypes.BindGroupLayoutEntry, 9)
	for i := range entries {
		typ := gputypes.BufferBindingTypeStorage
		if i == 0 {
			typ = gputypes.BufferBindingTypeUniform
		} else if i == 5 || i == 6 {
			typ = gputypes.BufferBindingTypeReadOnlyStorage
		}
		entries[i] = gputypes.BindGroupLayoutEntry{Binding: uint32(i), Visibility: gputypes.ShaderStageCompute, Buffer: &gputypes.BufferBindingLayout{Type: typ, HasDynamicOffset: i == 0}}
	}
	layout, e := g.Device.CreateBindGroupLayout(&wgpu.BindGroupLayoutDescriptor{Label: "shape", Entries: entries})
	if e != nil {
		return nil, e
	}
	pl, e := g.Device.CreatePipelineLayout(&wgpu.PipelineLayoutDescriptor{Label: "shape", BindGroupLayouts: []*wgpu.BindGroupLayout{layout}})
	if e != nil {
		layout.Release()
		return nil, e
	}
	module, e := g.Device.CreateShaderModule(&wgpu.ShaderModuleDescriptor{Label: "shape", WGSL: shapeSource(source, pages)})
	if e != nil {
		pl.Release()
		layout.Release()
		return nil, e
	}
	return &ShapeEngine{gpu: g, layout: layout, pipelineLayout: pl, module: module, kernels: map[string]*wgpu.ComputePipeline{}}, nil
}
func (s *ShapeEngine) Close() {
	s.prepared = nil
	for _, p := range s.kernels {
		p.Release()
	}
	s.module.Release()
	s.pipelineLayout.Release()
	s.layout.Release()
}
func (s *ShapeEngine) kernel(entry string) (*wgpu.ComputePipeline, error) {
	if p := s.kernels[entry]; p != nil {
		return p, nil
	}
	p, e := s.gpu.Device.CreateComputePipeline(&wgpu.ComputePipelineDescriptor{Label: entry, Layout: s.pipelineLayout, Module: s.module, EntryPoint: entry})
	if e == nil {
		s.kernels[entry] = p
	}
	return p, e
}
func packShapeUniform(dst []byte, values map[string]float64) {
	for i, f := range shapeFields {
		v := values[f.name]
		bits := math.Float32bits(float32(v))
		if f.kind == 'u' {
			bits = uint32(v)
		} else if f.kind == 'i' {
			bits = uint32(int32(v))
		}
		binary.LittleEndian.PutUint32(dst[i*4:], bits)
	}
}

// Dispatch records prepared passes with shared plane, scratch, segment, mask,
// output and point buffers. Buffers correspond to bindings 1 through 8.
func (s *ShapeEngine) Dispatch(passes []ShapePass, buffers [8]*wgpu.Buffer) error {
	if len(passes) == 0 {
		return nil
	}
	stride := shapeUniformSize()
	uniforms := make([]byte, len(passes)*stride)
	for i, p := range passes {
		v := make(map[string]float64, len(p.Values)+4)
		for k, x := range p.Values {
			v[k] = x
		}
		v["rx0"], v["ry0"], v["rx1"], v["ry1"] = float64(p.Region.X0), float64(p.Region.Y0), float64(p.Region.X1), float64(p.Region.Y1)
		packShapeUniform(uniforms[i*stride:], v)
	}
	ub, e := s.gpu.Buffer("shape uniforms", uniforms, gputypes.BufferUsageUniform)
	if e != nil {
		return e
	}
	defer ub.Release()
	entries := []wgpu.BindGroupEntry{{Binding: 0, Buffer: ub, Size: uint64(stride)}}
	for i, b := range buffers {
		if b == nil {
			return fmt.Errorf("shape binding %d is nil", i+1)
		}
		entries = append(entries, wgpu.BindGroupEntry{Binding: uint32(i + 1), Buffer: b})
	}
	bg, e := s.gpu.Device.CreateBindGroup(&wgpu.BindGroupDescriptor{Layout: s.layout, Entries: entries})
	if e != nil {
		return e
	}
	defer bg.Release()
	enc, e := s.gpu.Device.CreateCommandEncoder(nil)
	if e != nil {
		return e
	}
	pass, e := enc.BeginComputePass(nil)
	if e != nil {
		return e
	}
	for i, p := range passes {
		pipe, err := s.kernel(p.Entry)
		if err != nil {
			return err
		}
		pass.SetPipeline(pipe)
		pass.SetBindGroup(0, bg, []uint32{uint32(i * stride)})
		if p.Entry == "pointRead" {
			pass.Dispatch(1, 1, 1)
		} else if p.Entry == "pack" || p.Entry == "packPlane" {
			groups := (p.OutputWords + 255) / 256
			gx := min(groups, 65535)
			if gx > 0 {
				pass.Dispatch(uint32(gx), uint32((groups+gx-1)/gx), 1)
			}
		} else {
			w, h := p.Region.X1-p.Region.X0+1, p.Region.Y1-p.Region.Y0+1
			if w > 0 && h > 0 {
				pass.Dispatch(uint32((w+7)/8), uint32((h+7)/8), 1)
			}
		}
	}
	if e = pass.End(); e != nil {
		return e
	}
	return s.gpu.Submit(enc)
}
