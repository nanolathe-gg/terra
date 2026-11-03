package model

import (
	"reflect"
	"testing"
)

func TestCloneNodesDetachesNestedTypedValues(t *testing.T) {
	value := 3.0
	original := []Node{{Kind: "hill", Points: []Point{{1, 2}}, Paths: [][]int{{0}, nil}, Frame: []float64{1, 0, 0, 1, 0, 0}, Params: map[string]any{"nested": map[string]any{"floats": []float32{1, 2}, "array": [2][]int{{3}, {4}}, "pointer": &value}, "empty": []int{}, "nil": []float64(nil)}}}
	copied := CloneNodes(original)
	if !reflect.DeepEqual(original, copied) {
		t.Fatal("clone changed values or concrete types")
	}
	n := original[0].Params["nested"].(map[string]any)
	n["floats"].([]float32)[0] = 9
	n["array"].([2][]int)[0][0] = 9
	*n["pointer"].(*float64) = 9
	original[0].Points[0].X = 9
	original[0].Paths[0][0] = 9
	original[0].Frame[0] = 9
	c := copied[0].Params["nested"].(map[string]any)
	if c["floats"].([]float32)[0] != 1 || c["array"].([2][]int)[0][0] != 3 || *c["pointer"].(*float64) != 3 || copied[0].Points[0].X != 1 || copied[0].Paths[0][0] != 0 || copied[0].Frame[0] != 1 {
		t.Fatal("clone retained mutable aliases")
	}
	if CloneNodes(nil) != nil || CloneNodes([]Node{}) == nil || CloneNode(Node{Points: []Point{}}).Points == nil {
		t.Fatal("nil/empty distinction lost")
	}
}
