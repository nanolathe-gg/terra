package model

import (
	"errors"
	"math"
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
