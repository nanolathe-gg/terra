package terrain

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/nanolathe-gg/terraform/internal/membudget"
	"github.com/nanolathe-gg/terraform/internal/model"
)

// SceneWindow is a requested image window in world coordinates and output scale.
// Scale is world pixels per output pixel. Width and Height are world pixels.
type SceneWindow struct {
	X, Y, Width, Height int
	Scale               float64
	ExportArt           bool
	Preview             bool
	ReadHeights         bool
	HeightsOnly         bool
	SkipRGBA            bool // Browser presentation keeps color on the GPU.
}
type SceneResult struct {
	RGBA                                        []byte
	Heights                                     []float32
	Width, Height                               int
	HeightWidth, HeightHeight                   int
	HeightOriginX, HeightOriginY, HeightSpacing float64
}
type SceneRenderer struct {
	gpu                               *GPU
	config                            map[string]any
	sources                           map[string]string
	material                          map[string]any
	shape                             *ShapeEngine
	shapeGather                       *Kernel
	renderer                          *Renderer
	erosion                           *Erosion
	weatherPages                      map[[2]int]*weatherFeed
	weatherKey                        [32]byte
	weatherTick, weatherRuns          uint64
	shapePages                        map[[2]int]*weatherFeed
	shapeKey                          [32]byte
	shapeNodes                        []model.Node
	shapeNodesSet                     bool
	shapeTick, shapeRuns              uint64
	cacheEvictions, cacheEvictedBytes uint64
	shapeProfile                      ShapeProfile
}

func NewSceneRenderer(gpu *GPU, config map[string]any, sources map[string]string, material map[string]any) (*SceneRenderer, error) {
	if gpu == nil {
		return nil, errors.New("scene renderer requires a GPU")
	}
	source, ok := sources["engine-shape.wgsl"]
	if !ok || source == "" {
		return nil, errors.New("missing engine-shape.wgsl")
	}
	shape, err := NewShapeEngine(gpu, source, true)
	if err != nil {
		return nil, err
	}
	chunkConfig := make(map[string]any, len(config)+1)
	for k, v := range config {
		chunkConfig[k] = v
	}
	chunkConfig["chunked"] = true
	renderer, err := NewRenderer(gpu, chunkConfig, sources, material)
	if err != nil {
		shape.Close()
		return nil, err
	}
	return &SceneRenderer{gpu: gpu, config: chunkConfig, sources: sources, material: material, shape: shape, renderer: renderer}, nil
}
func (s *SceneRenderer) Close() {
	s.closeShapeGather()
	s.clearWeatherCache()
	s.clearShapeCache()
	if s.erosion != nil {
		s.erosion.Close()
		s.erosion = nil
	}
	if s.renderer != nil {
		s.renderer.Close()
		s.renderer = nil
	}
	if s.shape != nil {
		s.shape.Close()
		s.shape = nil
	}
}

