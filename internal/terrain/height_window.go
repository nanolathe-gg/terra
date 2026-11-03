package terrain

import "math"

// HeightWindow covers the terrain coordinates that may project into a view.
// Shape and weather replay add their own dependencies; surface shading and
// material aprons are unnecessary for a picking-height readback.
func (s *SceneRenderer) HeightWindow(window SceneWindow, options DrawOptions) SceneWindow {
	_, _, _, projection := s.renderer.reaches(options.Full)
	spacing := float64(s.renderer.Size-1) / float64(max(1, s.renderer.Grid-1))
	x0 := int(math.Floor(float64(window.X) - spacing))
	y0 := int(math.Floor(float64(window.Y) + math.Min(0, projection[0]) - spacing))
	x1 := int(math.Ceil(float64(window.X+window.Width) + spacing))
	y1 := int(math.Ceil(float64(window.Y+window.Height) + math.Max(0, projection[1]) + spacing))
	x0 = clampInt(x0, 0, s.renderer.Size-1)
	y0 = clampInt(y0, 0, s.renderer.Size-1)
	x1 = clampInt(x1, 0, s.renderer.Size-1)
	y1 = clampInt(y1, 0, s.renderer.Size-1)
	return SceneWindow{X: x0, Y: y0, Width: max(1, x1-x0), Height: max(1, y1-y0), Scale: 1, ReadHeights: true, HeightsOnly: true}
}
