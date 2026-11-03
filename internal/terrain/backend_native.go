//go:build !js && !rust

package terrain

import (
	"runtime"

	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
	_ "github.com/gogpu/wgpu/hal/allbackends"
)

func instanceDescriptor() *wgpu.InstanceDescriptor {
	backends := gputypes.BackendsPrimary
	if runtime.GOOS == "darwin" {
		backends = gputypes.BackendsMetal
	}
	return &wgpu.InstanceDescriptor{Backends: backends}
}
func (g *GPU) installErrorHandler() {}

func (g *GPU) beginViewValidation() func() { return func() {} }