// Render replays authored fields on the native lattice and renders one bounded window.
func (s *SceneRenderer) Render(ctx context.Context, nodes []model.Node, knobs map[string]string, colors map[string]any, window SceneWindow, options DrawOptions) (*SceneResult, error) {
	started := time.Now()
	s.shapeProfile = ShapeProfile{}
	if s.shape != nil {
		s.shape.profile = &s.shapeProfile
		defer func() { s.shape.profile = nil }()
	}
	defer func() { s.shapeProfile.SceneMilliseconds = elapsed(started) }()
	if s.shape == nil {
		return nil, errors.New("scene renderer is closed")
	}
	if window.Width <= 0 || window.Height <= 0 || window.Scale <= 0 {
		return nil, fmt.Errorf("invalid scene window")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if !window.HeightsOnly {
		if err := membudget.FromConfig(s.config).Image(int(math.Ceil(float64(window.Width)/window.Scale)), int(math.Ceil(float64(window.Height)/window.Scale))); err != nil {
			return nil, err
		}
	}
	s.renderer.releaseWorking()
	s.renderer.ApplyKnobs(knobs)
	if len(colors) > 0 {
		b, err := json.Marshal(colors)
		if err != nil {
			return nil, err
		}
		var palette map[string][]float64
		if err = json.Unmarshal(b, &palette); err != nil {
			return nil, fmt.Errorf("invalid colors: %w", err)
		}
		s.renderer.SetColors(palette)
	} else {
		s.renderer.SetColors(nil)
	}
	nativeGrid := s.renderer.Grid
	nativeSpacing := float64(s.renderer.Size-1) / float64(nativeGrid-1)
	if window.Preview && !window.HeightsOnly && nativeGrid > 512 {
		s.renderer.Grid = 512
		defer func() { s.renderer.Grid = nativeGrid }()
	}
	region := s.renderer.RequiredRegion(window, options.Full)
	if window.HeightsOnly {
		spacing := nativeSpacing
		top := nativeGrid - 1
		x0 := clampInt(int(math.Floor(float64(window.X)/spacing)), 0, top)
		y0 := clampInt(int(math.Floor(float64(window.Y)/spacing)), 0, top)
		x1 := clampInt(int(math.Ceil(float64(window.X+window.Width)/spacing)), 0, top)
		y1 := clampInt(int(math.Ceil(float64(window.Y+window.Height)/spacing)), 0, top)
		region = &RenderRegion{GridX: x0, GridY: y0, GridWidth: x1 - x0 + 1, GridHeight: y1 - y0 + 1, GridSpacing: spacing, WorldGrid: nativeGrid, WorldSize: s.renderer.Size}
	}

	if window.ReadHeights || window.HeightsOnly {
		if err := membudget.Require("Terrain height readback", membudget.Area(pow2(region.GridWidth), pow2(region.GridHeight), 16), membudget.FromConfig(s.config).Working()); err != nil {
			return nil, err
		}
	}

	if window.ReadHeights && !window.HeightsOnly {
		limits := membudget.FromConfig(s.config)
		imageBytes := membudget.Area(int(math.Ceil(float64(window.Width)/window.Scale)), int(math.Ceil(float64(window.Height)/window.Scale)), 4)
		heightBytes := membudget.Area(region.GridWidth, region.GridHeight, 4)
		if err := membudget.Require("Terrain tile transfer", 3*(imageBytes+heightBytes), limits.Transfer()); err != nil {
			return nil, err
		}
	}

	seaLevel := number(s.config, "seaLevel", 0)
	bounds := vector(s.config, "heightBounds", []float64{seaLevel - 90, seaLevel + 300})
	shapeDefaults := s.shapeDefaults()
	shapeConfig := ShapeWindowConfig{Grid: s.renderer.Grid, Spacing: region.GridSpacing, RefSpacing: nativeSpacing, BaseHeight: number(s.config, "baseHeight", 24), Sea: number(s.config, "seaLevel", 0), MinHeight: bounds[0], MaxHeight: bounds[1], Window: CellRect{region.GridX, region.GridY, region.GridX + region.GridWidth - 1, region.GridY + region.GridHeight - 1}, Memory: membudget.FromConfig(s.config), ReservedGPUBytes: s.reservedGPUBytes(), Defaults: shapeDefaults}
	var pixels []byte
	var err error
	input := WindowInput{Window: window, Region: region, ExportArt: window.ExportArt}
	if options.Weather && (!window.Preview || window.HeightsOnly) {
		feed, e := s.buildWeatherFeed(ctx, nodes, shapeConfig, shapeConfig.Window, options)
		if e != nil {
			return nil, e
		}
		defer feed.Close()
		input.Feed = &feed.GPUFeed
		s.renderer.SetReservedGPUBytes(s.cacheResidentBytes() + feed.bytes)
		pixels, err = s.renderer.RenderWindow(ctx, input, options)
	} else {
		feed, e := s.buildShapeFeed(ctx, nodes, shapeConfig, shapeConfig.Window)
		if e != nil {
			return nil, e
		}
		defer feed.Close()
		input.Feed = &feed.GPUFeed
		s.renderer.SetReservedGPUBytes(s.cacheResidentBytes() + feed.bytes)
		pixels, err = s.renderer.RenderWindow(ctx, input, options)
	}
	if err != nil {
		return nil, err
	}
	rw, rh := region.GridWidth, region.GridHeight
	var heights []float32
	if window.ReadHeights || window.HeightsOnly {
		gw, gh := pow2(rw), pow2(rh)
		data, e := s.renderer.ReadTexture(ctx, s.renderer.HeightTexture, gw, gh, 0, 0)
		if e != nil {
			return nil, e
		}
		sea := float32(shapeConfig.Sea)
		heights = make([]float32, rw*rh)
		for y := 0; y < rh; y++ {
			for x := 0; x < rw; x++ {
				heights[y*rw+x] = math.Float32frombits(binary.LittleEndian.Uint32(data[(y*gw+x)*4:])) + sea
			}
		}
	}
	return &SceneResult{RGBA: pixels, Heights: heights, Width: int(math.Ceil(float64(window.Width) / window.Scale)), Height: int(math.Ceil(float64(window.Height) / window.Scale)), HeightWidth: rw, HeightHeight: rh, HeightOriginX: float64(region.GridX) * region.GridSpacing, HeightOriginY: float64(region.GridY) * region.GridSpacing, HeightSpacing: region.GridSpacing}, nil
}

func (s *SceneRenderer) shapeDefaults() map[string]any {
	d := map[string]any{}
	for k, v := range object(s.config, "defaults") {
		d[k] = v
	}
	for _, k := range []string{"frostGapSize", "frostGapDepth", "frostGaps", "frostGapReach"} {
		d[k] = s.renderer.num(k, number(d, k, 0))
	}
	return d
}

// UpdateConfig applies same-world editor settings without rebuilding GPU resources.
func (s *SceneRenderer) UpdateConfig(config map[string]any) error {
	if s.renderer == nil {
		return errors.New("scene renderer is closed")
	}
	if v, ok := config["size"]; ok && int(number(map[string]any{"size": v}, "size", -1)) != s.renderer.Size {
		return errors.New("scene size changed; recreate renderer")
	}
	if v, ok := config["grid"]; ok && int(number(map[string]any{"grid": v}, "grid", -1)) != s.renderer.Grid {
		return errors.New("scene grid changed; recreate renderer")
	}
	oldBudget := s.cacheBudget()
	for _, key := range []string{"gpuMB", "gpuBudgetBytes", "gpuBudgetMB", "heapMB", "heapBudgetBytes", "heapBudgetMB", "uiBitmapBytes"} {
		if v, ok := config[key]; ok {
			s.config[key] = v
		}
	}
	if s.cacheBudget() < oldBudget {
		s.trimPageCache(s.shapePages, s.shapeCacheBudget())
		s.trimPageCache(s.weatherPages, s.weatherCacheBudget())
	}
	if column, ok := config["column"]; ok {
		s.config["column"] = column
	}
	return nil
}

// LastRenderProfile reports the renderer's most recent completed tile timings.
type SceneProfile struct {
	RenderProfile
	ShapeProfile
	CacheEvictions, CacheEvictedBytes uint64
}

func (s *SceneRenderer) LastRenderProfile() SceneProfile {
	if s.renderer == nil {
		return SceneProfile{ShapeProfile: s.shapeProfile}
	}
	return SceneProfile{RenderProfile: s.renderer.LastProfile, ShapeProfile: s.shapeProfile, CacheEvictions: s.cacheEvictions, CacheEvictedBytes: s.cacheEvictedBytes}
}

// cacheBudget reserves at most one fifth of the configured GPU budget for
// each of the authored and weather caches, capped at 96 MiB apiece.
// UI bitmap reservations displace the two caches equally.
func (s *SceneRenderer) cacheBudget() int {
	bytes := param(s.config, "gpuBudgetBytes")
	if bytes <= 0 {
		mb := param(s.config, "gpuMB")
		if mb <= 0 {
			mb = param(s.config, "gpuBudgetMB")
		}
		if mb <= 0 {
			mb = 512
		}
		bytes = mb * 1024 * 1024
	}
	base := min(96*1024*1024, max(0, int(bytes/5)))
	return max(0, base-int(math.Max(0, param(s.config, "uiBitmapBytes")))/2)
}

func pageCacheBytes(pages map[[2]int]*weatherFeed) int {
	total := 0
	for _, page := range pages {
		total += page.bytes
	}
	return total
}

// A canonical small-map weather page may use the unused authored-cache share.
// This keeps the combined retention cap unchanged while avoiding repeated
// whole-map weather replays on each visible tile.
func (s *SceneRenderer) shapeCacheBudget() int {
	budget := s.cacheBudget()
	if len(s.weatherPages) == 1 {
		for _, p := range s.weatherPages {
			if p.Grid == s.renderer.Grid {
				return min(budget, max(0, 2*budget-p.bytes))
			}
		}
	}
	return budget
}

func (s *SceneRenderer) weatherCacheBudget() int {
	budget := s.cacheBudget()
	if len(s.weatherPages) == 1 {
		for _, p := range s.weatherPages {
			if p.Grid == s.renderer.Grid {
				return max(budget, 2*budget-pageCacheBytes(s.shapePages))
			}
		}
	}
	return budget
}

// trimPageCache releases least-recently-used pages without invalidating the
// graph snapshot or newer pages when external bitmap residency grows.
func (s *SceneRenderer) trimPageCache(pages map[[2]int]*weatherFeed, budget int) {
	total := 0
	for _, page := range pages {
		total += page.bytes
	}
	for total > budget && len(pages) > 0 {
		var oldest *weatherFeed
		var key [2]int
		for id, page := range pages {
			if oldest == nil || page.used < oldest.used {
				oldest = page
				key = id
			}
		}
		total -= oldest.bytes
		s.cacheEvictions++
		s.cacheEvictedBytes += uint64(oldest.bytes)
		oldest.Close()
		delete(pages, key)
	}
}

// evictOldestPage releases one retained page before retrying a bounded
// transient allocation. It leaves graph keys and all other pages intact.
func (s *SceneRenderer) evictOldestPage() bool {
	var oldest *weatherFeed
	var victim map[[2]int]*weatherFeed
	var key [2]int
	for _, pages := range []map[[2]int]*weatherFeed{s.shapePages, s.weatherPages} {
		for id, page := range pages {
			if oldest == nil || page.used < oldest.used {
				oldest = page
				victim = pages
				key = id
			}
		}
		if oldest != nil {
			break
		} // Authored pages yield before expensive weather.
	}
	if oldest == nil {
		return false
	}
	s.cacheEvictions++
	s.cacheEvictedBytes += uint64(oldest.bytes)
	oldest.Close()
	delete(victim, key)
	return true
}

// reservedGPUBytes includes external browser bitmap residency in addition to terrain caches.
func (s *SceneRenderer) reservedGPUBytes() int64 {
	return int64(s.renderer.FixedBytes()+s.cacheResidentBytes()) + int64(math.Max(0, param(s.config, "uiBitmapBytes")))
}

func (s *SceneRenderer) cacheResidentBytes() int {
	n := 0
	for _, p := range s.shapePages {
		n += p.bytes
	}
	for _, p := range s.weatherPages {
		n += p.bytes
	}
	return n
}

// UniformSnapshot exposes the last terrain draw's values for renderer parity checks.
func (s *SceneRenderer) UniformSnapshot() map[string][]float64 {
	if s.renderer == nil {
		return nil
	}
	return s.renderer.UniformSnapshot()
}
