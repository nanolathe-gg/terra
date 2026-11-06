package main

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

const tileSide = 32

type preparedChunk struct {
	chunk
	Width, Height int
}

func prepareChunks(requests []chunk, manifestDir string, w, h int) ([]preparedChunk, error) {
	if len(requests) == 0 || len(requests) > (w/tileSide)*(h/tileSide) {
		return nil, fmt.Errorf("expected 1..%d tile-aligned PNG chunks", (w/tileSide)*(h/tileSide))
	}
	covered := make([]bool, (w/tileSide)*(h/tileSide))
	chunks := make([]preparedChunk, 0, len(requests))
	for _, req := range requests {
		if req.X < 0 || req.Y < 0 || req.X >= w || req.Y >= h || req.X%tileSide != 0 || req.Y%tileSide != 0 {
			return nil, fmt.Errorf("chunk position (%d,%d) must be tile-aligned and inside %dx%d pixels", req.X, req.Y, w, h)
		}
		if req.Path == "" || strings.Contains(req.Path, "://") {
			return nil, fmt.Errorf("chunk path must name a local PNG file")
		}
		if !filepath.IsAbs(req.Path) {
			req.Path = filepath.Join(manifestDir, req.Path)
		}
		f, err := os.Open(req.Path)
		if err != nil {
			return nil, err
		}
		config, err := png.DecodeConfig(io.LimitReader(f, 64<<20))
		f.Close()
		if err != nil {
			return nil, fmt.Errorf("chunk %s: %w", req.Path, err)
		}
		cw, ch := config.Width, config.Height
		if cw <= 0 || ch <= 0 || cw%tileSide != 0 || ch%tileSide != 0 || cw > w-req.X || ch > h-req.Y {
			return nil, fmt.Errorf("chunk %s is %dx%d at (%d,%d), expected whole 32px tiles within %dx%d", req.Path, cw, ch, req.X, req.Y, w, h)
		}
		for y := req.Y; y < req.Y+ch; y += tileSide {
			for x := req.X; x < req.X+cw; x += tileSide {
				i := (y/tileSide)*(w/tileSide) + x/tileSide
				if covered[i] {
					return nil, fmt.Errorf("chunks overlap at tile (%d,%d)", x/tileSide, y/tileSide)
				}
				covered[i] = true
			}
		}
		chunks = append(chunks, preparedChunk{chunk: req, Width: cw, Height: ch})
	}
	for i, present := range covered {
		if !present {
			return nil, fmt.Errorf("no chunk covers tile (%d,%d); include the engine's outer strips", i%(w/tileSide), i/(w/tileSide))
		}
	}
	slices.SortFunc(chunks, func(a, b preparedChunk) int {
		if a.Y != b.Y {
			return a.Y - b.Y
		}
		return a.X - b.X
	})
	return chunks, nil
}

func readChunk(chunk preparedChunk) (image.Image, error) {
	// One read of the whole PNG (at most 64 MiB) rather than the decoder's
	// many small ones: each read is a system call natively, and in the browser
	// a crossing from WebAssembly to the worker's file system.
	f, err := os.Open(chunk.Path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	data := make([]byte, min(info.Size(), 64<<20))
	if _, err := io.ReadFull(f, data); err != nil {
		return nil, fmt.Errorf("chunk %s: %w", chunk.Path, err)
	}
	config, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("chunk %s: %w", chunk.Path, err)
	}
	if config.Width != chunk.Width || config.Height != chunk.Height {
		return nil, fmt.Errorf("chunk %s dimensions differ from its declared %dx%d", chunk.Path, chunk.Width, chunk.Height)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("chunk %s: %w", chunk.Path, err)
	}
	if img.Bounds() != image.Rect(0, 0, chunk.Width, chunk.Height) {
		return nil, fmt.Errorf("chunk %s changed dimensions during export", chunk.Path)
	}
	return img, nil
}

type quantizer struct {
	palette [256][3]byte
	exact   map[uint32]byte
	nearest map[uint32]byte
	recent  [1 << 12]recentColor // the last answer per hashed color: maps are slow per pixel, above all in WebAssembly
}

type recentColor struct {
	key          uint32
	index        byte
	exact, known bool
}

func newQuantizer(palette [256][3]byte) *quantizer {
	q := &quantizer{palette: palette, exact: make(map[uint32]byte), nearest: make(map[uint32]byte)}
	for i, c := range palette {
		key := rgbKey(c[0], c[1], c[2])
		if _, present := q.exact[key]; !present {
			q.exact[key] = byte(i)
		}
	}
	return q
}

func rgbKey(r, g, b byte) uint32 { return uint32(r)<<16 | uint32(g)<<8 | uint32(b) }

func (q *quantizer) index(r, g, b byte) (byte, bool) {
	key := rgbKey(r, g, b)
	slot := &q.recent[(key*2654435761)>>20]
	if slot.known && slot.key == key {
		return slot.index, slot.exact
	}
	index, exact := q.lookup(key, r, g, b)
	*slot = recentColor{key: key, index: index, exact: exact, known: true}
	return index, exact
}

func (q *quantizer) lookup(key uint32, r, g, b byte) (byte, bool) {
	if index, ok := q.exact[key]; ok {
		return index, true
	}
	if index, ok := q.nearest[key]; ok {
		return index, false
	}
	best, distance := byte(0), 3*256*256
	for i, c := range q.palette {
		dr, dg, db := int(r)-int(c[0]), int(g)-int(c[1]), int(b)-int(c[2])
		if d := dr*dr + dg*dg + db*db; d < distance {
			best, distance = byte(i), d
		}
	}
	// A bounded cache speeds repeated colours without retaining one entry for
	// every pixel of a future full-size map. There is no noise or dithering;
	// exact matches and distance ties keep the lowest palette index.
	if len(q.nearest) < 65536 {
		q.nearest[key] = best
	}
	return best, false
}
