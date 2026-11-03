package terrain

import (
	"bytes"
	"context"
	"encoding/binary"
	"github.com/gogpu/wgpu"
	"testing"
)

func checkWeatherGatherBits(t *testing.T) {
	g, err := NewGPU()
	if err != nil {
		t.Fatal(err)
	}
	defer g.Close()
	s := &SceneRenderer{gpu: g}
	defer s.closeWeatherGather()
	for _, mode := range []int{0, 1, 2, 3} {
		t.Run([]string{"no material", "material", "destination-only material", "source-only material"}[mode], func(t *testing.T) {
			src := weatherFeed{GPUFeed: GPUFeed{Grid: 37, Cells: 37 * 29, OriginX: 100, OriginY: 200}}
			dst := weatherFeed{GPUFeed: GPUFeed{Grid: 40, Cells: 40 * 35, OriginX: 105, OriginY: 203}}
			type field struct {
				name        string
				words       int
				planes      bool
				src, dst    **wgpu.Buffer
				input, want []byte
			}
			fs := []field{{name: "planes", words: 6, planes: true, src: &src.Planes, dst: &dst.Planes}, {name: "masks", words: 7, src: &src.Masks, dst: &dst.Masks}, {name: "weather", words: 2, planes: true, src: &src.Weather, dst: &dst.Weather}, {name: "map0", words: 1, src: &src.Maps[0], dst: &dst.Maps[0]}, {name: "map1", words: 1, src: &src.Maps[1], dst: &dst.Maps[1]}, {name: "map2", words: 1, src: &src.Maps[2], dst: &dst.Maps[2]}}
			if mode != 0 {
				f := field{name: "material", words: 4}
				if mode == 1 || mode == 3 {
					f.src = &src.Field
				}
				if mode == 1 || mode == 2 {
					f.dst = &dst.Field
				}
				fs = append(fs, f)
			}
			for j := range fs {
				f := &fs[j]
				if f.src != nil {
					f.input = make([]byte, src.Cells*f.words*4)
					for i := 0; i < len(f.input)/4; i++ {
						v := uint32(i)*2654435761 ^ uint32(j)*2246822519
						if i%13 == 0 {
							v = 0x7fc01234
						}
						if i%17 == 0 {
							v = 0x80000000
						}
						binary.LittleEndian.PutUint32(f.input[i*4:], v)
					}
					*f.src, err = g.Buffer("raw weather source", f.input, storageUsage)
					if err != nil {
						t.Fatal(err)
					}
					defer (*f.src).Release()
				}
				if f.dst != nil {
					f.want = make([]byte, dst.Cells*f.words*4)
					for i := 0; i < len(f.want)/4; i++ {
						binary.LittleEndian.PutUint32(f.want[i*4:], 0xa5a5a5a5)
					}
					*f.dst, err = g.Buffer("weather destination", f.want, storageUsage)
					if err != nil {
						t.Fatal(err)
					}
					defer (*f.dst).Release()
				}
			}
			rect := CellRect{109, 207, 128, 220}
			if err = s.copyWeather(&src, &dst, rect); err != nil {
				t.Fatal(err)
			}
			for _, f := range fs {
				if f.dst == nil {
					continue
				}
				if f.src != nil {
					for y := rect.Y0; y <= rect.Y1; y++ {
						for x := rect.X0; x <= rect.X1; x++ {
							a := (y-src.OriginY)*src.Grid + x - src.OriginX
							b := (y-dst.OriginY)*dst.Grid + x - dst.OriginX
							for k := 0; k < f.words; k++ {
								ia, ib := a*f.words+k, b*f.words+k
								if f.planes {
									ia, ib = k*src.Cells+a, k*dst.Cells+b
								}
								copy(f.want[ib*4:ib*4+4], f.input[ia*4:ia*4+4])
							}
						}
					}
				}
				got, e := g.ReadBuffer(context.Background(), *f.dst, 0, uint64(len(f.want)))
				if e != nil {
					t.Fatal(e)
				}
				if !bytes.Equal(got, f.want) {
					t.Fatalf("%s changed raw bits or wrote outside rectangle", f.name)
				}
			}
		})
	}
}

func TestBorrowContainedWeatherCore(t *testing.T) {
	page := &weatherFeed{GPUFeed: GPUFeed{Grid: 512, Cells: 512 * 512, OriginX: 512, OriginY: 1024}, bytes: 12345}
	s := &SceneRenderer{weatherPages: map[[2]int]*weatherFeed{{1, 2}: page}}
	b := s.borrowWeatherPage(CellRect{540, 1050, 670, 1180}, 512)
	if b == nil || b.borrowedFrom != page || b.Grid != 512 || b.OriginX != 512 || b.OriginY != 1024 || b.bytes != 0 || len(b.owned) != 0 {
		t.Fatal("contained window did not borrow original GPU lattice")
	}
	b.Close()
	if page.used == 0 || page.bytes != 12345 {
		t.Fatal("borrow changed page ownership")
	}
	if s.borrowWeatherPage(CellRect{500, 1050, 520, 1180}, 512) != nil {
		t.Fatal("cross-core window cannot borrow one page")
	}
}
