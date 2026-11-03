//go:build rust && !js

package terrain

import (
	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
	"runtime"
)

func instanceDescriptor() *wgpu.InstanceDescriptor {
	backends := gputypes.BackendsPrimary
	if runtime.GOOS == "darwin" {
		backends = gputypes.BackendsMetal
	}
	return &wgpu.InstanceDescriptor{Backends: backends}
}
func (g *GPU) installErrorHandler() {}
