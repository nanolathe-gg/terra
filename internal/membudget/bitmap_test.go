package membudget

import (
	"math"
	"testing"
)

func TestMultiTileBitmapReservationCoversGrowthAndReplacement(t *testing.T) {
	l := FromConfig(map[string]any{"gpuMB": 128, "heapMB": 128})
	cap := min(l.Cache(), l.GPU/4)
	for _, live := range []int64{0, 30 * MiB, cap} {
		for _, pending := range []int64{0, MiB} {
			outputs := []int64{MiB / 4, MiB, MiB / 2, MiB / 4, MiB * 2}
			reserve := ProjectedBitmapResident(l, live, pending, outputs)
			for _, order := range [][]int{{0, 1, 2, 3, 4}, {4, 3, 2, 1, 0}, {3, 4, 1, 2, 0}} {
				actual := min(cap, live+pending)
				for _, i := range order {
					incoming := outputs[i]
					// The engine adds incoming before the UI can trim or close a replaced tile.
					if actual+incoming > reserve+incoming {
						t.Fatalf("under-reserved cache live%d pending%d: actual%d reserve%d", live, pending, actual, reserve)
					}
					actual = min(cap, actual+incoming)
				}
			}
		}
	}
}
func TestNearBudgetLaterTileRefusesBeforeIncomingAllocation(t *testing.T) {
	l := FromConfig(map[string]any{"gpuMB": 128, "heapMB": 128})
	live := 31 * MiB
	tile := MiB / 4
	engine := 96 * MiB
	reserve := ProjectedBitmapResident(l, live, 0, []int64{tile, tile, tile, tile, tile, tile})
	if Require("old snapshot", engine+live+tile, l.GPU) != nil {
		t.Fatal("fixture must reproduce old false success")
	}
	if Require("projected later tile", engine+reserve+tile, l.GPU) == nil {
		t.Fatal("later incoming tile exceeds128MiB and must refuse")
	}
}
func TestSmallBatchDoesNotReserveWholeCachePartition(t *testing.T) {
	l := FromConfig(map[string]any{"gpuMB": 128, "heapMB": 128})
	one := 16 * MiB
	resident := ProjectedBitmapResident(l, 0, 0, []int64{one})
	if resident != 0 {
		t.Fatal("single incoming image is already budgeted by presentation")
	}
	if err := Require("one bitmap", 100*MiB+resident+one, l.GPU); err != nil {
		t.Fatal(err)
	}
	if Require("unnecessarily full cache", 100*MiB+l.GPU/4+one, l.GPU) == nil {
		t.Fatal("fixture should distinguish full partition false refusal")
	}
	if got := ProjectedBitmapResident(l, 40*MiB, 0, nil); got != 40*MiB {
		t.Fatal("live cache was understated after a limit reduction")
	}
}
func TestBitmapOutputScaleAndInvalidSizes(t *testing.T) {
	n, err := BitmapBytes(513, 257, 2)
	if err != nil || n != 257*129*4 {
		t.Fatal(n, err)
	}
	for _, scale := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		if _, err := BitmapBytes(256, 256, scale); err == nil {
			t.Fatal("invalid scale accepted")
		}
	}
}
