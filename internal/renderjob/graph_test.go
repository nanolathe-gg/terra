package renderjob

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/nanolathe-gg/terraform/internal/model"
)

func TestGraphDeltaRoundTripAndIsolation(t *testing.T) {
	var enc GraphEncoder
	var dec GraphDecoder
	a := []model.Node{{Kind: "hill", Params: map[string]any{"curve": []any{1., 2.}}}, {Kind: "crater", Points: []model.Point{{X: 1, Y: 2}}}}
	wire := enc.Encode(a)
	result, err := dec.Decode(wire)
	if err != nil || !model.NodesEqual(a, result) {
		t.Fatalf("first %v", err)
	}
	a[0].Params["curve"].([]any)[0] = 5.
	wire.Tail[1].Points[0].X = 9
	result[1].Points[0].X = 10
	a[1].Points[0].X = 3
	wire2 := enc.Encode(a)
	if wire2.Keep != 0 {
		t.Fatalf("changed prefix not detected: %+v", wire2)
	}
	result2, err := dec.Decode(wire2)
	if err != nil || !model.NodesEqual(a, result2) {
		t.Fatalf("second %v", err)
	}
	wire3 := enc.Encode(a)
	if wire3.Keep != len(a) || len(wire3.Tail) != 0 {
		t.Fatal("unchanged graph did not reuse prefix")
	}
	result2[0].Params["curve"].([]any)[0] = 19.
	result3, err := dec.Decode(wire3)
	if err != nil || !model.NodesEqual(a, result3) {
		t.Fatal("returned graph mutated decoder baseline")
	}
}
func TestGraphDeltaSequenceAndDroppedWork(t *testing.T) {
	var enc GraphEncoder
	var dec GraphDecoder
	var nodes []model.Node
	for i := 0; i < 8; i++ {
		nodes = append(nodes, model.Node{Kind: "hill", Seed: uint32(i)})
		d := enc.Encode(nodes)
		got, err := dec.Decode(d)
		if err != nil || !reflect.DeepEqual(nodes, got) {
			t.Fatalf("delta %d: %v", i, err)
		}
	}
	// A queue may discard jobs after receipt; reconstruction must already have advanced.
	stale := &GraphDelta{Base: 1, Sequence: 2}
	if _, err := dec.Decode(stale); err == nil {
		t.Fatal("accepted stale baseline")
	}
	got, err := dec.Decode(enc.Encode(nodes))
	if err != nil || !reflect.DeepEqual(nodes, got) {
		t.Fatal("error corrupted baseline")
	}
	enc.Reset()
	dec.Reset()
	nilGraph, err := dec.Decode(enc.Encode(nil))
	if err != nil || nilGraph != nil {
		t.Fatal("nil graph not preserved")
	}
	empty, err := dec.Decode(enc.Encode([]model.Node{}))
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatal("empty graph not preserved")
	}
}
func BenchmarkGraphDelta(b *testing.B) {
	nodes := make([]model.Node, 100)
	for i := range nodes {
		nodes[i] = model.Node{Kind: "hill", Seed: uint32(i), Params: map[string]any{"radius": 100., "curve": []any{1., 2., 3.}}}
	}
	b.Run("full-json", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if _, err := json.Marshal(nodes); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("delta-json", func(b *testing.B) {
		var e GraphEncoder
		e.Encode(nodes)
		for i := 0; i < b.N; i++ {
			if _, err := json.Marshal(e.Encode(nodes)); err != nil {
				b.Fatal(err)
			}
		}
	})
}

func TestGraphDeltaWireSize(t *testing.T) {
	nodes := make([]model.Node, 100)
	for i := range nodes {
		nodes[i] = model.Node{Kind: "hill", Seed: uint32(i), Params: map[string]any{"radius": 100., "curve": []any{1., 2., 3.}}}
	}
	full, err := json.Marshal(nodes)
	if err != nil {
		t.Fatal(err)
	}
	var e GraphEncoder
	e.Encode(nodes)
	delta, err := json.Marshal(e.Encode(nodes))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("100-node full graph %d bytes; unchanged delta %d bytes", len(full), len(delta))
	if len(delta)*10 >= len(full) {
		t.Fatal("unchanged graph did not substantially reduce wire payload")
	}
}
