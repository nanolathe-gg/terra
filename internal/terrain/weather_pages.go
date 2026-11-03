package terrain

import (
	"context"
	"fmt"

	"github.com/gogpu/wgpu"
	"github.com/nanolathe-gg/terraform/internal/model"
)

type weatherFeed struct {
	GPUFeed
	owned []*wgpu.Buffer
}

func (f *weatherFeed) Close() {
	for _, b := range f.owned {
		b.Release()
	}
}

// buildWeatherFeed evaluates the same 512-cell cores and 128-cell apron used
// by the paged editor, then copies each core into one bounded GPU feed.
func (s *SceneRenderer) buildWeatherFeed(ctx context.Context, nodes []model.Node, c ShapeWindowConfig, region CellRect, o DrawOptions) (feed *weatherFeed, err error) {
	if s.erosion == nil {
		s.erosion, err = s.renderer.NewErosion()
		if err != nil {
			return nil, err
		}
	}
	side := max(region.X1-region.X0+1, region.Y1-region.Y0+1)
	cells := side * side
	feed = &weatherFeed{GPUFeed: GPUFeed{Grid: side, Cells: cells, OriginX: region.X0, OriginY: region.Y0, MaskCount: 25}}
	ownedFeed := feed
	defer func() {
		if err != nil {
			ownedFeed.Close()
		}
	}()
	alloc := func(label string, n int) *wgpu.Buffer {
		b, e := s.gpu.Allocate(label, uint64(n), storageUsage)
		if e != nil {
			err = e
			return nil
		}
		feed.owned = append(feed.owned, b)
		return b
	}
	feed.Planes = alloc("gather authored planes", 6*cells*4)
	feed.Masks = alloc("gather authored masks", 7*cells*4)
	feed.Weather = alloc("gather weather", 2*cells*4)
	for i := range feed.Maps {
		feed.Maps[i] = alloc("gather weather map", cells*4)
	}
	if o.MaterialWeathering > 0 {
		feed.Field = alloc("gather material", cells*16)
	}
	if err != nil {
		return nil, err
	}
	const core, apron = 512, 128
	grid := c.Grid
	pageSide := min(grid, core+2*apron)
	for py := region.Y0 / core; py <= region.Y1/core; py++ {
		for px := region.X0 / core; px <= region.X1/core; px++ {
			if err = ctx.Err(); err != nil {
				return nil, err
			}
			x, y := px*core, py*core
			coreRect := CellRect{x, y, min(grid-1, x+core-1), min(grid-1, y+core-1)}
			hit, ok := intersect(coreRect, region)
			if !ok {
				continue
			}
			ox, oy := max(0, min(grid-pageSide, x-apron)), max(0, min(grid-pageSide, y-apron))
			page := CellRect{ox, oy, ox + pageSide - 1, oy + pageSide - 1}
			q := c
			q.Window = page
			_, err = s.shape.evaluateShapeWindow(ctx, q, nodes, false, func(_ CellRect, planes, masks *wgpu.Buffer) error {
				er, e := s.erosion.RunGPU(ctx, ErosionRequest{Planes: planes, Masks: masks, Grid: pageSide, Size: s.renderer.Size, Ox: ox, Oy: oy, RateMask: 14, Age: int(s.renderer.num("erosionAge", 200)), SeaLevel: c.Sea, Spacing: c.Spacing, Rain: s.renderer.num("erosionRain", 1), TalusAngle: s.renderer.num("talusAngle", 40), Envelope: s.renderer.num("erosionEnvelope", 2), Sand: s.renderer.num("sand", 0), WetReach: s.renderer.num("wetReach", 3), TalusFull: s.renderer.num("talusFull", 2.5), WearFull: s.renderer.num("wearFull", 1.5), FlowK: s.renderer.num("flowK", 30)})
				if e != nil {
					return e
				}
				defer er.Close()
				var field *wgpu.Buffer
				if feed.Field != nil {
					profile := map[string]any{}
					for k, v := range object(s.config, "material") {
						profile[k] = v
					}
					profile["mineral"] = s.renderer.Variant["transition"] == "mineral"
					field, e = s.erosion.MaterialField(MaterialFieldRequest{Height: er.Weather, HeightOffset: pageSide * pageSide, Grid: pageSide, Size: s.renderer.Size, Ox: ox, Oy: oy, Spacing: c.Spacing, SeaLevel: c.Sea, BaseHeight: c.BaseHeight, Seed: o.RefinementSeed, DepositSpread: o.DepositSpread, Profile: profile})
					if e != nil {
						return e
					}
					defer field.Release()
				}
				enc, e := s.gpu.Device.CreateCommandEncoder(nil)
				if e != nil {
					return e
				}
				pn := pageSide * pageSide
				width := hit.X1 - hit.X0 + 1
				for row := hit.Y0; row <= hit.Y1; row++ {
					src := (row-oy)*pageSide + hit.X0 - ox
					dst := (row-region.Y0)*side + hit.X0 - region.X0
					for k := 0; k < 6; k++ {
						enc.CopyBufferToBuffer(planes, uint64((k*pn+src)*4), feed.Planes, uint64((k*cells+dst)*4), uint64(width*4))
					}
					enc.CopyBufferToBuffer(masks, uint64(src*28), feed.Masks, uint64(dst*28), uint64(width*28))
					for k := 0; k < 2; k++ {
						enc.CopyBufferToBuffer(er.Weather, uint64((k*pn+src)*4), feed.Weather, uint64((k*cells+dst)*4), uint64(width*4))
					}
					for k := 0; k < 3; k++ {
						enc.CopyBufferToBuffer(er.Maps[k], uint64(src*4), feed.Maps[k], uint64(dst*4), uint64(width*4))
					}
					if field != nil {
						enc.CopyBufferToBuffer(field, uint64(src*16), feed.Field, uint64(dst*16), uint64(width*16))
					}
				}
				return s.gpu.Submit(enc)
			})
			if err != nil {
				return nil, fmt.Errorf("weather page %d,%d: %w", px, py, err)
			}
		}
	}
	return feed, nil
}
