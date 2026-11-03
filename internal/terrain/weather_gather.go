package terrain

import (
	"encoding/binary"
	"fmt"
	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
)

const weatherGatherHeader = `
struct Gather { srcGrid:u32,srcCells:u32,dstGrid:u32,dstCells:u32,srcX:u32,srcY:u32,dstX:u32,dstY:u32,width:u32,height:u32, };
@group(0) @binding(0) var<uniform> p:Gather;
`
const weatherGatherIndices = `
 if id.x>=p.width||id.y>=p.height {return;}
 let a=(p.srcY+id.y)*p.srcGrid+p.srcX+id.x;
 let b=(p.dstY+id.y)*p.dstGrid+p.dstX+id.x;
`

func weatherAuthoredGatherSource(field bool) string {
	source := weatherGatherHeader + `
@group(0) @binding(1) var<storage,read> srcPlanes:array<u32>;
@group(0) @binding(2) var<storage,read> srcMasks:array<u32>;
@group(0) @binding(3) var<storage,read_write> dstPlanes:array<u32>;
@group(0) @binding(4) var<storage,read_write> dstMasks:array<u32>;
`
	if field {
		source += `
@group(0) @binding(5) var<storage,read> srcField:array<u32>;
@group(0) @binding(6) var<storage,read_write> dstField:array<u32>;
`
	}
	source += `@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u) {` + weatherGatherIndices + `
 for(var k=0u;k<6u;k++){dstPlanes[k*p.dstCells+b]=srcPlanes[k*p.srcCells+a];}
 for(var k=0u;k<7u;k++){dstMasks[b*7u+k]=srcMasks[a*7u+k];}
`
	if field {
		source += `for(var k=0u;k<4u;k++){dstField[b*4u+k]=srcField[a*4u+k];}`
	}
	return source + `}`
}

const weatherMapsGatherSource = weatherGatherHeader + `
@group(0) @binding(1) var<storage,read> srcWeather:array<u32>;
@group(0) @binding(2) var<storage,read> srcMap0:array<u32>;
@group(0) @binding(3) var<storage,read> srcMap1:array<u32>;
@group(0) @binding(4) var<storage,read> srcMap2:array<u32>;
@group(0) @binding(5) var<storage,read_write> dstWeather:array<u32>;
@group(0) @binding(6) var<storage,read_write> dstMap0:array<u32>;
@group(0) @binding(7) var<storage,read_write> dstMap1:array<u32>;
@group(0) @binding(8) var<storage,read_write> dstMap2:array<u32>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) id:vec3u) {` + weatherGatherIndices + `
 for(var k=0u;k<2u;k++){dstWeather[k*p.dstCells+b]=srcWeather[k*p.srcCells+a];}
 dstMap0[b]=srcMap0[a];dstMap1[b]=srcMap1[a];dstMap2[b]=srcMap2[a];
}`

func (s *SceneRenderer) closeWeatherGather() {
	for i, k := range s.weatherGather {
		if k != nil {
			k.Pipeline.Release()
			for _, l := range k.Layouts {
				l.Release()
			}
			s.weatherGather[i] = nil
		}
	}
}

// Two compute copies replace thousands of per-row WebGPU calls. The second
// pass uses eight storage bindings, within the standard WebGPU device limit.
// All planes are copied as u32 so NaN payloads and signed zero stay exact.
func (s *SceneRenderer) copyWeather(src, dst *weatherFeed, hit CellRect) error {
	w, h := hit.X1-hit.X0+1, hit.Y1-hit.Y0+1
	values := []int{src.Grid, src.Cells, dst.Grid, dst.Cells, hit.X0 - src.OriginX, hit.Y0 - src.OriginY, hit.X0 - dst.OriginX, hit.Y0 - dst.OriginY, w, h}
	for _, v := range values {
		if v < 0 {
			return fmt.Errorf("invalid weather gather rectangle")
		}
	}
	if w <= 0 || h <= 0 || values[4]+w > src.Grid || values[6]+w > dst.Grid || (values[5]+h)*src.Grid > src.Cells || (values[7]+h)*dst.Grid > dst.Cells {
		return fmt.Errorf("weather gather rectangle outside buffer")
	}
	field := src.Field != nil && dst.Field != nil
	variant := 0
	if field {
		variant = 1
	}
	var err error
	if s.weatherGather[variant] == nil {
		s.weatherGather[variant], err = s.gpu.Kernel(weatherAuthoredGatherSource(field), "main")
		if err != nil {
			return err
		}
	}
	if s.weatherGather[2] == nil {
		s.weatherGather[2], err = s.gpu.Kernel(weatherMapsGatherSource, "main")
		if err != nil {
			return err
		}
	}
	data := make([]byte, 48)
	for i, v := range values {
		binary.LittleEndian.PutUint32(data[i*4:], uint32(v))
	}
	uniform, err := s.gpu.Buffer("weather gather dimensions", data, gputypes.BufferUsageUniform)
	if err != nil {
		return err
	}
	defer uniform.Release()
	first := []wgpu.BindGroupEntry{{Binding: 0, Buffer: uniform}, {Binding: 1, Buffer: src.Planes}, {Binding: 2, Buffer: src.Masks}, {Binding: 3, Buffer: dst.Planes}, {Binding: 4, Buffer: dst.Masks}}
	if field {
		first = append(first, wgpu.BindGroupEntry{Binding: 5, Buffer: src.Field}, wgpu.BindGroupEntry{Binding: 6, Buffer: dst.Field})
	}
	second := []wgpu.BindGroupEntry{{Binding: 0, Buffer: uniform}, {Binding: 1, Buffer: src.Weather}, {Binding: 2, Buffer: src.Maps[0]}, {Binding: 3, Buffer: src.Maps[1]}, {Binding: 4, Buffer: src.Maps[2]}, {Binding: 5, Buffer: dst.Weather}, {Binding: 6, Buffer: dst.Maps[0]}, {Binding: 7, Buffer: dst.Maps[1]}, {Binding: 8, Buffer: dst.Maps[2]}}
	enc, err := s.gpu.Device.CreateCommandEncoder(nil)
	if err != nil {
		return err
	}
	for _, pass := range []struct {
		k       *Kernel
		entries []wgpu.BindGroupEntry
	}{{s.weatherGather[variant], first}, {s.weatherGather[2], second}} {
		groups, e := s.gpu.Groups(pass.k, Bindings{0: pass.entries})
		if e != nil {
			return e
		}
		defer func(groups map[uint32]*wgpu.BindGroup) {
			for _, g := range groups {
				g.Release()
			}
		}(groups)
		if e = EncodeDispatch(enc, pass.k, groups, uint32((w+7)/8), uint32((h+7)/8), 1, nil); e != nil {
			return e
		}
	}
	return s.gpu.Submit(enc)
}
func (s *SceneRenderer) borrowWeatherPage(region CellRect, core int) *weatherFeed {
	if core <= 0 || region.X0/core != region.X1/core || region.Y0/core != region.Y1/core {
		return nil
	}
	page := s.weatherPages[[2]int{region.X0 / core, region.Y0 / core}]
	if page == nil {
		return nil
	}
	s.weatherTick++
	page.used = s.weatherTick
	return &weatherFeed{GPUFeed: page.GPUFeed, borrowedFrom: page}
}
