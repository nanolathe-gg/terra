//go:build !js

package terrain

import (
	"os"
	"testing"
)

func TestWeatherGatherPreservesBits(t *testing.T) {
	if os.Getenv("TERRAFORM_GPU_TEST") == "" {
		t.Skip("set TERRAFORM_GPU_TEST=1 for hardware test")
	}
	checkWeatherGatherBits(t)
}
