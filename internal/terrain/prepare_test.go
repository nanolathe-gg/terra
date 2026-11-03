package terrain

import (
	"github.com/nanolathe-gg/terraform/internal/model"
	"math"
	"testing"
)

func TestPreparePaintMatchesReference(t *testing.T) {
	q := map[string]any{"radius": 20.0, "amount": 50.0, "rough": .2, "softness": .5, "outlineVar": 1.0, "widthVar": 1.0, "heightVar": 1.0, "maskAmount": 1.0, "paintChannel": 3.0}
	n := model.Node{Kind: "paint", Seed: 123, Points: []model.Point{{X: 20, Y: 30}, {X: 80, Y: 30}}, Params: q}
	p, e := PrepareBasicShape(n, ShapeGeometry{Grid: 128, Spacing: 1}, nil)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.Segments) != 3 || *p.Op.Region != (CellRect{0, 0, 113, 63}) || len(p.Extra) != 17 || len(p.Writes) != 1 || p.Writes[0] != (MaskWrite{2, 127, 1, 0}) {
		t.Fatalf("unexpected preparation %+v", p)
	}
	if math.Abs(p.Segments[0].NX-(-.09269659221172333)) > 1e-10 || math.Abs(p.Segments[2].NY-(-.2202201634645462)) > 1e-10 {
		t.Fatalf("noise differs %+v", p.Segments)
	}
}
func TestUnsupportedShapeReturnsError(t *testing.T) {
	_, err := PrepareBasicShape(model.Node{Kind: "deep"}, ShapeGeometry{}, nil)
	if err == nil {
		t.Fatal("unsupported shape silently accepted")
	}
}
