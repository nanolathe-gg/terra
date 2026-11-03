package terrain

import "fmt"

// PreparedOp is a GPU-authored operation after path and parameter preparation.
// The uniform values include kind, segment offsets and mask-write offsets.
type PreparedOp struct {
	Ground       bool
	Region       *CellRect
	Values       map[string]float64
	Entry        string
	Settle       bool
	SmoothRadius int
	Coast        *CoastPass
	// PrefixReads require the paged point-read windows to be evaluated first.
	PrefixReads int
}
type CoastPass struct {
	Box                                       CellRect
	ReadRadius, MaxCells, BlurRadius          int
	Fingers, Layers, Plates, Scalloped, Facet bool
	Sites                                     CellRect
}

func copyValues(a, b map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(a)+len(b))
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] = v
	}
	return out
}

// PlanReplay plans a region of already prepared operations. Prefix-reading
// operations must be resolved through point-read windows before planning.
func PlanReplay(base map[string]float64, ops []PreparedOp, requested, whole CellRect, direct bool) ([]ShapePass, error) {
	r, ok := intersect(requested, whole)
	if !ok {
		return nil, nil
	}
	deps := make([]RegionalDependency, len(ops))
	for i, op := range ops {
		if op.PrefixReads > 0 {
			return nil, fmt.Errorf("operation %d needs unresolved prefix point reads", i)
		}
		deps[i] = RegionalDependency{Region: op.Region, SmoothRadius: op.SmoothRadius}
		if op.Coast != nil {
			deps[i].CoastBox = &op.Coast.Box
			deps[i].CoastReadRadius = op.Coast.ReadRadius
		}
	}
	regions, initial := RequiredRegions(deps, r, whole)
	passes := []ShapePass{}
	add := func(entry string, rect CellRect, u map[string]float64) {
		passes = append(passes, ShapePass{Entry: entry, Region: rect, Values: copyValues(base, u)})
	}
	add("init", initial, nil)
	for i, op := range ops {
		need := regions[i]
		if op.Ground {
			add("ground", need, op.Values)
			continue
		}
		if op.Region == nil {
			continue
		}
		emitBody := func(bodyRegion CellRect, values map[string]float64) {
			reg := *op.Region
			if op.Settle {
				reg = expand(reg, 4, whole)
			}
			body, ok := intersect(bodyRegion, reg)
			if !ok {
				return
			}
			if !direct {
				add("noise", expand(*op.Region, 1, whole), values)
			}
			entry := op.Entry
			if entry == "" {
				entry = "stamp"
			}
			if op.SmoothRadius > 0 {
				wide := expand(body, op.SmoothRadius, whole)
				add("smoothCopy", wide, values)
				add("blurH", wide, copyValues(values, map[string]float64{"bsrc": 0, "bdst": 1, "blurR": float64(op.SmoothRadius)}))
				add("blurV", body, copyValues(values, map[string]float64{"bsrc": 1, "bdst": 2, "blurR": float64(op.SmoothRadius)}))
				add(entry, body, values)
				return
			}
			if !op.Settle {
				add(entry, body, values)
				return
			}
			wide := expand(body, 4, whole)
			add(entry, wide, values)
			for _, b := range []struct {
				e        string
				src, dst float64
			}{{"blurH", 0, 1}, {"blurV", 1, 2}, {"blurH", 2, 1}, {"blurV", 1, 2}} {
				add(b.e, wide, copyValues(values, map[string]float64{"bsrc": b.src, "bdst": b.dst}))
			}
			add("compose", body, values)
		}
		if op.Coast == nil {
			emitBody(need, op.Values)
			continue
		}
		c := op.Coast
		hit, ok := intersect(need, c.Box)
		if !ok {
			continue
		}
		wide, ok := intersect(expand(hit, c.ReadRadius, whole), c.Box)
		if !ok {
			continue
		}
		add("coastInit", wide, op.Values)
		emitBody(wide, copyValues(op.Values, map[string]float64{"coPutW": 1}))
		if c.Facet {
			add("facetSnap", wide, op.Values)
			if b, ok := intersect(wide, *op.Region); ok {
				add("facetApply", b, op.Values)
			}
			continue
		}
		field := func(moved float64) {
			src := 0
			add("coastSeed", wide, copyValues(op.Values, map[string]float64{"coSrc": 0, "coMoved": moved}))
			n := 0
			for (1 << n) < c.MaxCells+1 {
				n++
			}
			if n < 1 {
				n = 1
			}
			for k := n - 1; k >= 0; k-- {
				add("coastJump", wide, copyValues(op.Values, map[string]float64{"coSrc": float64(src), "coStep": float64(int(1) << k)}))
				src ^= 1
				if k == 0 {
					add("coastJump", wide, copyValues(op.Values, map[string]float64{"coSrc": float64(src), "coStep": 1}))
					src ^= 1
				}
			}
			add("coastFinish", wide, copyValues(op.Values, map[string]float64{"coSrc": float64(src)}))
		}
		if c.Fingers {
			field(1)
			add("coastSd", wide, op.Values)
			add("coastBlurH", wide, copyValues(op.Values, map[string]float64{"bsrc": 5, "bdst": 7, "blurR": float64(c.BlurRadius)}))
			add("coastBlurV", wide, copyValues(op.Values, map[string]float64{"bsrc": 7, "bdst": 10, "blurR": float64(c.BlurRadius)}))
			add("coastFinger", wide, op.Values)
			add("coastJoin", wide, op.Values)
		}
		if c.Layers {
			field(1)
			if c.Scalloped {
				add("coastSites", c.Sites, op.Values)
			}
			add("coastLayers", wide, op.Values)
		}
		if c.Plates {
			field(0)
			add("coastPlates", wide, op.Values)
		}
	}
	return passes, nil
}
