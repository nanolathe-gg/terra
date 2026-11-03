package model

import "reflect"

// CloneNode snapshots a document node, including nested parameter maps, slices,
// arrays and pointers. Document parameters are acyclic JSON-like values.
func CloneNode(n Node) Node {
	if n.Points != nil {
		n.Points = append([]Point{}, n.Points...)
	}
	if n.Paths != nil {
		paths := make([][]int, len(n.Paths))
		for i, p := range n.Paths {
			if p != nil {
				paths[i] = append([]int{}, p...)
			}
		}
		n.Paths = paths
	}
	if n.Frame != nil {
		n.Frame = append([]float64{}, n.Frame...)
	}
	if n.Params != nil {
		n.Params = CloneValue(n.Params).(map[string]any)
	}
	return n
}
func CloneNodes(nodes []Node) []Node {
	if nodes == nil {
		return nil
	}
	out := make([]Node, len(nodes))
	for i, n := range nodes {
		out[i] = CloneNode(n)
	}
	return out
}

// CloneValue preserves concrete parameter types while detaching mutable data.
func CloneValue(v any) any {
	switch x := v.(type) {
	case nil, bool, string, float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return v
	case map[string]any:
		if x == nil {
			return x
		}
		out := make(map[string]any, len(x))
		for k, v := range x {
			out[k] = CloneValue(v)
		}
		return out
	case []any:
		if x == nil {
			return x
		}
		out := make([]any, len(x))
		for i, v := range x {
			out[i] = CloneValue(v)
		}
		return out
	case []float64:
		if x == nil {
			return x
		}
		return append([]float64{}, x...)
	case []float32:
		if x == nil {
			return x
		}
		return append([]float32{}, x...)
	case []int:
		if x == nil {
			return x
		}
		return append([]int{}, x...)
	default:
		return cloneValue(reflect.ValueOf(v)).Interface()
	}
}
func cloneValue(v reflect.Value) reflect.Value {
	switch v.Kind() {
	case reflect.Interface:
		if v.IsNil() {
			return reflect.Zero(v.Type())
		}
		out := reflect.New(v.Type()).Elem()
		out.Set(cloneValue(v.Elem()))
		return out
	case reflect.Pointer:
		if v.IsNil() {
			return reflect.Zero(v.Type())
		}
		out := reflect.New(v.Type().Elem())
		out.Elem().Set(cloneValue(v.Elem()))
		return out
	case reflect.Map:
		if v.IsNil() {
			return reflect.Zero(v.Type())
		}
		out := reflect.MakeMapWithSize(v.Type(), v.Len())
		it := v.MapRange()
		for it.Next() {
			out.SetMapIndex(it.Key(), cloneValue(it.Value()))
		}
		return out
	case reflect.Slice:
		if v.IsNil() {
			return reflect.Zero(v.Type())
		}
		out := reflect.MakeSlice(v.Type(), v.Len(), v.Len())
		for i := 0; i < v.Len(); i++ {
			out.Index(i).Set(cloneValue(v.Index(i)))
		}
		return out
	case reflect.Array:
		out := reflect.New(v.Type()).Elem()
		for i := 0; i < v.Len(); i++ {
			out.Index(i).Set(cloneValue(v.Index(i)))
		}
		return out
	case reflect.Struct:
		out := reflect.New(v.Type()).Elem()
		out.Set(v)
		for i := 0; i < v.NumField(); i++ {
			if out.Field(i).CanSet() && v.Type().Field(i).IsExported() {
				out.Field(i).Set(cloneValue(v.Field(i)))
			}
		}
		return out
	default:
		return v
	}
}
