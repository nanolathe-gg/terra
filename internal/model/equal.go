package model

import "reflect"

// NodeEqual and ValueEqual compare document values directly for common JSON
// representations. NaNs conservatively compare unequal, even in aliased slices.
func NodeEqual(a, b Node) bool {
	if a.Kind != b.Kind || a.Hidden != b.Hidden || a.Seed != b.Seed || a.Factor != b.Factor || a.Amplitude != b.Amplitude || a.Wavelength != b.Wavelength || a.Coverage != b.Coverage {
		return false
	}
	if (a.Points == nil) != (b.Points == nil) || len(a.Points) != len(b.Points) {
		return false
	}
	for i := range a.Points {
		if a.Points[i] != b.Points[i] {
			return false
		}
	}
	if (a.Paths == nil) != (b.Paths == nil) || len(a.Paths) != len(b.Paths) {
		return false
	}
	for i := range a.Paths {
		if !equalInts(a.Paths[i], b.Paths[i]) {
			return false
		}
	}
	if !equalFloats(a.Frame, b.Frame) {
		return false
	}
	return ValueEqual(a.Params, b.Params)
}
func NodesEqual(a, b []Node) bool {
	if (a == nil) != (b == nil) || len(a) != len(b) {
		return false
	}
	for i := range a {
		if !NodeEqual(a[i], b[i]) {
			return false
		}
	}
	return true
}
func equalInts(a, b []int) bool {
	if (a == nil) != (b == nil) || len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
func equalFloats(a, b []float64) bool {
	if (a == nil) != (b == nil) || len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
func ValueEqual(a, b any) bool {
	switch x := a.(type) {
	case nil:
		return b == nil
	case bool:
		y, ok := b.(bool)
		return ok && x == y
	case string:
		y, ok := b.(string)
		return ok && x == y
	case float64:
		y, ok := b.(float64)
		return ok && x == y
	case float32:
		y, ok := b.(float32)
		return ok && x == y
	case int:
		y, ok := b.(int)
		return ok && x == y
	case int64:
		y, ok := b.(int64)
		return ok && x == y
	case uint32:
		y, ok := b.(uint32)
		return ok && x == y
	case map[string]any:
		y, ok := b.(map[string]any)
		if !ok || (x == nil) != (y == nil) || len(x) != len(y) {
			return false
		}
		for k, v := range x {
			w, found := y[k]
			if !found || !ValueEqual(v, w) {
				return false
			}
		}
		return true
	case []any:
		y, ok := b.([]any)
		if !ok || (x == nil) != (y == nil) || len(x) != len(y) {
			return false
		}
		for i, v := range x {
			if !ValueEqual(v, y[i]) {
				return false
			}
		}
		return true
	case []float64:
		y, ok := b.([]float64)
		return ok && equalFloats(x, y)
	case []int:
		y, ok := b.([]int)
		return ok && equalInts(x, y)
	default:
		return reflect.DeepEqual(a, b)
	}
}
