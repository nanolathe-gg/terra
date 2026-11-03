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
