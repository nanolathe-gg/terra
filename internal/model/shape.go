package model

import "math"

type Lean struct {
	Ratio  *float64
	K      float64
	Side   int
	BX, BY float64
}

func LeanSetup(kind string, lean, facing, facePx float64) Lean {
	f := int(math.Floor(facing + .5))
	side := 0
	if f == 1 {
		side = 1
	} else if f == 2 {
		side = -1
	}
	r := math.Sqrt(.5)
	bearings := [][2]float64{{0, -1}, {r, -r}, {1, 0}, {r, r}, {0, 1}, {-r, r}, {-1, 0}, {-r, -r}}
	index := 0
	if side == 0 {
		index = max(f, 3) - 3
	}
	if index >= len(bearings) {
		index = 0
	}
	result := Lean{Side: side, BX: bearings[index][0], BY: bearings[index][1]}
	ratio := 1.0
	if lean > 0 {
		x := clamp(lean, .25, 4)
		result.Ratio = &x
		ratio = x
	} else {
		switch kind {
		case "paint", "erase", "plateau", "offset", "sand", "grass":
			if facePx <= 0 {
				ratio = 1.7
			}
		}
	}
	result.K = ratio - 1
	return result
}
func IsShouldered(kind string, lean float64, ridge bool) bool {
	return kind == "hill" && !ridge && lean != 1
}
func HillWidths(softness, facePx, radius float64, ratio *float64) (float64, float64) {
	soft := .66 + (softness-.5)*.9
	face := soft
	if facePx > 0 {
		face = facePx / radius
	}
	back := 2 - soft
	if ratio != nil && *ratio != 0 {
		back = *ratio * face
	} else if softness == .5 {
		back = 1.34
	}
	return face, back
}

type Variability struct{ Amp, WK, WLo, WHi, HgtA, HgtB float64 }

func ShapeVariability(kind string, naturalWater, naturalPlateau, shouldered, plainHill bool, outline, width, height float64) Variability {
	out := Variability{WLo: 1, WHi: 1}
	switch {
	case naturalWater:
		out.Amp = 1.1 * outline
		out.WK, out.WLo, out.WHi = 1.6*width, .45, 1.9
	case naturalPlateau:
		out.Amp = .95 * outline
		out.WK, out.WLo, out.WHi = 1.3*width, .55, 1.7
	case shouldered:
		out.Amp = .85 * outline
	default:
		out.Amp = .2 * outline
	}
	switch {
	case shouldered:
		out.HgtA, out.HgtB = .75*height, .3*height
	case plainHill || kind == "mountain" || kind == "lower":
		out.HgtB = .09 * height
	}
	return out
}

// LandformSides returns the front and back half-widths of a section.
func LandformSides(radius, lean float64) (front, back float64) {
	ratio := 1.0
	if lean > 0 {
		ratio = clamp(lean, .25, 4)
	}
	front = 2 * radius / (1 + ratio)
	return front, front * ratio
}
func LandformReach(radius, lean, widthVary, wander, varyFoot, varyMiddle, frameScale, widthMul float64) float64 {
	front, back := LandformSides(radius, lean)
	weight := math.Max(varyFoot, varyMiddle)
	return math.Max(front, back)*widthMul*math.Exp(1.35*widthVary*weight) + wander*frameScale*weight + 2
}
func LandformBackSide(lean Lean, turn, dx, dy float64) int {
	if lean.Side != 0 {
		return lean.Side
	}
	bx := lean.BX*math.Cos(turn) - lean.BY*math.Sin(turn)
	by := lean.BX*math.Sin(turn) + lean.BY*math.Cos(turn)
	if dy*bx-dx*by < 0 {
		return -1
	}
	return 1
}
func AlongKnots(knots []Knot) []Knot {
	if len(knots) >= 2 {
		return knots
	}
	return []Knot{{0, 1}, {1, 1}}
}
