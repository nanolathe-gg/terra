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
	"sort"
	"syscall/js"
	"time"

	"github.com/nanolathe-gg/terraform/internal/model"
	"github.com/nanolathe-gg/terraform/internal/renderjob"
	"github.com/nanolathe-gg/terraform/internal/terrain"
)

var callback js.Func
var jobs = renderjob.NewQueue()
var activeKind string
var activeSession int
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
		if cancel != nil && !renderjob.FinishViewTile(activeKind, activeSession, job) {
			cancel()
		}
		if dropped := jobs.Submit(job); dropped != nil && dropped.Kind != "view" && dropped.Kind != "cancel" {
			post(map[string]any{"kind": "error", "id": dropped.ID, "canceled": true, "error": context.Canceled.Error()})
		}
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
	for job := range jobs.Pending() {
		activeKind, activeSession = job.Kind, job.Session
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
			if job.Kind == "uniforms" {
				b, _ := json.Marshal(engine.UniformSnapshot())
				post(map[string]any{"kind": "uniforms", "id": job.ID, "result": js.Global().Get("JSON").Call("parse", string(b))})
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
			if job.Kind == "ghost" {
				values, err := sampleAuthoredPoints(ctx, engine, job)
				if err != nil {
					if ctx.Err() == nil {
						post(map[string]any{"kind": "error", "id": job.ID, "error": err.Error()})
					}
					return
				}
				if ctx.Err() != nil || generation != job.ID {
					return
				}
				post(map[string]any{"kind": "ghost", "id": job.ID, "values": values})
				return
			}
			if job.Kind == "fill" {
				f := job.Fill
				if f == nil || f.Cols < 1 || f.Rows < 1 || f.Cols > 1280 || f.Rows > 1280 {
					post(map[string]any{"kind": "error", "id": job.ID, "error": "Invalid fill dimensions."})
					return
				}
				bounds, err := model.FeatureRegionBounds(f.Region, f.Cols, f.Rows, f.Settings.Radius)
				if err != nil {
					post(map[string]any{"kind": "error", "id": job.ID, "error": err.Error()})
					return
				}
				width, height := bounds.X1-bounds.X0+1, bounds.Z1-bounds.Z0+1
				values := make([]float32, width*height)
				for z := bounds.Z0; z < bounds.Z1; z += 32 {
					for x := bounds.X0; x < bounds.X1; x += 32 {
						if ctx.Err() != nil || generation != job.ID {
							return
						}
						cw, ch := min(32, bounds.X1-x), min(32, bounds.Z1-z)
						r, err := engine.Render(ctx, job.Nodes, job.Knobs, job.Colors, terrain.SceneWindow{X: x * 16, Y: z * 16, Width: cw * 16, Height: ch * 16, Scale: 1, ReadHeights: true, HeightsOnly: true}, options)
						if err != nil {
							if ctx.Err() == nil {
								post(map[string]any{"kind": "error", "id": job.ID, "error": err.Error()})
							}
							return
						}
						for j := 0; j <= ch; j++ {
							for i := 0; i <= cw; i++ {
								fx, fy := (float64((x+i)*16)-r.HeightOriginX)/r.HeightSpacing, (float64((z+j)*16)-r.HeightOriginY)/r.HeightSpacing
								ix, iy := int(math.Floor(fx)), int(math.Floor(fy))
								if ix < 0 || iy < 0 || ix >= r.HeightWidth || iy >= r.HeightHeight {
									post(map[string]any{"kind": "error", "id": job.ID, "error": "Fill height patch does not cover map cell corners."})
									return
								}
								jx, jy := min(ix+1, r.HeightWidth-1), min(iy+1, r.HeightHeight-1)
								tx, ty := fx-float64(ix), fy-float64(iy)
								at := func(x, y int) float64 { return float64(r.Heights[y*r.HeightWidth+x]) }
								values[(z+j-bounds.Z0)*width+x+i-bounds.X0] = float32((at(ix, iy)*(1-tx)+at(jx, iy)*tx)*(1-ty) + (at(ix, jy)*(1-tx)+at(jx, jy)*tx)*ty)
							}
						}
						time.Sleep(time.Millisecond)
					}
				}
				sample := func(x, z float64) float64 {
					i, j := int(x/16)-bounds.X0, int(z/16)-bounds.Z0
					if i < 0 || j < 0 || i >= width || j >= height {
						return math.NaN()
					}
					return float64(values[j*width+i])
				}
				yield := func() error {
					time.Sleep(time.Millisecond)
					if generation != job.ID {
						return context.Canceled
					}
					return ctx.Err()
				}
				placed, err := model.FillFeaturesYield(f.Cols, f.Rows, f.Sea, sample, f.Definitions, f.Existing, f.Starts, f.DepositName, f.Region, f.Settings, yield)
				if err != nil {
					if ctx.Err() == nil && generation == job.ID {
						post(map[string]any{"kind": "error", "id": job.ID, "error": err.Error()})
					}
					return
				}
				b, _ := json.Marshal(placed)
				post(map[string]any{"kind": "fill", "id": job.ID, "placements": js.Global().Get("JSON").Call("parse", string(b))})
				return
			}
			start := time.Now()
			for index, tile := range job.Tiles {
				if ctx.Err() != nil || generation != job.ID {
					return
				}
				tileStart := time.Now()
				post(map[string]any{"kind": "render-start", "id": job.ID, "x": tile.X, "y": tile.Y, "width": tile.Width, "height": tile.Height, "scale": tile.Scale, "session": job.Session, "revision": job.Revision})
				r, e := engine.Render(ctx, job.Nodes, job.Knobs, job.Colors, terrain.SceneWindow{X: tile.X, Y: tile.Y, Width: tile.Width, Height: tile.Height, Scale: tile.Scale, Preview: job.Kind == "view" && job.Options["Preview"] == true, ExportArt: job.Kind == "export", ReadHeights: job.Kind != "export", HeightsOnly: job.Kind == "heights"}, options)
				if e != nil {
					if ctx.Err() == nil {
						post(map[string]any{"kind": "error", "id": job.ID, "error": e.Error()})
					}
					return
				}
				if ctx.Err() != nil || generation != job.ID && job.Kind != "view" {
					return
				}
				m := map[string]any{"kind": "tile", "id": job.ID, "key": tile.Key, "x": tile.X, "y": tile.Y, "width": r.Width, "height": r.Height, "scale": tile.Scale, "index": index, "total": len(job.Tiles), "session": job.Session, "revision": job.Revision, "view": job.Kind == "view", "preview": job.Interactive}
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
				// Deliver the bounded current tile even when a newer view arrived.
				// The next loop immediately consumes only the latest pending snapshot.
				if generation != job.ID {
					return
				}
				time.Sleep(time.Millisecond)
			}
			post(map[string]any{"kind": "done", "id": job.ID, "session": job.Session, "milliseconds": float64(time.Since(start).Microseconds()) / 1000})
		}()
		if ctx.Err() != nil && job.Kind != "view" && job.Kind != "cancel" {
			post(map[string]any{"kind": "error", "id": job.ID, "canceled": true, "error": ctx.Err().Error()})
		}
		c()
		cancel = nil
		activeKind = ""
	}
}
func nestedNumber(m map[string]any, k, p string) float64 {
	v, _ := m[k].(map[string]any)
	n, _ := v[p].(float64)
	return n
}

