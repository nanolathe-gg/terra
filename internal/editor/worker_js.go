//go:build js && wasm

package editor

import (
	"context"
	"encoding/binary"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"syscall/js"
	"time"

	"github.com/nanolathe-gg/terraform/internal/renderjob"
)

type cachedTile struct {
	Heights                                     []float32
	HeightWidth, HeightHeight                   int
	HeightOriginX, HeightOriginY, HeightSpacing float64
	Revision                                    int
	Canvas                                      js.Value
	X, Y, Width, Height                         int
	Scale                                       float64
	Used                                        time.Time
	Bytes                                       int
}

type workerViewState struct{ session int }

var workerViews = map[*App]*workerViewState{}

func (a *App) viewState() *workerViewState {
	s := workerViews[a]
	if s == nil {
		s = &workerViewState{}
		workerViews[a] = s
	}
	return s
}
func (a *App) terrainGesture() bool {
	return a.controlEditing || a.gesture != nil && a.gesture.Kind != "pan"
}
func (a *App) acceptsViewTile(m js.Value) bool {
	return m.Get("view").Type() == js.TypeBoolean && m.Get("view").Bool() && exists(m.Get("session")) && m.Get("session").Int() == a.viewState().session
}
func (a *App) startWorker() {
	workerViews[a] = &workerViewState{}
	a.tiles = map[string]*cachedTile{}
	a.rpc = map[int]chan js.Value{}
	a.worker = js.Global().Get("Worker").New("/web/worker.js")
	on(a.worker, "error", func(e js.Value) {
		showError(fmt.Errorf("Terrain worker: %s", e.Get("message").String()))
		a.rendering = false
	})
	on(a.worker, "message", func(e js.Value) {
		m := e.Get("data")
		kind := m.Get("kind").String()
		id := 0
		if exists(m.Get("id")) {
			id = m.Get("id").Int()
		}
		if kind == "render-start" || kind == "tile" && (id == a.activeID || a.acceptsViewTile(m)) {
			detail := map[string]any{"phase": "start", "id": id, "revision": a.Revision}
			if kind == "tile" {
				detail["phase"] = "tile"
				// A received image belongs to the revision encoded in its key,
				// even if a newer pointer move has already changed live state.
				if key := m.Get("key"); exists(key) {
					if prefix, _, ok := strings.Cut(key.String(), "/"); ok {
						if revision, err := strconv.Atoi(prefix); err == nil {
							detail["revision"] = revision
						}
					}
				}
			}
			for _, key := range []string{"x", "y", "width", "height", "scale", "profile", "milliseconds"} {
				if exists(m.Get(key)) {
					detail[key] = m.Get(key)
				}
			}
			js.Global().Call("dispatchEvent", js.Global().Get("CustomEvent").New("terraform-render", js.ValueOf(map[string]any{"detail": js.ValueOf(detail)})))
		}
		if ch := a.rpc[id]; ch != nil {
			select {
			case ch <- m:
			default:
				showError(fmt.Errorf("Terrain worker response queue overflow."))
			}
			return
		}
		switch kind {
		case "booted":
			a.requestID++
			a.activeID = a.requestID
			a.viewState().session = a.requestID
			a.worker.Call("postMessage", jsObject(renderjob.Request{Kind: "init", ID: a.requestID, Session: a.viewState().session, Config: a.Config}))
		case "ready":
			a.workerReady = true
			text("status", "Go WebGPU worker ready · draw terrain with the existing tools.")
			disabled("export", false)
			a.Schedule()
		case "error":
			if id != a.activeID && id != 0 {
				return
			}
			showError(fmt.Errorf("%s", m.Get("error").String()))
			a.rendering = false
			text("status", "Terrain job failed. The recipe is retained.")
		case "tile":
			if id != a.activeID && !a.acceptsViewTile(m) {
				return
			}
			a.acceptTile(m)
		case "done":
			if id != a.activeID {
				return
			}
			a.rendering = false
			ms := m.Get("milliseconds").Float()
			a.frameTimes = append(a.frameTimes, ms)
			text("timing", fmt.Sprintf("Render %.0f ms", ms))
			text("status", "Terrain ready.")
			if a.rerender {
				a.rerender = false
				a.Schedule()
			}
		}
	})
}
func (a *App) drawOptions() map[string]any {
	return map[string]any{"Full": true, "Scree": number("scree") / 100, "RefinementSeed": a.RefinementSeed, "DepositSpread": number("deposit-spread") / 100, "Clay": checked("clay"), "AlternateLight": value("light") == "alternate", "Detail": number("relief") / 100, "Ring": number("mineral-ring") / 100, "RingSpread": number("ring-spread") / 100, "RingVariation": number("ring-variation") / 100, "MaterialWeathering": number("material-weathering") / 100, "TransitionDetail": number("transition-detail") / 100, "Weather": checked("weather") && checked("weathered-view")}
}
func (a *App) knobStrings() map[string]string {
	out := map[string]string{}
	for k, v := range a.Knobs {
		out[k] = fmt.Sprint(v)
	}
	return out
}
func (a *App) job(kind string, tiles []renderjob.Tile) renderjob.Request {
	a.requestID++
	options := a.drawOptions()
	if kind == "export" || kind == "heights" {
		options["Weather"] = checked("weather")
	}
	return renderjob.Request{Kind: kind, ID: a.requestID, Session: a.viewState().session, Revision: a.Revision, Config: a.Config, Nodes: a.Nodes, Knobs: a.knobStrings(), Colors: a.mergedColors(), Options: options, Tiles: tiles}
}
func (a *App) Schedule() {
	if !a.workerReady || a.Busy || a.view.Width < 1 {
		return
	}
	if a.scheduleTimer != nil {
		return
	}
	delay := 16 * time.Millisecond
	if a.terrainGesture() {
		delay = 4 * time.Millisecond
	}
	a.scheduleTimer = time.AfterFunc(delay, func() { a.scheduleTimer = nil; a.queueView() })
}
func (a *App) tileKey(x, y, w, h int, level float64) string {
	return fmt.Sprintf("%d/%d/%d/%d/%d/%g/%t/%t", a.Revision, x, y, w, h, level, checked("clay"), checked("weathered-view"))
}
func (a *App) queueView() {
	if a.Busy {
		return
	}
	scale := a.view.Scale
	if scale <= 0 {
		return
	}
	level := 1 / scale
	size := max(64, int(math.Ceil(256*level)))
	interactive := a.terrainGesture()
	if interactive {
		level *= 2
	}
	x0, y0 := int(math.Floor(a.view.X/float64(size)))*size, int(math.Floor(a.view.Y/float64(size)))*size
	x1, y1 := min(int(a.Width()), int(math.Ceil(a.view.X+float64(a.view.Width)/scale))), min(int(a.Height()), int(math.Ceil(a.view.Y+float64(a.view.Height)/scale)))
	tiles := []renderjob.Tile{}
	for y := max(0, y0); y < y1; y += size {
		for x := max(0, x0); x < x1; x += size {
			w, h := min(size, int(a.Width())-x), min(size, int(a.Height())-y)
			key := a.tileKey(x, y, w, h, level)
			if _, ok := a.tiles[key]; !ok {
				tiles = append(tiles, renderjob.Tile{Key: key, X: x, Y: y, Width: w, Height: h, Scale: level})
			}
		}
	}
	a.paintTiles()
	if len(tiles) == 0 {
		return
	}
	job := a.job("view", tiles)
	job.Interactive = interactive
	job.Options["Preview"] = a.view.Fit
	if interactive {
		job.Options["Full"] = false
		job.Options["Weather"] = false
		if hoverPoint != nil {
			projected := a.project(*hoverPoint)
			px, py := projected.X/a.view.Scale+a.view.X, projected.Y/a.view.Scale+a.view.Y
			distance := func(t renderjob.Tile) float64 {
				dx := math.Max(0, math.Max(float64(t.X)-px, px-float64(t.X+t.Width)))
				dy := math.Max(0, math.Max(float64(t.Y)-py, py-float64(t.Y+t.Height)))
				return dx*dx + dy*dy
			}
			sort.SliceStable(job.Tiles, func(i, j int) bool { return distance(job.Tiles[i]) < distance(job.Tiles[j]) })
		}
	}
	a.activeID = job.ID
	a.rendering = true
	a.worker.Call("postMessage", jsObject(job))
	text("status", "Rendering visible terrain…")
}
func (a *App) acceptTile(m js.Value) {
	w, h := m.Get("width").Int(), m.Get("height").Int()
	c := create("canvas", "", "")
	c.Get("dataset").Set("terrainTile", "true")
	c.Set("width", w)
	c.Set("height", h)
	bytes := js.Global().Get("Uint8ClampedArray").New(m.Get("rgba"))
	data := js.Global().Get("ImageData").New(bytes, w, h)
	c.Call("getContext", "2d").Call("putImageData", data, 0, 0)
	t := &cachedTile{Canvas: c, X: m.Get("x").Int(), Y: m.Get("y").Int(), Width: w, Height: h, Scale: m.Get("scale").Float(), Used: time.Now(), Bytes: w * h * 4, Revision: a.Revision}
	if exists(m.Get("revision")) {
		t.Revision = m.Get("revision").Int()
	}
	if exists(m.Get("heights")) {
		ha := js.Global().Get("Uint8Array").New(m.Get("heights"))
		hb := make([]byte, ha.Get("byteLength").Int())
		js.CopyBytesToGo(hb, ha)
		t.Heights = make([]float32, len(hb)/4)
		for i := range t.Heights {
			t.Heights[i] = math.Float32frombits(binary.LittleEndian.Uint32(hb[i*4:]))
		}
		t.HeightWidth = m.Get("heightWidth").Int()
		t.HeightHeight = m.Get("heightHeight").Int()
		t.HeightOriginX = m.Get("heightOriginX").Float()
		t.HeightOriginY = m.Get("heightOriginY").Float()
		t.HeightSpacing = m.Get("heightSpacing").Float()
		t.Bytes += len(hb)
	}
	a.tiles[m.Get("key").String()] = t
	a.trimTiles()
	a.paintTiles()
	a.refreshLandformSection()
}
func (a *App) trimTiles() {
	budget := 128 * 1024 * 1024
	if n := number("gpu-budget"); n >= 128 {
		budget = int(n) * 1024 * 1024 / 4
	}
	total := 0
	for _, t := range a.tiles {
		total += t.Bytes
	}
	for total > budget {
		oldest := ""
		var stamp time.Time
		for k, t := range a.tiles {
			if oldest == "" || t.Used.Before(stamp) {
				oldest, stamp = k, t.Used
			}
		}
		if oldest == "" {
			break
		}
		total -= a.tiles[oldest].Bytes
		delete(a.tiles, oldest)
	}
}
func (a *App) paintTiles() {
	g := element("terrain").Call("getContext", "2d")
	g.Set("fillStyle", "#172119")
	g.Call("fillRect", 0, 0, a.view.Width, a.view.Height)
	g.Set("imageSmoothingEnabled", false)
	// Keep the last complete picture underneath replacement tiles while edits bake.
	ordered := make([]*cachedTile, 0, len(a.tiles))
	for _, t := range a.tiles {
		ordered = append(ordered, t)
	}
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].Revision != ordered[j].Revision {
			return ordered[i].Revision < ordered[j].Revision
		}
		return math.Abs(ordered[i].Scale-1/a.view.Scale) > math.Abs(ordered[j].Scale-1/a.view.Scale)
	})
	for _, t := range ordered {
		x, y := (float64(t.X)-a.view.X)*a.view.Scale, (float64(t.Y)-a.view.Y)*a.view.Scale
		w, h := float64(t.Width)*t.Scale*a.view.Scale, float64(t.Height)*t.Scale*a.view.Scale
		if x+w < 0 || y+h < 0 || x > float64(a.view.Width) || y > float64(a.view.Height) {
			continue
		}
		t.Used = time.Now()
		g.Call("drawImage", t.Canvas, x, y, w, h)
	}

	a.drawOverlay()
	if a.view.Fit {
		nav := element("navigator")
		ng := nav.Call("getContext", "2d")
		ng.Call("clearRect", 0, 0, 200, 200)
		ng.Call("drawImage", element("terrain"), 0, 0, 200, 200)
	}
}
func (a *App) rpcJob(ctx context.Context, kind string, tile renderjob.Tile) (js.Value, error) {
	if !a.workerReady {
		return js.Undefined(), fmt.Errorf("Wait for the terrain worker.")
	}
	return a.rpcRequest(ctx, a.job(kind, []renderjob.Tile{tile}))
}
func (a *App) rpcRequest(ctx context.Context, job renderjob.Request) (js.Value, error) {
	a.rendering = false
	defer a.Schedule()
	ch := make(chan js.Value, 4)
	a.rpc[job.ID] = ch
	defer delete(a.rpc, job.ID)
	a.worker.Call("postMessage", jsObject(job))
	for {
		select {
		case <-ctx.Done():
			a.requestID++
			a.worker.Call("postMessage", jsObject(renderjob.Request{Kind: "cancel", ID: a.requestID}))
			return js.Undefined(), ctx.Err()
		case msg := <-ch:
			switch msg.Get("kind").String() {
			case "error":
				return js.Undefined(), fmt.Errorf("%s", msg.Get("error").String())
			case "exportTile", "heights", "tile", "check", "authored", "uniforms", "fill", "ghost":
				return msg, nil
			}
		}
	}
}
func (a *App) ExportHeights(ctx context.Context) ([]int, int, error) {
	wc, hc := int(num(a.Map(), "widthCells", 0)), int(num(a.Map(), "heightCells", 0))
	heights := make([]int, wc*hc)
	clipped := 0
	for y := 0; y < hc; y += 32 {
		for x := 0; x < wc; x += 32 {
			cw, ch := min(32, wc-x), min(32, hc-y)
			m, e := a.rpcJob(ctx, "heights", renderjob.Tile{X: x * 16, Y: y * 16, Width: cw * 16, Height: ch * 16, Scale: 1})
			if e != nil {
				return nil, 0, e
			}
			values := m.Get("values")
			if values.Length() != cw*ch {
				return nil, 0, fmt.Errorf("Unexpected exported height count.")
			}
			for j := 0; j < ch; j++ {
				for i := 0; i < cw; i++ {
					heights[(y+j)*wc+x+i] = values.Index(j*cw + i).Int()
				}
			}
			clipped += m.Get("clipped").Int()
		}
	}
	return heights, clipped, nil
}
func (a *App) ExportChunks(ctx context.Context, onChunk func(x, y, width, height int, png []byte, index, total int) error) error {
	width, height := int(a.Width()), int(a.Height())
	size := 512
	total := ((width + size - 1) / size) * ((height + size - 1) / size)
	index := 0
	for y := 0; y < height; y += size {
		for x := 0; x < width; x += size {
			w, h := min(size, width-x), min(size, height-y)
			m, e := a.rpcJob(ctx, "export", renderjob.Tile{X: x, Y: y, Width: w, Height: h, Scale: 1})
			if e != nil {
				return e
			}
			arr := js.Global().Get("Uint8Array").New(m.Get("png"))
			b := make([]byte, arr.Get("byteLength").Int())
			js.CopyBytesToGo(b, arr)
			if e = onChunk(x, y, w, h, b, index, total); e != nil {
				return e
			}
			index++
		}
	}
	return nil
}
