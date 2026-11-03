package renderjob

import "fmt"

// MissingHeightTiles plans independently of image tiles. Stable world-aligned
// keys let a cached picture be revisited after its picking heights are evicted.
// Each request is bounded before the renderer adds its normal input apron.
func MissingHeightTiles(x0, y0, x1, y1, worldWidth, worldHeight, revision, span int, covered func(string) bool) []Tile {
	span = max(256, min(2048, span))
	x0 = max(0, min(worldWidth, x0))
	y0 = max(0, min(worldHeight, y0))
	x1 = max(0, min(worldWidth, x1))
	y1 = max(0, min(worldHeight, y1))
	if x0 >= x1 || y0 >= y1 {
		return nil
	}
	var out []Tile
	for y := y0 / span * span; y < y1; y += span {
		for x := x0 / span * span; x < x1; x += span {
			w, h := min(span, worldWidth-x), min(span, worldHeight-y)
			key := fmt.Sprintf("height/%d/%d/%d/%d/%d", revision, x, y, w, h)
			if covered == nil || !covered(key) {
				out = append(out, Tile{Key: key, X: x, Y: y, Width: w, Height: h, Scale: 1})
			}
		}
	}
	return out
}
