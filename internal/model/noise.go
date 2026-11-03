package model

import "math"

const NoiseSize = 512

func white(size int, seed uint32, count int) []float32 {
	s := seed * 2654435761
	if s == 0 {
		s = 1
	}
	out := make([]float32, size*size)
	for i := range out {
		v := 0.0
		for k := 0; k < count; k++ {
			s ^= s << 13
			s ^= s >> 17
			s ^= s << 5
			v += float64(s) / 4294967296
		}
		out[i] = float32(v - float64(count)*.5)
	}
	return out
}

type kernel func([]float32, []float32, int, int)

func noisePass(src, dst []float32, size int, vertical bool, pad int, fn kernel) {
	buf := make([]float32, size+2*pad)
	out := make([]float32, size)
	lineStep, along := size, 1
	if vertical {
		lineStep, along = 1, size
	}
	for line := 0; line < size; line++ {
		base := line * lineStep
		for i := 0; i < size; i++ {
			buf[pad+i] = src[base+i*along]
		}
		for k := 0; k < pad; k++ {
			buf[k] = buf[k+size]
			buf[pad+size+k] = buf[pad+k]
		}
		fn(buf, out, pad, size)
		for i := 0; i < size; i++ {
			dst[base+i*along] = out[i]
		}
	}
}
func boxKernel(r int) kernel {
	return func(buf, out []float32, pad, size int) {
		norm := 1 / float64(2*r+1)
		sum := 0.0
		for k := -r; k <= r; k++ {
			sum += float64(buf[pad+k])
		}
		for i := 0; i < size; i++ {
			out[i] = float32(sum * norm)
			sum += float64(buf[pad+i+r+1]) - float64(buf[pad+i-r])
		}
	}
}
func tapKernel(taps []float64) kernel {
	return func(buf, out []float32, pad, size int) {
		for i := 0; i < size; i++ {
			sum := taps[0] * float64(buf[pad+i])
			for k := 1; k < len(taps); k++ {
				sum += taps[k] * (float64(buf[pad+i-k]) + float64(buf[pad+i+k]))
			}
			out[i] = float32(sum)
		}
	}
}
func smoothNoise(a []float32, size int, sigma float64) []float32 {
	b := make([]float32, len(a))
	if sigma < 2 {
		r := int(math.Ceil(3 * sigma))
		taps := make([]float64, r+1)
		total := 0.0
		for k := range taps {
			taps[k] = math.Exp(-float64(k*k) / (2 * sigma * sigma))
			if k == 0 {
				total += taps[k]
			} else {
				total += 2 * taps[k]
			}
		}
		for k := range taps {
			taps[k] /= total
		}
		noisePass(a, b, size, false, r, tapKernel(taps))
		noisePass(b, a, size, true, r, tapKernel(taps))
		return a
	}
	ideal := math.Sqrt(12*sigma*sigma/3 + 1)
	low := int(math.Floor(ideal))
	if low%2 == 0 {
		low--
	}
	m := int(math.Floor((12*sigma*sigma-3*float64(low*low)-12*float64(low)-9)/float64(-4*low-4) + .5))
	for i := 0; i < 3; i++ {
		width := low + 2
		if i < m {
			width = low
		}
		r := (width - 1) / 2
		noisePass(a, b, size, false, r+1, boxKernel(r))
		noisePass(b, a, size, true, r+1, boxKernel(r))
	}
	return a
}
func normalizeNoise(field []float32) []byte {
	mean, low, high := 0.0, math.Inf(1), math.Inf(-1)
	for _, fv := range field {
		v := float64(fv)
		mean += v
		low = math.Min(low, v)
		high = math.Max(high, v)
	}
	mean /= float64(len(field))
	top := math.Max(high-mean, mean-low)
	const bins = 4096
	hist := make([]int, bins+1)
	for _, v := range field {
		idx := min(bins, int(math.Floor(math.Abs(float64(v)-mean)/top*bins)))
		hist[idx]++
	}
	count, edge := 0, 0
	want := float64(len(field)) * .995
	for edge <= bins {
		count += hist[edge]
		if float64(count) >= want {
			break
		}
		edge++
	}
	k := .49 / math.Max(float64(edge+1)/bins*top, 1e-8)
	out := make([]byte, len(field))
	for i, v := range field {
		x := math.Max(0, math.Min(1, .5+(float64(v)-mean)*k))
		out[i] = byte(math.Floor(x*255 + .5))
	}
	return out
}
func unitNoise(field []float32) []float32 {
	s := 0.0
	for _, v := range field {
		s += float64(v) * float64(v)
	}
	k := 1 / math.Sqrt(s/float64(len(field)))
	for i := range field {
		field[i] = float32(float64(field[i]) * k)
	}
	return field
}

// MakeNoise produces the periodic RGBA field used by the terrain shaders.
func MakeNoise(size int) []byte {
	broad := smoothNoise(white(size, 11, 1), size, 24)
	mid := smoothNoise(white(size, 12, 1), size, 7)
	fine := smoothNoise(white(size, 14, 2), size, 1)
	a := unitNoise(smoothNoise(white(size, 13, 1), size, 3))
	b := unitNoise(smoothNoise(white(size, 15, 1), size, 9))
	ridged := make([]float32, size*size)
	for i := range ridged {
		ridged[i] = float32(-(.65*math.Abs(float64(a[i])) + .35*math.Abs(float64(b[i]))))
	}
	channels := [][]byte{normalizeNoise(broad), normalizeNoise(mid), normalizeNoise(ridged), normalizeNoise(fine)}
	rgba := make([]byte, size*size*4)
	for c, ch := range channels {
		for i, v := range ch {
			rgba[i*4+c] = v
		}
	}
	return rgba
}
