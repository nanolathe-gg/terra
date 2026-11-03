//go:build js && wasm

package editor

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
	"syscall/js"
	"time"

	"github.com/nanolathe-gg/terraform/internal/model"
)

//go:embed ui-schema.json
var schemaJSON []byte

type Schema struct {
	Help       map[string]string                    `json:"HELP"`
	Shapes     [][]any                              `json:"SHAPE_FIELDS"`
	Knobs      [][]any                              `json:"KNOBS"`
	Presets    map[string]map[string]map[string]any `json:"TOOL_PRESETS"`
	Fields     map[string][]any                     `json:"TOOL_FIELDS"`
	GroupNames map[string]string                    `json:"WORLD_GROUP_NAMES"`
	Choices    map[string][][]any                   `json:"WORLD_CHOICES"`
	Primary    []string                             `json:"WORLD_PRIMARY_CONTROLS"`
	Icons      map[string]string                    `json:"icons"`
	IconColors map[string]string                    `json:"iconColors"`
	Parked     []string                             `json:"PARKED_WORLD_CONTROLS"`
}
type App struct {
	Config                    map[string]any
	Nodes                     []model.Node
	MapData                   map[string]any
	Revision                  int
	Busy                      bool
	Schema                    Schema
	Query                     url.Values
	Knobs                     map[string]any
	Colors                    map[string]any
	Tool                      string
	Selected                  int
	Seed                      uint32
	RefinementSeed            uint32
	defaultColumn             any
	PathMode                  bool
	PathIndex, PathPoint      int
	AddPath                   bool
	ToolSettings              map[string]map[string]any
	Curve                     map[string]any
	Along                     []model.Knot
	landformPlace             float64
	history                   [][]byte
	historyIndex              int
	localKey                  string
	persistTimer              *time.Timer
	worker                    js.Value
	workerReady               bool
	rendering                 bool
	rerender                  bool
	requestID                 int
	activeID                  int
	output                    js.Value
	frame                     js.Value
	coarse                    []float32
	coarseWidth, coarseHeight int
	view                      viewState
	gesture                   *gesture
	space                     bool
	focused                   bool
	panels                    map[string]bool
	tiles                     map[string]*cachedTile
	scheduleTimer             *time.Timer
	rpc                       map[int]chan js.Value
	frameTimes                []float64
	strokeTimes               []float64
	cancelExport              func()
	featureUI                 *FeatureUI
}

type viewState struct {
	Scale, X, Y   float64
	Width, Height int
	Fit           bool
}

var current *App

