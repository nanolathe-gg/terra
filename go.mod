module github.com/nanolathe-gg/terraform

go 1.27.1

require github.com/nanolathe-gg/nanolathe v0.3.1-0.20261027042758-f3ef0a8ad4ae

require (
	github.com/go-webgpu/goffi v0.6.8 // indirect
	github.com/go-webgpu/webgpu v0.5.5 // indirect
	github.com/gogpu/gpucontext v0.31.3 // indirect
	github.com/gogpu/gputypes v0.8.2 // indirect
	github.com/gogpu/naga v0.21.2 // indirect
	github.com/gogpu/wgpu v0.34.7 // indirect
)

// Browser error scopes are implemented in the pinned local production source.
replace github.com/gogpu/wgpu => ./third_party/wgpu
