//go:build js && wasm

package editor

import (
	"encoding/json"
	"fmt"
	"math"
	"syscall/js"

	"github.com/nanolathe-gg/terraform/internal/model"
)

var sectionObservers []js.Value

func readCurveKnots(v any) []model.Knot {
	if v == nil {
		return nil
	}
	b, e := json.Marshal(v)
	if e != nil {
		return nil
	}
	var k []model.Knot
	if json.Unmarshal(b, &k) != nil {
		return nil
	}
	return k
}
func roundCurveKnots(k []model.Knot) []model.Knot {
	out := clone(k)
	for i := range out {
		out[i][0] = math.Round(out[i][0]*1000) / 1000
		out[i][1] = math.Round(out[i][1]*1000) / 1000
	}
	return out
}
func (a *App) curveKind() string {
	if n := a.selected(); n != nil {
		return n.Kind
	}
	return a.Tool
}
func (a *App) curveSpec() *model.CurveSpec {
	var c model.CurveSpec
	b, _ := json.Marshal(a.Curve)
	_ = json.Unmarshal(b, &c)
	return &c
}
func (a *App) curveShouldered() bool {
	ridge := number("spur-count") >= 1 || number("crest-jag") > 0 || number("crest-vary") > 0 || number("crest-taper") > 0
	return model.IsShouldered(a.curveKind(), number("lean")/100, ridge)
}
func (a *App) curveKnots() []model.Knot {
	k, _ := model.StrokeKnots(a.curveKind(), number("softness")/100, a.curveSpec(), a.curveShouldered())
	if len(readCurveKnots(a.Curve["knots"])) == 0 && len(k) > 12 {
		return model.ThinKnots(k, 9)
	}
	return k
}
func (a *App) backCurveKnots() []model.Knot {
	if a.curveKind() != "landform" {
		return nil
	}
	return readCurveKnots(a.Curve["back"])
}
func (a *App) storeSection(front, back []model.Knot) {
	form := str(a.Curve, "form", "")
	if form == "" {
		form = model.DefaultForm(a.curveKind(), a.curveShouldered())
	}
	c := map[string]any{"form": form, "knots": roundCurveKnots(front)}
	if back != nil {
		c["back"] = roundCurveKnots(back)
	}
	a.Curve = c
	a.commitCurveEdit()
}
func (a *App) commitCurveEdit() {
	if n := a.selected(); n != nil {
		if n.Params == nil {
			n.Params = map[string]any{}
		}
		if a.Curve != nil {
			n.Params["curve"] = clone(a.Curve)
		} else {
			delete(n.Params, "curve")
		}
		if a.Along != nil {
			n.Params["along"] = clone(a.Along)
		} else {
			delete(n.Params, "along")
		}
		a.Change()
	} else {
		a.rememberTool()
		a.drawCurve()
	}
	a.persist()
}
func (a *App) setSectionLean(ratio float64) {
	setValue("lean", max(25, min(400, math.Round(ratio*20)*5)))
	element("lean").Call("dispatchEvent", js.Global().Get("Event").New("input", js.ValueOf(map[string]any{"bubbles": true})))
}

type sectionLayout struct {
	w, h, xL, xR, xc, top, bottom, plain, sea, elevation, span, lo, hi float64
	land                                                               bool
}

