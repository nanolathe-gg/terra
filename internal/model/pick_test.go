package model

import (
	"math"
	"testing"
)

func TestPickTerrainFlatAndClamping(t *testing.T) {
	sample := func(_, _ float64) float64 { return 44 }
	p := PickTerrain(-20, 100, 1000, 1000, 0, 24, sample)
	if p.X != 0 || p.Y != 110 {
		t.Fatalf("flat pick %+v", p)
	}
	p = PickTerrain(100, 990, 1000, 1000, 50, 24, func(_, _ float64) float64 { return 0 })
	if p.Y != 999 {
		t.Fatalf("sea-level clamp %+v", p)
	}
}
func TestPickTerrainChoosesFrontmostSteepCrossing(t *testing.T) {
	// Two crossings: the elevated shelf projects over the flat terrain behind it.
	sample := func(_, y float64) float64 {
		if y >= 130 && y <= 145 {
			return 80
		}
		return 0
	}
	p := PickTerrain(20, 100, 1000, 1000, 0, 0, sample)
	if math.Abs(p.Y-140) > 1e-9 {
		t.Fatalf("wanted front shelf at 140, got %+v", p)
	}
}
func TestPickTerrainFallsBackWhenRayMisses(t *testing.T) {
	p := PickTerrain(10, 500, 1000, 1000, 0, 0, func(_, _ float64) float64 { return 10000 })
	if p.Y != 500 {
		t.Fatalf("ray miss fallback %+v", p)
	}
}
