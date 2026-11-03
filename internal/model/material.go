package model

import "math"

const MaterialRowsPerLayer = 63
const PlacementRow = 156

// MaterialTable preserves the material file's numeric data and names.
type MaterialTable struct {
	Order     []string                      `json:"order"`
	Measured  map[string]MeasuredMaterial   `json:"measured"`
	Model     map[string]MaterialModel      `json:"model"`
	Placement map[string]map[string]float64 `json:"placement"`
}
type MeasuredMaterial struct {
	Ramp  [][]float64 `json:"ramp"`
	Tint  [][]float64 `json:"tint"`
	Vocab [][]float64 `json:"vocab"`
}
type MaterialModel struct {
	Amps      []float64      `json:"amps"`
	Stretch   float64        `json:"stretch"`
	TintMix   float64        `json:"tintMix"`
	TintScale float64        `json:"tintScale"`
	Dither    float64        `json:"dither"`
	ZQ        []float64      `json:"zq"`
	Lit       map[string]any `json:"lit"`
	DotCell   float64        `json:"dotCell"`
	DotShare  float64        `json:"dotShare"`
	DotRadius float64        `json:"dotRadius"`
	DotDepth  float64        `json:"dotDepth"`
}
type Row [4]float32

func row(a, b, c, d float64) Row             { return Row{float32(a), float32(b), float32(c), float32(d)} }
func num(m map[string]any, k string) float64 { v, _ := m[k].(float64); return v }
func materialLitRows(lit map[string]any) []Row {
	x := func(k string) float64 { return num(lit, k) }
	rgb := []float64{0, 0, 0}
	if a, ok := lit["veinRGB"].([]any); ok && len(a) >= 3 {
		for i := 0; i < 3; i++ {
			rgb[i], _ = a[i].(float64)
		}
	}
	return []Row{row(x("relief"), x("light")*2*math.Pi, x("shear"), x("heightShare")), row(x("ridged"), x("cell"), x("tilt"), x("tone")), row(x("seamWidth"), x("seamDepth"), x("veinWidth"), x("veinSpacing")), row(rgb[0], rgb[1], rgb[2], x("veinShare")), row(x("warp"), x("cone"), x("seamVary"), x("seamGap")), row(x("cellVary"), x("streakBand"), x("skew"), x("strokeCore")), row(x("strokeSize"), x("strokeShare"), x("strokeRadius"), x("strokeDepth"))}
}
func MaterialRows(t MaterialTable) []Row {
	rows := make([]Row, 0, len(t.Order)*MaterialRowsPerLayer)
	for _, name := range t.Order {
		m, f := t.Measured[name], t.Model[name]
		a := f.Amps
		rows = append(rows, row(a[0], a[1], a[2], a[3]), row(a[4], a[5], a[6], f.Stretch), row(f.TintMix, f.TintScale, f.Dither, 0))
		for _, colors := range [][][]float64{m.Ramp, m.Tint} {
			for _, c := range colors {
				rows = append(rows, row(c[0], c[1], c[2], 0))
			}
		}
		for k := 0; k < 4; k++ {
			rows = append(rows, row(f.ZQ[min(k*4, 12)], f.ZQ[min(k*4+1, 12)], f.ZQ[min(k*4+2, 12)], f.ZQ[min(k*4+3, 12)]))
		}
		rows = append(rows, materialLitRows(f.Lit)...)
		for k := 0; k < 16; k++ {
			if k < len(m.Vocab) {
				v := m.Vocab[k]
				rows = append(rows, row(v[0], v[1], v[2], 1))
			} else {
				rows = append(rows, Row{})
			}
		}
		rows = append(rows, row(f.DotCell, f.DotShare, f.DotRadius, f.DotDepth))
	}
	return rows
}
func TablePlacementRows(t MaterialTable, overrides map[string][]float64) []Row {
	p := t.Placement
	v := func(group, key string) float64 { return p[group][key] }
	rows := []Row{row(v("rock", "slope"), v("rock", "formSlope"), v("rock", "convexity"), v("rock", "convexityRange")), row(v("rock", "noiseG"), v("rock", "noiseR"), v("rock", "weather"), v("rock", "tap")), row(v("rock", "start"), v("rock", "full"), 0, 0), row(v("soil", "slopeGate"), v("soil", "heightGate"), v("soil", "fadeFrom"), v("soil", "fadeTo")), row(v("lowBank", "from"), v("lowBank", "to"), 0, 0), row(v("route", "from"), v("route", "to"), 0, 0), row(v("face", "slopeFrom"), v("face", "slopeTo"), v("face", "edgeNoise"), 0), row(v("face", "shareFrom"), v("face", "shareTo"), 0, 0), row(v("face", "roughness"), v("face", "lumpTop"), v("face", "fineNoise"), v("face", "broadNoise")), row(v("face", "gully"), v("face", "order"), v("face", "paintedRock"), 0)}
	for _, o := range []struct {
		k       string
		r, c, n int
	}{{"faceEdge", 6, 2, 1}, {"gullyRock", 9, 0, 1}, {"rockOrder", 9, 1, 1}, {"faceSlope", 6, 0, 2}, {"rockShare", 7, 0, 2}, {"faceScore", 8, 0, 4}} {
		if a := overrides[o.k]; len(a) == o.n {
			valid := true
			for _, x := range a {
				valid = valid && !math.IsNaN(x) && !math.IsInf(x, 0)
			}
			if valid {
				for i, x := range a {
					rows[o.r][o.c+i] = float32(x)
				}
			}
		}
	}
	return rows
}
