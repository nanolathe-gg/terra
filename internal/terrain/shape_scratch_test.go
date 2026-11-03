package terrain

import "testing"

// Direct shape entries only touch Sc when their replay plans enable settling,
// smoothing or coast passes. Keep the allocation decision tied to those plans.
func TestScratchFollowsNeighbourhoodReplay(t *testing.T) {
	rect := CellRect{0, 0, 31, 31}
	for _, tc := range []struct {
		name      string
		op        PreparedOp
		neighbour bool
	}{
		{"ground", PreparedOp{Ground: true}, false},
		{"direct Landform", PreparedOp{Entry: "landform", Region: &rect}, false},
		{"paint", PreparedOp{Entry: "stamp", Region: &rect}, false},
		{"settled hill", PreparedOp{Entry: "stamp", Region: &rect, Settle: true}, true},
		{"smooth", PreparedOp{Entry: "stamp", Region: &rect, SmoothRadius: 2}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			passes, err := PlanReplay(map[string]float64{"grid": 32, "spacing": 1}, []PreparedOp{tc.op}, rect, rect, true)
			if err != nil {
				t.Fatal(err)
			}
			readsScratch := false
			for _, p := range passes {
				readsScratch = readsScratch || p.Entry == "blurH" || p.Entry == "blurV" || p.Entry == "compose" || p.Entry == "smoothCopy"
			}
			if readsScratch != tc.neighbour {
				t.Fatal("replay plan scratch classification changed")
			}
			size := shapeScratch(32*32, []PreparedOp{tc.op})
			if readsScratch && size < 3*32*32 {
				t.Fatal("neighbourhood replay lacks its three scratch planes")
			}
			if !readsScratch && size != 4 {
				t.Fatalf("direct replay unnecessarily allocates %d floats", size)
			}
		})
	}
}
