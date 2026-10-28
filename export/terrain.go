package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/nanolathe-gg/nanolathe/formats"
)

const tileSide = 32

type preparedChunk struct {
	chunk
	Width, Height int
}

func terrain(req exportRequest, manifestDir string, palette [256][3]byte) (formats.TNTWrite, *image.Paletted, int, int, error) {
	w, h := req.UnitsX*32+2, req.UnitsY*32+8
	pixelW, pixelH := w*16, h*16
	t := formats.TNTWrite{
		Width: w, Height: h, SeaLevel: byte(*req.SeaLevel),
		Heights: make([]byte, w*h), Features: make([]uint16, w*h),
		TileIndices: make([]uint16, (w/2)*(h/2)),
	}
	for i, height := range req.Heights {
		t.Heights[i], t.Features[i] = byte(height), 0xFFFF
	}
	chunks, err := prepareChunks(req.Chunks, manifestDir, pixelW, pixelH)
	if err != nil {
		return t, nil, 0, 0, err
	}
	colors := make(color.Palette, len(palette))
	for i, c := range palette {
		colors[i] = color.RGBA{R: c[0], G: c[1], B: c[2], A: 255}
	}
	picture := image.NewPaletted(image.Rect(0, 0, pixelW, pixelH), colors)
	quantize := newQuantizer(palette)
	tiles := make(map[[tileSide * tileSide]byte]uint16)
	exact, nearest := 0, 0
	// Chunk boundaries are in final screen pixels. The editor has already
	// applied worldY-height/2; applying height again would shift the art.
	// Only one decoded chunk is retained, ready for the phase-3 streaming loop.
	for _, chunk := range chunks {
		img, err := readChunk(chunk)
		if err != nil {
			return t, nil, 0, 0, err
		}
		for ty := 0; ty < chunk.Height; ty += tileSide {
			for tx := 0; tx < chunk.Width; tx += tileSide {
				var tile [tileSide * tileSide]byte
				for y := 0; y < tileSide; y++ {
					for x := 0; x < tileSide; x++ {
						r, g, b, a := img.At(tx+x, ty+y).RGBA()
						if a != 0xFFFF {
							return t, nil, 0, 0, fmt.Errorf("chunk %s has transparency at (%d,%d); expected opaque final art", chunk.Path, tx+x, ty+y)
						}
						index, wasExact := quantize.index(byte(r>>8), byte(g>>8), byte(b>>8))
						if wasExact {
							exact++
						} else {
							nearest++
						}
						tile[y*tileSide+x] = index
					}
					at := (chunk.Y+ty+y)*picture.Stride + chunk.X + tx
					copy(picture.Pix[at:at+tileSide], tile[y*tileSide:(y+1)*tileSide])
				}
				index, ok := tiles[tile]
				if !ok {
					if len(tiles) >= 1<<16 {
						return t, nil, 0, 0, fmt.Errorf("more than 65536 distinct tiles cannot fit TNT's tile indices")
					}
					index = uint16(len(tiles))
					tiles[tile] = index
					t.TileGraphics = append(t.TileGraphics, tile[:]...)
				}
				t.TileIndices[((chunk.Y+ty)/tileSide)*(w/2)+(chunk.X+tx)/tileSide] = index
			}
		}
	}
	t.MinimapWidth, t.MinimapHeight, t.Minimap = minimap(t)
	return t, picture, exact, nearest, nil
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
	f, err := os.Open(chunk.Path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, err := png.Decode(io.LimitReader(f, 64<<20))
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

// Follow [fmt tnt] "Minimap" and internal/mapgen/paint.go: fit the play area
// to a 252px long side, sample its indexed art, and fill the unused short axis
// with 0x64. The raw terrain includes strips outside that play area.
func minimap(t formats.TNTWrite) (int, int, []byte) {
	const side = 252
	playW, playH := t.Width*16-32, t.Height*16-128
	usedW, usedH := side, side
	if playW < playH {
		usedW = playW * side / playH
	} else {
		usedH = playH * side / playW
	}
	out := make([]byte, side*side)
	for y := 0; y < side; y++ {
		for x := 0; x < side; x++ {
			if x >= usedW || y >= usedH {
				out[y*side+x] = 0x64
				continue
			}
			wx, wy := x*playW/usedW, y*playH/usedH
			index := int(t.TileIndices[(wy/tileSide)*(t.Width/2)+wx/tileSide])
			out[y*side+x] = t.TileGraphics[index*tileSide*tileSide+(wy%tileSide)*tileSide+wx%tileSide]
		}
	}
	return side, side, out
}
