package terrain

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"github.com/nanolathe-gg/terraform/internal/model"
)

// SceneWindow is a requested image window in world coordinates and output scale.
// Scale is world pixels per output pixel. Width and Height are world pixels.
type SceneWindow struct {
	X, Y, Width, Height int
	Scale               float64
	ExportArt           bool
	Preview             bool
}
type SceneResult struct {
	RGBA                                        []byte
	Heights                                     []float32
	Width, Height                               int
	HeightWidth, HeightHeight                   int
	HeightOriginX, HeightOriginY, HeightSpacing float64
}
type SceneRenderer struct {
	gpu      *GPU
	config   map[string]any
	sources  map[string]string
	material map[string]any
	shape    *ShapeEngine
	renderer *Renderer
	erosion  *Erosion
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
	if s.shape == nil {
		return nil, errors.New("scene renderer is closed")
	}
	if window.Width <= 0 || window.Height <= 0 || window.Scale <= 0 {
		return nil, fmt.Errorf("invalid scene window")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
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
	if window.Preview && nativeGrid > 512 {
		s.renderer.Grid = 512
		defer func() { s.renderer.Grid = nativeGrid }()
	}
	region := s.renderer.RequiredRegion(window, options.Full)
	bounds := vector(s.config, "heightBounds", []float64{-90, 300})
	shapeDefaults := s.shapeDefaults()
	shapeConfig := ShapeWindowConfig{Grid: s.renderer.Grid, Spacing: region.GridSpacing, RefSpacing: nativeSpacing, BaseHeight: number(s.config, "baseHeight", 24), Sea: number(s.config, "seaLevel", 0), MinHeight: bounds[0], MaxHeight: bounds[1], Window: CellRect{region.GridX, region.GridY, region.GridX + region.GridWidth - 1, region.GridY + region.GridHeight - 1}, Defaults: shapeDefaults}
	shape, err := s.shape.EvaluateShapeWindow(ctx, shapeConfig, nodes)
	if err != nil {
		return nil, err
	}
	masks := make([][]int8, len(shape.Masks))
	for i := range shape.Masks {
		masks[i] = shape.Masks[i]
	}
	input := WindowInput{Window: window, Region: region, Heights: shape.Planes[0], Routes: shape.Planes[2], Cracks: shape.Planes[3], Cover: shape.Planes[4], Crystal: shape.Planes[5], Masks: masks, ExportArt: window.ExportArt}
	var feed *weatherFeed
	if options.Weather && !window.Preview {
		feed, err = s.buildWeatherFeed(ctx, nodes, shapeConfig, shapeConfig.Window, options)
		if err != nil {
			return nil, err
		}
		defer feed.Close()
		input.Feed = &feed.GPUFeed
	}
	pixels, err := s.renderer.RenderWindow(ctx, input, options)
	if err != nil {
		return nil, err
	}
	if feed != nil {
		gw, gh := pow2(shape.Width), pow2(shape.Height)
		data, e := s.renderer.ReadTexture(ctx, s.renderer.HeightTexture, gw, gh, 0, 0)
		if e != nil {
			return nil, e
		}
		sea := float32(shapeConfig.Sea)
		for y := 0; y < shape.Height; y++ {
			for x := 0; x < shape.Width; x++ {
				i := y*shape.Width + x
				shape.Planes[0][i] = math.Float32frombits(binary.LittleEndian.Uint32(data[(y*gw+x)*4:])) + sea
			}
		}
	}
	return &SceneResult{RGBA: pixels, Heights: shape.Planes[0], Width: int(math.Ceil(float64(window.Width) / window.Scale)), Height: int(math.Ceil(float64(window.Height) / window.Scale)), HeightWidth: shape.Width, HeightHeight: shape.Height, HeightOriginX: float64(shape.Rect.X0) * region.GridSpacing, HeightOriginY: float64(shape.Rect.Y0) * region.GridSpacing, HeightSpacing: region.GridSpacing}, nil
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
	if column, ok := config["column"]; ok {
		s.config["column"] = column
	}
	return nil
}
