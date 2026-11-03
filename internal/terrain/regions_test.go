package terrain

import "testing"

func TestRequiredRegionsExpandsPrefixOnly(t *testing.T) {
	whole := CellRect{0, 0, 99, 99}
	r := CellRect{40, 40, 50, 50}
	foot := CellRect{45, 45, 60, 60}
	regions, init := RequiredRegions([]RegionalDependency{{}, {Region: &foot, SmoothRadius: 5}}, r, whole)
	if regions[1] != r || regions[0] != (CellRect{40, 40, 55, 55}) || init != regions[0] {
		t.Fatalf("regions %v init %v", regions, init)
	}
}
