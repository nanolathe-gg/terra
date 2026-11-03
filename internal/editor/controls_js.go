//go:build js && wasm

package editor

import (
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
	"syscall/js"

	"github.com/nanolathe-gg/terraform/internal/model"
)

func (a *App) mountLayout() {
	if s := localGet("terraform-editor-panels"); s != "" {
		_ = json.Unmarshal([]byte(s), &a.panels)
	}
	for _, id := range []string{"tools", "inspector"} {
		id := id
		click("toggle-"+id, func() { a.focused = false; a.panels[id] = !a.panels[id]; a.layout() })
	}
	click("focus-canvas", func() { a.focused = !a.focused; a.layout() })
	a.layout()
	tabs := []string{"world", "map", "export", "graphics"}
	activate := func(name string) {
		for _, t := range tabs {
			active := name == t
			attribute(element("tab-"+t), "aria-selected", active)
			element("tab-"+t).Set("tabIndex", map[bool]int{true: 0, false: -1}[active])
			hidden("pane-"+t, !active)
		}
	}
	for i, id := range tabs {
		i, id := i, id
		click("tab-"+id, func() { activate(id) })
		on(element("tab-"+id), "keydown", func(e js.Value) {
			j := i
			switch e.Get("key").String() {
			case "ArrowRight":
				j = (i + 1) % len(tabs)
			case "ArrowLeft":
				j = (i + len(tabs) - 1) % len(tabs)
			case "Home":
				j = 0
			case "End":
				j = len(tabs) - 1
			default:
				return
			}
			e.Call("preventDefault")
			activate(tabs[j])
			element("tab-" + tabs[j]).Call("focus")
		})
	}
	for _, item := range []struct {
		id   string
		clay bool
	}{{"view-rendered", false}, {"view-clay", true}} {
		item := item
		click(item.id, func() {
			element("clay").Set("checked", item.clay)
			attribute(element("view-rendered"), "aria-pressed", !item.clay)
			attribute(element("view-clay"), "aria-pressed", item.clay)
			a.Change()
			a.Checkpoint()
		})
	}
	hidden("weathered-view-control", false)
	if localGet("terraform-weathered-view") == "false" || a.Query.Get("weatheredView") == "0" {
		element("weathered-view").Set("checked", false)
	}
	on(element("weathered-view"), "change", func(js.Value) {
		_ = localSet("terraform-weathered-view", strconv.FormatBool(checked("weathered-view")))
		a.Change()
		a.Checkpoint()
	})
	palette := query(".tool-palette .tools")
	grouped := create("div", "tool-groups", "")
	for _, group := range []struct {
		name  string
		kinds []string
	}{{"Select and place", []string{"move"}}, {"Shape", []string{"landform", "plateau", "hill", "ramp", "offset", "crater", "fissure", "crystal", "deep"}}, {"Finish", []string{"smooth", "erase", "paint"}}} {
		section := create("div", "tool-group", "")
		section.Call("append", create("span", "tool-group-label", group.name))
		buttons := create("div", "tools", "")
		attribute(buttons, "role", "group")
		attribute(buttons, "aria-label", group.name+" tools")
		for _, kind := range group.kinds {
			b := query("[data-tool='" + kind + "']")
			if exists(b) {
				buttons.Call("append", b)
			}
		}
		section.Call("append", buttons)
		grouped.Call("append", section)
	}
	variants := create("div", "", "")
	variants.Set("hidden", true)
	for _, kind := range []string{"mountain", "shallow", "sand", "grass"} {
		variants.Call("append", query("[data-tool='"+kind+"']"))
	}
	grouped.Call("append", variants)
	palette.Call("replaceWith", grouped)
	for kind, label := range map[string]string{"hill": "Ridge", "deep": "Water", "crystal": "Faceted forms", "paint": "Surface paint", "erase": "Reset ground"} {
		query("[data-tool='"+kind+"']").Set("textContent", label)
	}
	mode := create("div", "control", "")
	mode.Set("id", "tool-mode-control")
	mode.Set("innerHTML", "<label for='tool-mode'>Drawing mode</label><select id='tool-mode'></select>")
	element("tool-style").Call("closest", ".control").Call("after", mode)
	on(element("tool-mode"), "change", func(js.Value) { a.rememberTool(); a.Tool = value("tool-mode"); a.Selected = -1; a.showTool(a.Tool) })
	each("[data-tool]", func(b js.Value) {
		on(b, "click", func(js.Value) {
			a.rememberTool()
			a.Tool = b.Get("dataset").Get("tool").String()
			a.Selected = -1
			a.PathMode = false
			a.AddPath = false
			if a.featureUI != nil {
				a.featureUI.Active = false
			}
			a.showTool(a.Tool)
			a.drawOverlay()
		})
	})
	click("undo", func() { a.Undo(-1) })
	click("redo", func() { a.Undo(1) })
	click("blank", func() {
		if a.Busy {
			return
		}
		a.Nodes = nil
		a.addGround()
		a.Selected = -1
		a.Checkpoint()
		a.Schedule()
	})
	for _, id := range []string{"selection-clear", "canvas-deselect"} {
		click(id, func() { a.Select(-1) })
	}
	for _, id := range []string{"edit-path", "canvas-path-mode"} {
		click(id, func() { a.PathMode = !a.PathMode; a.Update(); a.drawOverlay() })
	}
	click("transform-mode", func() { a.PathMode = false; a.Update(); a.drawOverlay() })
	click("draw-new", func() {
		a.AddPath = false
		if n := a.selected(); n != nil {
			a.Tool = n.Kind
			a.Selected = -1
		}
		a.Update()
	})
	click("draw-add", func() { a.AddPath = true; a.Update() })
	for _, name := range []string{"up", "down", "delete", "seed", "hide"} {
		name := name
		click("node-"+name, func() { a.nodeAction(name) })
	}
	click("selection-delete", func() { a.nodeAction("delete") })
	for _, v := range []struct {
		id              string
		rotation, scale float64
	}{{"rotate-left", -15, 1}, {"rotate-right", 15, 1}, {"scale-down", 0, .9}, {"scale-up", 0, 1.1}} {
		v := v
		click(v.id, func() {
			n := a.selected()
			if n == nil {
				return
			}
			t, _, e := model.SelectionTransform(*n, nil)
			if e != nil {
				return
			}
			t.Rotation += v.rotation
			t.Scale *= v.scale
			a.preciseTransform(t)
		})
	}
	for _, key := range []string{"x", "y", "rotation", "scale"} {
		on(element("selection-"+key), "change", func(js.Value) {
			a.preciseTransform(model.TransformValues{X: number("selection-x"), Y: number("selection-y"), Rotation: number("selection-rotation"), Scale: number("selection-scale")})
		})
	}
	click("path-add", func() { a.editPath("insert") })
	click("path-delete", func() { a.editPath("delete") })
	click("path-remove", func() { a.editPath("remove") })
	click("path-extend", func() { a.AddPath = !a.AddPath; a.Update() })
}
func (a *App) layout() {
	app := query(".app")
	for _, id := range []string{"tools", "inspector"} {
		show := a.panels[id] && !a.focused
		app.Get("classList").Call("toggle", id+"-collapsed", !show)
		hidden(id+"-sidebar", !show)
		attribute(element("toggle-"+id), "aria-expanded", show)
	}
	attribute(element("focus-canvas"), "aria-pressed", a.focused)
	b, _ := json.Marshal(a.panels)
	_ = localSet("terraform-editor-panels", string(b))
	if a.view.Width > 0 {
		a.resize()
	}
}
func (a *App) mountControls() {
	// Sliders that edit a selected shape use the same interactive preview as a
	// canvas drag; release always queues the canonical render.
	on(document, "pointerdown", func(e js.Value) {
		target := e.Get("target")
		if !a.Busy && exists(target) && target.Get("tagName").String() == "INPUT" && target.Get("type").String() == "range" && element("brush-panel").Call("contains", target).Bool() {
			a.controlEditing = true
		}
	})
	finishControl := func(js.Value) {
		if a.controlEditing {
			a.controlEditing = false
			a.Schedule()
		}
	}
	on(document, "pointerup", finishControl)
	on(document, "pointercancel", finishControl)
	on(document, "lostpointercapture", finishControl)
	root := element("shape-options")
	for _, f := range a.Schema.Shapes {
		f := f
		id, label := f[1].(string), f[2].(string)
		row := create("div", "control", "")
		row.Set("id", id+"-control")
		lab := create("label", "", label+" ")
		attribute(lab, "for", id)
		out := create("output", "", "")
		out.Set("id", id+"-value")
		lab.Call("append", out)
		row.Call("append", lab)
		var control js.Value
		if len(f) > 9 && f[9] != nil {
			control = create("select", "", "")
			for _, c := range f[9].([]any) {
				v := c.([]any)
				option(control, v[1].(string), v[0])
			}
			out.Set("hidden", true)
		} else {
			control = create("input", "", "")
			control.Set("type", "range")
			attribute(control, "min", f[4])
			attribute(control, "max", f[5])
			attribute(control, "step", f[6])
		}
		control.Set("id", id)
		row.Call("append", control, create("p", "small", f[8].(string)))
		root.Call("append", row)
		on(control, "input", func(js.Value) { a.controlEdit() })
		on(control, "change", func(js.Value) {
			if a.selected() != nil {
				a.Checkpoint()
			}
		})
	}
	for _, id := range []string{"diameter", "amount", "roughness", "softness", "cracks", "bank-width", "beach-flatness", "shelves", "shallow-mode"} {
		on(element(id), "input", func(js.Value) { a.controlEdit() })
		on(element(id), "change", func(js.Value) {
			if a.selected() != nil {
				a.Checkpoint()
			}
		})
	}
	for _, id := range []string{"relief", "material-weathering", "deposit-spread", "transition-detail", "mineral-ring", "ring-spread", "ring-variation", "scree"} {
		on(element(id), "input", func(js.Value) { a.Change() })
		on(element(id), "change", func(js.Value) { a.Checkpoint() })
	}
	for _, id := range []string{"weather", "light", "clay"} {
		on(element(id), "change", func(js.Value) { a.Change(); a.Checkpoint() })
	}
	on(element("tool-style"), "change", func(js.Value) {
		kind := a.Tool
		if n := a.selected(); n != nil {
			kind = n.Kind
		}
		a.ToolSettings[kind] = a.toolDefaults(kind, value("tool-style"))
		a.showTool(kind)
		a.controlEdit()
		if a.selected() != nil {
			a.Checkpoint()
		}
	})
	on(element("seed"), "change", func(js.Value) {
		v := number("seed")
		if math.Trunc(v) != v || v < 0 || v > math.MaxUint32 {
			showError(fmt.Errorf("Use an integer seed from 0 to 4294967295."))
			return
		}
		a.Seed = uint32(v)
		a.persist()
		if n := a.selected(); n != nil {
			n.Seed = a.Seed
			a.Checkpoint()
			a.Schedule()
		}
	})
	click("seed-randomize", func() {
		a.Seed = randomSeed()
		setValue("seed", a.Seed)
		a.persist()
		if n := a.selected(); n != nil {
			n.Seed = a.Seed
			a.Checkpoint()
			a.Schedule()
		}
	})
	on(element("seed-vary"), "change", func(js.Value) { a.persist() })
	a.mountCurve()
	a.groupToolControls()
}
func randomSeed() uint32 {
	b := js.Global().Get("Uint32Array").New(1)
	js.Global().Get("crypto").Call("getRandomValues", b)
	return uint32(b.Index(0).Float())
}
func (a *App) controlEdit() {
	if n := a.selected(); n != nil {
		n.Params = a.params()
		a.Change()
	} else {
		a.rememberTool()
		a.Update()
	}
	a.persist()
}
func (a *App) updateToolGroups() {
	kind := a.Tool
	if n := a.selected(); n != nil {
		kind = n.Kind
	}
	families := [][]string{{"hill", "mountain"}, {"deep", "shallow"}, {"paint", "sand", "grass"}}
	found := false
	selectEl := element("tool-mode")
	for _, family := range families {
		if contains(family, kind) {
			found = true
			if selectEl.Get("dataset").Get("family").String() != family[0] {
				selectEl.Call("replaceChildren")
				for _, k := range family {
					option(selectEl, strings.Title(k), k)
				}
				selectEl.Get("dataset").Set("family", family[0])
			}
			selectEl.Set("value", kind)
		}
	}
	hidden("tool-mode-control", !found)
	each("#shape-options .feature-group", func(g js.Value) {
		rows := g.Call("querySelectorAll", ".control")
		visible := false
		for i := 0; i < rows.Length(); i++ {
			if !rows.Index(i).Get("hidden").Bool() {
				visible = true
			}
		}
		g.Set("hidden", !visible)
		prior := g.Get("dataset").Get("landformContext").String()
		if prior != kind && (kind == "landform" || prior == "landform") {
			name := g.Get("dataset").Get("groupName").String()
			g.Set("open", kind == "landform" && (name == "Height" || name == "Cross-section" || name == "Variation"))
		}
		g.Get("dataset").Set("landformContext", kind)
	})
}
func (a *App) groupToolControls() {
	groups := []struct {
		name string
		keys []string
	}{{"Height", strings.Fields("elevation combine")}, {"Cross-section", strings.Fields("facePx terraces ledge terraceJitter breakup lean facing")}, {"Variation", strings.Fields("wander widthVary heightVary varySize varyFoot varyMiddle")}, {"Variability", strings.Fields("faceVariation outlineVar widthVar heightVar")}, {"Shore lobes", strings.Fields("fingers fingerSize")}, {"Shore layers", strings.Fields("shoreLayers layerPx layerRiser layerLedge layerRough layerStyle layerVary layerCircle lavaSpread lavaCircleVary")}, {"Spurs", strings.Fields("spurCount spurLength spurSpread spurWidth spurTaper spurHeight spurForks spurBulb")}, {"Rim sectors", strings.Fields("rimSectors rimUnequal")}, {"Rim gaps", strings.Fields("rimGaps rimGapWidth")}, {"Branches", strings.Fields("fissureBranches fissureBranchLen fissureBranchSpread")}, {"Fracture network", strings.Fields("fissureNetwork fissureCell")}, {"Shore plates", strings.Fields("shorePlates plateWaterPx plateLandPx plateSize plateGap plateHeight plateMaterial frostNeedles crystalShoreSeam plateVary")}, {"Faceted form", strings.Fields("crystalForm crystalSides crystalSize crystalCount crystalTop crystalLean crystalVariation")}, {"Column structure", strings.Fields("crystalTiers crystalStep crystalFacet crystalSizeVar crystalSmooth")}, {"Planar block", strings.Fields("crystalAlign bergFace bergJitter bergBreak bergRough bergTilt bergTiltDir bergFlat")}, {"Water appearance", strings.Fields("waterShore waterDeep waterBed")}, {"Crest variation", strings.Fields("crestJag crestVary crestTaper")}, {"Paint inside shape", strings.Fields("maskChannel maskAmount")}, {"Bowl facets", strings.Fields("craterFacets crystalCraterPx crystalCraterStep crystalCraterSkin")}, {"Angular facets", strings.Fields("iceFacets iceFacetSize")}}
	root := element("shape-options")
	claimed := map[string]bool{}
	for _, g := range groups {
		d := create("details", "feature-group", "")
		d.Get("dataset").Set("groupName", g.name)
		d.Call("append", create("summary", "", g.name))
		body := create("div", "feature-body", "")
		d.Call("append", body)
		for _, f := range a.Schema.Shapes {
			if contains(g.keys, f[0].(string)) {
				body.Call("append", element(f[1].(string)+"-control"))
				claimed[f[0].(string)] = true
			}
		}
		if g.name == "Cross-section" {
			body.Call("prepend", element("section-preview-control"))
		}
		root.Call("append", d)
	}
	for _, f := range a.Schema.Shapes {
		if !claimed[f[0].(string)] {
			d := create("details", "feature-group", "")
			d.Call("append", create("summary", "", f[2].(string)), element(f[1].(string)+"-control"))
			root.Call("append", d)
		}
	}
}
func (a *App) mountWorld() {
	selectEl := element("biome-select")
	worlds := map[string]any{}
	_ = json.Unmarshal([]byte(localGet("nanolathe-map-editor-worlds")), &worlds)
	for id, name := range obj(a.Config, "biomes") {
		option(selectEl, fmt.Sprint(name), "biome:"+id)
	}
	for id, raw := range worlds {
		if _, builtIn := obj(a.Config, "biomes")[id]; builtIn {
			continue
		}
		w, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if _, ok = obj(a.Config, "biomes")[str(w, "base", "")]; ok {
			option(selectEl, str(w, "name", id)+" (custom)", "world:"+id)
		}
	}
	selected := "biome:" + a.World()
	if id := a.Query.Get("world"); id != "" {
		if w, ok := worlds[id].(map[string]any); ok && str(w, "base", "") == a.World() {
			selected = "world:" + id
		}
	}
	selectEl.Set("value", selected)
	on(selectEl, "change", func(js.Value) {
		v := value("biome-select")
		if strings.HasPrefix(v, "world:") {
			id := strings.TrimPrefix(v, "world:")
			w, _ := worlds[id].(map[string]any)
			a.navigate(map[string]string{"biome": str(w, "base", a.World()), "world": id, "variant": ""})
		} else {
			a.navigate(map[string]string{"biome": strings.TrimPrefix(v, "biome:"), "world": "", "variant": ""})
		}
	})

	variants := obj(a.Config, "variants")
	if len(variants) > 0 {
		hidden("variant-control", false)
		v := element("variant-select")
		option(v, "World default", "")
		for k, item := range variants {
			label := k
			if name, ok := item.(string); ok {
				label = name
			}
			if m, ok := item.(map[string]any); ok {
				label = str(m, "name", k)
			}
			option(v, label, k)
		}
		v.Set("value", str(a.Config, "variant", ""))
		on(v, "change", func(js.Value) { a.navigate(map[string]string{"variant": value("variant-select")}) })
	}
	patternRow := create("div", "control", "")
	patternRow.Set("innerHTML", `<label for="ground-pattern">Ground pattern</label><select id="ground-pattern"><option value="">This world's own</option></select><p class="small">Another world's ground grain, moved to this world's Ground color. Contrast is under Ground below.</p>`)
	element("world-colors").Call("append", patternRow)
	for id, raw := range obj(a.Config, "groundPatterns") {
		if id != a.World() {
			p, _ := raw.(map[string]any)
			option(element("ground-pattern"), str(p, "name", id), id)
		}
	}
	setValue("ground-pattern", str(a.Knobs, "groundPattern", ""))
	on(element("ground-pattern"), "change", func(js.Value) {
		a.Knobs["groundPattern"] = value("ground-pattern")
		a.saveWorldPreset()
		a.Change()
		a.Checkpoint()
	})
	palette := create("label", "small", "")
	palette.Set("innerHTML", `<input type="checkbox" id="palette-toggle"> TA palette`)
	element("rendering-host").Call("prepend", palette)
	element("palette-toggle").Set("checked", str(a.Knobs, "palette", a.Query.Get("palette")) != "off")
	on(element("palette-toggle"), "change", func(js.Value) {
		if checked("palette-toggle") {
			a.Knobs["palette"] = "nearest"
		} else {
			a.Knobs["palette"] = "off"
		}
		a.saveWorldPreset()
		a.Change()
		a.Checkpoint()
	})
	groups := map[string]js.Value{}
	root := element("knobs")
	search := create("div", "control-search", "")
	search.Set("innerHTML", "<label for='world-search'>Find a setting</label><input id='world-search' type='search' placeholder='e.g. shore, ridge, color'><label class='fine-controls'><input id='world-fine' type='checkbox'> Show fine controls</label><p id='world-control-count' class='small'></p>")
	root.Call("before", search)
	for _, id := range []string{"world-search", "world-fine"} {
		on(element(id), "input", func(js.Value) { a.syncWorld() })
	}
	for _, g := range a.Schema.Knobs {
		name := g[0].(string)
		if v := a.Schema.GroupNames[name]; v != "" {
			name = v
		}
		box := groups[name]
		if !exists(box) {
			box = create("details", "knobs-group", "")
			box.Get("dataset").Set("group", name)
			box.Call("append", create("summary", "", name))
			groups[name] = box
		}
		if g[0] == "Palette" {
			element("rendering-host").Call("append", box)
		} else {
			root.Call("append", box)
		}
		for _, raw := range g[1].([]any) {
			f := raw.([]any)
			key, label := f[0].(string), f[1].(string)
			if contains(a.Schema.Parked, key) {
				continue
			}
			row := create("div", "control", "")
			row.Get("dataset").Set("knob", key)
			lab := create("label", "", label+" ")
			attribute(lab, "for", "knob-"+key)
			out := create("output", "", "")
			lab.Call("append", out)
			var c js.Value
			if choices := a.Schema.Choices[key]; len(choices) > 0 {
				c = create("select", "", "")
				for _, v := range choices {
					option(c, v[1].(string), v[0])
				}
				out.Set("hidden", true)
			} else {
				c = create("input", "", "")
				c.Set("type", "range")
				attribute(c, "min", f[2])
				attribute(c, "max", f[3])
				attribute(c, "step", f[4])
			}
			c.Set("id", "knob-"+key)
			c.Set("value", fmt.Sprint(a.Knobs[key]))
			row.Call("append", lab, c)
			note := create("p", "small control-requirement", "")
			row.Call("append", note)
			box.Call("append", row)
			on(c, "input", func(js.Value) {
				a.Knobs[key] = number("knob-" + key)
				a.saveWorldPreset()
				for i := range a.Nodes {
					if a.Nodes[i].Kind == "ground" {
						switch key {
						case "undulation":
							a.Nodes[i].Amplitude = num(a.Knobs, key, 0)
						case "undulationScale":
							a.Nodes[i].Wavelength = num(a.Knobs, key, 200)
						case "undulationCover":
							a.Nodes[i].Coverage = num(a.Knobs, key, .45)
						}
					}
				}
				a.Change()
			})
			on(c, "change", func(js.Value) { a.Checkpoint() })
		}
	}
	for _, pair := range [][2]string{{"ground", "Ground"}, {"slope", "Slope cover"}, {"rock", "Rock"}, {"sand", "Sand"}, {"beach", "Beach"}, {"shallow", "Shallow water"}, {"deep", "Deep water"}, {"crystal", "Crystal"}, {"strata1", "Strata 1"}, {"strata2", "Strata 2"}, {"strata3", "Strata 3"}, {"strata4", "Strata 4"}} {
		key, label := pair[0], pair[1]
		row := create("div", "color-row", "")
		row.Get("dataset").Set("colorKey", key)
		enable := create("input", "", "")
		enable.Set("type", "checkbox")
		attribute(enable, "aria-label", "Override "+label)
		c := create("input", "", "")
		c.Set("type", "color")
		c.Set("value", "#809060")
		attribute(c, "aria-label", label+" color")
		row.Call("append", enable, create("span", "", label), c)
		element("world-colors").Call("append", row)
		change := func(js.Value) {
			if enable.Get("checked").Bool() {
				s := c.Get("value").String()
				rgb := []float64{}
				for _, i := range []int{1, 3, 5} {
					n, _ := strconv.ParseInt(s[i:i+2], 16, 64)
					rgb = append(rgb, float64(n)/255)
				}
				a.Colors[key] = rgb
			} else {
				if obj(a.Config, "colors")[key] != nil {
					a.Colors[key] = nil
				} else {
					delete(a.Colors, key)
				}
			}
			a.saveWorldPreset()
			a.Change()
		}
		on(enable, "change", func(e js.Value) { change(e); a.Checkpoint() })
		on(c, "input", func(e js.Value) { enable.Set("checked", true); change(e) })
		on(c, "change", func(js.Value) { a.Checkpoint() })
	}
	click("world-reset", func() {
		a.Colors = map[string]any{}
		a.saveWorldPreset()
		each("#world-colors input[type=checkbox]", func(v js.Value) { v.Set("checked", false) })
		a.Checkpoint()
		a.Schedule()
	})
	store := func() {
		b, _ := json.Marshal(worlds)
		if err := localSet("nanolathe-map-editor-worlds", string(b)); err != nil {
			showError(err)
		}
	}
	snapshot := func(name string) map[string]any {
		colors := map[string]any{}
		for key, c := range a.Colors {
			switch v := c.(type) {
			case []float64:
				if len(v) >= 3 {
					colors[key] = fmt.Sprintf("#%02x%02x%02x", int(math.Round(v[0]*255)), int(math.Round(v[1]*255)), int(math.Round(v[2]*255)))
				}
			case []any:
				if len(v) >= 3 {
					r, _ := v[0].(float64)
					g, _ := v[1].(float64)
					b, _ := v[2].(float64)
					colors[key] = fmt.Sprintf("#%02x%02x%02x", int(math.Round(r*255)), int(math.Round(g*255)), int(math.Round(b*255)))
				}
			case string:
				colors[key] = v
			case nil:
				colors[key] = nil
			}
		}
		return map[string]any{"base": a.World(), "name": name, "knobs": clone(a.Knobs), "colors": colors}
	}
	click("world-export", func() {
		name := a.World()
		if id := a.Query.Get("world"); id != "" {
			if w, ok := worlds[id].(map[string]any); ok {
				name = str(w, "name", name)
			}
		}
		b, _ := json.MarshalIndent(map[string]any{"format": "nanolathe-map-world", "world": snapshot(name)}, "", "  ")
		download(b, "application/json", name+".world.json")
	})
	click("world-import", func() { element("world-file").Call("click") })
	on(element("world-file"), "change", func(e js.Value) {
		go func() {
			files := e.Get("target").Get("files")
			if files.Length() == 0 {
				return
			}
			v, err := await(files.Index(0).Call("text"))
			if err != nil {
				showError(err)
				return
			}
			var d map[string]any
			if err = json.Unmarshal([]byte(v.String()), &d); err != nil {
				showError(err)
				return
			}
			w := obj(d, "world")
			name, base := str(w, "name", ""), str(w, "base", "")
			if str(d, "format", "") != "nanolathe-map-world" || name == "" || obj(a.Config, "biomes")[base] == nil {
				showError(fmt.Errorf("Not a world file for a world this server has."))
				return
			}
			id := fmt.Sprintf("custom-%x", randomSeed())
			_ = json.Unmarshal([]byte(localGet("nanolathe-map-editor-worlds")), &worlds)
			worlds[id] = w
			store()
			a.navigate(map[string]string{"biome": base, "world": id, "variant": ""})
		}()
	})
	click("world-delete", func() {
		id := a.Query.Get("world")
		_ = json.Unmarshal([]byte(localGet("nanolathe-map-editor-worlds")), &worlds)
		if id != "" {
			delete(worlds, id)
			store()
			a.navigate(map[string]string{"world": "", "variant": ""})
		} else {
			delete(worlds, a.World())
			store()
			a.navigate(map[string]string{"biome": a.World(), "world": "", "variant": ""})
		}
	})
	click("world-new", func() {
		name := strings.TrimSpace(value("world-new-name"))
		if name == "" {
			return
		}
		id := fmt.Sprintf("custom-%x", randomSeed())
		_ = json.Unmarshal([]byte(localGet("nanolathe-map-editor-worlds")), &worlds)
		worlds[id] = snapshot(name)
		store()
		a.navigate(map[string]string{"world": id, "variant": ""})
	})

	a.mountColumn()
	a.finishLayout()
}
func (a *App) syncWorld() {
	if !exists(element("world-search")) {
		return
	}
	colors := a.mergedColors()
	values := a.worldValues()
	each("[data-color-key]", func(row js.Value) {
		key := row.Get("dataset").Get("colorKey").String()
		box := row.Call("querySelector", "input[type=checkbox]")
		pick := row.Call("querySelector", "input[type=color]")
		c, ok := colors[key]
		box.Set("checked", ok && c != nil)
		if ok {
			var rgb []float64
			switch v := c.(type) {
			case []float64:
				rgb = v
			case []any:
				for _, x := range v {
					if n, ok := x.(float64); ok {
						rgb = append(rgb, n)
					}
				}
			}
			if len(rgb) >= 3 && !pick.Equal(document.Get("activeElement")) {
				pick.Set("value", fmt.Sprintf("#%02x%02x%02x", int(math.Round(rgb[0]*255)), int(math.Round(rgb[1]*255)), int(math.Round(rgb[2]*255))))
			}
		}
	})
	setValue("ground-pattern", str(a.Knobs, "groundPattern", ""))
	element("palette-toggle").Set("checked", str(a.Knobs, "palette", a.Query.Get("palette")) != "off")
	a.syncColumn()
	q := strings.ToLower(strings.TrimSpace(value("world-search")))
	count, total := 0, 0
	each("[data-knob]", func(row js.Value) {
		key := row.Get("dataset").Get("knob").String()
		total++
		reason := model.WorldControlRequirement(key, values)
		row.Call("querySelector", ".control-requirement").Set("textContent", reason)
		row.Call("querySelector", ".control-requirement").Set("hidden", reason == "")
		input := row.Call("querySelector", "input,select")
		input.Set("disabled", reason != "")
		if !input.Equal(document.Get("activeElement")) {
			input.Set("value", fmt.Sprint(a.Knobs[key]))
		}
		row.Call("querySelector", "output").Set("textContent", input.Get("value").String())
		visible := q != "" && strings.Contains(strings.ToLower(row.Get("textContent").String()+" "+key), q) || q == "" && (checked("world-fine") || contains(a.Schema.Primary, key))
		if exists(row.Call("closest", "#rendering-host")) {
			visible = true
		}
		row.Set("hidden", !visible)
		if visible {
			count++
		}
	})
	each(".knobs-group", func(g js.Value) {
		rows := g.Call("querySelectorAll", "[data-knob]")
		visible := false
		for i := 0; i < rows.Length(); i++ {
			visible = visible || !rows.Index(i).Get("hidden").Bool()
		}
		g.Set("hidden", !visible)
		if q != "" && visible {
			g.Set("open", true)
		}
	})
	text("world-control-count", fmt.Sprintf("%d visible settings · %d total", count, total))
}
func (a *App) navigate(changes map[string]string) {
	q := clone(a.Query)
	for k, v := range changes {
		if v == "" {
			q.Del(k)
		} else {
			q.Set(k, v)
		}
	}
	js.Global().Get("location").Set("href", "/sculpt?"+q.Encode())
}
func (a *App) preciseTransform(t model.TransformValues) {
	n := a.selected()
	if n == nil {
		return
	}
	_, m, e := model.SelectionTransform(*n, &t)
	if e != nil {
		showError(e)
		return
	}
	transformNode(n, m)
	a.Checkpoint()
	a.Schedule()
	a.Update()
}
func transformNode(n *model.Node, m [6]float64) {
	for i, p := range n.Points {
		x, y := m[0]*p.X+m[2]*p.Y+m[4], m[1]*p.X+m[3]*p.Y+m[5]
		if current != nil {
			x = math.Max(0, math.Min(current.Width()-1, x))
			y = math.Max(0, math.Min(current.Height()-1, y))
		}
		n.Points[i] = model.Point{X: x, Y: y}
	}
	f := n.Frame
	if len(f) != 6 {
		f = []float64{1, 0, 0, 1, 0, 0}
	}
	n.Frame = []float64{m[0]*f[0] + m[2]*f[1], m[1]*f[0] + m[3]*f[1], m[0]*f[2] + m[2]*f[3], m[1]*f[2] + m[3]*f[3], m[0]*f[4] + m[2]*f[5] + m[4], m[1]*f[4] + m[3]*f[5] + m[5]}
	if n.Params != nil {
		if radius := num(n.Params, "radius", 0); radius > 0 {
			n.Params["radius"] = math.Max(4, math.Min(600, radius*math.Hypot(m[0], m[1])))
		}
	}
}
func (a *App) nodeAction(action string) {
	n := a.selected()
	if n == nil || a.gesture != nil {
		return
	}
	switch action {
	case "delete":
		a.Nodes = append(a.Nodes[:a.Selected], a.Nodes[a.Selected+1:]...)
		a.Selected = -1
	case "hide":
		n.Hidden = !n.Hidden
	case "seed":
		n.Seed = randomSeed()
	case "up", "down":
		to := a.Selected + 1
		if action == "down" {
			to = a.Selected - 1
		}
		if to < 0 || to >= len(a.Nodes) {
			return
		}
		a.Nodes[to], a.Nodes[a.Selected] = a.Nodes[a.Selected], a.Nodes[to]
		a.Selected = to
	}
	a.Checkpoint()
	a.Schedule()
}
func (a *App) renderLayers() {
	list := element("layers")
	clearEvents(list)
	list.Call("replaceChildren")
	text("layer-count", strconv.Itoa(len(a.Nodes)))
	for i := len(a.Nodes) - 1; i >= 0; i-- {
		i := i
		n := a.Nodes[i]
		row := create("li", "", "")
		row.Set("draggable", true)
		if i == a.Selected {
			row.Get("classList").Call("add", "selected")
		}
		if n.Hidden {
			row.Get("classList").Call("add", "is-hidden")
		}
		name := create("button", "layer-name", strings.Title(n.Kind))
		on(name, "click", func(js.Value) {
			if a.Selected == i {
				a.Select(-1)
			} else {
				a.Select(i)
			}
		})
		visibility := create("button", "layer-visibility", map[bool]string{true: "○", false: "◉"}[n.Hidden])
		on(visibility, "click", func(js.Value) { a.Selected = i; a.nodeAction("hide") })
		row.Call("append", create("span", "layer-grip", "⠿"), create("span", "layer-index", fmt.Sprintf("%02d", i+1)), name, create("span", "path-count", fmt.Sprintf("%d points", len(n.Points))), visibility)
		on(row, "dragstart", func(e js.Value) {
			e.Get("dataTransfer").Call("setData", "application/x-terraform-layer", strconv.Itoa(i))
		})
		on(row, "dragover", func(e js.Value) { e.Call("preventDefault") })
		on(row, "drop", func(e js.Value) {
			e.Call("preventDefault")
			from, err := strconv.Atoi(e.Get("dataTransfer").Call("getData", "application/x-terraform-layer").String())
			if err != nil || from < 0 || from >= len(a.Nodes) || from == i {
				return
			}
			n := a.Nodes[from]
			a.Nodes = append(a.Nodes[:from], a.Nodes[from+1:]...)
			a.Nodes = append(a.Nodes, model.Node{})
			copy(a.Nodes[i+1:], a.Nodes[i:])
			a.Nodes[i] = n
			a.Selected = i
			a.Checkpoint()
			a.Schedule()
		})
		list.Call("append", row)
	}
}
func (a *App) editPath(action string) {
	n := a.selected()
	if n == nil {
		return
	}
	p := model.ShapePath{Points: n.Points, Paths: n.Paths}
	switch action {
	case "insert":
		a.PathPoint = model.InsertPoint(&p, a.PathIndex, a.PathPoint)
	case "delete":
		if a.PathPoint >= 0 {
			model.RemovePoint(&p, a.PathPoint)
			a.PathPoint = -1
		}
	case "remove":
		model.RemovePath(&p, a.PathIndex)
		a.PathIndex = 0
		a.PathPoint = -1
	}
	n.Points, n.Paths = p.Points, p.Paths
	a.Checkpoint()
	a.Schedule()
	a.drawOverlay()
}

