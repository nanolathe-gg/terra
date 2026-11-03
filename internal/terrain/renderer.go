package terrain

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
	"github.com/nanolathe-gg/terraform/internal/model"
	"math"
	"sort"
	"strings"
)

type Renderer struct {
	reservedGPUBytes                                                                                                             int
	materialReady                                                                                                                bool
	LastProfile                                                                                                                  RenderProfile
	groundKey                                                                                                                    string
	groundTiled, groundBorrowed                                                                                                  bool
	gpuFlags                                                                                                                     bool
	feedKernel, flagKernel                                                                                                       *Kernel
	flagBuffer                                                                                                                   *wgpu.Buffer
	sharedCount                                                                                                                  int
	chunked                                                                                                                      bool
	activeRegion                                                                                                                 *RenderRegion
	bakeWidth, bakeHeight                                                                                                        int
	viewport                                                                                                                     [4]float32
	GPU                                                                                                                          *GPU
	Config                                                                                                                       map[string]any
	Sources                                                                                                                      map[string]string
	Material                                                                                                                     map[string]any
	Table                                                                                                                        model.MaterialTable
	Variant                                                                                                                      map[string]string
	Grid, Size, Width, Height                                                                                                    int
	Uniform                                                                                                                      *Uniforms
	UniformBuffer                                                                                                                *wgpu.Buffer
	Color, Depth, HeightTexture, RouteTexture, GridTexture, MaskTexture, FieldsTexture, Noise, Grass, Palette, Generated, Relief *wgpu.Texture
	DrawPipeline                                                                                                                 *wgpu.RenderPipeline
	Bake                                                                                                                         *Kernel
	CommonLayout, MaterialLayout, SamplerLayout                                                                                  *wgpu.BindGroupLayout
	LinearClamp, LinearRepeat, NearestRepeat                                                                                     *wgpu.Sampler
	vertices, indices                                                                                                            *wgpu.Buffer
	indexCount                                                                                                                   uint32
	maskLayers                                                                                                                   int
	resources                                                                                                                    []interface{ Release() }
	means                                                                                                                        map[string][]float64
}
type DrawOptions struct {
	Scree                                                                         float64
	Weather                                                                       bool
	RefinementSeed                                                                uint32
	DepositSpread                                                                 float64
	ExportArt                                                                     bool
	Width, Height, Resolution                                                     int
	Full, Clay, AlternateLight, Exact                                             bool
	Detail, Ring, RingSpread, RingVariation, MaterialWeathering, TransitionDetail float64
}

