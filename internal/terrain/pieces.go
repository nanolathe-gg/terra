package terrain

import (
	"github.com/nanolathe-gg/terraform/internal/model"
	"math"
)

type shapePiece struct {
	A, B                       model.Point
	R0, R1, H0, H1, Jag, Reach float64
}

func piece(a, b model.Point, r0, r1, h0, h1, jag float64) shapePiece {
	return shapePiece{a, b, r0, r1, h0, h1, jag, math.Max(r0, r1)}
}
func smoothStep(a, b, x float64) float64 {
	t := clampNumber((x-a)/(b-a), 0, 1)
	return t * t * (3 - 2*t)
}
func random01(seed uint32, a, b int) float64 { return hashNoise(a, b, seed)*.5 + .5 }
func fissurePieces(path []model.Point, q map[string]any, seed uint32, radius, kf, hw float64, network bool) []shapePiece {
	taper := param(q, "fissureTaper")
	cum := []float64{0}
	for i := 1; i < len(path); i++ {
		cum = append(cum, cum[i-1]+math.Hypot(path[i].X-path[i-1].X, path[i].Y-path[i-1].Y))
	}
	L := cum[len(cum)-1]
	longest := math.Max(16, math.Min(radius*1.5, 60))
	ends := func(a float64) float64 {
		e := 1.0
		if L > 0 {
			e = math.Min(a/L, 1-a/L)
		}
		return 1 - smoothStep(0, .3, e)
	}
	tw := func(u float64) float64 { return 1 - .7*taper*u }
	td := func(u float64) float64 { return 1 - .55*taper*u }
	out := []shapePiece{}
	if len(path) < 2 {
		out = append(out, piece(path[0], path[0], 1, 1, 1, 1, 0))
	}
	for k := 1; k < len(path); k++ {
		a, b := path[k-1], path[k]
		length := cum[k] - cum[k-1]
		n := max(1, int(math.Ceil(length/longest)))
		for j := 0; j < n; j++ {
			f0, f1 := float64(j)/float64(n), float64(j+1)/float64(n)
			e0, e1 := ends(cum[k-1]+length*f0), ends(cum[k-1]+length*f1)
			at := func(f float64) model.Point { return model.Point{X: a.X + (b.X-a.X)*f, Y: a.Y + (b.Y-a.Y)*f} }
			out = append(out, piece(at(f0), at(f1), tw(e0), tw(e1), td(e0), td(e1), 0))
		}
	}
	N := int(math.Floor(clampNumber(param(q, "fissureBranches"), 0, 12) + .5))
	if N < 1 || L <= 0 || network {
		return out
	}
	rnd := func(a, b int) float64 { return random01(seed, a, b+0x5f3) }
	var grow func(float64, float64, float64, float64, float64, float64, int, int)
	grow = func(x, y, heading, length, w0, d0 float64, id, level int) {
		step := length / 3
		h, px, py := heading, x, y
		for j := 0; j < 3; j++ {
			h += (rnd(id, 30+j) - .5) * .7
			nx, ny := px+math.Cos(h)*step, py+math.Sin(h)*step
			u0, u1 := float64(j)/3, float64(j+1)/3
			out = append(out, piece(model.Point{X: px, Y: py}, model.Point{X: nx, Y: ny}, w0*(1-.75*taper*u0), w0*(1-.75*taper*u1), d0*(1-.7*taper*u0), d0*(1-.7*taper*u1), 0))
			if level == 0 && j == 1 && rnd(id, 40) < .7 {
				sign := 1.0
				if rnd(id, 41) < .5 {
					sign = -1
				}
				grow(nx, ny, h+sign*(.5+.6*rnd(id, 42)), length*.5, w0*.7, d0*.85, id+100, 1)
			}
			px, py = nx, ny
		}
	}
	for k := 0; k < N; k++ {
		at := L * (.08 + .84*(float64(k)+.2+.6*rnd(k, 11))/float64(N))
		side := -1.0
		flip := 0
		if rnd(k, 12) < .25 {
			flip = 1
		}
		if (k+flip)&1 != 0 {
			side = 1
		}
		i := 1
		for i < len(cum)-1 && cum[i] < at {
			i++
		}
		a, b := path[i-1], path[i]
		fr := (at - cum[i-1]) / math.Max(cum[i]-cum[i-1], 1e-6)
		grow(a.X+(b.X-a.X)*fr, a.Y+(b.Y-a.Y)*fr, math.Atan2(b.Y-a.Y, b.X-a.X)+side*(.45+.95*param(q, "fissureBranchSpread"))*(.7+.6*rnd(k, 13)), param(q, "fissureBranchLen")*kf*(.5+.9*rnd(k, 14)), .75, .85, k, 0)
	}
	return out
}
