package terrain

import "math"

// HeightWindow covers the source terrain projected into a view, including the
// renderer's input apron. Its CPU copy is refreshed once after a view settles.
func (s *SceneRenderer) HeightWindow(window SceneWindow, options DrawOptions) SceneWindow {
	r := s.renderer.RequiredRegion(window, options.Full)
	x, y := int(math.Floor(float64(r.GridX)*r.GridSpacing)), int(math.Floor(float64(r.GridY)*r.GridSpacing))
	x1, y1 := int(math.Ceil(float64(r.GridX+r.GridWidth-1)*r.GridSpacing)), int(math.Ceil(float64(r.GridY+r.GridHeight-1)*r.GridSpacing))
	return SceneWindow{X: x, Y: y, Width: max(1, x1-x), Height: max(1, y1-y), Scale: 1, ReadHeights: true, HeightsOnly: true}
}
