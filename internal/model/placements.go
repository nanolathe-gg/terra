package model

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// PlacementStore holds the feature and start state serialized with a map.
type PlacementStore struct {
	Cols, Rows  int
	Definitions map[string]FeatureDefinition
	DepositName string
	Features    []FeaturePlacement
	Starts      []FeaturePoint
	Generated   map[string]bool
	Margin      float64
}

func NewPlacementStore(cols, rows int, defs []FeatureDefinition, deposit string) *PlacementStore {
	p := &PlacementStore{Cols: cols, Rows: rows, Definitions: map[string]FeatureDefinition{}, DepositName: deposit, Generated: map[string]bool{}, Margin: 96}
	for _, d := range defs {
		p.Definitions[strings.ToLower(d.Name)] = d
	}
	mx, mz := 256., 256.
	if cols == 32 {
		mx = 128
	}
	if rows == 32 {
		mz = 128
	}
	p.Starts = []FeaturePoint{{mx, mz}, {float64(cols*16) - mx, float64(rows*16) - mz}}
	return p
}
func (s *PlacementStore) def(name string) (FeatureDefinition, bool) {
	v, ok := s.Definitions[strings.ToLower(name)]
	return v, ok
}
func (s *PlacementStore) inside(p FeaturePlacement, d FeatureDefinition) bool {
	return p.X >= 0 && p.Z >= 0 && d.FootprintX > 0 && d.FootprintZ > 0 && p.X+d.FootprintX <= s.Cols && p.Z+d.FootprintZ <= s.Rows
}
func featureOverlap(a FeaturePlacement, ad FeatureDefinition, b FeaturePlacement, bd FeatureDefinition, gap int) bool {
	return a.X < b.X+bd.FootprintX+gap && a.X+ad.FootprintX+gap > b.X && a.Z < b.Z+bd.FootprintZ+gap && a.Z+ad.FootprintZ+gap > b.Z
}
func (s *PlacementStore) isDeposit(d FeatureDefinition) bool {
	return d.Kind == "deposit" || strings.EqualFold(d.Name, s.DepositName)
}
func (s *PlacementStore) near(p FeaturePlacement, d FeatureDefinition, q FeaturePlacement, qd FeatureDefinition) bool {
	x0, z0, x1, z1 := float64(p.X*16), float64(p.Z*16), float64((p.X+d.FootprintX)*16), float64((p.Z+d.FootprintZ)*16)
	a, b, c, e := float64(q.X*16), float64(q.Z*16), float64((q.X+qd.FootprintX)*16), float64((q.Z+qd.FootprintZ)*16)
	return math.Hypot(math.Max(math.Max(x0-c, a-x1), 0), math.Max(math.Max(z0-e, b-z1), 0)) < s.Margin
}
func (s *PlacementStore) trimGenerated() int {
	removed := 0
	original := append([]FeaturePlacement(nil), s.Features...)
	kept := s.Features[:0]
	for _, p := range original {
		d, _ := s.def(p.Name)
		drop := false
		if s.Generated[featureKey(p)] {
			x0, z0, x1, z1 := float64(p.X*16), float64(p.Z*16), float64((p.X+d.FootprintX)*16), float64((p.Z+d.FootprintZ)*16)
			for _, start := range s.Starts {
				if math.Hypot(math.Max(math.Max(x0-start.X, 0), start.X-x1), math.Max(math.Max(z0-start.Z, 0), start.Z-z1)) < s.Margin {
					drop = true
					break
				}
			}
			for _, q := range original {
				qd, _ := s.def(q.Name)
				if s.isDeposit(qd) && s.near(p, d, q, qd) {
					drop = true
					break
				}
			}
		}
		if drop {
			delete(s.Generated, featureKey(p))
			removed++
		} else {
			kept = append(kept, p)
		}
	}
	s.Features = kept
	return removed
}
func (s *PlacementStore) Add(name string, x, z int) (int, error) {
	d, ok := s.def(name)
	if !ok {
		return 0, fmt.Errorf("Choose an available feature from this world.")
	}
	p := FeaturePlacement{d.Name, x, z}
	if !s.inside(p, d) {
		return 0, fmt.Errorf("The whole feature footprint must fit inside the play area.")
	}
	for _, q := range s.Features {
		qd, _ := s.def(q.Name)
		if s.isDeposit(d) && s.Generated[featureKey(q)] && s.near(p, d, q, qd) {
			continue
		}
		if featureOverlap(p, d, q, qd, 0) {
			return 0, fmt.Errorf("That footprint overlaps another feature.")
		}
	}
	s.Features = append(s.Features, p)
	removed := 0
	if s.isDeposit(d) {
		removed = s.trimGenerated()
	}
	return removed, nil
}
func (s *PlacementStore) Remove(index int) error {
	if index < 0 || index >= len(s.Features) {
		return fmt.Errorf("Feature index is out of range.")
	}
	delete(s.Generated, featureKey(s.Features[index]))
	s.Features = append(s.Features[:index], s.Features[index+1:]...)
	return nil
}
func (s *PlacementStore) validStart(p FeaturePoint, index int) error {
	if p.X != math.Round(p.X) || p.Z != math.Round(p.Z) || p.X < 0 || p.Z < 0 || p.X >= float64(s.Cols*16) || p.Z >= float64(s.Rows*16) {
		return fmt.Errorf("A start must lie inside the play area.")
	}
	for i, v := range s.Starts {
		if i != index && p == v {
			return fmt.Errorf("Another start is already at that position.")
		}
	}
	return nil
}
func (s *PlacementStore) AddStart(p FeaturePoint) (int, error) {
	p.X = math.Round(p.X)
	p.Z = math.Round(p.Z)
	if len(s.Starts) >= 10 {
		return 0, fmt.Errorf("A map can have at most 10 starts.")
	}
	if e := s.validStart(p, -1); e != nil {
		return 0, e
	}
	s.Starts = append(s.Starts, p)
	return s.trimGenerated(), nil
}
func (s *PlacementStore) MoveStart(index int, p FeaturePoint) (int, error) {
	if index < 0 || index >= len(s.Starts) {
		return 0, fmt.Errorf("Start index is out of range.")
	}
	p.X = math.Round(p.X)
	p.Z = math.Round(p.Z)
	if e := s.validStart(p, index); e != nil {
		return 0, e
	}
	s.Starts[index] = p
	return s.trimGenerated(), nil
}
func (s *PlacementStore) RemoveStart(index int) error {
	if index < 0 || index >= len(s.Starts) || len(s.Starts) <= 1 {
		return fmt.Errorf("Keep at least one start position.")
	}
	s.Starts = append(s.Starts[:index], s.Starts[index+1:]...)
	return nil
}
func (s *PlacementStore) SortedFeatures() []FeaturePlacement {
	out := append([]FeaturePlacement{}, s.Features...)
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		return a.Z < b.Z || a.Z == b.Z && (a.X < b.X || a.X == b.X && a.Name < b.Name)
	})
	return out
}
