// Package renderjob is the message contract between the UI and terrain worker.
package renderjob

import "github.com/nanolathe-gg/terraform/internal/model"

type Tile struct {
	Key                 string `json:"key"`
	X, Y, Width, Height int
	Scale               float64
}
type FillRequest struct {
	Cols, Rows  int
	Sea         float64
	Definitions []model.FeatureDefinition
	Existing    []model.FeaturePlacement
	Starts      []model.FeaturePoint
	DepositName string
	Region      model.FeatureRegion
	Settings    model.FeatureFill
}
type Request struct {
	SentAt      float64           `json:"sentAt,omitempty"`
	ReceivedAt  float64           `json:"-"`
	RPC         bool              `json:"rpc,omitempty"`
	Session     int               `json:"session"`
	Revision    int               `json:"revision"`
	Interactive bool              `json:"interactive"`
	Kind        string            `json:"kind"`
	ID          int               `json:"id"`
	Config      map[string]any    `json:"config"`
	Nodes       []model.Node      `json:"nodes,omitempty"`
	Graph       *GraphDelta       `json:"graph,omitempty"`
	Knobs       map[string]string `json:"knobs"`
	Colors      map[string]any    `json:"colors"`
	Options     map[string]any    `json:"options"`
	Tiles       []Tile            `json:"tiles"`
	HeightTiles []Tile            `json:"heightTiles,omitempty"`
	Points      []model.Point     `json:"points,omitempty"`
	Fill        *FillRequest      `json:"fill,omitempty"`
}
