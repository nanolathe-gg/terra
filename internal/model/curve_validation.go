package model

import (
	"encoding/json"
	"fmt"
	"math"
)

// ValidateNodeCurves checks imported curve data before it reaches interpolation.
func ValidateNodeCurves(n Node) error {
	check := func(name string, raw any) error {
		b, err := json.Marshal(raw)
		if err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		var values [][]float64
		if err = json.Unmarshal(b, &values); err != nil {
			return fmt.Errorf("%s: invalid knots", name)
		}
		if len(values) < 2 {
			return fmt.Errorf("%s: at least two knots are required", name)
		}
		last := math.Inf(-1)
		for _, p := range values {
			if len(p) != 2 || math.IsNaN(p[0]) || math.IsNaN(p[1]) || math.IsInf(p[0], 0) || math.IsInf(p[1], 0) || p[0] < 0 || p[0] > 1 || p[0] <= last {
				return fmt.Errorf("%s: knot coordinates must be finite, ordered and within the section", name)
			}
			last = p[0]
		}
		return nil
	}
	if raw, ok := n.Params["curve"]; ok && raw != nil {
		curve, ok := raw.(map[string]any)
		if !ok {
			return fmt.Errorf("curve: expected an object")
		}
		for _, key := range []string{"knots", "back"} {
			if v, ok := curve[key]; ok && v != nil {
				if err := check("curve."+key, v); err != nil {
					return err
				}
			}
		}
	}
	if raw, ok := n.Params["along"]; ok && raw != nil {
		if err := check("along", raw); err != nil {
			return err
		}
	}
	return nil
}
