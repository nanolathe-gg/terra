package terrain

import (
	"github.com/nanolathe-gg/terraform/internal/model"
	"math"
)

func crystalRandom(seed uint32, k, a int) float64 {
	x := (seed + uint32(k*7919+a*104729)) * 2654435761
	x ^= x >> 15
	x *= 2246822519
	x ^= x >> 13
	return float64(x) / 4294967296
}
func crystalSegments(points []model.Point, q map[string]any, g ShapeGeometry, seed uint32, inv []float64, turn float64, extraOffset int) ([]Segment, [][4]float64) {
	radius := param(q, "radius")
	path := model.SimplifyPath(points, math.Max(1, radius*.05))
	lengths := []float64{0}
	for k := 1; k < len(path); k++ {
		lengths = append(lengths, lengths[k-1]+math.Hypot(path[k].X-path[k-1].X, path[k].Y-path[k-1].Y))
	}
	form := 0
	if param(q, "crystalForm") >= 1.5 {
		form = 2
	} else if param(q, "crystalForm") >= .5 {
		form = 1
	}
	box := func(x0, y0, x1, y1 float64) CellRect {
		return CellRect{int(clampNumber(math.Floor(x0/g.Spacing), 0, float64(g.Grid-1))), int(clampNumber(math.Floor(y0/g.Spacing), 0, float64(g.Grid-1))), int(clampNumber(math.Ceil(x1/g.Spacing), 0, float64(g.Grid-1))), int(clampNumber(math.Ceil(y1/g.Spacing), 0, float64(g.Grid-1)))}
	}
	out := []Segment{}
	extra := [][4]float64{}
	if form == 1 {
		ax, ay, bx, by := path[0].X, path[0].Y, path[0].X, path[0].Y
		for _, p := range path {
			ax, ay, bx, by = math.Min(ax, p.X), math.Min(ay, p.Y), math.Max(bx, p.X), math.Max(by, p.Y)
		}
		pad := radius * 1.4
		b := box(ax-pad, ay-pad, bx+pad, by+pad)
		for k, a := range path {
			e := path[min(k+1, len(path)-1)]
			out = append(out, Segment{PX: a.X, PY: a.Y, EX: e.X, EY: e.Y, Box: b})
		}
		return out, extra
	}
	total := lengths[len(lengths)-1]
	count := max(1, int(math.Floor(param(q, "crystalCount")*(1+total/math.Max(8, radius*1.2))+.5)))
	variation := param(q, "crystalVariation")
	scale := 1.0
	if inv != nil {
		scale = 1 / math.Hypot(inv[0], inv[1])
	}
	crystalSize := param(q, "crystalSize") * scale
	rnd := func(k, a int) float64 { return crystalRandom(seed, k, a) }
	for k := 0; k < count; k++ {
		along := rnd(k, 1) * total
		j := 1
		for j < len(path)-1 && lengths[j] < along {
			j++
		}
		a := path[j-1]
		b := a
		f := 0.0
		if j < len(path) {
			b = path[j]
			if lengths[j] > lengths[j-1] {
				f = (along - lengths[j-1]) / (lengths[j] - lengths[j-1])
			}
		}
		spread := math.Pow(rnd(k, 2), .8)
		if form == 2 && k == 0 {
			spread = 0
		}
		angle := rnd(k, 3)*2*math.Pi + turn
		cx := a.X + (b.X-a.X)*f + math.Cos(angle)*spread*radius
		cy := a.Y + (b.Y-a.Y)*f + math.Sin(angle)*spread*radius
		width := crystalSize * (1 + variation*(rnd(k, 4)-.5)*1.2) * (1 - .4*spread)
		height := param(q, "amount") * (1 - .45*spread) * (1 + variation*(rnd(k, 5)-.5)) * math.Min(1.3, width/(math.Max(4, param(q, "crystalSize"))*scale))
		sides := int(clampNumber(math.Floor(param(q, "crystalSides")+variation*(rnd(k, 6)-.5)*2.4+.5), 3, 12))
		R := width / 2
		lean := param(q, "crystalLean") * R * .75 * rnd(k, 7)
		leanAngle := rnd(k, 8)*2*math.Pi + turn
		if form == 2 {
			jit := clampNumber(param(q, "bergJitter"), 0, 1)
			align := clampNumber(param(q, "crystalAlign"), 0, 1)
			rot0 := turn + (1-align)*rnd(k, 9)*2*math.Pi
			edge := extraOffset + len(extra)
			reach := R * 1.55
			nBreak := int(math.Floor(param(q, "bergBreak") + .5))
			for e := 0; e < sides; e++ {
				a := rot0 + (float64(e)+jit*(rnd(k, 40+e)-.5)*.7)*2*math.Pi/float64(sides)
				extra = append(extra, [4]float64{math.Cos(a), math.Sin(a), R * math.Cos(math.Pi/float64(sides)) * (1 + jit*(rnd(k, 60+e)-.5)*.6), param(q, "bergFace") * (1 + jit*(rnd(k, 80+e)-.5)*1.2)})
			}
			for j := 0; j < nBreak; j++ {
				a := rnd(k, 100+j) * 2 * math.Pi
				extra = append(extra, [4]float64{math.Cos(a), math.Sin(a), R * (.55 + .35*rnd(k, 120+j)), param(q, "bergFace") * (.55 + .9*rnd(k, 140+j))})
			}
			out = append(out, Segment{PX: cx, PY: cy, EX: R, EY: math.Max(1, height), F0: [2]float64{float64(k), float64(sides)}, F1: [2]float64{float64(sides + nBreak), float64(edge)}, Box: box(cx-reach, cy-reach, cx+reach, cy+reach)})
			continue
		}
		edge := extraOffset + len(extra)
		for e := 0; e < sides; e++ {
			t := turn + rnd(k, 9)*2*math.Pi + (float64(e)+.5)*2*math.Pi/float64(sides)
			extra = append(extra, [4]float64{math.Cos(t), math.Sin(t), R * math.Cos(math.Pi/float64(sides)) * (1 + param(q, "rough")*.35*(rnd(k, 20+e)-.5)), 0})
		}
		out = append(out, Segment{PX: cx, PY: cy, EX: R, EY: math.Max(1, height), F0: [2]float64{math.Cos(leanAngle) * lean, math.Sin(leanAngle) * lean}, F1: [2]float64{float64(sides), float64(edge)}, Box: box(cx-R, cy-R, cx+R, cy+R)})
	}
	return out, extra
}
