//go:build js && wasm

package editor

import "github.com/nanolathe-gg/terraform/internal/renderjob"

var graphEncoders = map[*App]*renderjob.GraphEncoder{}

// postRequest sends complete non-graph request metadata and a sequence-checked
// graph suffix. Encoding occurs before postMessage so every posted baseline is
// observed in order by the receiving worker, even when queued jobs are dropped.
func (a *App) postRequest(job renderjob.Request) {
	encoder := graphEncoders[a]
	if encoder == nil {
		encoder = &renderjob.GraphEncoder{}
		graphEncoders[a] = encoder
	}
	switch job.Kind {
	case "init":
		encoder.Reset()
	case "cancel", "uniforms":
	default:
		job.Graph = encoder.Encode(job.Nodes)
		job.Nodes = nil
	}
	a.worker.Call("postMessage", jsObject(job))
}
