package terrain

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
	"github.com/nanolathe-gg/terraform/internal/membudget"
	"github.com/nanolathe-gg/terraform/internal/model"
	"time"
)

func (s *SceneRenderer) clearShapeCache() {
	for _, p := range s.shapePages {
		p.Close()
	}
	s.shapePages = nil
	s.shapeKey = [32]byte{}
	s.shapeNodes = nil
	s.shapeNodesSet = false
}
func (s *SceneRenderer) newShapeFeed(side, x, y int, additional ...int) (*weatherFeed, error) {
	limits := membudget.FromConfig(s.config)
	reserved := s.reservedGPUBytes()
	for _, n := range additional {
		reserved += int64(n)
	}
	if err := membudget.Require("Authored feed", reserved+membudget.Area(side, side, 52), limits.GPU); err != nil {
		return nil, err
	}
	cells := side * side
	f := &weatherFeed{GPUFeed: GPUFeed{Grid: side, Cells: cells, OriginX: x, OriginY: y, MaskCount: 25}}
	p, e := s.gpu.Allocate("cached authored planes", uint64(6*cells*4), storageUsage)
	if e != nil {
		return nil, e
	}
	f.Planes = p
	f.owned = append(f.owned, p)
	f.bytes += 6 * cells * 4
	m, e := s.gpu.Allocate("cached authored masks", uint64(7*cells*4), storageUsage)
	if e != nil {
		f.Close()
		return nil, e
	}
	f.Masks = m
	f.owned = append(f.owned, m)
	f.bytes += 7 * cells * 4
	return f, nil
}

// Copy raw u32 words, preserving all float bit patterns and packed mask bytes.
// One invocation handles one cell, replacing seven copy commands per row.
const authoredGatherSource = `
struct Gather { srcGrid:u32, srcCells:u32, dstGrid:u32, dstCells:u32, srcX:u32, srcY:u32, dstX:u32, dstY:u32, width:u32, height:u32, };
@group(0) @binding(0) var<uniform> p: Gather;
@group(0) @binding(1) var<storage, read> srcPlanes: array<u32>;
@group(0) @binding(2) var<storage, read> srcMasks: array<u32>;
@group(0) @binding(3) var<storage, read_write> dstPlanes: array<u32>;
@group(0) @binding(4) var<storage, read_write> dstMasks: array<u32>;
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) id:vec3u) {
 if id.x>=p.width || id.y>=p.height {return;}
 let a=(p.srcY+id.y)*p.srcGrid+p.srcX+id.x;
 let b=(p.dstY+id.y)*p.dstGrid+p.dstX+id.x;
 for(var k=0u;k<6u;k++){dstPlanes[k*p.dstCells+b]=srcPlanes[k*p.srcCells+a];}
 for(var k=0u;k<7u;k++){dstMasks[b*7u+k]=srcMasks[a*7u+k];}
}`

func (s *SceneRenderer) closeShapeGather() {
	if s.shapeGather == nil {
		return
	}
	s.shapeGather.Pipeline.Release()
	for _, layout := range s.shapeGather.Layouts {
		layout.Release()
	}
	s.shapeGather = nil
}
func (s *SceneRenderer) copyAuthored(src, dst *GPUFeed, r CellRect) error {
	if s.shapeGather == nil {
		var err error
		s.shapeGather, err = s.gpu.Kernel(authoredGatherSource, "main")
		if err != nil {
			return err
		}
	}
	width, height := r.X1-r.X0+1, r.Y1-r.Y0+1
	values := []int{src.Grid, src.Cells, dst.Grid, dst.Cells, r.X0 - src.OriginX, r.Y0 - src.OriginY, r.X0 - dst.OriginX, r.Y0 - dst.OriginY, width, height}
	for _, v := range values {
		if v < 0 {
			return fmt.Errorf("invalid authored gather rectangle")
		}
	}
	if width <= 0 || height <= 0 || values[4]+width > src.Grid || values[6]+width > dst.Grid || (values[5]+height)*src.Grid > src.Cells || (values[7]+height)*dst.Grid > dst.Cells {
		return fmt.Errorf("authored gather rectangle outside buffer")
	}
	data := make([]byte, 48)
	for i, v := range values {
		binary.LittleEndian.PutUint32(data[i*4:], uint32(v))
	}
	uniform, err := s.gpu.Buffer("authored gather uniforms", data, gputypes.BufferUsageUniform)
	if err != nil {
		return err
	}
	defer uniform.Release()
	return s.gpu.Dispatch(s.shapeGather, Bindings{0: {{Binding: 0, Buffer: uniform}, {Binding: 1, Buffer: src.Planes}, {Binding: 2, Buffer: src.Masks}, {Binding: 3, Buffer: dst.Planes}, {Binding: 4, Buffer: dst.Masks}}}, uint32((width+7)/8), uint32((height+7)/8), 1)
}

