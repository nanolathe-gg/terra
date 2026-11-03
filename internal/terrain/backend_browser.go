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
	ended := false
	return func() {
		if ended {
			return
		}
		ended = true
		// Include partial submissions from canceled/failed views that never reached
		// presentation. Recording a callback does not await the GPU on this path.
		g.captureViewFence()
		g.deferViewValidation = old
	}
}

func (g *GPU) captureViewFence() {
	completion := make(chan error, 1)
	g.Queue.OnSubmittedWorkDone(func(err error) {
		if err != nil {
			g.errorMu.Lock()
			g.asyncError = err
			handler := g.OnError
			g.errorMu.Unlock()
			if handler != nil {
				handler(err)
			}
		}
		completion <- err
		close(completion)
	})
	g.viewDone = completion
}
