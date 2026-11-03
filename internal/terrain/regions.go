package terrain

// CellRect describes inclusive cell coordinates.
type CellRect struct{ X0, Y0, X1, Y1 int }

func intersect(a, b CellRect) (CellRect, bool) {
	r := CellRect{max(a.X0, b.X0), max(a.Y0, b.Y0), min(a.X1, b.X1), min(a.Y1, b.Y1)}
	return r, r.X0 <= r.X1 && r.Y0 <= r.Y1
}
func expand(r CellRect, n int, whole CellRect) CellRect {
	v, _ := intersect(CellRect{r.X0 - n, r.Y0 - n, r.X1 + n, r.Y1 + n}, whole)
	return v
}
func union(a, b CellRect) CellRect {
	return CellRect{min(a.X0, b.X0), min(a.Y0, b.Y0), max(a.X1, b.X1), max(a.Y1, b.Y1)}
}

// RegionalDependency describes the footprint and prefix read halo of one
// prepared operation. CoastBox includes the coast's full reach.
type RegionalDependency struct {
	Region          *CellRect
	SmoothRadius    int
	CoastBox        *CellRect
	CoastReadRadius int
}

// RequiredRegions walks dependencies backward so the prefix read by a later
// blur or coast pass is computed before that pass. Regions are inclusive.
func RequiredRegions(ops []RegionalDependency, requested, whole CellRect) ([]CellRect, CellRect) {
	out := make([]CellRect, len(ops))
	need := requested
	for k := len(ops) - 1; k >= 0; k-- {
		out[k] = need
		op := ops[k]
		if op.CoastBox != nil {
			if hit, ok := intersect(need, *op.CoastBox); ok {
				need = union(need, expand(hit, op.CoastReadRadius, whole))
			}
		}
		if op.SmoothRadius > 0 && op.Region != nil {
			if hit, ok := intersect(need, *op.Region); ok {
				need = union(need, expand(hit, op.SmoothRadius, whole))
			}
		}
	}
	return out, need
}
