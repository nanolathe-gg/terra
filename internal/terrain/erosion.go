package terrain

import (
	"context"
	"encoding/binary"
	"fmt"
	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
	"math"
)

const storageUsage = gputypes.BufferUsageStorage | gputypes.BufferUsageCopySrc | gputypes.BufferUsageCopyDst

// ErosionRequest keeps the authored planes on the GPU. All quantities retain
// the original Time pass's units; Ox/Oy are the first global lattice cells.
type ErosionRequest struct {
	Planes, Masks                                                                             *wgpu.Buffer
	Grid, Size, Ox, Oy, RateMask, Age                                                         int
	SeaLevel, Spacing, Rain, TalusAngle, Envelope, Sand, WetReach, TalusFull, WearFull, FlowK float64
}
type ErosionResult struct {
	Weather *wgpu.Buffer
	Maps    [3]*wgpu.Buffer
	Grid    int
}

func (e *ErosionResult) Close() {
	if e.Weather != nil {
		e.Weather.Release()
	}
	for _, m := range e.Maps {
		if m != nil {
			m.Release()
		}
	}
}

type Erosion struct {
	Renderer *Renderer
	kernels  map[string]*Kernel
	feed     map[string]*Kernel
	maps     *Kernel
	field    map[string]*Kernel
}

