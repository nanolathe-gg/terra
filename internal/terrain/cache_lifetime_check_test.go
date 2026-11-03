package terrain

import (
	"context"
	"github.com/gogpu/wgpu"
	"testing"
)

func checkCacheLifetime(t *testing.T) {
	g, err := NewGPU()
	if err != nil {
		t.Fatal(err)
	}
	defer g.Close()
	s := &SceneRenderer{gpu: g}
	defer s.closeWeatherGather()
	defer s.closeShapeGather()
	makeFeed := func() *weatherFeed {
		f := &weatherFeed{GPUFeed: GPUFeed{Grid: 16, Cells: 256}, owner: g}
		alloc := func(words int) *wgpu.Buffer {
			b, e := g.Allocate("lifetime test", uint64(words*4), storageUsage)
			if e != nil {
				t.Fatal(e)
			}
			f.owned = append(f.owned, b)
			f.bytes += words * 4
			return b
		}
		f.Planes = alloc(256 * 6)
		f.Masks = alloc(256 * 7)
		f.Weather = alloc(256 * 2)
		for i := range f.Maps {
			f.Maps[i] = alloc(256)
		}
		return f
	}
	for _, weather := range []bool{false, true} {
		a, b := makeFeed(), makeFeed()
		if weather {
			err = s.copyWeather(a, b, CellRect{0, 0, 15, 15})
		} else {
			err = s.copyAuthored(&a.GPUFeed, &b.GPUFeed, CellRect{0, 0, 15, 15})
		}
		if err != nil {
			t.Fatal(err)
		}
		if a.lastUse == 0 || b.lastUse == 0 {
			t.Fatal("gather did not register cache GPU use")
		}
		used := a.lastUse
		a.Close()
		if !g.cacheUseCompleted(used) {
			t.Fatal("cache ownership was released before last GPU use completed")
		}
		if len(a.owned) != 0 {
			t.Fatal("completed cache buffers not released")
		}
		b.Close()
	}
	// A borrowed feed must not wait/free its owner's cache buffers.
	a := makeFeed()
	borrowed := &weatherFeed{GPUFeed: a.GPUFeed, borrowedFrom: a}
	borrowed.Close()
	if len(a.owned) == 0 {
		t.Fatal("borrowed view released cache ownership")
	}
	a.Close()
	if err = g.waitCacheUses(context.Background()); err != nil {
		t.Fatal(err)
	}
}