func (a *App) sectionGeometry(canvas js.Value, along bool) sectionLayout {
	w, h := canvas.Get("width").Float(), canvas.Get("height").Float()
	ratio := a.sectionLeanRatio()
	if along {
		ratio = 1
	}
	l := sectionLayout{w: w, h: h, xL: 9, xR: w - 9, top: 11, bottom: h - 11, plain: num(a.Config, "baseHeight", 24), sea: num(a.Config, "seaLevel", 0), elevation: number("lf-elevation"), land: a.curveKind() == "landform"}
	if along {
		l.top = 9
		l.bottom = h - 9
	}
	l.xc = l.xL + (l.xR-l.xL)*ratio/(1+ratio)
	l.span = l.elevation - l.plain
	if math.Abs(l.span) < 1 {
		if l.span < 0 {
			l.span = -1
		} else {
			l.span = 1
		}
	}
	top := l.plain + l.span*1.2
	l.lo = math.Min(math.Min(l.sea, l.plain), math.Min(l.elevation, top))
	l.hi = math.Max(math.Max(l.sea, l.plain), math.Max(l.elevation, top))
	pad := math.Max(5, (l.hi-l.lo)*.1)
	l.lo -= pad
	l.hi += pad
	return l
}
func (l sectionLayout) yHeight(h float64) float64 {
	return l.bottom - (l.bottom-l.top)*(h-l.lo)/(l.hi-l.lo)
}
func (l sectionLayout) valueY(v float64) float64 {
	if l.land {
		return l.yHeight(l.plain + l.span*v)
	}
	return l.bottom - (l.bottom-l.top)*(v+.6)/2.2
}
func (l sectionLayout) yValue(y float64) float64 {
	if l.land {
		h := l.lo + (l.hi-l.lo)*(l.bottom-y)/(l.bottom-l.top)
		return (h - l.plain) / l.span
	}
	return -.6 + (l.bottom-y)/(l.bottom-l.top)*2.2
}
func (l sectionLayout) sideX(side string, x float64) float64 {
	if side == "back" {
		return l.xc - (l.xc-l.xL)*(1-x)
	}
	return l.xc + (l.xR-l.xc)*(1-x)
}
func (l sectionLayout) sideShare(side string, x float64) float64 {
	span := l.xR - l.xc
	if side == "back" {
		span = l.xc - l.xL
	}
	return max(0, min(1, 1-math.Abs(x-l.xc)/span))
}
func (a *App) sectionLeanRatio() float64 {
	kind := a.curveKind()
	lean := number("lean") / 100
	setup := model.LeanSetup(kind, lean, number("facing"), number("sec-face-px"))
	if setup.Ratio != nil || !a.curveShouldered() {
		return setup.K + 1
	}
	face, back := model.HillWidths(number("softness")/100, number("sec-face-px"), max(1, number("diameter")/2), setup.Ratio)
	return back / face
}
func fitSectionCanvas(c js.Value, aspect float64) {
	w := math.Round(c.Get("clientWidth").Float())
	if w >= 120 && w != c.Get("width").Float() {
		c.Set("width", w)
		c.Set("height", math.Round(w*aspect))
	}
}
func (a *App) mountCurve() {
	row := create("div", "control", "")
	row.Set("id", "section-preview-control")
	row.Set("innerHTML", `<label for="curve-form">Section</label><select id="curve-form" style="width:100%"></select><canvas id="section-preview" width="480" height="240" style="width:100%;background:#172119;touch-action:none;cursor:crosshair"></canvas><div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" id="curve-link" aria-pressed="true">Link sides</button><button type="button" id="curve-mirror">Mirror</button><button type="button" id="curve-reset">Reset to the form</button><span class="small" id="curve-lean"></span></div><p class="small">Drag a knot; click the line to add one; Shift-click or double-click a knot to remove it. Drag the diamond at the crest to lean the shape.</p><div id="along-block" hidden><label for="along-preview">Height along the path</label><canvas id="along-preview" width="480" height="140" style="width:100%;background:#172119;touch-action:none;cursor:crosshair"></canvas><button type="button" id="along-reset">Level along the path</button><p class="small">Click to pick the place shown above; double-click to add a knot, drag to move it, or Shift-click to remove it.</p></div>`)
	element("shape-options").Call("prepend", row)
	on(element("curve-form"), "change", func(js.Value) {
		a.Curve = nil
		if form := value("curve-form"); form != "" {
			a.Curve = map[string]any{"form": form}
		}
		a.commitCurveEdit()
		if a.selected() != nil {
			a.Checkpoint()
		}
	})
	click("curve-reset", func() {
		form := str(a.Curve, "form", "")
		a.Curve = nil
		if form != "" {
			a.Curve = map[string]any{"form": form}
		}
		a.commitCurveEdit()
		if a.selected() != nil {
			a.Checkpoint()
		}
	})
	click("along-reset", func() {
		a.Along = nil
		a.commitCurveEdit()
		if a.selected() != nil {
			a.Checkpoint()
		}
	})
	click("curve-link", func() {
		if a.curveKind() != "landform" {
			return
		}
		f, b := a.curveKnots(), a.backCurveKnots()
		if b == nil {
			b = clone(f)
		} else {
			b = nil
		}
		a.storeSection(f, b)
		if a.selected() != nil {
			a.Checkpoint()
		}
	})
	click("curve-mirror", func() {
		if a.curveKind() != "landform" {
			return
		}
		f, b := a.curveKnots(), a.backCurveKnots()
		if b == nil {
			return
		}
		ratio := a.sectionLeanRatio()
		a.storeSection(b, f)
		a.setSectionLean(1 / ratio)
		if a.selected() != nil {
			a.Checkpoint()
		}
	})
	a.sectionEvents()
	a.alongEvents()
	if ctor := js.Global().Get("ResizeObserver"); exists(ctor) {
		cb := js.FuncOf(func(js.Value, []js.Value) any { a.drawCurve(); return nil })
		callbacks = append(callbacks, cb)
		observer := ctor.New(cb)
		observer.Call("observe", element("section-preview"))
		observer.Call("observe", element("along-preview"))
		sectionObservers = append(sectionObservers, observer)
	}
}
func sectionPoint(c js.Value, e js.Value) (float64, float64) {
	r := c.Call("getBoundingClientRect")
	return (e.Get("clientX").Float() - r.Get("left").Float()) * c.Get("width").Float() / r.Get("width").Float(), (e.Get("clientY").Float() - r.Get("top").Float()) * c.Get("height").Float() / r.Get("height").Float()
}

