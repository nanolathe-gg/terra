package terrain

import (
	"context"
	"encoding/binary"
	"fmt"
	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
	"math"
	"time"
)

// RenderRegion describes the exact input apron and global mesh lattice of a
// requested output window. Field replay must cover its full grid rectangle.
type RenderRegion struct {
	GridX, GridY, GridWidth, GridHeight         int
	GridSpacing                                 float64
	FieldsX, FieldsY, FieldsWidth, FieldsHeight int
	Col0, Col1, Row0, Row1, Resolution          int
	ScreenOrigin                                [2]float64
	WorldSize, WorldGrid                        int
}
type WindowInput struct {
	Feed                                    *GPUFeed
	Window                                  SceneWindow
	Region                                  *RenderRegion
	Heights, Routes, Cracks, Cover, Crystal []float32
	Masks                                   [][]int8
	Weather                                 map[string][]float32
	Material                                []float32
	ExportArt                               bool
}

func clampInt(x, a, b int) int { return min(b, max(a, x)) }
func pow2(n int) int {
	p := 1
	for p < n {
		p *= 2
	}
	return p
}
func (r *Renderer) reaches(full bool) (draw, bake, direct float64, projection [2]float64) {
	n := r.num
	shadow := 5.
	if full {
		shadow = 12
	}
	shadow = shadow*shadow*1.4 + 2
	draw = math.Max(shadow, 36)
	if n("crystalShallow", 0) > 0 {
		draw = math.Max(draw, 48)
	}
	boulder := n("boulderSize", 9)*1.6*1.8 + 19
	debris := math.Max(3, n("debrisSize", 6)*.9)*1.85 + n("debrisReach", 48) + 18
	beach := 0.
	if r.hasLayer("beach") {
		beach = number(object(r.Config, "material"), "beachWidth", 120) * n("beachWidth", .6)
	}
	beach = math.Max(beach, n("apron", 0)) * 1.35 * 1.15
	cliff := 0.
	if n("cliffFollow", 0) > 0 {
		cliff = 1.45*math.Max(n("cliffDomain", 90), 24) + math.Max(n("cliffWide", 56), math.Max(n("cliffReach", 20)*1.5, 4)) + 2
	}
	bake = math.Max(19, math.Max(boulder, math.Max(debris, math.Max(beach, cliff))))
	direct = math.Max(61, math.Max(48*math.Max(.65, 1.6*n("ringSpread", .65)), math.Max(math.Abs(n("waterSoft", 32)), 41*math.Abs(n("ringVariation", .7)/.75))))
	if n("ringShift", 0) > 0 {
		direct = math.Max(direct, math.Abs(n("ringShift", 0))+4)
	}
	bounds := vector(r.Config, "heightBounds", []float64{-90, 300})
	slope := (bounds[1] - bounds[0]) * math.Sqrt2 / 10
	relief := math.Abs(n("reliefAmount", .5)*n("reliefScale", 28)) * math.Max(2.5, .25*n("gentleRelief", .6)) * math.Max(1, math.Abs(n("gentleRelief", .6))) * math.Max(1, 1+.65*n("reliefPatchy", 1)) * 4
	severity := math.Max(n("crackSeverity", .6), .6)
	major := n("crackSpacing", 40)
	minor := major / 3.2
	blocks := (.5*(1+3*severity) + 1.225*major + .5*(.6+1.6*severity) + 4.41*minor) * math.Max(n("crackBlocks", .6), .6)
	beds := (math.Abs(n("bedSpacing", 12))*math.Max(1, math.Pow(slope+math.Abs(n("bedDip", 0)), 1-n("bedHeight", 0)))*1.8*math.Abs(n("bedLedge", .5)) + flag(n("bedLedge", .5) > 0)*3.6) * math.Abs(n("rockOrder", 0))
	column := object(r.Config, "column")
	bandValues := vector(column, "bands", []float64{3.7, .5})
	row := object(object(column, "variants"), str(r.Config, "variant"))
	bandValues = vector(row, "bands", bandValues)
	bands := bandValues[0] * math.Max(math.Abs(n("banding", 0))*4, .8)
	lumps := 1.6 * (math.Abs(n("plainRelief", 1.2)) + math.Abs(n("lumpRelief", 4)) + math.Abs(n("bedRelief", 0)))
	gully := math.Abs(n("ribTilt", 0)) * math.Max(n("grooveSpacing", 8), 8)
	f := math.Max(n("blockRow", 2), 2)
	coarse := math.Max(n("facetCoarse", 0), 0)
	facet := 1.85*f*math.Abs(n("facetTilt", 0))*(math.Max(n("blockWidth", .5)/f, .25)+.25)*(1+2.4*coarse) + .5*math.Abs(n("blockStep", 0))*(1+coarse)
	extra := gully + facet + relief + blocks + beds + bands + lumps + 7.84*math.Abs(n("worms", 0)) + math.Abs(n("boulderSize", 9)) + math.Abs(n("debrisSize", 6))*.35 + math.Abs(n("rippleHeight", 1.4))
	sea, base := number(r.Config, "seaLevel", 0), number(r.Config, "baseHeight", 24)
	visible := math.Max(sea, bounds[1]+2.85+math.Abs(number(object(r.Config, "material"), "surfaceRelief", 1))*extra+4)
	projection = [2]float64{(sea - base) / 2, (visible - base) / 2}
	return
}
func (r *Renderer) RequiredRegion(w SceneWindow, full bool) *RenderRegion {
	size, grid := r.Size, r.Grid
	spacing := float64(size-1) / float64(grid-1)
	draw, bake, direct, projection := r.reaches(full)
	shift := 0
	if w.ExportArt {
		shift = int(math.Floor(number(r.Config, "baseHeight", 24) / 2))
	}
	step0 := 1023. / 192
	if full {
		step0 = 1023. / 512
	}
	resolution := int(math.Ceil(float64(size-1) / step0))
	step := float64(size-1) / float64(resolution)
	col0 := clampInt(int(math.Floor(float64(w.X)/step))-1, 0, resolution)
	col1 := clampInt(int(math.Ceil(float64(w.X+w.Width)/step))+1, 0, resolution)
	row0 := clampInt(int(math.Floor((float64(w.Y+shift)+projection[0])/step))-1, 0, resolution)
	row1 := clampInt(int(math.Ceil((float64(w.Y+shift+w.Height)+projection[1])/step))+1, 0, resolution)
	fx := clampInt(int(math.Floor(float64(col0)*step-draw))-1, 0, size-1)
	fy := clampInt(int(math.Floor(float64(row0)*step-draw))-1, 0, size-1)
	ex := clampInt(int(math.Ceil(float64(col1)*step+draw))+1, 0, size-1)
	ey := clampInt(int(math.Ceil(float64(row1)*step+draw))+1, 0, size-1)
	input := math.Max(bake, math.Max(direct-draw, 5))
	gx0 := clampInt(int(math.Floor((float64(fx)-input)/spacing))-1, 0, grid-1)
	gy0 := clampInt(int(math.Floor((float64(fy)-input)/spacing))-1, 0, grid-1)
	gx1 := clampInt(int(math.Ceil((float64(ex)+input)/spacing))+1, 0, grid-1)
	gy1 := clampInt(int(math.Ceil((float64(ey)+input)/spacing))+1, 0, grid-1)
	return &RenderRegion{gx0, gy0, gx1 - gx0 + 1, gy1 - gy0 + 1, spacing, fx, fy, ex - fx + 1, ey - fy + 1, col0, col1, row0, row1, resolution, [2]float64{float64(w.X), float64(w.Y + shift)}, size, grid}
}

