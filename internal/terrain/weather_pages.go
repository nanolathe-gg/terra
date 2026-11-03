package terrain

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/gogpu/wgpu"
	"github.com/nanolathe-gg/terraform/internal/membudget"
	"github.com/nanolathe-gg/terraform/internal/model"
)

type weatherFeed struct {
	owner *GPU
	GPUFeed
	owned        []*wgpu.Buffer
	borrowedFrom *weatherFeed
	used         uint64
	bytes        int
}

func (f *weatherFeed) Close() {
	// Never subtract a cache page's bytes while its submitted gather still owns
	// those buffers. Old/fenced pages do not cause another queue wait.
	if len(f.owned) > 0 && f.owner != nil && !f.owner.cacheUseCompleted(f.lastUse) {
		if err := f.owner.waitCacheUses(context.Background()); err != nil {
			f.owner.errorMu.Lock()
			f.owner.asyncError = err
			handler := f.owner.OnError
			f.owner.errorMu.Unlock()
			if handler != nil {
				handler(err)
			}
		}
	}

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
	s.weatherNodes = nil
	s.weatherNodesSet = false
}
func (s *SceneRenderer) invalidateStaleWeather(nodes []model.Node) {
	if s.weatherNodesSet && !model.NodesEqual(s.weatherNodes, nodes) {
		s.clearWeatherCache()
	}
}

