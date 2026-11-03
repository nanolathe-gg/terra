package model

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"testing"
)

func TestChangedTilesAndRefinementEdges(t *testing.T) {
	flags := make([]uint32, 9)
	if got := DirtyTileRects(flags, 150, 64, 2); len(got) != 0 {
		t.Fatal(got)
	}
	flags[1], flags[8] = 1, 1
	want := []Rect{{128, 0, 128, 128}, {256, 256, 44, 44}}
	if got := DirtyTileRects(flags, 150, 64, 2); !reflect.DeepEqual(got, want) {
		t.Fatal(got)
	}
	r := InvalidateRefinement(nil, &GridRect{10, 20, 30, 40}, 100)
	r = InvalidateRefinement(r, &GridRect{20, 20, 50, 45}, 100)
	if *r != (GridRect{10, 20, 50, 45}) || RefinementValid(r, 50, 45) || !RefinementValid(r, 51, 45) || !RefinementValid(nil, 1, 1) {
		t.Fatal(r)
	}
	all := InvalidateRefinement(r, nil, 100)
	if *all != (GridRect{0, 0, 99, 99}) {
		t.Fatal(all)
	}
}
func TestFeatureBoundsEdgesAndInvalid(t *testing.T) {
	cases := []struct {
		p []FeaturePoint
		r float64
	}{{[]FeaturePoint{{5, 5}, {800, 700}}, 64}, {[]FeaturePoint{{-90, -20}, {0, 40}}, 200}, {[]FeaturePoint{{20479, 20479}}, 180}}
	for _, c := range cases {
		b, e := FeatureRegionBounds(FeatureRegion{Type: "brush", Points: c.p, Radius: c.r}, 1280, 1280, 128)
		if e != nil {
			t.Fatal(e)
		}
		for _, p := range c.p {
			for x := max(0, int(math.Floor((p.X-c.r)/16))); x < min(1280, int(math.Ceil((p.X+c.r)/16))); x++ {
				for z := max(0, int(math.Floor((p.Z-c.r)/16))); z < min(1280, int(math.Ceil((p.Z+c.r)/16))); z++ {
					if math.Hypot(float64(x*16+8)-p.X, float64(z*16+8)-p.Z) <= c.r && (x < b.X0 || x >= b.X1 || z < b.Z0 || z >= b.Z1) {
						t.Fatalf("missed cell %d,%d", x, z)
					}
				}
			}
		}
	}
	if b, e := FeatureRegionBounds(FeatureRegion{Type: "flood"}, 1280, 1280, 0); e != nil || b != (FeatureBounds{0, 0, 1280, 1280}) {
		t.Fatal(b, e)
	}
	if _, e := FeatureRegionBounds(FeatureRegion{Type: "brush", Points: []FeaturePoint{{math.NaN(), 4}}}, 128, 128, 10); e == nil {
		t.Fatal("accepted NaN")
	}
	if _, e := FeatureRegionBounds(FeatureRegion{Type: "other"}, 128, 128, 10); e == nil {
		t.Fatal("accepted unknown type")
	}
}
func TestLongSimplificationAndHairpins(t *testing.T) {
	long := make([]Point, 100000)
	for i := range long {
		long[i] = Point{float64(i), float64(i) / 2}
	}
	if got := SimplifyPath(long, 3); len(got) != 2 || got[0] != long[0] || got[1] != long[len(long)-1] {
		t.Fatal("long straight path")
	}
	hairpin := []Point{{0, 0}, {30, 0}, {60, 0}, {90, 0}, {60, 1}, {30, 1}, {0, 1}}
	if got := SimplifyPath(hairpin, 3); len(got) < 3 {
		t.Fatal("lost hairpin")
	}
	dup := make([]Point, 100)
	for i := range dup {
		dup[i] = Point{10, 10}
	}
	if got := SimplifyPath(dup, 3); len(got) != 2 {
		t.Fatal("duplicate points")
	}
}
func TestColumnValidationRejectsInvalidEdits(t *testing.T) {
	raw, e := os.ReadFile("../../materials/desert.json")
	if e != nil {
		t.Fatal(e)
	}
	var table struct {
		World struct {
			Column map[string]any `json:"column"`
		} `json:"world"`
	}
	if e = json.Unmarshal(raw, &table); e != nil {
		t.Fatal(e)
	}
	base := table.World.Column
	copyMap := func() map[string]any {
		b, _ := json.Marshal(base)
		var m map[string]any
		_ = json.Unmarshal(b, &m)
		return m
	}
	if e = ValidateColumn(base, base); e != nil {
		t.Fatal(e)
	}
	for _, mutate := range []func(map[string]any){func(m map[string]any) { m["extra"] = 1 }, func(m map[string]any) { m["sections"].([]any)[0].(map[string]any)["beds"].([]any)[0].([]any)[0] = 0.0 }, func(m map[string]any) { m["sections"].([]any)[0].(map[string]any)["beds"].([]any)[0].([]any)[1] = 1.1 }, func(m map[string]any) { m["sections"].([]any)[0].(map[string]any)["beds"].([]any)[0].([]any)[2] = .5 }, func(m map[string]any) {
		ss := m["sections"].([]any)
		ss[1].(map[string]any)["start"] = ss[0].(map[string]any)["start"]
	}, func(m map[string]any) { m["colors"].([]any)[0].([]any)[0] = 256.0 }} {
		bad := copyMap()
		mutate(bad)
		if e := ValidateColumn(bad, base); e == nil {
			t.Fatalf("accepted invalid column: %v", bad)
		}
	}
}
func TestPathBranchesAndMalformedReferences(t *testing.T) {
	n := ShapePath{Points: []Point{{40, 40}, {80, 40}, {120, 40}}}
	point, path := ExtendPoint(&n, 1, Point{80, 80}, 0)
	if point != 3 || path != 1 || !reflect.DeepEqual(n.Paths, [][]int{{0, 1, 2}, {1, 3}}) {
		t.Fatal(n)
	}
	point, path = ExtendPoint(&n, point, Point{80, 120}, path)
	if point != 4 || path != 1 || !reflect.DeepEqual(n.Paths, [][]int{{0, 1, 2}, {1, 3, 4}}) {
		t.Fatal(n)
	}
	if i := InsertPoint(&n, 0, 1); i != 5 {
		t.Fatal(i)
	}
	if !RemovePoint(&n, 1) || ValidatePaths(&n) != nil {
		t.Fatal(n)
	}
	for _, paths := range [][][]int{{}, {{}}, {{0, 4}}, {{0, -1}}, {{0, 1}}} {
		bad := ShapePath{Points: []Point{{1, 1}, {2, 2}, {3, 3}}, Paths: paths}
		if ValidatePaths(&bad) == nil {
			t.Fatalf("accepted %v", paths)
		}
	}
}
func TestSelectionTransformFiniteAndAbsolute(t *testing.T) {
	n := Node{Points: []Point{{100, 120}, {140, 160}}, Params: map[string]any{"radius": 20.0}}
	values, m, e := SelectionTransform(n, &TransformValues{160, 180, 90, 200})
	if e != nil || values != (TransformValues{120, 140, 0, 100}) {
		t.Fatal(values, e)
	}
	apply := func(p Point) Point { return Point{m[0]*p.X + m[2]*p.Y + m[4], m[1]*p.X + m[3]*p.Y + m[5]} }
	p := apply(Point{100, 120})
	if math.Abs(p.X-200) > 1e-8 || math.Abs(p.Y-140) > 1e-8 {
		t.Fatal(p)
	}
	for _, bad := range []TransformValues{{math.NaN(), 1, 0, 100}, {0, 0, math.Inf(1), 100}, {0, 0, 0, 0}} {
		if _, _, e := SelectionTransform(n, &bad); e == nil {
			t.Fatal("accepted invalid transform")
		}
	}
}
func TestKnotMonotonicityAndLip(t *testing.T) {
	for _, knots := range [][]Knot{{{0, 0}, {.3, .1}, {.7, .8}, {1, 1}}, {{0, 0}, {.5, .9}, {.8, 1.3}, {1, 1}}} {
		f := KnotCurve(knots)
		for _, p := range knots {
			if math.Abs(f(p[0])-p[1]) > 1e-12 {
				t.Fatal(p)
			}
		}
		for i := 0; i <= 400; i++ {
			v := f(float64(i) / 400)
			if v < 0 || v > 1.3+1e-9 {
				t.Fatal(v)
			}
		}
	}
}
func TestMaterialPlacementOverridesOnlyRequestedCells(t *testing.T) {
	raw, e := os.ReadFile("../../materials/green.json")
	if e != nil {
		t.Fatal(e)
	}
	var doc map[string]any
	if e = json.Unmarshal(raw, &doc); e != nil {
		t.Fatal(e)
	}
	p := doc["placement"].(map[string]any)
	delete(p, "note")
	raw, _ = json.Marshal(doc)
	var table MaterialTable
	if e = json.Unmarshal(raw, &table); e != nil {
		t.Fatal(e)
	}
	old := TablePlacementRows(table, nil)
	same := TablePlacementRows(table, map[string][]float64{"faceEdge": {.8}, "gullyRock": {.5}, "rockOrder": {1}})
	if !reflect.DeepEqual(old, same) {
		t.Fatal("defaults changed table")
	}
	live := TablePlacementRows(table, map[string][]float64{"faceEdge": {0}, "gullyRock": {1.5}, "rockOrder": {.4}})
	changed := [][2]int{}
	for r := range old {
		for c := range old[r] {
			if old[r][c] != live[r][c] {
				changed = append(changed, [2]int{r, c})
			}
		}
	}
	if !reflect.DeepEqual(changed, [][2]int{{6, 2}, {9, 0}, {9, 1}}) {
		t.Fatal(changed)
	}
	bad := TablePlacementRows(table, map[string][]float64{"faceEdge": {math.NaN()}, "faceSlope": {math.NaN(), 1}, "faceScore": {1, 2}})
	if !reflect.DeepEqual(old, bad) {
		t.Fatal("invalid overrides changed table")
	}
}
func TestSelectionHandlesAndHitTolerance(t *testing.T) {
	n := Node{Points: []Point{{100, 120}, {140, 160}}, Params: map[string]any{"radius": 20.0}}
	project := func(p Point) Point { return Point{p.X, p.Y - 30} }
	for _, scale := range []float64{.1, .5, 1, 4} {
		g := SelectionGeometry(n, project, SelectionView{120 - 150/scale, 110 - 150/scale, 300 / scale, 300 / scale, scale})
		for _, x := range []struct {
			p      Point
			action string
		}{{g.Move, "move"}, {g.Rotate, "rotate"}, {g.Resize, "scale"}} {
			if h := HitSelection(g, x.p, false); h == nil || h.Action != x.action {
				t.Fatalf("scale %g: %v", scale, h)
			}
			p := Point{x.p.X + 9/scale, x.p.Y}
			if h := HitSelection(g, p, false); h == nil || h.Action != x.action {
				t.Fatalf("near handle %v", h)
			}
			p.X = x.p.X + 11/scale
			if h := HitSelection(g, p, false); h != nil && h.Action == x.action {
				t.Fatalf("far handle %v", h)
			}
		}
	}
	id := func(p Point) Point { return p }
	g := SelectionGeometry(n, id, SelectionView{0, 0, 300, 300, 1})
	if h := HitSelection(g, Point{101, 122}, true); h == nil || h.Action != "point" || h.Index != 0 {
		t.Fatal(h)
	}
	if HitSelection(g, g.Rotate, true) != nil {
		t.Fatal("path mode hit a handle")
	}
	n.Hidden = true
	if SelectionGeometry(n, id, SelectionView{0, 0, 300, 300, 1}) != nil {
		t.Fatal("hidden selection visible")
	}
	n.Hidden = false
	g = SelectionGeometry(n, id, SelectionView{1000, 0, 300, 300, 1})
	if HitSelection(g, g.Move, false) != nil {
		t.Fatal("offscreen hit")
	}
	for _, y := range []float64{-200, 500} {
		g = SelectionGeometry(Node{Points: []Point{{150, y}}, Params: map[string]any{"radius": 400.0}}, id, SelectionView{0, 0, 300, 300, 1})
		if !g.Visible {
			t.Fatal("partly visible selection hidden")
		}
		for _, p := range []Point{g.Move, g.Rotate, g.Resize} {
			if p.X < 18 || p.X > 282 || p.Y < 18 || p.Y > 282 {
				t.Fatal(p)
			}
		}
		if math.Hypot(g.Move.X-g.Rotate.X, g.Move.Y-g.Rotate.Y) < 28 {
			t.Fatal("overlapping handles")
		}
	}
}
