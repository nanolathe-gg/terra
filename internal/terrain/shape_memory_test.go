package terrain

import (
	"context"
	"github.com/nanolathe-gg/terraform/internal/membudget"
	"github.com/nanolathe-gg/terraform/internal/model"
	"strings"
	"testing"
)

func TestExpandedShapeRefusesBeforeGPUAllocation(t *testing.T) {
	c := ShapeWindowConfig{Grid: 4096, Spacing: 1, RefSpacing: 1, Window: CellRect{2048, 2048, 2048, 2048}, Memory: membudget.FromConfig(map[string]any{"gpuMB": 128, "heapMB": 128})}
	if err := c.Memory.Authored(1, 1); err != nil {
		t.Fatal(err)
	}
	nodes := make([]model.Node, 64)
	for i := range nodes {
		nodes[i] = model.Node{Kind: "smooth", Points: []model.Point{{X: 2048, Y: 2048}}, Params: map[string]any{"radius": 10000., "amount": 100., "softness": .5}}
	}
	// A nil GPU makes this fail immediately if any allocation is attempted before
	// the expanded dependency/temporary-buffer budget has been checked.
	s := &ShapeEngine{}
	_, err := s.EvaluateShapeWindow(context.Background(), c, nodes)
	if err == nil || !strings.Contains(err.Error(), "Expanded shape GPU buffers") {
		t.Fatalf("expected expanded target budget refusal, got %v", err)
	}
}
func TestShapeMemoryIncludesCoastPrefixAndReadback(t *testing.T) {
	c := ShapeWindowConfig{Grid: 512, Spacing: 1, Memory: membudget.FromConfig(map[string]any{"gpuMB": 128, "heapMB": 128})}
	ops := []PreparedOp{{Coast: &CoastPass{SiteFloats: 40 * 1024 * 1024}}, {PrefixReads: []model.Point{{X: 256, Y: 256}}}}
	if err := checkShapeMemory(c, ops, []int{16, 16, 16, 16, 16, 16, 16, 16}, 0, 1, false); err == nil {
		t.Fatal("coast scratch in simultaneous prefix omitted")
	}
	c.Memory.GPU = 1024 * membudget.MiB
	if err := checkShapeMemory(c, nil, []int{16, 16, 16, 16, 16, 16, 40 * 1024 * 1024, 16}, 0, 1, true); err == nil {
		t.Fatal("mapped readback copies omitted")
	}
}
