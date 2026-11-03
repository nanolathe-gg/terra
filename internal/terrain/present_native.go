//go:build !js

package terrain

import "context"

// Native/export rendering already synchronizes its requested readbacks.
func (s *SceneRenderer) WaitView(ctx context.Context) error { return ctx.Err() }
