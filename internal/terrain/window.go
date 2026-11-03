package terrain

import (
	"context"
	"encoding/binary"
	"fmt"
	"math"

	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
	"github.com/nanolathe-gg/terraform/internal/membudget"
	"github.com/nanolathe-gg/terraform/internal/model"
)

// ShapeWindowConfig describes a bounded window in the whole-map lattice.
type ShapeWindowConfig struct {
	Grid                                                       int
	Spacing, RefSpacing, BaseHeight, Sea, MinHeight, MaxHeight float64
	Window                                                     CellRect
	Defaults                                                   map[string]any
	Memory                                                     membudget.Limits
	ReservedGPUBytes                                           int64
	CallbackGPUBytes                                           int64
	preflightOnly                                              bool
}
type ShapeWindow struct {
	Rect          CellRect
	Width, Height int
	Planes        [6][]float32
	Masks         [25][]int8
}

// EvaluateShapeWindow allocates only the requested cells and replays supported
// operations with direct, world-coordinate noise. Unsupported operations fail
// rather than returning an incomplete terrain.
func (s *ShapeEngine) EvaluateShapeWindow(ctx context.Context, c ShapeWindowConfig, nodes []model.Node) (*ShapeWindow, error) {
	return s.evaluateShapeWindow(ctx, c, nodes, true, true, nil)
}

type shapeBuffersCallback func(CellRect, *wgpu.Buffer, *wgpu.Buffer) error

func (s *ShapeEngine) evaluateShapeWindow(ctx context.Context, c ShapeWindowConfig, nodes []model.Node, expandTarget, readback bool, callback shapeBuffersCallback) (*ShapeWindow, error) {
	whole := CellRect{0, 0, c.Grid - 1, c.Grid - 1}
	window, ok := intersect(c.Window, whole)
	if !ok {
		return nil, fmt.Errorf("shape window outside map")
	}
	outW, outH := window.X1-window.X0+1, window.Y1-window.Y0+1
	outCells := outW * outH
	if c.Grid <= 0 || c.Spacing <= 0 {
		return nil, fmt.Errorf("invalid shape geometry")
	}
	geometry := ShapeGeometry{Grid: c.Grid, Spacing: c.Spacing, RefSpacing: c.RefSpacing}
	shapes := make([]PreparedShape, 0, len(nodes))
	for i, n := range nodes {
		p, e := PrepareShapes(n, geometry, c.Defaults)
		if e != nil {
			return nil, fmt.Errorf("node %d: %w", i, e)
		}
		shapes = append(shapes, p...)
	}
	ops, segData, maskData := PackPreparedShapes(shapes)
	deps := make([]RegionalDependency, len(ops))
	for i, op := range ops {
		deps[i] = RegionalDependency{Region: op.Region, SmoothRadius: op.SmoothRadius}
		if op.Coast != nil {
			deps[i].CoastBox = &op.Coast.Box
			deps[i].CoastReadRadius = op.Coast.ReadRadius
		}
	}
	_, target := RequiredRegions(deps, window, whole)
	if expandTarget {
		for _, op := range ops {
			if op.Settle && op.Region != nil {
				if _, ok := intersect(target, expand(*op.Region, 4, whole)); ok {
					target = expand(target, 4, whole)
					break
				}
			}
		}
	} else {
		target = window
	}
	w, h := target.X1-target.X0+1, target.Y1-target.Y0+1
	cells := w * h
	base := map[string]float64{"grid": float64(c.Grid), "spacing": c.Spacing, "baseH": c.BaseHeight, "sea": c.Sea, "minH": c.MinHeight, "maxH": c.MaxHeight, "ox": float64(target.X0), "oy": float64(target.Y0), "pw": float64(w), "ph": float64(h), "direct": 1}
	ref := c.RefSpacing
	if ref == 0 {
		ref = c.Spacing
	}
	base["blurR"] = float64(max(1, int(math.Floor(2*ref/c.Spacing+.5))))
	q4 := (outCells + 3) / 4
	words := 6*outCells + 25*q4
	usage := gputypes.BufferUsageStorage | gputypes.BufferUsageCopySrc | gputypes.BufferUsageCopyDst
	var buffers [8]*wgpu.Buffer
	cleanup := func() {
		for _, b := range buffers {
			if b != nil {
				b.Release()
			}
		}
	}
	defer cleanup()
	reads := 0
	for _, op := range ops {
		reads += len(op.PrefixReads)
	}
	scratch := shapeScratch(cells, ops)
	outputBytes := 16
	if readback {
		outputBytes = words * 4
	}
	sizes := []int{6 * cells * 4, 7 * cells * 4, 16, scratch * 4, 0, 0, outputBytes, max(16, reads*4)}
	if err := checkShapeMemory(c, ops, sizes, len(segData)+len(maskData), outCells, readback); err != nil {
		return nil, err
	}
	if c.preflightOnly {
		return &ShapeWindow{Rect: window, Width: outW, Height: outH}, nil
	}
	var e error
	for i := range buffers {
		switch i {
		case 4:
			buffers[i], e = s.gpu.Buffer("shape segments", segData, usage)
		case 5:
			buffers[i], e = s.gpu.Buffer("shape masks and curves", maskData, usage)
		default:
			buffers[i], e = s.gpu.Allocate("shape window", uint64(sizes[i]), usage)
		}
		if e != nil {
			return nil, e
		}
	}
	if e = s.resolvePrefix(ctx, c, ops, buffers[4], buffers[5], buffers[7]); e != nil {
		return nil, e
	}
	passes, e := PlanReplay(base, ops, window, target, true)
	if e != nil {
		return nil, e
	}
	if readback {
		passes = append(passes, ShapePass{Entry: "pack", Region: window, Values: base, OutputWords: words})
	}
	if e = s.Dispatch(passes, buffers); e != nil {
		return nil, e
	}
	if callback != nil {
		if e = callback(target, buffers[0], buffers[1]); e != nil {
			return nil, e
		}
	}
	if !readback {
		return &ShapeWindow{Rect: window, Width: outW, Height: outH}, nil
	}
	data, e := s.gpu.ReadBuffer(ctx, buffers[6], 0, uint64(words*4))
	if e != nil {
		return nil, e
	}
	result := &ShapeWindow{Rect: window, Width: outW, Height: outH}
	for plane := range result.Planes {
		a := make([]float32, outCells)
		for i := range a {
			a[i] = math.Float32frombits(binary.LittleEndian.Uint32(data[(plane*outCells+i)*4:]))
		}
		result.Planes[plane] = a
	}
	for plane := range result.Masks {
		a := make([]int8, outCells)
		offset := (6*outCells + plane*q4) * 4
		for i := range a {
			a[i] = int8(data[offset+i])
		}
		result.Masks[plane] = a
	}
	return result, nil
}
