package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strings"
)

// Track omission separately from JSON null without changing the reusable
// climate catalogue. A supplied settings object replaces all climate fields.
type requestedSettings struct {
	Value   climate
	Present bool
}

func (s *requestedSettings) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return fmt.Errorf("settings must be a full climate object: %w", err)
	}
	for _, name := range []string{"minWind", "maxWind", "tidal", "solar", "gravity", "surfaceMetal", "mohoMetal", "lava"} {
		value, present := fields[name]
		if !present || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("settings.%s is required and must not be null", name)
		}
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(&s.Value); err != nil {
		return fmt.Errorf("settings: %w", err)
	}
	s.Present = true
	return nil
}

type requestedStarts struct {
	Values  []start
	Present bool
}

func (s *requestedStarts) UnmarshalJSON(data []byte) error {
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return fmt.Errorf("starts must be an array, not null; omit it for the fixed pair")
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(&s.Values); err != nil {
		return fmt.Errorf("starts: %w", err)
	}
	s.Present = true
	return nil
}

type featurePlacement struct {
	Name string `json:"name"`
	X    int    `json:"x"`
	Z    int    `json:"z"`
}

// OTA's integer fields are parsed into signed 32-bit words; SurfaceMetal is
// then stored as a byte [fmt ota] "Global keys" / "Schema keys". Tidal
// retains the editor's existing integer climate interface. This UI takes
// nonnegative authored values (including zero),
// avoiding the negative wind/gravity fallback and byte wrapping.
func validateSettings(c *climate) error {
	if c == nil {
		return nil
	}
	fields := []struct {
		name  string
		value int
	}{
		{"minWind", c.MinWind}, {"maxWind", c.MaxWind}, {"tidal", c.Tidal}, {"solar", c.Solar},
		{"gravity", c.Gravity}, {"surfaceMetal", c.SurfaceMetal}, {"mohoMetal", c.MohoMetal},
	}
	for _, f := range fields {
		if f.value < 0 || int64(f.value) > math.MaxInt32 {
			return fmt.Errorf("settings.%s must be a nonnegative signed-32-bit integer", f.name)
		}
	}
	if c.MinWind > c.MaxWind {
		return fmt.Errorf("settings.minWind must not exceed maxWind")
	}
	if c.SurfaceMetal > 255 {
		return fmt.Errorf("settings.surfaceMetal must fit the engine's byte store (0..255)")
	}
	return nil
}

func mapStarts(req exportRequest) ([]start, error) {
	pw, ph := req.UnitsX*512, req.UnitsY*512
	if !req.Starts.Present {
		// Phase-1 callers keep the old fixed pair and its one-unit margins.
		mx, mz := min(256, pw/4), min(256, ph/4)
		return []start{{mx, mz}, {pw - mx, ph - mz}}, nil
	}
	starts := req.Starts.Values
	if len(starts) < 1 || len(starts) > 10 {
		return nil, fmt.Errorf("starts must contain 1..10 pixel positions")
	}
	seen := map[start]bool{}
	for i, s := range starts {
		if s.X < 0 || s.Z < 0 || s.X >= pw || s.Z >= ph {
			return nil, fmt.Errorf("start %d (%d,%d) is outside the %dx%d pixel play area", i+1, s.X, s.Z, pw, ph)
		}
		if seen[s] {
			return nil, fmt.Errorf("duplicate start position (%d,%d)", s.X, s.Z)
		}
		seen[s] = true
	}
	return starts, nil
}

// Follow [fmt tnt] "Attribute map" / "Feature records": deterministic name
// table, top-left anchor index and 0xFFFE throughout the remaining footprint.
func encodeFeatures(req exportRequest, pack *packedFeatures) ([]string, []uint16, error) {
	if len(req.Features) == 0 {
		return nil, nil, nil
	}
	w, h := req.UnitsX*32+2, req.UnitsY*32+8
	cells := make([]uint16, w*h)
	for i := range cells {
		cells[i] = 0xFFFF
	}
	keys := []string{}
	for _, placed := range req.Features {
		key := featureKey(placed.Name)
		f, ok := pack.defs[key]
		if !ok {
			return nil, nil, fmt.Errorf("feature %q has no validated world definition", placed.Name)
		}
		if f.footprintX <= 0 || f.footprintZ <= 0 {
			return nil, nil, fmt.Errorf("feature %q has no positive footprint", placed.Name)
		}
		if placed.X < 0 || placed.Z < 0 || placed.X >= w-2 || placed.Z >= h-8 || f.footprintX > w-2-placed.X || f.footprintZ > h-8-placed.Z {
			return nil, nil, fmt.Errorf("feature %q footprint at (%d,%d) is outside the %dx%d cell play area", placed.Name, placed.X, placed.Z, w-2, h-8)
		}
		if f.name == "" || len(f.name) > 127 || strings.ContainsRune(f.name, 0) {
			return nil, nil, fmt.Errorf("feature %q does not fit a TNT record name", f.name)
		}
		keys = append(keys, key)
	}
	slices.Sort(keys)
	keys = slices.Compact(keys)
	if len(keys) > 0xFFFB {
		return nil, nil, fmt.Errorf("too many distinct feature names for TNT live record indices")
	}
	names := make([]string, len(keys))
	records := make(map[string]uint16, len(keys))
	for i, key := range keys {
		names[i] = pack.defs[key].name
		records[key] = uint16(i)
	}
	for _, placed := range req.Features {
		key := featureKey(placed.Name)
		f := pack.defs[key]
		for z := placed.Z; z < placed.Z+f.footprintZ; z++ {
			for x := placed.X; x < placed.X+f.footprintX; x++ {
				if cells[z*w+x] != 0xFFFF {
					return nil, nil, fmt.Errorf("feature %q at (%d,%d) overlaps another footprint at cell (%d,%d)", placed.Name, placed.X, placed.Z, x, z)
				}
				cells[z*w+x] = 0xFFFE
			}
		}
		cells[placed.Z*w+placed.X] = records[key]
	}
	return names, cells, nil
}
