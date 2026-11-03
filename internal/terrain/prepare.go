package terrain

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"

	"github.com/nanolathe-gg/terraform/internal/model"
)

// Segment is one 64-byte shape capsule as consumed by engine-shape.wgsl.
type Segment struct {
	PX, PY, EX, EY float64
	F0, F1         [2]float64
	NX, NY         float64
	Frame          bool
	Jag            float64
	Box            CellRect
}

func PackSegments(segs []Segment) []byte {
	out := make([]byte, len(segs)*64)
	for i, s := range segs {
		off := i * 64
		frame := 0.0
		if s.Frame {
			frame = 1
		}
		floats := []float64{s.PX, s.PY, s.EX, s.EY, s.F0[0], s.F0[1], s.F1[0], s.F1[1], s.NX, s.NY, frame, s.Jag}
		for j, v := range floats {
			binary.LittleEndian.PutUint32(out[off+j*4:], math.Float32bits(float32(v)))
		}
		for j, v := range []int{s.Box.X0, s.Box.Y0, s.Box.X1, s.Box.Y1} {
			binary.LittleEndian.PutUint32(out[off+48+j*4:], uint32(int32(v)))
		}
	}
	return out
}

// PreparedShape contains the data required by the GPU replay planner.
type PreparedShape struct {
	Op       PreparedOp
	Segments []Segment
	Writes   []MaskWrite
	Extra    [][4]float64
}
type ShapeGeometry struct {
	Grid                int
	Spacing, RefSpacing float64
}

func hashNoise(x, y int, seed uint32) float64 {
	n := uint32(x)*374761393 ^ uint32(y)*668265263 ^ seed
	n = (n ^ (n >> 13)) * 1274126177
	return float64(n^(n>>16))/4294967295*2 - 1
}
func valueNoise(x, y float64, seed uint32) float64 {
	ix, iy := int(math.Floor(x)), int(math.Floor(y))
	sm := func(v float64) float64 { v = clampNumber(v, 0, 1); return v * v * (3 - 2*v) }
	tx, ty := sm(x-float64(ix)), sm(y-float64(iy))
	a, b, c, d := hashNoise(ix, iy, seed), hashNoise(ix+1, iy, seed), hashNoise(ix, iy+1, seed), hashNoise(ix+1, iy+1, seed)
	return (a+(b-a)*tx)*(1-ty) + (c+(d-c)*tx)*ty
}

var noiseSpec = [][6]float64{{95, .7, 0x1863, 37, .3, 0x32a7}, {95, .7, 0x73c1, 37, .3, 0x9e15}, {64, .65, 0x5b39, 23, .35, 0x2ac9}, {210, .65, 0x5e17, 75, .35, 0x37ab}, {210, .65, 0x84d1, 75, .35, 0x192f}}

func shapeNoise(field int, seed uint32, x, y float64) float64 {
	p := noiseSpec[field]
	return p[1]*valueNoise(x/p[0], y/p[0], seed^uint32(p[2])) + p[4]*valueNoise(x/p[3], y/p[3], seed^uint32(p[5]))
}
func inverseFrame(m []float64) []float64 {
	if len(m) != 6 {
		return nil
	}
	identity := []float64{1, 0, 0, 1, 0, 0}
	same := true
	for i := range m {
		if math.Abs(m[i]-identity[i]) >= 1e-9 {
			same = false
			break
		}
	}
	if same {
		return nil
	}
	det := m[0]*m[3] - m[1]*m[2]
	if det == 0 {
		return nil
	}
	a, b, c, d := m[3]/det, -m[1]/det, -m[2]/det, m[0]/det
	return []float64{a, b, c, d, -(a*m[4] + c*m[5]), -(b*m[4] + d*m[5])}
}
func sampledShapeNoise(field int, seed uint32, x, y float64, g ShapeGeometry, inv []float64) float64 {
	cell := func(ix, iy int) float64 {
		wx, wy := float64(ix)*g.Spacing, float64(iy)*g.Spacing
		if inv != nil {
			lx, ly := inv[0]*wx+inv[2]*wy+inv[4], inv[1]*wx+inv[3]*wy+inv[5]
			gx, gy := math.Floor(lx/g.Spacing+.5), math.Floor(ly/g.Spacing+.5)
			if gx >= 0 && gy >= 0 && gx < float64(g.Grid) && gy < float64(g.Grid) {
				wx, wy = gx*g.Spacing, gy*g.Spacing
			} else {
				wx, wy = lx, ly
			}
		}
		return float64(float32(shapeNoise(field, seed, wx, wy)))
	}
	gx, gy := clampNumber(x/g.Spacing, 0, float64(g.Grid-1)), clampNumber(y/g.Spacing, 0, float64(g.Grid-1))
	ix, iy := int(math.Floor(gx)), int(math.Floor(gy))
	jx, jy := min(ix+1, g.Grid-1), min(iy+1, g.Grid-1)
	fx, fy := gx-float64(ix), gy-float64(iy)
	return (cell(ix, iy)*(1-fx)+cell(jx, iy)*fx)*(1-fy) + (cell(ix, jy)*(1-fx)+cell(jx, jy)*fx)*fy
}

