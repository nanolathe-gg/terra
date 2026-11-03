package terrain

import (
	"math"
)

// prepareCoast carries the coast dependency reach and extra shader rows.
func prepareCoast(q map[string]any, g ShapeGeometry, region CellRect, bankScale, radius float64, inv []float64, seed uint32, water bool, facet int) (*CoastPass, map[string]float64, [][4]float64) {
	v := func(k string) float64 { return param(q, k) }
	fallback := func(k string, d float64) float64 {
		if _, ok := q[k]; !ok {
			return d
		}
		return v(k)
	}
	fingers := water && v("fingers") > 0
	layers := water && math.Floor(v("shoreLayers")+.5) >= 1
	plWater, plLand := math.Max(0, v("plateWaterPx")), math.Max(0, v("plateLandPx"))
	plates := v("shorePlates") > 0 && math.Max(plWater, plLand) > 0
	if !fingers && !layers && !plates && facet == 0 {
		return nil, nil, nil
	}
	whole := CellRect{0, 0, g.Grid - 1, g.Grid - 1}
	spacing := g.Spacing
	ref := g.RefSpacing
	if ref == 0 {
		ref = spacing
	}
	if facet != 0 {
		l := clampNumber(v("iceFacetSize"), 16, 96)
		if facet == 1 {
			l = v("crystalCraterPx")
			if l <= 0 {
				l = clampNumber(radius*.36, 14, 36)
			}
		}
		m := int(math.Ceil(2.1*l/spacing)) + 6
		box := expand(region, m, whole)
		c := &CoastPass{Box: box, ReadRadius: m + 2, BlurRadius: 1, Facet: true}
		return c, map[string]float64{"fcMode": float64(facet), "fcL": l, "fcStrength": clampNumber(v("craterFacets"), 0, 1), "fcStep": v("crystalCraterStep"), "fcSkin": boolNumber(v("crystalCraterSkin") >= .5), "fcShare": .2 + .5*clampNumber(v("iceFacets"), 0, 1), "coPutW": 1, "coBx0": float64(box.X0), "coBy0": float64(box.Y0), "coBx1": float64(box.X1), "coBy1": float64(box.Y1)}, nil
	}
	n := max(1, int(math.Floor(v("shoreLayers")+.5)))
	w := math.Max(4, v("layerPx"))
	vary := clampNumber(v("layerVary"), 0, 1)
	spread := clampNumber(v("lavaSpread"), 0, 2)
	rc := math.Max(8, v("layerCircle"))
	cv := clampNumber(v("lavaCircleVary"), 0, 1)
	scal := layers && math.Floor(v("layerStyle")+.5) == 1
	lReach := 0.0
	if layers {
		if scal {
			lReach = float64(n)*w*(1+.45*cv) + 2.8*rc*(1+.07*cv) + 2*w
		} else {
			wide := math.Max(1+.6*vary, math.Exp(.5*(vary+spread)))
			lReach = (float64(n)+1+1.2)*w*wide + 2*w
		}
	}
	fReach := .5 * radius * bankScale
	fLimit := fReach + spacing*3
	reach := lReach
	if fingers {
		reach = math.Max(reach, fLimit)
	}
	if plates {
		reach = math.Max(reach, math.Max(plWater, plLand)+2*spacing)
	}
	m := int(math.Ceil(reach/spacing)) + 12
	box := expand(region, m, whole)
	blur := max(1, int(math.Floor(10*ref/spacing+.5)))
	extra := [][4]float64{}
	if layers && vary > 0 {
		weights := make([]float64, n)
		total := 0.0
		for k := range weights {
			weights[k] = 1 + .6*vary*hashNoise(k, 7, seed^0x2e9)
			total += weights[k]
		}
		cum := 0.0
		for _, x := range weights {
			wn := x * float64(n) / total
			extra = append(extra, [4]float64{wn, cum, 0, 0})
			cum += wn
		}
	}
	i0, j0, ni, nj := 0, 0, 0, 0
	if scal {
		C := rc * 1.3
		minx, miny, maxx, maxy := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
		for _, p := range [][2]int{{box.X0, box.Y0}, {box.X1, box.Y0}, {box.X0, box.Y1}, {box.X1, box.Y1}} {
			x, y := float64(p[0])*spacing, float64(p[1])*spacing
			if inv != nil {
				x, y = inv[0]*x+inv[2]*y+inv[4], inv[1]*x+inv[3]*y+inv[5]
			}
			minx, miny, maxx, maxy = math.Min(minx, x), math.Min(miny, y), math.Max(maxx, x), math.Max(maxy, y)
		}
		i0, j0 = int(math.Floor(minx/C))-1, int(math.Floor(miny/C))-1
		i1, j1 := int(math.Ceil(maxx/C))+1, int(math.Ceil(maxy/C))+1
		ni, nj = i1-i0+1, j1-j0+1
	}
	readR := m + 2
	if fingers {
		readR += blur
	}
	c := &CoastPass{Box: box, ReadRadius: readR, MaxCells: int(math.Ceil(reach/spacing)) + 4, BlurRadius: blur, Fingers: fingers, Layers: layers, Plates: plates, Scalloped: scal, Sites: CellRect{0, 0, ni - 1, nj - 1}, SiteFloats: ni * nj * 4}
	pm := 0.0
	if plates {
		pm = 1
		if v("plateMaterial") >= 1.5 {
			pm = 2
		}
	}
	u := map[string]float64{"plMat": pm, "plWater": plWater, "plLand": plLand, "plSize": v("plateSize"), "plGap": v("plateGap"), "plHeight": v("plateHeight"), "plSeam": fallback("crystalShoreSeam", .5), "plVary": v("plateVary"), "plNeedles": v("frostNeedles"), "frGapSize": math.Max(3, v("frostGapSize")), "frGapDepth": v("frostGapDepth"), "frGaps": v("frostGaps"), "frGapReach": v("frostGapReach"), "coPutW": 1, "coFar": 1e5 + 2*spacing, "coLimit": fLimit, "coFReach": fReach, "coFAmt": v("fingers") * clampNumber(radius*bankScale/140, .35, 1), "cfSize": fallback("fingerSize", 1), "coN": float64(n), "coW": w, "coLedge": clampNumber(v("layerLedge"), .4, .95), "coIrr": clampNumber(v("layerRough"), 0, 1), "coVary": vary, "coSpread": spread, "coMeander": 1.2, "coLReach": lReach, "coRiser": math.Max(0, v("layerRiser")), "coScal": boolNumber(scal), "coRc": rc, "coCV": cv, "coRs": 1.4*rc + cv*.1*rc + float64(n)*w*(1+.45*cv) + spacing, "coSI0": float64(i0), "coSJ0": float64(j0), "coSNI": float64(ni), "coSNJ": float64(nj), "coBx0": float64(box.X0), "coBy0": float64(box.Y0), "coBx1": float64(box.X1), "coBy1": float64(box.Y1)}
	return c, u, extra
}
func boolNumber(b bool) float64 {
	if b {
		return 1
	}
	return 0
}
