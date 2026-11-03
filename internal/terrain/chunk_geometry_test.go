package terrain

import (
	"math"
	"testing"
)

func TestFitOverviewMatchesMainMeshScale(t *testing.T) {
	// A 40x40 overview tile spans 5120 world pixels but only256 output pixels.
	// Main's requiredRegion multiplies fullStep by meshScale for Fit alone.
	r := &Renderer{Size: 20640, Grid: 10320, Config: map[string]any{}, Variant: map[string]string{}}
	window := SceneWindow{X: 5120, Y: 5120, Width: 5120, Height: 5120, Scale: 20, Preview: true}
	fit := r.RequiredRegion(window, true)
	expected := int(math.Ceil(float64(r.Size-1) / ((1023. / 512) * window.Scale)))
	if fit.Resolution != expected {
		t.Fatalf("overview resolution%d, main formula%d", fit.Resolution, expected)
	}
	triangles := 2 * (fit.Col1 - fit.Col0) * (fit.Row1 - fit.Row0)
	if triangles > 50000 {
		t.Fatalf("256px overview tile has %d triangles", triangles)
	}
	window.Preview = false
	canonical := r.RequiredRegion(window, true)
	expectedCanonical := int(math.Ceil(float64(r.Size-1) / (1023. / 512)))
	if canonical.Resolution != expectedCanonical {
		t.Fatal("canonical global mesh changed")
	}
	if 2*(canonical.Col1-canonical.Col0)*(canonical.Row1-canonical.Row0) < triangles*100 {
		t.Fatal("fixture does not exercise oversized canonical mesh")
	}
	t.Logf("Fit triangles%d; canonical triangles%d", triangles, 2*(canonical.Col1-canonical.Col0)*(canonical.Row1-canonical.Row0))
}
func TestFitMeshScaleAlsoMatchesFractionalZoom(t *testing.T) {
	r := &Renderer{Size: 1024, Grid: 512, Config: map[string]any{}, Variant: map[string]string{}}
	for _, full := range []bool{false, true} {
		for _, scale := range []float64{.5, 1, 2, 19.75} {
			base := 1023. / 192
			if full {
				base = 1023. / 512
			}
			fit := r.RequiredRegion(SceneWindow{Width: 128, Height: 128, Scale: scale, Preview: true}, full)
			if fit.Resolution != int(math.Ceil(1023/(base*scale))) {
				t.Fatalf("full%v scale%g: resolution%d", full, scale, fit.Resolution)
			}
			normal := r.RequiredRegion(SceneWindow{Width: 128, Height: 128, Scale: scale}, full)
			if normal.Resolution != int(math.Ceil(1023/base)) {
				t.Fatal("ordinary zoom changed canonical lattice")
			}
		}
	}
}