// PrepareBasicShape handles only operations that do not need coast, prefix,
// ridge, crater, or crystal preparation. Unsupported kinds return an error.
func PrepareBasicShape(n model.Node, g ShapeGeometry, defaults map[string]any) (PreparedShape, error) {
	return prepareBasicShape(n, g, defaults, false, nil, nil)
}
func prepareBasicShape(n model.Node, g ShapeGeometry, defaults map[string]any, satellite bool, pieces []shapePiece, hole *craterHole) (PreparedShape, error) {
	out := PreparedShape{}
	if n.Hidden {
		return out, nil
	}
	if n.Kind == "ground" {
		out.Op = PreparedOp{Ground: true, Values: map[string]float64{"seed": float64(n.Seed), "gAmp": n.Amplitude, "gWave": n.Wavelength, "gCover": n.Coverage}}
		return out, nil
	}
	codes := map[string]int{"paint": 0, "erase": 1, "deep": 2, "shallow": 3, "mountain": 4, "hill": 5, "plateau": 6, "offset": 7, "lower": 8, "sand": 9, "grass": 10, "smooth": 11, "ramp": 12, "crater": 13, "fissure": 14, "crystal": 15}
	code, ok := codes[n.Kind]
	if !ok {
		return out, fmt.Errorf("shape %q preparation not implemented", n.Kind)
	}
	if len(n.Points) == 0 {
		return out, nil
	}
	q := make(map[string]any, len(defaults)+len(n.Params))
	for k, v := range defaults {
		q[k] = v
	}
	for k, v := range n.Params {
		q[k] = v

	}
	ridge := pieces != nil || (n.Kind == "hill" || n.Kind == "mountain") && (math.Floor(param(q, "spurCount")+.5) >= 1 || param(q, "crestJag") > 0 || param(q, "crestVary") > 0 || param(q, "crestTaper") > 0)

	radius, rough := param(q, "radius"), param(q, "rough")
	if radius <= 0 || g.Grid <= 0 || g.Spacing <= 0 {
		return out, fmt.Errorf("invalid shape geometry")
	}
	inv := inverseFrame(n.Frame)
	lean := model.LeanSetup(n.Kind, param(q, "lean"), param(q, "facing"), param(q, "facePx"))
	faceWidth, backWidth := model.HillWidths(param(q, "softness"), param(q, "facePx"), radius, lean.Ratio)
	water := n.Kind == "deep" || n.Kind == "shallow"
	naturalWater := n.Kind == "deep"
	bankScale := 1.0
	if water {
		bankScale = math.Pow(2, (param(q, "bankWidth")-.5)*1.3)
	}
	shouldered := model.IsShouldered(n.Kind, param(q, "lean"), ridge)
	plainHill := n.Kind == "hill" && !shouldered
	natural := n.Kind == "paint" || n.Kind == "erase" || n.Kind == "sand" || n.Kind == "grass" || n.Kind == "plateau" || n.Kind == "offset"
	get := func(k string, fallback float64) float64 {
		if _, ok := q[k]; !ok {
			return fallback
		}
		return param(q, k)
	}
	vary := model.ShapeVariability(n.Kind, naturalWater, natural, shouldered, plainHill, get("outlineVar", 1), get("widthVar", 1), get("heightVar", 1))
	fissureK := 1.0
	if inv != nil {
		fissureK = 1 / math.Hypot(inv[0], inv[1])
	}
	fissureHW0 := math.Max(param(q, "fissureWidth"), 1) * .5
	fissureHW := fissureHW0 * fissureK
	fissureAmp := fissureHW*(.5+2.2*param(q, "fissureJag")) + 1
	network := param(q, "fissureNetwork") >= .5
	amp := rough * radius * vary.Amp
	if n.Kind == "ramp" {
		amp = rough * radius * .14
	}
	if n.Kind == "crater" {
		amp = rough * radius * .45
	}
	extent := radius
	if vary.WK != 0 {
		extent *= math.Min(vary.WHi, 1+rough*vary.WK)
	}
	if water {
		extent *= bankScale
	}
	if shouldered {
		extent *= math.Max(1.4, math.Max(backWidth, faceWidth))
	}
	if !shouldered && lean.Ratio != nil && *lean.Ratio > 1 {
		extent *= *lean.Ratio
	}
	extent += 2 * amp
	if n.Kind == "crater" {
		extent = radius*1.9*(1+.45*rough) + 2*amp
	}
	if n.Kind == "fissure" {
		extent = fissureHW*3.5 + fissureAmp + 6
		if network {
			extent = radius*1.05 + fissureHW + 8
		}
	}
	if water && !(param(q, "facePx") > 0) {
		extent += math.Max(0, param(q, "bankPx"))
	}
	if n.Kind != "crater" && n.Kind != "fissure" && param(q, "baseVary") > 0 {
		extent += param(q, "baseVary")
	}
	if n.Kind != "crater" && n.Kind != "fissure" && param(q, "moonLobes") > 0 {
		extent += param(q, "moonLobes") * radius
	}
	fx, fy := 0, 1
	if natural || naturalWater {
		fx, fy = 3, 4
	}
	segmentBox := func(a, b model.Point) CellRect {
		return CellRect{int(clampNumber(math.Floor((math.Min(a.X, b.X)-extent)/g.Spacing), 0, float64(g.Grid-1))), int(clampNumber(math.Floor((math.Min(a.Y, b.Y)-extent)/g.Spacing), 0, float64(g.Grid-1))), int(clampNumber(math.Ceil((math.Max(a.X, b.X)+extent)/g.Spacing), 0, float64(g.Grid-1))), int(clampNumber(math.Ceil((math.Max(a.Y, b.Y)+extent)/g.Spacing), 0, float64(g.Grid-1)))}
	}
	dab := func(a, b model.Point) {
		box := segmentBox(a, b)
		out.Segments = append(out.Segments, Segment{PX: a.X, PY: a.Y, EX: b.X, EY: b.Y, NX: sampledShapeNoise(fx, n.Seed, a.X, a.Y, g, inv), NY: sampledShapeNoise(fy, n.Seed, a.X, a.Y, g, inv), Box: box})
	}
	p := model.ShapePath{Points: n.Points, Paths: n.Paths}
	if e := model.ValidatePaths(&p); e != nil {
		return out, e
	}
	turn := 0.0
	if len(n.Frame) == 6 {
		turn = math.Atan2(n.Frame[1], n.Frame[0])
	}
	face := [2]float64{1, 0}
	faceSide := 1
	settle := false
	paths := model.ShapePaths(&p)
	var reads []model.Point
	for _, indices := range paths {
		pts := make([]model.Point, len(indices))
		for i, j := range indices {
			pts[i] = n.Points[j]
		}
		if n.Kind == "crystal" {
			segs, rows := crystalSegments(pts, q, g, n.Seed, inv, turn, len(out.Extra))
			out.Segments = append(out.Segments, segs...)
			out.Extra = append(out.Extra, rows...)
			continue
		}
		if ridge {
			path := model.SimplifyPath(pts, math.Max(1, radius*.04))
			pcs := pieces
			if pcs == nil {
				pcs = ridgePieces(path, q, n.Seed, inv, turn)
			}
			for _, pc := range pcs {
				at := len(out.Segments)
				dab(pc.A, pc.B)
				seg := &out.Segments[at]
				seg.F0 = [2]float64{pc.R0, pc.R1}
				seg.F1 = [2]float64{pc.H0, pc.H1}
				seg.Jag = pc.Jag
				ex := radius*pc.Reach + 2*amp*(pc.R0+pc.R1)/2 + math.Max(0, param(q, "baseVary")) + math.Max(0, param(q, "moonLobes"))*radius
				seg.Box = CellRect{int(clampNumber(math.Floor((math.Min(pc.A.X, pc.B.X)-ex)/g.Spacing), 0, float64(g.Grid-1))), int(clampNumber(math.Floor((math.Min(pc.A.Y, pc.B.Y)-ex)/g.Spacing), 0, float64(g.Grid-1))), int(clampNumber(math.Ceil((math.Max(pc.A.X, pc.B.X)+ex)/g.Spacing), 0, float64(g.Grid-1))), int(clampNumber(math.Ceil((math.Max(pc.A.Y, pc.B.Y)+ex)/g.Spacing), 0, float64(g.Grid-1)))}
			}
			continue
		}
		if n.Kind == "fissure" {
			path := model.SimplifyPath(pts, math.Max(1.5, fissureHW))
			for _, p := range fissurePieces(path, q, n.Seed, radius, fissureK, fissureHW, network) {
				out.Segments = append(out.Segments, Segment{PX: p.A.X, PY: p.A.Y, EX: p.B.X, EY: p.B.Y, F0: [2]float64{p.R0, p.R1}, F1: [2]float64{p.H0, p.H1}, Box: segmentBox(p.A, p.B)})
			}
			continue
		}
		if n.Kind == "ramp" {
			segs, ptsRead := prepareRampPath(pts, radius, len(reads), segmentBox)
			out.Segments = append(out.Segments, segs...)
			reads = append(reads, ptsRead...)
			continue
		}
		if shouldered {
			fa := math.Atan2(-lean.BY, -lean.BX) + turn
			if param(q, "facing") == 0 {
				fa += sampledShapeNoise(3, n.Seed, pts[0].X, pts[0].Y, g, inv) * 1.8
			}
			face = [2]float64{math.Cos(fa), math.Sin(fa)}
			start := len(out.Segments)
			nextSide, didSettle := prepareHillPath(pts, radius, face, lean.Side, dab, &out.Segments)
			if nextSide != 0 {
				faceSide = nextSide
			}
			settle = settle || didSettle
			if len(paths) > 1 {
				for i := start; i < len(out.Segments); i++ {
					s := &out.Segments[i]
					if s.Frame {
						continue
					}
					dx, dy := s.EX-s.PX, s.EY-s.PY
					length := math.Hypot(dx, dy)
					f := face
					if length > 0 {
						f = [2]float64{-dy / length * float64(faceSide), dx / length * float64(faceSide)}
					}
					s.F0 = f
					s.F1 = f
					s.Frame = true
				}
			}
			continue
		}
		path := model.SimplifyPath(pts, math.Max(1, radius*.04))
		dab(path[0], path[0])
		longest := math.Max(16, radius*1.5)
		for k := 1; k < len(path); k++ {
			a, b := path[k-1], path[k]
			pieces := int(math.Ceil(math.Hypot(b.X-a.X, b.Y-a.Y) / longest))
			for j := 0; j < pieces; j++ {
				t0, t1 := float64(j)/float64(pieces), float64(j+1)/float64(pieces)
				dab(model.Point{X: a.X + (b.X-a.X)*t0, Y: a.Y + (b.Y-a.Y)*t0}, model.Point{X: a.X + (b.X-a.X)*t1, Y: a.Y + (b.Y-a.Y)*t1})
			}
		}
	}
	if len(out.Segments) == 0 {
		return out, nil
	}
	region := out.Segments[0].Box
	for _, s := range out.Segments[1:] {
		region = union(region, s.Box)
	}
	out.Writes = ShapeMaskWrites(n.Kind, q, satellite)
	u := map[string]float64{"kind": float64(code), "seed": float64(n.Seed), "radius": radius, "amount": param(q, "amount"), "amountPct": clampNumber(param(q, "amount")/100, 0, 1), "rough": rough, "softness": param(q, "softness"), "leanK": lean.K, "bearX": lean.BX, "bearY": lean.BY, "leanSide": float64(lean.Side), "wK": vary.WK, "wLo": vary.WLo, "wHi": vary.WHi, "hgtA": vary.HgtA, "hgtB": vary.HgtB, "bankScale": bankScale, "amp": amp, "faceVar": get("faceVariation", .8), "shelves": param(q, "shelves"), "beachFlat": param(q, "beachFlatness"), "coreEdge": .38, "faceX": face[0], "faceY": face[1], "faceSide": float64(faceSide), "faceWidth": faceWidth, "backWidth": backWidth, "rotX": math.Cos(turn), "rotY": math.Sin(turn), "cOffX": math.Cos(float64(n.Seed%628)/100 + turn), "cOffY": math.Sin(float64(n.Seed%628)/100 + turn), "facePx": math.Max(0, param(q, "facePx"))}
	u["fCell"], u["fCrack"], u["fDark"] = param(q, "fissureCell"), param(q, "fissureCrack"), param(q, "fissureDark")
	u["rimH"], u["ejecta"], u["cTop"] = param(q, "rimHeight"), param(q, "craterEjecta"), clampNumber(param(q, "crystalTop"), 0, .95)
	if naturalWater {
		u["natural"] = 1
	}
	if n.Kind == "shallow" && q["shallowMode"] == "passage" {
		u["passage"] = 1
	}
	if water && !(param(q, "facePx") > 0) {
		u["bankFlat"] = math.Max(0, param(q, "bankPx"))
	}
	if inv != nil {
		u["framed"] = 1
		for i, v := range inv {
			u[fmt.Sprintf("inv%d", i)] = v
		}
	}
	if n.Kind == "fissure" {
		u["fHw"], u["fKf"], u["fJag"], u["fAmp"] = fissureHW0, fissureK, param(q, "fissureJag"), fissureAmp
		u["fCell"], u["fCrack"], u["fDark"] = param(q, "fissureCell"), param(q, "fissureCrack"), param(q, "fissureDark")
		if network {
			u["fNet"] = 1
		}
	}
	if n.Kind == "offset" {
		u["bpOffset"] = 1

	}
	if ridge {
		u["ridge"] = 1
	}
	if hole != nil {
		u["hole"], u["hx"], u["hy"], u["hR"], u["hRough"], u["hSeed"] = 1, hole.X, hole.Y, hole.R, hole.Rough, float64(hole.Seed)
	}
	if n.Kind == "hill" {
		if plainHill {
			u["plain"] = 1
		}
		if settle {
			u["settle"] = 1
		}
	}
	if n.Kind == "mountain" || n.Kind == "hill" || n.Kind == "plateau" || n.Kind == "offset" || n.Kind == "crater" {
		u["crackAmt"] = math.Max(0, param(q, "cracks"))
	}
	entry := "stamp"
	if code >= 6 {
		entry = "stampN"
	}
	if n.Kind == "crystal" {
		form := 0.0
		entry = "stampCrystal"
		if param(q, "crystalForm") >= 1.5 {
			form = 2
			entry = "stampBerg"
		} else if param(q, "crystalForm") >= .5 {
			form = 1
			entry = "stampColumns"
		}
		bt := turn + param(q, "bergTiltDir")*math.Pi/180
		for k, v := range map[string]float64{"cgForm": form, "cgSize": math.Max(4, param(q, "crystalSize")), "cgFacet": clampNumber(param(q, "crystalFacet"), 0, 1), "cgSizeVar": clampNumber(param(q, "crystalSizeVar"), 0, 1), "cgSmooth": clampNumber(param(q, "crystalSmooth"), 0, 1), "cgTiers": param(q, "crystalTiers"), "cgStep": param(q, "crystalStep"), "cgVar": param(q, "crystalVariation"), "bgFace": param(q, "bergFace"), "bgTilt": param(q, "bergTilt"), "bgFlat": param(q, "bergFlat"), "bgRough": param(q, "bergRough"), "bgTx": math.Cos(bt), "bgTy": math.Sin(bt), "bgJit": clampNumber(param(q, "bergJitter"), 0, 1), "bgTurn": turn, "cTop": clampNumber(param(q, "crystalTop"), 0, .95)} {
			u[k] = v
		}
	}
	if n.Kind == "ramp" {
		entry = "stampRamp"
	}
	if n.Kind == "fissure" {
		entry = "stampFissure"
	}
	if n.Kind == "crater" {
		entry = "stampCrater"
		u["rimH"] = param(q, "rimHeight")
		u["ejecta"] = param(q, "craterEjecta")
		rows, ns, ng, hw := craterRim(q, n.Seed)
		out.Extra = append(out.Extra, rows...)
		u["nSect"], u["nGap"], u["gapHw"] = float64(ns), float64(ng), hw
	}
	facet := 0
	if n.Kind == "crater" && !satellite && param(q, "craterFacets") > 0 {
		facet = 1
	}
	if n.Kind == "mountain" && !satellite && param(q, "iceFacets") > 0 && param(q, "amount") >= 8 {
		facet = 2
	}
	var coast *CoastPass
	if water || (n.Kind == "offset" && param(q, "shorePlates") > 0) || facet != 0 {
		var coU map[string]float64
		var extra [][4]float64
		coast, coU, extra = prepareCoast(q, g, region, bankScale, radius, inv, n.Seed, water, facet)
		for k, v := range coU {
			u[k] = v
		}
		out.Extra = append(out.Extra, extra...)
	}
	var curve *model.CurveSpec
	if raw, ok := q["curve"]; ok && raw != nil {
		b, err := json.Marshal(raw)
		if err != nil {
			return out, err
		}
		curve = &model.CurveSpec{}
		if err = json.Unmarshal(b, curve); err != nil {
			return out, err
		}
	}
	cv := model.StrokeCurve(n.Kind, param(q, "softness"), param(q, "terraces"), param(q, "ledge"), param(q, "terraceJitter"), curve, shouldered)
	if cv != nil {
		u["cvLip"] = float64(cv.Lip)
		u["sSteps"] = float64(cv.Steps)
		u["sFlat"] = cv.Flat
		u["sJit"] = cv.Jitter
		u["curveBase"] = float64(len(out.Extra))
		for j := 0; j < len(cv.Front); j += 4 {
			var row [4]float64
			copy(row[:], cv.Front[j:min(j+4, len(cv.Front))])
			out.Extra = append(out.Extra, row)
		}
		if shouldered {
			u["backBase"] = float64(len(out.Extra))
			for j := 0; j < len(cv.Back); j += 4 {
				var row [4]float64
				copy(row[:], cv.Back[j:min(j+4, len(cv.Back))])
				out.Extra = append(out.Extra, row)
			}
			u["sBack"] = backWidth / faceWidth
		}
	}
	if n.Kind == "hill" || n.Kind == "mountain" || n.Kind == "plateau" || n.Kind == "offset" {
		u["bpAmp"] = math.Max(0, param(q, "baseBump"))
		if param(q, "baseVary") > 0 {
			u["olAmp"] = math.Min(param(q, "baseVary"), .15*radius) / radius
			if n.Kind == "offset" {
				u["olFlat"] = 1
			}
			u["olLo"], u["olHi"] = .5, .95
			u["olW0"], u["olL0"], u["olS0"] = .6, 55, 0x2e83
			u["olW1"], u["olL1"], u["olS1"] = .4, 21, 0x71d5
			u["olL2"] = 1
		} else if (n.Kind == "hill" || n.Kind == "mountain") && param(q, "moonLobes") > 0 {
			u["olAmp"] = param(q, "moonLobes")
			u["olLo"], u["olHi"], u["olMoon"] = .25, .8, 1
			u["olW0"], u["olL0"], u["olS0"] = .55, radius*.5, 0x5a31
			u["olW1"], u["olL1"], u["olS1"] = .3, radius*.18, 0x2c47
			u["olW2"], u["olL2"], u["olS2"] = .15, radius*.07, 0x7d13
		}
	}

	out.Op = PreparedOp{Region: &region, Values: u, Entry: entry, Settle: settle, Coast: coast}
	if n.Kind == "plateau" || n.Kind == "crater" {
		out.Op.PrefixReads = []model.Point{n.Points[0]}
	}
	if n.Kind == "ramp" {
		out.Op.PrefixReads = reads
	}
	if n.Kind == "smooth" {
		ref := g.RefSpacing
		if ref == 0 {
			ref = g.Spacing
		}
		out.Op.SmoothRadius = max(1, int(math.Floor(clampNumber(math.Floor(radius/(ref*7)+.5), 1, 24)*ref/g.Spacing+.5)))
	}
	return out, nil
}