func Run() {
	go func() {
		a := &App{Config: map[string]any{}, MapData: map[string]any{}, Knobs: map[string]any{}, Colors: map[string]any{}, Tool: "plateau", Selected: -1, Nodes: []model.Node{}, PathPoint: -1, Seed: 2701, RefinementSeed: 2701, ToolSettings: map[string]map[string]any{}, historyIndex: -1, landformPlace: .5, panels: map[string]bool{"tools": true, "inspector": true}}
		current = a
		if e := a.boot(); e != nil {
			showError(e)
			text("status", "The Go editor could not start.")
		}
	}()
}
func (a *App) boot() error {
	if err := json.Unmarshal(schemaJSON, &a.Schema); err != nil {
		return err
	}
	a.Query, _ = url.ParseQuery(strings.TrimPrefix(js.Global().Get("location").Get("search").String(), "?"))
	q := url.Values{}
	for _, k := range []string{"biome", "variant"} {
		if a.Query.Has(k) {
			q.Set(k, a.Query.Get(k))
		}
	}
	if err := request("/sculpt-config.json?"+q.Encode(), "GET", nil, &a.Config); err != nil {
		return err
	}
	var catalog map[string]any
	if err := request("/map-catalog.json", "GET", nil, &catalog); err != nil {
		return err
	}
	a.Config["exportCatalog"] = catalog
	world := obj(obj(catalog, "worlds"), a.World())
	sea := num(world, "defaultSeaLevel", 64)
	x, y := 4, 4
	if a.Query.Has("mapX") {
		x, _ = strconv.Atoi(a.Query.Get("mapX"))
	}
	if a.Query.Has("mapY") {
		y, _ = strconv.Atoi(a.Query.Get("mapY"))
	}
	if a.Query.Has("sea") {
		sea, _ = strconv.ParseFloat(a.Query.Get("sea"), 64)
	}
	if x < 1 || x > 40 || y < 1 || y > 40 || sea < 0 || sea > 255 || math.Trunc(sea) != sea {
		return fmt.Errorf("Map size must be 1–40 units per side; sea level must be an integer from 0–255.")
	}
	wc, hc := x*32+2, y*32+8
	w, h := wc*16, hc*16
	size := max(w, h) + 160
	a.Config["map"] = map[string]any{"unitsX": x, "unitsY": y, "widthCells": wc, "heightCells": hc, "width": w, "height": h, "playRight": x * 512, "playBottom": y * 512}
	a.Config["size"] = size
	a.Config["grid"] = size / 2
	a.Config["worldSize"] = size
	a.Config["worldGrid"] = size / 2
	if budget, e := strconv.Atoi(a.Query.Get("gpuMB")); e == nil && budget >= 128 && budget <= 8192 {
		a.Config["gpuBudgetBytes"] = budget * 1024 * 1024
	}
	a.Config["baseHeight"] = num(a.Config, "baseHeight", 32) + sea - num(a.Config, "seaLevel", 0)
	a.Config["seaLevel"] = sea
	if id := a.Query.Get("world"); true {
		if id == "" {
			id = a.World()
		}
		var presets map[string]map[string]any
		if json.Unmarshal([]byte(localGet("nanolathe-map-editor-worlds")), &presets) == nil {
			if preset := presets[id]; str(preset, "base", "") == a.World() {
				for k, v := range obj(preset, "knobs") {
					obj(a.Config, "defaults")[k] = v
				}
				for key, v := range obj(preset, "colors") {
					if hex, ok := v.(string); ok && len(hex) == 7 && hex[0] == '#' {
						if n, e := strconv.ParseUint(hex[1:], 16, 32); e == nil {
							a.Colors[key] = []float64{float64(n>>16) / 255, float64((n>>8)&255) / 255, float64(n&255) / 255}
						}
					} else {
						a.Colors[key] = clone(v)
					}
				}
			}
		}
	}
	for k, v := range obj(a.Config, "defaults") {
		a.Knobs[k] = v
	}
	for k, v := range obj(a.Config, "engineDefaults") {
		a.Knobs[k] = v
	}
	for k, v := range a.Query {
		if _, ok := a.Knobs[k]; ok && len(v) > 0 {
			if n, e := strconv.ParseFloat(v[0], 64); e == nil {
				a.Knobs[k] = n
			} else {
				a.Knobs[k] = v[0]
			}
		}
	}
	a.localKey = fmt.Sprintf("nanolathe-terrain-sculpt-v3-%s-map-%dx%d-sea-%g", a.World(), x, y, sea)
	if variant := str(a.Config, "variant", ""); variant != "" {
		a.localKey += "-v-" + variant
	}
	if id := a.Query.Get("world"); id != "" {
		a.localKey += "-world-" + id
	}
	for _, item := range []struct {
		key, id  string
		fallback float64
	}{{"surfaceRelief", "relief", 1}, {"materialWeathering", "material-weathering", 0}, {"depositSpread", "deposit-spread", .65}, {"transitionDetail", "transition-detail", .65}, {"ringAmount", "mineral-ring", 0}, {"ringSpread", "ring-spread", .65}, {"ringVariation", "ring-variation", .7}} {
		v := num(obj(a.Config, "material"), item.key, item.fallback)
		if (item.key == "ringAmount" || item.key == "ringSpread" || item.key == "ringVariation") && a.Query.Has(item.key) {
			if x, e := strconv.ParseFloat(a.Query.Get(item.key), 64); e == nil {
				v = x
			}
		}
		setValue(item.id, math.Round(v*100))
	}

	setValue("scree", max(0, min(100, num(a.Knobs, "scree", 0))))
	a.defaultColumn = clone(a.Config["column"])
	a.mountLayout()
	a.mountControls()
	a.mountWorld()
	a.mountMap()
	a.mountCanvas()
	a.mountFiles()
	a.mountDebug()
	a.mountAudit()
	for kind := range a.Schema.Help {
		a.ToolSettings[kind] = a.toolDefaults(kind, a.World())
	}
	a.showTool(a.Tool)
	a.addGround()
	if !a.Query.Has("scratch") {
		if s := localGet(a.localKey); s != "" {
			if e := a.LoadSketch([]byte(s)); e != nil {
				showError(fmt.Errorf("Saved recipe retained: %w", e))
			}
		}
	}
	if token := a.Query.Get("pendingSketch"); token != "" {
		if pending, err := takePendingSketch(token); err != nil {
			showError(err)
		} else if pending != nil {
			if err = a.LoadSketch(pending); err != nil {
				showError(err)
			}
		}
		u := js.Global().Get("URL").New(js.Global().Get("location").Get("href"))
		u.Get("searchParams").Call("delete", "pendingSketch")
		js.Global().Get("history").Call("replaceState", js.Null(), "", u.Get("href"))
	}
	// Opening a canvas establishes undo history without writing autosave. In
	// particular, a rejected saved recipe must remain recoverable on disk.
	initial, e := json.Marshal(a.historyState())
	if e != nil {
		return e
	}
	a.history = [][]byte{initial}
	a.historyIndex = 0
	a.Update()
	a.Fit()
	a.startWorker()
	disabled("editor", false)
	disabled("world-editor", false)
	disabled("save", false)
	disabled("load", false)
	text("levels", fmt.Sprintf("Dry base %g · sea %g · heights %g…%g", num(a.Config, "baseHeight", 0), sea, sea-90, sea+300))
	query(".canvas-caption h2").Set("textContent", str(a.Config, "biome", "Terrain")+" terrain")
	text("status", "Starting the Go terrain worker…")
	return nil
}
func (a *App) World() string       { return str(a.Config, "biomeId", "green") }
func (a *App) Map() map[string]any { return obj(a.Config, "map") }
func (a *App) Width() float64      { return num(a.Map(), "width", 1024) }
func (a *App) Height() float64     { return num(a.Map(), "height", 1024) }
func (a *App) addGround() {
	if amount := num(a.Knobs, "undulation", 0); amount != 0 {
		a.Nodes = append(a.Nodes, model.Node{Kind: "ground", Seed: a.Seed ^ 0x9e37, Amplitude: amount, Wavelength: num(a.Knobs, "undulationScale", 200), Coverage: num(a.Knobs, "undulationCover", .45)})
	}
}
func (a *App) selected() *model.Node {
	if a.Selected < 0 || a.Selected >= len(a.Nodes) {
		return nil
	}
	return &a.Nodes[a.Selected]
}
func (a *App) params() map[string]any {
	p := map[string]any{"radius": number("diameter") / 2, "amount": number("amount"), "rough": number("roughness") / 100, "softness": number("softness") / 100, "bankWidth": number("bank-width") / 100, "beachFlatness": number("beach-flatness") / 100, "shelves": number("shelves") / 100, "cracks": number("cracks") / 100, "shallowMode": value("shallow-mode")}
	for _, f := range a.Schema.Shapes {
		p[f[0].(string)] = number(f[1].(string)) / f[7].(float64)
	}
	if a.Curve != nil {
		p["curve"] = clone(a.Curve)
	}
	if a.Along != nil {
		p["along"] = clone(a.Along)
	}
	return p
}
func (a *App) toolDefaults(kind, world string) map[string]any {
	d := map[string]any{"diameter": 200.0, "amount": 70.0, "roughness": 35.0, "softness": 50.0, "bankWidth": 50.0, "beachFlatness": 50.0, "shelves": 25.0, "shallowMode": "area", "preset": world, "cracks": 0.0}
	for _, f := range a.Schema.Shapes {
		d[f[0].(string)] = math.Max(f[4].(float64), math.Min(f[5].(float64), math.Floor(num(a.Knobs, f[0].(string), 0)*f[7].(float64)+.5)))
	}
	switch kind {
	case "offset":
		d["amount"] = 20.0
	case "fissure":
		d["amount"] = 12.0
	case "paint", "sand", "grass":
		d["amount"] = 100.0
	}
	if kind == "landform" {
		d["elevation"] = max(-80, min(300, math.Round(num(a.Config, "baseHeight", 24)+70)))
	}
	for k, v := range map[string]float64{"hill": 40, "mountain": 60, "plateau": 50, "crater": 30, "offset": 40, "landform": 40} {
		if k == kind {
			d["cracks"] = v
		}
	}
	for k, v := range a.Schema.Presets[world][kind] {
		d[k] = clone(v)
	}
	return d
}
func (a *App) rememberTool() {
	d := a.ToolSettings[a.Tool]
	if d == nil {
		d = map[string]any{}
	}
	for k, f := range a.Schema.Fields {
		d[k] = number(f[0].(string))
	}
	d["shallowMode"] = value("shallow-mode")
	d["curve"] = clone(a.Curve)
	d["along"] = clone(a.Along)
	a.ToolSettings[a.Tool] = d
}
func (a *App) showTool(kind string) {
	d := a.ToolSettings[kind]
	if d == nil {
		d = a.toolDefaults(kind, a.World())
	}
	for k, f := range a.Schema.Fields {
		if v, ok := d[k]; ok {
			setValue(f[0].(string), v)
		}
	}
	setValue("shallow-mode", str(d, "shallowMode", "area"))
	setValue("tool-style", str(d, "preset", a.World()))
	a.Curve = obj(d, "curve")
	a.Along = readCurveKnots(d["along"])
	a.Update()
}
func (a *App) Select(index int) {
	a.Selected = index
	a.PathPoint = -1
	a.PathIndex = 0
	a.AddPath = false
	if n := a.selected(); n != nil && len(n.Points) > 0 {
		a.Tool = "move"
		p := n.Params
		for k, id := range map[string]string{"radius": "diameter", "amount": "amount", "rough": "roughness", "softness": "softness", "bankWidth": "bank-width", "beachFlatness": "beach-flatness", "shelves": "shelves", "cracks": "cracks"} {
			scale := 100.0
			if k == "radius" {
				scale = 2
			} else if k == "amount" {
				scale = 1
			}
			setValue(id, num(p, k, 0)*scale)
		}
		for _, f := range a.Schema.Shapes {
			setValue(f[1].(string), num(p, f[0].(string), num(a.Knobs, f[0].(string), 0))*f[7].(float64))
		}
		a.Curve = obj(p, "curve")
		a.Along = readCurveKnots(p["along"])
		setValue("seed", n.Seed)
	}
	a.Update()
	a.drawOverlay()
}

