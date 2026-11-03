//go:build js && wasm

package editor

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"syscall/js"

	"github.com/nanolathe-gg/terraform/internal/model"
)

func (a *App) decorateTools() {
	each("[data-tool],#feature-tool", func(b js.Value) {
		if b.Get("dataset").Get("decorated").String() == "1" {
			return
		}
		kind := b.Get("dataset").Get("tool").String()
		if b.Get("id").String() == "feature-tool" {
			kind = "features"
		}
		path := a.Schema.Icons[kind]
		if path == "" {
			return
		}
		label := b.Get("textContent").String()
		attribute(b, "aria-label", label)
		b.Set("title", label)
		b.Get("style").Call("setProperty", "--tool-color", a.Schema.IconColors[kind])
		b.Set("innerHTML", `<svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="`+path+`"/></svg>`)
		b.Call("append", create("span", "tool-label", label))
		b.Get("dataset").Set("decorated", "1")
	})
}
func (a *App) finishLayout() {
	first := query(".tool-groups .tool-group")
	if exists(first) {
		buttons := first.Call("querySelector", ".tools")
		buttons.Get("classList").Call("add", "primary-tools")
		first.Call("replaceWith", buttons)
	}
	a.decorateTools()
	element("world-colors").Call("closest", "details").Set("open", false)
	element("world-name").Get("classList").Call("add", "sr-only")
	query("#world-editor > .scope").Set("hidden", true)
	query("#world-editor > .eyebrow").Set("textContent", "Materials & processes · whole map")
	element("variant-control").Call("querySelector", "p").Set("hidden", true)
	presets := create("details", "panel", "")
	presets.Call("append", create("summary", "", "Manage presets"))
	for _, id := range []string{"world-new-name", "world-export", "world-delete"} {
		presets.Call("append", element(id).Call("closest", ".row"))
	}
	element("world-file").Call("before", presets)
	surface := create("details", "panel", "")
	surface.Call("append", create("summary", "", "Surface detail"))
	for _, id := range []string{"relief", "transition-detail"} {
		surface.Call("append", element(id).Call("closest", ".control"))
	}
	surface.Call("append", element("ring-controls"))
	layers, _ := a.Config["layers"].([]any)
	has := func(name string) bool {
		for _, v := range layers {
			if v == name {
				return true
			}
		}
		return false
	}
	hidden("transition-detail-control", !has("body"))
	hidden("ring-controls", !has("ring"))
	element("knobs").Call("before", surface)
	panel := create("section", "section files", "")
	panel.Set("innerHTML", `<h3>Memory budgets</h3><label class="control">Terrain GPU budget (MiB)<input id="gpu-budget" data-gpu type="number" min="128" max="4096" step="128" value="512"></label><label class="control">Page heap budget (MiB)<input id="heap-budget" data-heap type="number" min="128" max="8192" step="128" value="1024"></label><p id="memory-status" class="small" data-memory></p>`)
	element("graphics-host").Call("append", panel)
	for key, id := range map[string]string{"gpuMB": "gpu-budget", "heapMB": "heap-budget"} {
		if v := a.Query.Get(key); v != "" {
			setValue(id, v)
		}
		on(element(id), "change", func(js.Value) { a.applyMemoryBudgets(); a.trimTiles(); a.Revision++; a.Schedule() })
	}
	a.applyMemoryBudgets()
	// Match the inspector's existing pipeline groups without duplicating settings.
	stages := map[string]js.Value{}
	each("#knobs > .knobs-group", func(g js.Value) {
		name := g.Get("dataset").Get("group").String()
		category := "Relief & rock"
		if strings.Contains(name, "Ground") {
			category = "Ground & variation"
		} else if strings.Contains(name, "Water") || strings.Contains(name, "Shore") || strings.Contains(name, "Needle") || strings.Contains(name, "Contour fringe") {
			category = "Water & shores"
		} else if strings.Contains(name, "Light") || strings.Contains(name, "Shine") {
			category = "Lighting & finish"
		} else {
			for _, word := range []string{"Boulders", "Debris", "Sand", "Material coverage", "Cap", "Surface pits", "Cups", "Mineral"} {
				if strings.Contains(name, word) {
					category = "Materials & surface"
				}
			}
		}
		stage := stages[category]
		if !exists(stage) {
			stage = create("details", "pipeline-group", "")
			stage.Call("append", create("summary", "", category))
			element("knobs").Call("append", stage)
			stages[category] = stage
		}
		stage.Call("append", g)
	})
}
func (a *App) worldValues() map[string]any {
	// Requirement checks only add derived top-level values. Copy the map once;
	// serializing every nested value per panel row stalls pointer-down.
	v := make(map[string]any, len(a.Knobs)+12)
	for key, value := range a.Knobs {
		v[key] = value
	}
	layers, _ := a.Config["layers"].([]any)
	for _, pair := range [][2]string{{"ring", "ringLayer"}, {"beach", "beachLayer"}} {
		v[pair[1]] = 0.0
		for _, layer := range layers {
			if layer == pair[0] {
				v[pair[1]] = 1.0
			}
		}
	}
	v["column"] = 0.0
	v["capBed"] = 0.0
	column := a.Config["column"]
	if column != nil {
		v["column"] = 1.0
		var c model.Column
		b, _ := json.Marshal(column)
		if json.Unmarshal(b, &c) == nil {
			if cap, e := model.ColumnHasCapBed(&c, str(a.Config, "variant", "")); e == nil && cap {
				v["capBed"] = 1.0
			}
		}
	}
	v["groundTiled"] = 0.0
	pattern := str(a.Knobs, "groundPattern", "")
	if pattern == "" {
		pattern = a.World()
	}
	if _, ok := obj(a.Config, "groundPatterns")[pattern]; ok {
		v["groundTiled"] = 1.0
	}
	v["slopeReplaced"] = 0.0
	material := obj(a.Config, "material")
	transition := str(a.Knobs, "transition", str(obj(a.Config, "engineDefaults"), "transition", a.Query.Get("transition")))
	deposits := str(a.Knobs, "deposits", a.Query.Get("deposits"))
	margins := str(a.Knobs, "margins", a.Query.Get("margins"))
	body := false
	for _, layer := range layers {
		if layer == "body" {
			body = true
		}
	}
	if body && material["groundFringe"] == true && checked("weather") && num(a.Knobs, "erosion", 0) > 0 && deposits != "off" && transition == "mineral" && margins != "slope" && number("material-weathering") >= 100 {
		v["slopeReplaced"] = 1.0
	}
	v["slopeSand"] = 0.0
	if b, ok := obj(a.Config, "material")["slopeSand"].(bool); ok && b {
		v["slopeSand"] = 1.0
	}
	water := obj(a.Config, "water")
	tones := 2.0
	if water["midRGB"] != nil && num(obj(a.Config, "material"), "midDepth", 0) != 0 {
		tones = 3
	} else if fmt.Sprint(water["shallow"]) == fmt.Sprint(water["deep"]) && fmt.Sprint(water["shallowRGB"]) == fmt.Sprint(water["deepRGB"]) {
		tones = 1
	}
	v["waterColored"] = 0.0
	colors := a.mergedColors()
	if colors["shallow"] != nil || colors["deep"] != nil {
		tones = 2
		v["waterColored"] = 1.0
	}
	v["waterTones"] = tones
	v["rampWater"] = 1.0
	if num(v, "deepEdge", 0) > 0 {
		v["rampWater"] = 0.0
	}
	for _, n := range a.Nodes {
		if n.Kind != "deep" && n.Kind != "shallow" {
			continue
		}
		switch int(num(n.Params, "waterDeep", 0)) {
		case 1:
			v["deepEdge"] = 1.0
		case 2:
			v["rampWater"] = 1.0
		}
		switch int(num(n.Params, "waterBed", 0)) {
		case 1:
			v["bedLit"] = 1.0
		case 3:
			v["bedLit"] = 1.0
			v["crackedBed"] = 1.0
		}
	}
	return v
}
func (a *App) shapeVisible(key, kind string, p map[string]any) bool {
	if !model.ShapeControlAvailable(key, kind, p) {
		return false
	}
	gate := map[string]string{"layerPx": "shoreLayers", "layerRiser": "shoreLayers", "layerLedge": "shoreLayers", "layerRough": "shoreLayers", "layerStyle": "shoreLayers", "layerVary": "shoreLayers", "layerCircle": "shoreLayers", "iceFacetSize": "iceFacets", "fingerSize": "fingers", "spurLength": "spurCount", "spurSpread": "spurCount", "spurWidth": "spurCount", "spurTaper": "spurCount", "spurHeight": "spurCount", "spurForks": "spurCount", "spurBulb": "spurCount", "rimUnequal": "rimSectors", "rimGapWidth": "rimGaps", "fissureBranchLen": "fissureBranches", "fissureBranchSpread": "fissureBranches", "lavaSpread": "shoreLayers", "lavaCircleVary": "shoreLayers", "maskAmount": "maskChannel"}
	if kind == "crater" && (key == "crestJag" || key == "crestVary") {
		gate[key] = "spurCount"
	}
	if parent := gate[key]; parent != "" && num(p, parent, 0) <= 0 {
		return false
	}
	if kind == "fissure" {
		network := num(p, "fissureNetwork", 0) >= .5
		if network && contains([]string{"fissureBranches", "fissureBranchLen", "fissureBranchSpread", "fissureTaper"}, key) || !network && key == "fissureCell" {
			return false
		}
	}
	return true
}

// applyMemoryBudgets snapshots both existing controls into every worker job's
// Config. Updating a budget does not change terrain resolution or shader math.
func (a *App) applyMemoryBudgets() {
	for _, item := range []struct {
		id, key       string
		fallback, max int
	}{
		{"gpu-budget", "gpuBudgetBytes", 512, 4096}, {"heap-budget", "heapBudgetBytes", 1024, 8192},
	} {
		n := number(item.id)
		if math.IsNaN(n) || math.IsInf(n, 0) {
			n = float64(item.fallback)
		}
		n = math.Max(128, math.Min(float64(item.max), math.Round(n)))
		setValue(item.id, fmt.Sprint(int(n)))
		a.Config[item.key] = int(n) * 1024 * 1024
	}
	text("memory-status", fmt.Sprintf("GPU %d MiB · page data %d MiB", int(number("gpu-budget")), int(number("heap-budget"))))
}
