//go:build js && wasm

package editor

import (
	"context"
	"fmt"
	"math"
	"syscall/js"
	"time"

	"github.com/nanolathe-gg/terraform/internal/model"
	"github.com/nanolathe-gg/terraform/internal/renderjob"
)

// mountAudit exposes the real editor and model to the control-impact checks.
// It is enabled only on an explicit audit page and creates no editor controls.
func (a *App) mountAudit() {
	if !a.Query.Has("audit") {
		return
	}
	debug := js.Global().Get("sculptDebug")
	expose(debug, "curve", func([]js.Value) any { return jsObject(a.Curve) })
	expose(debug, "along", func([]js.Value) any { return jsObject(a.Along) })
	expose(debug, "place", func([]js.Value) any { return a.landformPlace })
	expose(debug, "ghostSamples", func([]js.Value) any {
		s := landformGhosts[a]
		if s == nil {
			return js.Null()
		}
		return jsObject(map[string]any{"key": s.key, "points": s.points, "values": s.values, "pending": s.pending, "timer": s.timer != nil})
	})
	toPage := func(canvas js.Value, x, y float64) any {
		r := canvas.Call("getBoundingClientRect")
		return jsObject(map[string]float64{"x": r.Get("left").Float() + x*r.Get("width").Float()/canvas.Get("width").Float(), "y": r.Get("top").Float() + y*r.Get("height").Float()/canvas.Get("height").Float()})
	}
	expose(debug, "sectionPoint", func(args []js.Value) any {
		c := element("section-preview")
		l := a.sectionGeometry(c, false)
		return toPage(c, l.sideX(args[0].String(), args[1].Float()), l.valueY(args[2].Float()))
	})
	expose(debug, "leanPoint", func([]js.Value) any {
		c := element("section-preview")
		l := a.sectionGeometry(c, false)
		return toPage(c, l.xc, l.valueY(0))
	})
	expose(debug, "alongPoint", func(args []js.Value) any {
		c := element("along-preview")
		l := a.sectionGeometry(c, true)
		return toPage(c, l.xL+(l.xR-l.xL)*args[0].Float(), l.valueY(args[1].Float()))
	})
	expose(js.Global().Get("sculptRegion"), "sectionMark", func([]js.Value) any {
		p, q, ok := a.landformSectionMark()
		if !ok {
			return js.Null()
		}
		return jsObject(map[string]any{"a": p, "b": q})
	})
	expose(debug, "curveFormKnots", func(args []js.Value) any {
		knots, _ := model.FormKnots(args[0].String(), args[1].Float())
		return jsObject(knots)
	})
	audit := js.Global().Get("Object").New()
	js.Global().Set("terraformAudit", audit)
	variant := js.Global().Get("Map").New()
	syncVariant := func() {
		variant.Call("clear")
		for k, v := range a.Knobs {
			variant.Call("set", k, fmt.Sprint(v))
		}
	}
	syncVariant()
	renderer := js.Global().Get("Object").New()
	renderer.Set("variant", variant)
	audit.Set("renderer", renderer)
	audit.Set("config", jsObject(a.Config))
	audit.Set("fields", jsObject(a.Schema.Shapes))
	audit.Set("knobs", jsObject(a.Schema.Knobs))
	audit.Set("parked", jsObject(a.Schema.Parked))
	getter := func(name string, fn func() any) {
		cb := js.FuncOf(func(_ js.Value, _ []js.Value) any { return fn() })
		callbacks = append(callbacks, cb)
		js.Global().Get("Object").Call("defineProperty", audit, name, js.ValueOf(map[string]any{"get": cb}))
	}
	getter("nodes", func() any { return jsObject(a.Nodes) })
	wait := func() any { return promise(func() (any, error) { return nil, a.idle() }) }
	expose(audit, "ready", func([]js.Value) any { return wait() })
	expose(audit, "idle", func([]js.Value) any { return wait() })
	expose(audit, "setBusy", func([]js.Value) any { return nil })
	expose(audit, "panelValues", func([]js.Value) any { return jsObject(a.worldValues()) })
	expose(audit, "defaults", func(args []js.Value) any {
		if len(args) < 1 {
			return jsObject(map[string]any{})
		}
		return jsObject(a.toolDefaults(args[0].String(), a.World()))
	})
	expose(audit, "worldRequirement", func(args []js.Value) any {
		if len(args) < 2 {
			return ""
		}
		var v map[string]any
		if fromJS(args[1], &v) != nil {
			return ""
		}
		return model.WorldControlRequirement(args[0].String(), v)
	})
	expose(audit, "shapeAvailable", func(args []js.Value) any {
		if len(args) < 3 {
			return false
		}
		var p map[string]any
		if fromJS(args[2], &p) != nil {
			return false
		}
		return a.shapeVisible(args[0].String(), args[1].String(), p)
	})
	expose(audit, "gatesFor", func(args []js.Value) any {
		if len(args) < 3 {
			return jsObject([]any{})
		}
		key := args[0].String()
		var values map[string]any
		var all []struct {
			Key    string `json:"key"`
			Lo, Hi float64
		}
		if fromJS(args[1], &values) != nil || fromJS(args[2], &all) != nil {
			return jsObject([]any{})
		}
		alone := []map[string]float64{}
		for _, k := range all {
			for _, x := range []float64{1, (k.Lo + k.Hi) / 2, k.Hi, k.Lo} {
				if k.Key == key || num(values, k.Key, math.NaN()) == x {
					continue
				}
				v := clone(values)
				v[k.Key] = x
				if model.WorldControlRequirement(key, v) == "" {
					alone = append(alone, map[string]float64{k.Key: x})
					break
				}
			}
		}
		if len(alone) > 0 {
			return jsObject(alone[:min(6, len(alone))])
		}
		v := clone(values)
		gates := map[string]float64{}
		for round := 0; round < 6 && model.WorldControlRequirement(key, v) != ""; round++ {
			before := model.WorldControlRequirement(key, v)
			done := false
			for _, k := range all {
				for _, x := range []float64{1, (k.Lo + k.Hi) / 2, k.Hi} {
					if k.Key == key || num(v, k.Key, math.NaN()) == x {
						continue
					}
					trial := clone(v)
					trial[k.Key] = x
					if model.WorldControlRequirement(key, trial) != before {
						v[k.Key] = x
						gates[k.Key] = x
						done = true
						break
					}
				}
				if done {
					break
				}
			}
			if !done {
				return jsObject([]any{})
			}
		}
		if model.WorldControlRequirement(key, v) != "" {
			return jsObject([]any{})
		}
		return jsObject([]map[string]float64{gates})
	})
	expose(audit, "scene", func(args []js.Value) any {
		var list []any
		if len(args) == 0 || fromJS(args[0], &list) != nil {
			return 0
		}
		ground := true
		if len(args) > 1 && exists(args[1].Get("ground")) {
			ground = args[1].Get("ground").Bool()
		}
		if e := a.scriptedScene(list, ground); e != nil {
			showError(e)
			return 0
		}
		return len(a.Nodes)
	})
	expose(audit, "select", func(args []js.Value) any {
		return promise(func() (any, error) {
			if len(args) == 0 {
				return nil, fmt.Errorf("missing selection")
			}
			i := args[0].Int()
			if i < 0 || i >= len(a.Nodes) {
				return nil, fmt.Errorf("invalid selection")
			}
			a.Selected = i
			a.Update()
			return nil, a.idle()
		})
	})
	expose(audit, "edit", func(args []js.Value) any {
		return promise(func() (any, error) {
			if len(args) < 2 {
				return nil, fmt.Errorf("missing stroke edit")
			}
			i := args[0].Int()
			if i < 0 || i >= len(a.Nodes) {
				return nil, fmt.Errorf("invalid stroke")
			}
			var values map[string]any
			if e := fromJS(args[1], &values); e != nil {
				return nil, e
			}
			if a.Nodes[i].Params == nil {
				a.Nodes[i].Params = map[string]any{}
			}
			for k, v := range values {
				a.Nodes[i].Params[k] = v
			}
			a.Selected = i
			a.Change()
			return nil, a.idle()
		})
	})
	expose(audit, "knob", func(args []js.Value) any {
		return promise(func() (any, error) {
			if len(args) < 2 {
				return nil, fmt.Errorf("missing knob value")
			}
			key := args[0].String()
			var v any
			if e := fromJS(args[1], &v); e != nil {
				return nil, e
			}
			a.Knobs[key] = v
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
			if input := element("knob-" + key); exists(input) {
				input.Set("value", fmt.Sprint(v))
			}
			syncVariant()
			a.Change()
			return nil, a.idle()
		})
	})
	expose(audit, "control", func(args []js.Value) any {
		return promise(func() (any, error) {
			if len(args) < 2 {
				return nil, fmt.Errorf("missing control value")
			}
			input := element(args[0].String())
			if !exists(input) {
				return nil, fmt.Errorf("unknown control %s", args[0].String())
			}
			if input.Get("type").String() == "checkbox" {
				input.Set("checked", args[1].Truthy())
			} else {
				input.Set("value", args[1])
			}
			for _, kind := range []string{"input", "change"} {
				input.Call("dispatchEvent", js.Global().Get("Event").New(kind, js.ValueOf(map[string]any{"bubbles": true})))
			}
			return nil, a.idle()
		})
	})
	expose(audit, "capture", func(args []js.Value) any {
		return promise(func() (any, error) {
			rect := map[string]any{"x": 0., "y": 0., "width": 1024., "height": 1024.}
			if len(args) > 0 && exists(args[0]) {
				if e := fromJS(args[0], &rect); e != nil {
					return nil, e
				}
			}
			scale := 1.0
			if len(args) > 1 && args[1].Type() == js.TypeNumber {
				scale = args[1].Float()
			}
			if e := a.idle(); e != nil {
				return nil, e
			}
			start := time.Now()
			m, e := a.rpcJob(context.Background(), "view", renderjob.Tile{X: int(num(rect, "x", 0)), Y: int(num(rect, "y", 0)), Width: int(num(rect, "width", 1024)), Height: int(num(rect, "height", 1024)), Scale: scale})
			if e != nil {
				return nil, e
			}
			w, h := m.Get("width").Int(), m.Get("height").Int()
			canvas := create("canvas", "", "")
			canvas.Set("width", w)
			canvas.Set("height", h)
			arr := js.Global().Get("Uint8ClampedArray").New(m.Get("rgba"))
			canvas.Call("getContext", "2d").Call("putImageData", js.Global().Get("ImageData").New(arr, w, h), 0, 0)
			return js.ValueOf(map[string]any{"canvas": canvas, "ms": float64(time.Since(start)) / float64(time.Millisecond)}), nil
		})
	})
}
