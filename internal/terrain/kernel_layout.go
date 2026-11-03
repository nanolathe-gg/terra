package terrain

import (
	"fmt"
	"github.com/gogpu/gputypes"
	"github.com/gogpu/wgpu"
	"regexp"
	"strconv"
	"strings"
)

// Explicit layouts also work on native gogpu, whose public pipeline API does
// not expose browser WebGPU's getBindGroupLayout. Only resources reachable
// from this entry point are included, matching WebGPU automatic layouts.
func (g *GPU) kernelLayouts(source, entry string) ([]*wgpu.BindGroupLayout, error) {
	clean := regexp.MustCompile(`(?s)/\*.*?\*/|//[^\n]*`).ReplaceAllString(source, "")
	functions := map[string]string{}
	fr := regexp.MustCompile(`\bfn\s+(\w+)\s*\(`)
	for _, m := range fr.FindAllStringSubmatchIndex(clean, -1) {
		name := clean[m[2]:m[3]]
		start := strings.Index(clean[m[1]:], "{") + m[1]
		depth, end := 1, start+1
		for end < len(clean) && depth > 0 {
			switch clean[end] {
			case '{':
				depth++
			case '}':
				depth--
			}
			end++
		}
		functions[name] = clean[start:end]
	}
	reached := map[string]bool{}
	var visit func(string)
	texts := []string{}
	visit = func(name string) {
		if reached[name] {
			return
		}
		reached[name] = true
		body := functions[name]
		texts = append(texts, body)
		for _, m := range regexp.MustCompile(`\b(\w+)\s*\(`).FindAllStringSubmatch(body, -1) {
			if _, ok := functions[m[1]]; ok {
				visit(m[1])
			}
		}
	}
	visit(entry)
	re := regexp.MustCompile(`@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<([^>]+)>)?\s+(\w+)\s*:\s*([^;]+);`)
	groups := map[int][]gputypes.BindGroupLayoutEntry{}
	maxgroup := -1
	for _, m := range re.FindAllStringSubmatch(clean, -1) {
		used := false
		for _, text := range texts {
			if regexp.MustCompile(`\b(?:let|var|const)\s+` + m[4] + `\b`).MatchString(text) {
				continue
			}
			if regexp.MustCompile(`\b` + m[4] + `\b`).MatchString(text) {
				used = true
				break
			}
		}
		if !used {
			continue
		}
		group, _ := strconv.Atoi(m[1])
		binding, _ := strconv.Atoi(m[2])
		e := gputypes.BindGroupLayoutEntry{Binding: uint32(binding), Visibility: gputypes.ShaderStageCompute}
		typ := m[5]
		switch {
		case strings.Contains(m[3], "uniform"):
			e.Buffer = &gputypes.BufferBindingLayout{Type: gputypes.BufferBindingTypeUniform}
		case strings.Contains(m[3], "storage"):
			bt := gputypes.BufferBindingTypeReadOnlyStorage
			if strings.Contains(m[3], "read_write") {
				bt = gputypes.BufferBindingTypeStorage
			}
			e.Buffer = &gputypes.BufferBindingLayout{Type: bt}
		case strings.HasPrefix(typ, "texture_storage"):
			dim := gputypes.TextureViewDimension2D
			if strings.Contains(typ, "2d_array") {
				dim = gputypes.TextureViewDimension2DArray
			}
			format := gputypes.TextureFormatRGBA8Unorm
			switch {
			case strings.Contains(typ, "rgba16float"):
				format = gputypes.TextureFormatRGBA16Float
			case strings.Contains(typ, "r32float"):
				format = gputypes.TextureFormatR32Float
			case strings.Contains(typ, "rgba8snorm"):
				format = gputypes.TextureFormatRGBA8Snorm
			}
			e.StorageTexture = &gputypes.StorageTextureBindingLayout{Access: gputypes.StorageTextureAccessWriteOnly, Format: format, ViewDimension: dim}
		case strings.HasPrefix(typ, "texture_"):
			dim := gputypes.TextureViewDimension2D
			if strings.Contains(typ, "2d_array") {
				dim = gputypes.TextureViewDimension2DArray
			}
			e.Texture = &gputypes.TextureBindingLayout{SampleType: gputypes.TextureSampleTypeFloat, ViewDimension: dim}
		case typ == "sampler":
			e.Sampler = &gputypes.SamplerBindingLayout{Type: gputypes.SamplerBindingTypeFiltering}
		default:
			return nil, fmt.Errorf("unsupported shader resource %s", typ)
		}
		groups[group] = append(groups[group], e)
		if group > maxgroup {
			maxgroup = group
		}
	}
	out := make([]*wgpu.BindGroupLayout, maxgroup+1)
	for i := range out {
		b, e := g.Device.CreateBindGroupLayout(&wgpu.BindGroupLayoutDescriptor{Entries: groups[i]})
		if e != nil {
			return nil, e
		}
		out[i] = b
		if g.layoutBindings == nil {
			g.layoutBindings = map[*wgpu.BindGroupLayout]map[uint32]bool{}
		}
		ids := map[uint32]bool{}
		for _, e := range groups[i] {
			ids[e.Binding] = true
		}
		g.layoutBindings[b] = ids
	}
	return out, nil
}
