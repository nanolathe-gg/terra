package model

import (
	"errors"
	"math"
)

type TransformValues struct{ X, Y, Rotation, Scale float64 }

func (n Node) Bounds() (GridBounds, bool) {
	if len(n.Points) == 0 {
		return GridBounds{}, false
	}
	b := GridBounds{n.Points[0].X, n.Points[0].Y, n.Points[0].X, n.Points[0].Y}
	for _, p := range n.Points[1:] {
		b.X0 = math.Min(b.X0, p.X)
		b.Y0 = math.Min(b.Y0, p.Y)
		b.X1 = math.Max(b.X1, p.X)
		b.Y1 = math.Max(b.Y1, p.Y)
	}
	return b, true
}

type GridBounds struct{ X0, Y0, X1, Y1 float64 }

func (n Node) Pivot() (Point, bool) {
	b, ok := n.Bounds()
	return Point{(b.X0 + b.X1) / 2, (b.Y0 + b.Y1) / 2}, ok
}
func SelectionTransform(n Node, next *TransformValues) (TransformValues, [6]float64, error) {
	p, ok := n.Pivot()
	if !ok {
		return TransformValues{}, [6]float64{}, errors.New("selection has no points")
	}
	f := n.Frame
	if len(f) != 6 {
		f = []float64{1, 0, 0, 1, 0, 0}
	}
	values := TransformValues{p.X, p.Y, math.Atan2(f[1], f[0]) * 180 / math.Pi, math.Hypot(f[0], f[1]) * 100}
	v := values
	if next != nil {
		v = *next
	}
	if v.Scale <= 0 || values.Scale <= 0 || math.IsNaN(v.X) || math.IsInf(v.X, 0) || math.IsNaN(v.Y) || math.IsInf(v.Y, 0) || math.IsNaN(v.Rotation) || math.IsInf(v.Rotation, 0) || math.IsNaN(v.Scale) || math.IsInf(v.Scale, 0) {
		return values, [6]float64{}, errors.New("Use finite transform values and a positive scale.")
	}
	turn := (v.Rotation - values.Rotation) * math.Pi / 180
	k := v.Scale / values.Scale
	a, b := math.Cos(turn)*k, math.Sin(turn)*k
	c, d := -b, a
	return values, [6]float64{a, b, c, d, v.X - a*p.X - c*p.Y, v.Y - b*p.X - d*p.Y}, nil
}

// SelectionView and SelectionGeometryResult share coordinates with project.
type SelectionView struct{ X, Y, Width, Height, Scale float64 }
type SelectionGeometryResult struct {
	Points               []Point
	Paths                [][]int
	Pivot, Centre        Point
	Bounds               GridBounds
	Scale                float64
	View                 SelectionView
	Visible              bool
	Move, Rotate, Resize Point
}
type SelectionHit struct {
	Action string
	Index  int
}

func SelectionGeometry(n Node, project func(Point) Point, view SelectionView) *SelectionGeometryResult {
	if n.Hidden || len(n.Points) == 0 {
		return nil
	}
	scale := view.Scale
	if scale == 0 {
		scale = 1
	}
	points := make([]Point, len(n.Points))
	b := GridBounds{math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)}
	for i, p := range n.Points {
		q := project(p)
		points[i] = q
		b.X0 = math.Min(b.X0, q.X)
		b.Y0 = math.Min(b.Y0, q.Y)
		b.X1 = math.Max(b.X1, q.X)
		b.Y1 = math.Max(b.Y1, q.Y)
	}
	pivot, _ := n.Pivot()
	centre := project(pivot)
	radius := num(n.Params, "radius")
	pad := math.Max(radius+6/scale, 24/scale)
	b.X0 -= pad
	b.Y0 -= pad
	b.X1 += pad
	b.Y1 += pad
	visible := b.X1 >= view.X && b.X0 <= view.X+view.Width && b.Y1 >= view.Y && b.Y0 <= view.Y+view.Height
	inset := 18 / scale
	within := func(p Point) Point {
		return Point{clamp(p.X, view.X+inset, view.X+math.Max(inset, view.Width-inset)), clamp(p.Y, view.Y+inset, view.Y+math.Max(inset, view.Height-inset))}
	}
	move := within(centre)
	rotate := within(Point{centre.X, b.Y0 - 20/scale})
	resize := within(Point{b.X1, b.Y1})
	if math.Hypot(rotate.X-move.X, rotate.Y-move.Y) < 28/scale {
		offset := -40.
		if move.Y < view.Y+view.Height/2 {
			offset = 40
		}
		rotate.Y = within(Point{rotate.X, move.Y + offset/scale}).Y
	}
	if math.Hypot(resize.X-move.X, resize.Y-move.Y) < 28/scale {
		offset := -40.
		if move.X < view.X+view.Width/2 {
			offset = 40
		}
		resize.X = within(Point{move.X + offset/scale, resize.Y}).X
	}
	path := ShapePath{Points: n.Points, Paths: n.Paths}
	return &SelectionGeometryResult{Points: points, Paths: ShapePaths(&path), Pivot: pivot, Centre: centre, Bounds: b, Scale: scale, View: view, Visible: visible, Move: move, Rotate: rotate, Resize: resize}
}
func HitSelection(g *SelectionGeometryResult, p Point, pathMode bool) *SelectionHit {
	if g == nil || !g.Visible {
		return nil
	}
	reach := 10 / g.Scale
	if pathMode {
		index, best := -1, reach
		for i, q := range g.Points {
			d := math.Hypot(p.X-q.X, p.Y-q.Y)
			if d < best {
				best = d
				index = i
			}
		}
		if index >= 0 {
			return &SelectionHit{"point", index}
		}
		return nil
	}
	for _, x := range []struct {
		action string
		q      Point
	}{{"rotate", g.Rotate}, {"scale", g.Resize}, {"move", g.Move}} {
		if math.Hypot(p.X-x.q.X, p.Y-x.q.Y) <= reach {
			return &SelectionHit{Action: x.action, Index: -1}
		}
	}
	return nil
}
