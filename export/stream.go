package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"os"
	"path/filepath"
	"time"
)

const maxChunkSide = 4096

type exportMetrics struct {
	PeakRSSBytes       int64 `json:"peakRSSBytes"`
	PeakTemporaryBytes int64 `json:"peakTemporaryBytes"`
	ExportMilliseconds int64 `json:"exportMilliseconds"`
}

// Past its budget the store keeps tiles in a spill file. It writes them a
// block at a time, serving the newest from that buffer, and reads a block
// ahead when reads move forward through the file, as the merge's passes and
// the TNT's tile section do. A call into the file costs far more in the
// browser, where it crosses from WebAssembly to the worker's OPFS file system
// (sculpt-export-worker.js), than natively; blocks keep those calls few.
const spillBlock = 64 << 10

// The tiles within the budget sit in blocks that never move: growing one
// slice copies it, and in WebAssembly, whose memory never shrinks, every
// abandoned copy stays allocated (a 64 MiB budget took 340 MB on a 16x16 map).
const memoryBlock = 1 << 20

type tileStore struct {
	memory  [][]byte
	held    int // bytes in memory
	budget  int
	file    *os.File
	dir     string
	count   int
	pending []byte // the newest spilled tiles, not yet written
	ahead   []byte // spilled tiles read ahead, from byte aheadAt of the file
	aheadAt int
	next    int // the byte after the last spilled tile read (tiles in memory leave it)
	// Calls into the spill file and the bytes they read, for tests of the read pattern.
	fileReads, fileBytes int
}

// resident reports whether a tile is read from memory, without a call into the file.
func (s *tileStore) resident(index uint32) bool {
	at := int(index) * 1024
	return at+1024 <= s.held || s.file != nil && at >= s.count*1024-len(s.pending)
}

func (s *tileStore) append(tile []byte) error {
	if s.file == nil && s.held+len(tile) > s.budget {
		f, err := os.CreateTemp(s.dir, "nanolathe-map-tiles-*")
		if err != nil {
			return err
		}
		s.file = f
		for _, block := range s.memory {
			if _, err = f.Write(block); err != nil {
				return err
			}
		}
	}
	if s.file != nil {
		s.pending = append(s.pending, tile...)
		if len(s.pending) >= spillBlock {
			if _, err := s.file.Write(s.pending); err != nil {
				return err
			}
			s.pending = s.pending[:0]
		}
	}
	// Retain the initial budget as a read cache, since base-ground tiles
	// commonly recur throughout a map. The rest exists only on disk.
	if s.held+len(tile) <= s.budget {
		if n := len(s.memory); n == 0 || len(s.memory[n-1]) == cap(s.memory[n-1]) {
			s.memory = append(s.memory, make([]byte, 0, min(memoryBlock, s.budget-s.held)))
		}
		last := &s.memory[len(s.memory)-1]
		*last = append(*last, tile...)
		s.held += len(tile)
	}
	s.count++
	return nil
}

func (s *tileStore) read(index uint32, out []byte) error {
	at := int(index) * 1024
	if at+1024 <= s.held {
		copy(out, s.memory[at/memoryBlock][at%memoryBlock:])
		return nil
	}
	if s.file == nil || at+1024 > s.count*1024 {
		return fmt.Errorf("tile %d is absent", index)
	}
	next := s.next
	s.next = at + 1024
	written := s.count*1024 - len(s.pending)
	if at >= written {
		copy(out, s.pending[at-written:])
		return nil
	}
	end := s.aheadAt + len(s.ahead)
	if at >= s.aheadAt && at+1024 <= end {
		copy(out, s.ahead[at-s.aheadAt:])
		return nil
	}
	// A read moves forward when it lands within a block past the last spilled
	// tile read, or past the block ahead: a pass in file order that skips
	// tiles, as the merge's do, still reads a block at a time.
	forward := at >= next && at < next+spillBlock || len(s.ahead) > 0 && at >= end && at < end+spillBlock
	if !forward {
		// Out of order: this tile alone, keeping the block ahead.
		s.fileReads, s.fileBytes = s.fileReads+1, s.fileBytes+len(out)
		_, err := s.file.ReadAt(out, int64(at))
		return err
	}
	if s.ahead == nil {
		s.ahead = make([]byte, spillBlock)
	}
	s.ahead = s.ahead[:min(spillBlock, written-at)]
	s.fileReads, s.fileBytes = s.fileReads+1, s.fileBytes+len(s.ahead)
	if _, err := s.file.ReadAt(s.ahead, int64(at)); err != nil {
		s.ahead = s.ahead[:0]
		return err
	}
	s.aheadAt = at
	copy(out, s.ahead)
	return nil
}

func (s *tileStore) close() {
	if s.file != nil {
		name := s.file.Name()
		s.file.Close()
		os.Remove(name)
	}
}

