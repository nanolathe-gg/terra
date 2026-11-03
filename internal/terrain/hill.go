package terrain

import (
	"github.com/nanolathe-gg/terraform/internal/model"
	"math"
)

// prepareHillPath follows settleHill's two corner-rounding passes and keeps
// each capsule's own tangent after simplification.
func prepareHillPath(points []model.Point, radius float64, face [2]float64, side int, dab func(model.Point, model.Point), segments *[]Segment) (int, bool) {
	path := []model.Point{points[0]}
	for _, p := range points[1:] {
		q := path[len(path)-1]
		if math.Hypot(p.X-q.X, p.Y-q.Y) >= .2 {
			path = append(path, p)
		}
	}
	if len(path) == 1 {
		dab(path[0], path[0])
		return side, false
	}
	dx, dy := path[1].X-path[0].X, path[1].Y-path[0].Y
	if side == 0 {
		side = 1
		if -dy*face[0]+dx*face[1] < 0 {
			side = -1
		}
	}
	if len(path) == 2 {
		dab(path[0], path[1])
		return side, false
	}
	rounded := []model.Point{path[0]}
	for _, p := range path[1 : len(path)-1] {
		q := rounded[len(rounded)-1]
		if math.Hypot(p.X-q.X, p.Y-q.Y) > radius*.16 {
			rounded = append(rounded, p)
		}
	}
	rounded = append(rounded, path[len(path)-1])
	for pass := 0; pass < 2; pass++ {
		next := []model.Point{rounded[0]}
		for i := 0; i < len(rounded)-1; i++ {
			a, b := rounded[i], rounded[i+1]
			next = append(next, model.Point{X: .75*a.X + .25*b.X, Y: .75*a.Y + .25*b.Y}, model.Point{X: .25*a.X + .75*b.X, Y: .25*a.Y + .75*b.Y})
		}
		next = append(next, rounded[len(rounded)-1])
		rounded = next
	}
	frames := make([][2]float64, len(rounded))
	for i := range rounded {
		a, b := rounded[max(0, i-1)], rounded[min(len(rounded)-1, i+1)]
		dx, dy := b.X-a.X, b.Y-a.Y
		length := math.Hypot(dx, dy)
		if length == 0 {
			length = 1
		}
		frames[i] = [2]float64{-dy / length * float64(side), dx / length * float64(side)}
	}
	kept := model.SimplifyPath(rounded, math.Max(1, radius*.02))
	indices := make([]int, len(kept))
	from := 0
	for i, p := range kept {
		for from < len(rounded) && rounded[from] != p {
			from++
		}
		indices[i] = from
		from++
	}
	longest := math.Max(16, radius*1.5)
	for k := 0; k < len(kept)-1; k++ {
		a, b := kept[k], kept[k+1]
		fa, fb := frames[indices[k]], frames[indices[k+1]]
		pieces := int(math.Ceil(math.Hypot(b.X-a.X, b.Y-a.Y) / longest))
		for j := 0; j < pieces; j++ {
			t0, t1 := float64(j)/float64(pieces), float64(j+1)/float64(pieces)
			at := func(t float64) model.Point { return model.Point{X: a.X + (b.X-a.X)*t, Y: a.Y + (b.Y-a.Y)*t} }
			fc := func(t float64) [2]float64 { return [2]float64{fa[0] + (fb[0]-fa[0])*t, fa[1] + (fb[1]-fa[1])*t} }
			dab(at(t0), at(t1))
			s := &(*segments)[len(*segments)-1]
			s.Frame = true
			s.F0 = fc(t0)
			s.F1 = fc(t1)
		}
	}
	return side, true
}
