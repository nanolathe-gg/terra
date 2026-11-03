package model

// SetGroundKnob updates the ground stroke, creating it when undulation is first
// enabled. The returned boolean reports insertion at the start of the graph.
func SetGroundKnob(nodes []Node, key string, value, wavelength, coverage float64, seed uint32) ([]Node, bool) {
	if key != "undulation" && key != "undulationScale" && key != "undulationCover" {
		return nodes, false
	}
	for i := range nodes {
		if nodes[i].Kind == "ground" {
			switch key {
			case "undulation":
				nodes[i].Amplitude = value
			case "undulationScale":
				nodes[i].Wavelength = value
			case "undulationCover":
				nodes[i].Coverage = value
			}
			return nodes, false
		}
	}
	if key == "undulation" && value > 0 {
		ground := Node{Kind: "ground", Seed: seed ^ 0x9e37, Amplitude: value, Wavelength: wavelength, Coverage: coverage}
		return append([]Node{ground}, nodes...), true
	}
	return nodes, false
}

// GroundKnobs reflects document geometry after history restores a stroke graph.
// With no ground stroke the height is zero while the saved brush values remain.
func GroundKnobs(nodes []Node, wavelength, coverage float64) (float64, float64, float64) {
	for _, n := range nodes {
		if n.Kind == "ground" {
			return n.Amplitude, n.Wavelength, n.Coverage
		}
	}
	return 0, wavelength, coverage
}
