package renderjob

import (
	"fmt"
	"github.com/nanolathe-gg/terraform/internal/model"
)

// GraphDelta replaces the suffix following Keep in a known immutable baseline.
type GraphDelta struct {
	Base     uint64       `json:"base"`
	Sequence uint64       `json:"sequence"`
	Keep     int          `json:"keep"`
	Tail     []model.Node `json:"tail,omitempty"`
	Nil      bool         `json:"nil,omitempty"`
}
type GraphEncoder struct {
	sequence uint64
	nodes    []model.Node
}
type GraphDecoder struct {
	sequence uint64
	nodes    []model.Node
}

func (e *GraphEncoder) Reset() { e.sequence = 0; e.nodes = nil }
func (d *GraphDecoder) Reset() { d.sequence = 0; d.nodes = nil }

// Encode snapshots only the changed suffix. The retained prefix is immutable.
func (e *GraphEncoder) Encode(nodes []model.Node) *GraphDelta {
	keep := 0
	for keep < len(e.nodes) && keep < len(nodes) && model.NodeEqual(e.nodes[keep], nodes[keep]) {
		keep++
	}
	delta := &GraphDelta{Base: e.sequence, Sequence: e.sequence + 1, Keep: keep, Tail: model.CloneNodes(nodes[keep:]), Nil: nodes == nil}
	next := make([]model.Node, keep, len(nodes))
	copy(next, e.nodes[:keep])
	next = append(next, delta.Tail...)
	if nodes == nil {
		next = nil
	}
	e.nodes = next
	e.sequence = delta.Sequence
	// Separate the transmitted nodes from the retained snapshot, so callers may
	// modify either the original graph or encoded request after encoding.
	delta.Tail = model.CloneNodes(delta.Tail)
	return delta
}

// Decode checks sequence before changing state. The returned graph is detached
// from the mutable wire payload and earlier jobs remain unchanged.
func (d *GraphDecoder) Decode(delta *GraphDelta) ([]model.Node, error) {
	if delta == nil {
		return nil, fmt.Errorf("missing graph delta")
	}
	if delta.Base != d.sequence || delta.Sequence != d.sequence+1 || delta.Keep < 0 || delta.Keep > len(d.nodes) {
		return nil, fmt.Errorf("graph delta out of sequence: base %d sequence %d, expected %d", delta.Base, delta.Sequence, d.sequence)
	}
	if delta.Nil && (delta.Keep != 0 || len(delta.Tail) != 0) {
		return nil, fmt.Errorf("invalid nil graph delta")
	}
	next := make([]model.Node, delta.Keep, delta.Keep+len(delta.Tail))
	copy(next, d.nodes[:delta.Keep])
	next = append(next, model.CloneNodes(delta.Tail)...)
	if delta.Nil {
		next = nil
	}
	d.nodes = next
	d.sequence = delta.Sequence
	return model.CloneNodes(next), nil
}