type sectionHandle struct {
	side, edit string
	index      int
	x, y       float64
}

func (a *App) sectionHandles(l sectionLayout) []sectionHandle {
	out := []sectionHandle{}
	front := a.curveKnots()
	back := a.backCurveKnots()
	for i, k := range front {
		out = append(out, sectionHandle{"front", "front", i, l.sideX("front", k[0]), l.valueY(k[1])})
	}
	if l.land {
		edit := "back"
		if back == nil {
			back = front
			edit = "front"
		}
		for i, k := range back {
			out = append(out, sectionHandle{"back", edit, i, l.sideX("back", k[0]), l.valueY(k[1])})
		}
	}
	return out
}
func (a *App) sectionEvents() {
	c := element("section-preview")
	drag := sectionHandle{index: -1}
	leanDrag := false
	hit := func(l sectionLayout, x, y float64) *sectionHandle {
		var best *sectionHandle
		distance := 8.0
		for _, h := range a.sectionHandles(l) {
			if d := math.Hypot(h.x-x, h.y-y); d < distance {
				v := h
				best = &v
				distance = d
			}
		}
		return best
	}
	remove := func(h sectionHandle) bool {
		f, b := a.curveKnots(), a.backCurveKnots()
		k := f
		if h.edit == "back" {
			k = b
		}
		if h.index <= 0 || h.index >= len(k)-1 {
			return false
		}
		k = append(k[:h.index], k[h.index+1:]...)
		if h.edit == "back" {
			b = k
		} else {
			f = k
		}
		a.storeSection(f, b)
		return true
	}
	on(c, "contextmenu", func(e js.Value) { e.Call("preventDefault") })
	on(c, "pointerdown", func(e js.Value) {
		if e.Get("button").Int() != 0 {
			return
		}
		x, y := sectionPoint(c, e)
		l := a.sectionGeometry(c, false)
		if math.Hypot(l.xc-x, l.valueY(0)-y) < 9 {
			leanDrag = true
			a.controlEditing = true
			c.Call("setPointerCapture", e.Get("pointerId"))
			return
		}
		h := hit(l, x, y)
		if h != nil && e.Get("shiftKey").Bool() {
			if remove(*h) && a.selected() != nil {
				a.Checkpoint()
			}
			return
		}
		if h != nil {
			drag = *h
		} else {
			side := "front"
			if x < l.xc {
				side = "back"
			}
			edit := side
			if side == "back" && a.backCurveKnots() == nil {
				edit = "front"
			}
			f, b := a.curveKnots(), a.backCurveKnots()
			k := f
			if edit == "back" {
				k = b
			}
			v := max(0, min(1.5, l.yValue(y)))
			if a.curveKind() == "deep" || a.curveKind() == "shallow" {
				v = max(-.5, min(1.5, l.yValue(y)))
			}
			share := max(.01, min(.99, l.sideShare(side, x)))
			i := len(k) - 1
			for j := 1; j < len(k); j++ {
				if k[j][0] > share {
					i = j
					break
				}
			}
			k = append(k, model.Knot{})
			copy(k[i+1:], k[i:])
			k[i] = model.Knot{share, v}
			if edit == "back" {
				b = k
			} else {
				f = k
			}
			a.storeSection(f, b)
			drag = sectionHandle{side: side, edit: edit, index: i}
		}
		a.controlEditing = true
		c.Call("setPointerCapture", e.Get("pointerId"))
	})
	on(c, "pointermove", func(e js.Value) {
		if !leanDrag && drag.index < 0 {
			return
		}
		x, y := sectionPoint(c, e)
		l := a.sectionGeometry(c, false)
		if leanDrag {
			f := max(.1, min(.9, (x-l.xL)/(l.xR-l.xL)))
			a.setSectionLean(f / (1 - f))
			return
		}
		f, b := a.curveKnots(), a.backCurveKnots()
		k := f
		if drag.edit == "back" {
			k = b
		}
		if drag.index >= len(k) {
			return
		}
		i := drag.index
		if i > 0 && i < len(k)-1 {
			k[i][0] = max(k[i-1][0]+.01, min(k[i+1][0]-.01, l.sideShare(drag.side, x)))
		}
		low := 0.0
		if a.curveKind() == "deep" || a.curveKind() == "shallow" {
			low = -.5
		}
		k[i][1] = max(low, min(1.5, l.yValue(y)))
		if drag.edit == "back" {
			b = k
		} else {
			f = k
		}
		a.storeSection(f, b)
	})
	finish := func(js.Value) {
		if leanDrag || drag.index >= 0 {
			leanDrag = false
			drag.index = -1
			a.controlEditing = false
			a.Schedule()
			if a.selected() != nil {
				a.Checkpoint()
			}
		}
	}
	on(c, "pointerup", finish)
	on(c, "pointercancel", finish)
	on(c, "lostpointercapture", finish)
	on(c, "dblclick", func(e js.Value) {
		x, y := sectionPoint(c, e)
		if h := hit(a.sectionGeometry(c, false), x, y); h != nil && remove(*h) && a.selected() != nil {
			a.Checkpoint()
		}
	})
}
func (a *App) alongEvents() {
	c := element("along-preview")
	drag := -1
	moved := false
	knots := func() []model.Knot { return clone(model.AlongKnots(a.Along)) }
	xy := func(l sectionLayout, k model.Knot) (float64, float64) { return l.xL + (l.xR-l.xL)*k[0], l.valueY(k[1]) }
	hit := func(l sectionLayout, k []model.Knot, x, y float64) int {
		best, d := -1, 8.0
		for i, p := range k {
			px, py := xy(l, p)
			if q := math.Hypot(px-x, py-y); q < d {
				best, d = i, q
			}
		}
		return best
	}
	store := func(k []model.Knot) { a.Along = roundCurveKnots(k); a.commitCurveEdit() }
	on(c, "pointerdown", func(e js.Value) {
		if e.Get("button").Int() != 0 {
			return
		}
		x, y := sectionPoint(c, e)
		l := a.sectionGeometry(c, true)
		k := knots()
		i := hit(l, k, x, y)
		moved = false
		if i >= 0 && e.Get("shiftKey").Bool() {
			if i > 0 && i < len(k)-1 {
				k = append(k[:i], k[i+1:]...)
				store(k)
				if a.selected() != nil {
					a.Checkpoint()
				}
			}
			return
		}
		if i >= 0 {
			drag = i
			a.controlEditing = true
			c.Call("setPointerCapture", e.Get("pointerId"))
			return
		}
		a.landformPlace = max(0, min(1, (x-l.xL)/(l.xR-l.xL)))
		a.drawCurve()
		a.drawOverlay()
	})
	on(c, "pointermove", func(e js.Value) {
		if drag < 0 {
			return
		}
		x, y := sectionPoint(c, e)
		l := a.sectionGeometry(c, true)
		k := knots()
		if drag >= len(k) {
			return
		}
		if drag > 0 && drag < len(k)-1 {
			k[drag][0] = max(k[drag-1][0]+.01, min(k[drag+1][0]-.01, (x-l.xL)/(l.xR-l.xL)))
		}
		k[drag][1] = max(0, min(1.2, l.yValue(y)))
		moved = true
		store(k)
	})
	finish := func(js.Value) {
		if drag >= 0 {
			drag = -1
			a.controlEditing = false
			a.Schedule()
			if moved && a.selected() != nil {
				a.Checkpoint()
			}
		}
	}
	on(c, "pointerup", finish)
	on(c, "pointercancel", finish)
	on(c, "lostpointercapture", finish)
	on(c, "dblclick", func(e js.Value) {
		x, y := sectionPoint(c, e)
		l := a.sectionGeometry(c, true)
		k := knots()
		i := hit(l, k, x, y)
		if i >= 0 {
			if i <= 0 || i >= len(k)-1 {
				return
			}
			k = append(k[:i], k[i+1:]...)
		} else {
			t := max(.01, min(.99, (x-l.xL)/(l.xR-l.xL)))
			i = len(k) - 1
			for j := 1; j < len(k); j++ {
				if k[j][0] > t {
					i = j
					break
				}
			}
			k = append(k, model.Knot{})
			copy(k[i+1:], k[i:])
			k[i] = model.Knot{t, max(0, min(1.2, l.yValue(y)))}
		}
		store(k)
		if a.selected() != nil {
			a.Checkpoint()
		}
	})
}

