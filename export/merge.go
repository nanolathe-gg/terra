package main

import (
	"container/heap"
	"fmt"
	"math"
	"sort"
	"time"
)

// TNT numbers its tile graphics with u16 indices, so a map has at most 65536
// distinct 32x32 tiles. A map with more is reduced by tile merging: the
// distinct tiles are partitioned into at most that many clusters, and every
// cluster is drawn with one of its own members, so the map keeps exactly the
// art of tiles that exist, with no new tile invented.
//
// The partition is weighted median cut (Heckbert, Wu): start with one cluster
// of all tiles and repeatedly split the cluster with the largest error, the
// sum over its tiles of use count times squared distance from its centroid,
// at the position along its widest axis that leaves the least error. A tile's
// position is an 8x8 grid of the mean palette colors of its 4x4 pixel blocks
// (192 bytes), whose squared distance is a lower bound of 1/16 of the tiles'
// summed squared pixel error. A tile used many times (flat ground) therefore
// resists merging, and the many one-off tiles of noisy ground in dense regions
// merge first. Nothing here is random, nothing depends on the order in which
// browser chunks arrive, and only integers and explicit float64 conversions
// decide a comparison, so the same map gives the same bytes on the same machine.
// It reads each distinct tile once, keeps 192 bytes per tile and sorts index
// slices, so it also fits WebAssembly's 32-bit memory for the largest map
// (40x40 units, about 410,000 tiles, 79 MB). A 4x4 grid (48 bytes) merges
// noisy ground visibly worse, a 16x16 grid (768 bytes) a little better.
const (
	maxTiles   = 1 << 16
	blockCells = 8
	descLen    = blockCells * blockCells * 3
)

type slotError struct {
	X   int     `json:"x"`
	Y   int     `json:"y"`
	RMS float64 `json:"rms"`
}

// mergeSummary describes what merging cost. Errors are per 32x32 tile: the
// root mean square, over its 1024 pixels, of the RGB distance (0 to 441)
// between the original pixel's palette color and the kept tile's.
type mergeSummary struct {
	DistinctTiles int         `json:"distinctTiles"`
	KeptTiles     int         `json:"keptTiles"`
	MergedTiles   int         `json:"mergedTiles"`
	TileSlots     int         `json:"tileSlots"`
	ReplacedSlots int         `json:"replacedSlots"`
	MeanRMS       float64     `json:"meanRMS"`
	MeanRMSAll    float64     `json:"meanRMSAllSlots"`
	P99RMS        float64     `json:"p99RMS"`
	WorstRMS      float64     `json:"worstRMS"`
	Worst         []slotError `json:"worst"`
	Milliseconds  int64       `json:"milliseconds"`
}

type cluster struct {
	lo, hi int
	cost   float64
	axis   int
}

type clusterHeap []cluster

func (h clusterHeap) Len() int { return len(h) }
func (h clusterHeap) Less(i, j int) bool {
	if h[i].cost != h[j].cost {
		return h[i].cost > h[j].cost
	}
	return h[i].lo < h[j].lo
}
func (h clusterHeap) Swap(i, j int) { h[i], h[j] = h[j], h[i] }
func (h *clusterHeap) Push(x any)   { *h = append(*h, x.(cluster)) }
func (h *clusterHeap) Pop() any {
	old := *h
	x := old[len(old)-1]
	*h = old[:len(old)-1]
	return x
}

type merger struct {
	desc   []uint8  // descLen numbers per distinct tile
	weight []uint32 // slots using each distinct tile
	perm   []uint32 // distinct tiles; clusters are ranges of it
	rank   []uint32 // each tile's place in first appearance in the tile grid, so ties break the same however the browser cut its chunks
}

func (m *merger) at(id uint32, k int) uint8 { return m.desc[int(id)*descLen+k] }

