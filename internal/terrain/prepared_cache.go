package terrain

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/nanolathe-gg/terraform/internal/model"
)

// Retain only one graph and cap its estimated storage. Oversized graphs still
// replay normally but cannot grow the persistent CPU cache without bound.
const preparedGraphLimit = 16 << 20

type preparedNode struct {
	key    []byte
	shapes []PreparedShape
}
type preparedGraph struct {
	geometry        []byte
	nodes           []preparedNode
	ops             []PreparedOp
	segments, masks []byte
}

func (s *ShapeEngine) prepareGraph(nodes []model.Node, c ShapeWindowConfig) ([]PreparedOp, []byte, []byte, error) {
	geometry, err := json.Marshal([]any{c.Grid, c.Spacing, c.RefSpacing, c.Defaults})
	if err != nil {
		return nil, nil, nil, err
	}
	old := s.prepared
	if old != nil && !bytes.Equal(old.geometry, geometry) {
		old = nil
	}
	next := &preparedGraph{geometry: geometry, nodes: make([]preparedNode, len(nodes))}
	same := old != nil && len(old.nodes) == len(nodes)
	estimate := len(geometry)
	var shapes []PreparedShape
	for i, node := range nodes {
		key, err := json.Marshal(node)
		if err != nil {
			return nil, nil, nil, fmt.Errorf("node %d: %w", i, err)
		}
		var prepared []PreparedShape
		if old != nil && i < len(old.nodes) && bytes.Equal(old.nodes[i].key, key) {
			prepared = old.nodes[i].shapes
		} else {
			same = false
			prepared, err = PrepareShapes(node, ShapeGeometry{Grid: c.Grid, Spacing: c.Spacing, RefSpacing: c.RefSpacing}, c.Defaults)
			if err != nil {
				return nil, nil, nil, fmt.Errorf("node %d: %w", i, err)
			}
		}
		next.nodes[i] = preparedNode{key: key, shapes: prepared}
		shapes = append(shapes, prepared...)
		estimate += len(key)
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
		next.ops, next.segments, next.masks = ops, segments, masks
		s.prepared = next
	} else {
		s.prepared = nil
	}
	return ops, segments, masks, nil
}