func (r *Renderer) NewErosion() (*Erosion, error) {
	e := &Erosion{Renderer: r, kernels: map[string]*Kernel{}, feed: map[string]*Kernel{}, field: map[string]*Kernel{}}
	source := Preprocess(r.Sources["engine-erosion.wgsl"], r.Sources["engine-common.wgsl"], map[string]bool{"EROSION": true})
	var err error
	e.kernels, err = sharedErosionKernels(r.GPU, source)
	if err != nil {
		return nil, err
	}
	ready := false
	defer func() {
		if !ready {
			e.Close()
		}
	}()

	for _, entry := range []string{"seedMain", "tileFlagMain", "tileListMain", "tileArgsMain", "refinedMain"} {
		k, err := r.GPU.Kernel(r.Sources["engine-feed.wgsl"], entry)
		if err != nil {
			return nil, err
		}
		e.feed[entry] = k
	}
	weather := Preprocess(r.Sources["engine-weather.wgsl"], r.Sources["engine-common.wgsl"], map[string]bool{"EROSION": true})
	k, err := r.GPU.Kernel(weather, "mapsMain")
	if err != nil {
		return nil, err
	}
	e.maps = k
	ready = true
	return e, nil
}
func (e *Erosion) Close() {
	all := []*Kernel{e.maps}
	for _, m := range []map[string]*Kernel{e.kernels, e.feed, e.field} {
		for _, k := range m {
			all = append(all, k)
		}
	}
	layouts := map[*wgpu.BindGroupLayout]bool{}
	for _, k := range all {
		if k == nil {
			continue
		}
		k.Pipeline.Release()
		for _, l := range k.Layouts {
			layouts[l] = true
		}
	}
	for l := range layouts {
		l.Release()
	}
}
func FeedUniform(g *GPU, values map[string]float64) (*wgpu.Buffer, error) {
	b := make([]byte, 80)
	for i, k := range []string{"grid", "cells", "ox", "oy", "gw", "gh", "cw", "ch", "mode", "rateMask"} {
		binary.LittleEndian.PutUint32(b[i*4:], uint32(int64(values[k])))
	}
	for i, k := range []string{"sea", "spacing", "envelope"} {
		binary.LittleEndian.PutUint32(b[(10+i)*4:], math.Float32bits(float32(values[k])))
	}
	binary.LittleEndian.PutUint32(b[52:], uint32(values["tilesWide"]))
	binary.LittleEndian.PutUint32(b[64:], 1)
	binary.LittleEndian.PutUint32(b[68:], 1)
	return g.Buffer("feed uniform", b, gputypes.BufferUsageUniform)
}
func (e *Erosion) RunGPU(ctx context.Context, q ErosionRequest) (result *ErosionResult, err error) {
	var ownedResult *ErosionResult
	defer func() {
		if err != nil && ownedResult != nil {
			ownedResult.Close()
		}
	}()
	defer recoverError(&err)
	defer e.Renderer.GPU.scope()(&err)
	if q.Grid < 2 || q.Planes == nil || q.Masks == nil {
		return nil, fmt.Errorf("invalid erosion input")
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	r, g := e.Renderer, e.Renderer.GPU
	n := q.Grid * q.Grid
	spacing := q.Spacing
	if spacing == 0 {
		spacing = float64(q.Size-1) / float64(q.Grid-1)
	}
	age := max(1, q.Age)
	rain := .006 * q.Rain
	tw := (q.Grid + 7) / 8
	made := []*wgpu.Buffer{}
	defer func() {
		for _, b := range made {
			b.Release()
		}
	}()
	makeBuf := func(label string, bytes int, usage gputypes.BufferUsage) *wgpu.Buffer {
		b := must(g.Allocate(label, uint64(bytes), usage))
		made = append(made, b)
		return b
	}
	uniformBuf := func(label string, v []float32) *wgpu.Buffer {
		b := must(g.Buffer(label, FloatBytes(v), gputypes.BufferUsageUniform))
		made = append(made, b)
		return b
	}
	state := [3]*wgpu.Buffer{}
	for i := range state {
		state[i] = makeBuf("erosion state", n*16, storageUsage)
	}
	fluxA := makeBuf("erosion flux a", n*16, storageUsage)
	fluxB := makeBuf("erosion flux b", n*16, storageUsage)
	vel := makeBuf("erosion velocity", n*8, storageUsage)
	acc := makeBuf("erosion totals", n*16, storageUsage)
	fixed := makeBuf("erosion fixed", n*16, storageUsage)
	tileFlag := makeBuf("erosion tile flags", tw*tw*4, storageUsage)
	tileList := makeBuf("erosion tiles", tw*tw*8, storageUsage)
	tileCount := makeBuf("erosion tile count", 4, storageUsage)
	tileArgs := makeBuf("erosion tile args", 12, storageUsage|gputypes.BufferUsageIndirect)
	params := uniformBuf("erosion params", []float32{float32(q.Grid), float32(spacing), float32(rain), .12, .85, .3, .5, .3, .01, .01, float32(r.num("columnContrast", 1)), 15, float32(math.Tan(q.TalusAngle * math.Pi / 180)), float32(math.Min(q.TalusAngle, 85) * math.Pi / 180), float32(80 * math.Pi / 180), .05, float32(q.Ox), float32(q.Oy), 0, 0})
	weather := must(g.Allocate("time height", uint64(n*8), storageUsage))
	result = &ErosionResult{Weather: weather, Grid: q.Grid}
	ownedResult = result
	for i := range result.Maps {
		result.Maps[i] = must(g.Allocate("time map", uint64(n*4), storageUsage))
	}
	envelope := q.Envelope
	if envelope == 0 {
		envelope = 1
	}
	u := must(FeedUniform(g, map[string]float64{"grid": float64(q.Grid), "cells": float64(n), "rateMask": float64(q.RateMask), "sea": q.SeaLevel, "spacing": spacing, "envelope": envelope, "tilesWide": float64(tw)}))
	made = append(made, u)
	r.SetColumn()
	check(r.FlushUniforms())
	res := Bindings{0: {{Binding: 0, Buffer: u}, {Binding: 1, Buffer: q.Planes}, {Binding: 2, Buffer: q.Masks}}, 1: {{Binding: 0, Buffer: state[0]}, {Binding: 1, Buffer: state[1]}, {Binding: 2, Buffer: state[2]}, {Binding: 3, Buffer: fixed}, {Binding: 4, Buffer: tileFlag}, {Binding: 5, Buffer: tileList}, {Binding: 6, Buffer: tileCount}, {Binding: 7, Buffer: tileArgs}, {Binding: 8, Buffer: weather}, {Binding: 9, Buffer: state[1]}}}
	groups := uint32((q.Grid + 7) / 8)
	enc := must(g.Device.CreateCommandEncoder(nil))
	allGroups := []map[uint32]*wgpu.BindGroup{}
	defer func() {
		for _, set := range allGroups {
			for _, bg := range set {
				bg.Release()
			}
		}
	}()
	run := func(k *Kernel, b Bindings, x, y uint32, indirect *wgpu.Buffer) {
		set := must(g.Groups(k, b))
		allGroups = append(allGroups, set)
		check(EncodeDispatch(enc, k, set, x, y, 1, indirect))
	}
	for _, s := range []struct {
		entry string
		x, y  uint32
	}{{"seedMain", groups, groups}, {"tileFlagMain", groups, groups}, {"tileListMain", uint32((tw + 7) / 8), uint32((tw + 7) / 8)}, {"tileArgsMain", 1, 1}} {
		run(e.feed[s.entry], res, s.x, s.y, nil)
	}
	enc.CopyBufferToBuffer(q.Planes, 0, weather, 0, uint64(n*4))
	binding := func(src, dst, fin, fout *wgpu.Buffer) Bindings {
		return Bindings{0: {{Binding: 0, Buffer: r.UniformBuffer}}, 1: {{Binding: 0, Buffer: params}, {Binding: 1, Buffer: src}, {Binding: 2, Buffer: dst}, {Binding: 3, Buffer: fin}, {Binding: 4, Buffer: fout}, {Binding: 5, Buffer: vel}, {Binding: 6, Buffer: acc}, {Binding: 7, Buffer: fixed}, {Binding: 8, Buffer: tileList}}}
	}
	cached := func(b Bindings) map[uint32]*wgpu.BindGroup {
		set := must(g.Groups(e.kernels["fluxMain"], b))
		allGroups = append(allGroups, set)
		return set
	}
	flux := cached(binding(state[0], state[1], fluxA, fluxB))
	water := cached(binding(state[0], state[2], fluxB, fluxA))
	exchange := cached(binding(state[2], state[1], fluxA, fluxB))
	carry := cached(binding(state[1], state[0], fluxA, fluxB))
	thermalA, thermalB := flux, carry
	erosionPass := must(enc.BeginComputePass(&wgpu.ComputePassDescriptor{Label: "erosion"}))
	erosionPass.SetBindGroup(0, flux[0], nil)
	step := func(name string, set map[uint32]*wgpu.BindGroup) {
		erosionPass.SetPipeline(e.kernels[name].Pipeline)
		erosionPass.SetBindGroup(1, set[1], nil)
		if name == "offsetMain" {
			erosionPass.Dispatch(groups, groups, 1)
		} else {
			erosionPass.DispatchIndirect(tileArgs, 0)
		}
	}

	step("offsetMain", flux)
	for i := 0; i < age; i++ {
		if i%16 == 0 {
			if err = ctx.Err(); err != nil {
				check(erosionPass.End())
				enc.DiscardEncoding()
				return nil, err
			}
		}
		if rain != 0 {
			step("fluxMain", flux)
			step("waterMain", water)
			step("exchangeMain", exchange)
			step("carryMain", carry)
		}
		step("thermalMain", thermalA)
		step("thermalMain", thermalB)
	}
	step("settleMain", thermalA)
	for _, b := range []map[uint32]*wgpu.BindGroup{thermalB, thermalA, thermalB, thermalA} {
		step("thermalMain", b)
	}
	check(erosionPass.End())
	run(e.feed["refinedMain"], res, groups, groups, nil)
	wet, talus, wear, flow := q.WetReach, q.TalusFull, q.WearFull, q.FlowK
	if wet == 0 {
		wet = 3
	}
	if talus == 0 {
		talus = 2.5
	}
	if wear == 0 {
		wear = 6
	}
	if flow == 0 {
		flow = 4
	}
	mp := uniformBuf("erosion map params", []float32{float32(q.Grid), float32(spacing), float32(.36 / (float64(age) * .006)), float32(q.Sand), float32(wet), float32(talus), float32(wear), float32(flow)})
	run(e.maps, Bindings{0: {{Binding: 0, Buffer: r.UniformBuffer}}, 1: {{Binding: 0, Buffer: mp}, {Binding: 1, Buffer: state[1]}, {Binding: 2, Buffer: acc}, {Binding: 3, Buffer: fixed}, {Binding: 4, Buffer: weather, Size: uint64(n * 4)}, {Binding: 5, Buffer: result.Maps[0]}, {Binding: 6, Buffer: result.Maps[1]}, {Binding: 7, Buffer: result.Maps[2]}}}, groups, groups, nil)
	check(g.Submit(enc))
	return result, nil
}

// MaterialField runs the original source/drop/count/blur/combine sequence.
type MaterialFieldRequest struct {
	Height                                       *wgpu.Buffer
	HeightOffset, Grid, Size, Ox, Oy             int
	SeaLevel, BaseHeight, DepositSpread, Spacing float64
	Seed                                         uint32
	Profile                                      map[string]any
}

func (e *Erosion) MaterialField(q MaterialFieldRequest) (field *wgpu.Buffer, err error) {
	defer func() {
		if err != nil && field != nil {
			field.Release()
			field = nil
		}
	}()
	defer recoverError(&err)
	defer e.Renderer.GPU.scope()(&err)
	r, g := e.Renderer, e.Renderer.GPU
	n := q.Grid * q.Grid
	spacing := q.Spacing
	if spacing == 0 {
		spacing = float64(q.Size-1) / float64(q.Grid-1)
	}
	spread := math.Max(0, math.Min(1, q.DepositSpread))
	source := Preprocess(r.Sources["engine-weather.wgsl"], r.Sources["engine-common.wgsl"], map[string]bool{"EROSION": true})
	for _, entry := range []string{"mfSourceMain", "mfDropsMain", "mfCountsMain", "mfBlurMain", "mfCombineMain"} {
		if e.field[entry] == nil {
			e.field[entry] = must(g.Kernel(source, entry))
		}
	}
	made := []*wgpu.Buffer{}
	defer func() {
		for _, b := range made {
			b.Release()
		}
	}()
	makeBuf := func(bytes int, usage gputypes.BufferUsage) *wgpu.Buffer {
		b := must(g.Allocate("material field work", uint64(bytes), usage))
		made = append(made, b)
		return b
	}
	height := makeBuf(n*4, storageUsage)
	bufs := make([]*wgpu.Buffer, 13)
	for i := range bufs {
		bufs[i] = makeBuf(n*4, storageUsage)
	}
	src, gx, gy, basin, deposit, flow, a, b, c, soft, settled, broad, runoff := bufs[0], bufs[1], bufs[2], bufs[3], bufs[4], bufs[5], bufs[6], bufs[7], bufs[8], bufs[9], bufs[10], bufs[11], bufs[12]
	field = must(g.Allocate("material field", uint64(n*16), storageUsage))
	mineral := q.Profile["mineral"] == true
	elevated := vector(q.Profile, "elevatedCover", []float64{0, 30, 0})
	uni := func(sigma, axis float64) *wgpu.Buffer {
		v := make([]byte, 80)
		for i, x := range []float64{float64(q.Grid), spacing, q.SeaLevel, q.BaseHeight, spread} {
			binary.LittleEndian.PutUint32(v[i*4:], math.Float32bits(float32(x)))
		}
		binary.LittleEndian.PutUint32(v[20:], q.Seed)
		binary.LittleEndian.PutUint32(v[24:], uint32(n))
		start, full := .60, 1.35
		if mineral {
			start, full = .07, .55
		}
		for i, x := range []float64{flag(q.Profile["rockyCoasts"] == true), flag(mineral), elevated[0], elevated[1], elevated[2], number(q.Profile, "transportSlopeStart", start), number(q.Profile, "transportSlopeFull", full), sigma, axis, float64(q.Ox), float64(q.Oy)} {
			binary.LittleEndian.PutUint32(v[28+i*4:], math.Float32bits(float32(x)))
		}
		u := must(g.Buffer("material field params", v, gputypes.BufferUsageUniform))
		made = append(made, u)
		return u
	}
	enc := must(g.Device.CreateCommandEncoder(nil))
	enc.CopyBufferToBuffer(q.Height, uint64(q.HeightOffset*4), height, 0, uint64(n*4))
	groups := uint32((q.Grid + 7) / 8)
	all := []map[uint32]*wgpu.BindGroup{}
	defer func() {
		for _, set := range all {
			for _, b := range set {
				b.Release()
			}
		}
	}()
	run := func(entry string, ids []uint32, buffers []*wgpu.Buffer, u *wgpu.Buffer, x, y uint32) {
		entries := []wgpu.BindGroupEntry{{Binding: 0, Buffer: u}}
		for i, id := range ids {
			entries = append(entries, wgpu.BindGroupEntry{Binding: id, Buffer: buffers[i]})
		}
		set := must(g.Groups(e.field[entry], Bindings{2: entries}))
		all = append(all, set)
		check(EncodeDispatch(enc, e.field[entry], set, x, y, 1, nil))
	}
	u0 := uni(0, 0)
	run("mfSourceMain", []uint32{1, 2, 3, 4, 5}, []*wgpu.Buffer{height, src, gx, gy, basin}, u0, groups, groups)
	run("mfDropsMain", []uint32{1, 2, 3, 4, 6, 7}, []*wgpu.Buffer{height, src, gx, gy, deposit, flow}, u0, uint32((n+63)/64), 1)
	blur := func(input, output *wgpu.Buffer, sigma float64) {
		run("mfBlurMain", []uint32{8, 9}, []*wgpu.Buffer{input, c}, uni(sigma, 0), groups, groups)
		run("mfBlurMain", []uint32{8, 9}, []*wgpu.Buffer{c, output}, uni(sigma, 1), groups, groups)
	}
	run("mfCountsMain", []uint32{6, 7, 9}, []*wgpu.Buffer{deposit, flow, a}, uni(0, 1), groups, groups)
	run("mfCountsMain", []uint32{6, 7, 9}, []*wgpu.Buffer{deposit, flow, b}, uni(0, 2), groups, groups)
	blur(src, soft, 9+spread*17)
	blur(a, settled, 2.6)
	blur(a, broad, 9)
	blur(b, runoff, 3.5)
	run("mfCombineMain", []uint32{1, 2, 5, 10, 11, 12, 13, 14}, []*wgpu.Buffer{height, src, basin, field, settled, broad, runoff, soft}, u0, groups, groups)
	check(g.Submit(enc))
	return field, nil
}

// The original Time pass shares one explicit layout across all erosion entries.
// Reusing it keeps four bind groups and one compute pass across every iteration.
func sharedErosionKernels(g *GPU, source string) (map[string]*Kernel, error) {
	uniform := gputypes.BufferBindingTypeUniform
	read := gputypes.BufferBindingTypeReadOnlyStorage
	write := gputypes.BufferBindingTypeStorage
	entry := func(binding uint32, typ gputypes.BufferBindingType) gputypes.BindGroupLayoutEntry {
		return gputypes.BindGroupLayoutEntry{Binding: binding, Visibility: gputypes.ShaderStageCompute, Buffer: &gputypes.BufferBindingLayout{Type: typ}}
	}
	l0, err := g.Device.CreateBindGroupLayout(&wgpu.BindGroupLayoutDescriptor{Label: "erosion world", Entries: []gputypes.BindGroupLayoutEntry{entry(0, uniform)}})
	if err != nil {
		return nil, err
	}
	l1, err := g.Device.CreateBindGroupLayout(&wgpu.BindGroupLayoutDescriptor{Label: "erosion", Entries: []gputypes.BindGroupLayoutEntry{entry(0, uniform), entry(1, read), entry(2, write), entry(3, read), entry(4, write), entry(5, write), entry(6, write), entry(7, write), entry(8, read)}})
	if err != nil {
		l0.Release()
		return nil, err
	}
	layout, err := g.Device.CreatePipelineLayout(&wgpu.PipelineLayoutDescriptor{BindGroupLayouts: []*wgpu.BindGroupLayout{l0, l1}})
	if err != nil {
		l0.Release()
		l1.Release()
		return nil, err
	}
	defer layout.Release()
	module, err := g.Shader("erosion", source)
	if err != nil {
		l0.Release()
		l1.Release()
		return nil, err
	}
	defer module.Release()
	out := map[string]*Kernel{}
	for _, name := range []string{"offsetMain", "fluxMain", "waterMain", "exchangeMain", "settleMain", "carryMain", "thermalMain"} {
		p, err := g.Device.CreateComputePipeline(&wgpu.ComputePipelineDescriptor{Label: name, Layout: layout, Module: module, EntryPoint: name})
		if err != nil {
			for _, k := range out {
				k.Pipeline.Release()
			}
			l0.Release()
			l1.Release()
			return nil, err
		}
		out[name] = &Kernel{Pipeline: p, Layouts: []*wgpu.BindGroupLayout{l0, l1}}
	}
	return out, nil
}
