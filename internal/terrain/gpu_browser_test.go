//go:build js && wasm

package terrain

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
	"io"
	"net/http"
	"syscall/js"
	"testing"
)

func TestBrowserValidationScope(t *testing.T) {
	g, e := NewGPU()
	if e != nil {
		t.Fatal(e)
	}
	defer g.Close()
	g.Device.PushErrorScope(wgpu.ErrorFilterValidation)
	b, e := g.Device.CreateBuffer(&wgpu.BufferDescriptor{Label: "intentional invalid usage", Size: 16, Usage: 0})
	if b != nil {
		defer b.Release()
	}
	if e != nil {
		t.Log(e)
	}
	if validation := g.Device.PopErrorScope(); validation == nil {
		t.Fatal("invalid GPU buffer escaped error scope")
	} else {
		t.Logf("captured expected validation: %s", validation.Message)
	}
}
func TestBrowserTerrain(t *testing.T) {
	g, e := NewGPU()
	if e != nil {
		t.Fatal(e)
	}
	defer g.Close()
	origin := js.Global().Get("location").Get("origin").String()
	sources := map[string]string{}
	for _, name := range []string{"sculpt-vert.wgsl", "engine-common.wgsl", "engine-frag.wgsl", "engine-bake.wgsl", "engine-materials.wgsl", "engine-palette.wgsl", "engine-weather.wgsl", "engine-erosion.wgsl", "engine-feed.wgsl", "materials/palette.json", "materials/green.json"} {
		res, e := http.Get(origin + "/" + name)
		if e != nil {
			t.Fatal(e)
		}
		data, e := io.ReadAll(res.Body)
		res.Body.Close()
		if e != nil {
			t.Fatal(e)
		}
		sources[name] = string(data)
	}
	var material map[string]any
	if e = json.Unmarshal([]byte(sources["materials/green.json"]), &material); e != nil {
		t.Fatal(e)
	}
	config := map[string]any{"grid": 33, "size": 128, "baseHeight": 24., "seaLevel": 0., "material": material["material"], "water": material["water"], "chunked": true}
	for k, v := range object(material, "world") {
		config[k] = v
	}
	config["grid"], config["size"] = 33, 128
	r, e := NewRenderer(g, config, sources, material)
	if e != nil {
		t.Fatal(e)
	}
	defer r.Close()
	window := SceneWindow{X: 16, Y: 16, Width: 64, Height: 64, Scale: 1}
	reg := r.RequiredRegion(window, true)
	h := make([]float32, reg.GridWidth*reg.GridHeight)
	for y := 0; y < reg.GridHeight; y++ {
		for x := 0; x < reg.GridWidth; x++ {
			h[y*reg.GridWidth+x] = float32(24 + float64(reg.GridX+x+reg.GridY+y)*float64(float32(.6)))
		}
	}
	p, e := r.RenderWindow(context.Background(), WindowInput{Window: window, Region: reg, Heights: h}, DrawOptions{Full: true, Detail: 1, Ring: .85, RingSpread: .65, RingVariation: .7, TransitionDetail: .65})
	if e != nil {
		t.Fatal(e)
	}
	different := false
	for i := 4; i < len(p); i++ {
		different = different || p[i] != p[i%4]
	}
	if !different {
		t.Fatal("browser terrain is a flat clear color")
	}
	t.Logf("browser chunk %d bytes SHA256 %x", len(p), sha256.Sum256(p))
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
	er, e := erosion.RunGPU(context.Background(), ErosionRequest{Planes: pb, Masks: mb, Grid: 33, Size: 128, Age: 2, Rain: 1, TalusAngle: 30, RateMask: 14})
	if e != nil {
		t.Fatal(e)
	}
	defer er.Close()
	raw, e := g.ReadBuffer(context.Background(), er.Weather, 0, 33*33*8)
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("browser weather %d bytes SHA256 %x", len(raw), sha256.Sum256(raw))
	dumpBrowserGPU("weather", raw)
	mf, e := erosion.MaterialField(MaterialFieldRequest{Height: er.Weather, HeightOffset: 33 * 33, Grid: 33, Size: 128, BaseHeight: 24, DepositSpread: .65, Seed: 2701, Profile: object(config, "material")})
	if e != nil {
		t.Fatal(e)
	}
	defer mf.Release()
	mraw, e := g.ReadBuffer(context.Background(), mf, 0, 33*33*16)
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("browser material field %d bytes SHA256 %x", len(mraw), sha256.Sum256(mraw))
	dumpBrowserGPU("material", mraw)
	feedPixels, e := r.RenderWindow(context.Background(), WindowInput{Window: window, Region: reg, Feed: &GPUFeed{Planes: pb, Masks: mb, Weather: er.Weather, Maps: er.Maps, Field: mf, Grid: 33, Cells: 33 * 33, MaskCount: 25}}, DefaultDrawOptions(config))
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("browser GPU feed %d bytes SHA256 %x", len(feedPixels), sha256.Sum256(feedPixels))
	for _, size := range [][2]int{{64, 64}, {32, 32}, {37, 29}, {64, 64}} {
		bitmap, err := r.PresentBitmap(context.Background(), size[0], size[1])
		if err != nil {
			t.Fatal(err)
		}
		canvas := js.Global().Get("OffscreenCanvas").New(size[0], size[1])
		dc := canvas.Call("getContext", "2d")
		dc.Call("drawImage", bitmap, 0, 0)
		bitmap.Call("close")
		actual := make([]byte, size[0]*size[1]*4)
		js.CopyBytesToGo(actual, dc.Call("getImageData", 0, 0, size[0], size[1]).Get("data"))
		expected := feedPixels
		if size[0] != 64 || size[1] != 64 {
			expected = resizeRGBA(feedPixels, 64, 64, size[0], size[1])
		}
		if !bytes.Equal(actual, expected) {
			for i := range actual {
				if actual[i] != expected[i] {
					t.Fatalf("bitmap %dx%d byte%d: %d want%d", size[0], size[1], i, actual[i], expected[i])
				}
			}
		}
		t.Logf("GPU bitmap %dx%d exact SHA256 %x", size[0], size[1], sha256.Sum256(actual))
	}
	window.SkipRGBA = true
	skipped, err := r.RenderWindow(context.Background(), WindowInput{Window: window, Region: reg, Feed: &GPUFeed{Planes: pb, Masks: mb, Weather: er.Weather, Maps: er.Maps, Field: mf, Grid: 33, Cells: 33 * 33, MaskCount: 25}}, DefaultDrawOptions(config))
	if err != nil {
		t.Fatal(err)
	}
	if skipped != nil || r.LastProfile.ReadbackMilliseconds != 0 {
		t.Fatal("ordinary view performed RGBA readback")
	}
	bitmap, err := r.PresentBitmap(context.Background(), 64, 64)
	if err != nil {
		t.Fatal(err)
	}
	bitmap.Call("close")

}

func dumpBrowserGPU(name string, data []byte) {
	if js.Global().Get("gpuDump").Truthy() {
		js.Global().Get("console").Call("log", "GPU_DATA:"+name+":"+base64.StdEncoding.EncodeToString(data))
	}
}