// measure returns the cluster's error and its widest axis.
func (m *merger) measure(c cluster) cluster {
	var sum, sq [descLen]float64
	var total uint64
	var s, q [descLen]uint64
	for _, id := range m.perm[c.lo:c.hi] {
		wt := uint64(m.weight[id])
		total += wt
		for k := 0; k < descLen; k++ {
			x := uint64(m.at(id, k))
			s[k] += wt * x
			q[k] += wt * x * x
		}
	}
	c.cost, c.axis = 0, 0
	best := -1.0
	for k := 0; k < descLen; k++ {
		sum[k], sq[k] = float64(s[k]), float64(q[k])
		v := sq[k] - (sum[k]*sum[k])/float64(total)
		if v < 0 {
			v = 0
		}
		c.cost += v
		if v > best {
			best, c.axis = v, k
		}
	}
	return c
}

// split cuts the cluster along its widest axis where the two parts have the
// least summed error on that axis.
func (m *merger) split(c cluster) (cluster, cluster) {
	ids := m.perm[c.lo:c.hi]
	axis := c.axis
	sort.Slice(ids, func(i, j int) bool {
		a, b := m.at(ids[i], axis), m.at(ids[j], axis)
		if a != b {
			return a < b
		}
		return m.rank[ids[i]] < m.rank[ids[j]]
	})
	var tw, ts, tq uint64
	for _, id := range ids {
		wt, x := uint64(m.weight[id]), uint64(m.at(id, axis))
		tw += wt
		ts += wt * x
		tq += wt * x * x
	}
	var lw, ls, lq uint64
	bestAt, best := 1, math.Inf(1)
	for p := 1; p < len(ids); p++ {
		id := ids[p-1]
		wt, x := uint64(m.weight[id]), uint64(m.at(id, axis))
		lw += wt
		ls += wt * x
		lq += wt * x * x
		rw, rs, rq := tw-lw, ts-ls, tq-lq
		cost := (float64(lq) - (float64(ls)*float64(ls))/float64(lw)) + (float64(rq) - (float64(rs)*float64(rs))/float64(rw))
		if cost < best {
			best, bestAt = cost, p
		}
	}
	return cluster{lo: c.lo, hi: c.lo + bestAt}, cluster{lo: c.lo + bestAt, hi: c.hi}
}

// descriptors reads every distinct tile once.
func (s *terrainStream) descriptors(m *merger) error {
	n := s.store.count
	m.desc = make([]uint8, n*descLen)
	var tile [1024]byte
	const side = 32 / blockCells
	for id := 0; id < n; id++ {
		if id&1023 == 0 {
			if err := s.ctx.Err(); err != nil {
				return err
			}
		}
		if err := s.store.read(uint32(id), tile[:]); err != nil {
			return err
		}
		var sum [descLen]uint32
		for y := 0; y < 32; y++ {
			for x := 0; x < 32; x++ {
				c := s.palette[tile[y*32+x]]
				at := ((y/side)*blockCells + x/side) * 3
				sum[at] += uint32(c[0])
				sum[at+1] += uint32(c[1])
				sum[at+2] += uint32(c[2])
			}
		}
		for k, v := range sum {
			m.desc[id*descLen+k] = uint8((v + side*side/2) / (side * side))
		}
	}
	return nil
}

