package model

import (
	"math"
	"testing"
)

func TestPathsShareBranchesAndCompact(t *testing.T) {
	n := ShapePath{Points: []Point{{0, 0}, {1, 0}, {2, 0}}}
	AppendPath(&n, []Point{{1, 1}}, 1)
	if err := ValidatePaths(&n); err != nil {
		t.Fatal(err)
	}
	if !RemovePath(&n, 0) {
		t.Fatal("remove failed")
	}
	if len(n.Points) != 2 || n.Paths[0][0] != 0 || n.Paths[0][1] != 1 {
		t.Fatalf("bad compaction: %+v", n)
	}
}
func TestSimplifyPath(t *testing.T) {
	p := []Point{{0, 0}, {1, .1}, {2, 0}, {3, 2}}
	got := SimplifyPath(p, .2)
	if len(got) != 3 || got[1] != p[2] {
		t.Fatalf("unexpected path: %+v", got)
	}
}
func TestCurveAndRefinement(t *testing.T) {
	k := []Knot{{0, 0}, {.5, .3}, {1, 1}}
	curve := KnotCurve(k)
	for _, p := range k {
		if math.Abs(curve(p[0])-p[1]) > 1e-12 {
			t.Fatal("curve misses knot")
		}
	}
	r := InvalidateRefinement(&GridRect{2, 2, 4, 4}, &GridRect{3, 0, 7, 3}, 8)
	if *r != (GridRect{2, 0, 7, 4}) || RefinementValid(r, 3, 3) || !RefinementValid(r, 1, 3) {
		t.Fatalf("bad invalidation: %+v", r)
	}
}
