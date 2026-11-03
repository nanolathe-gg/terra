package terrain

import (
	"github.com/nanolathe-gg/terraform/internal/model"
	"math"
)

// prepareRampPath thins and rounds the path before assigning cumulative grade.
func prepareRampPath(points []model.Point, radius float64, readOffset int, box func(model.Point, model.Point) CellRect) ([]Segment, []model.Point) {
	path := []model.Point{points[0]}
	for _, p := range points[1:] {
		q := path[len(path)-1]
		if math.Hypot(p.X-q.X, p.Y-q.Y) >= 1e-4 {
			path = append(path, p)
		}
	}
	first, last := path[0], path[len(path)-1]
	if len(path) >= 3 {
		thin := []model.Point{path[0]}
		for _, p := range path[1 : len(path)-1] {
			q := thin[len(thin)-1]
			if math.Hypot(p.X-q.X, p.Y-q.Y) > radius*.12 {
				thin = append(thin, p)
			}
		}
		thin = append(thin, path[len(path)-1])
		path = thin
		for pass := 0; pass < 2; pass++ {
			next := []model.Point{path[0]}
			for i := 0; i < len(path)-1; i++ {
				a, b := path[i], path[i+1]
				next = append(next, model.Point{X: .75*a.X + .25*b.X, Y: .75*a.Y + .25*b.Y}, model.Point{X: .25*a.X + .75*b.X, Y: .25*a.Y + .75*b.Y})
			}
			next = append(next, path[len(path)-1])
			path = next
		}
	}
	total := 0.0
	out := []Segment{}
	for i := 0; i < len(path)-1; i++ {
		a, b := path[i], path[i+1]
		length := math.Hypot(b.X-a.X, b.Y-a.Y)
		if length*length < 1e-8 {
			continue
		}
		out = append(out, Segment{PX: a.X, PY: a.Y, EX: b.X, EY: b.Y, F0: [2]float64{total, length}, Box: box(a, b)})
		total += length
	}
	for i := range out {
		out[i].F1 = [2]float64{total, float64(readOffset)}
	}
	if total > 0 {
		return out, []model.Point{first, last}
	}
	return out, nil
}
