//go:build js && wasm

package editor

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"syscall/js"
	"time"

	"github.com/nanolathe-gg/terraform/internal/model"
)

var hoverNode = -1
var hoverPoint *model.Point

type gesture struct {
	Kind                                string
	Start, Last                         model.Point
	Pivot, ProjectedPivot, PointerStart model.Point
	Index                               int
	Original                            model.Node
	Nodes                               []model.Node
	Point                               int
	Attachment, SelectionBefore         int
	ScreenX, ScreenY, ScrollX, ScrollY  float64
	Started                             time.Time
}

func (a *App) mountCanvas() {
	a.view = viewState{Scale: 1, Fit: true}
	a.output = create("canvas", "", "")
	a.frame = create("canvas", "", "")
	canvas := element("terrain")
	overlay := element("overlay")
	canvas.Get("style").Set("position", "sticky")
	canvas.Get("style").Set("top", "0")
	canvas.Get("style").Set("left", "0")
	overlay.Get("style").Set("position", "sticky")
	overlay.Get("style").Set("top", "0")
	overlay.Get("style").Set("left", "0")
	overlay.Get("style").Set("marginTop", "-100%")
	click("fit", a.Fit)
	click("one", func() { a.zoom(1) })
	on(element("zoom"), "change", func(js.Value) {
		if value("zoom") == "overview" {
			a.Fit()
		} else {
			v, _ := strconv.ParseFloat(value("zoom"), 64)
			a.zoom(v)
		}
	})
	on(element("viewport"), "scroll", func(js.Value) {
		a.view.X = element("viewport").Get("scrollLeft").Float() / a.view.Scale
		a.view.Y = element("viewport").Get("scrollTop").Float() / a.view.Scale
		a.present()
		a.Schedule()
	})
	on(js.Global(), "resize", func(js.Value) { a.resize() })
	on(overlay, "contextmenu", func(e js.Value) { e.Call("preventDefault") })
	on(overlay, "pointerdown", a.pointerDown)
	on(overlay, "pointermove", a.pointerMove)
	on(overlay, "pointerup", func(e js.Value) { a.pointerUp(e, true) })
	on(overlay, "pointercancel", func(e js.Value) { a.pointerUp(e, false) })
	on(overlay, "lostpointercapture", func(e js.Value) { a.pointerUp(e, false) })
	on(overlay, "pointerleave", func(js.Value) { hoverNode = -1; hoverPoint = nil; a.drawOverlay() })
	on(overlay, "wheel", func(e js.Value) {
		if e.Get("ctrlKey").Bool() || e.Get("metaKey").Bool() {
			e.Call("preventDefault")
			a.zoom(max(.1, min(4, a.view.Scale*math.Exp(-e.Get("deltaY").Float()*.002))))
		}
	})
	on(document, "keydown", func(e js.Value) {
		tag := e.Get("target").Get("tagName").String()
		if tag == "INPUT" || tag == "TEXTAREA" || tag == "SELECT" {
			return
		}
		key := e.Get("key").String()
		if a.featureUI != nil && a.featureUI.HandleKey(key) {
			e.Call("preventDefault")
			return
		}
		if a.Busy {
			return
		}
		ctrl := e.Get("ctrlKey").Bool() || e.Get("metaKey").Bool()
		if ctrl && (key == "z" || key == "Z") {
			e.Call("preventDefault")
			d := -1
			if e.Get("shiftKey").Bool() {
				d = 1
			}
			a.Undo(d)
			return
		}
		switch key {
		case " ":
			a.space = true
			e.Call("preventDefault")
		case "Escape":
			if a.gesture != nil {
				a.pointerUp(e, false)
			} else if a.focused {
				a.focused = false
				a.layout()
			} else {
				a.Select(-1)
			}
		case "v", "V":
			a.Tool = "move"
			a.PathMode = false
			a.Update()
		case "p", "P":
			a.Tool = "move"
			a.PathMode = !a.PathMode
			a.Update()
		case "f", "F":
			if e.Get("shiftKey").Bool() {
				a.focused = !a.focused
				a.layout()
			}
		case "Delete", "Backspace":
			e.Call("preventDefault")
			if a.PathMode && a.PathPoint >= 0 {
				a.editPath("delete")
			} else {
				a.nodeAction("delete")
			}
		case "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown":
			if n := a.selected(); n != nil {
				e.Call("preventDefault")
				step := 1.0
				if e.Get("shiftKey").Bool() {
					step = 10
				}
				dx, dy := 0.0, 0.0
				switch key {
				case "ArrowLeft":
					dx = -step
				case "ArrowRight":
					dx = step
				case "ArrowUp":
					dy = -step
				case "ArrowDown":
					dy = step
				}
				transformNode(n, [6]float64{1, 0, 0, 1, dx, dy})
				a.Checkpoint()
				a.Schedule()
			}
		}
		a.drawOverlay()
	})
	on(document, "keyup", func(e js.Value) {
		if e.Get("key").String() == " " {
			a.space = false
		}
	})
	nav := create("canvas", "", "")
	nav.Set("width", 200)
	nav.Set("height", 200)
	attribute(nav, "aria-label", "Minimap: drag to pan, or use arrow keys")
	nav.Set("tabIndex", 0)
	nav.Set("id", "navigator")
	element("minimap-host").Call("append", nav)
	drag := false
	navMove := func(e js.Value) {
		if a.view.Fit {
			a.zoom(1)
		}
		r := nav.Call("getBoundingClientRect")
		x := (e.Get("clientX").Float() - r.Get("left").Float()) / r.Get("width").Float() * a.Width()
		y := (e.Get("clientY").Float() - r.Get("top").Float()) / r.Get("height").Float() * a.Height()
		element("viewport").Set("scrollLeft", x*a.view.Scale-float64(a.view.Width)/2)
		element("viewport").Set("scrollTop", y*a.view.Scale-float64(a.view.Height)/2)
	}
	on(nav, "pointerdown", func(e js.Value) { drag = true; nav.Call("setPointerCapture", e.Get("pointerId")); navMove(e) })
	on(nav, "pointermove", func(e js.Value) {
		if drag {
			navMove(e)
		}
	})
	on(nav, "pointerup", func(js.Value) { drag = false })
	on(nav, "pointercancel", func(js.Value) { drag = false })
	on(nav, "keydown", func(e js.Value) {
		if a.Busy || a.gesture != nil {
			return
		}
		dx, dy := 0.0, 0.0
		switch e.Get("key").String() {
		case "ArrowLeft":
			dx = -1
		case "ArrowRight":
			dx = 1
		case "ArrowUp":
			dy = -1
		case "ArrowDown":
			dy = 1
		default:
			return
		}
		e.Call("preventDefault")
		e.Call("stopPropagation")
		if a.view.Fit {
			a.zoom(1)
		}
		v := element("viewport")
		v.Set("scrollLeft", v.Get("scrollLeft").Float()+dx*float64(a.view.Width)*.2)
		v.Set("scrollTop", v.Get("scrollTop").Float()+dy*float64(a.view.Height)*.2)
	})
}
func (a *App) Fit() {
	r := element("viewport").Call("getBoundingClientRect")
	a.view.Scale = min(r.Get("width").Float()/a.Width(), r.Get("height").Float()/a.Height())
	if a.view.Scale <= 0 {
		a.view.Scale = .25
	}
	a.view.Fit = true
	a.view.X = 0
	a.view.Y = 0
	element("viewport").Set("scrollLeft", 0)
	element("viewport").Set("scrollTop", 0)
	setValue("zoom", "overview")
	a.resize()
}
func (a *App) zoom(scale float64) {
	if scale <= 0 {
		return
	}
	cx := a.view.X + float64(a.view.Width)/a.view.Scale/2
	cy := a.view.Y + float64(a.view.Height)/a.view.Scale/2
	a.view.Scale = scale
	a.view.Fit = false
	setValue("zoom", scale)
	a.resize()
	element("viewport").Set("scrollLeft", cx*scale-float64(a.view.Width)/2)
	element("viewport").Set("scrollTop", cy*scale-float64(a.view.Height)/2)
	a.Schedule()
}
func (a *App) resize() {
	v := element("viewport")
	w, h := v.Get("clientWidth").Int(), v.Get("clientHeight").Int()
	if w < 1 || h < 1 {
		return
	}
	if a.view.Fit {
		a.view.Scale = min(float64(w)/a.Width(), float64(h)/a.Height())
	}
	a.view.Width, a.view.Height = w, h
	stage := element("stage")
	stage.Get("style").Set("width", fmt.Sprintf("%gpx", max(float64(w), a.Width()*a.view.Scale)))
	stage.Get("style").Set("height", fmt.Sprintf("%gpx", max(float64(h), a.Height()*a.view.Scale)))
	for _, id := range []string{"terrain", "overlay"} {
		c := element(id)
		c.Set("width", w)
		c.Set("height", h)
		c.Get("style").Set("width", fmt.Sprint(w)+"px")
		c.Get("style").Set("height", fmt.Sprint(h)+"px")
	}
	element("overlay").Get("style").Set("marginTop", fmt.Sprintf("-%dpx", h))
	a.frame.Set("width", w)
	a.frame.Set("height", h)
	a.present()
	a.Schedule()
}
func (a *App) project(p model.Point) model.Point {
	return model.Point{X: (p.X - a.view.X) * a.view.Scale, Y: (p.Y - (max(num(a.Config, "seaLevel", 0), a.Sample(p.X, p.Y))-num(a.Config, "baseHeight", 0))/2 - a.view.Y) * a.view.Scale}
}
func (a *App) pointerPoint(e js.Value) model.Point {
	r := element("overlay").Call("getBoundingClientRect")
	x := (e.Get("clientX").Float()-r.Get("left").Float())/a.view.Scale + a.view.X
	screenY := (e.Get("clientY").Float()-r.Get("top").Float())/a.view.Scale + a.view.Y
	y := screenY
	for i := 0; i < 8; i++ {
		y = screenY + (max(num(a.Config, "seaLevel", 0), a.Sample(x, y))-num(a.Config, "baseHeight", 0))/2
	}
	return model.Point{X: max(0, min(a.Width()-1, x)), Y: max(0, min(a.Height()-1, y))}
}
func (a *App) pointerDown(e js.Value) {
	if a.Busy || a.gesture != nil {
		return
	}
	e.Call("preventDefault")
	overlay := element("overlay")
	overlay.Call("focus")
	overlay.Call("setPointerCapture", e.Get("pointerId"))
	p := a.pointerPoint(e)
	if a.space || e.Get("button").Int() == 1 || e.Get("button").Int() == 2 {
		v := element("viewport")
		a.gesture = &gesture{Kind: "pan", ScreenX: e.Get("clientX").Float(), ScreenY: e.Get("clientY").Float(), ScrollX: v.Get("scrollLeft").Float(), ScrollY: v.Get("scrollTop").Float()}
		return
	}
	if a.featureUI != nil && a.featureUI.PointerDown(p, e) {
		return
	}
	if a.Tool == "move" && (!a.AddPath || a.PathMode) {
		screen := a.screenPoint(e)
		if geometry := a.selectionGeometry(); geometry != nil {
			if hit := model.HitSelection(geometry, screen, a.PathMode); hit != nil {
				n := clone(a.Nodes[a.Selected])
				a.gesture = &gesture{Kind: hit.Action, Start: p, Last: p, Index: a.Selected, Original: n, Point: hit.Index, Pivot: geometry.Pivot, ProjectedPivot: geometry.Centre, PointerStart: screen, Started: time.Now(), ScreenX: e.Get("clientX").Float(), ScreenY: e.Get("clientY").Float()}
				if hit.Action == "move" && e.Get("shiftKey").Bool() {
					a.gesture.Kind = "amount"
				}
				if hit.Action == "point" {
					a.PathPoint = hit.Index
				}
				a.Update()
				a.drawOverlay()
				return
			}
		}
		index := a.pick(p)

		if index < 0 {
			a.Select(-1)
			return
		}
		if a.Selected != index {
			a.Select(index)
		}
		n := a.Nodes[index]
		if a.PathMode && !a.AddPath {
			return
		}
		kind := "move"
		if e.Get("shiftKey").Bool() {
			kind = "amount"
		}
		a.gesture = &gesture{Kind: kind, Start: p, Last: p, Index: index, Original: clone(n), Started: time.Now(), Point: -1, PointerStart: screen, ScreenX: e.Get("clientX").Float(), ScreenY: e.Get("clientY").Float()}
		if a.PathMode {
			best := 12 / a.view.Scale
			for i, q := range n.Points {
				if d := math.Hypot(q.X-p.X, q.Y-p.Y); d < best {
					best = d
					a.PathPoint = i
					a.gesture.Point = i
				}
			}
			if a.gesture.Point < 0 && a.AddPath {
				path := model.ShapePath{Points: n.Points, Paths: n.Paths}
				i, k := model.ExtendPoint(&path, a.PathPoint, p, a.PathIndex)
				a.Nodes[index].Points, a.Nodes[index].Paths = path.Points, path.Paths
				a.PathPoint, a.PathIndex = i, k
				a.gesture.Point = i
			}
			a.gesture.Kind = "point"
		}
		return
	}
	n := model.Node{Kind: a.Tool, Seed: uint32(number("seed")), Points: []model.Point{p}, Params: a.params()}
	g := &gesture{Kind: "stroke", Start: p, Last: p, Index: len(a.Nodes), Nodes: clone(a.Nodes), Started: time.Now(), Attachment: -1, SelectionBefore: a.Selected, ScreenX: e.Get("clientX").Float(), ScreenY: e.Get("clientY").Float()}
	if a.AddPath && a.selected() != nil {
		g.Index = a.Selected
		g.Original = clone(a.Nodes[g.Index])
		n = clone(g.Original)
		path := model.ShapePath{Points: n.Points, Paths: n.Paths}
		if hit := model.HitSelection(a.selectionGeometry(), a.screenPoint(e), true); hit != nil && hit.Action == "point" {
			g.Attachment = hit.Index
			p = n.Points[hit.Index]
			g.Start, g.Last = p, p
		}
		points := []model.Point{p}
		if g.Attachment >= 0 {
			points = nil
		}
		a.PathIndex = model.AppendPath(&path, points, g.Attachment)
		n.Points, n.Paths = path.Points, path.Paths
		a.Nodes[g.Index] = n
	} else {
		a.Nodes = append(a.Nodes, n)
	}
	a.gesture = g
	a.Selected = g.Index
	a.Change()
	a.Update()
}
func (a *App) pointerMove(e js.Value) {
	p := a.pointerPoint(e)
	hoverPoint = &p
	if a.featureUI != nil && a.featureUI.PointerMove(p, e) {
		a.drawOverlay()
		return
	}
	g := a.gesture
	if g == nil {
		hoverNode = -1
		if a.Tool == "move" && !a.AddPath && (a.featureUI == nil || !a.featureUI.Active) {
			hoverNode = a.pick(p)
		}
		a.drawOverlay()
		return
	}
	if g.Kind != "pan" {
		g.ScreenX, g.ScreenY = e.Get("clientX").Float(), e.Get("clientY").Float()
	}
	switch g.Kind {
	case "pan":
		v := element("viewport")
		v.Set("scrollLeft", g.ScrollX-(e.Get("clientX").Float()-g.ScreenX))
		v.Set("scrollTop", g.ScrollY-(e.Get("clientY").Float()-g.ScreenY))
		return
	case "stroke":
		threshold := 2.0
		if e.Get("type").String() == "pointerup" {
			threshold = 0
		}
		if math.Hypot(p.X-g.Last.X, p.Y-g.Last.Y) <= threshold {
			return
		}
		n := &a.Nodes[g.Index]
		n.Points = append(n.Points, p)
		if len(n.Paths) > 0 {
			n.Paths[a.PathIndex] = append(n.Paths[a.PathIndex], len(n.Points)-1)
		}
		g.Last = p
	case "move", "amount":
		n := clone(g.Original)
		q := a.screenPoint(e)
		if g.Kind == "amount" {
			n.Params["amount"] = num(g.Original.Params, "amount", 70) + (g.PointerStart.Y-q.Y)*1.5
		} else {
			transformNode(&n, [6]float64{1, 0, 0, 1, q.X - g.PointerStart.X, q.Y - g.PointerStart.Y})
		}
		a.Nodes[g.Index] = n
	case "rotate", "scale":
		q := a.screenPoint(e)
		pivot := g.Pivot
		u, v := g.PointerStart, g.ProjectedPivot
		n := clone(g.Original)
		angle, k := 0., 1.
		if g.Kind == "rotate" {
			angle = math.Atan2(q.Y-v.Y, q.X-v.X) - math.Atan2(u.Y-v.Y, u.X-v.X)
			if e.Get("shiftKey").Bool() {
				angle = math.Round(angle/(math.Pi/12)) * (math.Pi / 12)
			}
		} else {
			k = math.Hypot(q.X-v.X, q.Y-v.Y) / math.Max(1, math.Hypot(u.X-v.X, u.Y-v.Y))
			k = max(.2, min(4, k))
			if e.Get("shiftKey").Bool() {
				k = max(.1, math.Round(k*10)/10)
			}
		}
		ca, sa := math.Cos(angle)*k, math.Sin(angle)*k
		transformNode(&n, [6]float64{ca, sa, -sa, ca, pivot.X - ca*pivot.X + sa*pivot.Y, pivot.Y - sa*pivot.X - ca*pivot.Y})
		a.Nodes[g.Index] = n
	case "point":
		if g.Point >= 0 && g.Point < len(a.Nodes[g.Index].Points) {
			q := a.screenPoint(e)
			dx, dy := q.X-g.PointerStart.X, q.Y-g.PointerStart.Y
			if e.Get("shiftKey").Bool() {
				if math.Abs(dx) > math.Abs(dy) {
					dy = 0
				} else {
					dx = 0
				}
			}
			base := g.Start
			if g.Point < len(g.Original.Points) {
				base = g.Original.Points[g.Point]
			}
			a.Nodes[g.Index].Points[g.Point] = model.Point{X: base.X + dx, Y: base.Y + dy}
		}
	}
	a.Change()
	a.drawOverlay()
}
func (a *App) pointerUp(e js.Value, commit bool) {
	if a.featureUI != nil && exists(e.Get("clientX")) && exists(e.Get("clientY")) && a.featureUI.PointerUp(a.pointerPoint(e), e) {
		a.drawOverlay()
		return
	}
	g := a.gesture
	if g == nil {
		return
	}
	if commit && g.Kind != "pan" && exists(e.Get("clientX")) && (e.Get("clientX").Float() != g.ScreenX || e.Get("clientY").Float() != g.ScreenY) {
		a.pointerMove(e)
	}
	a.gesture = nil
	if g.Kind == "pan" {
		a.Schedule()
		return
	}
	if !commit {
		if g.Kind == "stroke" {
			a.Nodes = g.Nodes
			a.Selected = g.SelectionBefore
		} else {
			a.Nodes[g.Index] = g.Original
		}
	} else {
		if g.Kind == "stroke" && g.Attachment >= 0 && len(a.Nodes[g.Index].Paths[a.PathIndex]) == 1 {
			a.Nodes = g.Nodes
			a.Selected = g.SelectionBefore
			a.Change()
			a.Update()
			a.drawOverlay()
			return
		}
		if g.Kind == "stroke" && checked("simplify-strokes") {
			n := &a.Nodes[g.Index]
			if len(n.Paths) == 0 {
				n.Points = model.SimplifyPath(n.Points, 3)
			} else {
				path := n.Paths[a.PathIndex]
				points := make([]model.Point, 0, len(path))
				for _, i := range path {
					points = append(points, n.Points[i])
				}
				reduced := model.SimplifyPath(points, 3)
				if len(reduced) < len(points) {
					base := clone(g.Original)
					shape := model.ShapePath{Points: base.Points, Paths: base.Paths}
					if g.Attachment >= 0 {
						reduced = reduced[1:]
					}
					a.PathIndex = model.AppendPath(&shape, reduced, g.Attachment)
					base.Points, base.Paths = shape.Points, shape.Paths
					*n = base
				}
			}
		}
		if g.Kind == "stroke" && g.Index == len(g.Nodes) && checked("seed-vary") {
			a.Seed = randomSeed()
			setValue("seed", a.Seed)
		}
		a.Checkpoint()
		a.strokeTimes = append(a.strokeTimes, float64(time.Since(g.Started).Milliseconds()))
	}
	a.Change()
	a.drawOverlay()
}
func (a *App) pick(p model.Point) int {
	best, score := -1, math.Inf(1)
	for i, n := range a.Nodes {
		if n.Hidden || len(n.Points) == 0 {
			continue
		}
		radius := max(24, num(n.Params, "radius", 40))
		distance := math.Inf(1)
		shape := model.ShapePath{Points: n.Points, Paths: n.Paths}
		for _, path := range model.ShapePaths(&shape) {
			for j, index := range path {
				q := n.Points[index]
				d := math.Hypot(p.X-q.X, p.Y-q.Y)
				if j > 0 {
					r := n.Points[path[j-1]]
					dx, dy := q.X-r.X, q.Y-r.Y
					t := 0.
					if dd := dx*dx + dy*dy; dd > 0 {
						t = max(0, min(1, ((p.X-r.X)*dx+(p.Y-r.Y)*dy)/dd))
					}
					d = min(d, math.Hypot(p.X-r.X-t*dx, p.Y-r.Y-t*dy))
				}
				distance = min(distance, d)
			}
		}
		if distance < radius && distance/radius <= score {
			best = i
			score = distance / radius
		}
	}
	return best
}
func (a *App) present() {
	a.paintTiles()
}
func (a *App) drawOverlay() {
	c := element("overlay")
	if !exists(c) || a.view.Scale <= 0 {
		return
	}
	g := c.Call("getContext", "2d")
	g.Call("clearRect", 0, 0, c.Get("width"), c.Get("height"))
	g.Set("strokeStyle", "#ffe69c")
	g.Set("lineWidth", 1)
	g.Call("setLineDash", js.ValueOf([]any{8, 6}))
	g.Call("strokeRect", -a.view.X*a.view.Scale, (num(a.Config, "baseHeight", 0)/2-a.view.Y)*a.view.Scale, num(a.Map(), "playRight", a.Width())*a.view.Scale, num(a.Map(), "playBottom", a.Height())*a.view.Scale)
	g.Call("setLineDash", js.ValueOf([]any{}))
	if hoverNode >= 0 && hoverNode < len(a.Nodes) && hoverNode != a.Selected && a.gesture == nil && (a.featureUI == nil || !a.featureUI.Active) {
		if h := a.geometryFor(hoverNode); h != nil && h.Visible {
			g.Call("save")
			g.Call("scale", h.Scale, h.Scale)
			g.Call("translate", -a.view.X, -a.view.Y)
			g.Set("strokeStyle", "#b8eef3")
			g.Set("lineWidth", 1/h.Scale)
			g.Call("setLineDash", js.ValueOf([]any{5 / h.Scale, 4 / h.Scale}))
			g.Call("strokeRect", h.Bounds.X0, h.Bounds.Y0, h.Bounds.X1-h.Bounds.X0, h.Bounds.Y1-h.Bounds.Y0)
			g.Call("restore")
		}
	}
	if selection := a.selectionGeometry(); selection != nil && selection.Visible {
		a.drawSelection(g, selection)
	}
	if hoverPoint != nil && a.gesture == nil && (a.Tool != "move" || a.AddPath) && (a.featureUI == nil || !a.featureUI.Active) {
		p := a.project(*hoverPoint)
		g.Call("save")
		g.Set("strokeStyle", "#b8eef3")
		g.Set("lineWidth", 1)
		g.Call("beginPath")
		g.Call("arc", p.X, p.Y, number("diameter")*a.view.Scale/2, 0, 2*math.Pi)
		g.Call("stroke")
		g.Call("restore")
	}

	if a.featureUI != nil {
		a.featureUI.Draw(g, a.project)
	}
}
func (a *App) mountFiles() {
	click("save", func() {
		if a.gesture != nil || a.Busy {
			return
		}
		b, _ := json.MarshalIndent(a.Sketch(), "", "  ")
		download(b, "application/json", "terraform-"+a.World()+".json")
	})
	click("load", func() {
		if a.gesture == nil && !a.Busy {
			element("file").Call("click")
		}
	})
	on(element("file"), "change", func(e js.Value) {
		go func() {
			target := e.Get("target")
			f := target.Get("files")
			if f.Length() == 0 || a.gesture != nil || a.Busy {
				target.Set("value", "")
				return
			}
			file := f.Index(0)
			target.Set("value", "")
			if file.Get("size").Float() > 64*1024*1024 {
				showError(fmt.Errorf("This sculpt sketch is too large to load."))
				return
			}
			a.Busy = true
			for _, id := range []string{"editor", "world-editor", "map-controls"} {
				disabled(id, true)
			}
			defer func() {
				a.Busy = false
				for _, id := range []string{"editor", "world-editor", "map-controls"} {
					disabled(id, false)
				}
				a.Update()
				a.Schedule()
			}()
			s, err := await(file.Call("text"))
			if err == nil {
				var loaded bool
				loaded, err = a.loadSketchFile([]byte(s.String()), "")
				if err == nil && !loaded {
					return
				}
			}
			if err != nil {
				showError(err)
			} else {
				a.Checkpoint()
				a.Schedule()
			}
		}()
	})
	click("export", func() {
		go func() {
			ch := make(chan js.Value, 1)
			cb := js.FuncOf(func(_ js.Value, args []js.Value) any {
				if len(args) > 0 {
					ch <- args[0]
				} else {
					ch <- js.Null()
				}
				return nil
			})
			element("terrain").Call("toBlob", cb, "image/png")
			blob := <-ch
			cb.Release()
			var e error
			if !exists(blob) {
				e = fmt.Errorf("Could not encode the viewport image.")
			}
			if e != nil {
				showError(e)
				return
			}
			b, e := await(blob.Call("arrayBuffer"))
			if e != nil {
				showError(e)
				return
			}
			bytes := make([]byte, b.Get("byteLength").Int())
			js.CopyBytesToGo(bytes, js.Global().Get("Uint8Array").New(b))
			download(bytes, "image/png", "terraform-view.png")
		}()
	})
	host := element("document-controls")
	host.Set("innerHTML", `<label>Server document<input id="document-name" aria-label="Server document name" value="map"></label><div class="row"><button id="document-save">Save to server</button><button id="document-load">Reload</button></div><p class="small" id="document-state"></p>`)
	click("document-save", func() {
		if a.Busy || a.gesture != nil {
			return
		}
		go func() {
			id := value("document-name")
			var out map[string]any
			err := request("/map-document?id="+urlQuery(id), "PUT", a.Sketch(), &out)
			if err != nil {
				showError(err)
			} else {
				text("document-state", "Document saved.")
			}
		}()
	})
	click("document-load", func() {
		if a.Busy || a.gesture != nil {
			return
		}
		a.Busy = true
		for _, id := range []string{"editor", "world-editor", "map-controls"} {
			disabled(id, true)
		}
		go func() {
			defer func() {
				a.Busy = false
				for _, id := range []string{"editor", "world-editor", "map-controls"} {
					disabled(id, false)
				}
				a.Update()
				a.Schedule()
			}()
			var out map[string]any
			err := request("/map-document?id="+urlQuery(value("document-name")), "GET", nil, &out)
			if err == nil {
				b, _ := json.Marshal(out["document"])
				var loaded bool
				loaded, err = a.loadSketchFile(b, value("document-name"))
				if err == nil && !loaded {
					return
				}
			}
			if err != nil {
				showError(err)
			} else {
				a.Checkpoint()
				text("document-state", "Document reloaded.")
			}
		}()
	})
}
func urlQuery(s string) string { return js.Global().Call("encodeURIComponent", s).String() }

