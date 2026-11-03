//go:build js && wasm

package editor

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"syscall/js"
	"time"
)

var climateFields = []struct{ key, label string }{{"minWind", "Minimum wind"}, {"maxWind", "Maximum wind"}, {"tidal", "Tidal strength"}, {"solar", "Solar strength"}, {"gravity", "Gravity"}, {"surfaceMetal", "Surface metal"}, {"mohoMetal", "Moho metal"}}

func (a *App) mountMap() {
	root := create("section", "section files", "")
	root.Set("innerHTML", `<h3>Playable map</h3><fieldset id="map-controls"><div class="row"><label>Width (units)<input id="map-x" type="number" min="1" max="40"></label><label>Height (units)<input id="map-y" type="number" min="1" max="40"></label></div><label>Sea level (0–255)<input id="map-sea" type="number" min="0" max="255"></label><button id="map-new">New map canvas</button><p id="map-geometry" class="small"></p><p class="small">New map starts blank. Use the Features tool to place objects and player starts.</p><label>Map name<input id="map-name" type="text" value="Sculpt map"></label><label>Description<input id="map-description" type="text" value="Terrain editor prototype"></label><details><summary>OTA settings</summary><div id="map-climate"></div><label><input id="map-lava" type="checkbox"> Molten terrain</label><button id="map-defaults">Restore world defaults</button></details></fieldset><button id="map-export">Export .ufo</button><p id="map-export-state" class="small" role="status"></p><button id="map-cancel" hidden>Cancel export</button><div id="map-download"></div>`)
	element("map-settings-host").Call("append", root)
	for _, id := range []string{"map-export", "map-export-state", "map-cancel", "map-download"} {
		element("map-export-host").Call("append", element(id))
	}
	for _, f := range climateFields {
		label := create("label", "control", f.label)
		in := create("input", "", "")
		in.Set("id", "map-"+f.key)
		in.Set("type", "number")
		in.Set("min", 0)
		in.Set("step", 1)
		label.Call("append", in)
		element("map-climate").Call("append", label)
	}
	m := a.Map()
	setValue("map-x", num(m, "unitsX", 4))
	setValue("map-y", num(m, "unitsY", 4))
	setValue("map-sea", num(a.Config, "seaLevel", 0))
	text("map-geometry", fmt.Sprintf("%g × %g cells · %g × %g px · play %g × %g px", num(m, "widthCells", 0), num(m, "heightCells", 0), num(m, "width", 0), num(m, "height", 0), num(m, "playRight", 0), num(m, "playBottom", 0)))
	world := obj(obj(obj(a.Config, "exportCatalog"), "worlds"), a.World())
	defaults := obj(world, "climate")
	setClimate := func(c map[string]any) {
		for _, f := range climateFields {
			setValue("map-"+f.key, num(c, f.key, 0))
		}
		if b, ok := c["lava"].(bool); ok {
			element("map-lava").Set("checked", b)
		}
	}
	setClimate(defaults)
	if len(defaults) == 0 {
		text("map-export-state", "Export disabled: "+str(world, "disabledReason", "no retail planet was established for this world."))
		disabled("map-export", true)
	} else {
		text("map-export-state", "OTA planet: "+str(world, "planet", "")+". Climate: medians from its installed maps.")
	}
	sync := func() {
		settings := map[string]any{}
		for _, f := range climateFields {
			settings[f.key] = number("map-" + f.key)
		}
		settings["lava"] = checked("map-lava")
		a.MapData["name"] = value("map-name")
		a.MapData["description"] = value("map-description")
		a.MapData["settings"] = settings
		a.Checkpoint()
	}
	for _, id := range []string{"map-name", "map-description", "map-lava", "map-minWind", "map-maxWind", "map-tidal", "map-solar", "map-gravity", "map-surfaceMetal", "map-mohoMetal"} {
		on(element(id), "change", func(js.Value) { sync() })
	}
	click("map-defaults", func() { setClimate(defaults); sync() })
	click("map-new", func() {
		x, y, sea := number("map-x"), number("map-y"), number("map-sea")
		if x < 1 || x > 40 || y < 1 || y > 40 || sea < 0 || sea > 255 || math.Trunc(x) != x || math.Trunc(y) != y || math.Trunc(sea) != sea {
			text("map-export-state", "Choose 1–40 units per side and an integer sea level from 0 to 255.")
			return
		}
		u := js.Global().Get("URL").New(js.Global().Get("location").Get("href"))
		q := u.Get("searchParams")
		q.Call("set", "mapX", fmt.Sprint(x))
		q.Call("set", "mapY", fmt.Sprint(y))
		q.Call("set", "sea", fmt.Sprint(sea))
		q.Call("set", "scratch", fmt.Sprint("map-", time.Now().UnixMilli()))
		q.Call("delete", "pendingSketch")
		js.Global().Get("location").Set("href", u.Get("href"))
	})
	click("map-export", func() { go func() { _, _ = a.exportMap() }() })
	click("map-cancel", func() {
		if a.cancelExport != nil {
			a.cancelExport()
		}
	})
	a.mountFeatures()
	api := js.Global().Get("Object").New()
	js.Global().Set("sculptMap", api)
	expose(api, "export", func(args []js.Value) any {
		if len(args) > 0 && args[0].Type() == js.TypeString {
			setValue("map-name", args[0].String())
		}
		if len(args) > 1 && args[1].Type() == js.TypeString {
			setValue("map-description", args[1].String())
		}
		return promise(func() (any, error) {
			result, e := a.exportMap()
			if e != nil {
				return nil, e
			}
			return jsObject(result), nil
		})
	})
	api.Set("geometry", jsObject(a.Map()))
	api.Set("catalogue", jsObject(obj(a.Config, "exportCatalog")))
}
func (a *App) exportMap() (map[string]any, error) {
	if len(obj(obj(obj(obj(a.Config, "exportCatalog"), "worlds"), a.World()), "climate")) == 0 {
		return nil, fmt.Errorf("Export is unavailable for this canvas or world.")
	}
	if !a.workerReady {
		return nil, fmt.Errorf("Wait for the finished terrain before exporting.")
	}
	if a.Busy {
		return nil, fmt.Errorf("Wait for the finished terrain before exporting.")
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.cancelExport = cancel
	defer func() {
		cancel()
		a.cancelExport = nil
		a.Busy = false
		a.rendering = false
		for _, id := range []string{"editor", "world-editor", "map-controls"} {
			disabled(id, false)
		}
		a.Schedule()
		hidden("map-cancel", true)
		disabled("map-export", false)
		a.Update()
	}()
	a.Busy = true
	for _, id := range []string{"editor", "world-editor", "map-controls"} {
		disabled(id, true)
	}
	disabled("map-export", true)
	hidden("map-cancel", false)
	token := a.Revision
	settings := map[string]any{}
	for _, f := range climateFields {
		v := number("map-" + f.key)
		if v < 0 || math.Trunc(v) != v || v > 2147483647 || f.key == "surfaceMetal" && v > 255 {
			text("map-export-state", "Use nonnegative integer OTA settings within the displayed bounds.")
			return nil, fmt.Errorf("Use nonnegative integer OTA settings within the displayed bounds.")
		}
		settings[f.key] = v
	}
	if settings["minWind"].(float64) > settings["maxWind"].(float64) {
		text("map-export-state", "Minimum wind must not exceed maximum wind.")
		return nil, fmt.Errorf("Minimum wind must not exceed maximum wind.")
	}
	settings["lava"] = checked("map-lava")
	text("map-export-state", "Sampling TNT cell corners…")
	heights, clipped, err := a.ExportHeights(ctx)
	if err != nil {
		text("map-export-state", err.Error())
		return nil, err
	}
	body := map[string]any{"name": value("map-name"), "description": value("map-description"), "world": a.World(), "unitsX": a.Map()["unitsX"], "unitsY": a.Map()["unitsY"], "seaLevel": a.Config["seaLevel"], "heights": heights, "settings": settings}
	if a.featureUI != nil {
		a.featureUI.sync()
	}
	if v, ok := a.MapData["features"]; ok {
		body["features"] = v
	}
	if v, ok := a.MapData["starts"]; ok {
		body["starts"] = v
	}
	var started map[string]any
	if err = requestContext(ctx, "/map-export/start", "POST", body, &started); err != nil {
		text("map-export-state", err.Error())
		return nil, err
	}
	id := str(started, "id", "")
	finished := false
	defer func() {
		if !finished {
			_ = request("/map-export?id="+url.QueryEscape(id), "DELETE", nil, nil)
		}
	}()
	err = a.ExportChunks(ctx, func(x, y, w, h int, png []byte, index, total int) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if token != a.Revision {
			return fmt.Errorf("Map changed during export.")
		}
		q := url.Values{"id": {id}, "x": {fmt.Sprint(x)}, "y": {fmt.Sprint(y)}, "width": {fmt.Sprint(w)}, "height": {fmt.Sprint(h)}}
		arr := js.Global().Get("Uint8Array").New(len(png))
		js.CopyBytesToJS(arr, png)
		if e := fetchContext(ctx, "/map-export/chunk?"+q.Encode(), map[string]any{"method": "POST", "headers": map[string]any{"Content-Type": "image/png"}, "body": arr}, nil); e != nil {
			return e
		}

		text("map-export-state", fmt.Sprintf("Baking and encoding %d / %d chunks", index+1, total))
		return nil
	})
	if err != nil {
		text("map-export-state", err.Error())
		return nil, err
	}
	var result map[string]any
	if err = requestContext(ctx, "/map-export/finish?id="+url.QueryEscape(id), "POST", nil, &result); err != nil {
		text("map-export-state", err.Error())
		return nil, err
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	finished = true
	text("map-export-state", fmt.Sprintf("%v unique tiles / %v slots. Self-check passed. %d clamped cells.", result["uniqueTiles"], result["tileSlots"], clipped))
	host := element("map-download")
	host.Call("replaceChildren")
	for _, v := range [][2]string{{"Download .ufo", "archive"}, {"Indexed terrain image", "indexed"}} {
		if name := str(result, v[1], ""); name != "" {
			link := create("a", "", v[0])
			link.Set("href", "/map-exports/"+url.PathEscape(name))
			link.Set("download", name)
			host.Call("append", link)
		}
	}
	result["clampedCells"] = clipped
	return result, nil
}

// restoreMapMetadata reapplies settings after loading a recipe or undo state.
func (a *App) restoreMapMetadata() {
	if v, ok := a.MapData["name"].(string); ok {
		setValue("map-name", v)
	} else {
		setValue("map-name", "Sculpt map")
	}
	if v, ok := a.MapData["description"].(string); ok {
		setValue("map-description", v)
	} else {
		setValue("map-description", "Terrain editor prototype")
	}
	settings := obj(a.MapData, "settings")
	if len(settings) == 0 {
		settings = obj(obj(obj(obj(a.Config, "exportCatalog"), "worlds"), a.World()), "climate")
	}
	for _, f := range climateFields {
		setValue("map-"+f.key, num(settings, f.key, 0))
	}
	if b, ok := settings["lava"].(bool); ok {
		element("map-lava").Set("checked", b)
	}
	if a.featureUI != nil && a.featureUI.store != nil {
		if err := a.featureUI.load(); err != nil {
			showError(err)
		}
		a.featureUI.Update()
	}
}
