package terrain

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"

	"github.com/gogpu/wgpu"
	"github.com/nanolathe-gg/terraform/internal/model"
)

type weatherFeed struct {
	GPUFeed
	owned []*wgpu.Buffer
	used  uint64
	bytes int
}

func (f *weatherFeed) Close() {
	for _, b := range f.owned {
		b.Release()
	}
	f.owned = nil
}
func (s *SceneRenderer) clearWeatherCache() {
	for _, p := range s.weatherPages {
		p.Close()
	}
	s.weatherPages = nil
	s.weatherKey = [32]byte{}
}
func (s *SceneRenderer) newWeatherFeed(side, originX, originY int, material bool) (*weatherFeed, error) {
	cells := side * side
	f := &weatherFeed{GPUFeed: GPUFeed{Grid: side, Cells: cells, OriginX: originX, OriginY: originY, MaskCount: 25}}
	alloc := func(label string, n int) (*wgpu.Buffer, error) {
		b, e := s.gpu.Allocate(label, uint64(n), storageUsage)
		if e == nil {
			f.owned = append(f.owned, b)
			f.bytes += n
		}
		return b, e
	}
	var err error
	defer func() {
		if err != nil {
			f.Close()
		}
	}()
	if f.Planes, err = alloc("weather authored", 6*cells*4); err != nil {
		return nil, err
	}
	if f.Masks, err = alloc("weather masks", 7*cells*4); err != nil {
		return nil, err
	}
	if f.Weather, err = alloc("weather heights", 2*cells*4); err != nil {
		return nil, err
	}
	for i := range f.Maps {
		if f.Maps[i], err = alloc("weather map", cells*4); err != nil {
			return nil, err
		}
	}
	if material {
		if f.Field, err = alloc("weather material", cells*16); err != nil {
			return nil, err
		}
	}
	return f, nil
}