type landformPath struct {
	points             []model.Point
	cumulative         []float64
	total, front, back float64
	side               int
	wander             float64
}

func (a *App) selectedLandformPath() *landformPath {
	n := a.selected()
	if n == nil || n.Kind != "landform" || len(n.Points) == 0 {
		return nil
	}
	shape := model.ShapePath{Points: n.Points, Paths: n.Paths}
	paths := model.ShapePaths(&shape)
	if len(paths) == 0 || len(paths[0]) == 0 {
		return nil
	}
	points := make([]model.Point, 0, len(paths[0]))
	for _, i := range paths[0] {
		if i < 0 || i >= len(n.Points) {
			return nil
		}
		points = append(points, n.Points[i])
	}
	radius := num(n.Params, "radius", 100)
	points = model.SimplifyPath(points, math.Max(1, radius*.04))
	filtered := points[:0]
	for _, p := range points {
		if len(filtered) == 0 || math.Hypot(p.X-filtered[len(filtered)-1].X, p.Y-filtered[len(filtered)-1].Y) >= 1e-4 {
			filtered = append(filtered, p)
		}
	}
	points = filtered
	if len(points) == 1 {
		points = append(points, model.Point{X: points[0].X + .01, Y: points[0].Y})
	}
	cum := make([]float64, len(points))
	for i := 1; i < len(points); i++ {
		cum[i] = cum[i-1] + math.Hypot(points[i].X-points[i-1].X, points[i].Y-points[i-1].Y)
	}
	lean := num(n.Params, "lean", 0)
	front, back := model.LandformSides(radius, lean)
	turn := 0.0
	if len(n.Frame) == 6 {
		turn = math.Atan2(n.Frame[1], n.Frame[0])
	}
	setup := model.LeanSetup("landform", lean, num(n.Params, "facing", 0), 0)
	side := model.LandformBackSide(setup, turn, points[1].X-points[0].X, points[1].Y-points[0].Y)
	return &landformPath{points, cum, cum[len(cum)-1], front, back, side, num(n.Params, "wander", 0)}
}
func (p *landformPath) at(t float64) (x, y, bx, by float64) {
	d := max(0, min(1, t)) * p.total
	i := 1
	for i < len(p.points)-1 && p.cumulative[i] < d {
		i++
	}
	a, b := p.points[i-1], p.points[i]
	length := p.cumulative[i] - p.cumulative[i-1]
	if length == 0 {
		length = 1
	}
	f := (d - p.cumulative[i-1]) / length
	ux, uy := (b.X-a.X)/length, (b.Y-a.Y)/length
	return a.X + (b.X-a.X)*f, a.Y + (b.Y-a.Y)*f, float64(p.side) * uy, -float64(p.side) * ux
}
func (a *App) landformSectionMark() (model.Point, model.Point, bool) {
	p := a.selectedLandformPath()
	if p == nil {
		return model.Point{}, model.Point{}, false
	}
	x, y, bx, by := p.at(a.landformPlace)
	return model.Point{X: x + bx*p.back, Y: y + by*p.back}, model.Point{X: x - bx*p.front, Y: y - by*p.front}, true
}
func (a *App) drawCurve() {
	c := element("section-preview")
	if !exists(c) {
		return
	}
	kind := a.curveKind()
	visible := contains([]string{"plateau", "offset", "hill", "mountain", "deep", "shallow", "landform"}, kind)
	hidden("section-preview-control", !visible)
	if !visible {
		return
	}
	fitSectionCanvas(c, .5)
	along := element("along-preview")
	fitSectionCanvas(along, .3)
	l := a.sectionGeometry(c, false)
	g := c.Call("getContext", "2d")
	g.Call("clearRect", 0, 0, l.w, l.h)
	g.Set("font", "9px system-ui")
	rule := func(y float64, color, label string) {
		g.Set("strokeStyle", color)
		g.Call("setLineDash", js.ValueOf([]any{3, 3}))
		g.Call("beginPath")
		g.Call("moveTo", l.xL, y)
		g.Call("lineTo", l.xR, y)
		g.Call("stroke")
		g.Call("setLineDash", js.ValueOf([]any{}))
		if label != "" {
			g.Set("fillStyle", color)
			g.Call("fillText", label, l.xL+2, y-2)
		}
	}
	if l.land {
		rule(l.yHeight(l.sea), "#6aa7c4", fmt.Sprintf("sea %g", l.sea))
		rule(l.yHeight(l.plain), "#8b9b87", fmt.Sprintf("plain %g", l.plain))
		rule(l.yHeight(l.elevation), "#e8f2d8", fmt.Sprintf("elevation %g", l.elevation))
	} else {
		rule(l.valueY(0), "#465344", "")
		rule(l.valueY(1), "#465344", "")
	}
	table := model.StrokeCurve(kind, number("softness")/100, number("sec-terraces"), number("sec-ledge")/100, number("sec-terrace-jitter")/100, a.curveSpec(), a.curveShouldered())
	if table == nil {
		return
	}
	back := table.Back
	if back == nil {
		back = table.Front
	}
	trace := func() {
		for i := 0; i <= 160; i++ {
			t := float64(i) / 160
			g.Call("lineTo", l.xL+(l.xc-l.xL)*t, l.valueY(model.ReadTable(back, t)))
		}
		for i := 160; i >= 0; i-- {
			t := float64(i) / 160
			g.Call("lineTo", l.xc+(l.xR-l.xc)*(1-t), l.valueY(model.ReadTable(table.Front, t)))
		}
	}
	g.Call("beginPath")
	g.Call("moveTo", l.xL, l.valueY(0))
	trace()
	g.Call("lineTo", l.xR, l.valueY(0))
	g.Call("closePath")
	color := "rgba(180,213,137,.25)"
	if kind == "deep" || kind == "shallow" {
		color = "rgba(102,170,200,.28)"
	}
	g.Set("fillStyle", color)
	g.Call("fill")
	g.Call("beginPath")
	g.Call("moveTo", l.xL, l.valueY(model.ReadTable(back, 0)))
	trace()
	g.Set("strokeStyle", "#b4d589")
	g.Set("lineWidth", 1.5)
	g.Call("stroke")
	g.Set("lineWidth", 1)
	if p := a.selectedLandformPath(); p != nil && l.land && !a.controlEditing && a.gesture == nil {
		values := a.landformGhostSamples(p)
		line := func(offset int, color string, width float64) {
			g.Call("beginPath")
			for i := 0; i < 33; i++ {
				distance := -p.back + (p.back+p.front)*float64(i)/32
				px := l.xc
				if distance < 0 && p.back > 0 {
					px += distance * (l.xc - l.xL) / p.back
				} else if p.front > 0 {
					px += distance * (l.xR - l.xc) / p.front
				}
				h := values[offset+i]
				method := "lineTo"
				if i == 0 {
					method = "moveTo"
				}
				g.Call(method, px, l.yHeight(h))
			}
			g.Set("strokeStyle", color)
			g.Set("lineWidth", width)
			g.Call("stroke")
		}
		if len(values) == 6*33+49*5 {
			for i := 0; i < 5; i++ {
				line(i*33, "rgba(160,200,255,.38)", 1)
			}
			line(5*33, "#ffd27a", 2)
			g.Set("lineWidth", 1)
		}
	}
	for _, h := range a.sectionHandles(l) {
		g.Set("fillStyle", "#e8f2d8")
		g.Call("beginPath")
		g.Call("arc", h.x, h.y, 3.5, 0, 2*math.Pi)
		g.Call("fill")
	}
	base := l.valueY(0)
	g.Set("fillStyle", "#ffd27a")
	g.Call("beginPath")
	g.Call("moveTo", l.xc, base-5)
	g.Call("lineTo", l.xc+5, base)
	g.Call("lineTo", l.xc, base+5)
	g.Call("lineTo", l.xc-5, base)
	g.Call("closePath")
	g.Call("fill")
	g.Set("strokeStyle", "rgba(255,210,122,.35)")
	g.Call("setLineDash", js.ValueOf([]any{2, 3}))
	g.Call("beginPath")
	g.Call("moveTo", l.xc, l.top)
	g.Call("lineTo", l.xc, l.bottom)
	g.Call("stroke")
	g.Call("setLineDash", js.ValueOf([]any{}))
	g.Set("fillStyle", "#a8b7a5")
	g.Call("fillText", "lean side", l.xL+2, l.h-2)
	g.Call("fillText", "steep side", l.xR-53, l.h-2)
	selectEl := element("curve-form")
	if selectEl.Get("dataset").Get("kind").String() != kind {
		selectEl.Call("replaceChildren")
		option(selectEl, "The shape's own", "")
		choices := [][2]string{{"hill", "Hill"}, {"mountain", "Mountain"}, {"plateau", "Plateau"}, {"mesa", "Mesa"}, {"cliff", "Cliff"}, {"terrace", "Terrace"}}
		if l.land {
			choices = [][2]string{{"lfPlateau", "Plateau"}, {"lfHill", "Hill"}, {"lfMountain", "Mountain"}, {"lfTerraced", "Terraced"}, {"mesa", "Mesa"}, {"cliff", "Cliff"}}
		}
		for _, v := range choices {
			option(selectEl, v[1], v[0])
		}
		selectEl.Get("dataset").Set("kind", kind)
	}
	setValue("curve-form", str(a.Curve, "form", ""))
	disabled("curve-reset", len(readCurveKnots(a.Curve["knots"])) == 0)
	hidden("curve-link", !l.land)
	hidden("curve-mirror", !l.land)
	hidden("along-block", !l.land)
	linked := a.backCurveKnots() == nil
	attribute(element("curve-link"), "aria-pressed", linked)
	if linked {
		text("curve-link", "Sides linked")
	} else {
		text("curve-link", "Link sides")
	}
	disabled("curve-mirror", linked)
	directions := []string{"world default (north)", "left of the line", "right of the line", "north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"}
	facing := int(math.Round(number("facing")))
	if facing < 0 || facing >= len(directions) {
		facing = 0
	}
	text("curve-lean", fmt.Sprintf("Lean %.2f : 1 toward %s", a.sectionLeanRatio(), directions[facing]))
	if l.land {
		a.drawAlong()
	}
}
func (a *App) drawAlong() {
	c := element("along-preview")
	l := a.sectionGeometry(c, true)
	g := c.Call("getContext", "2d")
	g.Call("clearRect", 0, 0, l.w, l.h)
	g.Set("font", "9px system-ui")
	for _, v := range []struct {
		height       float64
		color, label string
	}{{l.sea, "#6aa7c4", "sea"}, {l.plain, "#8b9b87", "plain"}, {l.elevation, "#e8f2d8", "elevation"}} {
		y := l.yHeight(v.height)
		g.Set("strokeStyle", v.color)
		g.Call("setLineDash", js.ValueOf([]any{3, 3}))
		g.Call("beginPath")
		g.Call("moveTo", l.xL, y)
		g.Call("lineTo", l.xR, y)
		g.Call("stroke")
		g.Set("fillStyle", v.color)
		g.Call("fillText", fmt.Sprintf("%s %g", v.label, v.height), l.xL+2, y-2)
	}
	g.Call("setLineDash", js.ValueOf([]any{}))
	if p := a.selectedLandformPath(); p != nil && !a.controlEditing && a.gesture == nil {
		values := a.landformGhostSamples(p)
		dir := 1.0
		if l.elevation < l.plain {
			dir = -1
		}
		if len(values) == 6*33+49*5 {
			g.Call("beginPath")
			for i := 0; i <= 48; i++ {
				t := float64(i) / 48
				h := -1e9
				for j := 0; j < 5; j++ {
					h = math.Max(h, dir*values[6*33+i*5+j])
				}
				method := "lineTo"
				if i == 0 {
					method = "moveTo"
				}
				g.Call(method, l.xL+(l.xR-l.xL)*t, l.yHeight(dir*h))
			}
			g.Set("strokeStyle", "#b4d589")
			g.Set("lineWidth", 1.5)
			g.Call("stroke")
			g.Set("lineWidth", 1)
		}
		x := l.xL + (l.xR-l.xL)*a.landformPlace
		g.Set("strokeStyle", "#ffd27a")
		g.Call("beginPath")
		g.Call("moveTo", x, l.top)
		g.Call("lineTo", x, l.bottom)
		g.Call("stroke")
	}
	knots := model.AlongKnots(a.Along)
	fn := model.KnotCurve(knots)
	g.Call("setLineDash", js.ValueOf([]any{5, 3}))
	g.Call("beginPath")
	for i := 0; i <= 48; i++ {
		t := float64(i) / 48
		method := "lineTo"
		if i == 0 {
			method = "moveTo"
		}
		g.Call(method, l.xL+(l.xR-l.xL)*t, l.valueY(max(0, min(1.2, fn(t)))))
	}
	g.Set("strokeStyle", "#e8f2d8")
	g.Call("stroke")
	g.Call("setLineDash", js.ValueOf([]any{}))
	g.Set("fillStyle", "#e8f2d8")
	for _, k := range knots {
		g.Call("beginPath")
		g.Call("arc", l.xL+(l.xR-l.xL)*k[0], l.valueY(k[1]), 3.5, 0, 2*math.Pi)
		g.Call("fill")
	}
}

// Refresh visible map-sampled ghost lines after a new GPU height tile arrives.
func (a *App) refreshLandformSection() {
	if a.gesture != nil || a.controlEditing || a.selectedLandformPath() == nil {
		return
	}
	control := element("section-preview-control")
	if !exists(control) || control.Get("hidden").Bool() || control.Call("getClientRects").Length() == 0 {
		return
	}
	a.drawCurve()
}
