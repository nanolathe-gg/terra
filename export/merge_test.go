package main

import (
	"context"
	"math/rand"
	"os"
	"reflect"
	"strconv"
	"testing"
	"time"
)

// noisyStream builds a stream of cols x rows slots over `distinct` tiles: each a ground color with seeded grit, some used many times.
func noisyStream(t *testing.T, distinct, cols, rows, limit int) *terrainStream {
	t.Helper()
	rng := rand.New(rand.NewSource(7))
	s := &terrainStream{ctx: context.Background(), width: cols * 2, tileLimit: limit, store: tileStore{budget: 1 << 30}, indices: make([]uint32, cols*rows)}
	for i := range s.palette {
		s.palette[i] = [3]byte{byte(i), byte(i * 3), byte(255 - i)}
	}
	for id := 0; id < distinct; id++ {
		var tile [1024]byte
		base := byte(id % 200)
		for i := range tile {
			tile[i] = base + byte(rng.Intn(3))
		}
		if err := s.store.append(tile[:]); err != nil {
			t.Fatal(err)
		}
	}
	next := 3
	for i := range s.indices {
		switch {
		case i%5 == 0:
			s.indices[i] = uint32(i % 3) // a few well-used tiles
		case next < distinct:
			s.indices[i] = uint32(next) // every tile is used at least once
			next++
		default:
			s.indices[i] = uint32(rng.Intn(distinct))
		}
	}
	return s
}

func TestMergeTilesFitsDeterministicallyAndReplacesWithMembers(t *testing.T) {
	a, b := noisyStream(t, 600, 40, 30, 100), noisyStream(t, 600, 40, 30, 100)
	before := append([]uint32(nil), a.indices...)
	sa, err := a.mergeTiles()
	if err != nil {
		t.Fatal(err)
	}
	sb, err := b.mergeTiles()
	if err != nil {
		t.Fatal(err)
	}
	sa.Milliseconds, sb.Milliseconds = 0, 0
	if !reflect.DeepEqual(a.indices, b.indices) || !reflect.DeepEqual(sa, sb) {
		t.Fatal("merging the same tiles twice differs")
	}
	kept := map[uint32]bool{}
	for i, id := range a.indices {
		kept[id] = true
		if int(id) >= 600 || int(before[i]) >= 600 {
			t.Fatal("an index left the stored tiles")
		}
	}
	if len(kept) > 100 || len(kept) > sa.KeptTiles {
		t.Fatalf("%d tiles kept, limit 100 (summary %d)", len(kept), sa.KeptTiles)
	}
	if sa.MergedTiles == 0 || sa.WorstRMS < sa.MeanRMS || len(sa.Worst) == 0 {
		t.Fatalf("implausible summary %+v", sa)
	}
}

func TestMergeTilesKeepsHeavilyUsedTilesExact(t *testing.T) {
	s := noisyStream(t, 600, 40, 30, 100)
	if _, err := s.mergeTiles(); err != nil {
		t.Fatal(err)
	}
	// Tiles 0..2 are each used about 80 times, far above the one-off tiles: they stay themselves.
	for i := 0; i < len(s.indices); i += 5 {
		if int(s.indices[i]) != i%3 {
			t.Fatalf("slot %d: well-used tile %d became %d", i, i%3, s.indices[i])
		}
	}
}

// TILECAP_SCALE=410000 go test -run MergeTilesScale -v: time and memory of merging a 40x40-unit map's worth of one-off tiles (spilled to disk).
func TestMergeTilesScale(t *testing.T) {
	n, _ := strconv.Atoi(os.Getenv("TILECAP_SCALE"))
	if n == 0 {
		t.Skip("set TILECAP_SCALE to the number of distinct tiles")
	}
	rng := rand.New(rand.NewSource(3))
	s := &terrainStream{ctx: context.Background(), width: 2 * 640, tileLimit: maxTiles, store: tileStore{budget: 16 << 20, dir: t.TempDir()}, indices: make([]uint32, n)}
	defer s.close()
	for i := range s.palette {
		s.palette[i] = [3]byte{byte(rng.Intn(256)), byte(rng.Intn(256)), byte(rng.Intn(256))}
	}
	var tile [1024]byte
	for id := 0; id < n; id++ {
		base := byte(rng.Intn(256))
		for i := range tile {
			tile[i] = base + byte(rng.Intn(4))
		}
		if err := s.store.append(tile[:]); err != nil {
			t.Fatal(err)
		}
		s.indices[id] = uint32(id)
	}
	begin := time.Now()
	summary, err := s.mergeTiles()
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%d tiles -> %d kept in %v; mean rms %.2f worst %.2f", n, summary.KeptTiles, time.Since(begin), summary.MeanRMS, summary.WorstRMS)
}

func TestMergeTilesIgnoresTheOrderTilesWereDiscovered(t *testing.T) {
	a := noisyStream(t, 600, 40, 30, 100)
	// The same map with its tiles stored in reverse: another chunking of the browser's rows discovers them in another order.
	b := noisyStream(t, 600, 40, 30, 100)
	b.store = tileStore{budget: 1 << 30}
	for id := 599; id >= 0; id-- {
		var tile [1024]byte
		if err := a.store.read(uint32(id), tile[:]); err != nil {
			t.Fatal(err)
		}
		if err := b.store.append(tile[:]); err != nil {
			t.Fatal(err)
		}
	}
	for i, id := range a.indices {
		b.indices[i] = 599 - id
	}
	if _, err := a.mergeTiles(); err != nil {
		t.Fatal(err)
	}
	if _, err := b.mergeTiles(); err != nil {
		t.Fatal(err)
	}
	var x, y [1024]byte
	for i := range a.indices {
		if err := a.store.read(a.indices[i], x[:]); err != nil {
			t.Fatal(err)
		}
		if err := b.store.read(b.indices[i], y[:]); err != nil {
			t.Fatal(err)
		}
		if x != y {
			t.Fatalf("slot %d draws different art when the tiles were discovered in another order", i)
		}
	}
}