// copyWeather copies an inclusive rectangle between square GPU feed lattices.
func (s *SceneRenderer) copyWeather(src, dst *weatherFeed, hit CellRect) error {
	enc, e := s.gpu.Device.CreateCommandEncoder(nil)
	if e != nil {
		return e
	}
	width := hit.X1 - hit.X0 + 1
	for y := hit.Y0; y <= hit.Y1; y++ {
		a := (y-src.OriginY)*src.Grid + hit.X0 - src.OriginX
		b := (y-dst.OriginY)*dst.Grid + hit.X0 - dst.OriginX
		for k := 0; k < 6; k++ {
			enc.CopyBufferToBuffer(src.Planes, uint64((k*src.Cells+a)*4), dst.Planes, uint64((k*dst.Cells+b)*4), uint64(width*4))
		}
		enc.CopyBufferToBuffer(src.Masks, uint64(a*28), dst.Masks, uint64(b*28), uint64(width*28))
		for k := 0; k < 2; k++ {
			enc.CopyBufferToBuffer(src.Weather, uint64((k*src.Cells+a)*4), dst.Weather, uint64((k*dst.Cells+b)*4), uint64(width*4))
		}
		for k := 0; k < 3; k++ {
			enc.CopyBufferToBuffer(src.Maps[k], uint64(a*4), dst.Maps[k], uint64(b*4), uint64(width*4))
		}
		if src.Field != nil && dst.Field != nil {
			enc.CopyBufferToBuffer(src.Field, uint64(a*16), dst.Field, uint64(b*16), uint64(width*16))
		}
	}
	return s.gpu.Submit(enc)
}
func (s *SceneRenderer) weatherPage(ctx context.Context, nodes []model.Node, c ShapeWindowConfig, px, py, core, apron int, o DrawOptions) (*weatherFeed, error) {
	x, y := px*core, py*core
	coreRect := CellRect{x, y, min(c.Grid-1, x+core-1), min(c.Grid-1, y+core-1)}
	out, e := s.newWeatherFeed(core, x, y, o.MaterialWeathering > 0)
	if e != nil {
		return nil, e
	}
	pageSide := min(c.Grid, core+2*apron)
	ox, oy := max(0, min(c.Grid-pageSide, x-apron)), max(0, min(c.Grid-pageSide, y-apron))
	q := c
	q.Window = CellRect{ox, oy, ox + pageSide - 1, oy + pageSide - 1}
	_, e = s.shape.evaluateShapeWindow(ctx, q, nodes, false, false, func(_ CellRect, planes, masks *wgpu.Buffer) error {
		er, e := s.erosion.RunGPU(ctx, ErosionRequest{Planes: planes, Masks: masks, Grid: pageSide, Size: s.renderer.Size, Ox: ox, Oy: oy, RateMask: 14, Age: int(s.renderer.num("erosionAge", 200)), SeaLevel: c.Sea, Spacing: c.Spacing, Rain: s.renderer.num("erosionRain", 1), TalusAngle: s.renderer.num("talusAngle", 40), Envelope: s.renderer.num("erosionEnvelope", 2), Sand: s.renderer.num("sand", 0), WetReach: s.renderer.num("wetReach", 3), TalusFull: s.renderer.num("talusFull", 2.5), WearFull: s.renderer.num("wearFull", 1.5), FlowK: s.renderer.num("flowK", 30)})
		if e != nil {
			return e
		}
		defer er.Close()
		var field *wgpu.Buffer
		if out.Field != nil {
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
		src := &weatherFeed{GPUFeed: GPUFeed{Planes: planes, Masks: masks, Weather: er.Weather, Maps: er.Maps, Field: field, Grid: pageSide, Cells: pageSide * pageSide, OriginX: ox, OriginY: oy}}
		return s.copyWeather(src, out, coreRect)
	})
	if e != nil {
		out.Close()
		return nil, e
	}
	return out, nil
}

// buildWeatherFeed reuses bounded Time pages. Small maps follow the original
// whole-map pass; larger maps use 512-cell cores with 128-cell aprons.
func (s *SceneRenderer) buildWeatherFeed(ctx context.Context, nodes []model.Node, c ShapeWindowConfig, region CellRect, o DrawOptions) (feed *weatherFeed, err error) {
	if s.erosion == nil {
		s.erosion, err = s.renderer.NewErosion()
		if err != nil {
			return nil, err
		}
	}
	keyData, e := json.Marshal([]any{nodes, c.Grid, c.Spacing, c.RefSpacing, c.BaseHeight, c.Sea, c.MinHeight, c.MaxHeight, c.Defaults, s.renderer.Size, s.renderer.Variant, s.config["column"], s.config["material"], o.MaterialWeathering > 0, o.RefinementSeed, o.DepositSpread})
	if e != nil {
		return nil, e
	}
	key := sha256.Sum256(keyData)
	if s.weatherPages == nil || s.weatherKey != key {
		s.clearWeatherCache()
		s.weatherKey = key
		s.weatherPages = map[[2]int]*weatherFeed{}
	}
	side := max(region.X1-region.X0+1, region.Y1-region.Y0+1)
	feed, err = s.newWeatherFeed(side, region.X0, region.Y0, o.MaterialWeathering > 0)
	if err != nil {
		return nil, err
	}
	owned := feed
	defer func() {
		if err != nil {
			owned.Close()
		}
	}()
	core, apron := 512, 128
	if c.Grid <= 1168 {
		core, apron = c.Grid, 0
	}
	budget := s.cacheBudget()
	for py := region.Y0 / core; py <= region.Y1/core; py++ {
		for px := region.X0 / core; px <= region.X1/core; px++ {
			if err = ctx.Err(); err != nil {
				return nil, err
			}
			id := [2]int{px, py}
			page := s.weatherPages[id]
			if page == nil {
				page, err = s.weatherPage(ctx, nodes, c, px, py, core, apron, o)
				if err != nil {
					return nil, fmt.Errorf("weather page %d,%d: %w", px, py, err)
				}
				if page.bytes <= budget {
					s.weatherPages[id] = page
				}
				s.weatherRuns++
			}
			s.weatherTick++
			page.used = s.weatherTick
			hit, ok := intersect(CellRect{px * core, py * core, min(c.Grid-1, (px+1)*core-1), min(c.Grid-1, (py+1)*core-1)}, region)
			if ok {
				if err = s.copyWeather(page, feed, hit); err != nil {
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
				for k, p := range s.weatherPages {
					total += p.bytes
					if k != id && (oldest == nil || p.used < oldest.used) {
						oldest, oldestID = p, k
					}
				}
				if total <= budget || oldest == nil {
					break
				}
				oldest.Close()
				delete(s.weatherPages, oldestID)
			}
		}
	}
	return feed, nil
}
