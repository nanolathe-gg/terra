package terrain

import (
	"math"
	"testing"
)

func TestHeightWindowCoversProjectionWithoutShadingApron(t *testing.T) {
	r := &Renderer{Size: 4096, Grid: 1024, Config: map[string]any{"seaLevel": 0., "baseHeight": 24.}, Variant: map[string]string{}}
	s := &SceneRenderer{renderer: r}
	view := SceneWindow{X: 1100, Y: 1300, Width: 256, Height: 256, Scale: 1}
	w := s.HeightWindow(view, DrawOptions{Full: true})
	_, _, _, projection := r.reaches(true)
	if float64(w.X) > float64(view.X) || float64(w.X+w.Width) < float64(view.X+view.Width) || float64(w.Y) > float64(view.Y)+math.Min(0, projection[0]) || float64(w.Y+w.Height) < float64(view.Y+view.Height)+math.Max(0, projection[1]) {
		t.Fatalf("height window misses projected view: %+v projection %v", w, projection)
	}
	full := r.RequiredRegion(view, true)
	if w.Width >= int(float64(full.GridWidth)*full.GridSpacing) {
		t.Fatalf("height window retained shading apron: %+v versus %+v", w, full)
	}
}
