package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/nanolathe-gg/nanolathe/tools/map-editor/mapdata"
)

const maxChunkSide = 4096

type exportMetrics struct {
	PeakRSSBytes       int64 `json:"peakRSSBytes"`
	PeakTemporaryBytes int64 `json:"peakTemporaryBytes"`
	ExportMilliseconds int64 `json:"exportMilliseconds"`
}

type tileStore struct {
	memory []byte
	budget int
	file   *os.File
	dir    string
	count  int
}

func (s *tileStore) append(tile []byte) error {
	if s.file == nil && len(s.memory)+len(tile) > s.budget {
		f, err := os.CreateTemp(s.dir, "nanolathe-map-tiles-*")
		if err != nil {
			return err
		}
		s.file = f
		if _, err = f.Write(s.memory); err != nil {
			return err
		}
	}
	if s.file != nil {
		if _, err := s.file.Write(tile); err != nil {
			return err
		}
	}
	// Retain the initial budget as a read cache, since base-ground tiles
	// commonly recur throughout a map. The rest exists only on disk.
	if len(s.memory)+len(tile) <= s.budget {
		s.memory = append(s.memory, tile...)
	}
	s.count++
	return nil
}

func (s *tileStore) read(index uint16, out []byte) error {
	at := int(index) * 1024
	if at+1024 <= len(s.memory) {
		copy(out, s.memory[at:at+1024])
		return nil
	}
	if s.file == nil {
		return fmt.Errorf("tile %d is absent", index)
	}
	_, err := s.file.ReadAt(out, int64(at))
	return err
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
	indices        []uint16
	covered        []uint64
	received       int
	lastX, lastY   int
	hashes         map[[32]byte][]uint16
	store          tileStore
	order          []uint16
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

func newTerrainStream(ctx context.Context, req exportRequest, catalog catalog, out, work string, tileBudget int, allowed map[string]mapdata.Feature) (*terrainStream, error) {
	world, err := validateRequest(req, catalog)
	if err != nil {
		return nil, err
	}
	starts, err := mapStarts(req)
	if err != nil {
		return nil, err
	}
	names, features, err := encodeFeatures(req, allowed)
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
	s := &terrainStream{ctx: ctx, req: req, world: world, starts: starts, width: w, height: h, heights: heights, features: features, names: names,
		indices: make([]uint16, (w/2)*(h/2)), covered: make([]uint64, ((w/2)*(h/2)+63)/64), hashes: make(map[[32]byte][]uint16),
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
					r, g, b, a := img.At(tx+x, ty+y).RGBA()
					if a != 0xffff {
						return fmt.Errorf("chunk has transparency at (%d,%d); expected opaque final art", tx+x, ty+y)
					}
					index, exact := s.quantize.index(byte(r>>8), byte(g>>8), byte(b>>8))
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
			var index uint16
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
				if s.store.count >= 1<<16 {
					return fmt.Errorf("more than 65536 distinct tiles cannot fit TNT's u16 tile indices; exact export stopped (tile merging belongs to phase 4)")
				}
				index = uint16(s.store.count)
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
	var usage syscall.Rusage
	if syscall.Getrusage(syscall.RUSAGE_SELF, &usage) == nil {
		rss := usage.Maxrss
		if runtime.GOOS != "darwin" {
			rss *= 1024
		}
		if rss > s.metrics.PeakRSSBytes {
			s.metrics.PeakRSSBytes = rss
		}
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

func runStream(ctx context.Context, req exportRequest, catalog catalog, out, work string, budget int, allowed map[string]mapdata.Feature) error {
	s, err := newTerrainStream(ctx, req, catalog, out, work, budget, allowed)
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
				err = encoder.Encode(map[string]any{"receivedTiles": s.received, "totalTiles": len(s.indices), "uniqueTiles": s.store.count})
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
