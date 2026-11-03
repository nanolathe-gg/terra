//go:build js && wasm

package editor

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"syscall/js"
	"time"

	"github.com/nanolathe-gg/terraform/internal/membudget"
	"github.com/nanolathe-gg/terraform/internal/model"
	"github.com/nanolathe-gg/terraform/internal/renderjob"
	"github.com/nanolathe-gg/terraform/internal/terrain"
)

type cachedTile struct {
	Presented                                   bool
	JobID, Session                              int
	Heights                                     []float32
	HeightWidth, HeightHeight                   int
	HeightOriginX, HeightOriginY, HeightSpacing float64
	Revision                                    int
	ValidRevision                               int
	Input                                       model.Rect
	Canvas                                      js.Value
	X, Y, Width, Height                         int
	Scale                                       float64
	Used                                        time.Time
	Bytes                                       int
}

type workerViewState struct {
	inFlightBitmapBytes int64
	session             int
	nodes               []model.Node
	visual              string
	revision            int
	initialized         bool
}

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

// Match the editor's navigation quiet period; full weather and picking
// refresh resume after the final scroll or drag has settled.
func (a *App) navigationChanged() {
	a.navigationSequence++
	sequence := a.navigationSequence
	a.navigating = true
	if a.navigationTimer != nil {
		a.navigationTimer.Stop()
	}
	a.navigationTimer = time.AfterFunc(180*time.Millisecond, func() {
		if a.navigationSequence != sequence {
			return
		}
		a.navigationTimer = nil
		a.navigating = false
		a.Schedule()
	})
}
func (a *App) navigationPreview() bool {
	return a.navigating || a.navigatorDragging || a.gesture != nil && a.gesture.Kind == "pan"
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
	worker := a.worker
	on(a.worker, "message", func(e js.Value) {
		m := e.Get("data")
		kind := m.Get("kind").String()
		// Admission acknowledgments are independent of terrain generations. Even a
		// rejected/stale bitmap must release the worker's one in-flight allowance.
		if kind == "tile" && exists(m.Get("bitmap")) && exists(m.Get("bitmapToken")) {
			defer func() {
				worker.Call("postMessage", js.ValueOf(map[string]any{"kind": "bitmap-ack", "token": m.Get("bitmapToken"), "uiBitmapBytes": a.liveBitmapBytes()}))
			}()
		}

		id := 0
		if exists(m.Get("id")) {
			id = m.Get("id").Int()
		}
		if kind == "render-start" || kind == "tile" && (id == a.activeID || a.acceptsViewTile(m)) {
			detail := map[string]any{"phase": "start", "id": id, "revision": a.Revision, "uiReceivedAt": clockMilliseconds()}
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
			for _, key := range []string{"x", "y", "width", "height", "scale", "profile", "milliseconds", "sentAt", "receivedAt", "startedAt", "renderedAt", "presentedAt"} {
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
			a.postRequest(renderjob.Request{Kind: "init", ID: a.requestID, Session: a.viewState().session, Config: a.Config})
		case "ready":
			a.workerReady = true
			text("status", "Terrain ready. Draw a shape to begin.")
			disabled("export", false)
			a.Schedule()
		case "error":
			if id != a.activeID && id != 0 {
				return
			}
			showError(fmt.Errorf("%s", m.Get("error").String()))
			a.rendering = false
			text("status", "Terrain job failed. The recipe is retained.")
		case "heightPatch":
			if id == a.activeID {
				a.acceptHeightPatch(m)
			}
		case "tile":
			if id != a.activeID && !a.acceptsViewTile(m) {
				if exists(m.Get("bitmap")) {
					m.Get("bitmap").Call("close")
				}
				return
			}
			a.acceptTile(m)
		case "done":
			if id != a.activeID {
				return
			}
			a.rendering = false
			a.viewState().inFlightBitmapBytes = 0
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
	return renderjob.Request{SentAt: clockMilliseconds(), Kind: kind, ID: a.requestID, Session: a.viewState().session, Revision: a.Revision, Config: a.workerConfig(kind, tiles), Nodes: a.Nodes, Knobs: a.knobStrings(), Colors: a.mergedColors(), Options: options, Tiles: tiles}
}
func (a *App) Schedule() {
	if !a.workerReady || a.Busy || a.view.Width < 1 || auditCaptureOnly {
		return
	}
	if a.scheduleQueued {
		return
	}
	a.scheduleQueued = true
	var callback js.Func
	callback = js.FuncOf(func(_ js.Value, _ []js.Value) any {
		defer callback.Release()
		a.scheduleQueued = false
		a.queueView()
		return nil
	})
	js.Global().Call("queueMicrotask", callback)
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
	interactive := a.terrainGesture() || a.navigationPreview()
	a.retainUnaffectedTiles(interactive)
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
			if _, ok := a.tiles[key]; !ok && !a.hasCurrentDetail(x, y, w, h, level) {
				tiles = append(tiles, renderjob.Tile{Key: key, X: x, Y: y, Width: w, Height: h, Scale: level})
			}
		}
	}
	a.paintTiles()
	var heightTiles []renderjob.Tile
	if !interactive && !a.view.Fit {
		span := 256
		gpuBytes := membudget.FromConfig(a.Config).GPU
		if gpuBytes >= 512*1024*1024 {
			span = 2048
		} else if gpuBytes >= 256*1024*1024 {
			span = 512
		}
		heightTiles = renderjob.MissingHeightTiles(int(math.Floor(a.view.X)), int(math.Floor(a.view.Y)), x1, y1, int(a.Width()), int(a.Height()), a.Revision, span, func(key string) bool {
			t := a.tiles[key]
			return t != nil && t.Revision == a.Revision && len(t.Heights) > 0
		})
	}
	if len(tiles) == 0 && len(heightTiles) == 0 {
		return
	}
	job := a.job("view", tiles)
	job.HeightTiles = heightTiles
	job.Interactive = interactive
	job.Options["Preview"] = a.view.Fit
	if interactive {
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
	for _, tile := range job.Tiles {
		if n, err := membudget.BitmapBytes(tile.Width, tile.Height, tile.Scale); err == nil {
			a.viewState().inFlightBitmapBytes = max(a.viewState().inFlightBitmapBytes, n)
		}
	}
	a.activeID = job.ID
	a.rendering = true
	a.postRequest(job)
	text("status", "Rendering visible terrain…")
}
func (a *App) acceptTile(m js.Value) {
	w, h := m.Get("width").Int(), m.Get("height").Int()
	limits := membudget.FromConfig(a.Config)
	incoming := membudget.Area(w, h, 4)
	if exists(m.Get("heights")) {
		incoming += int64(m.Get("heights").Get("byteLength").Int())
	}
	if err := membudget.Require("Terrain tile transfer", incoming*3, limits.Transfer()); err != nil {
		if exists(m.Get("bitmap")) {
			m.Get("bitmap").Call("close")
		}
		showError(err)
		return
	}
	// Drop old browser backing stores before allocating the incoming canvas and
	// float heights; transfer copies fit in the separately reserved headroom.
	a.trimTilesTo(max(0, a.tileBudget()-int(incoming)))
	var c js.Value
	if exists(m.Get("bitmap")) {
		c = m.Get("bitmap")
	} else {
		c = create("canvas", "", "")
		c.Get("dataset").Set("terrainTile", "true")
		c.Set("width", w)
		c.Set("height", h)
		bytes := js.Global().Get("Uint8ClampedArray").New(m.Get("rgba"))
		data := js.Global().Get("ImageData").New(bytes, w, h)
		c.Call("getContext", "2d").Call("putImageData", data, 0, 0)
	}
	t := &cachedTile{Canvas: c, X: m.Get("x").Int(), Y: m.Get("y").Int(), Width: w, Height: h, Scale: m.Get("scale").Float(), Used: time.Now(), Bytes: w * h * 4, Revision: a.Revision}
	if exists(m.Get("revision")) {
		t.Revision = m.Get("revision").Int()
	}
	t.ValidRevision = t.Revision
	t.JobID = m.Get("id").Int()
	if exists(m.Get("session")) {
		t.Session = m.Get("session").Int()
	}
	if exists(m.Get("inputX")) {
		t.Input = model.Rect{X: m.Get("inputX").Float(), Y: m.Get("inputY").Float(), Width: m.Get("inputWidth").Float(), Height: m.Get("inputHeight").Float()}
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
	// A replacement at the same resolution owns the previous tile's coverage.
	// Keeping every edit revision wastes backing stores and redraws hidden images.
	for key, old := range a.tiles {
		if exists(old.Canvas) && old.X == t.X && old.Y == t.Y && old.Width == t.Width && old.Height == t.Height && old.Scale == t.Scale {
			if old.Revision > t.Revision {
				releaseTile(t)
				return
			}
			releaseTile(old)
			delete(a.tiles, key)
		}
	}
	a.tiles[m.Get("key").String()] = t
	a.trimTiles()
	a.paintTiles()
	a.refreshLandformSection()
}
func (a *App) trimTiles() {
	a.trimTilesTo(a.tileBudget())
}
func (a *App) trimTilesTo(budget int) {
	entries := make([]membudget.Entry, 0, len(a.tiles))
	for key, t := range a.tiles {
		entries = append(entries, membudget.Entry{Key: key, Bytes: int64(t.Bytes), Used: t.Used.UnixNano()})
	}
	for _, key := range membudget.Evictions(entries, int64(budget)) {
		t := a.tiles[key]
		releaseTile(t)
		delete(a.tiles, key)
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
	presented := []map[string]any{}
	for _, t := range ordered {
		if !exists(t.Canvas) {
			continue
		}
		x, y := (float64(t.X)-a.view.X)*a.view.Scale, (float64(t.Y)-a.view.Y)*a.view.Scale
		w, h := float64(t.Width)*t.Scale*a.view.Scale, float64(t.Height)*t.Scale*a.view.Scale
		if x+w < 0 || y+h < 0 || x > float64(a.view.Width) || y > float64(a.view.Height) {
			continue
		}
		t.Used = time.Now()
		g.Call("drawImage", t.Canvas, x, y, w, h)
		if !t.Presented {
			t.Presented = true
			presented = append(presented, map[string]any{"phase": "presented", "id": t.JobID, "session": t.Session, "revision": t.Revision, "x": t.X, "y": t.Y, "width": float64(t.Width) * t.Scale, "height": float64(t.Height) * t.Scale, "scale": t.Scale, "screenX": x, "screenY": y, "screenWidth": w, "screenHeight": h})
		}
	}
	for _, detail := range presented {
		js.Global().Call("dispatchEvent", js.Global().Get("CustomEvent").New("terraform-render", js.ValueOf(map[string]any{"detail": js.ValueOf(detail)})))
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
	job.RPC = true
	a.rendering = false
	defer a.Schedule()
	ch := make(chan js.Value, 4)
	a.rpc[job.ID] = ch
	defer delete(a.rpc, job.ID)
	a.postRequest(job)
	for {
		select {
		case <-ctx.Done():
			a.requestID++
			a.postRequest(renderjob.Request{Kind: "cancel", ID: a.requestID})
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

// Tile backing stores count against both the UI heap partition and GPU headroom.
func (a *App) tileBudget() int {
	l := membudget.FromConfig(a.Config)
	return int(min(l.Cache(), l.GPU/4))
}
func (a *App) workerConfig(kind string, tiles []renderjob.Tile) map[string]any {
	a.trimTiles()
	// Immutable world tables and export catalogs are sent only by init.
	// Every replaceable job includes all mutable renderer settings, so dropping
	// an older queued job cannot lose a configuration change.
	c := make(map[string]any, 12)
	for _, k := range []string{"size", "grid", "column", "gpuMB", "gpuBudgetBytes", "gpuBudgetMB", "heapMB", "heapBudgetBytes", "heapBudgetMB"} {
		if v, ok := a.Config[k]; ok {
			c[k] = v
		}
	}
	bytes := a.liveBitmapBytes()
	outputs := []int64{}
	if kind == "view" {
		for _, tile := range tiles {
			n, err := membudget.BitmapBytes(tile.Width, tile.Height, tile.Scale)
			if err != nil {
				showError(err)
				n = math.MaxInt64
			}
			outputs = append(outputs, n)
		}
	}
	c["uiBitmapBytes"] = membudget.ProjectedBitmapResident(membudget.FromConfig(a.Config), bytes, a.viewState().inFlightBitmapBytes, outputs)
	return c
}
func (a *App) liveBitmapBytes() int64 {
	var bytes int64
	for _, t := range a.tiles {
		if exists(t.Canvas) {
			bytes += int64(t.Width) * int64(t.Height) * 4
		}
	}
	return bytes
}
func releaseTile(t *cachedTile) {
	if exists(t.Canvas) {
		if t.Canvas.Get("close").Type() == js.TypeFunction {
			t.Canvas.Call("close")
		} else {
			t.Canvas.Set("width", 0)
			t.Canvas.Set("height", 0)
		}
	}
	t.Canvas = js.Undefined()
	t.Heights = nil
}
func (a *App) acceptHeightPatch(m js.Value) {
	arr := js.Global().Get("Uint8Array").New(m.Get("heights"))
	hb := make([]byte, arr.Get("byteLength").Int())
	js.CopyBytesToGo(hb, arr)
	t := &cachedTile{Heights: make([]float32, len(hb)/4), HeightWidth: m.Get("heightWidth").Int(), HeightHeight: m.Get("heightHeight").Int(), HeightOriginX: m.Get("heightOriginX").Float(), HeightOriginY: m.Get("heightOriginY").Float(), HeightSpacing: m.Get("heightSpacing").Float(), Revision: m.Get("revision").Int(), Used: time.Now(), Bytes: len(hb)}
	for i := range t.Heights {
		t.Heights[i] = math.Float32frombits(binary.LittleEndian.Uint32(hb[i*4:]))
	}
	key := m.Get("heightKey").String()
	if old := a.tiles[key]; old != nil {
		releaseTile(old)
	}
	a.tiles[key] = t
	a.trimTiles()
	a.drawOverlay()
}

func clockMilliseconds() float64 {
	p := js.Global().Get("performance")
	return p.Get("timeOrigin").Float() + p.Call("now").Float()
}

func (a *App) hasCurrentDetail(x, y, w, h int, level float64) bool {
	for _, t := range a.tiles {
		if exists(t.Canvas) && t.ValidRevision == a.Revision && t.X == x && t.Y == y && float64(t.Width)*t.Scale == float64(w) && float64(t.Height)*t.Scale == float64(h) && t.Scale <= level {
			return true
		}
	}
	return false
}

// Reuse images only when their complete renderer input apron is untouched.
// Global material/lighting changes and weather transitions still invalidate all.
func (a *App) retainUnaffectedTiles(interactive bool) {
	state := a.viewState()
	if state.initialized && state.revision == a.Revision {
		return
	}
	options := a.drawOptions()
	if interactive {
		options["Weather"] = false
	}
	visual, _ := json.Marshal([]any{a.Knobs, a.mergedColors(), options, a.Config["column"], a.Config["size"], a.Config["grid"], a.Config["baseHeight"], a.Config["seaLevel"], a.view.Fit})
	defer func() {
		state.nodes = model.CloneNodes(a.Nodes)
		state.visual = string(visual)
		state.revision = a.Revision
		state.initialized = true
	}()
	if !state.initialized || state.visual != string(visual) || a.view.Fit || options["Weather"] == true {
		return
	}
	grid := int(num(a.Config, "grid", 1))
	spacing := (num(a.Config, "size", 1) - 1) / float64(max(1, grid-1))
	defaults := clone(obj(a.Config, "defaults"))
	for _, key := range []string{"frostGapSize", "frostGapDepth", "frostGaps", "frostGapReach"} {
		if v, ok := a.Knobs[key]; ok {
			defaults[key] = v
		}
	}
	changed, full, e := terrain.ChangedShapeRegion(state.nodes, a.Nodes, terrain.ShapeWindowConfig{Grid: grid, Spacing: spacing, RefSpacing: spacing, Defaults: defaults})
	if e != nil || full {
		return
	}
	var dirty model.Rect
	if changed != nil {
		dirty = terrain.CellRegionWorld(*changed, spacing)
	}
	for key, t := range a.tiles {
		if !exists(t.Canvas) || t.ValidRevision != state.revision || t.Input.Width <= 0 {
			continue
		}
		r := t.Input
		if changed != nil && r.X <= dirty.X+dirty.Width && r.X+r.Width >= dirty.X && r.Y <= dirty.Y+dirty.Height && r.Y+r.Height >= dirty.Y {
			continue
		}
		_, suffix, ok := strings.Cut(key, "/")
		if !ok {
			continue
		}
		next := fmt.Sprintf("%d/%s", a.Revision, suffix)
		if a.tiles[next] != nil {
			continue
		}
		delete(a.tiles, key)
		a.tiles[next] = t
		t.ValidRevision = a.Revision
	}
}
