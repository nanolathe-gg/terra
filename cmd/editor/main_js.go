//go:build js && wasm

package main

import "github.com/nanolathe-gg/terraform/internal/editor"

func main() { editor.Run(); select {} }
