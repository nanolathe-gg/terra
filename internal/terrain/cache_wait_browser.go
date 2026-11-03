//go:build js && wasm

package terrain

import "context"

func (g *GPU) waitCacheUses(ctx context.Context) error {
	g.captureViewFence()
	return g.waitView(ctx)
}
