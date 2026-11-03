//go:build js && wasm

package editor

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
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

// columnAt follows the same section, bed, band, and variant paths used by
// the shader table. Paths are stored on inputs so undo and recipe loads can
// refresh the existing controls without interrupting an active edit.
func columnAt(value any, path []any) any {
	for _, key := range path {
		switch k := key.(type) {
		case string:
			m, ok := value.(map[string]any)
			if !ok {
				return nil
			}
			value = m[k]
		case int:
			a, ok := value.([]any)
			if !ok || k < 0 || k >= len(a) {
				return nil
			}
			value = a[k]
		case float64:
			a, ok := value.([]any)
			i := int(k)
			if !ok || i < 0 || i >= len(a) {
				return nil
			}
			value = a[i]
		default:
			return nil
		}
	}
	return value
}
func columnSet(value any, path []any, next any) {
	target := columnAt(value, path[:len(path)-1])
	switch k := path[len(path)-1].(type) {
	case string:
		target.(map[string]any)[k] = next
	case int:
		target.([]any)[k] = next
	}
}
func columnSame(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}
func (a *App) columnForEdit() map[string]any {
	column := clone(obj(a.Config, "column"))
	if columnSame(a.Config["column"], a.defaultColumn) {
		colors, _ := column["colors"].([]any)
		world := a.mergedColors()
		for i := range colors {
			v, ok := world[fmt.Sprintf("strata%d", i+1)]
			if !ok {
				continue
			}
			var rgb []float64
			switch c := v.(type) {
			case []float64:
				rgb = c
			case []any:
				for _, x := range c {
					if n, ok := x.(float64); ok {
						rgb = append(rgb, n)
					}
				}
			}
			if len(rgb) >= 3 {
				colors[i] = []any{rgb[0] * 255, rgb[1] * 255, rgb[2] * 255}
			}
		}
	}
	return column
}
func columnHex(v any) string {
	a, ok := v.([]any)
	if !ok || len(a) < 3 {
		return "#000000"
	}
	c := make([]int, 3)
	for i := 0; i < 3; i++ {
		n, _ := a[i].(float64)
		c[i] = int(math.Floor(math.Max(0, math.Min(255, n)) + .5))
	}
	return fmt.Sprintf("#%02x%02x%02x", c[0], c[1], c[2])
}
func columnDisplay(input js.Value, v any) {
	if input.Get("type").String() == "color" {
		input.Set("value", columnHex(v))
	} else {
		input.Set("value", fmt.Sprint(v))
	}
}
func (a *App) mountColumn() {
	panel := create("details", "panel", "")
	panel.Set("id", "column-panel")
	panel.Set("innerHTML", `<summary>Rock column</summary><p class="small">Beds repeat upward within each section. Changes belong to this map.</p><div class="column-body"></div><p class="small" role="status"></p><button type="button">Restore world column</button>`)
	element("variant-control").Call("after", panel)
	restore := panel.Call("querySelector", "button")
	on(restore, "click", func(js.Value) {
		a.Config["column"] = clone(a.defaultColumn)
		a.Change()
		a.Checkpoint()
		a.syncColumn()
	})
	a.syncColumn()
}
func (a *App) syncColumn() {
	panel := element("column-panel")
	if !exists(panel) {
		return
	}
	body := panel.Call("querySelector", ".column-body")
	note := panel.Call("querySelector", `[role="status"]`)
	restore := panel.Call("querySelector", "button")
	column := a.columnForEdit()
	if len(column) == 0 {
		panel.Set("hidden", true)
		return
	}
	panel.Set("hidden", false)
	edited := !columnSame(a.Config["column"], a.defaultColumn)
	restore.Set("disabled", !edited)
	if edited {
		note.Set("textContent", "Map column edited.")
	} else {
		note.Set("textContent", "Using the world column unchanged.")
	}
	variant := str(a.Config, "variant", "")
	row := obj(obj(column, "variants"), variant)
	prefix := func(key string) []any {
		if row[key] != nil {
			return []any{"variants", variant, key}
		}
		return []any{key}
	}
	sections, _ := columnAt(column, prefix("sections")).([]any)
	bands, _ := columnAt(column, prefix("bands")).([]any)
	colors, _ := column["colors"].([]any)
	parts := []string{variant, fmt.Sprint(len(sections)), fmt.Sprint(len(colors)), fmt.Sprint(len(bands)), fmt.Sprint(column["origin"] != nil), fmt.Sprint(columnAt(column, []any{"wander", "value"}) != nil)}
	for _, raw := range sections {
		section, _ := raw.(map[string]any)
		beds, _ := section["beds"].([]any)
		parts = append(parts, fmt.Sprint(len(beds)))
	}
	terrain, _ := columnAt(column, []any{"wander", "terrain"}).([]any)
	parts = append(parts, fmt.Sprint(len(terrain)))
	signature := strings.Join(parts, "|")
	if body.Get("dataset").Get("columnStructure").String() != signature {
		clearEvents(body)
		body.Call("replaceChildren")
		body.Get("dataset").Set("columnStructure", signature)
		type choice struct {
			value any
			label string
		}
		type options struct {
			min, max *float64
			choices  []choice
			color    bool
		}
		field := func(parent js.Value, label string, path []any, opt options) js.Value {
			wrap := create("label", "", label)
			tag := "input"
			if len(opt.choices) > 0 {
				tag = "select"
			}
			input := create(tag, "", "")
			encoded, _ := json.Marshal(path)
			input.Get("dataset").Set("columnJSON", string(encoded))
			names := make([]string, len(path))
			for i, p := range path {
				names[i] = fmt.Sprint(p)
			}
			input.Get("dataset").Set("columnPath", strings.Join(names, "."))
			attribute(input, "aria-label", label)
			original := columnAt(column, path)
			if len(opt.choices) > 0 {
				for _, c := range opt.choices {
					o := create("option", "", c.label)
					o.Set("value", fmt.Sprint(c.value))
					input.Call("append", o)
				}
			} else {
				if opt.color {
					input.Set("type", "color")
				} else {
					input.Set("type", "number")
					input.Set("step", "any")
				}
				input.Set("required", true)
				if opt.min != nil {
					input.Set("min", fmt.Sprint(*opt.min))
				}
				if opt.max != nil {
					input.Set("max", fmt.Sprint(*opt.max))
				}
			}
			columnDisplay(input, original)
			on(input, "input", func(js.Value) {
				input.Call("setCustomValidity", "")
				if !input.Call("checkValidity").Bool() {
					note.Set("textContent", "Enter a value within the displayed limits.")
					return
				}
				var next any
				raw := input.Get("value").String()
				if opt.color {
					n, e := strconv.ParseUint(strings.TrimPrefix(raw, "#"), 16, 24)
					if e != nil {
						return
					}
					next = []any{float64(n >> 16), float64((n >> 8) & 255), float64(n & 255)}
				} else if _, ok := original.(string); ok {
					next = raw
				} else {
					n, e := strconv.ParseFloat(raw, 64)
					if e != nil || math.IsNaN(n) || math.IsInf(n, 0) {
						input.Call("setCustomValidity", "Enter a finite number.")
						note.Set("textContent", "Enter a finite number.")
						return
					}
					next = n
				}
				candidate := a.columnForEdit()
				columnSet(candidate, path, next)
				if err := model.ValidateColumn(candidate, a.defaultColumn); err != nil {
					input.Call("setCustomValidity", err.Error())
					note.Set("textContent", err.Error())
					return
				}
				if !columnSame(candidate, a.Config["column"]) {
					a.Config["column"] = candidate
					input.Get("dataset").Set("columnDirty", "true")
					a.Change()
				}
			})
			on(input, "change", func(js.Value) {
				if !input.Call("checkValidity").Bool() {
					input.Call("setCustomValidity", "")
					columnDisplay(input, columnAt(a.columnForEdit(), path))
					a.syncColumn()
					return
				}
				if input.Get("dataset").Get("columnDirty").String() == "true" {
					input.Get("dataset").Set("columnDirty", "")
					a.Checkpoint()
				}
			})
			wrap.Call("append", input)
			parent.Call("append", wrap)
			return input
		}
		min001, min0, max1 := .001, 0.0, 1.0
		if variant != "" {
			label := variant
			selectEl := element("variant-select")
			if exists(selectEl) {
				selected := selectEl.Get("selectedOptions")
				if exists(selected) && selected.Length() > 0 {
					label = selected.Index(0).Get("textContent").String()
				}
			}
			body.Call("append", create("p", "small", "Column row: "+label))
		}
		for i, raw := range sections {
			section, _ := raw.(map[string]any)
			group := create("div", "column-section", "")
			group.Call("append", create("h4", "", fmt.Sprintf("Section %d", i+1)))
			base := append(append([]any{}, prefix("sections")...), i)
			field(group, "Starts at height", append(append([]any{}, base...), "start"), options{})
			table := create("table", "", "")
			table.Set("innerHTML", `<thead><tr><th>Thickness</th><th>Hardness</th><th>Material</th></tr></thead>`)
			tbody := create("tbody", "", "")
			table.Call("append", tbody)
			group.Call("append", table)
			beds, _ := section["beds"].([]any)
			for j := range beds {
				tr := create("tr", "", "")
				for _, desc := range []struct {
					index int
					name  string
					opt   options
				}{{0, "thickness", options{min: &min001}}, {1, "hardness", options{min: &min0, max: &max1}}, {2, "material", options{choices: func() []choice {
					n := len(colors)
					if n == 0 {
						n = 5
					}
					out := make([]choice, n)
					for k := range out {
						out[k] = choice{k, fmt.Sprintf("Slot %d", k+1)}
					}
					return out
				}()}}} {
					td := create("td", "", "")
					path := append(append([]any{}, base...), "beds", j, desc.index)
					input := field(td, fmt.Sprintf("Section %d, bed %d %s", i+1, j+1, desc.name), path, desc.opt)
					input.Get("parentNode").Get("firstChild").Set("textContent", "")
					tr.Call("append", td)
				}
				tbody.Call("append", tr)
			}
			body.Call("append", group)
		}
		if len(bands) > 0 {
			body.Call("append", create("h4", "", "Contour bands"))
			group := create("div", "column-options", "")
			body.Call("append", group)
			field(group, "Height step", append(append([]any{}, prefix("bands")...), 0), options{min: &min001})
			field(group, "Line strength", append(append([]any{}, prefix("bands")...), 1), options{min: &min0, max: &max1})
		}
		optionsGroup := create("div", "column-options", "")
		body.Call("append", optionsGroup)
		if column["origin"] != nil {
			field(optionsGroup, "Count height from", []any{"origin"}, options{choices: []choice{{"plain", "Dry plain"}, {"sea", "Sea level"}}})
		}
		if columnAt(column, []any{"wander", "value"}) != nil {
			field(optionsGroup, "Bed wander", []any{"wander", "value"}, options{})
		}
		for i := range terrain {
			labels := []string{"Broad wander", "Medium wander", "Fine wander"}
			label := fmt.Sprintf("Wander %d", i+1)
			if i < len(labels) {
				label = labels[i]
			}
			field(optionsGroup, label, []any{"wander", "terrain", i}, options{})
		}
		if len(colors) > 0 {
			details := create("details", "feature-group", "")
			details.Call("append", create("summary", "", "Material slot colors"))
			group := create("div", "column-options", "")
			details.Call("append", group)
			for i := range colors {
				field(group, fmt.Sprintf("Slot %d", i+1), []any{"colors", i}, options{color: true})
			}
			body.Call("append", details)
		}
	}
	each("#column-panel [data-column-json]", func(input js.Value) {
		if input.Equal(document.Get("activeElement")) {
			return
		}
		var path []any
		if json.Unmarshal([]byte(input.Get("dataset").Get("columnJSON").String()), &path) != nil {
			return
		}
		v := columnAt(column, path)
		if v != nil {
			columnDisplay(input, v)
		}
	})
}
