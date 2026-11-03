package model

import "math"

const CurveSamples = 64

type Knot [2]float64
type CurveSpec struct {
	Form  string `json:"form,omitempty"`
	Knots []Knot `json:"knots,omitempty"`
	Back  []Knot `json:"back,omitempty"`
}
type CurveTables struct {
	Front        []float64
	Back         []float64
	Lip          uint32
	Steps        uint32
	Flat, Jitter float64
}

func clamp(v, a, b float64) float64 { return math.Max(a, math.Min(b, v)) }
func KnotCurve(knots []Knot) func(float64) float64 {
	n := len(knots)
	d := make([]float64, n-1)
	for i := range d {
		d[i] = (knots[i+1][1] - knots[i][1]) / math.Max(knots[i+1][0]-knots[i][0], 1e-9)
	}
	m := make([]float64, n)
	for i := 1; i < n-1; i++ {
		if d[i-1]*d[i] <= 0 {
			continue
		}
		h0, h1 := knots[i][0]-knots[i-1][0], knots[i+1][0]-knots[i][0]
		w1, w2 := 2*h1+h0, h1+2*h0
		m[i] = (w1 + w2) / (w1/d[i-1] + w2/d[i])
	}
	return func(x float64) float64 {
		if x <= knots[0][0] {
			return knots[0][1]
		}
		if x >= knots[n-1][0] {
			return knots[n-1][1]
		}
		k := 0
		for knots[k+1][0] < x {
			k++
		}
		h := knots[k+1][0] - knots[k][0]
		u := (x - knots[k][0]) / h
		u2, u3 := u*u, u*u*u
		return (2*u3-3*u2+1)*knots[k][1] + (u3-2*u2+u)*h*m[k] + (-2*u3+3*u2)*knots[k+1][1] + (u3-u2)*h*m[k+1]
	}
}
func SampleKnots(knots []Knot) []float64 {
	f := KnotCurve(knots)
	out := make([]float64, CurveSamples+3)
	for j := range out {
		out[j] = f(float64(j-1) / CurveSamples)
	}
	return out
}
func ReadTable(tab []float64, t float64) float64 {
	x := clamp(t, 0, 1) * CurveSamples
	k := min(int(math.Floor(x)), CurveSamples-1)
	f := x - float64(k)
	p0, p1, p2, p3 := tab[k], tab[k+1], tab[k+2], tab[k+3]
	return p1 + .5*f*(p2-p0+f*(2*p0-5*p1+4*p2-p3+f*(3*(p1-p2)+p3-p0)))
}
func smoothKnots() []Knot {
	out := make([]Knot, 49)
	for i := range out {
		x := float64(i) / 48
		out[i] = Knot{x, x * x * (3 - 2*x)}
	}
	return out
}
func FormKnots(form string, softness float64) ([]Knot, []Knot) {
	switch form {
	case "hill":
		return []Knot{{0, 0}, {1.0 / 3, .02}, {2.0 / 3, .34}, {1, 1}}, smoothKnots()
	case "mountain", "dome":
		m := 2.0
		if form == "mountain" {
			m = 3.5 * math.Pow(2, (.5-softness)*1.5)
		}
		out := make([]Knot, 49)
		for i := range out {
			x := float64(i) / 48
			out[i] = Knot{x, math.Pow(1-(1-x)*(1-x), m)}
		}
		return out, nil
	case "mesa":
		return []Knot{{0, 0}, {.19, .088}, {.381, .25}, {.52, .367}, {.69, .625}, {.845, .883}, {1, 1}}, nil
	case "cliff":
		f := .42 - (softness-.5)*.3
		return []Knot{{0, 0}, {f * .5, .01}, {f, .06}, {f + .28, .8}, {f + .5, .97}, {1, 1}}, nil
	case "terrace":
		return []Knot{{0, 0}, {.06, 0}, {.28, .33}, {.38, .33}, {.6, .67}, {.7, .67}, {.92, 1}, {1, 1}}, nil
	default:
		return smoothKnots(), nil
	}
}
func DefaultForm(kind string, shouldered bool) string {
	if kind == "hill" {
		if shouldered {
			return "hill"
		}
		return "dome"
	}
	if kind == "mountain" {
		return "mountain"
	}
	return "plateau"
}
func StrokeKnots(kind string, softness float64, curve *CurveSpec, shouldered bool) ([]Knot, []Knot) {
	form := DefaultForm(kind, shouldered)
	if curve != nil {
		switch curve.Form {
		case "hill", "mountain", "plateau", "mesa", "cliff", "terrace", "dome":
			form = curve.Form
		}
	}
	knots, back := FormKnots(form, softness)
	if curve != nil && curve.Knots != nil {
		knots = curve.Knots
		if curve.Back != nil {
			back = curve.Back
		}
	}
	return knots, back
}
func StrokeCurve(kind string, softness, terraces, ledge, jitter float64, curve *CurveSpec, shouldered bool) *CurveTables {
	switch kind {
	case "paint", "erase", "sand", "grass", "lower", "smooth", "offset", "deep", "shallow", "plateau", "mountain", "hill":
	default:
		return nil
	}
	knots, back := StrokeKnots(kind, softness, curve, shouldered)
	out := &CurveTables{Front: SampleKnots(knots)}
	if shouldered {
		if back == nil {
			back = smoothKnots()
		}
		out.Back = SampleKnots(back)
	}
	for _, p := range knots {
		if p[1] > 1 || p[1] < 0 {
			out.Lip = 1
		}
	}
	switch kind {
	case "plateau", "offset", "hill", "mountain", "deep", "shallow":
		out.Steps = uint32(math.Floor(clamp(terraces, 0, 8) + .5))
		out.Flat = math.Min(ledge, .95)
		out.Jitter = jitter
	}
	return out
}
func ThinKnots(knots []Knot, n int) []Knot {
	f := KnotCurve(knots)
	out := make([]Knot, n)
	for i := range out {
		x := float64(i) / float64(n-1)
		out[i] = Knot{x, math.Floor(f(x)*1000+.5) / 1000}
	}
	return out
}
