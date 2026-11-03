package main

import (
	"github.com/nanolathe-gg/terraform/internal/terrain"
	"testing"
)

func TestSampleNativeHeight(t *testing.T) {
	r := &terrain.SceneResult{Heights: []float32{-10, 10, 20, 300}, HeightWidth: 2, HeightHeight: 2, HeightOriginX: 32, HeightOriginY: 64, HeightSpacing: 16}
	for _, test := range []struct {
		x, y float64
		want int
	}{{32, 64, 0}, {48, 80, 255}, {40, 72, 80}} {
		v, e := sampleNativeHeight(r, test.x, test.y)
		if e != nil || v != test.want {
			t.Fatalf("(%g,%g) = %d, %v; want %d", test.x, test.y, v, e, test.want)
		}
	}
	if _, e := sampleNativeHeight(r, 31, 64); e == nil {
		t.Fatal("accepted coordinates outside readback")
	}
}