type terrainStream struct {
	ctx            context.Context
	req            exportRequest
	world          worldInfo
	starts         []start
	width, height  int
	heights        []byte
	features       []uint16
	names          []string
	pack           *packedFeatures // the map's generated features, written beside its OTA and TNT
	indices        []uint32        // per tile slot: the distinct tile's number in order of discovery, until finish renumbers it
	covered        []uint64
	received       int
	lastX, lastY   int
	hashes         map[[32]byte][]uint32
	store          tileStore
	order          []uint32
	tileLimit      int
	merge          *mergeSummary
	quantize       *quantizer
	palette        [256][3]byte
	mini           [252 * 252][4]uint64
	miniX, miniY   []int
	usedW, usedH   int
	exact, nearest int
	out, work      string
	begin          time.Time
	metrics        exportMetrics
	stageID        string
}

func newTerrainStream(ctx context.Context, req exportRequest, catalog catalog, out, work string, tileBudget int, pack *packedFeatures) (*terrainStream, error) {
	world, err := validateRequest(req, catalog)
	if err != nil {
		return nil, err
	}
	starts, err := mapStarts(req)
	if err != nil {
		return nil, err
	}
	names, features, err := encodeFeatures(req, pack)
	if err != nil {
		return nil, err
	}
	w, h := req.UnitsX*32+2, req.UnitsY*32+8
	heights := make([]byte, w*h)
	for i, v := range req.Heights {
		heights[i] = byte(v)
	}
	if features == nil {
		features = make([]uint16, w*h)
		for i := range features {
			features[i] = 0xffff
		}
	}
	req.Heights, req.Chunks = nil, nil
	s := &terrainStream{ctx: ctx, req: req, world: world, starts: starts, width: w, height: h, heights: heights, features: features, names: names, pack: pack,
		indices: make([]uint32, (w/2)*(h/2)), covered: make([]uint64, ((w/2)*(h/2)+63)/64), hashes: make(map[[32]byte][]uint32), tileLimit: maxTiles,
		store: tileStore{budget: tileBudget, dir: work}, quantize: newQuantizer(catalog.Palette), palette: catalog.Palette,
		out: out, work: work, begin: time.Now(), lastX: -1, lastY: -1}
	// [fmt tnt] "Minimap": long-side fit of the play area, excluding
	// the engine's two east and eight south attribute-cell strips.
	pw, ph := req.UnitsX*512, req.UnitsY*512
	s.usedW, s.usedH = 252, 252
	if pw < ph {
		s.usedW = pw * 252 / ph
	} else {
		s.usedH = ph * 252 / pw
	}
	s.miniX, s.miniY = make([]int, pw), make([]int, ph)
	// Invert the integer block boundaries used by the phase-1 average.
	// Each source pixel contributes once, independent of chunk boundaries.
	for x := range s.miniX {
		s.miniX[x] = ((x+1)*s.usedW - 1) / pw
	}
	for y := range s.miniY {
		s.miniY[y] = ((y+1)*s.usedH - 1) / ph
	}
	return s, nil
}

func (s *terrainStream) close() { s.store.close() }

