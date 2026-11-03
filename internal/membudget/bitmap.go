package membudget

import (
	"fmt"
	"math"
)

// BitmapBytes describes the actual output pixels, not the window's world area.
func BitmapBytes(width, height int, scale float64) (int64, error) {
	if width <= 0 || height <= 0 || scale <= 0 || math.IsNaN(scale) || math.IsInf(scale, 0) {
		return 0, fmt.Errorf("invalid bitmap dimensions or scale")
	}
	w, h := math.Ceil(float64(width)/scale), math.Ceil(float64(height)/scale)
	if w > math.MaxInt32 || h > math.MaxInt32 {
		return 0, fmt.Errorf("bitmap dimensions exceed supported range")
	}
	n := Area(int(w), int(h), 4)
	if n == math.MaxInt64 {
		return 0, fmt.Errorf("bitmap size overflow")
	}
	return n, nil
}

// ProjectedBitmapResident bounds the UI bitmap bytes that may coexist BEFORE
// creating any incoming output in a multi-tile job. PresentBitmap separately
// budgets that incoming bitmap and its canvas, including replacement-before-
// trim overlap. Do not add the incoming image here a second time.
//
// The worker waits for UI admission/release acknowledgment before any later
// GPU allocation, so previous outputs have been trimmed before the next image
// is made. A superseded viewport may still deliver one image; pending bounds
// that image. Outputs may be reordered after the request is built, so subtract
// only the smallest output when finding the largest possible preceding prefix.
func ProjectedBitmapResident(l Limits, live, pending int64, outputs []int64) int64 {
	live = max(0, live)
	pending = max(0, pending)
	cap := min(l.Cache(), l.GPU/4)
	growth := pending
	smallest := int64(math.MaxInt64)
	for _, n := range outputs {
		if n < 0 {
			return math.MaxInt64
		}
		if growth > math.MaxInt64-n {
			return math.MaxInt64
		}
		growth += n
		smallest = min(smallest, n)
	}
	if len(outputs) > 0 {
		growth -= smallest
	}
	// Never understate an already-live cache after a budget reduction. The UI
	// normally trims first, but this helper does not assume an unproved trim.
	if live > math.MaxInt64-growth {
		return math.MaxInt64
	}
	return max(live, min(cap, live+growth))
}
