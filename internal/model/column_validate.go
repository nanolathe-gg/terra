package model

import (
	"encoding/json"
	"errors"
	"math"
)

var errColumn = errors.New("Invalid rock column: keep the existing rows, finite values, positive thicknesses and ordered starts.")

// ValidateColumn ensures an edited table retains the exact structure of its
// world template, then checks the ranges consumed by the shader uniforms.
func ValidateColumn(value, template any) error {
	if value == nil {
		return nil
	}
	normalize := func(v any) (any, error) {
		b, e := json.Marshal(v)
		if e != nil {
			return nil, e
		}
		var out any
		e = json.Unmarshal(b, &out)
		return out, e
	}
	v, e := normalize(value)
	if e != nil {
		return errColumn
	}
	t, e := normalize(template)
	if e != nil || t == nil {
		return errColumn
	}
	var shape func(any, any) bool
	shape = func(v, t any) bool {
		switch tt := t.(type) {
		case float64:
			n, ok := v.(float64)
			return ok && !math.IsNaN(n) && !math.IsInf(n, 0) && !math.IsInf(float64(float32(n)), 0)
		case string:
			s, ok := v.(string)
			return ok && (s == "plain" || s == "sea")
		case []any:
			a, ok := v.([]any)
			if !ok || len(a) != len(tt) {
				return false
			}
			for i := range a {
				if !shape(a[i], tt[i]) {
					return false
				}
			}
			return true
		case map[string]any:
			m, ok := v.(map[string]any)
			if !ok || len(m) != len(tt) {
				return false
			}
			for k, x := range tt {
				z, ok := m[k]
				if !ok || !shape(z, x) {
					return false
				}
			}
			return true
		}
		return false
	}
	if !shape(v, t) {
		return errColumn
	}
	c, ok := v.(map[string]any)
	if !ok {
		return errColumn
	}
	slots := 5
	if colors, ok := c["colors"].([]any); ok && len(colors) > 0 {
		slots = len(colors)
		for _, raw := range colors {
			for _, x := range raw.([]any) {
				n := x.(float64)
				if n < 0 || n > 255 {
					return errColumn
				}
			}
		}
	}
	rows := []map[string]any{c}
	if variants, ok := c["variants"].(map[string]any); ok {
		for _, raw := range variants {
			rows = append(rows, raw.(map[string]any))
		}
	}
	for _, row := range rows {
		if bands, ok := row["bands"].([]any); ok {
			if len(bands) < 2 || !(float32(bands[0].(float64)) > 0) || bands[1].(float64) < 0 || bands[1].(float64) > 1 {
				return errColumn
			}
		}
		sections, _ := row["sections"].([]any)
		total := 0
		var prior float32
		for i, raw := range sections {
			s := raw.(map[string]any)
			start := float32(s["start"].(float64))
			if i > 0 && start <= prior {
				return errColumn
			}
			prior = start
			beds := s["beds"].([]any)
			total += len(beds)
			period := 0.
			for _, b := range beds {
				a := b.([]any)
				thick, hard, slot := a[0].(float64), a[1].(float64), a[2].(float64)
				if !(float32(thick) > 0) || hard < 0 || hard > 1 || math.Trunc(slot) != slot || slot < 0 || slot >= float64(slots) {
					return errColumn
				}
				period += thick
			}
			if !(float32(period) > 0) || math.IsInf(float64(float32(period)), 0) {
				return errColumn
			}
		}
		if len(sections) > ColumnSections || total > ColumnBeds {
			return errColumn
		}
	}
	return nil
}
