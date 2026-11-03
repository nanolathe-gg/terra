package terrain

import (
	"context"
	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
)

// GPUFeed is the source lattice for a chunk. Origin is a global lattice index;
// Grid is the source row stride. The caller retains ownership until submission.
type GPUFeed struct {
	Planes, Masks, Weather, Field            *wgpu.Buffer
	Maps                                     [3]*wgpu.Buffer
	Grid, Cells, OriginX, OriginY, MaskCount int
}

var maskFlagNames = []string{"paintOn", "scatterOn", "styleOn", "waterOn", "lumpOn", "overrideOn"}

const flagSource = `@group(0) @binding(0) var<storage, read> painted: array<u32>;
@group(0) @binding(1) var<storage, read_write> flags: array<u32, 6>;
fn any_(w: u32,a:u32,b:u32)->u32 {let mask=((1u<<(b-a))-1u)<<a;return select(0u,1u,(w&mask)!=0u);}
@compute @workgroup_size(1) fn main(){let w=painted[0];flags[0]=any_(w,0u,9u);flags[1]=(w>>4u)&1u;flags[2]=any_(w,5u,9u);flags[3]=max(any_(w,9u,12u),(w>>13u)&1u);flags[4]=(w>>12u)&1u;flags[5]=any_(w,14u,18u);}`

func (r *Renderer) feedFromGPU(ctx context.Context, feed *GPUFeed, reg *RenderRegion, gw, gh int, export bool) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	g := r.GPU
	if r.feedKernel == nil {
		var e error
		r.feedKernel, e = g.Kernel(r.Sources["engine-feed.wgsl"], "feedMain")
		if e != nil {
			return e
		}
		r.flagKernel, e = g.Kernel(flagSource, "main")
		if e != nil {
			return e
		}
		r.flagBuffer, e = g.Allocate("mask flags", 24, storageUsage)
		if e != nil {
			return e
		}
	}
	cells := feed.Cells
	if cells == 0 {
		cells = feed.Grid * feed.Grid
	}
	mode := 0
	if feed.Weather != nil {
		mode |= 1
	}
	if feed.Maps[0] != nil {
		mode |= 2
	}
	if export {
		mode |= 4
	}
	if feed.Field != nil {
		mode |= 8
	}
	u, e := FeedUniform(g, map[string]float64{"grid": float64(feed.Grid), "cells": float64(cells), "ox": float64(reg.GridX - feed.OriginX), "oy": float64(reg.GridY - feed.OriginY), "gw": float64(gw), "gh": float64(gh), "cw": float64(reg.GridWidth), "ch": float64(reg.GridHeight), "sea": number(r.Config, "seaLevel", 0), "mode": float64(mode)})
	if e != nil {
		return e
	}
	defer u.Release()
	dummy, e := g.Allocate("absent feed", 16, storageUsage)
	if e != nil {
		return e
	}
	defer dummy.Release()
	painted, e := g.Allocate("painted flags", 16, storageUsage)
	if e != nil {
		return e
	}
	defer painted.Release()
	none := func(b *wgpu.Buffer) *wgpu.Buffer {
		if b != nil {
			return b
		}
		return dummy
	}
	set, e := g.Groups(r.feedKernel, Bindings{0: {{Binding: 0, Buffer: u}, {Binding: 1, Buffer: feed.Planes}, {Binding: 2, Buffer: feed.Masks}}, 2: {{Binding: 0, Buffer: none(feed.Weather)}, {Binding: 1, Buffer: none(feed.Maps[0])}, {Binding: 2, Buffer: none(feed.Maps[1])}, {Binding: 3, Buffer: none(feed.Maps[2])}, {Binding: 4, Buffer: painted}, {Binding: 5, TextureView: r.view(r.HeightTexture, false, -1)}, {Binding: 6, TextureView: r.view(r.RouteTexture, false, -1)}, {Binding: 7, TextureView: r.view(r.GridTexture, true, -1)}, {Binding: 8, TextureView: r.view(r.MaskTexture, true, -1)}, {Binding: 9, Buffer: none(feed.Field)}}})
	if e != nil {
		return e
	}
	defer func() {
		for _, bg := range set {
			bg.Release()
		}
	}()
	flags, e := g.Groups(r.flagKernel, Bindings{0: {{Binding: 0, Buffer: painted}, {Binding: 1, Buffer: r.flagBuffer}}})
	if e != nil {
		return e
	}
	defer func() {
		for _, bg := range flags {
			bg.Release()
		}
	}()
	enc, e := g.Device.CreateCommandEncoder(nil)
	if e != nil {
		return e
	}
	if e = EncodeDispatch(enc, r.feedKernel, set, uint32((gw+7)/8), uint32((gh+7)/8), 1, nil); e != nil {
		return e
	}
	if e = EncodeDispatch(enc, r.flagKernel, flags, 1, 1, 1, nil); e != nil {
		return e
	}
	for i, name := range maskFlagNames {
		enc.CopyBufferToBuffer(r.flagBuffer, uint64(i*4), r.UniformBuffer, uint64(r.Uniform.Fields[name].Offset), 4)
	}
	if e = g.Submit(enc); e != nil {
		return e
	}
	r.gpuFlags = true
	return nil
}
func (r *Renderer) closeFeed() {
	if r.flagBuffer != nil {
		r.flagBuffer.Release()
	}
	for _, k := range []*Kernel{r.feedKernel, r.flagKernel} {
		if k == nil {
			continue
		}
		k.Pipeline.Release()
		for _, l := range k.Layouts {
			l.Release()
		}
	}
}

var _ = gputypes.BufferUsageStorage