type RenderProfile struct {
	TotalMilliseconds, FeedMilliseconds, UploadMilliseconds, EncodeMilliseconds, ReadbackMilliseconds float64
	Width, Height, GridWidth, GridHeight, FieldWidth, FieldHeight, WorkingBytes, FixedBytes           int
	GPUFed                                                                                            bool
}

func elapsed(start time.Time) float64 { return float64(time.Since(start)) / float64(time.Millisecond) }
func (r *Renderer) RenderWindow(ctx context.Context, in WindowInput, o DrawOptions) (pixels []byte, err error) {
	started := time.Now()
	profile := RenderProfile{GPUFed: in.Feed != nil}
	defer func() { profile.TotalMilliseconds = elapsed(started); r.LastProfile = profile }()
	defer recoverError(&err)
	defer r.GPU.scope()(&err)
	if !r.chunked {
		return nil, fmt.Errorf("RenderWindow requires chunked renderer")
	}
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	if o.ExportArt {
		in.ExportArt = true
	}
	reg := in.Region
	if reg == nil {
		reg = r.RequiredRegion(in.Window, o.Full)
	}
	w, h := reg.GridWidth, reg.GridHeight
	n := w * h
	if in.Feed == nil && len(in.Heights) != n {
		return nil, fmt.Errorf("regional height length %d, expected %d", len(in.Heights), n)
	}
	gw, gh := pow2(w), pow2(h)
	scale := in.Window.Scale
	if scale <= 0 {
		scale = 1
	}
	rasterScale := scale
	if scale >= 1 {
		rasterScale = math.Max(1, scale/2)
	}
	fieldScale := math.Max(scale, .5)
	fw, fh := pow2(int(math.Ceil(float64(reg.FieldsWidth)/fieldScale))), pow2(int(math.Ceil(float64(reg.FieldsHeight)/fieldScale)))
	outputW, outputH := int(math.Ceil(float64(in.Window.Width)/rasterScale)), int(math.Ceil(float64(in.Window.Height)/rasterScale))
	layers := max(1, (len(in.Masks)+3)/4)
	if len(in.Masks) == 0 {
		layers = 7
	}
	budget := number(r.Config, "gpuBudgetBytes", number(r.Config, "gpuBudgetMB", number(r.Config, "gpuMB", 512))*1024*1024)
	cols, rows := reg.Col1-reg.Col0, reg.Row1-reg.Row0
	meshBytes := (cols+1)*(rows+1)*8 + max(4, cols*rows*24)
	working := fw*fh*8 + gw*gh*(24+layers*4) + outputW*outputH*12 + meshBytes
	if in.Window.HeightsOnly {
		working = gw*gh*(24+layers*4) + ((gw*4+255)/256*256)*gh
	}
	needed := float64(working) + float64(r.FixedBytes()) + math.Max(number(r.Config, "gpuReservedBytes", 0), float64(r.reservedGPUBytes))
	if needed > budget {
		return nil, fmt.Errorf("terrain chunk needs %.1f MB, budget %.1f MB", needed/1048576, budget/1048576)
	}
	limit := int(r.GPU.Device.Limits().MaxTextureDimension2D)
	maxDimension := max(gw, gh)
	if !in.Window.HeightsOnly {
		maxDimension = max(maxDimension, fw, fh, outputW, outputH)
	}
	if maxDimension > limit {
		return nil, fmt.Errorf("terrain chunk exceeds %d pixel texture limit", limit)
	}
	// The working set belongs to one window. Shared material resources remain resident.
	r.releaseWorking()
	u := gputypes.TextureUsageTextureBinding | gputypes.TextureUsageCopyDst | gputypes.TextureUsageStorageBinding
	r.HeightTexture = r.texture("chunk height", gw, gh, 1, 1, gputypes.TextureFormatR32Float, u|gputypes.TextureUsageCopySrc)
	r.RouteTexture = r.texture("chunk routes", gw, gh, 1, 1, gputypes.TextureFormatRGBA8Unorm, u)
	r.GridTexture = r.texture("chunk weather", gw, gh, 4, 1, gputypes.TextureFormatRGBA8Unorm, u)
	r.MaskTexture = r.texture("chunk masks", gw, gh, layers, 1, gputypes.TextureFormatRGBA8Snorm, u)
	r.FieldsTexture = nil
	if !in.Window.HeightsOnly {
		r.FieldsTexture = r.texture("chunk fields", fw, fh, 1, 1, gputypes.TextureFormatRGBA16Float, gputypes.TextureUsageStorageBinding|gputypes.TextureUsageTextureBinding)
	}
	r.maskLayers = layers
	profile.Width, profile.Height = outputW, outputH
	profile.GridWidth, profile.GridHeight = gw, gh
	profile.FieldWidth, profile.FieldHeight = fw, fh
	profile.FixedBytes = r.FixedBytes()
	profile.WorkingBytes = int(needed) - profile.FixedBytes
	uploadStart := time.Now()
	r.gpuFlags = false
	if in.Feed == nil {
		heights := make([]float32, gw*gh)
		routes := make([]byte, gw*gh*4)
		maps := make([]byte, gw*gh*16)
		masks := make([]byte, gw*gh*layers*4)
		painted := make([]bool, max(25, len(in.Masks)))
		sea := float32(number(r.Config, "seaLevel", 0))
		for y := 0; y < gh; y++ {
			if y%32 == 0 {
				if e := ctx.Err(); e != nil {
					return nil, e
				}
			}
			for x := 0; x < gw; x++ {
				src := min(y, h-1)*w + min(x, w-1)
				dst := y*gw + x
				v := in.Heights[src]
				if in.ExportArt {
					v = max(0, min(255, v))
				}
				heights[dst] = v - sea
				routes[dst*4] = quant(at(in.Routes, src))
				routes[dst*4+1] = quant(at(in.Cracks, src))
				routes[dst*4+2] = quant(at(in.Cover, src)*.5 + .5)
				routes[dst*4+3] = quant(at(in.Crystal, src))
				for k, p := range in.Masks {
					if len(p) == 0 {
						continue
					}
					v := p[src]
					masks[(k/4)*gw*gh*4+dst*4+k%4] = byte(v)
					painted[k] = painted[k] || v != 0
				}
				for layer, names := range [][]string{{"flow", "deposit", "talus", "sand"}, {}, {"wear", "wet", "hard", "slope"}, {"fx", "fy", "channel", "ridge"}} {
					for k, name := range names {
						maps[layer*gw*gh*4+dst*4+k] = quant(at(in.Weather[name], src))
					}
				}
				for k := 0; k < 4; k++ {
					maps[gw*gh*4+dst*4+k] = quant(at(in.Material, src*4+k))
				}
			}
		}
		check(r.upload(r.HeightTexture, FloatBytes(heights), gw, gh, 0, 1, 4))
		check(r.upload(r.RouteTexture, routes, gw, gh, 0, 1, 4))
		check(r.upload(r.GridTexture, maps, gw, gh, 0, 4, 4))
		check(r.upload(r.MaskTexture, masks, gw, gh, 0, layers, 4))
		any := func(a, b int) bool {
			for _, p := range painted[a:b] {
				if p {
					return true
				}
			}
			return false
		}
		for k, v := range map[string]bool{"paintOn": any(0, 9), "scatterOn": painted[4], "styleOn": any(5, 9), "waterOn": any(9, 12) || painted[13], "lumpOn": painted[12], "overrideOn": any(14, 18)} {
			r.Set("u"+upper(k), flag(v))
		}
		r.materialReady = in.Material != nil
		r.Set("uMaterialReady", flag(r.materialReady))
		r.Set("uWeatherMaps", flag(in.Weather["wear"] != nil))
	} else {
		feedStart := time.Now()
		check(r.feedFromGPU(ctx, in.Feed, reg, gw, gh, in.ExportArt))
		r.materialReady = in.Feed.Field != nil
		r.Set("uMaterialReady", flag(r.materialReady))
		r.Set("uWeatherMaps", flag(in.Feed.Maps[0] != nil))
		profile.FeedMilliseconds = elapsed(feedStart)
	}
	profile.UploadMilliseconds = elapsed(uploadStart) - profile.FeedMilliseconds
	if in.Window.HeightsOnly {
		profile.FieldWidth, profile.FieldHeight = 0, 0
		return nil, nil
	}
	r.Set("uGrid", float64(r.Grid))
	r.Set("uSize", float64(r.Size))
	r.Set("uChunkGridOrigin", float64(reg.GridX), float64(reg.GridY))
	r.Set("uChunkGridSize", float64(gw), float64(gh))
	r.Set("uChunkGridCount", float64(w), float64(h))
	r.Set("uChunkFieldsOrigin", float64(reg.FieldsX), float64(reg.FieldsY))
	r.Set("uChunkFieldsSize", float64(fw), float64(fh))
	r.Set("uChunkScreenOrigin", reg.ScreenOrigin[:]...)
	r.Set("uChunkScreenSize", float64(in.Window.Width), float64(in.Window.Height))
	r.Set("uChunkScale", rasterScale)
	r.Set("uChunkFieldScale", fieldScale)
	rasterSize := math.Min(float64(r.Size), float64(limit)*math.Min(1, rasterScale))
	origin := [2]float64{}
	if float64(r.Size) > rasterSize {
		span := rasterSize / 2
		origin = [2]float64{math.Floor(reg.ScreenOrigin[0]/span) * span, math.Floor(reg.ScreenOrigin[1]/span) * span}
	}
	r.Set("uChunkRasterOrigin", origin[:]...)
	r.Set("uChunkRasterSize", rasterSize)
	r.viewport = [4]float32{float32((origin[0] - reg.ScreenOrigin[0]) / rasterScale), float32((origin[1] - reg.ScreenOrigin[1]) / rasterScale), float32(rasterSize / rasterScale), float32(rasterSize / rasterScale)}
	r.bakeWidth = min(fw, int(math.Ceil(float64(reg.FieldsWidth)/fieldScale))+1)
	r.bakeHeight = min(fh, int(math.Ceil(float64(reg.FieldsHeight)/fieldScale))+1)
	r.activeRegion = reg
	r.regionMesh(reg)
	o.Width, o.Height = outputW, outputH
	encodeStart := time.Now()
	if e := r.Render(o); e != nil {
		return nil, e
	}
	profile.EncodeMilliseconds = elapsed(encodeStart)
	readStart := time.Now()
	pixels, err = r.ReadRGBA(ctx)
	if err != nil {
		return nil, err
	}
	profile.ReadbackMilliseconds = elapsed(readStart)
	outW, outH := int(math.Ceil(float64(in.Window.Width)/scale)), int(math.Ceil(float64(in.Window.Height)/scale))
	if outputW != outW || outputH != outH {
		pixels = resizeRGBA(pixels, outputW, outputH, outW, outH)
	}
	return pixels, nil
}
func (r *Renderer) releaseWorking() {
	for i := len(r.resources) - 1; i >= r.sharedCount; i-- {
		r.resources[i].Release()
	}
	r.resources = r.resources[:r.sharedCount]
	for _, t := range []*wgpu.Texture{r.HeightTexture, r.RouteTexture, r.GridTexture, r.MaskTexture, r.FieldsTexture, r.Color, r.Depth} {
		if t != nil {
			t.Release()
		}
	}
	r.Color = nil
	r.Depth = nil
	r.Width = 0
	r.Height = 0
}