var _ = url.Values{}

func (a *App) saveWorldPreset() {
	worlds := map[string]any{}
	_ = json.Unmarshal([]byte(localGet("nanolathe-map-editor-worlds")), &worlds)
	id := a.Query.Get("world")
	if id == "" {
		id = a.World()
	}
	record, _ := worlds[id].(map[string]any)
	if record == nil {
		record = map[string]any{"base": a.World(), "name": str(a.Config, "biome", a.World())}
	}
	colors := map[string]any{}
	for k, v := range a.Colors {
		switch c := v.(type) {
		case []float64:
			if len(c) >= 3 {
				colors[k] = fmt.Sprintf("#%02x%02x%02x", int(math.Round(c[0]*255)), int(math.Round(c[1]*255)), int(math.Round(c[2]*255)))
			}
		case []any:
			if len(c) >= 3 {
				r, _ := c[0].(float64)
				g, _ := c[1].(float64)
				b, _ := c[2].(float64)
				colors[k] = fmt.Sprintf("#%02x%02x%02x", int(math.Round(r*255)), int(math.Round(g*255)), int(math.Round(b*255)))
			}
		case string:
			colors[k] = c
		case nil:
			colors[k] = nil
		}
	}
	record["knobs"] = clone(a.Knobs)
	record["colors"] = colors
	worlds[id] = record
	b, _ := json.Marshal(worlds)
	if err := localSet("nanolathe-map-editor-worlds", string(b)); err != nil {
		showError(err)
	}
}
