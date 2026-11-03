package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
)

const ColumnBeds = 32
const ColumnSections = 8

var DefaultBands = [2]float64{3.7, .5}

type ColumnSection struct {
	Start float64      `json:"start"`
	Beds  [][3]float64 `json:"beds"`
}
type ColumnRow struct {
	Sections []ColumnSection `json:"sections,omitempty"`
	Bands    []float64       `json:"bands,omitempty"`
}
type Column struct {
	ColumnRow
	Variants map[string]ColumnRow `json:"variants,omitempty"`
	Colors   [][]float64          `json:"colors,omitempty"`
}
type PackedColumn struct {
	Beds, Starts []Row
	Bands        [2]float32
}

func ColumnRows(column *Column, variant string) (PackedColumn, error) {
	out := PackedColumn{Bands: [2]float32{3.7, .5}}
	if column == nil {
		return out, nil
	}
	sections, bands := column.Sections, column.Bands
	if r, ok := column.Variants[variant]; ok {
		if r.Sections != nil {
			sections = r.Sections
		}
		if r.Bands != nil {
			bands = r.Bands
		}
	}
	if bands != nil {
		if len(bands) < 2 {
			return out, errors.New("invalid column bands")
		}
		out.Bands = [2]float32{float32(bands[0]), float32(bands[1])}
	}
	for _, s := range sections {
		first := len(out.Beds)
		period := 0.0
		for _, b := range s.Beds {
			period += b[0]
			out.Beds = append(out.Beds, row(b[0], clamp(b[1], 0, 1), b[2], 0))
		}
		out.Starts = append(out.Starts, row(s.Start, float64(first), float64(len(s.Beds)), period))
	}
	if len(out.Beds) > ColumnBeds || len(out.Starts) > ColumnSections {
		return out, errors.New("nanolathe: a rock column is too large for its uniforms")
	}
	return out, nil
}
func ColumnHasCapBed(column *Column, variant string) (bool, error) {
	r, e := ColumnRows(column, variant)
	if e != nil {
		return false, e
	}
	for _, s := range r.Starts {
		if s[2] == 2 {
			share := r.Beds[int(s[1])+1][0] / s[3]
			if math.Max(float64(share), 1-float64(share)) > .88 {
				return true, nil
			}
		}
	}
	return false, nil
}

// ColumnColorOverrides preserves explicit edited slot colors over palette
// choices, while an unchanged world column leaves those choices intact.
func ColumnColorOverrides(column, defaults any) map[string]any {
	out := map[string]any{}
	if column == nil || reflect.DeepEqual(column, defaults) {
		return out
	}
	b, e := json.Marshal(column)
	if e != nil {
		return out
	}
	var c Column
	if json.Unmarshal(b, &c) != nil {
		return out
	}
	for i, color := range c.Colors {
		if len(color) >= 3 {
			out[fmt.Sprint("strata", i+1)] = []float64{color[0] / 255, color[1] / 255, color[2] / 255}
		}
	}
	return out
}
