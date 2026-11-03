//go:build !js

package terrain

import "context"

func (g *GPU) waitCacheUses(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return g.Device.WaitIdle()
}