// sampleAuthoredPoints replays only bounded native-grid windows around the
// requested points. It shares the editor's GPU engine and is cancelable at
// every window so foreground view work can preempt the passive preview.
func sampleAuthoredPoints(ctx context.Context, engine *terrain.SceneRenderer, job renderjob.Request) ([]any, error) {
	size, _ := job.Config["size"].(float64)
	gridValue, _ := job.Config["grid"].(float64)
	grid := int(gridValue)
	if size < 2 || grid < 2 || grid > 10500 || len(job.Points) > 1024 {
		return nil, fmt.Errorf("Invalid authored sample request.")
	}
	spacing := (size - 1) / float64(grid-1)
	type key struct{ x, y int }
	groups := map[key][]int{}
	keys := []key{}
	coords := make([][2]float64, len(job.Points))
	for i, p := range job.Points {
		if math.IsNaN(p.X) || math.IsInf(p.X, 0) || math.IsNaN(p.Y) || math.IsInf(p.Y, 0) {
			return nil, fmt.Errorf("Invalid authored sample point.")
		}
		gx, gy := math.Max(0, math.Min(float64(grid-1), p.X/spacing)), math.Max(0, math.Min(float64(grid-1), p.Y/spacing))
		coords[i] = [2]float64{gx, gy}
		k := key{int(math.Floor(gx)) / 64, int(math.Floor(gy)) / 64}
		if _, ok := groups[k]; !ok {
			keys = append(keys, k)
		}
		groups[k] = append(groups[k], i)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i].y < keys[j].y || keys[i].y == keys[j].y && keys[i].x < keys[j].x })
	values := make([]any, len(job.Points))
	for _, k := range keys {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		x0, y0 := k.x*64, k.y*64
		x1, y1 := min(grid-1, x0+64), min(grid-1, y0+64)
		r, err := engine.ReadAuthored(ctx, job.Nodes, job.Knobs, terrain.CellRect{X0: x0, Y0: y0, X1: x1, Y1: y1})
		if err != nil {
			return nil, err
		}
		for _, i := range groups[k] {
			gx, gy := coords[i][0], coords[i][1]
			ix, iy := int(math.Floor(gx)), int(math.Floor(gy))
			jx, jy := min(ix+1, grid-1), min(iy+1, grid-1)
			fx, fy := gx-float64(ix), gy-float64(iy)
			at := func(x, y int) float64 { return float64(r.Planes[0][(y-y0)*r.Width+x-x0]) }
			values[i] = (at(ix, iy)*(1-fx)+at(jx, iy)*fx)*(1-fy) + (at(ix, jy)*(1-fx)+at(jx, jy)*fx)*fy
		}
		time.Sleep(time.Millisecond)
	}
	return values, nil
}