// buildShapeFeed caches exact authored 512-cell cores and gathers the requested
// rectangle on the GPU. Each core is replayed with its required dependency halo.
func (s *SceneRenderer) buildShapeFeed(ctx context.Context, nodes []model.Node, c ShapeWindowConfig, region CellRect) (feed *weatherFeed, err error) {
	started := time.Now()
	defer func() { s.shapeProfile.ShapeFeedMilliseconds += elapsed(started) }()
	graphStart := time.Now()
	data, e := json.Marshal([]any{c.Grid, c.Spacing, c.RefSpacing, c.BaseHeight, c.Sea, c.MinHeight, c.MaxHeight, c.Defaults})
	if e != nil {
		return nil, e
	}
	key := sha256.Sum256(data)
	if s.shapePages == nil || s.shapeKey != key {
		s.clearShapeCache()
		s.shapeKey = key
		s.shapePages = map[[2]int]*weatherFeed{}
	}
	changed := !s.shapeNodesSet || !model.NodesEqual(s.shapeNodes, nodes)
	if s.shapeNodesSet && changed {
		diffStart := time.Now()
		dirty, full, e := ChangedShapeRegion(s.shapeNodes, nodes, c)
		s.shapeProfile.GraphDiffMilliseconds += elapsed(diffStart)
		if e != nil {
			s.clearShapeCache()
			return nil, e
		}
		if full {
			for id, page := range s.shapePages {
				page.Close()
				delete(s.shapePages, id)
			}
		} else if dirty != nil {
			for id, page := range s.shapePages {
				box := CellRect{id[0] * 512, id[1] * 512, min(c.Grid-1, (id[0]+1)*512-1), min(c.Grid-1, (id[1]+1)*512-1)}
				if _, hit := intersect(box, *dirty); hit {
					page.Close()
					delete(s.shapePages, id)
				}
			}
		}
	}
	if changed {
		cloneStart := time.Now()
		s.shapeNodes = model.CloneNodes(nodes)
		s.shapeNodesSet = true
		s.shapeProfile.GraphCloneMilliseconds += elapsed(cloneStart)
	}
	s.shapeProfile.GraphMilliseconds += elapsed(graphStart)
	allocStart := time.Now()
	side := max(region.X1-region.X0+1, region.Y1-region.Y0+1)
	feed, err = s.newShapeFeed(side, region.X0, region.Y0)
	if err != nil {
		return nil, err
	}
	s.shapeProfile.FeedAllocateMilliseconds += elapsed(allocStart)
	owned := feed
	defer func() {
		if err != nil {
			owned.Close()
		}
	}()
	const core = 512
	budget := s.shapeCacheBudget()
	for py := region.Y0 / core; py <= region.Y1/core; py++ {
		for px := region.X0 / core; px <= region.X1/core; px++ {
			if err = ctx.Err(); err != nil {
				return nil, err
			}
			id := [2]int{px, py}
			page := s.shapePages[id]
			pageRect := CellRect{px * core, py * core, min(c.Grid-1, (px+1)*core-1), min(c.Grid-1, (py+1)*core-1)}
			if page == nil {
				s.shapeProfile.PageMisses++
				pageStart := time.Now()
				page, err = s.newShapeFeed(core, pageRect.X0, pageRect.Y0, feed.bytes)
				if err != nil {
					return nil, err
				}
				q := c
				q.Window = pageRect
				q.ReservedGPUBytes = s.reservedGPUBytes() + int64(feed.bytes+page.bytes)
				_, err = s.shape.evaluateShapeWindow(ctx, q, nodes, true, false, func(target CellRect, p, m *wgpu.Buffer) error {
					w, h := target.X1-target.X0+1, target.Y1-target.Y0+1
					src := GPUFeed{Planes: p, Masks: m, Grid: w, Cells: w * h, OriginX: target.X0, OriginY: target.Y0}
					return s.copyAuthored(&src, &page.GPUFeed, pageRect)
				})
				if err != nil {
					page.Close()
					return nil, fmt.Errorf("authored page %d,%d: %w", px, py, err)
				}
				if page.bytes <= budget {
					s.shapePages[id] = page
				}
				s.shapeRuns++
				s.shapeProfile.PageMilliseconds += elapsed(pageStart)
			}
			s.shapeTick++
			page.used = s.shapeTick
			if hit, ok := intersect(pageRect, region); ok {
				gatherStart := time.Now()
				if err = s.copyAuthored(&page.GPUFeed, &feed.GPUFeed, hit); err != nil {
					return nil, err
				}
				s.shapeProfile.GatherMilliseconds += elapsed(gatherStart)
			}
			if page.bytes > budget {
				page.Close()
				continue
			}
			for {
				total := 0
				var oldest *weatherFeed
				var oldestID [2]int
				for k, p := range s.shapePages {
					total += p.bytes
					if k != id && (oldest == nil || p.used < oldest.used) {
						oldest, oldestID = p, k
					}
				}
				if total <= budget || oldest == nil {
					break
				}
				s.cacheEvictions++
				s.cacheEvictedBytes += uint64(oldest.bytes)
				oldest.Close()
				delete(s.shapePages, oldestID)
			}
		}
	}
	return feed, nil
}
