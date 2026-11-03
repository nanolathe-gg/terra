package model

import "math"

type GridRect struct{ X0, Y0, X1, Y1 int }
type Rect struct{ X, Y, Width, Height float64 }

func InvalidateRefinement(previous, rect *GridRect, grid int) *GridRect {
	r := GridRect{0, 0, grid - 1, grid - 1}
	if rect != nil {
		r = *rect
	}
	p := r
	if previous != nil {
		p = *previous
	}
	return &GridRect{max(0, min(p.X0, r.X0)), max(0, min(p.Y0, r.Y0)), min(grid-1, max(p.X1, r.X1)), min(grid-1, max(p.Y1, r.Y1))}
}
func RefinementValid(r *GridRect, x, y int) bool {
	return r == nil || x < r.X0 || y < r.Y0 || x > r.X1 || y > r.Y1
}
func DirtyTileRects(flags []uint32, grid, tile int, spacing float64) []Rect {
	columns := int(math.Ceil(float64(grid) / float64(tile)))
	out := []Rect{}
	for i, f := range flags {
		if f != 0 {
			x, y := (i%columns)*tile, (i/columns)*tile
			out = append(out, Rect{float64(x) * spacing, float64(y) * spacing, float64(min(tile, grid-x)) * spacing, float64(min(tile, grid-y)) * spacing})
		}
	}
	return out
}
