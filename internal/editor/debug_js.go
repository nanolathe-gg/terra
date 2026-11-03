//go:build js && wasm

package editor

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"syscall/js"
	"time"

	"github.com/nanolathe-gg/terraform/internal/model"
	"github.com/nanolathe-gg/terraform/internal/renderjob"
)

func expose(object js.Value, name string, fn func([]js.Value) any) {
	cb := js.FuncOf(func(_ js.Value, args []js.Value) any { return fn(args) })
	callbacks = append(callbacks, cb)
	object.Set(name, cb)
}
func promise(fn func() (any, error)) js.Value {
	var executor js.Func
	executor = js.FuncOf(func(_ js.Value, args []js.Value) any {
		resolve, reject := args[0], args[1]
		go func() {
			defer func() {
				if p := recover(); p != nil {
					reject.Invoke(js.Global().Get("Error").New(fmt.Sprint(p)))
				}
			}()
			v, e := fn()
			if e != nil {
				reject.Invoke(js.Global().Get("Error").New(e.Error()))
			} else {
				resolve.Invoke(v)
			}
		}()
		return nil
	})
	p := js.Global().Get("Promise").New(executor)
	executor.Release()
	return p
}
func (a *App) idle() error {
	deadline := time.Now().Add(5 * time.Minute)
	for !a.workerReady || a.rendering || a.scheduleQueued {
		if !element("error").Get("hidden").Bool() {
			return fmt.Errorf("%s", element("error").Get("textContent").String())
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("Timed out waiting for terrain.")
		}
		time.Sleep(20 * time.Millisecond)
	}
	return nil
}
func (a *App) scriptedScene(list []any, ground bool) error {
	a.Nodes = []model.Node{}
	a.Selected = -1
	if ground {
		a.addGround()
	}
	for index, raw := range list {
		row, ok := raw.([]any)
		if !ok || len(row) < 2 {
			return fmt.Errorf("Invalid scene stroke %d", index)
		}
		kind, _ := row[0].(string)
		points := []model.Point{}
		for _, p := range row[1].([]any) {
			xy := p.([]any)
			points = append(points, model.Point{X: xy[0].(float64), Y: xy[1].(float64)})
		}
		options := map[string]any{}
		if len(row) > 2 && row[2] != nil {
			options = row[2].(map[string]any)
		}
		d := a.toolDefaults(kind, a.World())
		for k, v := range obj(options, "card") {
			d[k] = v
		}
		p := map[string]any{"radius": num(d, "diameter", 200) / 2, "amount": num(d, "amount", 70), "rough": num(d, "roughness", 35) / 100, "softness": num(d, "softness", 50) / 100, "bankWidth": num(d, "bankWidth", 50) / 100, "beachFlatness": num(d, "beachFlatness", 50) / 100, "shelves": num(d, "shelves", 25) / 100, "cracks": num(d, "cracks", 40) / 100, "shallowMode": str(d, "shallowMode", "area")}
		for _, f := range a.Schema.Shapes {
			p[f[0].(string)] = num(d, f[0].(string), 0) / f[7].(float64)
		}
		if c, ok := d["curve"]; ok {
			p["curve"] = c
		}
		seed := a.Seed + uint32(index*7919)
		for k, v := range options {
			if k != "card" && k != "seed" {
				p[k] = v
			}
			if k == "seed" {
				seed = uint32(v.(float64))
			}
		}
		a.Nodes = append(a.Nodes, model.Node{Kind: kind, Seed: seed, Points: points, Params: p})
	}
	a.Checkpoint()
	a.Change()
	return nil
}
func (a *App) mountDebug() {
	d := js.Global().Get("Object").New()
	js.Global().Set("sculptDebug", d)
	d.Set("biome", a.World())
	d.Set("grid", a.Config["grid"])
	d.Set("size", a.Config["size"])
	d.Set("sea", a.Config["seaLevel"])
	d.Set("base", a.Config["baseHeight"])
	expose(d, "nodes", func([]js.Value) any {
		if a.Nodes == nil {
			return jsObject([]model.Node{})
		}
		return jsObject(a.Nodes)
	})
	expose(d, "uniforms", func([]js.Value) any {
		return promise(func() (any, error) {
			if e := a.idle(); e != nil {
				return nil, e
			}
			m, e := a.rpcJob(context.Background(), "uniforms", renderjob.Tile{})
			if e != nil {
				return nil, e
			}
			return m.Get("result"), nil
		})
	})
	expose(d, "sketch", func([]js.Value) any { return jsObject(a.Sketch()) })
	expose(d, "loadSketch", func(args []js.Value) any {
		b := js.Global().Get("JSON").Call("stringify", args[0]).String()
		if e := a.LoadSketch([]byte(b)); e != nil {
			showError(e)
		}
		return nil
	})
	expose(d, "scene", func(args []js.Value) any {
		var list []any
		if e := fromJS(args[0], &list); e != nil {
			showError(e)
			return nil
		}
		ground := true
		if len(args) > 1 && exists(args[1].Get("ground")) {
			ground = args[1].Get("ground").Bool()
		}
		if e := a.scriptedScene(list, ground); e != nil {
			showError(e)
		}
		return len(a.Nodes)
	})
	expose(d, "corner", func(args []js.Value) any {
		v := a.Sample(args[0].Float(), args[1].Float())
		return jsObject(map[string]any{"eroded": v, "authored": v})
	})
	expose(d, "state", func([]js.Value) any {
		return jsObject(map[string]any{"tool": a.Tool, "selected": a.Selected, "stroke": a.gesture != nil, "moving": a.gesture != nil && a.gesture.Kind == "move"})
	})
	expose(d, "pageInfo", func([]js.Value) any {
		return jsObject(map[string]any{"np": int(math.Ceil(num(a.Config, "grid", 0) / 256)), "worker": true})
	})
	check := func(replay bool) any {
		return promise(func() (any, error) {
			if e := a.idle(); e != nil {
				return nil, e
			}
			m, e := a.rpcJob(context.Background(), "check", renderjob.Tile{})
			if e != nil {
				return nil, e
			}
			var raw struct {
				Grid             int `json:"grid"`
				Repeat, Regional map[string]struct {
					Cells     int     `json:"cells"`
					Max       float64 `json:"max"`
					NonFinite int     `json:"nonFinite"`
				}
			}
			if e = fromJS(m.Get("result"), &raw); e != nil {
				return nil, e
			}
			total := 0
			maximum := 0.
			planes := map[string]any{}
			for name, p := range raw.Regional {
				total += p.Cells
				maximum = max(maximum, p.Max)
				planes[name] = map[string]any{"mismatches": p.Cells, "maxDifference": p.Max, "nonFinite": p.NonFinite}
			}
			for _, p := range raw.Repeat {
				total += p.Cells
				maximum = max(maximum, p.Max)
			}
			if replay {
				if total > 0 && maximum == 0 {
					maximum = 1
				}
				return maximum, nil
			}
			// Regional and repeat checks are separate; the public total is its plane sum.
			total = 0
			for _, p := range raw.Regional {
				total += p.Cells
			}
			return jsObject(map[string]any{"grid": raw.Grid, "planes": planes, "mismatches": total, "repeat": raw.Repeat, "gpuShape": true}), nil
		})
	}
	expose(d, "regionalCheck", func([]js.Value) any { return check(false) })
	expose(d, "shapeCompare", func([]js.Value) any { return check(false) })
	expose(d, "replayAll", func([]js.Value) any { return check(true) })

	c := js.Global().Get("Object").New()
	js.Global().Set("sculptCanvas", c)
	expose(c, "idle", func([]js.Value) any { return promise(func() (any, error) { return nil, a.idle() }) })
	expose(c, "zoom", func(args []js.Value) any {
		if len(args) == 0 || args[0].Type() == js.TypeString {
			a.Fit()
		} else {
			a.zoom(args[0].Float())
		}
		return nil
	})
	expose(c, "resize", func([]js.Value) any { a.resize(); return nil })
	expose(c, "view", func([]js.Value) any {
		return jsObject(map[string]any{"x": a.view.X, "y": a.view.Y, "width": float64(a.view.Width) / a.view.Scale, "height": float64(a.view.Height) / a.view.Scale, "scale": a.view.Scale, "overview": a.view.Fit})
	})
	expose(c, "stats", func([]js.Value) any {
		bytes := 0
		for _, t := range a.tiles {
			bytes += t.Bytes
		}
		return jsObject(map[string]any{"displayChunkSize": max(64, int(math.Ceil(256/a.view.Scale))), "canonicalChunkSize": 256, "revision": a.Revision, "worker": true, "cachedChunks": len(a.tiles), "cacheBytes": bytes, "renderMilliseconds": a.frameTimes, "strokeMilliseconds": a.strokeTimes, "pending": a.rendering})
	})
	expose(c, "debugBake", func(args []js.Value) any {
		var rect map[string]any
		_ = fromJS(args[0], &rect)
		scale := 1.0
		if len(args) > 1 {
			scale = args[1].Float()
		}
		return promise(func() (any, error) {
			m, e := a.rpcJob(context.Background(), "view", renderjob.Tile{X: int(num(rect, "x", 0)), Y: int(num(rect, "y", 0)), Width: int(num(rect, "width", 512)), Height: int(num(rect, "height", 512)), Scale: scale})
			if e != nil {
				return nil, e
			}
			w, h := m.Get("width").Int(), m.Get("height").Int()
			canvas := create("canvas", "", "")
			canvas.Set("width", w)
			canvas.Set("height", h)
			arr := js.Global().Get("Uint8ClampedArray").New(m.Get("rgba"))
			canvas.Call("getContext", "2d").Call("putImageData", js.Global().Get("ImageData").New(arr, w, h), 0, 0)
			return canvas, nil
		})
	})
	region := js.Global().Get("Object").New()
	js.Global().Set("sculptRegion", region)
	expose(region, "readAuthored", func(args []js.Value) any {
		var rect map[string]any
		if len(args) > 0 {
			_ = fromJS(args[0], &rect)
		}
		return promise(func() (any, error) {
			if e := a.idle(); e != nil {
				return nil, e
			}
			m, e := a.rpcJob(context.Background(), "authored", renderjob.Tile{X: int(num(rect, "x", 0)), Y: int(num(rect, "y", 0)), Width: int(num(rect, "width", 512)), Height: int(num(rect, "height", 512))})
			if e != nil {
				return nil, e
			}
			return m, nil
		})
	})
	var _ = json.Marshal
}
