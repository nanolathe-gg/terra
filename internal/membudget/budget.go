// Package membudget bounds retained page data and individual terrain jobs.
// Limits cover managed image/field data, not the Go runtime or browser overhead.
package membudget

import (
	"fmt"
	"math"
)

const MiB int64 = 1024 * 1024
const MinimumMiB = 128

type Limits struct{ GPU, Heap int64 }

func FromConfig(config map[string]any) Limits {
	return Limits{GPU: bytes(config, "gpuBudgetBytes", "gpuMB", "gpuBudgetMB", 512), Heap: bytes(config, "heapBudgetBytes", "heapMB", "heapBudgetMB", 1024)}
}
func numeric(v any) float64 {
	switch n := v.(type) {
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case float64:
		return n
	case float32:
		return float64(n)
	}
	return 0
}
func bytes(c map[string]any, exact, mb, alias string, fallback int64) int64 {
	n := numeric(c[exact])
	if n <= 0 {
		n = numeric(c[mb]) * float64(MiB)
	}
	if n <= 0 {
		n = numeric(c[alias]) * float64(MiB)
	}
	if n <= 0 || math.IsNaN(n) || math.IsInf(n, 0) {
		n = float64(fallback * MiB)
	}
	return int64(math.Min(n, float64(8192*MiB)))
}

// Split retained UI data, worker working data and transfer/copy headroom so
// independent worker and UI heaps cannot each consume the entire page limit.
func (l Limits) Cache() int64    { return l.Heap / 4 }
func (l Limits) Working() int64  { return l.Heap / 2 }
func (l Limits) Transfer() int64 { return l.Heap / 4 }

type LimitError struct {
	Label             string
	Needed, Available int64
}

func (e *LimitError) Error() string {
	return fmt.Sprintf("%s needs %.1f MiB; available budget is %.1f MiB. Use a smaller window or increase the memory budget.", e.Label, float64(e.Needed)/float64(MiB), float64(e.Available)/float64(MiB))
}
func Require(label string, needed, available int64) error {
	if needed < 0 || needed > available {
		return &LimitError{Label: label, Needed: needed, Available: available}
	}
	return nil
}

// Area rejects invalid sizes and multiplication overflow before allocation.
func Area(width, height int, bytesPerCell int64) int64 {
	if width <= 0 || height <= 0 || bytesPerCell <= 0 || int64(width) > math.MaxInt64/int64(height)/bytesPerCell {
		return math.MaxInt64
	}
	return int64(width) * int64(height) * bytesPerCell
}
func (l Limits) Authored(width, height int) error {
	// 12 float planes + 25 masks, GPU mapped staging, packed transfer and JS copy.
	return Require("Authored field readback", Area(width, height, 256), l.Working())
}
func (l Limits) Fill(width, height int) error {
	// Cell heights plus candidate/placement bookkeeping; tile readbacks use the
	// remaining half of worker headroom. No full-resolution map image is built.
	return Require("Feature fill", Area(width, height, 256), l.Working()/2)
}
func (l Limits) Image(width, height int) error {
	// RGBA output, encode/filter scratch and transfer, before making any buffers.
	return Require("Terrain image", Area(width, height, 24), l.Working())
}
