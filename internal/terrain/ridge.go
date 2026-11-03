package terrain

import (
	"github.com/nanolathe-gg/terraform/internal/model"
	"math"
)

type spurRoot struct {
	x, y, heading float64
	k             int
	share         float64
}

func lineMultipliers(q map[string]any, seed uint32, a, length float64, salt uint32, taper float64, ends bool) (float64, float64) {
	radius := param(q, "radius")
	f := 0.0
	if length > 0 {
		f = clampNumber(a/length, 0, 1)
	}
	u := smoothStep(0, 1, f)
	if ends {
		u = 1 - smoothStep(0, .4, math.Min(f, 1-f))
	}
	n := valueNoise(a/(radius*2.2), .37, seed^salt)
	m := valueNoise(a/(radius*1.6), 2.9, seed^(salt+0x55))
	r := clampNumber(1+.45*param(q, "crestVary")*n, .6, 1.4) * (1 - .62*taper*u)
	if !ends {
		r *= 1 + .5*(1-smoothStep(0, .4, f))
	}
	h := (1 - .45*param(q, "crestVary")*(.5-.5*m)) * (1 - .7*taper*u)
	return r, h
}
func spurPieces(q map[string]any, seed uint32, inv []float64, roots []spurRoot, fade, jag float64) []shapePiece {
	kf := 1.0
	if inv != nil {
		kf = 1 / math.Hypot(inv[0], inv[1])
	}
	spread, bulb := param(q, "spurSpread"), param(q, "spurBulb")
	out := []shapePiece{}
	var grow func(float64, float64, float64, float64, float64, float64, int, int, float64)
	grow = func(x, y, heading, length, rootR, rootH float64, k, level int, rootFade float64) {
		step := length / 3
		curl := (.1 + .3*spread) * math.Pi
		salt := uint32(0x300 + k*97)
		h := heading
		for j := 0; j < 3; j++ {
			h += (random01(seed, k, 20+j) - .5) * curl
			nx, ny := x+math.Cos(h)*step, y+math.Sin(h)*step
			r0, e0 := lineMultipliers(q, seed, step*float64(j), length, salt, param(q, "spurTaper"), false)
			r1, e1 := lineMultipliers(q, seed, step*float64(j+1), length, salt, param(q, "spurTaper"), false)
			if bulb > 0 {
				b0, b1 := bulb*smoothStep(.5, 1, float64(j)/3), bulb*smoothStep(.5, 1, float64(j+1)/3)
				r0 += b0 * .7
				r1 += b1 * .7
				e0 += (1 - e0) * b0
				e1 += (1 - e1) * b1
			}
			h0 := rootH * e0
			if j == 0 {
				h0 *= rootFade
			}
			out = append(out, piece(model.Point{X: x, Y: y}, model.Point{X: nx, Y: ny}, rootR*r0, rootR*r1, h0, rootH*e1, jag))
			if j == 1 && level == 0 && param(q, "spurForks") > 0 && random01(seed, k, 50) < param(q, "spurForks") {
				sign := 1.0
				if random01(seed, k, 51) < .5 {
					sign = -1
				}
				grow(nx, ny, h+sign*(.5+.6*random01(seed, k, 52)), length*.5, rootR*r1*.85, rootH*e1*.85, k+100, 1, 1)
			}
			x, y = nx, ny
		}
	}
	for _, r := range roots {
		first := len(out)
		k := r.k
		grow(r.x, r.y, r.heading, param(q, "spurLength")*kf*(.55+.9*random01(seed, k, 14)), param(q, "spurWidth")*(.85+.3*random01(seed, k, 15)), param(q, "spurHeight"), k, 0, fade)
		for i := first; i < len(out); i++ {
			out[i].Share = r.share
		}
	}
	return out
}
func ridgePieces(path []model.Point, q map[string]any, seed uint32, inv []float64, turn float64) []shapePiece {
	cum := []float64{0}
	for k := 1; k < len(path); k++ {
		cum = append(cum, cum[k-1]+math.Hypot(path[k].X-path[k-1].X, path[k].Y-path[k-1].Y))
	}
	L := cum[len(cum)-1]
	longest := math.Max(16, param(q, "radius")*1.5)
	jag := param(q, "crestJag")
	out := []shapePiece{}
	if len(path) < 2 {
		out = append(out, piece(path[0], path[0], 1, 1, 1, 1, jag))
	}
	for k := 1; k < len(path); k++ {
		a, b := path[k-1], path[k]
		length := cum[k] - cum[k-1]
		n := max(1, int(math.Ceil(length/longest)))
		for j := 0; j < n; j++ {
			f0, f1 := float64(j)/float64(n), float64(j+1)/float64(n)
			r0, h0 := lineMultipliers(q, seed, cum[k-1]+length*f0, L, 0x71d, param(q, "crestTaper"), true)
			r1, h1 := lineMultipliers(q, seed, cum[k-1]+length*f1, L, 0x71d, param(q, "crestTaper"), true)
			at := func(f float64) model.Point { return model.Point{X: a.X + (b.X-a.X)*f, Y: a.Y + (b.Y-a.Y)*f} }
			out = append(out, piece(at(f0), at(f1), r0, r1, h0, h1, jag))
		}
	}
	roots := ridgeRoots(path, q, seed, turn, cum, L)
	return append(out, spurPieces(q, seed, inv, roots, 1, jag)...)
}
func ridgeRoots(path []model.Point, q map[string]any, seed uint32, turn float64, cum []float64, L float64) []spurRoot {
	N := int(math.Floor(clampNumber(param(q, "spurCount"), 0, 12) + .5))
	if N < 1 {
		return nil
	}
	phase := random01(seed, 7, 0x4b1) * 2 * math.Pi
	roots := []spurRoot{}
	for k := 0; k < N; k++ {
		if L <= 0 {
			roots = append(roots, spurRoot{path[0].X, path[0].Y, phase + turn + 2*math.Pi*(float64(k)+(random01(seed, k, 11)-.5)*.5)/float64(N), k, 0})
			continue
		}
		at := L * (.08 + .84*(float64(k)+.2+.6*random01(seed, k, 11))/float64(N))
		flip := 0
		if random01(seed, k, 12) < .25 {
			flip = 1
		}
		side := -1.0
		if (k+flip)&1 != 0 {
			side = 1
		}
		i := 1
		for i < len(cum)-1 && cum[i] < at {
			i++
		}
		a, b := path[i-1], path[i]
		f := (at - cum[i-1]) / math.Max(cum[i]-cum[i-1], 1e-6)
		roots = append(roots, spurRoot{a.X + (b.X-a.X)*f, a.Y + (b.Y-a.Y)*f, math.Atan2(b.Y-a.Y, b.X-a.X) + side*(.7+.95*param(q, "spurSpread"))*(.75+.5*random01(seed, k, 13)), k, at / L})
	}
	return roots
}
