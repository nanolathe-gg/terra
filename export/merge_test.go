package main

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"math"
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

// equalBlockStream stores groups x variants distinct tiles, each used once in that order: within a
// group the tiles differ in their pixels but every 4x4 block holds the same colors, so they share
// one descriptor. reverse stores them in the opposite order, as another chunking might discover them.
func equalBlockStream(t *testing.T, groups, variants, limit int, reverse bool) *terrainStream {
	t.Helper()
	n := groups * variants
	s := &terrainStream{ctx: context.Background(), width: 2 * n, tileLimit: limit, store: tileStore{budget: 1 << 30}, indices: make([]uint32, n)}
	for i := range s.palette {
		s.palette[i] = [3]byte{byte(i), byte(i * 3), byte(255 - i)}
	}
	for k := 0; k < n; k++ {
		id := k
		if reverse {
			id = n - 1 - k
		}
		g, v := id/variants, id%variants
		var tile [1024]byte
		for y := 0; y < 32; y++ {
			for x := 0; x < 32; x++ {
				tile[y*32+x] = byte(2 * g)
				if (x%4+y%4*4+v*5)%16 >= 8 {
					tile[y*32+x]++
				}
			}
		}
		if err := s.store.append(tile[:]); err != nil {
			t.Fatal(err)
		}
	}
	for i := range s.indices {
		s.indices[i] = uint32(i)
		if reverse {
			s.indices[i] = uint32(n - 1 - i)
		}
	}
	return s
}

// Tiles that differ only inside their 4x4 blocks are kept while the budget lasts.
func TestMergeTilesFillsTheBudgetWhenDescriptorsTie(t *testing.T) {
	a, b := equalBlockStream(t, 50, 3, 100, false), equalBlockStream(t, 50, 3, 100, true)
	sa, err := a.mergeTiles()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b.mergeTiles(); err != nil {
		t.Fatal(err)
	}
	kept := map[uint32]bool{}
	for _, id := range a.indices {
		kept[id] = true
	}
	if len(kept) != 100 || sa.KeptTiles != 100 || sa.MergedTiles != 50 || sa.ReplacedSlots != 50 {
		t.Fatalf("150 distinct tiles, limit 100: %d kept (summary kept %d, merged %d, replaced %d slots), want 100 kept and 50 merged", len(kept), sa.KeptTiles, sa.MergedTiles, sa.ReplacedSlots)
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

// spilled moves a stream's tiles into a store that keeps only `budget` bytes in memory.
func spilled(t *testing.T, s *terrainStream, budget int) {
	t.Helper()
	store := tileStore{budget: budget, dir: t.TempDir()}
	t.Cleanup(store.close)
	var tile [1024]byte
	for id := 0; id < s.store.count; id++ {
		if err := s.store.read(uint32(id), tile[:]); err != nil {
			t.Fatal(err)
		}
		if err := store.append(tile[:]); err != nil {
			t.Fatal(err)
		}
	}
	s.store = store
}

// A merge over spilled tiles gives the same result, reading the spill file forward a block at a time.
func TestMergeTilesReadsSpilledTilesInFileOrder(t *testing.T) {
	a, b := noisyStream(t, 600, 40, 30, 100), noisyStream(t, 600, 40, 30, 100)
	spilled(t, b, 64<<10)
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
		t.Fatal("merging spilled tiles differs from merging them in memory")
	}
	// Three forward passes (descriptors, replacements, merged tiles) over 536 spilled tiles of 64 per block;
	// reading each replacement after its merged tile took about 500 calls.
	blocks := (b.store.count*1024 - b.store.held + spillBlock - 1) / spillBlock
	if b.store.fileReads > 3*blocks+3 {
		t.Fatalf("merge made %d calls into the spill file, more than three forward passes of %d blocks", b.store.fileReads, blocks)
	}
}

// TILECAP_READS=1 go test -run MergeReadsScale -v: the reads of merging a noisy 40x40-unit map (412,804 distinct
// tiles in 512 px chunks, 64 MiB of them in memory, the rest spilled) and of the TNT's passes over the kept tiles.
func TestMergeReadsScale(t *testing.T) {
	if os.Getenv("TILECAP_READS") == "" {
		t.Skip("set TILECAP_READS=1")
	}
	chunkTiles, cols, rows := 16, 641, 644
	rng := rand.New(rand.NewSource(3))
	s := &terrainStream{ctx: context.Background(), width: cols * 2, tileLimit: maxTiles, store: tileStore{budget: 64 << 20, dir: t.TempDir()}, indices: make([]uint32, cols*rows)}
	defer s.close()
	for i := range s.palette {
		s.palette[i] = [3]byte{byte(i), byte(i * 3), byte(255 - i)}
	}
	var tile [1024]byte
	for cy := 0; cy < rows; cy += chunkTiles {
		for cx := 0; cx < cols; cx += chunkTiles {
			for ty := cy; ty < min(cy+chunkTiles, rows); ty++ {
				for tx := cx; tx < min(cx+chunkTiles, cols); tx++ {
					base := byte(rng.Intn(60))
					for i := range tile {
						tile[i] = base + byte(rng.Intn(4))
					}
					s.indices[ty*cols+tx] = uint32(s.store.count)
					if err := s.store.append(tile[:]); err != nil {
						t.Fatal(err)
					}
				}
			}
		}
	}
	begin := time.Now()
	summary, err := s.mergeTiles()
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%d tiles (%d spilled) merged to %d in %v: %d file reads, %.0f MiB", s.store.count, s.store.count-s.store.held/1024, summary.KeptTiles, time.Since(begin), s.store.fileReads, float64(s.store.fileBytes)/(1<<20))
}

// The merge's result is pinned: the native exporter and the browser's (this
// package built for WebAssembly) must choose the same tiles and report the
// same errors. Go may fuse x*y+z into one rounding on arm64, which
// WebAssembly never does; merge.go converts each product explicitly, which
// the language forbids fusing. Run it both ways:
//
//	go test ./export
//	GOOS=js GOARCH=wasm PATH="$PATH:$(go env GOROOT)/lib/wasm" go test ./export
func TestMergeTilesPinned(t *testing.T) {
	s := noisyStream(t, 3000, 100, 80, 500)
	for i := range s.indices {
		if i%5 != 0 {
			s.indices[i] = uint32((i*i/7)%2997 + 3) // uneven use, so merged tiles carry weights other than 1
		}
	}
	summary, err := s.mergeTiles()
	if err != nil {
		t.Fatal(err)
	}
	slots := make([]byte, 0, 4*len(s.indices))
	for _, id := range s.indices {
		slots = binary.LittleEndian.AppendUint32(slots, id)
	}
	got := fmt.Sprintf("%x kept %d merged %d replaced %d mean %x all %x p99 %x worst %x", sha256.Sum256(slots), summary.KeptTiles, summary.MergedTiles, summary.ReplacedSlots,
		math.Float64bits(summary.MeanRMS), math.Float64bits(summary.MeanRMSAll), math.Float64bits(summary.P99RMS), math.Float64bits(summary.WorstRMS))
	const want = "7e40e64d810581e8506d0da3392269d66d7924fc72ab1fe5eae7ded880f7a8c9 kept 500 merged 1328 replaced 3245 mean 400e916b81e3d129 all 3ff8cc5f372218b8 p99 400fcfdbc999e97d worst 4013d5b9b8bba9c3"
	if got != want {
		t.Fatalf("merge result\n got %s\nwant %s", got, want)
	}
}
