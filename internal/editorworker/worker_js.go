//go:build js && wasm

// Package editorworker runs terrain jobs away from the DOM/input thread.
package editorworker

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"math"
	"net/http"
	"syscall/js"
	"time"

	"github.com/nanolathe-gg/terraform/internal/renderjob"
	"github.com/nanolathe-gg/terraform/internal/terrain"
)

var callback js.Func
var jobs = make(chan renderjob.Request, 1)
var cancel context.CancelFunc
var generation int

func post(m map[string]any) { js.Global().Call("postMessage", js.ValueOf(m)) }
func sendBytes(m map[string]any, key string, data []byte) {
	arr := js.Global().Get("Uint8Array").New(len(data))
	js.CopyBytesToJS(arr, data)
	m[key] = arr.Get("buffer")
	js.Global().Call("postMessage", js.ValueOf(m), js.ValueOf([]any{arr.Get("buffer")}))
}
func Run() {
	callback = js.FuncOf(func(_ js.Value, args []js.Value) any {
		var job renderjob.Request
		b := js.Global().Get("JSON").Call("stringify", args[0].Get("data")).String()
		if err := json.Unmarshal([]byte(b), &job); err != nil {
			post(map[string]any{"kind": "error", "error": err.Error()})
			return nil
		}
		generation = job.ID
		if cancel != nil {
			cancel()
		}
		select {
		case <-jobs:
		default:
		}
		jobs <- job
		return nil
	})
	js.Global().Set("onmessage", callback)
	go loop()
	post(map[string]any{"kind": "booted"})
}
func load(path string, out any) error {
	origin := js.Global().Get("location").Get("origin").String()
	r, e := http.Get(origin + path)
	if e != nil {
		return e
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return fmt.Errorf("%s: HTTP %d", path, r.StatusCode)
	}
	b, e := io.ReadAll(r.Body)
	if e != nil {
		return e
	}
	if s, ok := out.(*string); ok {
		*s = string(b)
		return nil
	}
	return json.Unmarshal(b, out)
}
func loop() {
	var engine *terrain.SceneRenderer
	var gpu *terrain.GPU
	var config map[string]any
	for job := range jobs {
		ctx, c := context.WithCancel(context.Background())
		cancel = c
		func() {
			defer func() {
				if p := recover(); p != nil {
					post(map[string]any{"kind": "error", "id": job.ID, "error": fmt.Sprint(p)})
				}
			}()
			if job.Kind == "init" {
				config = job.Config
				sources := map[string]string{}
				for _, name := range []string{"engine-common.wgsl", "engine-shape.wgsl", "engine-feed.wgsl", "engine-erosion.wgsl", "engine-frag.wgsl", "engine-bake.wgsl", "engine-materials.wgsl", "engine-palette.wgsl", "engine-weather.wgsl", "sculpt-vert.wgsl", "materials/palette.json", "materials/green.json", "materials/red.json", "materials/archipelago.json", "materials/moon.json", "materials/zhon.json", "materials/lava.json", "materials/desert.json", "materials/crystal.json", "materials/ice.json"} {
					var source string
					if e := load("/"+name, &source); e != nil {
						post(map[string]any{"kind": "error", "id": job.ID, "error": e.Error()})
						return
					}
					sources[name] = source
				}
				var material map[string]any
				path, _ := config["materialTable"].(string)
				if path == "" {
					world, _ := config["biomeId"].(string)
					path = "/materials/" + world + ".json"
				}
				if e := load(path, &material); e != nil {
					post(map[string]any{"kind": "error", "id": job.ID, "error": e.Error()})
					return
				}
				var e error
				gpu, e = terrain.NewGPU()
				if e == nil {
					gpu.OnError = func(err error) { post(map[string]any{"kind": "error", "id": generation, "error": err.Error()}) }
				}
				if e == nil {
					engine, e = terrain.NewSceneRenderer(gpu, config, sources, material)
				}
				if e != nil {
					post(map[string]any{"kind": "error", "id": job.ID, "error": e.Error()})
					return
				}
				post(map[string]any{"kind": "ready", "id": job.ID})
				return
			}
			if engine == nil {
				post(map[string]any{"kind": "error", "id": job.ID, "error": "The GPU worker is not initialized."})
				return
			}
			if job.Kind == "cancel" {
				return
			}
			if job.Kind == "authored" {
				if len(job.Tiles) != 1 {
					post(map[string]any{"kind": "error", "id": job.ID, "error": "Expected one cell window."})
					return
				}
				t := job.Tiles[0]
				r, e := engine.ReadAuthored(ctx, job.Nodes, job.Knobs, terrain.CellRect{X0: t.X, Y0: t.Y, X1: t.X + t.Width - 1, Y1: t.Y + t.Height - 1})
				if e != nil {
					post(map[string]any{"kind": "error", "id": job.ID, "error": e.Error()})
					return
				}
				count := r.Width * r.Height
				data := make([]byte, count*49)
				at := 0
				for _, plane := range r.Planes {
					for _, v := range plane {
						binary.LittleEndian.PutUint32(data[at:], math.Float32bits(v))
						at += 4
					}
				}
				for _, plane := range r.Masks {
					for _, v := range plane {
						data[at] = byte(v)
						at++
					}
				}
				sendBytes(map[string]any{"kind": "authored", "id": job.ID, "width": r.Width, "height": r.Height}, "data", data)
				return
			}
			if job.Kind == "check" {
				r, e := engine.CompareRegions(ctx, job.Nodes, job.Knobs)
				if e != nil {
					post(map[string]any{"kind": "error", "id": job.ID, "error": e.Error()})
				} else {
					b, _ := json.Marshal(r)
					v := js.Global().Get("JSON").Call("parse", string(b))
					post(map[string]any{"kind": "check", "id": job.ID, "result": v})
				}
				return
			}
			if err := engine.UpdateConfig(job.Config); err != nil {
				post(map[string]any{"kind": "error", "id": job.ID, "error": err.Error()})
				return
			}
			var options terrain.DrawOptions
			b, _ := json.Marshal(job.Options)
			_ = json.Unmarshal(b, &options)
			start := time.Now()
			for index, tile := range job.Tiles {
				if ctx.Err() != nil || generation != job.ID {
					return
				}
				tileStart := time.Now()
				post(map[string]any{"kind": "render-start", "id": job.ID, "x": tile.X, "y": tile.Y, "width": tile.Width, "height": tile.Height, "scale": tile.Scale})
				r, e := engine.Render(ctx, job.Nodes, job.Knobs, job.Colors, terrain.SceneWindow{X: tile.X, Y: tile.Y, Width: tile.Width, Height: tile.Height, Scale: tile.Scale, Preview: job.Kind == "view" && tile.Scale > 1, ExportArt: job.Kind == "export", ReadHeights: job.Kind != "export"}, options)
				if e != nil {
					if ctx.Err() == nil {
						post(map[string]any{"kind": "error", "id": job.ID, "error": e.Error()})
					}
					return
				}
				if ctx.Err() != nil || generation != job.ID {
					return
				}
				m := map[string]any{"kind": "tile", "id": job.ID, "key": tile.Key, "x": tile.X, "y": tile.Y, "width": r.Width, "height": r.Height, "scale": tile.Scale, "index": index, "total": len(job.Tiles)}
				profile, _ := json.Marshal(engine.LastRenderProfile())
				m["profile"] = js.Global().Get("JSON").Call("parse", string(profile))
				m["milliseconds"] = float64(time.Since(tileStart).Microseconds()) / 1000
				if job.Kind == "export" {
					img := &image.RGBA{Pix: r.RGBA, Stride: r.Width * 4, Rect: image.Rect(0, 0, r.Width, r.Height)}
					var buf bytes.Buffer
					if e := png.Encode(&buf, img); e != nil {
						post(map[string]any{"kind": "error", "id": job.ID, "error": e.Error()})
						return
					}
					m["kind"] = "exportTile"
					sendBytes(m, "png", buf.Bytes())
				} else if job.Kind == "heights" {
					values := []any{}
					clipped := 0
					wc := (tile.Width + 15) / 16
					hc := (tile.Height + 15) / 16
					for y := 0; y < hc; y++ {
						for x := 0; x < wc; x++ {
							fx, fy := (float64(tile.X+x*16)-r.HeightOriginX)/r.HeightSpacing, (float64(tile.Y+y*16)-r.HeightOriginY)/r.HeightSpacing
							ix, iy := int(math.Floor(fx)), int(math.Floor(fy))
							if ix < 0 || iy < 0 || ix >= r.HeightWidth || iy >= r.HeightHeight {
								post(map[string]any{"kind": "error", "id": job.ID, "error": "Export height patch does not cover map cell corners."})
								return
							}
							jx, jy := min(ix+1, r.HeightWidth-1), min(iy+1, r.HeightHeight-1)
							tx, ty := fx-float64(ix), fy-float64(iy)
							at := func(x, y int) float64 { return float64(r.Heights[y*r.HeightWidth+x]) }
							v := (at(ix, iy)*(1-tx)+at(jx, iy)*tx)*(1-ty) + (at(ix, jy)*(1-tx)+at(jx, jy)*tx)*ty
							if v < 0 || v > 255 {
								clipped++
							}
							values = append(values, int(math.Floor(max(0, min(255, v))+.5)))
						}
					}
					post(map[string]any{"kind": "heights", "id": job.ID, "values": values, "clipped": clipped, "columns": wc, "rows": hc})
				} else {
					rgba := js.Global().Get("Uint8Array").New(len(r.RGBA))
					js.CopyBytesToJS(rgba, r.RGBA)
					hb := make([]byte, len(r.Heights)*4)
					for i, h := range r.Heights {
						binary.LittleEndian.PutUint32(hb[i*4:], math.Float32bits(h))
					}
					heights := js.Global().Get("Uint8Array").New(len(hb))
					js.CopyBytesToJS(heights, hb)
					m["rgba"] = rgba.Get("buffer")
					m["heights"] = heights.Get("buffer")
					m["heightWidth"] = r.HeightWidth
					m["heightHeight"] = r.HeightHeight
					m["heightOriginX"] = r.HeightOriginX
					m["heightOriginY"] = r.HeightOriginY
					m["heightSpacing"] = r.HeightSpacing
					js.Global().Call("postMessage", js.ValueOf(m), js.ValueOf([]any{rgba.Get("buffer"), heights.Get("buffer")}))
				}
				// A browser task yield lets cancellation/new view messages run between tiles.
				time.Sleep(time.Millisecond)
			}
			post(map[string]any{"kind": "done", "id": job.ID, "milliseconds": float64(time.Since(start).Microseconds()) / 1000})
		}()
		c()
		cancel = nil
	}
}
func nestedNumber(m map[string]any, k, p string) float64 {
	v, _ := m[k].(map[string]any)
	n, _ := v[p].(float64)
	return n
}
