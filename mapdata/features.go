// Package mapdata holds the editor tools' feature catalogue interchange.
package mapdata

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
)

type Sprite struct {
	URL     string `json:"url"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	XOffset int    `json:"xOffset"`
	YOffset int    `json:"yOffset"`
}

type Feature struct {
	Name           string  `json:"name"`
	FootprintX     int     `json:"footprintX"`
	FootprintZ     int     `json:"footprintZ"`
	Metal          int     `json:"metal"`
	Energy         int     `json:"energy"`
	Blocking       bool    `json:"blocking"`
	Reclaimable    bool    `json:"reclaimable"`
	Indestructible bool    `json:"indestructible"`
	Uses           int     `json:"uses"`
	Kind           string  `json:"kind"`
	Sprite         Sprite  `json:"sprite"`
	Shadow         *Sprite `json:"shadow"`
	AnimTrans      int     `json:"animTrans"`
	ShadTrans      int     `json:"shadTrans"`
}

type FeatureCatalog struct {
	World       string    `json:"world"`
	Planet      string    `json:"planet"`
	DepositName string    `json:"depositName"`
	Features    []Feature `json:"features"`
}

// ReadJSON bounds local interchange files independently of retail formats.
func ReadJSON(name string, dst any) error {
	f, err := os.Open(name)
	if err != nil {
		return err
	}
	defer f.Close()
	d := json.NewDecoder(io.LimitReader(f, 16<<20))
	if err := d.Decode(dst); err != nil {
		return fmt.Errorf("read %s: %w", name, err)
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return fmt.Errorf("read %s: expected one JSON object", name)
	}
	return nil
}
