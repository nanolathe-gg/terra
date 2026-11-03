package terrain

import (
	"bytes"
	"testing"

	"github.com/nanolathe-gg/terraform/internal/model"
)

func TestPreparedGraphReuseAndInvalidation(t *testing.T) {
	s := &ShapeEngine{}
	c := ShapeWindowConfig{Grid: 1025, Spacing: 16, RefSpacing: 16, Defaults: map[string]any{}}
	nodes := []model.Node{shapeNode("hill", 300, 300, 90, 20), shapeNode("crater", 900, 900, 90, 20)}
	ops, segments, masks, err := s.prepareGraph(nodes, c)
	if err != nil {
		t.Fatal(err)
	}
	initial := s.prepared
	if initial == nil {
		t.Fatal("small graph not cached")
	}
	ops2, segments2, masks2, err := s.prepareGraph(nodes, c)
	if err != nil || s.prepared != initial || !bytes.Equal(segments, segments2) || !bytes.Equal(masks, masks2) || len(ops) != len(ops2) {
		t.Fatalf("unchanged graph not reused: %v", err)
	}
	nodes[1] = shapeNode("crater", 1000, 900, 90, 20)
	_, _, _, err = s.prepareGraph(nodes, c)
	if err != nil {
		t.Fatal(err)
	}
	if s.prepared == initial || &s.prepared.nodes[0].shapes[0] != &initial.nodes[0].shapes[0] || &s.prepared.nodes[1].shapes[0] == &initial.nodes[1].shapes[0] {
		t.Fatal("edit did not preserve only unchanged preparation")
	}
	previous := s.prepared
	nodes[0].Params["amount"] = 123.0
	_, _, _, err = s.prepareGraph(nodes, c)
	if err != nil || s.prepared == previous || &s.prepared.nodes[0].shapes[0] == &previous.nodes[0].shapes[0] {
		t.Fatalf("in-place parameter edit was missed: %v", err)
	}
	previous = s.prepared
	c.Spacing = 8
	_, _, _, err = s.prepareGraph(nodes, c)
	if err != nil || s.prepared == previous || &s.prepared.nodes[0].shapes[0] == &previous.nodes[0].shapes[0] {
		t.Fatalf("geometry change retained old preparation: %v", err)
	}
}

func BenchmarkPreparedGraph(b *testing.B) {
	c := ShapeWindowConfig{Grid: 1025, Spacing: 16, RefSpacing: 16, Defaults: map[string]any{}}
	nodes := make([]model.Node, 30)
	for i := range nodes {
		nodes[i] = shapeNode("hill", float64(100+i*100), float64(200+i*100), 90, 20)
	}
	for _, reuse := range []bool{false, true} {
		name := "fresh"
		if reuse {
			name = "cached"
		}
		b.Run(name, func(b *testing.B) {
			s := &ShapeEngine{}
			for i := 0; i < b.N; i++ {
				if !reuse {
					s.prepared = nil
				}
				if _, _, _, err := s.prepareGraph(nodes, c); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
