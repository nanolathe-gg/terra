package model

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

const FeatureCell = 16

type FeaturePoint struct {
	X float64 `json:"x"`
	Z float64 `json:"z"`
}
type FeaturePlacement struct {
	Name string `json:"name"`
	X    int    `json:"x"`
	Z    int    `json:"z"`
}
type FeatureDefinition struct {
	Name, Kind                   string
	FootprintX, FootprintZ, Uses int
}
type FeatureRegion struct {
	RadiusSet    bool
	Type         string
	Points       []FeaturePoint
	X, Z, Radius float64
}
type FeatureFill struct {
	Kind                string
	Density, Clustering float64
	Gap                 int
	Seed                uint32
	Margin, Radius      float64
}
type FeatureBounds struct{ X0, Z0, X1, Z1 int }

func FeatureRegionBounds(r FeatureRegion, cols, rows int, radius float64) (FeatureBounds, error) {
	if r.Type == "flood" {
		return FeatureBounds{0, 0, cols, rows}, nil
	}
	if r.Type != "brush" && r.Type != "lasso" {
		return FeatureBounds{}, fmt.Errorf("Choose a brush, lasso or flood region.")
	}
	if len(r.Points) == 0 {
		return FeatureBounds{}, nil
	}
	x0, z0, x1, z1 := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for _, p := range r.Points {
		if math.IsNaN(p.X) || math.IsInf(p.X, 0) || math.IsNaN(p.Z) || math.IsInf(p.Z, 0) {
			return FeatureBounds{}, fmt.Errorf("The fill region contains an invalid point.")
		}
		x0 = math.Min(x0, p.X)
		z0 = math.Min(z0, p.Z)
		x1 = math.Max(x1, p.X)
		z1 = math.Max(z1, p.Z)
	}
	reach := 0.
	if r.Type == "brush" {
		reach = radius
		if r.RadiusSet || r.Radius > 0 {
			reach = math.Max(0, r.Radius)
		}
	}
	bound := func(v float64, maxi int) int { return max(0, min(int(v), maxi)) }
	return FeatureBounds{bound(math.Floor((x0-reach)/16), cols), bound(math.Floor((z0-reach)/16), rows), bound(math.Ceil((x1+reach)/16)+1, cols), bound(math.Ceil((z1+reach)/16)+1, rows)}, nil
}
func featureHash(x, z int, seed uint32) float64 {
	n := uint32(x)*374761393 ^ uint32(z)*668265263 ^ seed
	n = (n ^ (n >> 13)) * 1274126177
	return float64(n^(n>>16)) / 4294967296
}
func featureNoise(x, z float64, seed uint32) float64 {
	ix, iz := int(math.Floor(x)), int(math.Floor(z))
	fx, fz := x-float64(ix), z-float64(iz)
	sx, sz := fx*fx*(3-2*fx), fz*fz*(3-2*fz)
	return (featureHash(ix, iz, seed)*(1-sx)+featureHash(ix+1, iz, seed)*sx)*(1-sz) + (featureHash(ix, iz+1, seed)*(1-sx)+featureHash(ix+1, iz+1, seed)*sx)*sz
}
func featureSegment(p, a, b FeaturePoint) float64 {
	dx, dz := b.X-a.X, b.Z-a.Z
	den := dx*dx + dz*dz
	if den == 0 {
		den = 1
	}
	t := math.Max(0, math.Min(1, ((p.X-a.X)*dx+(p.Z-a.Z)*dz)/den))
	return math.Hypot(p.X-a.X-dx*t, p.Z-a.Z-dz*t)
}
func featureInside(p FeaturePoint, points []FeaturePoint) bool {
	inside := false
	for i, j := 0, len(points)-1; i < len(points); j, i = i, i+1 {
		a, b := points[i], points[j]
		if featureSegment(p, a, b) < 1e-6 {
			return true
		}
		if (a.Z > p.Z) != (b.Z > p.Z) && p.X < (b.X-a.X)*(p.Z-a.Z)/(b.Z-a.Z)+a.X {
			inside = !inside
		}
	}
	return inside
}
func featureKey(p FeaturePlacement) string {
	return fmt.Sprintf("%s@%d,%d", strings.ToLower(p.Name), p.X, p.Z)
}

