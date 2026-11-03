package terrain

import (
	"encoding/binary"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// Preprocess retains historical line numbering and CHUNK branch removal.
func Preprocess(source, common string, defines map[string]bool) string {
	type cond struct {
		name string
		on   bool
	}
	s := []cond{}
	o := []string{}
	re := regexp.MustCompile(`^\s*#(ifdef|ifndef|else|endif)\b\s*(\w*)`)
	excluded := func(chunk bool) bool {
		for _, c := range s {
			if !c.on && (!chunk || c.name == "CHUNK") {
				return true
			}
		}
		return false
	}
	for _, line := range strings.Split(strings.Replace(source, "/*COMMON*/", common, 1), "\n") {
		m := re.FindStringSubmatch(line)
		if m == nil {
			if !excluded(false) {
				o = append(o, line)
			} else if !excluded(true) {
				o = append(o, "")
			}
			continue
		}
		chunk := false
		switch m[1] {
		case "ifdef", "ifndef":
			chunk = m[2] == "CHUNK"
			on := defines[m[2]]
			if m[1] == "ifndef" {
				on = !on
			}
			s = append(s, cond{m[2], on})
		case "else", "endif":
			if len(s) == 0 {
				panic("unbalanced shader directive")
			}
			chunk = s[len(s)-1].name == "CHUNK"
			if m[1] == "else" {
				s[len(s)-1].on = !s[len(s)-1].on
			} else {
				s = s[:len(s)-1]
			}
		}
		if !chunk && !excluded(true) {
			o = append(o, "")
		}
	}
	return strings.Join(o, "\n")
}

type UniformField struct {
	Offset, Width, Count, Stride int
	Integer                      bool
}
type Uniforms struct {
	Fields map[string]UniformField
	Data   []byte
}

func ParseUniforms(src string) (*Uniforms, error) {
	body := regexp.MustCompile(`(?s)struct Uniforms\s*\{(.*?)\n\}`).FindStringSubmatch(src)
	if body == nil {
		return nil, fmt.Errorf("shader has no Uniforms")
	}
	u := &Uniforms{Fields: map[string]UniformField{}}
	offset := 0
	re := regexp.MustCompile(`^(\w+)\s*:\s*(?:array<(\w+),\s*(\d+)>|(\w+))\s*,?$`)
	for _, raw := range strings.Split(body[1], "\n") {
		line := strings.TrimSpace(strings.Split(raw, "//")[0])
		if line == "" {
			continue
		}
		m := re.FindStringSubmatch(line)
		if m == nil {
			return nil, fmt.Errorf("unsupported uniform %q", line)
		}
		typ := m[4]
		array := m[2] != ""
		count := 1
		if array {
			typ = m[2]
			count, _ = strconv.Atoi(m[3])
		}
		w, a := 0, 4
		switch typ {
		case "f32", "i32":
			w = 1
		case "vec2f":
			w = 2
			a = 8
		case "vec3f":
			w = 3
			a = 16
		case "vec4f":
			w = 4
			a = 16
		default:
			return nil, fmt.Errorf("unsupported type %q", typ)
		}
		stride, size := 0, w*4
		if array {
			a = 16
			stride = 16
			size = count * 16
		}
		offset = (offset + a - 1) / a * a
		u.Fields[m[1]] = UniformField{offset, w, count, stride, typ == "i32"}
		offset += size
	}
	u.Data = make([]byte, (offset+15)/16*16)
	return u, nil
}
func (u *Uniforms) Set(name string, v ...float64) {
	f, ok := u.Fields[name]
	if !ok {
		return
	}
	for i, x := range v {
		if i >= f.Width*f.Count {
			break
		}
		at := f.Offset + i*4
		if f.Stride > 0 {
			at = f.Offset + i/f.Width*f.Stride + i%f.Width*4
		}
		bits := math.Float32bits(float32(x))
		if f.Integer {
			bits = uint32(int32(x))
		}
		binary.LittleEndian.PutUint32(u.Data[at:], bits)
	}
}

// UniformSnapshot decodes the current CPU-side shader values for parity tools.
// GPU-written mask flags are read from authored data only; chunk coordinates
// depend on the last rendered tile and should be excluded in cross-tile diffs.
func (r *Renderer) UniformSnapshot() map[string][]float64 {
	out := map[string][]float64{}
	for name, f := range r.Uniform.Fields {
		values := make([]float64, f.Width*f.Count)
		for i := range values {
			at := f.Offset + i*4
			if f.Stride > 0 {
				at = f.Offset + i/f.Width*f.Stride + i%f.Width*4
			}
			bits := binary.LittleEndian.Uint32(r.Uniform.Data[at:])
			if f.Integer {
				values[i] = float64(int32(bits))
			} else {
				values[i] = float64(math.Float32frombits(bits))
			}
		}
		out[name] = values
	}
	return out
}