func (r *Renderer) regionMesh(reg *RenderRegion) {
	if r.vertices != nil {
		r.vertices.Release()
		r.indices.Release()
	}
	cols, rows := reg.Col1-reg.Col0, reg.Row1-reg.Row0
	v := make([]float32, (cols+1)*(rows+1)*2)
	k := 0
	for y := reg.Row0; y <= reg.Row1; y++ {
		for x := reg.Col0; x <= reg.Col1; x++ {
			v[k] = float32(float64(x) / float64(reg.Resolution))
			v[k+1] = float32(float64(y) / float64(reg.Resolution))
			k += 2
		}
	}
	b := make([]byte, max(4, cols*rows*24))
	k = 0
	for y := 0; y < rows; y++ {
		for x := 0; x < cols; x++ {
			a := y*(cols+1) + x
			bb := a + cols + 1
			for _, i := range []int{a, bb, a + 1, a + 1, bb, bb + 1} {
				binary.LittleEndian.PutUint32(b[k:], uint32(i))
				k += 4
			}
		}
	}
	r.vertices = must(r.GPU.Buffer("chunk vertices", FloatBytes(v), gputypes.BufferUsageVertex))
	r.indices = must(r.GPU.Buffer("chunk indices", b, gputypes.BufferUsageIndex))
	r.indexCount = uint32(cols * rows * 6)
}