// FillFeatures mirrors the editor's deterministic candidate ranking and checks
// every cell in a feature footprint against dry, gentle terrain and the region.
func FillFeatures(cols, rows int, sea float64, sample func(x, z float64) float64, defs []FeatureDefinition, existing []FeaturePlacement, starts []FeaturePoint, depositName string, r FeatureRegion, f FeatureFill) ([]FeaturePlacement, error) {
	return FillFeaturesYield(cols, rows, sea, sample, defs, existing, starts, depositName, r, f, nil)
}

// FillFeaturesYield allows a worker to yield and cancel during large fills.
func FillFeaturesYield(cols, rows int, sea float64, sample func(x, z float64) float64, defs []FeatureDefinition, existing []FeaturePlacement, starts []FeaturePoint, depositName string, r FeatureRegion, f FeatureFill, yield func() error) ([]FeaturePlacement, error) {
	check := func() error {
		if yield != nil {
			return yield()
		}
		return nil
	}
	b, e := FeatureRegionBounds(r, cols, rows, f.Radius)
	if e != nil {
		return nil, e
	}
	defsByName := map[string]FeatureDefinition{}
	mix := []FeatureDefinition{}
	total := 0
	for _, d := range defs {
		defsByName[strings.ToLower(d.Name)] = d
		if d.Kind == f.Kind {
			mix = append(mix, d)
			total += max(1, d.Uses)
		}
	}
	if len(mix) == 0 {
		return nil, nil
	}
	gentle := make([]bool, cols*rows)
	corner := func(x, z int) float64 {
		v := sample(float64(x*16), float64(z*16))
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return -1
		}
		return math.Round(math.Max(0, math.Min(255, v)))
	}
	for z := b.Z0; z < b.Z1; z++ {
		if z%32 == 0 {
			if err := check(); err != nil {
				return nil, err
			}
		}
		for x := b.X0; x < b.X1; x++ {
			a, c, d, e := corner(x, z), corner(x+1, z), corner(x, z+1), corner(x+1, z+1)
			lo := math.Min(math.Min(a, c), math.Min(d, e))
			hi := math.Max(math.Max(a, c), math.Max(d, e))
			gentle[z*cols+x] = lo > sea && hi-lo <= 10
		}
	}
	area := make([]bool, cols*rows)
	if r.Type == "flood" {
		x, z := int(math.Floor(r.X/16)), int(math.Floor(r.Z/16))
		if x >= 0 && z >= 0 && x < cols && z < rows && gentle[z*cols+x] {
			todo := []int{z*cols + x}
			area[todo[0]] = true
			for i := 0; i < len(todo); i++ {
				if i%8192 == 0 {
					if err := check(); err != nil {
						return nil, err
					}
				}
				p := todo[i]
				x, z = p%cols, p/cols
				for _, n := range [][2]int{{x - 1, z}, {x + 1, z}, {x, z - 1}, {x, z + 1}} {
					nx, nz := n[0], n[1]
					if nx >= 0 && nz >= 0 && nx < cols && nz < rows {
						k := nz*cols + nx
						if gentle[k] && !area[k] {
							area[k] = true
							todo = append(todo, k)
						}
					}
				}
			}
		}
	} else if !(r.Type == "lasso" && len(r.Points) < 3 || r.Type == "brush" && len(r.Points) == 0) {
		radius := f.Radius
		if r.RadiusSet || r.Radius > 0 {
			radius = math.Max(0, r.Radius)
		}
		for z := b.Z0; z < b.Z1; z++ {
			if z%32 == 0 {
				if err := check(); err != nil {
					return nil, err
				}
			}
			for x := b.X0; x < b.X1; x++ {
				p := FeaturePoint{float64(x*16 + 8), float64(z*16 + 8)}
				if r.Type == "lasso" {
					area[z*cols+x] = featureInside(p, r.Points)
				} else {
					for i, q := range r.Points {
						if math.Hypot(p.X-q.X, p.Z-q.Z) <= radius || i > 0 && featureSegment(p, r.Points[i-1], q) <= radius {
							area[z*cols+x] = true
							break
						}
					}
				}
			}
		}
	}
	type candidate struct {
		x, z int
		rank float64
	}
	candidates := []candidate{}
	for z := b.Z0; z < b.Z1; z++ {
		if z%32 == 0 {
			if err := check(); err != nil {
				return nil, err
			}
		}
		for x := b.X0; x < b.X1; x++ {
			if !area[z*cols+x] {
				continue
			}
			cluster := math.Max(0, math.Min(1, (featureNoise(float64(x)/12, float64(z)/12, f.Seed^0x713c6a91)-.25)*2))
			prob := f.Density / 100 * (1 - f.Clustering + f.Clustering*cluster*2)
			if featureHash(x, z, f.Seed^0x517ad0f3) < prob {
				candidates = append(candidates, candidate{x, z, featureHash(x, z, f.Seed^0x34da72f1)})
			}
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		return a.rank < b.rank || a.rank == b.rank && (a.z < b.z || a.z == b.z && a.x < b.x)
	})
	occupied := make([]bool, cols*rows)
	for _, p := range existing {
		d := defsByName[strings.ToLower(p.Name)]
		for z := max(0, p.Z); z < min(rows, p.Z+d.FootprintZ); z++ {
			for x := max(0, p.X); x < min(cols, p.X+d.FootprintX); x++ {
				occupied[z*cols+x] = true
			}
		}
	}
	out := []FeaturePlacement{}
	for i, p := range candidates {
		if i%8192 == 0 {
			if err := check(); err != nil {
				return nil, err
			}
		}
		ticket := featureHash(p.x, p.z, f.Seed^0x25cd781b) * float64(total)
		d := mix[len(mix)-1]
		for _, v := range mix {
			ticket -= float64(max(1, v.Uses))
			if ticket < 0 {
				d = v
				break
			}
		}
		if d.FootprintX < 1 || d.FootprintZ < 1 || p.x+d.FootprintX > cols || p.z+d.FootprintZ > rows {
			continue
		}
		x0, z0, x1, z1 := float64(p.x*16), float64(p.z*16), float64((p.x+d.FootprintX)*16), float64((p.z+d.FootprintZ)*16)
		near := false
		for _, s := range starts {
			if math.Hypot(math.Max(math.Max(x0-s.X, 0), s.X-x1), math.Max(math.Max(z0-s.Z, 0), s.Z-z1)) < f.Margin {
				near = true
				break
			}
		}
		for _, q := range existing {
			qd := defsByName[strings.ToLower(q.Name)]
			if qd.Kind != "deposit" && !strings.EqualFold(qd.Name, depositName) {
				continue
			}
			qx0, qz0, qx1, qz1 := float64(q.X*16), float64(q.Z*16), float64((q.X+qd.FootprintX)*16), float64((q.Z+qd.FootprintZ)*16)
			if math.Hypot(math.Max(math.Max(x0-qx1, qx0-x1), 0), math.Max(math.Max(z0-qz1, qz0-z1), 0)) < f.Margin {
				near = true
				break
			}
		}
		if near {
			continue
		}
		free := true
		for z := p.z; z < p.z+d.FootprintZ && free; z++ {
			for x := p.x; x < p.x+d.FootprintX; x++ {
				if !area[z*cols+x] || !gentle[z*cols+x] {
					free = false
					break
				}
			}
		}
		for z := max(0, p.z-f.Gap); z < min(rows, p.z+d.FootprintZ+f.Gap) && free; z++ {
			for x := max(0, p.x-f.Gap); x < min(cols, p.x+d.FootprintX+f.Gap); x++ {
				if occupied[z*cols+x] {
					free = false
					break
				}
			}
		}
		if !free {
			continue
		}
		out = append(out, FeaturePlacement{d.Name, p.x, p.z})
		for z := p.z; z < p.z+d.FootprintZ; z++ {
			for x := p.x; x < p.x+d.FootprintX; x++ {
				occupied[z*cols+x] = true
			}
		}
	}
	return out, nil
}