// PackPreparedShapes produces the shared segment and mask/curve storage for
// replay, updating each operation's offsets into those buffers.
func PackPreparedShapes(shapes []PreparedShape) ([]PreparedOp, []byte, []byte) {
	var segments []Segment
	var rows [][4]float64
	ops := make([]PreparedOp, 0, len(shapes))
	for _, shape := range shapes {
		op := shape.Op
		if op.Ground {
			ops = append(ops, op)
			continue
		}
		if op.Region == nil {
			continue
		}
		op.Values = copyValues(op.Values, nil)
		op.Values["segBase"] = float64(len(segments))
		op.Values["nseg"] = float64(len(shape.Segments))
		op.Values["mwBase"] = float64(len(rows))
		op.Values["nwrites"] = float64(len(shape.Writes))
		segments = append(segments, shape.Segments...)
		for _, w := range shape.Writes {
			rows = append(rows, [4]float64(w))
		}
		rows = append(rows, shape.Extra...)
		ops = append(ops, op)
	}
	maskData := make([]byte, len(rows)*16)
	for i, r := range rows {
		for j, v := range r {
			binary.LittleEndian.PutUint32(maskData[i*16+j*4:], math.Float32bits(float32(v)))
		}
	}
	return ops, PackSegments(segments), maskData
}
