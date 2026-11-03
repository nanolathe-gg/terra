package terrain

import "testing"

func TestPageCacheBudgetTracksBitmapAndEvictsLRU(t *testing.T) {
	const mb = 1024 * 1024
	s := &SceneRenderer{config: map[string]any{"gpuMB": 512.}, renderer: &Renderer{Size: 100, Grid: 20}, shapePages: map[[2]int]*weatherFeed{}, weatherPages: map[[2]int]*weatherFeed{}}
	for i := 0; i < 3; i++ {
		s.shapePages[[2]int{i, 0}] = &weatherFeed{bytes: 30 * mb, used: uint64(i + 1)}
		s.weatherPages[[2]int{i, 0}] = &weatherFeed{bytes: 30 * mb, used: uint64(i + 1)}
	}
	if s.cacheBudget() != 96*mb {
		t.Fatalf("initial budget %d", s.cacheBudget())
	}
	if err := s.UpdateConfig(map[string]any{"uiBitmapBytes": float64(64 * mb)}); err != nil {
		t.Fatal(err)
	}
	if s.cacheBudget() != 64*mb || len(s.shapePages) != 2 || len(s.weatherPages) != 2 || s.shapePages[[2]int{0, 0}] != nil || s.weatherPages[[2]int{0, 0}] != nil {
		t.Fatalf("did not evict oldest pages: shape=%v weather=%v budget=%d", s.shapePages, s.weatherPages, s.cacheBudget())
	}
	if s.cacheEvictions != 2 || s.cacheEvictedBytes != uint64(60*mb) {
		t.Fatal("eviction telemetry incorrect")
	}
	if err := s.UpdateConfig(map[string]any{"uiBitmapBytes": float64(60 * mb)}); err != nil {
		t.Fatal(err)
	}
	if len(s.shapePages) != 2 || len(s.weatherPages) != 2 {
		t.Fatal("relaxing reservation discarded pages")
	}
	if err := s.UpdateConfig(map[string]any{"uiBitmapBytes": float64(1024 * mb)}); err != nil {
		t.Fatal(err)
	}
	if len(s.shapePages) != 0 || len(s.weatherPages) != 0 || s.cacheBudget() != 0 {
		t.Fatal("large reservation did not evict pages")
	}
}