// Box reduction retains shader colour variance before nonlinear palette mapping.
func resizeRGBA(src []byte, sw, sh, dw, dh int) []byte {
	dst := make([]byte, dw*dh*4)
	for y := 0; y < dh; y++ {
		for x := 0; x < dw; x++ {
			x0, x1 := x*sw/dw, max(x*sw/dw+1, (x+1)*sw/dw)
			y0, y1 := y*sh/dh, max(y*sh/dh+1, (y+1)*sh/dh)
			for c := 0; c < 4; c++ {
				sum, n := 0, 0
				for yy := y0; yy < min(y1, sh); yy++ {
					for xx := x0; xx < min(x1, sw); xx++ {
						sum += int(src[(yy*sw+xx)*4+c])
						n++
					}
				}
				dst[(y*dw+x)*4+c] = byte((sum + n/2) / n)
			}
		}
	}
	return dst
}

// FixedBytes counts live renderer-owned shared textures/buffers, excluding driver
// allocations and transient initialization resources already released.
func (r *Renderer) FixedBytes() int {
	mips := 0
	for level := 0; level < 7; level++ {
		side := 512 >> level
		mips += side * side
	}
	return mips*(len(r.Table.Order)*4+8) + 512*512*4 + 1024*96*4 + 512*32*4 + len(r.Uniform.Data)
}

// SetReservedGPUBytes accounts for external GPU fields/pages and image caches.
func (r *Renderer) SetReservedGPUBytes(bytes int) { r.reservedGPUBytes = max(0, bytes) }