// mergeTiles replaces s.indices' tiles so at most s.tileLimit distinct tiles remain.
func (s *terrainStream) mergeTiles() (*mergeSummary, error) {
	begin := time.Now()
	n := s.store.count
	m := &merger{weight: make([]uint32, n), perm: make([]uint32, 0, n), rank: make([]uint32, n)}
	for i := range m.rank {
		m.rank[i] = ^uint32(0)
	}
	for _, id := range s.indices {
		m.weight[id]++
		if m.rank[id] == ^uint32(0) {
			m.rank[id] = uint32(len(m.perm))
			m.perm = append(m.perm, id)
		}
	}
	if err := s.descriptors(m); err != nil {
		return nil, err
	}
	var leaves []cluster
	pending := &clusterHeap{}
	push := func(c cluster) {
		if c.hi-c.lo < 2 {
			leaves = append(leaves, c)
			return
		}
		c = m.measure(c)
		if c.cost <= 0 {
			leaves = append(leaves, c)
			return
		}
		heap.Push(pending, c)
	}
	push(cluster{lo: 0, hi: len(m.perm)}) // every stored tile is used by some slot
	for count := 1; count < s.tileLimit && pending.Len() > 0; count++ {
		if count&255 == 0 {
			if err := s.ctx.Err(); err != nil {
				return nil, err
			}
		}
		a, b := m.split(heap.Pop(pending).(cluster))
		push(a)
		push(b)
	}
	leaves = append(leaves, *pending...)
	if len(leaves) > s.tileLimit {
		return nil, fmt.Errorf("tile merging produced %d clusters for %d tiles", len(leaves), s.tileLimit)
	}
	// Each cluster is drawn with its member nearest to the cluster's weighted centroid.
	rep := make([]uint32, n)
	for i := range rep {
		rep[i] = uint32(i)
	}
	for _, c := range leaves {
		ids := m.perm[c.lo:c.hi]
		var w uint64
		var s [descLen]uint64
		for _, id := range ids {
			wt := uint64(m.weight[id])
			w += wt
			for k := 0; k < descLen; k++ {
				s[k] += wt * uint64(m.at(id, k))
			}
		}
		best, bestID := math.Inf(1), ids[0]
		for _, id := range ids {
			var d float64
			for k := 0; k < descLen; k++ {
				// Distance from the centroid, scaled by the cluster's weight.
				e := float64(uint64(m.at(id, k))*w) - float64(s[k])
				d += e * e
			}
			if d < best || d == best && m.rank[id] < m.rank[bestID] {
				best, bestID = d, id
			}
		}
		for _, id := range ids {
			rep[id] = bestID
		}
	}
	summary := &mergeSummary{DistinctTiles: n, KeptTiles: len(leaves), TileSlots: len(s.indices)}
	type loss struct {
		id  uint32
		rms float64
	}
	var losses []loss
	var a, b [1024]byte
	var sumRMS float64
	for id := 0; id < n; id++ {
		r := rep[id]
		if r == uint32(id) {
			continue
		}
		if err := s.store.read(uint32(id), a[:]); err != nil {
			return nil, err
		}
		if err := s.store.read(r, b[:]); err != nil {
			return nil, err
		}
		var sse int
		for i := range a {
			p, q := s.palette[a[i]], s.palette[b[i]]
			for k := 0; k < 3; k++ {
				d := int(p[k]) - int(q[k])
				sse += d * d
			}
		}
		rms := math.Sqrt(float64(sse) / 1024)
		losses = append(losses, loss{uint32(id), rms})
		summary.MergedTiles++
		summary.ReplacedSlots += int(m.weight[id])
		sumRMS += rms * float64(m.weight[id])
	}
	if summary.ReplacedSlots > 0 {
		summary.MeanRMS = sumRMS / float64(summary.ReplacedSlots)
		summary.MeanRMSAll = sumRMS / float64(len(s.indices))
		sort.Slice(losses, func(i, j int) bool {
			if losses[i].rms != losses[j].rms {
				return losses[i].rms < losses[j].rms
			}
			return m.rank[losses[i].id] < m.rank[losses[j].id]
		})
		var run int
		target := (summary.ReplacedSlots*99 + 99) / 100
		for _, l := range losses {
			run += int(m.weight[l.id])
			if run >= target {
				summary.P99RMS = l.rms
				break
			}
		}
		summary.WorstRMS = losses[len(losses)-1].rms
		// The worst places: the slots, in grid order, that drew the worst-replaced tiles.
		worst := make(map[uint32]float64)
		for i := len(losses) - 1; i >= 0 && i >= len(losses)-16; i-- {
			worst[losses[i].id] = losses[i].rms
		}
		cols := s.width / 2
		for i, id := range s.indices {
			if rms, ok := worst[id]; ok && len(summary.Worst) < 64 {
				summary.Worst = append(summary.Worst, slotError{X: i % cols, Y: i / cols, RMS: rms})
			}
		}
		sort.SliceStable(summary.Worst, func(i, j int) bool { return summary.Worst[i].RMS > summary.Worst[j].RMS })
	}
	for i, id := range s.indices {
		s.indices[i] = rep[id]
	}
	summary.Milliseconds = time.Since(begin).Milliseconds()
	return summary, nil
}