func (a *App) screenPoint(e js.Value) model.Point {
	r := element("overlay").Call("getBoundingClientRect")
	return model.Point{X: (e.Get("clientX").Float()-r.Get("left").Float())/a.view.Scale + a.view.X, Y: (e.Get("clientY").Float()-r.Get("top").Float())/a.view.Scale + a.view.Y}
}
func (a *App) selectionGeometry() *model.SelectionGeometryResult { return a.geometryFor(a.Selected) }
func (a *App) geometryFor(index int) *model.SelectionGeometryResult {
	if index < 0 || index >= len(a.Nodes) {
		return nil
	}
	n := &a.Nodes[index]
	project := func(p model.Point) model.Point {
		q := a.project(p)
		return model.Point{X: q.X/a.view.Scale + a.view.X, Y: q.Y/a.view.Scale + a.view.Y}
	}
	return model.SelectionGeometry(*n, project, model.SelectionView{X: a.view.X, Y: a.view.Y, Width: float64(a.view.Width) / a.view.Scale, Height: float64(a.view.Height) / a.view.Scale, Scale: a.view.Scale})
}
func (a *App) drawSelection(ctx js.Value, g *model.SelectionGeometryResult) {
	s, b := g.Scale, g.Bounds
	color := "#ffe0a0"
	if a.PathMode {
		color = "#d2b1ff"
	}
	ctx.Call("save")
	defer ctx.Call("restore")
	ctx.Call("scale", s, s)
	ctx.Call("translate", -a.view.X, -a.view.Y)
	ctx.Set("strokeStyle", color)
	ctx.Set("lineWidth", 1/s)
	ctx.Call("setLineDash", js.ValueOf([]any{5 / s, 4 / s}))
	ctx.Call("strokeRect", b.X0, b.Y0, b.X1-b.X0, b.Y1-b.Y0)
	ctx.Call("setLineDash", js.ValueOf([]any{}))
	for i, path := range g.Paths {
		ctx.Call("beginPath")
		for j, index := range path {
			p := g.Points[index]
			if j == 0 {
				ctx.Call("moveTo", p.X, p.Y)
			} else {
				ctx.Call("lineTo", p.X, p.Y)
			}
		}
		opacity := 1.
		if a.PathMode && a.PathIndex >= 0 && i != a.PathIndex {
			opacity = .45
		}
		ctx.Set("globalAlpha", opacity)
		ctx.Set("lineWidth", 2/s)
		ctx.Call("stroke")
	}
	ctx.Set("globalAlpha", 1)
	if a.PathMode {
		for i, p := range g.Points {
			r := 4.5 / s
			fill := "#18252b"
			if i == a.PathPoint {
				r = 6 / s
				fill = color
			}
			ctx.Set("fillStyle", fill)
			ctx.Call("beginPath")
			ctx.Call("arc", p.X, p.Y, r, 0, 2*math.Pi)
			ctx.Call("fill")
			ctx.Call("stroke")
		}
		return
	}
	ctx.Set("lineWidth", 1.5/s)
	ctx.Call("beginPath")
	ctx.Call("moveTo", g.Centre.X, b.Y0)
	ctx.Call("lineTo", g.Rotate.X, g.Rotate.Y)
	ctx.Call("stroke")
	for _, h := range []struct {
		label string
		p     model.Point
	}{{"Move", g.Move}, {"Rotate", g.Rotate}, {"Scale", g.Resize}} {
		p := h.p
		ctx.Set("fillStyle", "#17262bed")
		ctx.Call("beginPath")
		if h.label == "Scale" {
			ctx.Call("rect", p.X-6/s, p.Y-6/s, 12/s, 12/s)
		} else {
			ctx.Call("arc", p.X, p.Y, 7/s, 0, 2*math.Pi)
		}
		ctx.Call("fill")
		ctx.Call("stroke")
		if h.label == "Move" {
			ctx.Call("beginPath")
			ctx.Call("moveTo", p.X-4/s, p.Y)
			ctx.Call("lineTo", p.X+4/s, p.Y)
			ctx.Call("moveTo", p.X, p.Y-4/s)
			ctx.Call("lineTo", p.X, p.Y+4/s)
			ctx.Call("stroke")
		}
		ctx.Set("font", fmt.Sprintf("%gpx system-ui", 11/s))
		ctx.Set("textAlign", "left")
		ctx.Set("textBaseline", "middle")
		w := ctx.Call("measureText", h.label).Get("width").Float() + 12/s
		x := max(g.View.X+3/s, min(g.View.X+g.View.Width-w-3/s, p.X+12/s))
		y := max(g.View.Y+12/s, min(g.View.Y+g.View.Height-12/s, p.Y))
		ctx.Set("fillStyle", "#142128ed")
		ctx.Call("fillRect", x, y-10/s, w, 20/s)
		ctx.Set("fillStyle", color)
		ctx.Call("fillText", h.label, x+6/s, y)
	}
}
