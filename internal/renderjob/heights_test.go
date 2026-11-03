package renderjob

import "testing"

func TestHeightCoverageIndependentOfImageCache(t *testing.T) {
	covered := map[string]bool{}
	plan := func(revision int) []Tile {
		return MissingHeightTiles(2100, 1800, 4300, 3000, 16000, 16000, revision, 256, func(k string) bool { return covered[k] })
	}
	first := plan(7)
	if len(first) != 45 {
		t.Fatalf("expected 45 bounded world tiles, got %d", len(first))
	}
	for _, p := range first {
		if p.Width > 256 || p.Height > 256 {
			t.Fatalf("unbounded tile: %+v", p)
		}
		covered[p.Key] = true
	}
	// The image cache can be entirely warm; height coverage alone prevents work.
	if got := plan(7); len(got) != 0 {
		t.Fatalf("covered view requested heights: %+v", got)
	}
	delete(covered, first[0].Key)
	if got := plan(7); len(got) != 1 || got[0].Key != first[0].Key {
		t.Fatalf("height eviction not refreshed on revisit: %+v", got)
	}
	if got := plan(8); len(got) != 45 {
		t.Fatalf("revision reused stale heights: %+v", got)
	}
}
func TestHeightCoverageBoundsLargeMap(t *testing.T) {
	if got := MissingHeightTiles(-20, -20, 100000, 100000, 2560, 2500, 1, 256, nil); len(got) != 100 {
		t.Fatalf("clipping: %+v", got)
	}
	if got := MissingHeightTiles(10, 10, 10, 20, 2560, 2500, 1, 256, nil); len(got) != 0 {
		t.Fatalf("empty view: %+v", got)
	}
}
