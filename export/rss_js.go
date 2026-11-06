//go:build js && wasm

package main

// peakRSS has no reading inside WebAssembly: the Go runtime's MemStats.Sys
// counts address space it reserved but never grew linear memory for (492 MB
// against 206 MB of linear memory, measured on a 40x40 export). The browser's
// worker reports the module's linear memory instead, which never shrinks, so
// its size at the end is the peak (sculpt-export-worker.js).
func peakRSS() int64 { return 0 }
