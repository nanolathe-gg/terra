//go:build !js

package terrain

import (
	"bytes"
	"context"
	"encoding/binary"
	"os"
	"testing"

	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
)

func TestAuthoredGatherPreservesBits(t *testing.T) {
	if os.Getenv("TERRAFORM_GPU_TEST") == "" {
		t.Skip("set TERRAFORM_GPU_TEST=1 for hardware test")
	}
	g, err := NewGPU()
	if err != nil {
		t.Fatal(err)
	}
	defer g.Close()
	s := &SceneRenderer{gpu: g}
	defer s.closeShapeGather()
	src := GPUFeed{Grid: 37, Cells: 37 * 29, OriginX: 100, OriginY: 200}
	dst := GPUFeed{Grid: 40, Cells: 40 * 35, OriginX: 105, OriginY: 203}
	sourcePlanes := make([]byte, src.Cells*6*4)
	sourceMasks := make([]byte, src.Cells*7*4)
	dstPlanes := make([]byte, dst.Cells*6*4)
	dstMasks := make([]byte, dst.Cells*7*4)
	for i := 0; i < len(sourcePlanes)/4; i++ {
		binary.LittleEndian.PutUint32(sourcePlanes[i*4:], uint32(i)*2654435761)
	}
	for i := 0; i < len(sourceMasks)/4; i++ {
		binary.LittleEndian.PutUint32(sourceMasks[i*4:], uint32(i)*2246822519)
	}
	for i := 0; i < len(dstPlanes)/4; i++ {
		binary.LittleEndian.PutUint32(dstPlanes[i*4:], 0x7fc01234)
	}
	for i := 0; i < len(dstMasks)/4; i++ {
		binary.LittleEndian.PutUint32(dstMasks[i*4:], 0xa5a5a5a5)
	}
	usage := gputypes.BufferUsageStorage | gputypes.BufferUsageCopySrc | gputypes.BufferUsageCopyDst
	buffers := []struct {
		data []byte
		out  **wgpu.Buffer
	}{{sourcePlanes, &src.Planes}, {sourceMasks, &src.Masks}, {dstPlanes, &dst.Planes}, {dstMasks, &dst.Masks}}
	for _, x := range buffers {
		*x.out, err = g.Buffer("gather test", x.data, usage)
		if err != nil {
			t.Fatal(err)
		}
		defer (*x.out).Release()
	}
	rect := CellRect{109, 207, 128, 220}
	if err = s.copyAuthored(&src, &dst, rect); err != nil {
		t.Fatal(err)
	}
	for y := rect.Y0; y <= rect.Y1; y++ {
		for x := rect.X0; x <= rect.X1; x++ {
			a := (y-src.OriginY)*src.Grid + x - src.OriginX
			b := (y-dst.OriginY)*dst.Grid + x - dst.OriginX
			for k := 0; k < 6; k++ {
				copy(dstPlanes[(k*dst.Cells+b)*4:], sourcePlanes[(k*src.Cells+a)*4:(k*src.Cells+a+1)*4])
			}
			copy(dstMasks[b*28:(b+1)*28], sourceMasks[a*28:(a+1)*28])
		}
	}
	gotPlanes, err := g.ReadBuffer(context.Background(), dst.Planes, 0, uint64(len(dstPlanes)))
	if err != nil {
		t.Fatal(err)
	}
	gotMasks, err := g.ReadBuffer(context.Background(), dst.Masks, 0, uint64(len(dstMasks)))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(gotPlanes, dstPlanes) || !bytes.Equal(gotMasks, dstMasks) {
		t.Fatal("gather changed a word or wrote outside the requested rectangle")
	}
}