func object(m map[string]any, k string) map[string]any {
	v, _ := m[k].(map[string]any)
	if v == nil {
		return map[string]any{}
	}
	return v
}
func number(m map[string]any, k string, d float64) float64 {
	v, ok := m[k].(float64)
	if ok {
		return v
	}
	if n, ok := m[k].(int); ok {
		return float64(n)
	}
	return d
}
func vector(m map[string]any, k string, d []float64) []float64 {
	v, ok := m[k].([]any)
	if !ok {
		if a, ok := m[k].([]float64); ok {
			return a
		}
		return d
	}
	r := make([]float64, len(v))
	for i, x := range v {
		r[i], _ = x.(float64)
	}
	return r
}
func str(m map[string]any, k string) string { v, _ := m[k].(string); return v }
func flag(b bool) float64 {
	if b {
		return 1
	}
	return 0
}
func must[T any](v T, e error) T {
	if e != nil {
		panic(e)
	}
	return v
}
func check(e error) {
	if e != nil {
		panic(e)
	}
}
func recoverError(err *error) {
	if p := recover(); p != nil {
		if e, ok := p.(error); ok {
			*err = e
		} else {
			*err = fmt.Errorf("GPU: %v", p)
		}
	}
}
func (r *Renderer) own(v interface{ Release() }) { r.resources = append(r.resources, v) }
func NewRenderer(g *GPU, config map[string]any, sources map[string]string, material map[string]any) (r *Renderer, err error) {
	defer func() {
		if err != nil && r != nil {
			r.Close()
		}
	}()
	defer recoverError(&err)
	defer g.scope()(&err)
	for _, name := range []string{"engine-common.wgsl", "sculpt-vert.wgsl", "engine-frag.wgsl", "engine-bake.wgsl", "engine-materials.wgsl", "engine-palette.wgsl", "materials/palette.json"} {
		if sources[name] == "" {
			return nil, fmt.Errorf("missing renderer source %s", name)
		}
	}
	r = &Renderer{GPU: g, Config: config, Sources: sources, Material: material, Variant: map[string]string{}, Grid: int(number(config, "grid", 257)), Size: int(number(config, "size", 1024)), maskLayers: 7, means: map[string][]float64{}}
	clean := map[string]any{}
	for k, v := range material {
		clean[k] = v
	}
	placement := map[string]any{}
	for k, v := range object(material, "placement") {
		if _, ok := v.(map[string]any); ok {
			placement[k] = v
		}
	}
	if len(placement) > 0 {
		clean["placement"] = placement
	} else {
		delete(clean, "placement")
	}
	r.chunked = config["chunked"] == true
	worldGrid, worldSize := r.Grid, r.Size
	if r.chunked {
		r.Grid = 1
		r.Size = 1
	}
	bytes := must(json.Marshal(clean))
	check(json.Unmarshal(bytes, &r.Table))
	water := object(config, "water")
	for _, k := range []string{"deep", "shallow"} {
		name := str(water, k)
		found := false
		for _, x := range r.Table.Order {
			found = found || x == name
		}
		if !found && name != "" {
			r.Table.Order = append(r.Table.Order, name)
		}
	}
	for _, k := range []string{"defaults", "engineDefaults", "variant"} {
		for key, v := range object(config, k) {
			r.Variant[key] = fmt.Sprint(v)
		}
	}
	r.Uniform = must(ParseUniforms(Preprocess(sources["engine-common.wgsl"], "", r.defines(false))))
	r.UniformBuffer = must(g.Buffer("uniforms", r.Uniform.Data, gputypes.BufferUsageUniform))
	r.own(r.UniformBuffer)
	r.Sources = map[string]string{}
	for k, v := range sources {
		r.Sources[k] = v
	}
	r.Sources["engine-common.wgsl"] = strings.ReplaceAll(strings.ReplaceAll(sources["engine-common.wgsl"], "@group(0) @binding(7)", "@group(2) @binding(7)"), "@group(0) @binding(8)", "@group(2) @binding(8)")
	r.initPipelines()
	r.initTextures()
	r.generateMaterials()
	r.generatePalette()
	r.initGround()
	r.initUniforms()
	height := make([]float32, r.Grid*r.Grid)
	for i := range height {
		height[i] = float32(number(config, "baseHeight", 24))
	}
	check(r.SetHeight(height))
	check(r.SetRoutes(nil, nil, nil, nil))
	check(r.SetWeather(nil, nil, nil, nil))
	check(r.SetMaterialField(nil))
	if r.chunked {
		r.Grid = worldGrid
		r.Size = worldSize
		r.initUniforms()
	}
	r.sharedCount = len(r.resources)
	return r, nil
}
func (r *Renderer) Close() {
	r.closeFeed()
	if r.vertices != nil {
		r.vertices.Release()
		r.indices.Release()
		r.vertices = nil
		r.indices = nil
	}
	for i := len(r.resources) - 1; i >= 0; i-- {
		r.resources[i].Release()
	}
	r.resources = nil
}
func (r *Renderer) Set(name string, v ...float64) {
	if strings.HasPrefix(name, "u") && len(name) > 1 {
		name = strings.ToLower(name[1:2]) + name[2:]
	}
	if _, ok := r.Uniform.Fields[name]; !ok {
		panic(fmt.Errorf("no terrain uniform %s", name))
	}
	r.Uniform.Set(name, v...)
}
func (r *Renderer) FlushUniforms() error {
	if !r.gpuFlags {
		return r.GPU.Queue.WriteBuffer(r.UniformBuffer, 0, r.Uniform.Data)
	}
	offsets := []int{}
	for _, name := range maskFlagNames {
		offsets = append(offsets, r.Uniform.Fields[name].Offset)
	}
	sort.Ints(offsets)
	at := 0
	for _, offset := range offsets {
		if offset > at {
			if e := r.GPU.Queue.WriteBuffer(r.UniformBuffer, uint64(at), r.Uniform.Data[at:offset]); e != nil {
				return e
			}
		}
		at = offset + 4
	}
	if at < len(r.Uniform.Data) {
		return r.GPU.Queue.WriteBuffer(r.UniformBuffer, uint64(at), r.Uniform.Data[at:])
	}
	return nil
}
func (r *Renderer) texture(label string, w, h, layers, levels int, format gputypes.TextureFormat, usage gputypes.TextureUsage) *wgpu.Texture {
	t := must(r.GPU.Device.CreateTexture(&wgpu.TextureDescriptor{Label: label, Size: wgpu.Extent3D{Width: uint32(w), Height: uint32(h), DepthOrArrayLayers: uint32(layers)}, MipLevelCount: uint32(levels), SampleCount: 1, Dimension: gputypes.TextureDimension2D, Format: format, Usage: usage}))
	r.own(t)
	return t
}
func (r *Renderer) view(t *wgpu.Texture, array bool, level int) *wgpu.TextureView {
	d := &wgpu.TextureViewDescriptor{}
	if array {
		d.Dimension = gputypes.TextureViewDimension2DArray
	}
	if level >= 0 {
		d.BaseMipLevel = uint32(level)
		d.MipLevelCount = 1
	}
	v := must(r.GPU.Device.CreateTextureView(t, d))
	r.own(v)
	return v
}
func (r *Renderer) upload(t *wgpu.Texture, data []byte, w, h, layer, layers, bpp int) error {
	return r.GPU.Queue.WriteTexture(&wgpu.ImageCopyTexture{Texture: t, Origin: wgpu.Origin3D{Z: uint32(layer)}}, data, &wgpu.ImageDataLayout{BytesPerRow: uint32(w * bpp), RowsPerImage: uint32(h)}, &wgpu.Extent3D{Width: uint32(w), Height: uint32(h), DepthOrArrayLayers: uint32(layers)})
}
func (r *Renderer) initPipelines() {
	g := r.GPU
	both := gputypes.ShaderStageVertex | gputypes.ShaderStageFragment | gputypes.ShaderStageCompute
	tex := func(b uint32, vis gputypes.ShaderStages, sample gputypes.TextureSampleType, array bool) gputypes.BindGroupLayoutEntry {
		dim := gputypes.TextureViewDimension2D
		if array {
			dim = gputypes.TextureViewDimension2DArray
		}
		return gputypes.BindGroupLayoutEntry{Binding: b, Visibility: vis, Texture: &gputypes.TextureBindingLayout{SampleType: sample, ViewDimension: dim}}
	}
	sam := func(b uint32, vis gputypes.ShaderStages) gputypes.BindGroupLayoutEntry {
		return gputypes.BindGroupLayoutEntry{Binding: b, Visibility: vis, Sampler: &gputypes.SamplerBindingLayout{Type: gputypes.SamplerBindingTypeFiltering}}
	}
	r.CommonLayout = must(g.Device.CreateBindGroupLayout(&wgpu.BindGroupLayoutDescriptor{Entries: []gputypes.BindGroupLayoutEntry{{Binding: 0, Visibility: both, Buffer: &gputypes.BufferBindingLayout{Type: gputypes.BufferBindingTypeUniform}}, tex(1, both, gputypes.TextureSampleTypeUnfilterableFloat, false), tex(2, both, gputypes.TextureSampleTypeFloat, false), tex(4, both, gputypes.TextureSampleTypeFloat, true), tex(6, both, gputypes.TextureSampleTypeFloat, false), tex(9, both, gputypes.TextureSampleTypeFloat, true)}}))
	r.own(r.CommonLayout)
	r.SamplerLayout = must(g.Device.CreateBindGroupLayout(&wgpu.BindGroupLayoutDescriptor{Entries: []gputypes.BindGroupLayoutEntry{sam(7, both), sam(8, both)}}))
	r.own(r.SamplerLayout)
	f := gputypes.ShaderStageFragment
	r.MaterialLayout = must(g.Device.CreateBindGroupLayout(&wgpu.BindGroupLayoutDescriptor{Entries: []gputypes.BindGroupLayoutEntry{tex(0, f, gputypes.TextureSampleTypeFloat, false), sam(1, f), tex(18, f, gputypes.TextureSampleTypeFloat, false), tex(19, f, gputypes.TextureSampleTypeFloat, true), tex(20, f, gputypes.TextureSampleTypeFloat, false)}}))
	r.own(r.MaterialLayout)
	layout := must(g.Device.CreatePipelineLayout(&wgpu.PipelineLayoutDescriptor{BindGroupLayouts: []*wgpu.BindGroupLayout{r.CommonLayout, r.MaterialLayout, r.SamplerLayout}}))
	r.own(layout)
	common := r.Sources["engine-common.wgsl"]
	vert := must(g.Shader("terrain", Preprocess(r.Sources["sculpt-vert.wgsl"], common, r.defines(false))))
	r.own(vert)
	frag := must(g.Shader("terrain", Preprocess(r.Sources["engine-frag.wgsl"], common, r.defines(false))))
	r.own(frag)
	r.DrawPipeline = must(g.Device.CreateRenderPipeline(&wgpu.RenderPipelineDescriptor{Label: "terrain", Layout: layout, Vertex: wgpu.VertexState{Module: vert, EntryPoint: "vertexMain", Buffers: []gputypes.VertexBufferLayout{{ArrayStride: 8, Attributes: []gputypes.VertexAttribute{{ShaderLocation: 0, Format: gputypes.VertexFormatFloat32x2}}}}}, Fragment: &wgpu.FragmentState{Module: frag, EntryPoint: "fragmentMain", Targets: []gputypes.ColorTargetState{{Format: gputypes.TextureFormatRGBA8Unorm, WriteMask: gputypes.ColorWriteMaskAll}}}, Primitive: gputypes.PrimitiveState{Topology: gputypes.PrimitiveTopologyTriangleList}, Multisample: gputypes.MultisampleState{Count: 1, Mask: 0xffffffff}, DepthStencil: &wgpu.DepthStencilState{Format: gputypes.TextureFormatDepth32Float, DepthWriteEnabled: true, DepthCompare: gputypes.CompareFunctionLess}}))
	r.own(r.DrawPipeline)
	out := must(g.Device.CreateBindGroupLayout(&wgpu.BindGroupLayoutDescriptor{Entries: []gputypes.BindGroupLayoutEntry{{Binding: 0, Visibility: gputypes.ShaderStageCompute, StorageTexture: &gputypes.StorageTextureBindingLayout{Access: gputypes.StorageTextureAccessWriteOnly, Format: gputypes.TextureFormatRGBA16Float, ViewDimension: gputypes.TextureViewDimension2D}}}}))
	r.own(out)
	bl := must(g.Device.CreatePipelineLayout(&wgpu.PipelineLayoutDescriptor{BindGroupLayouts: []*wgpu.BindGroupLayout{r.CommonLayout, out, r.SamplerLayout}}))
	r.own(bl)
	bm := must(g.Shader("terrain", Preprocess(r.Sources["engine-bake.wgsl"], common, r.defines(true))))
	r.own(bm)
	bp := must(g.Device.CreateComputePipeline(&wgpu.ComputePipelineDescriptor{Label: "relief bake", Layout: bl, Module: bm, EntryPoint: "bakeMain"}))
	r.own(bp)
	r.Bake = &Kernel{Pipeline: bp, Layouts: []*wgpu.BindGroupLayout{r.CommonLayout, out, r.SamplerLayout}}
}
func (r *Renderer) initTextures() {
	u := gputypes.TextureUsageTextureBinding | gputypes.TextureUsageCopyDst
	g := r.Grid
	r.HeightTexture = r.texture("height", g, g, 1, 1, gputypes.TextureFormatR32Float, u)
	r.RouteTexture = r.texture("routes", g, g, 1, 1, gputypes.TextureFormatRGBA8Unorm, u)
	r.GridTexture = r.texture("weather and material field", g, g, 4, 1, gputypes.TextureFormatRGBA8Unorm, u)
	r.MaskTexture = r.texture("masks", g, g, r.maskLayers, 1, gputypes.TextureFormatRGBA8Snorm, u)
	r.FieldsTexture = r.texture("fields", r.Size, r.Size, 1, 1, gputypes.TextureFormatRGBA16Float, gputypes.TextureUsageStorageBinding|gputypes.TextureUsageTextureBinding|gputypes.TextureUsageCopySrc)
	r.Noise = r.texture("noise", 512, 512, 1, 1, gputypes.TextureFormatRGBA8Unorm, u)
	check(r.upload(r.Noise, model.MakeNoise(512), 512, 512, 0, 1, 4))
	r.LinearClamp = must(r.GPU.Device.CreateSampler(&wgpu.SamplerDescriptor{MinFilter: gputypes.FilterModeLinear, MagFilter: gputypes.FilterModeLinear, LodMaxClamp: 32}))
	r.own(r.LinearClamp)
	r.LinearRepeat = must(r.GPU.Device.CreateSampler(&wgpu.SamplerDescriptor{MinFilter: gputypes.FilterModeLinear, MagFilter: gputypes.FilterModeLinear, AddressModeU: gputypes.AddressModeRepeat, AddressModeV: gputypes.AddressModeRepeat, LodMaxClamp: 32}))
	r.own(r.LinearRepeat)
	r.NearestRepeat = must(r.GPU.Device.CreateSampler(&wgpu.SamplerDescriptor{AddressModeU: gputypes.AddressModeRepeat, AddressModeV: gputypes.AddressModeRepeat, LodMaxClamp: 32}))
	r.own(r.NearestRepeat)
}
func (r *Renderer) SetHeight(v []float32) error {
	if len(v) != r.Grid*r.Grid {
		return fmt.Errorf("height length %d, expected %d", len(v), r.Grid*r.Grid)
	}
	out := make([]float32, len(v))
	sea := float32(number(r.Config, "seaLevel", 0))
	for i, h := range v {
		out[i] = h - sea
	}
	return r.upload(r.HeightTexture, FloatBytes(out), r.Grid, r.Grid, 0, 1, 4)
}
func quant(x float32) byte { return byte(math.Round(math.Max(0, math.Min(1, float64(x))) * 255)) }
func at(v []float32, i int) float32 {
	if i >= len(v) {
		return 0
	}
	return v[i]
}
func (r *Renderer) SetRoutes(routes, cracks, cover, crystal []float32) error {
	b := make([]byte, r.Grid*r.Grid*4)
	for i := 0; i < len(b)/4; i++ {
		b[4*i] = quant(at(routes, i))
		b[4*i+1] = quant(at(cracks, i))
		b[4*i+2] = quant(at(cover, i)*.5 + .5)
		b[4*i+3] = quant(at(crystal, i))
	}
	return r.upload(r.RouteTexture, b, r.Grid, r.Grid, 0, 1, 4)
}
func (r *Renderer) SetWeather(flow, deposit, talus, sand []float32) error {
	r.Set("uWeatherMaps", 0)
	b := make([]byte, r.Grid*r.Grid*4)
	for i := 0; i < len(b)/4; i++ {
		b[4*i] = quant(at(flow, i))
		b[4*i+1] = quant(at(deposit, i))
		b[4*i+2] = quant(at(talus, i))
		b[4*i+3] = quant(at(sand, i))
	}
	return r.upload(r.GridTexture, b, r.Grid, r.Grid, 0, 1, 4)
}
func (r *Renderer) SetMaterialField(field []float32) error {
	r.materialReady = field != nil
	b := make([]byte, r.Grid*r.Grid*4)
	for i := range b {
		b[i] = quant(at(field, i))
	}
	r.Set("uMaterialReady", flag(field != nil))
	return r.upload(r.GridTexture, b, r.Grid, r.Grid, 1, 1, 4)
}
func (r *Renderer) SetMasks(planes [][]int8) error {
	n := r.Grid * r.Grid
	layers := max(1, (len(planes)+3)/4)
	if layers != r.maskLayers {
		r.MaskTexture = r.texture("masks", r.Grid, r.Grid, layers, 1, gputypes.TextureFormatRGBA8Snorm, gputypes.TextureUsageTextureBinding|gputypes.TextureUsageCopyDst)
		r.maskLayers = layers
	}
	b := make([]byte, n*layers*4)
	p := make([]bool, max(25, len(planes)))
	for k, a := range planes {
		if len(a) != 0 && len(a) != n {
			return fmt.Errorf("invalid mask dimensions")
		}
		for i, v := range a {
			b[(k/4)*n*4+k%4+i*4] = byte(v)
			p[k] = p[k] || v != 0
		}
	}
	any := func(a, b int) bool {
		for _, v := range p[a:b] {
			if v {
				return true
			}
		}
		return false
	}
	r.Set("uPaintOn", flag(any(0, 9)))
	r.Set("uScatterOn", flag(p[4]))
	r.Set("uStyleOn", flag(any(5, 9)))
	r.Set("uOverrideOn", flag(any(14, 18)))
	r.Set("uWaterOn", flag(any(9, 12) || p[13]))
	r.Set("uLumpOn", flag(p[12]))
	return r.upload(r.MaskTexture, b, r.Grid, r.Grid, 0, layers, 4)
}
func (r *Renderer) common(bake bool) *wgpu.BindGroup {
	field := r.FieldsTexture
	if bake {
		field = r.RouteTexture
	}
	entries := []wgpu.BindGroupEntry{{Binding: 0, Buffer: r.UniformBuffer}, {Binding: 1, TextureView: r.view(r.HeightTexture, false, -1)}, {Binding: 2, TextureView: r.view(r.Noise, false, -1)}, {Binding: 4, TextureView: r.view(r.GridTexture, true, -1)}, {Binding: 6, TextureView: r.view(field, false, -1)}, {Binding: 9, TextureView: r.view(r.MaskTexture, true, -1)}}
	return must(r.GPU.Device.CreateBindGroup(&wgpu.BindGroupDescriptor{Layout: r.CommonLayout, Entries: entries}))
}
func (r *Renderer) mesh(res int) {
	if r.vertices != nil {
		r.vertices.Release()
		r.indices.Release()
	}
	v := make([]float32, (res+1)*(res+1)*2)
	k := 0
	for y := 0; y <= res; y++ {
		for x := 0; x <= res; x++ {
			v[k] = float32(x) / float32(res)
			v[k+1] = float32(y) / float32(res)
			k += 2
		}
	}
	b := make([]byte, res*res*6*4)
	k = 0
	for y := 0; y < res; y++ {
		for x := 0; x < res; x++ {
			a := y*(res+1) + x
			bb := a + res + 1
			for _, i := range []int{a, bb, a + 1, a + 1, bb, bb + 1} {
				binary.LittleEndian.PutUint32(b[k:], uint32(i))
				k += 4
			}
		}
	}
	r.vertices = must(r.GPU.Buffer("terrain mesh", FloatBytes(v), gputypes.BufferUsageVertex))
	r.indices = must(r.GPU.Buffer("terrain indices", b, gputypes.BufferUsageIndex))
	r.indexCount = uint32(res * res * 6)
}
func (r *Renderer) Render(o DrawOptions) (err error) {
	defer recoverError(&err)
	defer r.GPU.scope()(&err)
	w, h := o.Width, o.Height
	if w == 0 {
		w = r.Size
	}
	if h == 0 {
		h = r.Size
	}
	if r.Width != w || r.Height != h {
		r.Color = r.texture("terrain color", w, h, 1, 1, gputypes.TextureFormatRGBA8Unorm, gputypes.TextureUsageRenderAttachment|gputypes.TextureUsageCopySrc|gputypes.TextureUsageTextureBinding)
		r.Depth = r.texture("terrain depth", w, h, 1, 1, gputypes.TextureFormatDepth32Float, gputypes.TextureUsageRenderAttachment)
		r.Width, r.Height = w, h
	}
	res := o.Resolution
	if res == 0 {
		res = 192
		if o.Full {
			res = 512
		}
	}
	if r.activeRegion == nil && r.indexCount != uint32(res*res*6) {
		r.mesh(res)
	}
	r.drawUniforms(o)
	r.bakeUniforms(o.Full)
	check(r.FlushUniforms())
	enc := must(r.GPU.Device.CreateCommandEncoder(nil))
	bg := r.common(true)
	defer bg.Release()
	out := must(r.GPU.Device.CreateBindGroup(&wgpu.BindGroupDescriptor{Layout: r.Bake.Layouts[1], Entries: []wgpu.BindGroupEntry{{Binding: 0, TextureView: r.view(r.FieldsTexture, false, -1)}}}))
	defer out.Release()
	check(EncodeDispatch(enc, r.Bake, map[uint32]*wgpu.BindGroup{0: bg, 1: out, 2: r.samplerGroup()}, uint32((r.bakeW()+7)/8), uint32((r.bakeH()+7)/8), 1, nil))
	clear := r.means["ground"]
	if len(clear) < 3 {
		clear = []float64{.19, .28, .14}
	}
	p := must(enc.BeginRenderPass(&wgpu.RenderPassDescriptor{ColorAttachments: []wgpu.RenderPassColorAttachment{{View: r.view(r.Color, false, -1), LoadOp: gputypes.LoadOpClear, StoreOp: gputypes.StoreOpStore, ClearValue: gputypes.Color{R: clear[0], G: clear[1], B: clear[2], A: 1}}}, DepthStencilAttachment: &wgpu.RenderPassDepthStencilAttachment{View: r.view(r.Depth, false, -1), StencilReadOnly: true, DepthClearValue: 1, DepthLoadOp: gputypes.LoadOpClear, DepthStoreOp: gputypes.StoreOpDiscard}}))
	p.SetPipeline(r.DrawPipeline)
	if r.activeRegion != nil {
		v := r.viewport
		p.SetViewport(gputypes.Viewport{X: v[0], Y: v[1], Width: v[2], Height: v[3], MinDepth: 0, MaxDepth: 1})
	}
	draw := r.common(false)
	defer draw.Release()
	mat := must(r.GPU.Device.CreateBindGroup(&wgpu.BindGroupDescriptor{Layout: r.MaterialLayout, Entries: []wgpu.BindGroupEntry{{Binding: 0, TextureView: r.view(r.Grass, false, -1)}, {Binding: 1, Sampler: r.NearestRepeat}, {Binding: 18, TextureView: r.view(r.Palette, false, -1)}, {Binding: 19, TextureView: r.view(r.Generated, true, -1)}, {Binding: 20, TextureView: r.view(r.Relief, false, -1)}}}))
	defer mat.Release()
	p.SetBindGroup(0, draw, nil)
	p.SetBindGroup(1, mat, nil)
	p.SetBindGroup(2, r.samplerGroup(), nil)
	p.SetVertexBuffer(0, r.vertices, 0)
	p.SetIndexBuffer(r.indices, gputypes.IndexFormatUint32, 0)
	p.DrawIndexed(gputypes.DrawIndexedArgs{IndexCount: r.indexCount, InstanceCount: 1})
	check(p.End())
	return r.GPU.Submit(enc)
}
func (r *Renderer) ReadRGBA(ctx context.Context) ([]byte, error) {
	return r.ReadTexture(ctx, r.Color, r.Width, r.Height, 0, 0)
}
func (r *Renderer) ReadTexture(ctx context.Context, t *wgpu.Texture, w, h, layer, level int) ([]byte, error) {
	row := (w*4 + 255) / 256 * 256
	b, e := r.GPU.Allocate("texture readback", uint64(row*h), gputypes.BufferUsageMapRead|gputypes.BufferUsageCopyDst)
	if e != nil {
		return nil, e
	}
	defer b.Release()
	enc, e := r.GPU.Device.CreateCommandEncoder(nil)
	if e != nil {
		return nil, e
	}
	enc.CopyTextureToBuffer(t, b, []wgpu.BufferTextureCopy{{BufferLayout: wgpu.ImageDataLayout{BytesPerRow: uint32(row), RowsPerImage: uint32(h)}, TextureBase: wgpu.ImageCopyTexture{Texture: t, MipLevel: uint32(level), Origin: wgpu.Origin3D{Z: uint32(layer)}}, Size: wgpu.Extent3D{Width: uint32(w), Height: uint32(h), DepthOrArrayLayers: 1}}})
	if e = r.GPU.Submit(enc); e != nil {
		return nil, e
	}
	if e = b.Map(ctx, wgpu.MapModeRead, 0, uint64(row*h)); e != nil {
		return nil, e
	}
	mapped, e := b.MappedRange(0, uint64(row*h))
	if e != nil {
		return nil, e
	}
	data := mapped.Bytes()
	out := make([]byte, w*h*4)
	for y := 0; y < h; y++ {
		copy(out[y*w*4:], data[y*row:y*row+w*4])
	}
	e = b.Unmap()
	return out, e
}

func (r *Renderer) samplerGroup() *wgpu.BindGroup {
	bg := must(r.GPU.Device.CreateBindGroup(&wgpu.BindGroupDescriptor{Layout: r.SamplerLayout, Entries: []wgpu.BindGroupEntry{{Binding: 7, Sampler: r.LinearClamp}, {Binding: 8, Sampler: r.LinearRepeat}}}))
	r.own(bg)
	return bg
}

func (r *Renderer) defines(bake bool) map[string]bool {
	return map[string]bool{"CHUNK": r.chunked, "BAKE": bake}
}
func (r *Renderer) bakeW() int {
	if r.bakeWidth > 0 {
		return r.bakeWidth
	}
	return r.Size
}
func (r *Renderer) bakeH() int {
	if r.bakeHeight > 0 {
		return r.bakeHeight
	}
	return r.Size
}

func (r *Renderer) ownShared(v interface{ Release() }) {
	r.resources = append(r.resources, nil)
	copy(r.resources[r.sharedCount+1:], r.resources[r.sharedCount:])
	r.resources[r.sharedCount] = v
	r.sharedCount++
}
