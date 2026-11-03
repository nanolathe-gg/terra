package terrain

import "testing"

func TestShineGroupShareGate(t *testing.T) {
	for _, tt := range []struct {
		name             string
		gloss, rough     float64
		slopeShare, want bool
	}{
		{"Slope", 1, 0, false, false}, {"Slope", 0, 1, false, false},
		{"Slope", 1, 0, true, true}, {"Slope", 0, 1, true, true},
		{"Rock", 1, 0, false, true}, {"Ground", 0, 1, false, true},
		{"Slope", 0, 0, true, false},
	} {
		if got := shineGroupActive(tt.name, tt.gloss, tt.rough, tt.slopeShare); got != tt.want {
			t.Errorf("%+v got %v", tt, got)
		}
	}
}
