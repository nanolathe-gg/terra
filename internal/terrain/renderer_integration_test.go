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
			h[y*33+x] = float32(24 + float64(x+y)*float64(float32(.6)))
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

	for _, scale := range []float64{.5, 2, 4} {
		window.Scale = scale
		opts := DefaultDrawOptions(config)
		opts.MaterialWeathering = 0
		scaled, e := chunk.RenderWindow(context.Background(), WindowInput{Window: window, Region: reg, Heights: regional}, opts)
		if e != nil {
			t.Fatal(e)
		}
		t.Logf("scale %g: %d bytes SHA256 %x", scale, len(scaled), sha256.Sum256(scaled))
	}
	window.Scale = 1
	chunk.SetColors(map[string][]float64{"ground": {.3, .4, .5}, "slope": {.2, .3, .4}, "rock": {.5, .3, .2}, "beach": {.4, .5, .3}})
	colors, e := chunk.RenderWindow(context.Background(), WindowInput{Window: window, Region: reg, Heights: regional}, DefaultDrawOptions(config))
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("colors SHA256 %x; means %+v", sha256.Sum256(colors), chunk.means)
	chunk.SetColors(nil)
	chunk.ApplyKnobs(map[string]string{"microRock": ".35", "rockOrder": ".7", "banding": ".4", "bedSpacing": "8", "shineRock": ".8", "shineRockSharp": "18", "waterSoft": "20", "faceSlope": "0.2,0.8", "rockShare": "0.3,0.9", "faceScore": "0.4,1.4,0.6,0.2", "columnContrast": ".7", "groundTiles": "8", "moss": ".2", "rim": ".15", "reliefAmount": ".35", "sun": "45,20"})
	knobOptions := DefaultDrawOptions(config)
	knobOptions.MaterialWeathering = 0
	knobPixels, e := chunk.RenderWindow(context.Background(), WindowInput{Window: window, Heights: regional}, knobOptions)
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("dynamic knobs SHA256 %x", sha256.Sum256(knobPixels))
	strataRenderer, e := NewRenderer(g, config, sources, material)
	if e != nil {
		t.Fatal(e)
	}
	defer strataRenderer.Close()
	strataRenderer.ApplyKnobs(map[string]string{"strata": ".8", "strataContrast": ".7", "strataGrain": ".9"})
	strataOptions := DefaultDrawOptions(config)
	strataOptions.MaterialWeathering = 0
	strataPixels, e := strataRenderer.RenderWindow(context.Background(), WindowInput{Window: window, Heights: regional}, strataOptions)
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("strata colors SHA256 %x", sha256.Sum256(strataPixels))
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
	if out := os.Getenv("TERRAFORM_GPU_DUMP"); out != "" {
		check(os.WriteFile(filepath.Join(out, "native-weather.bin"), raw, 0644))
	}
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
	if out := os.Getenv("TERRAFORM_GPU_DUMP"); out != "" {
		check(os.WriteFile(filepath.Join(out, "native-material.bin"), mraw, 0644))
	}

	window.Scale = 1
	chunk.SetColors(nil)
	chunk.ApplyKnobs(map[string]string{"microRock": "1", "rockOrder": "0", "banding": "0", "bedSpacing": "12", "shineRock": "0", "shineRockSharp": "24", "waterSoft": "32", "faceSlope": "0.35,0.9", "rockShare": "0.2,1.0", "faceScore": "0.2,2.0,0.5,0.3", "columnContrast": "1", "groundTiles": "16", "moss": "0", "rim": "0", "reliefAmount": "0.5", "sun": ""})
	feedPixels, e := chunk.RenderWindow(context.Background(), WindowInput{Window: window, Region: reg, Feed: &GPUFeed{Planes: pb, Masks: mb, Weather: er.Weather, Maps: er.Maps, Field: mf, Grid: 33, Cells: 33 * 33, MaskCount: 25}}, DefaultDrawOptions(config))
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("native GPU feed %d bytes SHA256 %x", len(feedPixels), sha256.Sum256(feedPixels))

}
