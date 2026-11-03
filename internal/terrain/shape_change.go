package terrain

import (
	"fmt"
	"math"
	"reflect"

	"github.com/nanolathe-gg/terraform/internal/model"
)

// ChangedShapeRegion conservatively bounds the authored cells affected by a
// graph edit, including downstream blur, coast and prefix-read dependencies.
// A nil region means identical graphs; full means the whole map is affected.
func ChangedShapeRegion(before, after []model.Node, c ShapeWindowConfig) (region *CellRect, full bool, err error) {
	if c.Grid <= 0 || c.Spacing <= 0 {
		return nil, true, fmt.Errorf("invalid shape geometry")
	}
	first := 0
	for first < len(before) && first < len(after) && reflect.DeepEqual(before[first], after[first]) {
		first++
	}
	if first == len(before) && first == len(after) {
		return nil, false, nil
	}
	oldEnd, newEnd := len(before), len(after)
	for oldEnd > first && newEnd > first && reflect.DeepEqual(before[oldEnd-1], after[newEnd-1]) {
		oldEnd--
		newEnd--
	}
	whole := CellRect{0, 0, c.Grid - 1, c.Grid - 1}
	geom := ShapeGeometry{Grid: c.Grid, Spacing: c.Spacing, RefSpacing: c.RefSpacing}
	type indexed struct {
		node int
		op   PreparedOp
	}
	prep := func(nodes []model.Node) ([]indexed, error) {
		var out []indexed
		for i, n := range nodes {
			shapes, e := PrepareShapes(n, geom, c.Defaults)
			if e != nil {
				return nil, e
			}
			for _, shape := range shapes {
				out = append(out, indexed{i, shape.Op})
			}
		}
		return out, nil
	}
	oldOps, e := prep(before)
	if e != nil {
		return nil, true, e
	}
	newOps, e := prep(after)
	if e != nil {
		return nil, true, e
	}
	add := func(r CellRect) {
		if r.X0 > r.X1 || r.Y0 > r.Y1 {
			return
		}
		if region == nil {
			x := r
			region = &x
		} else {
			x := union(*region, r)
			region = &x
		}
	}
	bounds := func(op PreparedOp) *CellRect {
		if op.Ground {
			return &whole
		}
		var out *CellRect
		if op.Region != nil {
			r := *op.Region
			if op.Settle {
				r = expand(r, 4, whole)
			}
			out = &r
		}
		if op.Coast != nil {
			r := op.Coast.Box
			if out != nil {
				r = union(*out, r)
			}
			out = &r
		}
		return out
	}
	seed := func(ops []indexed, end int) bool {
		for _, p := range ops {
			if p.node < first || p.node >= end {
				continue
			}
			if p.op.Ground {
				return true
			}
			if b := bounds(p.op); b != nil {
				add(*b)
			}
		}
		return false
	}
	if seed(oldOps, oldEnd) || seed(newOps, newEnd) {
		return &whole, true, nil
	}
	if region == nil {
		return nil, false, nil
	}
	propagate := func(indexedOps []indexed) bool {
		ops := make([]PreparedOp, len(indexedOps))
		for i, p := range indexedOps {
			ops[i] = p.op
		}
		for i, p := range indexedOps {
			if p.node < first {
				continue
			}
			op := p.op
			if op.Ground {
				return true
			}
			for _, anchor := range op.PrefixReads {
				if _, hit := intersect(*region, prefixWindow(c, ops, i, anchor)); hit {
					if b := bounds(op); b != nil {
						add(*b)
					}
					break
				}
			}
			if op.Coast != nil {
				if _, hit := intersect(*region, expand(op.Coast.Box, op.Coast.ReadRadius, whole)); hit {
					add(op.Coast.Box)
				}
			}
			halo := op.SmoothRadius
			if op.Settle {
				halo = max(halo, 4)
			}
			if halo > 0 && op.Region != nil {
				extent := *op.Region
				if op.Settle {
					extent = expand(extent, 4, whole)
				}
				if r, hit := intersect(expand(*region, halo, whole), extent); hit {
					add(r)
				}
			}
		}
		return false
	}
	for {
		previous := *region
		if propagate(oldOps) || propagate(newOps) {
			return &whole, true, nil
		}
		if *region == previous {
			break
		}
	}
	return region, region != nil && *region == whole, nil
}

// CellRegionWorld returns the conservative world-space rectangle for UI caches.
func CellRegionWorld(r CellRect, spacing float64) model.Rect {
	return model.Rect{X: float64(r.X0) * spacing, Y: float64(r.Y0) * spacing, Width: math.Max(spacing, float64(r.X1-r.X0+1)*spacing), Height: math.Max(spacing, float64(r.Y1-r.Y0+1)*spacing)}
}
