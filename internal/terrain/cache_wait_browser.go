//go:build js && wasm

package terrain

import "context"

func (g *GPU) waitCacheUses(ctx context.Context) error {
	g.captureViewFence()
	return g.waitView(ctx)
}

func (g *GPU) cacheUseCompleted(serial uint64) bool { return serial <= g.completedSerial.Load() }
