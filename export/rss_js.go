//go:build js && wasm

package main

import "runtime"

// peakRSS is the memory the Go runtime has taken from WebAssembly's linear
// memory, which never shrinks, so it is also the high-water mark.
func peakRSS() int64 {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	return int64(stats.Sys)
}
