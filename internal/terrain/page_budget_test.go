package terrain

import (
	"github.com/nanolathe-gg/terraform/internal/model"
	"testing"
)

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
	if s.cacheBudget() != 64*mb || len(s.shapePages) != 1 || len(s.weatherPages) != 3 || s.shapePages[[2]int{0, 0}] != nil || s.shapePages[[2]int{1, 0}] != nil {
		t.Fatalf("did not evict oldest pages: shape=%v weather=%v budget=%d", s.shapePages, s.weatherPages, s.cacheBudget())
	}
	if s.cacheEvictions != 2 || s.cacheEvictedBytes != uint64(60*mb) {
		t.Fatal("eviction telemetry incorrect")
	}
	if err := s.UpdateConfig(map[string]any{"uiBitmapBytes": float64(60 * mb)}); err != nil {
		t.Fatal(err)
	}
	if len(s.shapePages) != 1 || len(s.weatherPages) != 3 {
		t.Fatal("relaxing reservation discarded pages")
	}
	if err := s.UpdateConfig(map[string]any{"uiBitmapBytes": float64(1024 * mb)}); err != nil {
		t.Fatal(err)
	}
	if len(s.shapePages) != 0 || len(s.weatherPages) != 0 || s.cacheBudget() != 0 {
		t.Fatal("large reservation did not evict pages")
	}
}

func TestWholeWeatherPageUsesSharedCacheCapacity(t *testing.T) {
	const mb = 1024 * 1024
	s := &SceneRenderer{config: map[string]any{"gpuMB": 512., "uiBitmapBytes": float64(16 * mb)}, renderer: &Renderer{Size: 2336, Grid: 1168}, shapePages: map[[2]int]*weatherFeed{}, weatherPages: map[[2]int]*weatherFeed{}}
	s.weatherPages[[2]int{0, 0}] = &weatherFeed{GPUFeed: GPUFeed{Grid: 1168}, bytes: 94 * mb, used: 1}
	s.shapePages[[2]int{0, 0}] = &weatherFeed{bytes: 50 * mb, used: 100}
	if s.weatherCacheBudget() < 94*mb || s.shapeCacheBudget() != 82*mb {
		t.Fatalf("weather %d shape %d", s.weatherCacheBudget(), s.shapeCacheBudget())
	}
	protected := s.weatherPages[[2]int{0, 0}]
	if !s.evictOldestPageExcept(protected) || len(s.shapePages) != 0 || len(s.weatherPages) != 1 {
		t.Fatal("authored page should yield before protected weather page")
	}
	if s.evictOldestPageExcept(protected) {
		t.Fatal("evicted protected borrowed page")
	}
	if err := s.UpdateConfig(map[string]any{"uiBitmapBytes": float64(32 * mb)}); err != nil {
		t.Fatal(err)
	}
	if len(s.weatherPages) != 1 {
		t.Fatal("discarded whole weather page despite shared headroom")
	}
	if err := s.UpdateConfig(map[string]any{"uiBitmapBytes": float64(110 * mb)}); err != nil {
		t.Fatal(err)
	}
	if len(s.weatherPages) != 0 {
		t.Fatal("retained whole weather page beyond shared cap")
	}
}

func TestPagedWeatherBorrowsUnusedAuthoredShare(t *testing.T) {
	const mb = 1024 * 1024
	nodes := []model.Node{{Kind: "hill", Params: map[string]any{"amount": 10.}}}
	s := &SceneRenderer{config: map[string]any{"gpuMB": 512., "uiBitmapBytes": float64(64 * mb)}, renderer: &Renderer{Size: 4000, Grid: 2000}, weatherNodes: model.CloneNodes(nodes), weatherNodesSet: true, shapePages: map[[2]int]*weatherFeed{}, weatherPages: map[[2]int]*weatherFeed{}}
	for i := 0; i < 6; i++ {
		s.weatherPages[[2]int{i, 0}] = &weatherFeed{bytes: 18 * mb, used: uint64(i)}
	}
	s.shapePages[[2]int{0, 0}] = &weatherFeed{bytes: 20 * mb}
	if s.weatherCacheBudget() != 108*mb || s.shapeCacheBudget() != 20*mb {
		t.Fatalf("pool weather=%d shape=%d", s.weatherCacheBudget(), s.shapeCacheBudget())
	}
	s.invalidateStaleWeather(nodes)
	if len(s.weatherPages) != 6 {
		t.Fatal("identical graph discarded valid weather")
	}
	nodes[0].Params["amount"] = 11.
	s.invalidateStaleWeather(nodes)
	if len(s.weatherPages) != 0 || s.weatherNodesSet {
		t.Fatal("authored change retained stale weather")
	}
}
