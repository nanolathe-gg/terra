package terrain

import (
	"context"
	"fmt"
	"math"

	"github.com/nanolathe-gg/terraform/internal/membudget"
	"github.com/nanolathe-gg/terraform/internal/model"
)

type PlaneMismatch struct {
	Cells     int     `json:"cells"`
	Max       float64 `json:"max"`
	NonFinite int     `json:"nonFinite"`
}
type RegionComparison struct {
	Grid     int                      `json:"grid"`
	Repeat   map[string]PlaneMismatch `json:"repeat"`
	Regional map[string]PlaneMismatch `json:"regional"`
}

var fieldNames = [6]string{"h", "p", "r", "c", "v", "x"}
var maskNames = [25]string{"mr", "ms", "mw", "mm", "md", "ml", "mc", "mb", "mf", "mx", "my", "mz", "mg", "mk", "ovErosion", "ovDeposits", "ovVegetation", "ovExposure", "free18", "free19", "fu", "fv", "s1", "s2", "s3"}

// CompareRegions evaluates the complete authored lattice twice, and then four
// independent quadrants, reporting exact bit mismatches in all field planes.
// Large whole maps are rejected rather than allocating an unbounded field.
func (s *SceneRenderer) CompareRegions(ctx context.Context, nodes []model.Node, knobs map[string]string) (*RegionComparison, error) {
	if s.shape == nil || s.renderer == nil {
		return nil, fmt.Errorf("scene renderer is closed")
	}
	s.renderer.ApplyKnobs(knobs)
	grid := s.renderer.Grid
	if grid < 2 || grid > 2048 {
		return nil, fmt.Errorf("whole-map regional comparison requires grid between 2 and 2048; got %d", grid)
	}
	spacing := float64(s.renderer.Size-1) / float64(grid-1)
	seaLevel := number(s.config, "seaLevel", 0)
	bounds := vector(s.config, "heightBounds", []float64{seaLevel - 90, seaLevel + 300})
	c := ShapeWindowConfig{Grid: grid, Spacing: spacing, RefSpacing: spacing, BaseHeight: number(s.config, "baseHeight", 24), Sea: number(s.config, "seaLevel", 0), MinHeight: bounds[0], MaxHeight: bounds[1], Window: CellRect{0, 0, grid - 1, grid - 1}, Defaults: s.shapeDefaults()}
	a, e := s.shape.EvaluateShapeWindow(ctx, c, nodes)
	if e != nil {
		return nil, e
	}
	b, e := s.shape.EvaluateShapeWindow(ctx, c, nodes)
	if e != nil {
		return nil, e
	}
	out := &RegionComparison{Grid: grid, Repeat: map[string]PlaneMismatch{}, Regional: map[string]PlaneMismatch{}}
	compare := func(dst map[string]PlaneMismatch, x *ShapeWindow) {
		for y := 0; y < x.Height; y++ {
			for xx := 0; xx < x.Width; xx++ {
				i := y*x.Width + xx
				j := (x.Rect.Y0+y)*grid + x.Rect.X0 + xx
				for k, name := range fieldNames {
					v, w := a.Planes[k][j], x.Planes[k][i]
					m := dst[name]
					if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) || math.IsNaN(float64(w)) || math.IsInf(float64(w), 0) {
						m.Cells++
						m.NonFinite++
						dst[name] = m
						continue
					}
					if math.Float32bits(v) == math.Float32bits(w) {
						continue
					}
					m.Cells++
					d := math.Abs(float64(v) - float64(w))
					if math.IsNaN(d) || math.IsInf(d, 0) {
						m.NonFinite++
					} else {
						m.Max = math.Max(m.Max, d)
					}
					dst[name] = m
				}
				for k, name := range maskNames {
					v, w := a.Masks[k][j], x.Masks[k][i]
					if v == w {
						continue
					}
					m := dst[name]
					m.Cells++
					m.Max = math.Max(m.Max, math.Abs(float64(v)-float64(w)))
					dst[name] = m
				}
			}
		}
	}
	for _, k := range fieldNames {
		out.Repeat[k] = PlaneMismatch{}
		out.Regional[k] = PlaneMismatch{}
	}
	for _, k := range maskNames {
		out.Repeat[k] = PlaneMismatch{}
		out.Regional[k] = PlaneMismatch{}
	}
	compare(out.Repeat, b)
	half := grid / 2
	for _, r := range []CellRect{{0, 0, half - 1, half - 1}, {half, 0, grid - 1, half - 1}, {0, half, half - 1, grid - 1}, {half, half, grid - 1, grid - 1}} {
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		c.Window = r
		part, err := s.shape.EvaluateShapeWindow(ctx, c, nodes)
		if err != nil {
			return nil, err
		}
		compare(out.Regional, part)
	}
	return out, nil
}

// ReadAuthored replays an explicit native-grid rectangle for diagnostics and
// consumers that need authored fields. Normal rendering remains GPU-resident.
func (s *SceneRenderer) ReadAuthored(ctx context.Context, nodes []model.Node, knobs map[string]string, rect CellRect) (*ShapeWindow, error) {
	if s.shape == nil || s.renderer == nil {
		return nil, fmt.Errorf("scene renderer is closed")
	}
	if err := membudget.FromConfig(s.config).Authored(rect.X1-rect.X0+1, rect.Y1-rect.Y0+1); err != nil {
		return nil, err
	}
	s.renderer.ApplyKnobs(knobs)
	grid := s.renderer.Grid
	if grid < 2 {
		return nil, fmt.Errorf("invalid scene grid")
	}
	spacing := float64(s.renderer.Size-1) / float64(grid-1)
	sea := number(s.config, "seaLevel", 0)
	bounds := vector(s.config, "heightBounds", []float64{sea - 90, sea + 300})
	return s.shape.EvaluateShapeWindow(ctx, ShapeWindowConfig{Grid: grid, Spacing: spacing, RefSpacing: spacing, BaseHeight: number(s.config, "baseHeight", 24), Sea: sea, MinHeight: bounds[0], MaxHeight: bounds[1], Window: rect, Defaults: s.shapeDefaults()}, nodes)
}
