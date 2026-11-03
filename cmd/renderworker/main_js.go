//go:build js && wasm

package main

import "github.com/nanolathe-gg/terraform/internal/editorworker"

func main() { editorworker.Run(); select {} }
