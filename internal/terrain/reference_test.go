package terrain

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/nanolathe-gg/terraform/internal/model"
	"math"
	"os"
	"testing"
)

func TestShapePreparationReference(t *testing.T) {
	data, e := os.ReadFile("testdata/shape-reference.json")
	if e != nil {
		t.Fatal(e)
	}
	var cases []struct {
		Node     model.Node       `json:"node"`
		Expected []map[string]any `json:"expected"`
	}
	if e = json.Unmarshal(data, &cases); e != nil {
		t.Fatal(e)
	}
	for i, c := range cases {
		t.Run(fmt.Sprintf("%02d_%s", i, c.Node.Kind), func(t *testing.T) {
			shapes, e := PrepareShapes(c.Node, ShapeGeometry{Grid: 128, Spacing: 1}, nil)
			if e != nil {
				t.Fatal(e)
			}
			if len(shapes) != len(c.Expected) {
				t.Fatalf("got %d shapes want %d", len(shapes), len(c.Expected))
			}
			referenceShapes(t, shapes, c.Expected)
		})
	}
}
func referenceShapes(t *testing.T, shapes []PreparedShape, expected []map[string]any) {
	t.Helper()
	if len(shapes) != len(expected) {
		t.Fatalf("got %d shapes want %d", len(shapes), len(expected))
	}
	for j, s := range shapes {
		if s.Op.Region == nil {
			t.Fatal("missing region")
		}
		r := s.Op.Region
		got := map[string]any{"region": map[string]any{"x0": float64(r.X0), "y0": float64(r.Y0), "x1": float64(r.X1), "y1": float64(r.Y1)}, "entry": s.Op.Entry, "settle": s.Op.Settle, "smoothR": float64(s.Op.SmoothRadius), "u": map[string]any{}}
		for k, v := range s.Op.Values {
			got["u"].(map[string]any)[k] = v
		}
		segs := make([]any, len(s.Segments))
		for k, x := range s.Segments {
			segs[k] = map[string]any{"px": x.PX, "py": x.PY, "ex": x.EX, "ey": x.EY, "f0": []any{x.F0[0], x.F0[1]}, "f1": []any{x.F1[0], x.F1[1]}, "nx": x.NX, "ny": x.NY, "frame": x.Frame, "jag": x.Jag, "box": []any{float64(x.Box.X0), float64(x.Box.Y0), float64(x.Box.X1), float64(x.Box.Y1)}}
		}
		got["segments"] = segs
		rows := make([]any, len(s.Extra))
		for k, x := range s.Extra {
			rows[k] = []any{x[0], x[1], x[2], x[3]}
		}
		got["extra"] = rows
		writes := make([]any, len(s.Writes))
		for k, x := range s.Writes {
			writes[k] = []any{x[0], x[1], x[2], x[3]}
		}
		got["writes"] = writes
		reads := make([]any, len(s.Op.PrefixReads))
		for k, x := range s.Op.PrefixReads {
			reads[k] = map[string]any{"x": x.X, "y": x.Y}
		}
		got["reads"] = reads
		if s.Op.Coast != nil {
			x := s.Op.Coast
			got["coast"] = map[string]any{"box": map[string]any{"x0": float64(x.Box.X0), "y0": float64(x.Box.Y0), "x1": float64(x.Box.X1), "y1": float64(x.Box.Y1)}, "readR": float64(x.ReadRadius), "maxCells": float64(x.MaxCells), "blurR": float64(x.BlurRadius), "siteFloats": float64(x.SiteFloats)}
		} else {
			got["coast"] = nil
		}
		if err := referenceCompare(expected[j], got, ""); err != nil {
			t.Errorf("shape %d: %v", j, err)
		}
	}
}

func referenceCompare(want, got any, path string) error {
	switch a := want.(type) {
	case map[string]any:
		b, ok := got.(map[string]any)
		if !ok {
			return fmt.Errorf("%s: got %T want object", path, got)
		}
		for k, v := range a {
			actual, ok := b[k]
			if !ok {
				if f, yes := v.(float64); yes && f == 0 {
					continue
				}
				return fmt.Errorf("%s.%s missing (want %v)", path, k, v)
			}
			if e := referenceCompare(v, actual, path+"."+k); e != nil {
				return e
			}
		}
	case []any:
		b, ok := got.([]any)
		if !ok || len(a) != len(b) {
			return fmt.Errorf("%s: got %v want %v", path, got, want)
		}
		for i, v := range a {
			if e := referenceCompare(v, b[i], fmt.Sprintf("%s[%d]", path, i)); e != nil {
				return e
			}
		}
	case float64:
		b, ok := got.(float64)
		if !ok || math.IsNaN(b) || math.IsInf(b, 0) || math.Abs(a-b) > 1e-7*math.Max(1, math.Abs(a)) {
			return fmt.Errorf("%s: got %v want %v", path, got, a)
		}
	default:
		if a != got {
			return fmt.Errorf("%s: got %v want %v", path, got, a)
		}
	}
	return nil
}
func TestComplexCompositionRegionalGPU(t *testing.T) {
	data, e := os.ReadFile("testdata/shape-reference.json")
	if e != nil {
		t.Fatal(e)
	}
	var cases []struct {
		Node model.Node `json:"node"`
	}
	if e = json.Unmarshal(data, &cases); e != nil {
		t.Fatal(e)
	}
	nodes := []model.Node{}
	for _, i := range []int{6, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21} {
		nodes = append(nodes, cases[i].Node)
	}
	g, e := NewGPU()
	if e != nil {
		t.Skipf("GPU unavailable: %v", e)
	}
	defer g.Close()
	src, e := os.ReadFile("../../engine-shape.wgsl")
	if e != nil {
		t.Fatal(e)
	}
	engine, e := NewShapeEngine(g, string(src), true)
	if e != nil {
		t.Fatal(e)
	}
	defer engine.Close()
	c := ShapeWindowConfig{Grid: 128, Spacing: 1, RefSpacing: 1, BaseHeight: 24, Sea: 20, MinHeight: -90, MaxHeight: 300, Window: CellRect{0, 0, 127, 127}}
	whole, e := engine.EvaluateShapeWindow(context.Background(), c, nodes)
	if e != nil {
		t.Fatal(e)
	}
	for _, r := range []CellRect{{0, 0, 63, 63}, {64, 0, 127, 63}, {0, 64, 63, 127}, {64, 64, 127, 127}} {
		c.Window = r
		part, e := engine.EvaluateShapeWindow(context.Background(), c, nodes)
		if e != nil {
			t.Fatal(e)
		}
		for y := 0; y < part.Height; y++ {
			for x := 0; x < part.Width; x++ {
				a, b := y*part.Width+x, (y+r.Y0)*whole.Width+x+r.X0
				for k := range part.Planes {
					if math.IsNaN(float64(part.Planes[k][a])) || math.IsInf(float64(part.Planes[k][a]), 0) || math.Float32bits(part.Planes[k][a]) != math.Float32bits(whole.Planes[k][b]) {
						t.Fatalf("region %+v plane %d at %d,%d: %v != %v", r, k, x, y, part.Planes[k][a], whole.Planes[k][b])
					}
				}
				for k := range part.Masks {
					if part.Masks[k][a] != whole.Masks[k][b] {
						t.Fatalf("region %+v mask %d at %d,%d", r, k, x, y)
					}
				}
			}
		}
	}
}
