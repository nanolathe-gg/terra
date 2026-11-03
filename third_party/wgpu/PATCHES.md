# Terraform's pinned gogpu/wgpu source

Upstream: https://github.com/gogpu/wgpu, version v0.34.7,
commit a7b9b6e85d5d3765b443f2870249d37c31066fe4 (the browser-backend revision selected for this port).
License: MIT; see LICENSE. This tree contains production Go/platform source,
go.mod and go.sum. Upstream tests, examples, commands, docs and Git metadata
are excluded; all supported backend platform implementations are preserved.

Local changes in device_browser.go:

* Implement PushErrorScope and PopErrorScope with the browser's WebGPU API and
  the upstream AwaitPromise helper. Upstream stubs panic; a terrain validation
  failure otherwise arrives only as a browser warning while an invalid command
  buffer can leave a blank image.
* Add SetUncapturedErrorHandler for asynchronous GPU validation and device loss.
  It returns a listener-removal function for resource cleanup.

Terraform otherwise uses upstream public APIs. Its depth-only render attachment
sets StencilReadOnly=true to omit nonexistent stencil operations in the browser
backend without reducing depth precision. Its native material mip passes copy
previous levels to separate GPU textures to avoid the upstream native tracker's
whole-texture read/write conflict across distinct mip subresources. No shader
arithmetic or texture data is changed by either workaround.
