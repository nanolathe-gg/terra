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
	_, err := PrepareBasicShape(model.Node{Kind: "crystal"}, ShapeGeometry{}, nil)
	if err == nil {
		t.Fatal("unsupported shape silently accepted")
	}
}
func TestPrepareHillMatchesReference(t *testing.T) {
	q := map[string]any{"radius": 20.0, "amount": 50.0, "rough": .2, "softness": .5, "outlineVar": 1.0, "widthVar": 1.0, "heightVar": 1.0}
	n := model.Node{Kind: "hill", Seed: 123, Points: []model.Point{{X: 20, Y: 30}, {X: 40, Y: 35}, {X: 60, Y: 25}}, Params: q}
	p, e := PrepareBasicShape(n, ShapeGeometry{Grid: 128, Spacing: 1}, nil)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.Segments) != 3 || *p.Op.Region != (CellRect{0, 0, 95, 69}) || !p.Op.Settle || len(p.Extra) != 34 {
		t.Fatalf("unexpected hill preparation: %+v", p)
	}
	if math.Abs(p.Segments[0].F0[0]-(-.24253562503633297)) > 1e-12 || math.Abs(p.Op.Values["faceX"]-.16608073512242313) > 1e-12 {
		t.Fatalf("hill frame differs: %+v %+v", p.Segments[0], p.Op.Values)
	}
}
func TestPrepareRampMatchesReference(t *testing.T) {
	q := map[string]any{"radius": 20., "amount": 50., "rough": .2, "softness": .5, "outlineVar": 1., "widthVar": 1., "heightVar": 1.}
	n := model.Node{Kind: "ramp", Seed: 123, Points: []model.Point{{X: 20, Y: 30}, {X: 40, Y: 35}, {X: 60, Y: 25}}, Params: q}
	p, e := PrepareBasicShape(n, ShapeGeometry{Grid: 128, Spacing: 1}, nil)
	if e != nil {
		t.Fatal(e)
	}
	if len(p.Segments) != 11 || *p.Op.Region != (CellRect{0, 3, 82, 55}) || len(p.Op.PrefixReads) != 2 {
		t.Fatalf("bad ramp: %+v", p)
	}
	if math.Abs(p.Segments[0].F1[0]-42.14725170590348) > 1e-12 {
		t.Fatalf("bad ramp length: %+v", p.Segments[0])
	}
}
func TestPrepareWaterCoastMatchesReference(t *testing.T) {
	q := map[string]any{"radius": 12., "amount": 30., "rough": .2, "softness": .5, "bankWidth": .5, "shelves": .4, "outlineVar": 1., "widthVar": 1., "heightVar": 1., "fingers": .3, "fingerSize": 1., "shoreLayers": 1., "layerPx": 5., "layerLedge": .6, "layerRough": .3, "layerVary": .2, "layerCircle": 8., "layerStyle": 0.}
	n := model.Node{Kind: "deep", Seed: 123, Points: []model.Point{{X: 40, Y: 45}, {X: 70, Y: 55}}, Params: q}
	p, e := PrepareBasicShape(n, ShapeGeometry{Grid: 128, Spacing: 1}, nil)
	if e != nil {
		t.Fatal(e)
	}
	if *p.Op.Region != (CellRect{18, 23, 92, 77}) || p.Op.Coast == nil || p.Op.Coast.Box != (CellRect{0, 0, 127, 117}) || p.Op.Coast.ReadRadius != 52 || len(p.Extra) != 18 {
		t.Fatalf("bad coast: %+v", p)
	}
	if math.Abs(p.Op.Values["coLReach"]-27.92) > 1e-10 || math.Abs(p.Segments[0].NX-(-.26861879229545593)) > 1e-10 {
		t.Fatalf("coast values differ: %+v", p.Op.Values)
	}
}
