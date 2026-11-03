//go:build js && wasm

package terrain

import (
	"github.com/gogpu/wgpu"
)

func instanceDescriptor() *wgpu.InstanceDescriptor { return nil }
func (g *GPU) installErrorHandler() {
	g.removeErrorHandler = g.Device.SetUncapturedErrorHandler(func(e error) {
		g.errorMu.Lock()
		g.asyncError = e
		handler := g.OnError
		g.errorMu.Unlock()
		if handler != nil {
			handler(e)
		}
	})
}
