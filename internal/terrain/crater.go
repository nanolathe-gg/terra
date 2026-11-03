package terrain

import (
	"github.com/nanolathe-gg/terraform/internal/model"
	"math"
)

func craterRandom(seed uint32, k, a int) float64 {
	x := (seed + uint32(k*7919+a*104729)) * 2654435761
	x ^= x >> 15
	x *= 2246822519
	return float64(x) / 4294967296
}
func craterRim(q map[string]any, seed uint32) ([][4]float64, int, int, float64) {
	N := int(math.Floor(clampNumber(param(q, "rimSectors"), 0, 8) + .5))
	G := int(math.Floor(clampNumber(param(q, "rimGaps"), 0, 4) + .5))
	if N < 2 && G < 1 {
		return nil, 0, 0, 0
	}
	rnd := func(a, b int) float64 { return random01(seed, a, b+0x3c5) }
	un := clampNumber(param(q, "rimUnequal"), 0, 1)
	tau := 2 * math.Pi
	phase := rnd(0, 1) * tau
	rows := [][4]float64{}
	first := 0.0
	if N >= 2 {
		for k := 0; k < N; k++ {
			r := rnd(k, 2)
			a := phase + tau*(float64(k)+(rnd(k, 3)-.5)*.5)/float64(N)
			if k == 0 {
				first = a
			}
			rows = append(rows, [4]float64{a, 1 - .85*un*(1-r), 1 + un*(1.8*r*(.6+.4*rnd(k, 4))-.4), a - first})
		}
	} else {
		N = 0
	}
	gphase := rnd(9, 9) * tau
	for k := 0; k < G; k++ {
		rows = append(rows, [4]float64{gphase + tau*(float64(k)+(rnd(k, 5)-.5)*.4)/float64(G), 0, 0, 0})
	}
	return rows, N, G, clampNumber(param(q, "rimGapWidth"), 10, 180) * math.Pi / 360
}

// PrepareShapes expands a crater's seeded satellite craters in authored order.
func PrepareShapes(n model.Node, g ShapeGeometry, defaults map[string]any) ([]PreparedShape, error) {
	main, e := prepareBasicShape(n, g, defaults, false, nil, nil)
	if e != nil {
		return nil, e
	}
	out := []PreparedShape{main}
	if n.Kind != "crater" || n.Hidden || len(n.Points) == 0 {
		return out, nil
	}
	q := map[string]any{}
	for k, v := range defaults {
		q[k] = v
	}
	for k, v := range n.Params {
		q[k] = v
	}
	count := int(math.Floor(param(q, "craterlets") + .5))
	path := model.ShapePaths(&model.ShapePath{Points: n.Points, Paths: n.Paths})[0]
	center := n.Points[path[len(path)/2]]
	radius := param(q, "radius")
	turn := 0.0
	if len(n.Frame) == 6 {
		turn = math.Atan2(n.Frame[1], n.Frame[0])
	}
	world := g.Spacing*float64(g.Grid-1) + 1
	for k := 0; k < count; k++ {
		angle := craterRandom(n.Seed, k, 1)*2*math.Pi + turn
		dist := radius * (.9 + craterRandom(n.Seed, k, 2)*1.1)
		small := radius * (.1 + .22*craterRandom(n.Seed, k, 3))
		spot := model.Point{X: clampNumber(center.X+math.Cos(angle)*dist, 0, world-1), Y: clampNumber(center.Y+math.Sin(angle)*dist, 0, world-1)}
		p := map[string]any{}
		for key, val := range n.Params {
			p[key] = val
		}
		p["radius"], p["amount"], p["craterlets"], p["cracks"], p["craterFacets"] = small, param(q, "amount")*(.25+.3*craterRandom(n.Seed, k, 4)), 0., 0., 0.
		child := model.Node{Kind: "crater", Seed: n.Seed + uint32(k)*2654435761, Points: []model.Point{spot}, Frame: n.Frame, Params: p}
		shape, err := prepareBasicShape(child, g, defaults, true, nil, nil)
		if err != nil {
			return nil, err
		}
		out = append(out, shape)
	}
	if math.Floor(param(q, "spurCount")+.5) >= 1 {
		count := int(math.Floor(clampNumber(param(q, "spurCount"), 0, 12) + .5))
		inv := inverseFrame(n.Frame)
		phase := random01(n.Seed, 7, 0x4b1) * 2 * math.Pi
		roots := make([]spurRoot, 0, count)
		for k := 0; k < count; k++ {
			ang := phase + 2*math.Pi*(float64(k)+(random01(n.Seed, k, 0x4b2)-.5)*.6)/float64(count) + turn
			dx, dy := math.Cos(ang), math.Sin(ang)
			wx, wy := center.X+dx*radius, center.Y+dy*radius
			lx, ly := wx, wy
			if inv != nil {
				lx, ly = inv[0]*wx+inv[2]*wy+inv[4], inv[1]*wx+inv[3]*wy+inv[5]
			}
			sc := math.Max(radius*.55, 8)
			lobe := 1 + param(q, "rough")*(.38*valueNoise(lx/(radius*.95), ly/(radius*.95), n.Seed^0x4a7)+.22*valueNoise(lx/sc, ly/sc, n.Seed^0x1c3)+.1*valueNoise(lx/(sc*.6), ly/(sc*.6), n.Seed^0x2d9))
			roots = append(roots, spurRoot{center.X + dx*radius*lobe*1.02, center.Y + dy*radius*lobe*1.02, ang + (random01(n.Seed, k, 0x4b3)-.5)*param(q, "spurSpread")*1.2, k, 0})
		}
		pcs := spurPieces(q, n.Seed, inv, roots, .4, param(q, "crestJag"))
		params := map[string]any{}
		for k, v := range n.Params {
			params[k] = v
		}
		for k, v := range map[string]float64{"radius": radius, "amount": param(q, "amount") * param(q, "rimHeight"), "rough": param(q, "rough") * .8, "softness": .8, "cracks": 0, "craterlets": 0, "craterEjecta": 0, "spurCount": 0, "rimSectors": 0, "rimGaps": 0, "crestJag": 0, "crestVary": 0, "crestTaper": 0, "facePx": 0, "terraces": 0} {
			params[k] = v
		}
		params["curve"] = nil
		child := model.Node{Kind: "mountain", Seed: n.Seed, Points: []model.Point{{X: roots[0].x, Y: roots[0].y}}, Frame: n.Frame, Params: params}
		childShape, err := prepareBasicShape(child, g, defaults, true, pcs, &craterHole{center.X, center.Y, radius, param(q, "rough"), n.Seed})
		if err != nil {
			return nil, err
		}
		out = append(out, childShape)
	}
	return out, nil
}

type craterHole struct {
	X, Y, R, Rough float64
	Seed           uint32
}