func (s *SceneRenderer) newWeatherFeed(side, originX, originY int, material bool) (*weatherFeed, error) {
	limits := membudget.FromConfig(s.config)
	if err := membudget.Require("Weather feed", s.reservedGPUBytes()+weatherFeedBytes(side, material), limits.GPU); err != nil {
		return nil, err
	}
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

func weatherFeedBytes(side int, material bool) int64 {
	per := int64(72)
	if material {
		per += 16
	}
	return membudget.Area(side, side, per)
}
func weatherShapeConfig(c ShapeWindowConfig, px, py, core, apron int, o DrawOptions) ShapeWindowConfig {
	side := min(c.Grid, core+2*apron)
	x, y := px*core, py*core
	ox, oy := max(0, min(c.Grid-side, x-apron)), max(0, min(c.Grid-side, y-apron))
	c.Window = CellRect{ox, oy, ox + side - 1, oy + side - 1}
	c.ReservedGPUBytes += weatherFeedBytes(core, o.MaterialWeathering > 0)
	// Time's temporary buffers and result are simultaneous. Its temporaries are
	// released before MaterialField, which retains only the 20-byte/cell result.
	n := int64(side) * int64(side)
	tiles := int64((side + 7) / 8)
	c.CallbackGPUBytes = 140*n + 12*tiles*tiles + 176
	if o.MaterialWeathering > 0 {
		c.CallbackGPUBytes = max(c.CallbackGPUBytes, 92*n+80*11)
	}
	return c
}
func (s *SceneRenderer) weatherPage(ctx context.Context, nodes []model.Node, c ShapeWindowConfig, px, py, core, apron int, o DrawOptions) (*weatherFeed, error) {
	x, y := px*core, py*core
	coreRect := CellRect{x, y, min(c.Grid-1, x+core-1), min(c.Grid-1, y+core-1)}
	q := weatherShapeConfig(c, px, py, core, apron, o)
	var out *weatherFeed
	pageSide := min(c.Grid, core+2*apron)
	ox, oy := q.Window.X0, q.Window.Y0

	_, e := s.shape.evaluateShapeWindow(ctx, q, nodes, false, false, func(_ CellRect, planes, masks *wgpu.Buffer) error {
		var err error
		out, err = s.newWeatherFeed(core, x, y, o.MaterialWeathering > 0)
		if out != nil {
			out.owner = s.gpu
		}
		if err != nil {
			return err
		}
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
		if out != nil {
			out.Close()
		}
		return nil, e
	}
	return out, nil
}

// buildWeatherFeed reuses bounded Time pages. Small maps follow the original
// whole-map pass; larger maps use 512-cell cores with 128-cell aprons.
func (s *SceneRenderer) buildWeatherFeed(ctx context.Context, nodes []model.Node, c ShapeWindowConfig, region CellRect, o DrawOptions) (feed *weatherFeed, err error) {
	keyData, e := json.Marshal([]any{nodes, c.Grid, c.Spacing, c.RefSpacing, c.BaseHeight, c.Sea, c.MinHeight, c.MaxHeight, c.Defaults, s.renderer.Size, s.renderer.Variant, s.config["column"], s.config["material"], o.MaterialWeathering > 0, o.RefinementSeed, o.DepositSpread})
	if e != nil {
		return nil, e
	}
	key := sha256.Sum256(keyData)
	if s.weatherPages == nil || s.weatherKey != key {
		s.clearWeatherCache()
		s.weatherKey = key
		s.weatherNodes = model.CloneNodes(nodes)
		s.weatherNodesSet = true
		s.weatherPages = map[[2]int]*weatherFeed{}
	}
	side := max(region.X1-region.X0+1, region.Y1-region.Y0+1)
	core, apron := 512, 128
	if c.Grid <= 1168 {
		core, apron = c.Grid, 0
	}
	// Any one cached core can directly feed a contained window. Its ownership
	// remains in the cache and the render retry protects this borrowed page.
	if borrowed := s.borrowWeatherPage(region, core); borrowed != nil {
		return borrowed, nil
	}
	// Preflight every missing page before allocating even the gathered feed.
	// If retained pages consume headroom needed by the exact transient replay,
	// discard the oldest page and retry with an updated reservation.
	for {
		retry := false
		for py := region.Y0 / core; py <= region.Y1/core && !retry; py++ {
			for px := region.X0 / core; px <= region.X1/core; px++ {
				if s.weatherPages[[2]int{px, py}] != nil {
					continue
				}
				q := c
				q.ReservedGPUBytes = s.reservedGPUBytes() + weatherFeedBytes(side, o.MaterialWeathering > 0)
				q = weatherShapeConfig(q, px, py, core, apron, o)
				q.preflightOnly = true
				if _, e := s.shape.evaluateShapeWindow(ctx, q, nodes, false, false, nil); e != nil {
					var limit *membudget.LimitError
					if errors.As(e, &limit) && limit.Label == "Expanded shape GPU buffers" && s.evictOldestPage() {
						retry = true
						break
					}
					return nil, e
				}
			}
		}
		if !retry {
			break
		}
	}
	if s.erosion == nil {
		s.erosion, err = s.renderer.NewErosion()
		if err != nil {
			return nil, err
		}
	}
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
	budget := s.weatherCacheBudget()
	for py := region.Y0 / core; py <= region.Y1/core; py++ {
		for px := region.X0 / core; px <= region.X1/core; px++ {
			if err = ctx.Err(); err != nil {
				return nil, err
			}
			id := [2]int{px, py}
			page := s.weatherPages[id]
			if page == nil {
				pageConfig := c
				pageConfig.ReservedGPUBytes = s.reservedGPUBytes() + int64(feed.bytes)
				page, err = s.weatherPage(ctx, nodes, pageConfig, px, py, core, apron, o)
				if err != nil {
					return nil, fmt.Errorf("weather page %d,%d: %w", px, py, err)
				}
				pool := 2 * s.cacheBudget()
				if page.bytes <= pool {
					s.trimPageCache(s.shapePages, max(0, pool-pageCacheBytes(s.weatherPages)-page.bytes))
				}
				budget = s.weatherCacheBudget()
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
				s.cacheEvictions++
				s.cacheEvictedBytes += uint64(oldest.bytes)
				oldest.Close()
				delete(s.weatherPages, oldestID)
			}
		}
	}
	return feed, nil
}
