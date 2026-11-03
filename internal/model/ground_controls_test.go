package model

import "testing"

func TestSetGroundKnobCreatesAndUpdatesStroke(t *testing.T) {
	nodes := []Node{{Kind: "hill"}}
	nodes, inserted := SetGroundKnob(nodes, "undulation", 8, 123)
	if !inserted || len(nodes) != 2 || nodes[0].Kind != "ground" || nodes[0].Seed != 123^0x9e37 || nodes[0].Amplitude != 8 || nodes[0].Wavelength != 160 || nodes[0].Coverage != .5 {
		t.Fatalf("created %+v", nodes)
	}
	nodes, inserted = SetGroundKnob(nodes, "undulationScale", 240, 123)
	if inserted || nodes[0].Wavelength != 240 {
		t.Fatalf("updated %+v", nodes)
	}
	nodes, _ = SetGroundKnob(nodes, "undulation", 0, 123)
	if nodes[0].Amplitude != 0 || len(nodes) != 2 {
		t.Fatalf("disabled %+v", nodes)
	}
	untouched, inserted := SetGroundKnob(nil, "undulationScale", 200, 123)
	if inserted || len(untouched) != 0 {
		t.Fatal("scale alone created ground")
	}
}
