package terrain

// BeginViewValidation removes browser per-pass validation waits for the normal
// viewport stream. All errors still reach GPU.OnError through the uncaptured
// handler. Restore before starting a capture/export; those operations, native
// rendering and initialization retain synchronous error scopes. The restore
// hook also captures a nonblocking exit fence for partial canceled/failed work.
func (s *SceneRenderer) BeginViewValidation() func() { return s.gpu.beginViewValidation() }
