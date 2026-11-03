package terrain

import (
	"encoding/binary"
	"encoding/json"
	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
	"github.com/nanolathe-gg/terraform/internal/model"
	"math"
	"strings"
)

func flatRows(rows []model.Row) []float32 {
	o := make([]float32, 0, len(rows)*4)
	for _, r := range rows {
		o = append(o, r[:]...)
	}
	return o
}
func (r *Renderer) generateMaterials() {
	g := r.GPU
	usage := gputypes.TextureUsageTextureBinding | gputypes.TextureUsageStorageBinding | gputypes.TextureUsageCopySrc
	r.Generated = r.texture("generated materials", 512, 512, len(r.Table.Order), 7, gputypes.TextureFormatRGBA8Unorm, usage)
	r.Relief = r.texture("rock relief", 512, 512, 1, 7, gputypes.TextureFormatRGBA16Float, usage)
	previous := r.texture("material previous level", 512, 512, len(r.Table.Order), 7, gputypes.TextureFormatRGBA8Unorm, gputypes.TextureUsageTextureBinding|gputypes.TextureUsageCopyDst)
	defer previous.Release()
	previousRelief := r.texture("relief previous level", 512, 512, 1, 7, gputypes.TextureFormatRGBA16Float, gputypes.TextureUsageTextureBinding|gputypes.TextureUsageCopyDst)
	defer previousRelief.Release()
	table := must(g.Buffer("material table", FloatBytes(flatRows(model.MaterialRows(r.Table))), gputypes.BufferUsageStorage))
	defer table.Release()
	source := r.Sources["engine-materials.wgsl"]
	material := must(g.Kernel(source, "makeMaterial"))
	relief := must(g.Kernel(source, "makeRelief"))
	dither := must(g.Kernel(source, "makeDither"))
	r.own(material.Pipeline)
	r.own(relief.Pipeline)
	r.own(dither.Pipeline)
	for _, k := range []*Kernel{material, relief, dither} {
		for _, l := range k.Layouts {
			r.own(l)
		}
	}
	for level := 0; level < 7; level++ {
		params := must(g.Buffer("material params", FloatBytes([]float32{512, float32(uint32(1) << level), 0, 0}), gputypes.BufferUsageUniform))
		n := uint32((512/(1<<level) + 7) / 8)
		prev := level - 1
		if level == 0 {
			prev = 1
		}
		if level > 0 {
			enc := must(g.Device.CreateCommandEncoder(nil))
			size := uint32(512 >> prev)
			enc.CopyTextureToTexture(r.Generated, previous, []wgpu.TextureCopy{{Source: wgpu.ImageCopyTexture{Texture: r.Generated, MipLevel: uint32(prev)}, Destination: wgpu.ImageCopyTexture{Texture: previous, MipLevel: uint32(prev)}, Size: wgpu.Extent3D{Width: size, Height: size, DepthOrArrayLayers: uint32(len(r.Table.Order))}}})
			enc.CopyTextureToTexture(r.Relief, previousRelief, []wgpu.TextureCopy{{Source: wgpu.ImageCopyTexture{Texture: r.Relief, MipLevel: uint32(prev)}, Destination: wgpu.ImageCopyTexture{Texture: previousRelief, MipLevel: uint32(prev)}, Size: wgpu.Extent3D{Width: size, Height: size, DepthOrArrayLayers: 1}}})
			check(g.Submit(enc))
		}
		check(g.Dispatch(material, Bindings{0: {{Binding: 0, Buffer: table}, {Binding: 1, TextureView: r.view(r.Generated, true, level)}, {Binding: 2, Buffer: params}, {Binding: 3, TextureView: r.view(previous, true, prev)}}}, n, n, uint32(len(r.Table.Order))))
		check(g.Dispatch(relief, Bindings{0: {{Binding: 0, Buffer: table}, {Binding: 2, Buffer: params}, {Binding: 4, TextureView: r.view(r.Relief, false, level)}, {Binding: 5, TextureView: r.view(previousRelief, false, prev)}}}, n, n, 1))
		if level == 0 {
			check(g.Dispatch(dither, Bindings{0: {{Binding: 0, Buffer: table}, {Binding: 1, TextureView: r.view(r.Generated, true, 0)}, {Binding: 2, Buffer: params}}}, 2, 2, uint32(len(r.Table.Order))))
		}
		params.Release()
	}
}
func oklab(c []float64) [3]float64 {
	lin := [3]float64{}
	for i := range lin {
		x := c[i] / 255
		if x <= .04045 {
			lin[i] = x / 12.92
		} else {
			lin[i] = math.Pow((x+.055)/1.055, 2.4)
		}
	}
	l := math.Cbrt(.4122214708*lin[0] + .5363325363*lin[1] + .0514459929*lin[2])
	m := math.Cbrt(.2119034982*lin[0] + .6806995451*lin[1] + .1073969566*lin[2])
	s := math.Cbrt(.0883024619*lin[0] + .2817188376*lin[1] + .6299787005*lin[2])
	return [3]float64{.2104542553*l + .793617785*m - .0040720468*s, 1.9779984951*l - 2.428592205*m + .4505937099*s, .0259040371*l + .7827717662*m - .808675766*s}
}
func (r *Renderer) generatePalette() {
	var p struct {
		Colours [][]float64 `json:"colours"`
	}
	check(json.Unmarshal([]byte(r.Sources["materials/palette.json"]), &p))
	entries := vector(object(r.Material, "palette"), "entries", nil)
	colors := p.Colours
	if entries != nil {
		colors = nil
		for _, i := range entries {
			colors = append(colors, p.Colours[int(i)])
		}
	}
	rows := make([]float32, len(colors)*8)
	for i, c := range colors {
		for k := 0; k < 3; k++ {
			rows[i*8+k] = float32(c[k])
		}
		lab := oklab(c)
		for k, v := range lab {
			rows[i*8+4+k] = float32(v)
		}
	}
	b := must(r.GPU.Buffer("palette colors", FloatBytes(rows), gputypes.BufferUsageStorage))
	defer b.Release()
	count := make([]byte, 16)
	binary.LittleEndian.PutUint32(count, uint32(len(colors)))
	u := must(r.GPU.Buffer("palette count", count, gputypes.BufferUsageUniform))
	defer u.Release()
	r.Palette = r.texture("palette lookup", 1024, 96, 1, 1, gputypes.TextureFormatRGBA8Unorm, gputypes.TextureUsageStorageBinding|gputypes.TextureUsageTextureBinding|gputypes.TextureUsageCopySrc)
	k := must(r.GPU.Kernel(r.Sources["engine-palette.wgsl"], "paletteMain"))
	r.own(k.Pipeline)
	for _, l := range k.Layouts {
		r.own(l)
	}
	check(r.GPU.Dispatch(k, Bindings{0: {{Binding: 0, Buffer: b}, {Binding: 1, Buffer: u}, {Binding: 2, TextureView: r.view(r.Palette, false, -1)}}}, 128, 4, 1))
}
func (r *Renderer) initGround() {
	table := r.Material
	r.groundBorrowed = false
	r.groundKey = r.Variant["groundPattern"]
	pattern := object(object(r.Config, "groundPatterns"), r.groundKey)
	if path := str(pattern, "groundTable"); path != "" && path != str(r.Config, "materialTable") {
		raw := r.Sources[strings.TrimPrefix(path, "/")]
		if raw != "" {
			var other map[string]any
			check(json.Unmarshal([]byte(raw), &other))
			table = other
			r.groundBorrowed = true
		}
	}
	ground := object(table, "ground")
	r.groundTiled = len(ground) > 0
	tiles, _ := ground["tiles"].([]any)
	entries, _ := ground["entries"].([]any)
	w, h := 1, 1
	b := make([]byte, 4)
	r.Set("uGroundMode", flag(len(tiles) > 0))
	if len(tiles) > 0 {
		w, h = 512, 32
		b = make([]byte, w*h*4)
		sum := []float64{0, 0, 0}
		for t, v := range tiles {
			tile := v.(string)
			for i := 0; i < 1024; i++ {
				k := int(tile[i])
				if k >= 97 {
					k -= 97
				} else {
					k -= 39
				}
				c := entries[k].([]any)
				at := ((i>>5)*512 + t*32 + (i & 31)) * 4
				for j := 0; j < 3; j++ {
					x := c[j].(float64)
					b[at+j] = byte(x)
					sum[j] += x
				}
				b[at+3] = 255
			}
		}
		for j := range sum {
			sum[j] /= float64(w*h) * 255
		}
		r.means["ground"] = sum
	} else {
		r.means["ground"] = vector(object(object(r.Material, "measured"), "quilt"), "meanRGB", []float64{48, 71, 36})
		for j := range r.means["ground"] {
			r.means["ground"][j] /= 255
		}
	}
	if r.Grass != nil {
		r.Grass.Release()
	}
	r.Grass = must(r.GPU.Device.CreateTexture(&wgpu.TextureDescriptor{Label: "ground tiles", Size: wgpu.Extent3D{Width: uint32(w), Height: uint32(h), DepthOrArrayLayers: 1}, MipLevelCount: 1, SampleCount: 1, Dimension: gputypes.TextureDimension2D, Format: gputypes.TextureFormatRGBA8Unorm, Usage: gputypes.TextureUsageTextureBinding | gputypes.TextureUsageCopyDst}))
	if r.sharedCount > 0 {
		r.ownShared(r.Grass)
	} else {
		r.own(r.Grass)
	}
	check(r.upload(r.Grass, b, w, h, 0, 1, 4))
	if r.groundTiled {
		r.means["ground"] = r.groundMean()
	}
	for i, k := range []string{"slope", "rock"} {
		v := vector(object(object(r.Material, "measured"), r.Table.Order[i]), "meanRGB", []float64{128, 128, 128})
		for j := range v {
			v[j] /= 255
		}
		r.means[k] = v
	}
	v := vector(object(object(r.Material, "measured"), "beach"), "meanRGB", []float64{128, 128, 128})
	for j := range v {
		v[j] /= 255
	}
	r.means["beach"] = v
}
