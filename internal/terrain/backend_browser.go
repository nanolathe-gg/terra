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

// Browser view jobs report validation/device errors through the installed
// uncaptured handler instead of awaiting a popErrorScope promise per GPU pass.
func (g *GPU) beginViewValidation() func() {
	old := g.deferViewValidation
	g.deferViewValidation = true
	return func() { g.deferViewValidation = old }
}
