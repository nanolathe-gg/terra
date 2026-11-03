package terrain

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"github.com/gogpu/wgpu"
	"github.com/nanolathe-gg/terraform/internal/model"
)

func (s *SceneRenderer) clearShapeCache() {
	for _, p := range s.shapePages {
		p.Close()
	}
	s.shapePages = nil
	s.shapeKey = [32]byte{}
}
func (s *SceneRenderer) newShapeFeed(side, x, y int) (*weatherFeed, error) {
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
func (s *SceneRenderer) copyAuthored(src, dst *GPUFeed, r CellRect) error {
	enc, e := s.gpu.Device.CreateCommandEncoder(nil)
	if e != nil {
		return e
	}
	width := r.X1 - r.X0 + 1
	for y := r.Y0; y <= r.Y1; y++ {
		a := (y-src.OriginY)*src.Grid + r.X0 - src.OriginX
		b := (y-dst.OriginY)*dst.Grid + r.X0 - dst.OriginX
		for k := 0; k < 6; k++ {
			enc.CopyBufferToBuffer(src.Planes, uint64((k*src.Cells+a)*4), dst.Planes, uint64((k*dst.Cells+b)*4), uint64(width*4))
		}
		enc.CopyBufferToBuffer(src.Masks, uint64(a*28), dst.Masks, uint64(b*28), uint64(width*28))
	}
	return s.gpu.Submit(enc)
}

// buildShapeFeed caches exact authored 512-cell cores and gathers the requested
// rectangle on the GPU. Each core is replayed with its required dependency halo.
func (s *SceneRenderer) buildShapeFeed(ctx context.Context, nodes []model.Node, c ShapeWindowConfig, region CellRect) (feed *weatherFeed, err error) {
	data, e := json.Marshal([]any{nodes, c.Grid, c.Spacing, c.RefSpacing, c.BaseHeight, c.Sea, c.MinHeight, c.MaxHeight, c.Defaults})
	if e != nil {
		return nil, e
	}
	key := sha256.Sum256(data)
	if s.shapePages == nil || s.shapeKey != key {
		s.clearShapeCache()
		s.shapeKey = key
		s.shapePages = map[[2]int]*weatherFeed{}
	}
	side := max(region.X1-region.X0+1, region.Y1-region.Y0+1)
	feed, err = s.newShapeFeed(side, region.X0, region.Y0)
	if err != nil {
		return nil, err
	}
	owned := feed
	defer func() {
		if err != nil {
			owned.Close()
		}
	}()
	const core = 512
	budget := s.cacheBudget()
	for py := region.Y0 / core; py <= region.Y1/core; py++ {
		for px := region.X0 / core; px <= region.X1/core; px++ {
			if err = ctx.Err(); err != nil {
				return nil, err
			}
			id := [2]int{px, py}
			page := s.shapePages[id]
			pageRect := CellRect{px * core, py * core, min(c.Grid-1, (px+1)*core-1), min(c.Grid-1, (py+1)*core-1)}
			if page == nil {
				page, err = s.newShapeFeed(core, pageRect.X0, pageRect.Y0)
				if err != nil {
					return nil, err
				}
				q := c
				q.Window = pageRect
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
			}
			s.shapeTick++
			page.used = s.shapeTick
			if hit, ok := intersect(pageRect, region); ok {
				if err = s.copyAuthored(&page.GPUFeed, &feed.GPUFeed, hit); err != nil {
					return nil, err
				}
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
				oldest.Close()
				delete(s.shapePages, oldestID)
			}
		}
	}
	return feed, nil
}
