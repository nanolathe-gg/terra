//go:build js && wasm

package editor

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/nanolathe-gg/terraform/internal/model"
	"github.com/nanolathe-gg/terraform/internal/renderjob"
	"math"
	"sort"
	"strings"
	"syscall/js"
)

type featureSprite struct {
	URL                             string `json:"url"`
	Width, Height, XOffset, YOffset int
}
type featureCatalogEntry struct {
	model.FeatureDefinition
	Sprite    *featureSprite `json:"sprite"`
	Shadow    *featureSprite `json:"shadow"`
	AnimTrans int            `json:"animTrans"`
	ShadTrans int            `json:"shadTrans"`
}
type FeatureUI struct {
	a                                *App
	store                            *model.PlacementStore
	defs                             []model.FeatureDefinition
	sprites                          map[string]*featureSprite
	shadows                          map[string]*featureSprite
	transparency                     map[string][2]bool
	hover                            *model.Point
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
	cancelFill                       context.CancelFunc
}

func (a *App) mountFeatures() {
	f := &FeatureUI{a: a, kind: "tree", region: "brush", density: 15, cluster: .5, margin: 96, radius: 128, gap: 1, seed: 2701, selectedFeature: -1, sprites: map[string]*featureSprite{}, shadows: map[string]*featureSprite{}, transparency: map[string][2]bool{}, images: map[string]js.Value{}}
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
		f.hover = nil
		if f.store.DepositName != "" {
			f.mode = "deposit"
		} else {
			f.mode = "starts"
		}
		a.Update()
		a.drawOverlay()
	})
	q := func(sel string) js.Value { return root.Call("querySelector", sel) }
	on(element("overlay"), "pointerleave", func(js.Value) {
		if !f.dragging {
			f.hover = nil
			a.drawOverlay()
		}
	})
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
			f.hover = nil
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
	on(q("[data-kind]"), "change", func(e js.Value) {
		f.kind = e.Get("target").Get("value").String()
		f.mode, f.Active = "fill", true
		f.changed()
	})
	on(q("[data-region]"), "change", func(e js.Value) {
		f.region = e.Get("target").Get("value").String()
		f.mode, f.Active = "fill", true
		f.changed()
	})
	for _, v := range []struct {
		id, label string
		value     float64
	}{{"density", "Density (%)", 15}, {"cluster", "Clustering", .5}, {"gap", "Footprint gap (cells)", 1}, {"seed", "Seed", 2701}, {"margin", "Start / deposit margin (px)", 96}, {"radius", "Brush radius (px)", 128}} {
		id := v.id
		label := create("label", "control", v.label)
		in := create("input", "", "")
		in.Set("type", "number")
		attribute(in, "data-fill-setting", id)
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
					f.store.SetMargin(f.margin)
				}
			case "radius":
				f.radius = math.Max(16, math.Min(1024, n))
			}
			f.changed()
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
			key := strings.ToLower(entry.Name)
			f.transparency[key] = [2]bool{entry.AnimTrans != 0, entry.ShadTrans != 0}
			loadSprite := func(sprite *featureSprite) {
				if sprite == nil {
					return
				}
				if _, ok := f.images[sprite.URL]; ok {
					return
				}
				img := js.Global().Get("Image").New()
				img.Set("src", sprite.URL)
				f.images[sprite.URL] = img
				on(img, "load", func(js.Value) { a.drawOverlay() })
			}
			if validFeatureSprite(a.World(), entry.Sprite) {
				f.sprites[key] = entry.Sprite
				loadSprite(entry.Sprite)
			}
			if validFeatureSprite(a.World(), entry.Shadow) {
				f.shadows[key] = entry.Shadow
				loadSprite(entry.Shadow)
			}
		}
		f.store = model.NewPlacementStore(int(num(a.Map(), "playRight", 0)/16), int(num(a.Map(), "playBottom", 0)/16), f.defs, c.DepositName)
		if err := f.load(); err != nil {
			f.preserveFeatures = true
			c.Unavailable = err.Error() + ". Start positions remain editable."
		} else {
			f.sync()
		}
		f.ready = true
		list := q("[data-feature-list]")
		refresh := func() {
			clearEvents(list)
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
	missingCatalog := len(f.defs) == 0 && len(d.Features) > 0
	if !missingCatalog {
		for _, p := range d.Features {
			if _, err := next.Add(p.Name, p.X, p.Z); err != nil {
				return fmt.Errorf("Feature %s: %w", p.Name, err)
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
	f.selectedStart = max(0, min(f.selectedStart, len(next.Starts)-1))
	f.selectedFeature = -1
	f.preserveFeatures = missingCatalog
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
	for key, value := range map[string]any{
		"density": f.density, "cluster": f.cluster, "gap": f.gap,
		"seed": f.seed, "margin": f.margin, "radius": f.radius,
	} {
		input := f.root.Call("querySelector", "[data-fill-setting='"+key+"']")
		if exists(input) && !input.Equal(document.Get("activeElement")) {
			input.Set("value", fmt.Sprint(value))
		}
	}
	f.root.Call("querySelector", "[data-kind]").Set("value", f.kind)
	f.root.Call("querySelector", "[data-region]").Set("value", f.region)
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
	f.hover = &model.Point{X: p.X, Y: p.Y}
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
	if f == nil || !f.Active || f.mode == "" || f.a.Busy || (f.a.gesture != nil && f.a.gesture.Kind == "pan") {
		return false
	}
	f.hover = &model.Point{X: p.X, Y: p.Y}
	if !f.dragging {
		return true
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
	if e.Get("type").String() == "pointercancel" || e.Get("type").String() == "lostpointercapture" {
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
		available := false
		for _, d := range f.defs {
			if d.Kind == f.kind {
				available = true
				break
			}
		}
		if !available {
			f.status("This world has no " + f.kind + " features to fill.")
			return true
		}
		region := model.FeatureRegion{Type: f.region, Points: append([]model.FeaturePoint(nil), f.points...), X: p.X, Z: p.Y, Radius: f.radius, RadiusSet: true}
		fill := model.FeatureFill{Kind: f.kind, Density: f.density, Clustering: f.cluster, Gap: f.gap, Seed: f.seed, Margin: f.margin, Radius: f.radius}
		job := f.a.job("fill", nil)
		job.Options["Weather"] = checked("weather")
		job.Fill = &renderjob.FillRequest{Cols: f.store.Cols, Rows: f.store.Rows, Sea: num(f.a.Config, "seaLevel", 0), Definitions: clone(f.defs), Existing: clone(f.store.Features), Starts: clone(f.store.Starts), DepositName: f.store.DepositName, Region: region, Settings: fill}
		revision := f.a.Revision
		f.a.Busy = true
		for _, id := range []string{"editor", "world-editor", "map-controls"} {
			disabled(id, true)
		}
		controls := f.root.Call("querySelectorAll", "button,input,select")
		for i := 0; i < controls.Length(); i++ {
			controls.Index(i).Set("disabled", true)
		}
		f.status("Sampling terrain and placing features…")
		ctx, cancel := context.WithCancel(context.Background())
		f.cancelFill = cancel
		go func() {
			defer func() {
				cancel()
				f.cancelFill = nil
				f.a.Busy = false
				for _, id := range []string{"editor", "world-editor", "map-controls"} {
					disabled(id, false)
				}
				for i := 0; i < controls.Length(); i++ {
					controls.Index(i).Set("disabled", false)
				}
				f.a.Update()
				f.a.Schedule()
			}()
			msg, err := f.a.rpcRequest(ctx, job)
			if err != nil {
				f.status(err.Error())
				return
			}
			if revision != f.a.Revision {
				f.status("Map changed during fill; no features were placed.")
				return
			}
			var added []model.FeaturePlacement
			if err = fromJS(msg.Get("placements"), &added); err != nil {
				f.status(err.Error())
				return
			}
			for _, v := range added {
				f.store.Features = append(f.store.Features, v)
				f.store.Generated[strings.ToLower(fmt.Sprintf("%s@%d,%d", v.Name, v.X, v.Z))] = true
			}
			f.status(fmt.Sprintf("Filled %d %s features.", len(added), fill.Kind))
			if len(added) > 0 {
				f.changed()
			}
		}()
	}
	return true
}

// validFeatureSprite accepts only the local catalogue's declared image assets.
func validFeatureSprite(world string, s *featureSprite) bool {
	return s != nil && strings.HasPrefix(s.URL, "/map-features/"+world+"/") && !strings.Contains(s.URL, "..") && strings.HasSuffix(s.URL, ".png") && s.Width > 0 && s.Height > 0
}
func (f *FeatureUI) featureProject(p model.Point) model.Point {
	h := f.a.Sample(p.X, p.Y)
	if math.IsNaN(h) || math.IsInf(h, 0) {
		h = 0
	}
	h = math.Floor(math.Max(0, math.Min(255, h)) / 2)
	return model.Point{X: (p.X - f.a.view.X) * f.a.view.Scale, Y: (p.Y - h + num(f.a.Config, "baseHeight", 0)/2 - f.a.view.Y) * f.a.view.Scale}
}
func (f *FeatureUI) featureAnchor(p model.FeaturePlacement, d model.FeatureDefinition) model.Point {
	sum := 0
	for _, c := range [][2]int{{p.X, p.Z}, {p.X + 1, p.Z}, {p.X, p.Z + 1}, {p.X + 1, p.Z + 1}} {
		h := f.a.Sample(float64(c[0]*16), float64(c[1]*16))
		if math.IsNaN(h) || math.IsInf(h, 0) {
			sum--
			continue
		}
		sum += int(math.Floor(math.Max(0, math.Min(255, h)) + .5))
	}
	return model.Point{X: float64(p.X*16 + d.FootprintX*8), Y: float64(p.Z*16+d.FootprintZ*8-(sum>>3)) + num(f.a.Config, "baseHeight", 0)/2}
}
func (f *FeatureUI) Draw(ctx js.Value, _ func(model.Point) model.Point) {
	if f == nil || f.store == nil {
		return
	}
	ctx.Call("save")
	ctx.Set("imageSmoothingEnabled", false)
	scale := f.a.view.Scale
	ordered := make([]model.FeaturePlacement, 0, len(f.store.Features))
	viewWidth, viewHeight := float64(f.a.view.Width)/scale, float64(f.a.view.Height)/scale
	for _, p := range f.store.Features {
		key := strings.ToLower(p.Name)
		d, ok := f.store.Definitions[key]
		if !ok {
			continue
		}
		reach := 32.0
		for _, sprite := range []*featureSprite{f.sprites[key], f.shadows[key]} {
			if sprite != nil {
				reach = math.Max(reach, math.Max(float64(sprite.Width), float64(sprite.Height)))
			}
		}
		reach += 128
		x := float64(p.X*16 + d.FootprintX*8)
		y := float64(p.Z*16+d.FootprintZ*8) + num(f.a.Config, "baseHeight", 0)/2
		if x+reach >= f.a.view.X && x-reach <= f.a.view.X+viewWidth && y+reach >= f.a.view.Y && y-reach <= f.a.view.Y+viewHeight {
			ordered = append(ordered, p)
		}
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		a, b := ordered[i], ordered[j]
		ad, bd := f.store.Definitions[strings.ToLower(a.Name)], f.store.Definitions[strings.ToLower(b.Name)]
		ay, by := a.Z*16+ad.FootprintZ*8, b.Z*16+bd.FootprintZ*8
		if ay != by {
			return ay < by
		}
		if a.Z != b.Z {
			return a.Z < b.Z
		}
		if a.X != b.X {
			return a.X < b.X
		}
		return a.Name < b.Name
	})
	for _, p := range ordered {
		key := strings.ToLower(p.Name)
		d, ok := f.store.Definitions[key]
		if !ok {
			continue
		}
		anchor := f.featureAnchor(p, d)
		for _, layer := range []struct {
			sprite      *featureSprite
			transparent bool
		}{{f.shadows[key], f.transparency[key][1]}, {f.sprites[key], f.transparency[key][0]}} {
			if layer.sprite == nil {
				continue
			}
			img := f.images[layer.sprite.URL]
			if !exists(img) || !img.Get("complete").Bool() || img.Get("naturalWidth").Int() <= 0 {
				continue
			}
			alpha := 1.0
			if layer.transparent {
				alpha = .5
			}
			ctx.Set("globalAlpha", alpha)
			x := (math.Floor(anchor.X) - float64(layer.sprite.XOffset) - f.a.view.X) * scale
			y := (math.Floor(anchor.Y) - float64(layer.sprite.YOffset) - f.a.view.Y) * scale
			ctx.Call("drawImage", img, x, y, float64(layer.sprite.Width)*scale, float64(layer.sprite.Height)*scale)
		}
	}
	ctx.Set("globalAlpha", 1)
	outline := func(p model.FeaturePlacement, d model.FeatureDefinition, color string) {
		x0, y0 := float64(p.X*16), float64(p.Z*16)
		x1, y1 := float64((p.X+d.FootprintX)*16), float64((p.Z+d.FootprintZ)*16)
		points := []model.Point{{X: x0, Y: y0}, {X: x1, Y: y0}, {X: x1, Y: y1}, {X: x0, Y: y1}}
		ctx.Call("beginPath")
		for i, p := range points {
			v := f.featureProject(p)
			if i == 0 {
				ctx.Call("moveTo", v.X, v.Y)
			} else {
				ctx.Call("lineTo", v.X, v.Y)
			}
		}
		ctx.Call("closePath")
		ctx.Set("strokeStyle", color)
		ctx.Set("lineWidth", 1.5)
		ctx.Call("stroke")
	}
	if f.Active && f.selectedFeature >= 0 && f.selectedFeature < len(f.store.Features) {
		p := f.store.Features[f.selectedFeature]
		if d, ok := f.store.Definitions[strings.ToLower(p.Name)]; ok {
			outline(p, d, "#ffe69c")
		}
	}
	if f.Active && f.hover != nil && (f.mode == "place" || f.mode == "deposit") {
		name := f.selected
		if f.mode == "deposit" {
			name = f.store.DepositName
		}
		if d, ok := f.store.Definitions[strings.ToLower(name)]; ok {
			p := model.FeaturePlacement{Name: d.Name, X: int(math.Floor(f.hover.X / 16)), Z: int(math.Floor(f.hover.Y / 16))}
			valid := p.X >= 0 && p.Z >= 0 && p.X+d.FootprintX <= f.store.Cols && p.Z+d.FootprintZ <= f.store.Rows
			for _, other := range f.store.Features {
				od, ok := f.store.Definitions[strings.ToLower(other.Name)]
				if ok && p.X < other.X+od.FootprintX && p.X+d.FootprintX > other.X && p.Z < other.Z+od.FootprintZ && p.Z+d.FootprintZ > other.Z {
					valid = false
					break
				}
			}
			color := "#ff877e"
			if valid {
				color = "#b8eef3"
			}
			outline(p, d, color)
		}
	}
	for i, start := range f.store.Starts {
		p := f.featureProject(model.Point{X: start.X, Y: start.Z})
		selected := f.Active && f.mode == "starts" && f.selectedStart == i
		fill := "#163240dd"
		if selected {
			fill = "#ffe69c"
		}
		ctx.Call("beginPath")
		ctx.Call("arc", p.X, p.Y, 12*scale, 0, 2*math.Pi)
		ctx.Set("fillStyle", fill)
		ctx.Call("fill")
		ctx.Set("lineWidth", 2*scale)
		ctx.Set("strokeStyle", "#b8eef3")
		ctx.Call("stroke")
		ctx.Set("fillStyle", "#ffffff")
		if selected {
			ctx.Set("fillStyle", "#18221a")
		}
		ctx.Set("font", fmt.Sprintf("bold %gpx sans-serif", 12*scale))
		ctx.Set("textAlign", "center")
		ctx.Set("textBaseline", "middle")
		ctx.Call("fillText", fmt.Sprint(i+1), p.X, p.Y)
	}
	if f.Active && f.mode == "fill" {
		ctx.Set("strokeStyle", "#b8eef3")
		ctx.Set("lineWidth", 1.5*scale)
		ctx.Call("setLineDash", js.ValueOf([]any{6 * scale, 4 * scale}))
		if f.region == "brush" && f.hover != nil {
			p := f.featureProject(*f.hover)
			ctx.Call("beginPath")
			ctx.Call("arc", p.X, p.Y, f.radius*scale, 0, 2*math.Pi)
			ctx.Call("stroke")
		}
		if f.dragging && len(f.points) > 0 {
			ctx.Call("beginPath")
			for i, point := range f.points {
				p := f.featureProject(model.Point{X: point.X, Y: point.Z})
				if i == 0 {
					ctx.Call("moveTo", p.X, p.Y)
				} else {
					ctx.Call("lineTo", p.X, p.Y)
				}
			}
			if f.region == "lasso" {
				ctx.Call("closePath")
			}
			ctx.Call("stroke")
		}
	}
	ctx.Call("restore")
}

// HandleKey removes a selected feature and leaves other shortcuts to the editor.
func (f *FeatureUI) HandleKey(key string) bool {
	if f != nil && key == "Escape" && f.cancelFill != nil {
		f.cancelFill()
		f.status("Canceling fill…")
		return true
	}
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
		f.hover = nil
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
