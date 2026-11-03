package terrain

import (
	"github.com/nanolathe-gg/terraform/internal/membudget"
	"github.com/nanolathe-gg/terraform/internal/model"
	"math"
)

func shapeScratch(cells int, ops []PreparedOp) int {
	scratch := 3 * cells
	for _, op := range ops {
		if op.Coast != nil {
			scratch = max(scratch, 14*cells+op.Coast.SiteFloats)
		}
	}
	return scratch
}
func prefixWindow(c ShapeWindowConfig, ops []PreparedOp, i int, p model.Point) CellRect {
	gx, gy := clampNumber(p.X/c.Spacing, 0, float64(c.Grid-1)), clampNumber(p.Y/c.Spacing, 0, float64(c.Grid-1))
	ix, iy := int(math.Floor(gx)), int(math.Floor(gy))
	margin := 4
	for k := 0; k < i; k++ {
		r := ops[k].SmoothRadius
		if r == 0 && ops[k].Coast != nil {
			r = ops[k].Coast.ReadRadius
		}
		margin += r
	}
	return CellRect{max(0, ix-margin), max(0, iy-margin), min(c.Grid-1, min(ix+1, c.Grid-1)+margin), min(c.Grid-1, min(iy+1, c.Grid-1)+margin)}
}

// checkShapeMemory uses the actual dependency-expanded rectangle and the peak
// simultaneous prefix/staging buffers, before any of those buffers are made.
func checkShapeMemory(c ShapeWindowConfig, ops []PreparedOp, sizes []int, packedBytes, outputCells int, readback bool) error {
	limits := c.Memory
	defaults := membudget.FromConfig(nil)
	if limits.GPU <= 0 {
		limits.GPU = defaults.GPU
	}
	if limits.Heap <= 0 {
		limits.Heap = defaults.Heap
	}
	var main int64
	for _, size := range sizes {
		main += int64(max(16, size))
	}
	main += int64(packedBytes)
	var extra int64
	for i, op := range ops {
		for _, p := range op.PrefixReads {
			r := prefixWindow(c, ops, i, p)
			cells := (r.X1 - r.X0 + 1) * (r.Y1 - r.Y0 + 1)
			extra = max(extra, int64((13*cells+shapeScratch(cells, ops[:i]))*4+48))
		}
	}
	if readback {
		extra = max(extra, int64(sizes[6]))
	}
	if err := membudget.Require("Expanded shape GPU buffers", c.ReservedGPUBytes+main+extra, limits.GPU); err != nil {
		return err
	}
	heap := int64(packedBytes)
	if readback {
		heap += int64(sizes[6])*2 + int64(outputCells)*49
	}
	return membudget.Require("Expanded shape readback and packed tables", heap, limits.Working())
}
