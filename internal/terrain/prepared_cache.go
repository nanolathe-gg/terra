package terrain

import (
	"fmt"
	"reflect"

	"github.com/nanolathe-gg/terraform/internal/model"
)

// Retain only one graph and cap its estimated storage. Oversized graphs still
// replay normally but cannot grow the persistent CPU cache without bound.
const preparedGraphLimit = 16 << 20

type preparedNode struct {
	node   model.Node
	bytes  int
	shapes []PreparedShape
}
type preparedGraph struct {
	geometry        ShapeGeometry
	defaults        map[string]any
	nodes           []preparedNode
	ops             []PreparedOp
	segments, masks []byte
}

func (s *ShapeEngine) prepareGraph(nodes []model.Node, c ShapeWindowConfig) ([]PreparedOp, []byte, []byte, error) {
	geometry := ShapeGeometry{Grid: c.Grid, Spacing: c.Spacing, RefSpacing: c.RefSpacing}
	old := s.prepared
	if old != nil && (old.geometry != geometry || !reflect.DeepEqual(old.defaults, c.Defaults)) {
		old = nil
	}
	next := &preparedGraph{geometry: geometry, nodes: make([]preparedNode, len(nodes))}
	same := old != nil && len(old.nodes) == len(nodes)
	estimate := 1024
	var shapes []PreparedShape
	for i, node := range nodes {
		var prepared []PreparedShape
		var snapshot model.Node
		var nodeBytes int
		if old != nil && i < len(old.nodes) && reflect.DeepEqual(old.nodes[i].node, node) {
			prepared, snapshot, nodeBytes = old.nodes[i].shapes, old.nodes[i].node, old.nodes[i].bytes
		} else {
			same = false
			var err error
			prepared, err = PrepareShapes(node, geometry, c.Defaults)
			if err != nil {
				return nil, nil, nil, fmt.Errorf("node %d: %w", i, err)
			}
			snapshot = model.CloneNode(node)
			nodeBytes = estimateValue(reflect.ValueOf(snapshot))
		}
		next.nodes[i] = preparedNode{node: snapshot, shapes: prepared, bytes: nodeBytes}
		shapes = append(shapes, prepared...)
		estimate += nodeBytes
		for _, shape := range prepared {
			// Include backing arrays, per-operation maps, and conservative overhead.
			estimate += 2048 + len(shape.Segments)*256 + len(shape.Writes)*64 + len(shape.Extra)*64
		}
	}
	limit := int64(preparedGraphLimit)
	if c.Memory.Heap > 0 {
		limit = min(limit, c.Memory.Heap/32)
	}
	if same {
		estimate += len(old.segments) + len(old.masks) + len(old.ops)*2048
		if int64(estimate) > limit {
			s.prepared = nil
		}
		return old.ops, old.segments, old.masks, nil
	}
	ops, segments, masks := PackPreparedShapes(shapes)
	estimate += len(segments) + len(masks) + len(ops)*2048
	if int64(estimate) <= limit {
		if c.Defaults != nil {
			next.defaults = model.CloneValue(c.Defaults).(map[string]any)
		}
		next.ops, next.segments, next.masks = ops, segments, masks
		s.prepared = next
	} else {
		s.prepared = nil
	}
	return ops, segments, masks, nil
}

// Conservative estimate for the detached JSON-like node values.
func estimateValue(v reflect.Value) int {
	if !v.IsValid() {
		return 0
	}
	switch v.Kind() {
	case reflect.Interface, reflect.Pointer:
		if v.IsNil() {
			return 16
		}
		return 16 + estimateValue(v.Elem())
	case reflect.String:
		return 16 + v.Len()
	case reflect.Slice, reflect.Array:
		n := 32
		for i := 0; i < v.Len(); i++ {
			n += estimateValue(v.Index(i))
		}
		return n
	case reflect.Map:
		if v.IsNil() {
			return 16
		}
		n := 64
		it := v.MapRange()
		for it.Next() {
			n += 64 + estimateValue(it.Key()) + estimateValue(it.Value())
		}
		return n
	case reflect.Struct:
		n := 0
		for i := 0; i < v.NumField(); i++ {
			n += estimateValue(v.Field(i))
		}
		return n
	default:
		return int(v.Type().Size())
	}
}
