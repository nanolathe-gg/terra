//go:build !js

package terrain

import "context"

func (g *GPU) waitCacheUses(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := g.Device.WaitIdle(); err != nil {
		return err
	}
	atomicMax(&g.completedSerial, g.submittedSerial.Load())
	return nil
}

func (g *GPU) cacheUseCompleted(serial uint64) bool {
	if serial <= g.completedSerial.Load() {
		return true
	}
	atomicMax(&g.completedSerial, g.Queue.Poll())
	return serial <= g.completedSerial.Load()
}
