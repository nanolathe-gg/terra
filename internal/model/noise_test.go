package model

import (
	"crypto/sha256"
	"fmt"
	"testing"
)

func TestNoiseMatchesReference(t *testing.T) {
	got := fmt.Sprintf("%x", sha256.Sum256(MakeNoise(NoiseSize)))
	const want = "dafa719147922f73b1c9b72b0a484b4db4384e9599a938d1640c8df05271c6e2"
	if got != want {
		t.Fatalf("noise hash %s; want %s", got, want)
	}
}
