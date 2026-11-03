package model

import (
	"reflect"
	"testing"
)

func TestValueEqualMatchesDeepEqual(t *testing.T) {
	samples := []any{nil, true, "x", float64(1), float32(1), int(1), int64(1), uint32(1), []int(nil), []int{}, []int{1}, []float64(nil), []float64{}, []float64{1}, []any(nil), []any{float64(1), map[string]any{"v": []int{2}}}, map[string]any(nil), map[string]any{}, map[string]any{"x": []any{1., nil}}, [2][]int{{1}, nil}, map[string][]float32{"x": {1, 2}}}
	for _, a := range samples {
		for _, b := range samples {
			if got, want := ValueEqual(a, b), reflect.DeepEqual(a, b); got != want {
				t.Fatalf("ValueEqual(%#v,%#v)=%v want %v", a, b, got, want)
			}
		}
	}
}
func TestNodeEqualMatchesDeepEqual(t *testing.T) {
	a := Node{Kind: "hill", Points: []Point{{1, 2}}, Paths: [][]int{{0}, nil}, Frame: []float64{1, 0}, Params: map[string]any{"x": []any{1., "a"}}}
	variants := []Node{a, CloneNode(a), {}, {Kind: "hill", Points: []Point{}}, {Kind: "hill", Params: map[string]any{}}}
	for _, x := range variants {
		for _, y := range variants {
			if got, want := NodeEqual(x, y), reflect.DeepEqual(x, y); got != want {
				t.Fatalf("%#v vs %#v got %v want %v", x, y, got, want)
			}
		}
	}
}
