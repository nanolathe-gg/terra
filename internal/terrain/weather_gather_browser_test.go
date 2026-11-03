//go:build js && wasm

package terrain

import "testing"

func TestBrowserWeatherGatherPreservesBits(t *testing.T) { checkWeatherGatherBits(t) }