var sketchControls = map[string]string{"bankWidth": "bank-width", "softness": "softness", "relief": "relief", "beachFlatness": "beach-flatness", "mineralRing": "mineral-ring", "ringSpread": "ring-spread", "ringVariation": "ring-variation", "materialWeathering": "material-weathering", "depositSpread": "deposit-spread", "transitionDetail": "transition-detail", "diameter": "diameter", "amount": "amount", "roughness": "roughness", "shelves": "shelves", "scree": "scree"}

func (a *App) Sketch() map[string]any {
	nodes := a.Nodes
	if nodes == nil {
		nodes = []model.Node{}
	}
	out := map[string]any{"format": "nanolathe-terrain-sculpt", "version": 6, "encoding": "stroke-graph", "nodes": nodes, "map": a.Map(), "mapData": a.MapData, "biome": a.World(), "variant": a.Config["variant"], "size": a.Config["size"], "grid": a.Config["grid"], "baseHeight": a.Config["baseHeight"], "seaLevel": a.Config["seaLevel"], "seed": a.Seed, "refinementSeed": a.RefinementSeed, "varySeed": checked("seed-vary"), "tool": a.Tool, "toolSettings": a.ToolSettings, "knobs": a.Knobs, "colors": a.Colors, "column": a.Config["column"], "weather": checked("weather"), "weatheredView": checked("weathered-view"), "clay": checked("clay"), "light": value("light"), "shallowMode": value("shallow-mode"), "curve": a.Curve}
	for key, id := range sketchControls {
		out[key] = number(id)
	}
	return out
}
func (a *App) LoadSketch(data []byte) error {
	var s map[string]any
	if e := json.Unmarshal(data, &s); e != nil {
		return e
	}
	if str(s, "format", "") != "nanolathe-terrain-sculpt" || !inVersion(num(s, "version", 0)) {
		return fmt.Errorf("Load a map stroke graph.")
	}
	if num(s, "size", 0) != num(a.Config, "size", 0) || num(s, "grid", 0) != num(a.Config, "grid", 0) || str(s, "biome", a.World()) != a.World() {
		return fmt.Errorf("This recipe uses another world or map size. Open its world and dimensions first.")
	}
	if _, ok := s["nodes"].([]any); !ok {
		return fmt.Errorf("The recipe must contain a stroke graph.")
	}
	b, _ := json.Marshal(s["nodes"])
	var nodes []model.Node
	if e := json.Unmarshal(b, &nodes); e != nil {
		return e
	}
	if e := validateRecipeCurves(s, nodes); e != nil {
		return e
	}
	for _, n := range nodes {
		if n.Kind == "" || n.Kind == "raster" {
			return fmt.Errorf("The recipe contains an unsupported stroke.")
		}
		if len(n.Points) > 0 {
			p := model.ShapePath{Points: n.Points, Paths: n.Paths}
			if e := model.ValidatePaths(&p); e != nil {
				return e
			}
		}
	}
	column := a.defaultColumn
	if c, ok := s["column"]; ok && c != nil {
		column = c
	}
	if e := model.ValidateColumn(s["column"], a.defaultColumn); e != nil {
		return e
	}
	nextMap := obj(s, "mapData")
	if a.featureUI != nil && a.featureUI.store != nil {
		prior := a.MapData
		test := *a.featureUI
		a.MapData = nextMap
		e := test.load()
		a.MapData = prior
		if e != nil {
			return e
		}
	}
	// Only replace the current document after all validation succeeds.
	a.Nodes = nodes
	a.MapData = nextMap
	a.Config["column"] = clone(column)
	a.Seed = uint32(math.Max(0, math.Min(math.MaxUint32, num(s, "seed", 2701))))
	a.RefinementSeed = uint32(math.Max(0, math.Min(math.MaxUint32, num(s, "refinementSeed", float64(a.Seed)))))
	setValue("seed", a.Seed)
	if v, ok := s["knobs"].(map[string]any); ok {
		a.Knobs = clone(v)
	}
	if v, ok := s["colors"].(map[string]any); ok {
		a.Colors = clone(v)
	} else {
		a.Colors = map[string]any{}
	}
	if v, ok := s["tool"].(string); ok {
		if _, known := a.Schema.Help[v]; known || v == "move" {
			a.Tool = v
		}
	}
	if raw, ok := s["toolSettings"].(map[string]any); ok {
		for kind, item := range raw {
			if v, ok := item.(map[string]any); ok {
				a.ToolSettings[kind] = clone(v)
			}
		}
	}
	a.showTool(a.Tool)
	for key, id := range sketchControls {
		if v, ok := s[key].(float64); ok && !math.IsNaN(v) && !math.IsInf(v, 0) {
			setValue(id, v)
		}
	}
	if v, ok := s["shallowMode"].(string); ok {
		setValue("shallow-mode", v)
	}
	if v, ok := s["light"].(string); ok {
		setValue("light", v)
	}
	for key, id := range map[string]string{"varySeed": "seed-vary", "weather": "weather", "weatheredView": "weathered-view", "clay": "clay"} {
		if v, ok := s[key].(bool); ok {
			element(id).Set("checked", v)
		}
	}
	if v, ok := s["curve"].(map[string]any); ok {
		a.Curve = clone(v)
	}
	a.Selected = -1
	a.PathPoint = -1
	a.PathIndex = 0
	a.AddPath = false
	a.restoreMapMetadata()
	a.Update()
	a.Schedule()
	return nil
}
func inVersion(v float64) bool { return v == 4 || v == 5 || v == 6 }

