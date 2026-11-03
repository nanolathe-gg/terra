// Package terrain executes Terraform's unchanged WGSL through gogpu/wgpu.
package terrain

import (
	"context"
	"encoding/binary"
	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
	"math"
	"sort"
	"sync"
)

type GPU struct {
	deferViewValidation bool
	errorMu             sync.Mutex
	asyncError          error
	OnError             func(error)
	removeErrorHandler  func()
	layoutBindings      map[*wgpu.BindGroupLayout]map[uint32]bool
	Instance            *wgpu.Instance
	Adapter             *wgpu.Adapter
	Device              *wgpu.Device
	Queue               *wgpu.Queue
}

func NewGPU() (*GPU, error) {
	i, e := wgpu.CreateInstance(instanceDescriptor())
	if e != nil {
		return nil, e
	}
	a, e := i.RequestAdapter(nil)
	if e != nil {
		i.Release()
		return nil, e
	}
	features := a.Features() & gputypes.Features(gputypes.FeatureFloat32Filterable)
	d, e := a.RequestDevice(&wgpu.DeviceDescriptor{RequiredFeatures: features})
	if e != nil {
		a.Release()
		i.Release()
		return nil, e
	}
	g := &GPU{Instance: i, Adapter: a, Device: d, Queue: d.Queue(), layoutBindings: map[*wgpu.BindGroupLayout]map[uint32]bool{}}
	g.installErrorHandler()
	return g, nil
}
func (g *GPU) Close() {
	if g.removeErrorHandler != nil {
		g.removeErrorHandler()
	}
	g.Device.Release()
	g.Adapter.Release()
	g.Instance.Release()
}
func FloatBytes(v []float32) []byte {
	b := make([]byte, len(v)*4)
	for i, x := range v {
		binary.LittleEndian.PutUint32(b[i*4:], math.Float32bits(x))
	}
	return b
}
func (g *GPU) Allocate(label string, size uint64, usage gputypes.BufferUsage) (*wgpu.Buffer, error) {
	if size < 16 {
		size = 16
	}
	return g.Device.CreateBuffer(&wgpu.BufferDescriptor{Label: label, Size: (size + 3) &^ 3, Usage: usage})
}
func (g *GPU) Buffer(label string, data []byte, usage gputypes.BufferUsage) (*wgpu.Buffer, error) {
	b, e := g.Allocate(label, uint64(len(data)), usage|gputypes.BufferUsageCopyDst)
	if e != nil {
		return nil, e
	}
	if len(data) > 0 {
		e = g.Queue.WriteBuffer(b, 0, data)
	}
	if e != nil {
		b.Release()
		return nil, e
	}
	return b, nil
}

type Kernel struct {
	Pipeline *wgpu.ComputePipeline
	Layouts  []*wgpu.BindGroupLayout
}
type Bindings map[uint32][]wgpu.BindGroupEntry

func (g *GPU) Kernel(source, entry string) (*Kernel, error) {
	m, e := g.Shader(entry, source)
	if e != nil {
		return nil, e
	}
	defer m.Release()
	layouts, e := g.kernelLayouts(source, entry)
	if e != nil {
		return nil, e
	}
	layout, e := g.Device.CreatePipelineLayout(&wgpu.PipelineLayoutDescriptor{BindGroupLayouts: layouts})
	if e != nil {
		return nil, e
	}
	defer layout.Release()
	p, e := g.Device.CreateComputePipeline(&wgpu.ComputePipelineDescriptor{Label: entry, Module: m, EntryPoint: entry, Layout: layout})
	if e != nil {
		return nil, e
	}
	return &Kernel{Pipeline: p, Layouts: layouts}, nil
}
func (g *GPU) Groups(k *Kernel, b Bindings) (map[uint32]*wgpu.BindGroup, error) {
	o := map[uint32]*wgpu.BindGroup{}
	for index, layout := range k.Layouts {
		i := uint32(index)
		v := b[i]
		if ids, ok := g.layoutBindings[layout]; ok {
			filtered := []wgpu.BindGroupEntry{}
			for _, entry := range v {
				if ids[entry.Binding] {
					filtered = append(filtered, entry)
				}
			}
			v = filtered
		}
		bg, e := g.Device.CreateBindGroup(&wgpu.BindGroupDescriptor{Layout: k.Layouts[i], Entries: v})
		if e != nil {
			return nil, e
		}
		o[i] = bg
	}
	return o, nil
}
func EncodeDispatch(enc *wgpu.CommandEncoder, k *Kernel, b map[uint32]*wgpu.BindGroup, x, y, z uint32, indirect *wgpu.Buffer) error {
	p, e := enc.BeginComputePass(nil)
	if e != nil {
		return e
	}
	p.SetPipeline(k.Pipeline)
	keys := []int{}
	for i := range b {
		keys = append(keys, int(i))
	}
	sort.Ints(keys)
	for _, i := range keys {
		p.SetBindGroup(uint32(i), b[uint32(i)], nil)
	}
	if indirect != nil {
		p.DispatchIndirect(indirect, 0)
	} else {
		p.Dispatch(x, y, z)
	}
	return p.End()
}
func (g *GPU) Dispatch(k *Kernel, b Bindings, x, y, z uint32) error {
	enc, e := g.Device.CreateCommandEncoder(nil)
	if e != nil {
		return e
	}
	groups, e := g.Groups(k, b)
	if e != nil {
		return e
	}
	defer func() {
		for _, v := range groups {
			v.Release()
		}
	}()
	if e = EncodeDispatch(enc, k, groups, x, y, z, nil); e != nil {
		return e
	}
	return g.Submit(enc)
}
func (g *GPU) Submit(enc *wgpu.CommandEncoder) error {
	c, e := enc.Finish()
	if e != nil {
		return e
	}
	defer c.Release()
	_, e = g.Queue.Submit(c)
	return e
}
func (g *GPU) ReadBuffer(ctx context.Context, src *wgpu.Buffer, offset, size uint64) ([]byte, error) {
	b, e := g.Allocate("readback", size, gputypes.BufferUsageMapRead|gputypes.BufferUsageCopyDst)
	if e != nil {
		return nil, e
	}
	defer b.Release()
	enc, e := g.Device.CreateCommandEncoder(nil)
	if e != nil {
		return nil, e
	}
	enc.CopyBufferToBuffer(src, offset, b, 0, size)
	if e = g.Submit(enc); e != nil {
		return nil, e
	}
	if e = b.Map(ctx, wgpu.MapModeRead, 0, size); e != nil {
		return nil, e
	}
	r, e := b.MappedRange(0, size)
	if e != nil {
		return nil, e
	}
	data := append([]byte(nil), r.Bytes()...)
	e = b.Unmap()
	return data, e
}

func (g *GPU) scope() (finish func(*error)) {
	if g.deferViewValidation {
		return g.collectAsyncError
	}
	g.Device.PushErrorScope(wgpu.ErrorFilterValidation)
	return func(err *error) {
		if validation := g.Device.PopErrorScope(); validation != nil && *err == nil {
			*err = validation
		}
		g.collectAsyncError(err)
	}
}
func (g *GPU) collectAsyncError(err *error) {
	g.errorMu.Lock()
	async := g.asyncError
	g.asyncError = nil
	g.errorMu.Unlock()
	if async != nil && *err == nil {
		*err = async
	}
}