func (s *terrainStream) add(chunk preparedChunk) error {
	if err := s.ctx.Err(); err != nil {
		return err
	}
	w, h := s.width*16, s.height*16
	if chunk.X < 0 || chunk.Y < 0 || chunk.X%32 != 0 || chunk.Y%32 != 0 || chunk.Width <= 0 || chunk.Height <= 0 || chunk.Width%32 != 0 || chunk.Height%32 != 0 || chunk.Width > maxChunkSide || chunk.Height > maxChunkSide || chunk.Width > w-chunk.X || chunk.Height > h-chunk.Y {
		return fmt.Errorf("chunk must contain whole 32px tiles inside %dx%d, with at most %dpx per side", w, h, maxChunkSide)
	}
	if chunk.Y < s.lastY || chunk.Y == s.lastY && chunk.X <= s.lastX {
		return fmt.Errorf("chunks must arrive in row order (y, then x)")
	}
	for ty := chunk.Y / 32; ty < (chunk.Y+chunk.Height)/32; ty++ {
		for tx := chunk.X / 32; tx < (chunk.X+chunk.Width)/32; tx++ {
			i := ty*(s.width/2) + tx
			if s.covered[i/64]&(1<<uint(i%64)) != 0 {
				return fmt.Errorf("chunks overlap at tile (%d,%d)", tx, ty)
			}
		}
	}
	img, err := readChunk(chunk)
	if err != nil {
		return err
	}
	// PNG decodes to NRGBA or RGBA; their bytes are read directly, which in
	// WebAssembly is several times faster than a color interface per pixel.
	// An opaque pixel has the same 8-bit channels either way.
	var pix []byte
	var stride int
	switch m := img.(type) {
	case *image.NRGBA:
		pix, stride = m.Pix, m.Stride
	case *image.RGBA:
		pix, stride = m.Pix, m.Stride
	}
	var compare [1024]byte
	for ty := 0; ty < chunk.Height; ty += 32 {
		if err := s.ctx.Err(); err != nil {
			return err
		}
		for tx := 0; tx < chunk.Width; tx += 32 {
			var tile [1024]byte
			for y := 0; y < 32; y++ {
				wy := chunk.Y + ty + y
				for x := 0; x < 32; x++ {
					var r, g, b byte
					if pix != nil {
						p := pix[(ty+y)*stride+(tx+x)*4:]
						if p[3] != 0xff {
							return fmt.Errorf("chunk has transparency at (%d,%d); expected opaque final art", tx+x, ty+y)
						}
						r, g, b = p[0], p[1], p[2]
					} else {
						r32, g32, b32, a := img.At(tx+x, ty+y).RGBA()
						if a != 0xffff {
							return fmt.Errorf("chunk has transparency at (%d,%d); expected opaque final art", tx+x, ty+y)
						}
						r, g, b = byte(r32>>8), byte(g32>>8), byte(b32>>8)
					}
					index, exact := s.quantize.index(r, g, b)
					if exact {
						s.exact++
					} else {
						s.nearest++
					}
					tile[y*32+x] = index
					wx := chunk.X + tx + x
					if wx < len(s.miniX) && wy < len(s.miniY) {
						at := s.miniY[wy]*252 + s.miniX[wx]
						c := s.palette[index]
						for k := 0; k < 3; k++ {
							s.mini[at][k] += uint64(c[k])
						}
						s.mini[at][3]++
					}
				}
			}
			hash := sha256.Sum256(tile[:])
			var index uint32
			found := false
			for _, candidate := range s.hashes[hash] {
				if err := s.store.read(candidate, compare[:]); err != nil {
					return err
				}
				if bytes.Equal(tile[:], compare[:]) {
					index, found = candidate, true
					break
				}
			}
			if !found {
				// Past the u16 limit the tiles keep coming; finish merges them (merge.go).
				index = uint32(s.store.count)
				if err := s.store.append(tile[:]); err != nil {
					return err
				}
				s.hashes[hash] = append(s.hashes[hash], index)
			}
			i := ((chunk.Y+ty)/32)*(s.width/2) + (chunk.X+tx)/32
			s.indices[i] = index
			s.covered[i/64] |= 1 << uint(i%64)
			s.received++
		}
	}
	s.lastX, s.lastY = chunk.X, chunk.Y
	s.measure()
	return nil
}

func (s *terrainStream) measure(paths ...string) {
	if rss := peakRSS(); rss > s.metrics.PeakRSSBytes {
		s.metrics.PeakRSSBytes = rss
	}
	var disk int64
	if s.work != "" {
		if entries, err := os.ReadDir(s.work); err == nil {
			for _, entry := range entries {
				if info, err := entry.Info(); err == nil && info.Mode().IsRegular() {
					disk += info.Size()
				}
			}
		}
	} else if s.store.file != nil {
		if info, err := s.store.file.Stat(); err == nil {
			disk += info.Size()
		}
	}
	for _, path := range paths {
		if s.work != "" && filepath.Dir(path) == filepath.Clean(s.work) {
			continue
		}
		if info, err := os.Stat(path); err == nil {
			disk += info.Size()
		}
	}
	if disk > s.metrics.PeakTemporaryBytes {
		s.metrics.PeakTemporaryBytes = disk
	}
}

func runStream(ctx context.Context, req exportRequest, catalog catalog, out, work string, budget int, pack *packedFeatures) error {
	s, err := newTerrainStream(ctx, req, catalog, out, work, budget, pack)
	if err != nil {
		return err
	}
	defer s.close()
	req.Heights = nil
	encoder := json.NewEncoder(os.Stdout)
	if err := encoder.Encode(map[string]any{"ready": true, "width": s.width * 16, "height": s.height * 16, "maxChunkSide": maxChunkSide}); err != nil {
		return err
	}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 64<<10)
	// Closing stdin wakes an idle helper when cancellation arrives. A finish
	// checks the same context before publishing either complete output file.
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			os.Stdin.Close()
		case <-done:
		}
	}()
	for scanner.Scan() {
		var command struct {
			Op                  string `json:"op"`
			X, Y, Width, Height int
			Path                string `json:"path"`
		}
		d := json.NewDecoder(bytes.NewReader(scanner.Bytes()))
		d.DisallowUnknownFields()
		if err := d.Decode(&command); err != nil {
			return err
		}
		switch command.Op {
		case "chunk":
			err = s.add(preparedChunk{chunk: chunk{X: command.X, Y: command.Y, Path: command.Path}, Width: command.Width, Height: command.Height})
			if err == nil {
				err = encoder.Encode(map[string]any{"receivedTiles": s.received, "totalTiles": len(s.indices), "uniqueTiles": s.store.count, "tileLimit": s.tileLimit})
			}
		case "finish":
			var result *exportResult
			result, err = s.finish()
			if err != nil {
				return err
			}
			return encoder.Encode(result)
		case "cancel":
			return nil
		default:
			return fmt.Errorf("unknown stream command %q", command.Op)
		}
		if err != nil {
			return err
		}
	}
	return errors.Join(scanner.Err(), ctx.Err())
}