// History contains editable document data. Brush settings, view options, and
// world controls are preferences and must survive undoing a stroke.
type historyState struct {
	Nodes          []model.Node   `json:"nodes"`
	RefinementSeed uint32         `json:"refinementSeed"`
	MapData        map[string]any `json:"mapData"`
	Column         any            `json:"column"`
}

func (a *App) historyState() historyState {
	return historyState{a.Nodes, a.RefinementSeed, a.MapData, a.Config["column"]}
}
func (a *App) Checkpoint() {
	b, e := json.Marshal(a.historyState())
	if e != nil {
		showError(e)
		return
	}
	if a.historyIndex >= 0 && string(a.history[a.historyIndex]) == string(b) {
		a.persist()
		return
	}
	a.history = append(a.history[:a.historyIndex+1], b)
	if len(a.history) > 48 {
		a.history = a.history[len(a.history)-48:]
	}
	a.historyIndex = len(a.history) - 1
	a.Revision++
	a.Update()
	a.persist()
}
func (a *App) Undo(delta int) {
	i := a.historyIndex + delta
	if i < 0 || i >= len(a.history) || a.gesture != nil || a.Busy {
		return
	}
	var state historyState
	if e := json.Unmarshal(a.history[i], &state); e != nil {
		showError(e)
		return
	}
	a.Nodes = state.Nodes
	a.RefinementSeed = state.RefinementSeed
	a.MapData = state.MapData
	a.Config["column"] = state.Column
	a.Selected = -1
	a.PathPoint = -1
	a.PathIndex = 0
	a.AddPath = false
	a.restoreMapMetadata()
	a.historyIndex = i
	a.Revision++
	a.Update()
	a.Schedule()
	a.persist()
}
func (a *App) persist() {
	if a.Query.Has("scratch") {
		text("save-state", "Comparison sketch · use Save to keep it.")
		return
	}
	if a.persistTimer != nil {
		a.persistTimer.Stop()
	}
	a.persistTimer = time.AfterFunc(450*time.Millisecond, func() {
		if a.gesture != nil || a.Busy {
			a.persist()
			return
		}
		b, _ := json.Marshal(a.Sketch())
		if e := localSet(a.localKey, string(b)); e != nil {
			text("save-state", "Local autosave unavailable. Use Save to keep this recipe.")
		} else {
			text("save-state", "Terrain recipe autosaved locally.")
		}
	})
}
func (a *App) Change() {
	a.Revision++
	a.Schedule()
	if a.gesture == nil {
		a.Update()
	} else {
		a.drawOverlay()
	}
}
func (a *App) Sample(x, y float64) float64 {
	var best *cachedTile
	for _, t := range a.tiles {
		if len(t.Heights) == 0 || t.HeightSpacing <= 0 {
			continue
		}
		gx, gy := (x-t.HeightOriginX)/t.HeightSpacing, (y-t.HeightOriginY)/t.HeightSpacing
		if gx < 0 || gy < 0 || gx > float64(t.HeightWidth-1) || gy > float64(t.HeightHeight-1) {
			continue
		}
		if best == nil || t.Revision > best.Revision || t.Revision == best.Revision && t.HeightSpacing < best.HeightSpacing {
			best = t
		}
	}
	if best == nil {
		return num(a.Config, "baseHeight", 0)
	}
	t := best
	fx, fy := (x-t.HeightOriginX)/t.HeightSpacing, (y-t.HeightOriginY)/t.HeightSpacing
	ix, iy := int(fx), int(fy)
	jx, jy := min(ix+1, t.HeightWidth-1), min(iy+1, t.HeightHeight-1)
	sx, sy := fx-float64(ix), fy-float64(iy)
	at := func(x, y int) float64 { return float64(t.Heights[y*t.HeightWidth+x]) }
	return (at(ix, iy)*(1-sx)+at(jx, iy)*sx)*(1-sy) + (at(ix, jy)*(1-sx)+at(jx, jy)*sx)*sy
}
func (a *App) Update() {
	disabled("undo", a.historyIndex <= 0 || a.gesture != nil)
	disabled("redo", a.historyIndex >= len(a.history)-1 || a.gesture != nil)
	selected := a.selected()
	kind := a.Tool
	if kind == "move" && selected != nil {
		kind = selected.Kind
	}
	each("[data-tool]", func(v js.Value) { attribute(v, "aria-pressed", v.Get("dataset").Get("tool").String() == a.Tool) })
	hidden("selection-panel", a.Tool != "move")
	hidden("selection-empty", selected != nil)
	hidden("brush-panel", a.Tool == "move" && (selected == nil || selected.Params == nil))
	hidden("selection-hud", selected == nil || a.Tool != "move")
	hidden("path-actions", !a.PathMode || selected == nil)
	hidden("transform-controls", a.PathMode || selected == nil)
	attribute(element("edit-path"), "aria-pressed", a.PathMode)
	attribute(element("transform-mode"), "aria-pressed", !a.PathMode)
	attribute(element("draw-add"), "aria-pressed", a.AddPath)
	for _, id := range []string{"selection-clear", "selection-delete", "path-add", "path-delete", "path-extend", "path-remove", "draw-add", "node-up", "node-down", "node-seed", "node-hide", "node-delete"} {
		disabled(id, selected == nil)
	}
	if selected != nil {
		if v, _, e := model.SelectionTransform(*selected, nil); e == nil {
			for k, n := range map[string]float64{"x": v.X, "y": v.Y, "rotation": v.Rotation, "scale": v.Scale} {
				if !element("selection-" + k).Equal(document.Get("activeElement")) {
					setValue("selection-"+k, math.Round(n*10)/10)
				}
			}
		}
		text("selection-mode", fmt.Sprintf("%s · %s #%d", map[bool]string{true: "Edit paths", false: "Transform"}[a.PathMode], selected.Kind, a.Selected+1))
	}
	text("tool-help", a.Schema.Help[kind])
	text("brush-title", strings.Title(kind))
	hidden("amount-control", contains([]string{"deep", "shallow", "ramp", "erase", "landform"}, kind))
	hidden("roughness-control", kind == "fissure" || kind == "landform")
	hidden("shelves-control", kind != "deep")
	hidden("shallow-mode-control", kind != "shallow")
	hidden("bank-control", !contains([]string{"deep", "shallow"}, kind))
	hidden("beach-control", !contains([]string{"deep", "shallow"}, kind))
	hidden("cracks-control", !contains([]string{"plateau", "hill", "mountain", "crater", "offset", "landform"}, kind))
	for _, id := range []string{"diameter", "amount", "roughness", "softness", "cracks", "shelves", "relief", "ring-spread", "ring-variation", "material-weathering", "deposit-spread", "transition-detail"} {
		text(id+"-value", value(id))
	}
	text("bank-value", value("bank-width")+"%")
	text("beach-value", value("beach-flatness")+"%")
	shapeOptions := a.params()
	shapeOptions["world"] = a.worldValues()
	for _, f := range a.Schema.Shapes {
		k, id := f[0].(string), f[1].(string)
		kinds := f[3].([]any)
		visible := false
		for _, v := range kinds {
			if v == kind {
				visible = true
			}
		}
		hidden(id+"-control", !visible || !a.shapeVisible(k, kind, shapeOptions))
		text(id+"-value", value(id))
		_ = k
	}
	a.decorateTools()
	a.renderLayers()
	a.updateToolGroups()
	a.syncWorld()
	a.drawCurve()
	if a.featureUI != nil {
		a.featureUI.Update()
	}
}
func contains(a []string, s string) bool {
	for _, v := range a {
		if v == s {
			return true
		}
	}
	return false
}

