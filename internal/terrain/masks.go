package terrain

import (
	"encoding/json"
	"math"
	"strconv"
)

type MaskWrite [4]float64

var maskChoices = [][][2]float64{nil, {{0, 127}, {1, 0}, {3, 0}}, {{1, 127}, {0, 0}, {3, 0}}, {{2, 127}}, {{3, 127}, {0, 0}, {1, 0}}, {{4, 127}}, {{4, -127}}, {{0, 0}, {1, 0}, {2, 0}, {3, 0}, {4, 0}, {5, 0}, {6, 0}, {7, 0}, {8, 0}, {9, 0}, {10, 0}, {11, 0}, {12, 0}, {13, 0}, {14, 0}, {15, 0}, {16, 0}, {17, 0}}, {{5, 127}}, {{5, -127}}, {{6, 127}}, {{6, -127}}, {{7, 127}}, {{7, -127}}, {{8, 127}}, {{8, -127}}, {{12, 127}}, {{12, -127}}, {{14, 127}}, {{14, -127}}, {{15, 127}}, {{15, -127}}, {{16, 127}}, {{16, -127}}, {{17, 127}}, {{17, -127}}}

func param(q map[string]any, k string) float64 {
	switch v := q[k].(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case uint32:
		return float64(v)
	case string:
		x, _ := strconv.ParseFloat(v, 64)
		return x
	case json.Number:
		x, _ := v.Float64()
		return x
	}
	return 0
}
func clampNumber(v, a, b float64) float64 { return math.Max(a, math.Min(b, v)) }
func choiceWrites(choice int, gain float64) []MaskWrite {
	if choice < 0 || choice >= len(maskChoices) {
		return nil
	}
	out := make([]MaskWrite, 0, len(maskChoices[choice]))
	for _, w := range maskChoices[choice] {
		out = append(out, MaskWrite{w[0], w[1], gain, 0})
	}
	return out
}

// ShapeMaskWrites converts author controls into shader mask-plane writes.
func ShapeMaskWrites(kind string, q map[string]any, satellite bool) []MaskWrite {
	if kind == "fissure" {
		if param(q, "fissureDark") > 0 {
			return []MaskWrite{{2, 127, 1, 0}}
		}
		return nil
	}
	if kind == "paint" {
		return choiceWrites(int(math.Floor(param(q, "paintChannel")+.5)), 1)
	}
	if kind == "erase" {
		return choiceWrites(7, 1)
	}
	switch kind {
	case "plateau", "offset", "hill", "mountain", "crater", "deep", "shallow", "landform":
	default:
		return nil
	}
	if satellite {
		return nil
	}
	out := choiceWrites(int(math.Floor(param(q, "maskChannel")+.5)), clampNumber(param(q, "maskAmount"), 0, 1))
	keys := []string{"styleRelief", "styleCracks", "styleBanding", "styleFace", "styleErosion", "styleDeposits", "styleVegetation", "styleExposure"}
	planes := []float64{5, 6, 7, 8, 14, 15, 16, 17}
	for i, k := range keys {
		v := clampNumber(param(q, k), -1, 1)
		if math.Abs(v) >= .005 {
			out = append(out, MaskWrite{planes[i], math.Floor(127*v + .5), 1, 0})
		}
	}
	if kind == "deep" || kind == "shallow" {
		for j, k := range []string{"waterShore", "waterDeep", "waterBed"} {
			c := int(math.Floor(param(q, k) + .5))
			limit := 2
			if k == "waterBed" {
				limit = 3
			}
			if c < 1 || c > limit {
				continue
			}
			target := 127.0
			if c == 2 {
				target = -127
			}
			out = append(out, MaskWrite{float64(9 + j), target, 1, 1})
			if k == "waterBed" {
				extra := 0.0
				if c == 3 {
					extra = 127
				}
				out = append(out, MaskWrite{13, extra, 1, 1})
			}
		}
	}
	return out
}
