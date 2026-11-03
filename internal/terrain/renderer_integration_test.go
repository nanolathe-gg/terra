//go:build !js

package terrain

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"github.com/gogpu/gputypes"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestNativeTerrain(t *testing.T) {
	if os.Getenv("TERRAFORM_GPU_TEST") == "" {
		t.Skip("set TERRAFORM_GPU_TEST=1 for hardware test")
	}
	g, e := NewGPU()
	if e != nil {
		t.Fatal(e)
	}
	defer g.Close()
	t.Logf("adapter: %+v", g.Adapter.Info())
	if runtime.GOOS == "darwin" && g.Adapter.Info().Backend != gputypes.BackendMetal {
		t.Fatalf("expected Metal, got %v", g.Adapter.Info().Backend)
	}
	root := "../.."
	sources := map[string]string{}
	for _, name := range []string{"sculpt-vert.wgsl", "engine-frag.wgsl", "engine-common.wgsl", "engine-bake.wgsl", "engine-materials.wgsl", "engine-palette.wgsl", "engine-weather.wgsl", "engine-erosion.wgsl", "engine-feed.wgsl", "materials/palette.json"} {
		b, e := os.ReadFile(filepath.Join(root, name))
		if e != nil {
			t.Fatal(e)
		}
		sources[name] = string(b)
	}
	data, e := os.ReadFile(filepath.Join(root, "materials/green.json"))
	if e != nil {
		t.Fatal(e)
	}
	var material map[string]any
	if e = json.Unmarshal(data, &material); e != nil {
		t.Fatal(e)
	}
	config := map[string]any{"grid": 33, "size": 128, "baseHeight": 24., "seaLevel": 0., "material": material["material"], "water": material["water"]}
	for k, v := range object(material, "world") {
		config[k] = v
	}
	config["grid"] = 33
	config["size"] = 128
	r, e := NewRenderer(g, config, sources, material)
	if e != nil {
		t.Fatal(e)
	}
	defer r.Close()
	h := make([]float32, 33*33)
	for y := 0; y < 33; y++ {
		for x := 0; x < 33; x++ {
			h[y*33+x] = 24 + float32(x+y)*.6
		}
	}
	if e = r.SetHeight(h); e != nil {
		t.Fatal(e)
	}
	if e = r.Render(DrawOptions{Width: 128, Height: 128, Full: true, Resolution: 64, Detail: 1, Ring: .85, RingSpread: .65, RingVariation: .7, TransitionDetail: .65}); e != nil {
		t.Fatal(e)
	}
	pixels, e := r.ReadRGBA(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	if len(pixels) != 128*128*4 {
		t.Fatal(len(pixels))
	}
	t.Logf("terrain: %d bytes SHA256 %x", len(pixels), sha256.Sum256(pixels))
	first := pixels[:4]
	different := false
	for i := 4; i < len(pixels); i += 4 {
		for k := 0; k < 3; k++ {
			different = different || pixels[i+k] != first[k]
		}
	}
	if !different {
		t.Fatal("terrain render is a flat clear color")
	}
	config["chunked"] = true
	chunk, e := NewRenderer(g, config, sources, material)
	if e != nil {
		t.Fatal(e)
	}
	defer chunk.Close()
	window := SceneWindow{X: 16, Y: 16, Width: 64, Height: 64, Scale: 1}
	reg := chunk.RequiredRegion(window, true)
	regional := make([]float32, reg.GridWidth*reg.GridHeight)
	for y := 0; y < reg.GridHeight; y++ {
		for x := 0; x < reg.GridWidth; x++ {
			regional[y*reg.GridWidth+x] = h[(reg.GridY+y)*33+reg.GridX+x]
		}
	}
	cp, e := chunk.RenderWindow(context.Background(), WindowInput{Window: window, Region: reg, Heights: regional}, DrawOptions{Full: true, Detail: 1, Ring: .85, RingSpread: .65, RingVariation: .7, TransitionDetail: .65})
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("chunk: %d bytes SHA256 %x", len(cp), sha256.Sum256(cp))
	if len(cp) != 64*64*4 {
		t.Fatal(len(cp))
	}
	repeat, e := chunk.RenderWindow(context.Background(), WindowInput{Window: window, Region: reg, Heights: regional}, DrawOptions{Full: true, Detail: 1, Ring: .85, RingSpread: .65, RingVariation: .7, TransitionDetail: .65})
	if e != nil {
		t.Fatal(e)
	}
	if sha256.Sum256(cp) != sha256.Sum256(repeat) {
		t.Fatal("repeated chunk mismatch")
	}

	erosion, e := r.NewErosion()
	if e != nil {
		t.Fatal(e)
	}
	defer erosion.Close()
	planes := make([]float32, 33*33*6)
	copy(planes, h)
	pb, e := g.Buffer("test planes", FloatBytes(planes), storageUsage)
	if e != nil {
		t.Fatal(e)
	}
	defer pb.Release()
	mb, e := g.Buffer("test masks", make([]byte, 33*33*7*4), gputypes.BufferUsageStorage)
	if e != nil {
		t.Fatal(e)
	}
	defer mb.Release()
	er, e := erosion.RunGPU(context.Background(), ErosionRequest{Planes: pb, Masks: mb, Grid: 33, Size: 128, Age: 2, Rain: 1, TalusAngle: 30, SeaLevel: 0, RateMask: 14})
	if e != nil {
		t.Fatal(e)
	}
	defer er.Close()
	raw, e := g.ReadBuffer(context.Background(), er.Weather, 0, 33*33*8)
	if e != nil {
		t.Fatal(e)
	}
	for i := 0; i < len(raw)/4; i++ {
		v := math.Float32frombits(binary.LittleEndian.Uint32(raw[i*4:]))
		if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
			t.Fatalf("nonfinite time sample %d", i)
		}
	}
	t.Logf("weather: %d bytes SHA256 %x", len(raw), sha256.Sum256(raw))
	mf, e := erosion.MaterialField(MaterialFieldRequest{Height: er.Weather, HeightOffset: 33 * 33, Grid: 33, Size: 128, BaseHeight: 24, DepositSpread: .65, Seed: 2701, Profile: object(config, "material")})
	if e != nil {
		t.Fatal(e)
	}
	defer mf.Release()
	mraw, e := g.ReadBuffer(context.Background(), mf, 0, 33*33*16)
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("material field: %d bytes SHA256 %x", len(mraw), sha256.Sum256(mraw))

}
