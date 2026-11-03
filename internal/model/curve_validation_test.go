package model

import "testing"

func TestValidateNodeCurves(t *testing.T) {
	for _, c := range []struct {
		p     map[string]any
		valid bool
	}{
		{map[string]any{"curve": map[string]any{"form": "lfHill"}}, true},
		{map[string]any{"curve": map[string]any{"knots": [][]float64{{0, 0}, {1, 1}}, "back": [][]float64{{0, 0}, {1, 1}}}, "along": [][]float64{{0, 1}, {1, 1}}}, true},
		{map[string]any{"curve": map[string]any{"knots": [][]float64{}}}, false},
		{map[string]any{"curve": map[string]any{"back": [][]float64{{0, 0}, {0, 1}}}}, false},
		{map[string]any{"along": [][]float64{{0, 0}, {1.1, 1}}}, false},
		{map[string]any{"along": [][]float64{{0}, {1, 1}}}, false},
	} {
		if (ValidateNodeCurves(Node{Params: c.p}) == nil) != c.valid {
			t.Fatalf("validation: %+v", c.p)
		}
	}
}