// Recipes can exceed localStorage limits, so cross-world loads use the same
// one-use Cache API handoff as the editor's original browser implementation.
func takePendingSketch(token string) ([]byte, error) {
	if token == "" {
		return nil, nil
	}
	cache, e := await(js.Global().Get("caches").Call("open", "nanolathe-sketch-handoff"))
	if e != nil {
		return nil, e
	}
	path := "/pending-sketch-" + url.QueryEscape(token) + ".json"
	r, e := await(cache.Call("match", path))
	if e != nil || !exists(r) {
		return nil, e
	}
	v, e := await(r.Call("text"))
	if e != nil {
		return nil, e
	}
	var envelope struct {
		Format, Token string
		Sketch        json.RawMessage
	}
	if e = json.Unmarshal([]byte(v.String()), &envelope); e != nil {
		return nil, e
	}
	if envelope.Format != "nanolathe-sketch-handoff" || envelope.Token != token {
		return nil, fmt.Errorf("Invalid pending terrain recipe.")
	}
	_, e = await(cache.Call("delete", path))
	if e != nil {
		return nil, e
	}
	return envelope.Sketch, nil
}
func (a *App) loadSketchFile(data []byte, documentID string) (bool, error) {
	var s map[string]any
	if e := json.Unmarshal(data, &s); e != nil {
		return false, e
	}
	if str(s, "format", "") != "nanolathe-terrain-sculpt" || !inVersion(num(s, "version", 0)) {
		return false, fmt.Errorf("Load a map stroke graph.")
	}
	if _, ok := s["nodes"].([]any); !ok {
		return false, fmt.Errorf("The recipe must contain a stroke graph.")
	}
	world := str(s, "biome", a.World())
	variant := str(s, "variant", "")
	m := obj(s, "map")
	same := world == a.World() && variant == str(a.Config, "variant", "") && num(s, "size", 0) == num(a.Config, "size", 0) && num(s, "grid", 0) == num(a.Config, "grid", 0) && num(m, "unitsX", 0) == num(a.Map(), "unitsX", 0) && num(m, "unitsY", 0) == num(a.Map(), "unitsY", 0) && num(s, "seaLevel", 0) == num(a.Config, "seaLevel", 0)
	if same {
		return true, a.LoadSketch(data)
	}
	var config map[string]any
	if e := request("/sculpt-config.json?biome="+url.QueryEscape(world), "GET", nil, &config); e != nil || str(config, "biomeId", "") != world {
		return false, fmt.Errorf("The saved terrain belongs to the %s world, which this server does not have. The current terrain was left as it was.", world)
	}
	if variant != "" {
		if _, ok := obj(config, "variants")[variant]; !ok {
			return false, fmt.Errorf("The saved column variant is unavailable.")
		}
	}
	if len(m) == 0 {
		return false, fmt.Errorf("The saved recipe has no map dimensions.")
	}
	for _, k := range []string{"unitsX", "unitsY"} {
		v := num(m, k, 0)
		if v < 1 || v > 40 || math.Trunc(v) != v {
			return false, fmt.Errorf("The saved recipe has invalid map dimensions.")
		}
	}
	sea := num(s, "seaLevel", -1)
	if sea < 0 || sea > 255 || math.Trunc(sea) != sea {
		return false, fmt.Errorf("The saved recipe has an invalid sea level.")
	}
	if e := validatePortableRecipe(s, config); e != nil {
		return false, e
	}
	cache, e := await(js.Global().Get("caches").Call("open", "nanolathe-sketch-handoff"))
	if e != nil {
		return false, e
	}
	token := fmt.Sprintf("%x%x", randomSeed(), time.Now().UnixMilli())
	path := "/pending-sketch-" + url.QueryEscape(token) + ".json"
	envelope := map[string]any{"format": "nanolathe-sketch-handoff", "token": token, "sketch": s}
	body, e := json.Marshal(envelope)
	if e != nil {
		return false, e
	}
	response := js.Global().Get("Response").New(string(body), js.ValueOf(map[string]any{"headers": map[string]any{"Content-Type": "application/json"}}))
	if _, e = await(cache.Call("put", path, response)); e != nil {
		return false, fmt.Errorf("The saved terrain could not be carried to %s: %w", world, e)
	}
	u := js.Global().Get("URL").New(js.Global().Get("location").Get("href"))
	q := u.Get("searchParams")
	q.Call("set", "biome", world)
	q.Call("set", "pendingSketch", token)
	q.Call("set", "mapX", fmt.Sprint(num(m, "unitsX", 0)))
	q.Call("set", "mapY", fmt.Sprint(num(m, "unitsY", 0)))
	q.Call("set", "sea", fmt.Sprint(sea))
	if variant != "" {
		q.Call("set", "variant", variant)
	} else {
		q.Call("delete", "variant")
	}
	if documentID != "" {
		q.Call("set", "document", documentID)
	} else {
		q.Call("delete", "document")
	}
	q.Call("delete", "scratch")
	js.Global().Get("location").Set("href", u.Get("href"))
	return false, nil
}

