package model

import "math"

// PickTerrain traces the editor's projected vertical ray from front to back.
// It returns the first crossing and interpolates between adjacent samples.
func PickTerrain(x, screenY, width, height, seaLevel, baseHeight float64, sample func(x, y float64) float64) Point {
	x = math.Max(0, math.Min(width-1, x))
	previousY := screenY + 170
	valueAt := func(y float64) float64 { return y - (math.Max(seaLevel, sample(x, y))-baseHeight)/2 - screenY }
	previous := valueAt(previousY)
	for y := previousY - 2; y >= screenY-80; y -= 2 {
		value := valueAt(y)
		if value <= 0 && previous >= 0 {
			hit := previousY - 2*previous/math.Max(1e-6, previous-value)
			return Point{X: x, Y: math.Max(0, math.Min(height-1, hit))}
		}
		previous, previousY = value, y
	}
	return Point{X: x, Y: math.Max(0, math.Min(height-1, screenY))}
}
