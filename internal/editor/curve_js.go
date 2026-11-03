//go:build js && wasm

package editor

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"syscall/js"

	"github.com/nanolathe-gg/terraform/internal/model"
)

func (a *App) mountCurve() {
	row := create("div", "control", "")
	row.Set("id", "section-preview-control")
	row.Set("innerHTML", `<label for="curve-form">Curve</label><select id="curve-form"><option value="">The shape's own</option><option value="mesa">Mesa</option><option value="hill">Hill</option><option value="mountain">Mountain</option><option value="cliff">Cliff</option><option value="plateau">Plateau</option><option value="terrace">Terrace</option></select><canvas id="section-preview" width="222" height="120" style="width:100%;background:#172119;touch-action:none;cursor:crosshair"></canvas><canvas id="section-across" width="222" height="44" style="width:100%;background:#172119"></canvas><button id="curve-reset">Reset to the form</button><p class="small">Drag a knot; click the line to add one; Shift-click or double-click a knot to remove it.</p>`)
	element("shape-options").Call("prepend", row)
	on(element("curve-form"), "change", func(js.Value) {
		a.Curve = map[string]any{"form": value("curve-form")}
		a.controlEdit()
		if a.selected() != nil {
			a.Checkpoint()
		}
	})
	click("curve-reset", func() {
		a.Curve = map[string]any{"form": str(a.Curve, "form", "")}
		a.controlEdit()
		if a.selected() != nil {
			a.Checkpoint()
		}
	})
	canvas := element("section-preview")
	drag := -1
	point := func(e js.Value) model.Knot {
		r := canvas.Call("getBoundingClientRect")
		x := (e.Get("clientX").Float() - r.Get("left").Float()) / r.Get("width").Float() * 222
		y := (e.Get("clientY").Float() - r.Get("top").Float()) / r.Get("height").Float() * 120
		return model.Knot{max(0, min(1, (x-9)/204)), max(-.6, min(1.6, 1.6-(y-9)/102*2.2))}
	}
	set := func(knots []model.Knot) {
		if a.Curve == nil {
			a.Curve = map[string]any{}
		}
		a.Curve["knots"] = knots
		if n := a.selected(); n != nil {
			n.Params["curve"] = clone(a.Curve)
			a.Change()
		} else {
			a.rememberTool()
			a.drawCurve()
		}
	}
	on(canvas, "pointerdown", func(e js.Value) {
		e.Call("preventDefault")
		p := point(e)
		knots := a.curveKnots()
		best, d := -1, .07
		for i, k := range knots {
			if dd := math.Hypot(k[0]-p[0], (k[1]-p[1])/.8); dd < d {
				best, d = i, dd
			}
		}
		if e.Get("shiftKey").Bool() {
			if best > 0 && best < len(knots)-1 {
				knots = append(knots[:best], knots[best+1:]...)
				set(knots)
				a.Checkpoint()
			}
			return
		}
		if best < 0 {
			best = len(knots) - 1
			for i := 1; i < len(knots); i++ {
				if knots[i][0] > p[0] {
					best = i
					break
				}
			}
			knots = append(knots, model.Knot{})
			copy(knots[best+1:], knots[best:])
			knots[best] = p
			set(knots)
		}
		drag = best
		canvas.Call("setPointerCapture", e.Get("pointerId"))
	})
	on(canvas, "pointermove", func(e js.Value) {
		if drag < 0 {
			return
		}
		knots := a.curveKnots()
		if drag >= len(knots) {
			return
		}
		p := point(e)
		if drag == 0 {
			p[0] = 0
		} else if drag == len(knots)-1 {
			p[0] = 1
		} else {
			p[0] = max(knots[drag-1][0]+.001, min(knots[drag+1][0]-.001, p[0]))
		}
		knots[drag] = p
		set(knots)
	})
	finish := func(js.Value) {
		if drag >= 0 {
			drag = -1
			a.Checkpoint()
		}
	}
	on(canvas, "pointerup", finish)
	on(canvas, "pointercancel", finish)
	on(canvas, "dblclick", func(e js.Value) {
		p := point(e)
		k := a.curveKnots()
		for i := 1; i < len(k)-1; i++ {
			if math.Abs(k[i][0]-p[0]) < .04 {
				k = append(k[:i], k[i+1:]...)
				set(k)
				a.Checkpoint()
				break
			}
		}
	})
}
func (a *App) curveKnots() []model.Knot {
	kind := a.Tool
	if n := a.selected(); n != nil {
		kind = n.Kind
	}
	var spec model.CurveSpec
	b, _ := json.Marshal(a.Curve)
	_ = json.Unmarshal(b, &spec)
	k, _ := model.StrokeKnots(kind, number("softness")/100, &spec, kind == "hill")
	return k
}
func (a *App) drawCurve() {
	c := element("section-preview")
	if !exists(c) {
		return
	}
	kind := a.Tool
	if n := a.selected(); n != nil {
		kind = n.Kind
	}
	visible := contains([]string{"plateau", "offset", "hill", "mountain", "deep", "shallow", "erase", "paint", "sand", "grass"}, kind)
	hidden("section-preview-control", !visible)
	if !visible {
		return
	}
	setValue("curve-form", str(a.Curve, "form", ""))
	g := c.Call("getContext", "2d")
	g.Call("clearRect", 0, 0, 222, 120)
	g.Set("strokeStyle", "#465344")
	g.Call("strokeRect", 9, 9, 204, 102)
	knots := a.curveKnots()
	curve := model.KnotCurve(knots)
	g.Set("strokeStyle", "#b8d88d")
	g.Set("lineWidth", 2)
	g.Call("beginPath")
	for i := 0; i <= 204; i++ {
		x := float64(i) / 204
		y := 9 + (1.6-curve(x))/2.2*102
		if i == 0 {
			g.Call("moveTo", 9+float64(i), y)
		} else {
			g.Call("lineTo", 9+float64(i), y)
		}
	}
	g.Call("stroke")
	g.Set("fillStyle", "#e6bb82")
	for _, p := range knots {
		g.Call("beginPath")
		g.Call("arc", 9+p[0]*204, 9+(1.6-p[1])/2.2*102, 3, 0, 2*math.Pi)
		g.Call("fill")
	}
}
func (a *App) mountColumn() {
	column := obj(a.Config, "column")
	if len(column) == 0 {
		return
	}
	panel := create("details", "panel", "")
	panel.Set("id", "column-panel")
	panel.Call("append", create("summary", "", "Rock column"), create("p", "small", "Beds repeat upward within each section. Changes belong to this map."))
	element("variant-control").Call("after", panel)
	body := create("div", "column-body", "")
	panel.Call("append", body)
	var fields func(js.Value, any, []any, string)
	fields = func(parent js.Value, v any, path []any, label string) {
		switch v := v.(type) {
		case map[string]any:
			for k, x := range v {
				if k == "variants" {
					continue
				}
				fields(parent, x, append(append([]any{}, path...), k), k)
			}
		case []any:
			box := create("details", "feature-group", "")
			box.Call("append", create("summary", "", label))
			parent.Call("append", box)
			for i, x := range v {
				fields(box, x, append(append([]any{}, path...), i), fmt.Sprintf("%s %d", label, i+1))
			}
		case float64, string:
			row := create("label", "", label+" ")
			input := create("input", "", "")
			input.Set("type", "number")
			input.Set("step", "any")
			if _, ok := v.(string); ok {
				input.Set("type", "text")
			}
			input.Set("value", fmt.Sprint(v))
			encoded, _ := json.Marshal(path)
			input.Get("dataset").Set("columnPath", string(encoded))
			row.Call("append", input)
			parent.Call("append", row)
			on(input, "change", func(js.Value) {
				var next any = input.Get("value").String()
				if _, ok := v.(float64); ok {
					n, e := strconv.ParseFloat(next.(string), 64)
					if e != nil || math.IsInf(n, 0) || math.IsNaN(n) {
						showError(fmt.Errorf("Use a finite column value."))
						return
					}
					next = n
				}
				candidate := clone(obj(a.Config, "column"))
				target := any(candidate)
				for _, k := range path[:len(path)-1] {
					switch k := k.(type) {
					case string:
						target = target.(map[string]any)[k]
					case int:
						target = target.([]any)[k]
					}
				}
				switch k := path[len(path)-1].(type) {
				case string:
					target.(map[string]any)[k] = next
				case int:
					target.([]any)[k] = next
				}
				if err := model.ValidateColumn(candidate, a.defaultColumn); err != nil {
					showError(err)
					input.Call("blur")
					a.syncColumn()
					input.Call("focus")
					return
				}
				a.Config["column"] = candidate
				showError(nil)
				a.Change()
				a.Checkpoint()
			})
		}
	}
	variant := str(a.Config, "variant", "")
	variantRow := obj(obj(column, "variants"), variant)
	for key, v := range column {
		if key == "variants" {
			continue
		}
		path := []any{key}
		if (key == "sections" || key == "bands") && variantRow[key] != nil {
			v = variantRow[key]
			path = []any{"variants", variant, key}
		}
		fields(body, v, path, key)
	}
	original := clone(column)
	restore := create("button", "", "Restore world column")
	panel.Call("append", restore)
	on(restore, "click", func(js.Value) { a.Config["column"] = clone(original); a.syncColumn(); a.Change(); a.Checkpoint() })
}

func (a *App) syncColumn() {
	if !exists(element("column-panel")) {
		return
	}
	each("[data-column-path]", func(input js.Value) {
		if input.Equal(document.Get("activeElement")) {
			return
		}
		var path []any
		if json.Unmarshal([]byte(input.Get("dataset").Get("columnPath").String()), &path) != nil {
			return
		}
		var target any = a.Config["column"]
		for _, key := range path {
			switch k := key.(type) {
			case string:
				m, ok := target.(map[string]any)
				if !ok {
					return
				}
				target = m[k]
			case float64:
				arr, ok := target.([]any)
				i := int(k)
				if !ok || i < 0 || i >= len(arr) {
					return
				}
				target = arr[i]
			}
		}
		input.Set("value", fmt.Sprint(target))
	})
}
