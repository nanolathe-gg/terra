package model

// Node is an authored stroke or terrain operation in a saved document.
type Node struct {
	Kind       string         `json:"kind"`
	Hidden     bool           `json:"hidden,omitempty"`
	Seed       uint32         `json:"seed,omitempty"`
	Points     []Point        `json:"points,omitempty"`
	Paths      [][]int        `json:"paths,omitempty"`
	Frame      []float64      `json:"frame,omitempty"`
	Params     map[string]any `json:"params,omitempty"`
	Factor     float64        `json:"factor,omitempty"`
	Amplitude  float64        `json:"amplitude,omitempty"`
	Wavelength float64        `json:"wavelength,omitempty"`
	Coverage   float64        `json:"coverage,omitempty"`
}