func validateRecipeCurves(s map[string]any, nodes []model.Node) error {
	for _, n := range nodes {
		if err := model.ValidateNodeCurves(n); err != nil {
			return err
		}
	}
	if err := model.ValidateNodeCurves(model.Node{Params: map[string]any{"curve": s["curve"], "along": s["along"]}}); err != nil {
		return err
	}
	for _, raw := range obj(s, "toolSettings") {
		if params, ok := raw.(map[string]any); ok {
			if err := model.ValidateNodeCurves(model.Node{Params: params}); err != nil {
				return err
			}
		}
	}
	return nil
}

func validatePortableRecipe(s, config map[string]any) error {
	raw, e := json.Marshal(s["nodes"])
	if e != nil {
		return e
	}
	var nodes []model.Node
	if e = json.Unmarshal(raw, &nodes); e != nil {
		return e
	}
	if e := validateRecipeCurves(s, nodes); e != nil {
		return e
	}
	for _, n := range nodes {
		if n.Kind == "" || n.Kind == "raster" {
			return fmt.Errorf("The recipe contains an unsupported stroke.")
		}
		if len(n.Points) > 0 {
			p := model.ShapePath{Points: n.Points, Paths: n.Paths}
			if e = model.ValidatePaths(&p); e != nil {
				return e
			}
		}
	}
	column := s["column"]
	if column == nil {
		column = config["column"]
	}
	if e := model.ValidateColumn(s["column"], config["column"]); e != nil {
		return e
	}
	_ = column
	var catalog struct {
		Features []model.FeatureDefinition `json:"features"`
		Deposit  string                    `json:"depositName"`
	}
	world := str(s, "biome", str(config, "biomeId", ""))
	if e = request("/map-features/"+url.PathEscape(world)+"/catalog.json", "GET", nil, &catalog); e != nil {
		return e
	}
	m := obj(s, "map")
	store := model.NewPlacementStore(int(num(m, "unitsX", 0)*32), int(num(m, "unitsY", 0)*32), catalog.Features, catalog.Deposit)
	var placements struct {
		Features []model.FeaturePlacement `json:"features"`
		Starts   []model.FeaturePoint     `json:"starts"`
	}
	raw, e = json.Marshal(s["mapData"])
	if e != nil {
		return e
	}
	if string(raw) == "null" {
		return nil
	}
	if e = json.Unmarshal(raw, &placements); e != nil {
		return e
	}
	for _, p := range placements.Features {
		if _, e = store.Add(p.Name, p.X, p.Z); e != nil {
			return fmt.Errorf("Feature %s: %w", p.Name, e)
		}
	}
	if placements.Starts != nil {
		if len(placements.Starts) < 1 || len(placements.Starts) > 10 {
			return fmt.Errorf("Map placements need 1–10 starts.")
		}
		store.Starts = nil
		for _, p := range placements.Starts {
			if math.Trunc(p.X) != p.X || math.Trunc(p.Z) != p.Z {
				return fmt.Errorf("Every start must be a distinct pixel position inside the play area.")
			}
			if _, e = store.AddStart(p); e != nil {
				return e
			}
		}
	}
	return nil
}

// mergedColors overlays persistent choices on the selected world's variant;
// an explicit null clears a variant color without erasing its preset.
func (a *App) mergedColors() map[string]any {
	out := map[string]any{}
	for key, v := range obj(a.Config, "colors") {
		if hex, ok := v.(string); ok && len(hex) == 7 && hex[0] == '#' {
			if n, e := strconv.ParseUint(hex[1:], 16, 32); e == nil {
				out[key] = []float64{float64(n>>16) / 255, float64((n>>8)&255) / 255, float64(n&255) / 255}
			}
		}
	}
	for key, v := range a.Colors {
		if v == nil {
			delete(out, key)
		} else {
			out[key] = clone(v)
		}
	}
	for k, v := range model.ColumnColorOverrides(a.Config["column"], a.defaultColumn) {
		out[k] = v
	}
	return out
}
