package terrain

import (
	"context"
	"errors"
	"fmt"

	"github.com/nanolathe-gg/terraform/internal/model"
)

// SceneWindow is a requested image window in world coordinates and output scale.
// Scale is world pixels per output pixel. Width and Height are world pixels.
type SceneWindow struct {
	X, Y, Width, Height int
	Scale               float64
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
	return &SceneRenderer{gpu: gpu, config: config, sources: sources, material: material, shape: shape}, nil
}
func (s *SceneRenderer) Close() {
	if s.shape != nil {
		s.shape.Close()
		s.shape = nil
	}
}

// Render rejects unimplemented integration paths rather than returning a flat
// or partial map as though it were the authored scene.
func (s *SceneRenderer) Render(ctx context.Context, nodes []model.Node, knobs map[string]string, colors map[string]any, window SceneWindow, options DrawOptions) (*SceneResult, error) {
	if s.shape == nil {
		return nil, errors.New("scene renderer is closed")
	}
	if window.Width <= 0 || window.Height <= 0 || window.Scale <= 0 {
		return nil, fmt.Errorf("invalid scene window")
	}
	return nil, errors.New("scene surface rendering and complete authored-field replay are not implemented")
}
