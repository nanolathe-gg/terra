package terrain

import (
	"context"
	"math"

	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
)

// resolvePrefix reads each operation's anchor heights from the exact prefix on
// the GPU. Earlier anchor reads remain in the shared point buffer for later
// prefixes, including when the anchor is outside the requested output window.
func (s *ShapeEngine) resolvePrefix(ctx context.Context, c ShapeWindowConfig, ops []PreparedOp, segments, masks, points *wgpu.Buffer) error {
	next := 0
	for i := range ops {
		op := &ops[i]
		if len(op.PrefixReads) == 0 {
			continue
		}
		op.Values["preIdx"] = float64(next)
		for _, p := range op.PrefixReads {
			if err := ctx.Err(); err != nil {
				return err
			}
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
			window := CellRect{max(0, ix-margin), max(0, iy-margin), min(c.Grid-1, min(ix+1, c.Grid-1)+margin), min(c.Grid-1, min(iy+1, c.Grid-1)+margin)}
			w, h := window.X1-window.X0+1, window.Y1-window.Y0+1
			cells := w * h
			base := map[string]float64{"grid": float64(c.Grid), "spacing": c.Spacing, "baseH": c.BaseHeight, "sea": c.Sea, "minH": c.MinHeight, "maxH": c.MaxHeight, "ox": float64(window.X0), "oy": float64(window.Y0), "pw": float64(w), "ph": float64(h), "direct": 1}
			ref := c.RefSpacing
			if ref == 0 {
				ref = c.Spacing
			}
			base["blurR"] = float64(max(1, int(math.Floor(2*ref/c.Spacing+.5))))
			passes, err := PlanReplay(base, ops[:i], window, window, true)
			if err != nil {
				return err
			}
			passes = append(passes, ShapePass{Entry: "pointRead", Region: window, Values: copyValues(base, map[string]float64{"qx": p.X, "qy": p.Y, "preIdx": float64(next)})})
			usage := gputypes.BufferUsageStorage | gputypes.BufferUsageCopySrc | gputypes.BufferUsageCopyDst
			var b [8]*wgpu.Buffer
			b[4], b[5], b[7] = segments, masks, points
			for _, j := range []int{0, 1, 2, 3, 6} {
				size := 16
				switch j {
				case 0:
					size = 6 * cells * 4
				case 1:
					size = 7 * cells * 4
				case 3:
					scratch := 3 * cells
					for _, prior := range ops[:i] {
						if prior.Coast != nil {
							scratch = max(scratch, 14*cells+prior.Coast.SiteFloats)
						}
					}
					size = scratch * 4
				}
				b[j], err = s.gpu.Allocate("prefix window", uint64(size), usage)
				if err != nil {
					for _, k := range []int{0, 1, 2, 3, 6} {
						if b[k] != nil {
							b[k].Release()
						}
					}
					return err
				}
			}
			err = s.Dispatch(passes, b)
			for _, j := range []int{0, 1, 2, 3, 6} {
				b[j].Release()
			}
			if err != nil {
				return err
			}
			next++
		}
		op.PrefixResolved = true
	}
	return nil
}
