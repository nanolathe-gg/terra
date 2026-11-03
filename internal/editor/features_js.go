//go:build js && wasm

package editor

import (
	"encoding/json"
	"fmt"
	"github.com/nanolathe-gg/terraform/internal/model"
	"math"
	"strings"
	"syscall/js"
)

type featureSprite struct {
	URL                             string `json:"url"`
	Width, Height, XOffset, YOffset int
}
type featureCatalogEntry struct {
	model.FeatureDefinition
	Sprite *featureSprite `json:"sprite"`
}
type FeatureUI struct {
	a                                *App
	store                            *model.PlacementStore
	defs                             []model.FeatureDefinition
	sprites                          map[string]*featureSprite
	images                           map[string]js.Value
	root                             js.Value
	mode, selected, kind, region     string
	density, cluster, margin, radius float64
	gap                              int
	seed                             uint32
	points                           []model.FeaturePoint
	dragging                         bool
	snapshot                         *model.PlacementStore
	modified                         bool
	selectedStart, selectedFeature   int
	ready                            bool
	preserveFeatures                 bool
	Active                           bool
}

func (a *App) mountFeatures() {
	f := &FeatureUI{a: a, kind: "tree", region: "brush", density: 15, cluster: .5, margin: 96, radius: 128, gap: 1, seed: 2701, selectedFeature: -1, sprites: map[string]*featureSprite{}, images: map[string]js.Value{}}
	a.featureUI = f
	root := create("section", "section", "")
	f.root = root
	root.Set("innerHTML", `<h3>Features and starts</h3><div data-modes class="tools"></div><p data-feature-status class="small">Reading the world’s feature catalogue…</p><label>Kind <select data-filter><option value="all">All features</option><option value="tree">Trees</option><option value="foliage">Foliage</option><option value="rock">Rocks</option><option value="deposit">Metal deposits</option><option value="other">Other</option></select></label><div data-feature-list style="max-height:220px;overflow:auto"></div><label>Start positions <select data-starts></select></label><button data-remove-start>Remove selected start</button><details><summary>Tree, foliage and rock fill</summary><label>Mix <select data-kind><option>tree</option><option>foliage</option><option>rock</option></select></label><label>Region <select data-region><option>brush</option><option>lasso</option><option>flood</option></select></label><div data-fill></div></details><p data-feature-count class="small"></p>`)
	host := element("feature-tool-host")
	host.Set("hidden", true)
	host.Call("append", root)
	featureButton := create("button", "", "Features")
	featureButton.Set("id", "feature-tool")
	attribute(featureButton, "aria-pressed", false)
	primary := query(".tool-groups .primary-tools")
	if !exists(primary) {
		primary = query(".tool-group .tools")
	}
	primary.Call("append", featureButton)
	on(featureButton, "click", func(js.Value) {
		if !f.ready || a.Busy {
			return
		}
		a.Selected = -1
		a.PathMode = false
		f.Active = true
		if f.store.DepositName != "" {
			f.mode = "deposit"
		} else {
			f.mode = "starts"
		}
		a.Update()
		a.drawOverlay()
	})
	q := func(sel string) js.Value { return root.Call("querySelector", sel) }
	for _, item := range [][2]string{{"place", "Place feature"}, {"erase", "Erase"}, {"deposit", "Metal deposit"}, {"starts", "Starts"}, {"fill", "Fill"}} {
		mode, label := item[0], item[1]
		b := create("button", "", label)
		attribute(b, "data-feature-mode", mode)
		on(b, "click", func(js.Value) {
			if f.Active && f.mode == mode {
				f.mode = ""
				f.Active = false
			} else {
				f.mode = mode
				f.Active = true
			}
			f.Update()
			element("overlay").Call("focus")
			a.drawOverlay()
		})
		q("[data-modes]").Call("append", b)
	}
	on(q("[data-starts]"), "change", func(e js.Value) {
		f.selectedStart, _ = strconvA(e.Get("target").Get("value").String())
		f.mode = "starts"
		f.Active = true
	})
	on(q("[data-remove-start]"), "click", func(js.Value) {
		if f.store == nil {
			return
		}
		if err := f.store.RemoveStart(f.selectedStart); err != nil {
			f.status(err.Error())
			return
		}
		f.selectedStart = min(f.selectedStart, len(f.store.Starts)-1)
		f.changed()
	})
	on(q("[data-kind]"), "change", func(e js.Value) { f.kind = e.Get("target").Get("value").String(); f.mode = "fill"; f.Active = true })
	on(q("[data-region]"), "change", func(e js.Value) { f.region = e.Get("target").Get("value").String(); f.mode = "fill"; f.Active = true })
	for _, v := range []struct {
		id, label string
		value     float64
	}{{"density", "Density (%)", 15}, {"cluster", "Clustering", .5}, {"gap", "Footprint gap (cells)", 1}, {"seed", "Seed", 2701}, {"margin", "Start / deposit margin (px)", 96}, {"radius", "Brush radius (px)", 128}} {
		id := v.id
		label := create("label", "control", v.label)
		in := create("input", "", "")
		in.Set("type", "number")
		in.Set("value", v.value)
		on(in, "change", func(js.Value) {
			n := in.Get("valueAsNumber").Float()
			if math.IsNaN(n) {
				return
			}
			switch id {
			case "density":
				f.density = math.Max(0, math.Min(100, n))
			case "cluster":
				f.cluster = math.Max(0, math.Min(1, n))
			case "gap":
				f.gap = int(math.Max(0, math.Min(16, math.Round(n))))
			case "seed":
				f.seed = uint32(math.Max(0, math.Min(4294967295, math.Round(n))))
			case "margin":
				f.margin = math.Max(0, math.Min(4096, n))
				if f.store != nil {
					f.store.Margin = f.margin
				}
			case "radius":
				f.radius = math.Max(16, math.Min(1024, n))
			}
			f.sync()
			a.Checkpoint()
		})
		label.Call("append", in)
		q("[data-fill]").Call("append", label)
	}
	func() {
		var c struct {
			Features    []featureCatalogEntry `json:"features"`
			DepositName string                `json:"depositName"`
			Unavailable string                `json:"unavailable"`
		}
		if err := request("/map-features/"+a.World()+"/catalog.json", "GET", nil, &c); err != nil {
			c.Unavailable = err.Error() + ". Feature placement is unavailable; start positions remain editable."
		}
		for _, entry := range c.Features {
			f.defs = append(f.defs, entry.FeatureDefinition)
			if entry.Sprite != nil {
				key := strings.ToLower(entry.Name)
				f.sprites[key] = entry.Sprite
				img := js.Global().Get("Image").New()
				img.Set("src", entry.Sprite.URL)
				f.images[key] = img
				on(img, "load", func(js.Value) { a.drawOverlay() })
			}
		}
		f.store = model.NewPlacementStore(int(num(a.Map(), "playRight", 0)/16), int(num(a.Map(), "playBottom", 0)/16), f.defs, c.DepositName)
		if err := f.load(); err != nil {
			f.preserveFeatures = true
			c.Unavailable = err.Error() + ". Start positions remain editable."
		}
		f.sync()
		f.ready = true
		list := q("[data-feature-list]")
		refresh := func() {
			list.Call("replaceChildren")
			kind := q("[data-filter]").Get("value").String()
			for _, d := range f.defs {
				if kind != "all" && d.Kind != kind {
					continue
				}
				d := d
				b := create("button", "", "")
				if sprite := f.sprites[strings.ToLower(d.Name)]; sprite != nil {
					img := create("img", "", "")
					img.Set("src", sprite.URL)
					img.Get("style").Set("width", "40px")
					img.Get("style").Set("height", "40px")
					img.Get("style").Set("objectFit", "contain")
					b.Call("append", img)
				}
				b.Call("append", create("span", "", fmt.Sprintf("%s · %d×%d · %d uses", d.Name, d.FootprintX, d.FootprintZ, d.Uses)))
				on(b, "click", func(js.Value) { f.selected = d.Name; f.mode = "place"; f.Active = true; f.Update() })
				list.Call("append", b)
			}
		}
		refresh()
		on(q("[data-filter]"), "change", func(js.Value) { refresh() })
		if c.Unavailable != "" {
			f.status(c.Unavailable)
		} else {
			f.status("Choose a feature tool, or keep sculpting terrain.")
		}
		f.Update()
	}()
}
func strconvA(s string) (int, error) { var n int; _, e := fmt.Sscan(s, &n); return n, e }
func (f *FeatureUI) status(s string) {
	f.root.Call("querySelector", "[data-feature-status]").Set("textContent", s)
}
func (f *FeatureUI) load() error {
	if f.store == nil {
		return nil
	}
	next := model.NewPlacementStore(f.store.Cols, f.store.Rows, f.defs, f.store.DepositName)
	b, _ := json.Marshal(f.a.MapData)
	var d struct {
		Features []model.FeaturePlacement `json:"features"`
		Starts   []model.FeaturePoint     `json:"starts"`
		Fill     struct {
			Generated  []model.FeaturePlacement `json:"generated"`
			Kind       string                   `json:"kind"`
			Region     string                   `json:"region"`
			Density    *float64                 `json:"density"`
			Clustering *float64                 `json:"clustering"`
			Gap        *int                     `json:"gap"`
			Seed       *uint32                  `json:"seed"`
			Margin     *float64                 `json:"margin"`
			Radius     *float64                 `json:"radius"`
		} `json:"fill"`
	}
	if err := json.Unmarshal(b, &d); err != nil {
		return fmt.Errorf("Invalid map placements: %w", err)
	}
	for _, p := range d.Features {
		if _, err := next.Add(p.Name, p.X, p.Z); err != nil {
			return fmt.Errorf("Feature %s: %w", p.Name, err)
		}
	}
	if d.Starts != nil {
		if len(d.Starts) < 1 || len(d.Starts) > 10 {
			return fmt.Errorf("Map placements need 1–10 starts.")
		}
		next.Starts = nil
		for _, p := range d.Starts {
			if math.Trunc(p.X) != p.X || math.Trunc(p.Z) != p.Z {
				return fmt.Errorf("Every start must be a distinct pixel position inside the play area.")
			}
			if _, err := next.AddStart(p); err != nil {
				return err
			}
		}
	}
	{
		if d.Fill.Kind != "" {
			f.kind = d.Fill.Kind
		}
		if d.Fill.Region != "" {
			f.region = d.Fill.Region
		}
		if d.Fill.Density != nil {
			f.density = *d.Fill.Density
		}
		if d.Fill.Clustering != nil {
			f.cluster = *d.Fill.Clustering
		}
		if d.Fill.Gap != nil {
			f.gap = *d.Fill.Gap
		}
		if d.Fill.Seed != nil {
			f.seed = *d.Fill.Seed
		}
		if d.Fill.Margin != nil {
			f.margin = *d.Fill.Margin
		}
		if d.Fill.Radius != nil {
			f.radius = *d.Fill.Radius
		}
		next.Margin = f.margin
		for _, p := range d.Fill.Generated {
			next.Generated[strings.ToLower(fmt.Sprintf("%s@%d,%d", p.Name, p.X, p.Z))] = true
		}
	}
	f.store = next
	f.preserveFeatures = false
	return nil
}
func (f *FeatureUI) sync() {
	if f.store == nil {
		return
	}
	generated := []model.FeaturePlacement{}
	for _, p := range f.store.Features {
		if f.store.Generated[strings.ToLower(fmt.Sprintf("%s@%d,%d", p.Name, p.X, p.Z))] {
			generated = append(generated, p)
		}
	}
	if !f.preserveFeatures {
		f.a.MapData["features"] = f.store.SortedFeatures()
	}
	f.a.MapData["starts"] = f.store.Starts
	if !f.preserveFeatures {
		f.a.MapData["fill"] = map[string]any{"kind": f.kind, "region": f.region, "density": f.density, "clustering": f.cluster, "gap": f.gap, "seed": f.seed, "margin": f.margin, "radius": f.radius, "generated": generated}
	}
}
func (f *FeatureUI) changed() {
	f.sync()
	f.a.Change()
	f.a.Checkpoint()
	f.Update()
	f.a.drawOverlay()
}
func (f *FeatureUI) Update() {
	if f == nil || f.store == nil {
		return
	}
	hidden("feature-tool-host", !f.Active)
	attribute(element("feature-tool"), "aria-pressed", f.Active)
	if f.Active {
		hidden("drawing-options", true)
		hidden("selection-panel", true)
		hidden("brush-panel", true)
	}
	disabled("feature-tool", !f.ready || f.a.Busy)
	eachButtons := f.root.Call("querySelectorAll", "[data-feature-mode]")
	for i := 0; i < eachButtons.Length(); i++ {
		b := eachButtons.Index(i)
		mode := b.Call("getAttribute", "data-feature-mode").String()
		attribute(b, "aria-pressed", f.Active && f.mode == mode)
		unavailable := !f.ready || f.a.Busy || (mode != "starts" && len(f.defs) == 0) || (mode == "deposit" && f.store.DepositName == "")
		b.Set("disabled", unavailable)
		if unavailable && mode != "starts" {
			b.Set("title", "No feature catalogue is available for this world.")
		} else {
			b.Set("title", "")
		}
	}
	sel := f.root.Call("querySelector", "[data-starts]")
	sel.Call("replaceChildren")
	for i, p := range f.store.Starts {
		option(sel, fmt.Sprintf("%d: (%g, %g)", i+1, p.X, p.Z), i)
	}
	sel.Set("value", fmt.Sprint(f.selectedStart))
	f.root.Call("querySelector", "[data-feature-count]").Set("textContent", fmt.Sprintf("%d features · %d starts", len(f.store.Features), len(f.store.Starts)))
}
func (f *FeatureUI) at(p model.Point) int {
	for i := len(f.store.Features) - 1; i >= 0; i-- {
		v := f.store.Features[i]
		d := f.store.Definitions[strings.ToLower(v.Name)]
		if p.X >= float64(v.X*16) && p.X < float64((v.X+d.FootprintX)*16) && p.Y >= float64(v.Z*16) && p.Y < float64((v.Z+d.FootprintZ)*16) {
			return i
		}
	}
	return -1
}
func (f *FeatureUI) PointerDown(p model.Point, e js.Value) bool {
	if f == nil || !f.ready || !f.Active || f.mode == "" || f.a.Busy {
		return false
	}
	x, z := int(math.Floor(p.X/16)), int(math.Floor(p.Y/16))
	if f.mode == "erase" || f.mode == "starts" || f.mode == "fill" {
		copy := clone(*f.store)
		f.snapshot = &copy
		f.modified = false
	}
	switch f.mode {
	case "place", "deposit":
		if i := f.at(p); i >= 0 {
			f.selectedFeature = i
			f.status("Selected feature. Press Delete to remove it.")
			f.a.drawOverlay()
			return true
		}
		f.selectedFeature = -1
		name := f.selected
		if f.mode == "deposit" {
			name = f.store.DepositName
		}
		if _, err := f.store.Add(name, x, z); err != nil {
			f.status(err.Error())
		} else {
			f.changed()
		}
	case "erase":
		if i := f.at(p); i >= 0 {
			_ = f.store.Remove(i)
			f.modified = true
			f.sync()
			f.a.drawOverlay()
		}
		f.dragging = true
	case "starts":
		near := -1
		for i, s := range f.store.Starts {
			if math.Hypot(s.X-p.X, s.Z-p.Y) < 20 {
				near = i
				break
			}
		}
		if near >= 0 {
			f.selectedStart = near
			f.dragging = true
		} else if e.Get("shiftKey").Bool() {
			if _, err := f.store.MoveStart(f.selectedStart, model.FeaturePoint{p.X, p.Y}); err != nil {
				f.status(err.Error())
			} else {
				f.changed()
			}
		} else {
			if _, err := f.store.AddStart(model.FeaturePoint{p.X, p.Y}); err != nil {
				f.status(err.Error())
			} else {
				f.selectedStart = len(f.store.Starts) - 1
				f.changed()
			}
		}
	case "fill":
		f.points = []model.FeaturePoint{{p.X, p.Y}}
		f.dragging = true
	}
	return true
}
func (f *FeatureUI) PointerMove(p model.Point, e js.Value) bool {
	if f == nil || !f.dragging || f.a.Busy {
		return false
	}
	switch f.mode {
	case "erase":
		if i := f.at(p); i >= 0 {
			_ = f.store.Remove(i)
			f.modified = true
			f.sync()
			f.a.drawOverlay()
		}
	case "starts":
		if _, err := f.store.MoveStart(f.selectedStart, model.FeaturePoint{p.X, p.Y}); err == nil {
			f.modified = true
			f.sync()
			f.a.drawOverlay()
		}
	case "fill":
		f.points = append(f.points, model.FeaturePoint{p.X, p.Y})
		f.a.drawOverlay()
	}
	return true
}
func (f *FeatureUI) PointerUp(p model.Point, e js.Value) bool {
	if f == nil || !f.dragging {
		return false
	}
	f.dragging = false
	if e.Get("type").String() == "pointercancel" {
		if f.snapshot != nil {
			f.store = f.snapshot
			f.sync()
			f.Update()
			f.a.drawOverlay()
		}
		f.snapshot = nil
		return true
	}
	if (f.mode == "starts" || f.mode == "erase") && f.modified {
		f.changed()
	}
	f.snapshot = nil
	if f.mode == "fill" {
		region := model.FeatureRegion{Type: f.region, Points: f.points, X: p.X, Z: p.Y, Radius: f.radius}
		fill := model.FeatureFill{Kind: f.kind, Density: f.density, Clustering: f.cluster, Gap: f.gap, Seed: f.seed, Margin: f.margin, Radius: f.radius}
		added, err := model.FillFeatures(f.store.Cols, f.store.Rows, num(f.a.Config, "seaLevel", 0), f.a.Sample, f.defs, f.store.Features, f.store.Starts, f.store.DepositName, region, fill)
		if err != nil {
			f.status(err.Error())
		} else {
			for _, v := range added {
				f.store.Features = append(f.store.Features, v)
				f.store.Generated[strings.ToLower(fmt.Sprintf("%s@%d,%d", v.Name, v.X, v.Z))] = true
			}
			f.status(fmt.Sprintf("Filled %d %s features.", len(added), f.kind))
			if len(added) > 0 {
				f.changed()
			}
		}
	}
	return true
}
func (f *FeatureUI) Draw(ctx js.Value, project func(model.Point) model.Point) {
	if f == nil || f.store == nil {
		return
	}
	ctx.Call("save")
	for _, v := range f.store.Features {
		d := f.store.Definitions[strings.ToLower(v.Name)]
		p := project(model.Point{X: float64(v.X * 16), Y: float64(v.Z * 16)})
		q := project(model.Point{X: float64((v.X + d.FootprintX) * 16), Y: float64((v.Z + d.FootprintZ) * 16)})
		key := strings.ToLower(v.Name)
		if sprite := f.sprites[key]; sprite != nil {
			img := f.images[key]
			if img.Get("complete").Bool() && img.Get("naturalWidth").Int() > 0 {
				anchor := project(model.Point{X: float64(v.X*16 + d.FootprintX*8), Y: float64(v.Z*16 + d.FootprintZ*8)})
				scale := f.a.view.Scale
				ctx.Call("drawImage", img, anchor.X-float64(sprite.XOffset)*scale, anchor.Y-float64(sprite.YOffset)*scale, float64(sprite.Width)*scale, float64(sprite.Height)*scale)
			}
		}
		ctx.Set("strokeStyle", "#73e59c")
		ctx.Call("strokeRect", p.X, p.Y, q.X-p.X, q.Y-p.Y)
	}
	for i, v := range f.store.Starts {
		p := project(model.Point{X: v.X, Y: v.Z})
		ctx.Set("fillStyle", "#ffd65a")
		ctx.Call("beginPath")
		ctx.Call("arc", p.X, p.Y, 9, 0, 2*math.Pi)
		ctx.Call("fill")
		ctx.Set("fillStyle", "#111")
		ctx.Call("fillText", fmt.Sprint(i+1), p.X-3, p.Y+4)
	}
	ctx.Call("restore")
}

// HandleKey removes a selected feature and leaves other shortcuts to the editor.
func (f *FeatureUI) HandleKey(key string) bool {
	if f == nil || !f.Active || f.a.Busy {
		return false
	}
	if key == "Escape" {
		if f.dragging && f.snapshot != nil {
			f.store = f.snapshot
			f.sync()
			f.dragging = false
			f.snapshot = nil
		}
		f.Active = false
		f.mode = ""
		f.a.Update()
		f.selectedFeature = -1
		f.a.drawOverlay()
		return true
	}
	if (key == "Delete" || key == "Backspace") && f.selectedFeature >= 0 && f.store != nil {
		if f.store.Remove(f.selectedFeature) == nil {
			f.selectedFeature = -1
			f.changed()
		}
		return true
	}
	return false
}
