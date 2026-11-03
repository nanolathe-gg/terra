package terrain

import (
	"encoding/json"
	"fmt"
	"github.com/nanolathe-gg/terraform/internal/model"
	"math"
	"strconv"
	"strings"
)

func (r *Renderer) num(k string, d float64) float64 {
	v, ok := r.Variant[k]
	if !ok {
		return d
	}
	x, e := strconv.ParseFloat(v, 64)
	if e != nil {
		return d
	}
	return x
}
func (r *Renderer) hasLayer(name string) bool {
	for _, n := range r.Table.Order {
		if n == name {
			return true
		}
	}
	return false
}
func upper(s string) string { return strings.ToUpper(s[:1]) + s[1:] }
func (r *Renderer) SetColumn() {
	var c *model.Column
	if v := r.Config["column"]; v != nil {
		b := must(json.Marshal(v))
		check(json.Unmarshal(b, &c))
	}
	p := must(model.ColumnRows(c, str(r.Config, "variant")))
	for k, d := range map[string]float64{"bedSpacing": 12, "bedDip": 0, "bedDipDir": 90, "columnContrast": 1} {
		r.Set("u"+upper(k), r.num(k, d))
	}
	r.Set("uColumnSectionCount", float64(len(p.Starts)))
	setRows := func(name string, rows []model.Row) {
		f := flatRows(rows)
		v := make([]float64, len(f))
		for i, x := range f {
			v[i] = float64(x)
		}
		r.Set(name, v...)
	}
	setRows("uColumnBeds", p.Beds)
	setRows("uColumnSections", p.Starts)
	col := object(r.Config, "column")
	wander := object(col, "wander")
	r.Set("uColumnWander", number(wander, "value", 0))
	r.Set("uColumnTerrain", append(vector(wander, "terrain", []float64{0, 0, 0}), 0)...)
	origin := 0.
	if str(col, "origin") == "plain" {
		origin = number(r.Config, "baseHeight", 24) - number(r.Config, "seaLevel", 0)
	}
	r.Set("uColumnOrigin", origin)
	r.Set("uBandSpacing", float64(p.Bands[0]))
	r.Set("uBandLine", float64(p.Bands[1]))
}
func (r *Renderer) ApplyKnobs(v map[string]string) {
	for k, x := range v {
		r.Variant[k] = x
	}
	if r.groundKey != r.Variant["groundPattern"] {
		r.initGround()
	}
	for k, d := range surfaceDefaults {
		r.Set("u"+upper(k), r.num(k, d))
	}
	r.Set("uMineralDetail", r.num("mineralDetail", 1))
	if r.Variant["grain"] == "strong" {
		r.Set("uMineralDetail", 2.4*r.num("mineralDetail", 1))
	}
	r.Set("uMossFromGround", r.num("moss", 0))
	r.Set("uFootRim", r.num("rim", 0))
	r.Set("uGroundMode", flag(r.groundTiled))
	r.Set("uGroundTiles", r.num("groundTiles", 16))
	layer := -1
	for i, name := range r.Table.Order {
		if name == "quilt" {
			layer = i
		}
	}
	r.Set("uGroundLayer", float64(layer))
	r.Set("uGroundBorrowed", flag(r.groundBorrowed))
	r.Set("uShallowDepth", r.num("shallowDepth", number(object(r.Config, "material"), "shallowDepth", 2)))
	r.Set("uDeepDepth", r.num("deepDepth", number(object(r.Config, "material"), "deepDepth", 42)))
	shallow := vector(object(r.Config, "water"), "shallowMeanRGB", vector(object(r.Config, "water"), "shallowRGB", []float64{60, 115, 163}))
	r.Set("uShallowMean", shallow[0]/255, shallow[1]/255, shallow[2]/255)
	r.Set("uMaterialFoot", math.Max(1, r.num("materialFoot", 1)))
	for k, d := range map[string]float64{"lavaCrust": 0, "lavaPillow": 34, "lavaChip": 5.5, "lavaVeins": 0, "lavaCalm": .6, "lavaDusk": 0} {
		r.Set("u"+upper(k), r.num(k, d))
	}
	lists := map[string][]float64{"faceSlope": {.35, .9}, "rockShare": {.2, 1}, "faceScore": {.2, 2, .5, .3}}
	overrides := map[string][]float64{}
	for k, d := range lists {
		a := d
		if s, ok := r.Variant[k]; ok {
			a = nil
			for _, p := range strings.Split(s, ",") {
				x, _ := strconv.ParseFloat(p, 64)
				a = append(a, x)
			}
		}
		r.Set("u"+upper(k), a...)
		overrides[k] = a
	}
	for _, k := range []string{"faceEdge", "gullyRock", "rockOrder"} {
		if _, ok := r.Variant[k]; ok {
			overrides[k] = []float64{r.num(k, 0)}
		}
	}
	var rows []model.Row
	if r.Table.Placement != nil {
		rows = model.TablePlacementRows(r.Table, overrides)
	} else {
		rows = r.placementRows(lists)
	}
	all := make([]float64, (model.PlacementRow+len(rows))*4)
	for i, row := range rows {
		for j, x := range row {
			all[(model.PlacementRow+i)*4+j] = float64(x)
		}
	}
	r.Set("uMaterialTable", all...)
	shine := []float64{}
	on := false
	for _, name := range []string{"Ground", "Slope", "Rock", "Sand", "Crystal"} {
		a := []float64{r.num("shine"+name, 0), r.num("shine"+name+"Sharp", 24), r.num("shine"+name+"Rough", 0), r.num("shine"+name+"Scale", 6)}
		on = on || a[0] > 0 || a[2] > 0
		shine = append(shine, a...)
	}
	r.Set("uShine", shine...)
	r.Set("uShineOn", flag(on))
	r.SetColumn()
}
func (r *Renderer) placementRows(l map[string][]float64) []model.Row {
	mat := object(r.Config, "material")
	soil := r.Variant["transition"] == "soil"
	mineral := r.Variant["transition"] == "mineral" && r.Variant["margins"] != "slope"
	threshold, feather := number(mat, "rockSlope", 1.145), number(mat, "rockFeather", .43)
	row := func(a, b, c, d float64) model.Row { return model.Row{float32(a), float32(b), float32(c), float32(d)} }
	r0, r1, third := row(1, 0, 0, 5), row(.55, 0, .55, 10), .30
	switch r.Variant["coverage"] {
	case "form":
		r0 = row(.55, .45, .28, 5)
		v := .25
		if soil {
			v = .80
		}
		r1 = row(v, flag(soil)*.7, .55, 10)
		third = 0
	case "ledge":
		r0 = row(.15, .85, .15, 3)
		r1 = row(.15, 0, .55, 4)
		third = 0
	}
	gate := 1e9
	if soil {
		gate = 18
	}
	coast := row(12, 36, 0, 0)
	if mat["rockyCoasts"] == true {
		coast = row(-1e4, -1e3, 0, 0)
	}
	face, share, score := l["faceSlope"], l["rockShare"], l["faceScore"]
	return []model.Row{r0, r1, row(threshold-feather*.5, threshold+feather*.5, third, 0), row(.2, gate, 18, 28), coast, row(.45, .9, flag(mineral)*.45, flag(mineral)*1.4), row(face[0], face[1], r.num("faceEdge", .8), 0), row(share[0], share[1], 0, 0), row(score[0], score[1], score[2], score[3]), row(r.num("gullyRock", .5), r.num("rockOrder", 0), 0, 0)}
}
func (r *Renderer) initUniforms() {
	m, w := object(r.Config, "material"), object(r.Config, "water")
	r.Set("uGrid", float64(r.Grid))
	r.Set("uSize", float64(r.Size))
	r.Set("uBase", number(r.Config, "baseHeight", 24)-number(r.Config, "seaLevel", 0))
	r.Set("uSea", 0)
	r.Set("uBeach", flag(r.hasLayer("beach")))
	r.Set("uBeachHeight", number(m, "beachHeight", 6))
	mid := vector(w, "midRGB", nil)
	if len(mid) == 3 && number(m, "midDepth", 0) != 0 {
		r.Set("uWaterMid", mid[0]/255, mid[1]/255, mid[2]/255, number(m, "midDepth", 0))
	}
	r.Set("uRockyCoasts", flag(m["rockyCoasts"] == true))
	r.Set("uSlopeMaterial", flag(r.Variant["surface"] == "slopes" || r.Variant["surface"] == "structured"))
	r.Set("uSoilCover", flag(r.Variant["transition"] == "soil"))
	r.Set("uMineralMargins", flag(r.Variant["transition"] == "mineral" && r.Variant["margins"] != "slope"))
	r.Set("uRockLayers", flag(r.Variant["material"] == "varied"))
	r.ApplyKnobs(nil)
	r.Set("uSeparateLight", flag(r.Variant["shade"] == "separate"))
	r.Set("uFaceFill", r.num("faceFill", math.Max(0, math.Min(.5, r.num("fill", 0)/100))))
	r.Set("uCoastalDetail", flag(r.Variant["shore"] != "smooth"))
	r.Set("uLayered", flag(r.Variant["geology"] == "layers" || r.Variant["geology"] == "terraces"))
	r.Set("uTerraced", flag(r.Variant["geology"] == "terraces"))
	r.Set("uSlopeProfile", number(m, "slopeStart", .1), number(m, "slopeFull", .55), number(m, "slopeFloor", 8), number(m, "slopeDry", 24))
	r.Set("uElevatedCover", vector(m, "elevatedCover", []float64{5, 32, 0})...)
	r.Set("uSlopeOnLowBanks", flag(m["slopeOnLowBanks"] != false))
	r.Set("uRampMaterial", number(m, "rampMaterial", 0))
	r.Set("uSlopeSand", flag(m["slopeSand"] == true))
	for key, d := range map[string][]float64{"crystalRGB": {110, 150, 225}, "hillRockMeanRGB": {85, 84, 79}} {
		v := vector(m, key, d)
		name := "uCrystalColor"
		if key == "hillRockMeanRGB" {
			name = "uRockMean"
		}
		r.Set(name, v[0]/255, v[1]/255, v[2]/255)
	}
	r.Set("uGroundFringe", flag(m["groundFringe"] == true))
	r.Set("uFringeSignal", vector(m, "fringeSignal", []float64{-.299, -.587, -.114, 1})...)
	r.Set("uFringeRange", vector(m, "fringeRange", []float64{.08, .28})...)
	threshold, feather := number(m, "rockSlope", 1.145), number(m, "rockFeather", .43)
	r.Set("uRockStart", threshold-feather*.5)
	r.Set("uRockFull", threshold+feather*.5)
	r.Set("uWetBand", number(m, "wetBand", 13))
	r.Set("uShapeCoverage", flag(r.Variant["coverage"] == "form"))
	r.Set("uLedgeCoverage", flag(r.Variant["coverage"] == "ledge"))
	for _, p := range []struct {
		k, u string
		d    []float64
	}{{"shallowRGB", "uShallowColor", []float64{60, 115, 163}}, {"deepRGB", "uDeepColor", []float64{16, 57, 133}}} {
		v := vector(w, p.k, p.d)
		r.Set(p.u, v[0]/255, v[1]/255, v[2]/255)
	}
	mean := vector(object(object(r.Material, "measured"), str(w, "deep")), "meanRGB", []float64{16, 57, 133})
	r.Set("uWaterMean", mean[0]/255, mean[1]/255, mean[2]/255)
	for i, name := range r.Table.Order {
		if name == str(w, "deep") {
			r.Set("uWaterLayer", float64(i))
		}
		if name == str(w, "shallow") {
			r.Set("uShallowLayer", float64(i))
		}
	}
	r.SetColors(nil)
}
func (r *Renderer) SetColors(colors map[string][]float64) {
	for _, k := range []string{"ground", "slope", "rock", "sand", "beach", "shallow", "deep", "crystal"} {
		v := colors[k]
		if len(v) == 3 {
			r.Set("u"+upper(k)+"Base", v[0], v[1], v[2], 1)
		} else {
			r.Set("u"+upper(k)+"Base", 0, 0, 0, 0)
		}
	}
	defaults := [][]float64{{146, 74, 58}, {188, 122, 96}, {140, 124, 138}, {198, 182, 158}, {166, 98, 76}}
	col := object(r.Config, "column")
	if raw, ok := col["colors"].([]any); ok {
		defaults = nil
		for _, x := range raw {
			v := x.([]any)
			defaults = append(defaults, []float64{v[0].(float64), v[1].(float64), v[2].(float64)})
		}
	}
	v := []float64{}
	for i, c := range defaults {
		a := colors[fmt.Sprint("strata", i+1)]
		if len(a) != 3 {
			a = []float64{c[0] / 255, c[1] / 255, c[2] / 255}
		}
		v = append(v, a...)
	}
	r.Set("uStrataColors", v...)
	for k, a := range r.means {
		r.Set("u"+upper(k)+"TexMean", a...)
	}
}
func (r *Renderer) drawUniforms(o DrawOptions) {
	r.Set("uFull", flag(o.Full))
	r.Set("uClay", flag(o.Clay))
	detail := o.Detail
	if detail == 0 {
		detail = number(object(r.Config, "material"), "surfaceRelief", 1)
	}
	if r.Variant["relief"] == "base" {
		detail = 0
	}
	r.Set("uDetail", detail)
	r.Set("uMaterialWeathering", o.MaterialWeathering)
	r.Set("uTransitionDetail", o.TransitionDetail)
	r.Set("uTransitionBody", flag(r.hasLayer("body") && o.MaterialWeathering > 0))
	ring := o.Ring
	if !r.hasLayer("ring") {
		ring = 0
	}
	r.Set("uRingAmount", ring)
	r.Set("uRingSpread", o.RingSpread)
	r.Set("uRingVariation", o.RingVariation)
	r.Set("uQuantize", flag(r.Variant["palette"] != "off"))
	r.Set("uPaletteMix", flag(r.num("paletteMix", 0) > .5))
	for k, d := range map[string]float64{"shoreEdge": 0, "crystalGrain": 0, "crystalFace": 1, "crystalInk": 0, "crystalTone": 1} {
		r.Set("u"+upper(k), r.num(k, d))
	}
	x, y, z := -.72, -.38, .82
	if o.AlternateLight {
		x = .72
	}
	if r.Variant["lighting"] == "front" {
		y = .38
	}
	y *= r.num("sunTilt", 1)
	length := math.Sqrt(x*x + y*y + z*z)
	sun := []float64{x / length, y / length, z / length}
	r.Set("uLight", sun...)
	r.Set("uSun", sun...)
}
func (r *Renderer) bakeUniforms(full bool) {
	for k, d := range bakeDefaults {
		r.Set("u"+upper(k), r.num(k, d))
	}
	for k, d := range map[string]float64{"terraceBreak": 0, "terraceCalm": 0, "wetSwath": 0, "outcrop": 0, "rillDepth": 0, "rillSpacing": 8, "stoneDensity": 0, "stoneSize": 5, "blocks": 0, "blockRow": 4.5, "blockWidth": 9, "blockTilt": .5, "blockStep": .8, "blockSeam": .5, "blockChip": 1.2, "hillBlocks": 0} {
		r.Set("u"+upper(k), r.num(k, d))
	}
	r.Set("uBoulderDensity", flag(full)*r.num("boulders", 0))
	r.Set("uDebris", flag(full)*r.num("debris", 0))
	r.Set("uCracksOn", flag(full || r.Variant["previewCracks"] == "1"))
	beach := flag(r.hasLayer("beach"))
	r.Set("uBeachDistance", beach*number(object(r.Config, "material"), "beachWidth", 120)*r.num("beachWidth", .6))
	r.Set("uHasBeach", beach)
	octaves := r.num("reliefOctaves", 5)
	if !full {
		octaves = math.Min(3, octaves)
	}
	r.Set("uReliefOctaves", octaves)
	r.SetColumn()
}
