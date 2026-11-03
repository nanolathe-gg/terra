//go:build js && wasm

package editor

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/nanolathe-gg/terraform/internal/model"
)

// The order is five ghost cuts, the selected cut, then five samples at each
// of 49 along-path positions. Each sample is an art-space world point.
func landformSectionSamples(p *landformPath, place float64) []model.Point {
	out := make([]model.Point, 0, 6*33+49*5)
	for _, t := range []float64{.1, .3, .5, .7, .9, place} {
		x, y, bx, by := p.at(t)
		for i := 0; i < 33; i++ {
			d := -p.back + (p.back+p.front)*float64(i)/32
			out = append(out, model.Point{X: x - bx*d, Y: y - by*d})
		}
	}
	reach := math.Max(0, p.wander)*1.2 + 4
	for i := 0; i <= 48; i++ {
		x, y, bx, by := p.at(float64(i) / 48)
		for j := -2; j <= 2; j++ {
			d := reach * float64(j) / 2
			out = append(out, model.Point{X: x + bx*d, Y: y + by*d})
		}
	}
	return out
}

type landformGhostCache struct {
	key       string
	failedKey string
	values    []float64
	points    []model.Point
	timer     *time.Timer
	pending   bool
}

var landformGhosts = map[*App]*landformGhostCache{}

// Defer passive authored sampling until the visible render settles. A newer
// view can preempt the RPC; its canceled response triggers a debounced retry.
func (a *App) landformGhostSamples(p *landformPath) []float64 {
	if p == nil || a.gesture != nil || a.controlEditing {
		return nil
	}
	state := landformGhosts[a]
	if state == nil {
		state = &landformGhostCache{}
		landformGhosts[a] = state
	}
	key := fmt.Sprintf("%d/%d/%.6f", a.Revision, a.Selected, a.landformPlace)
	if state.key != key {
		state.key = key
		state.values = nil
		state.points = landformSectionSamples(p, a.landformPlace)
	}
	if state.failedKey == key {
		return nil
	}
	if len(state.values) == len(state.points) && len(state.values) > 0 {
		return state.values
	}
	a.queueLandformGhost(state)
	return nil
}
func (a *App) queueLandformGhost(state *landformGhostCache) {
	if state.pending || state.timer != nil {
		return
	}
	state.timer = time.AfterFunc(400*time.Millisecond, func() {
		state.timer = nil
		control := element("section-preview-control")
		if a.selectedLandformPath() == nil || !exists(control) || control.Get("hidden").Bool() || control.Call("getClientRects").Length() == 0 {
			return
		}
		if len(a.rpc) > 0 || !a.workerReady || a.Busy || a.gesture != nil || a.controlEditing || a.rendering || a.scheduleTimer != nil {
			a.queueLandformGhost(state)
			return
		}
		key := state.key
		points := clone(state.points)
		state.pending = true
		go func() {
			job := a.job("ghost", nil)
			job.Points = points
			msg, err := a.rpcRequest(context.Background(), job)
			state.pending = false
			if err != nil && err.Error() != context.Canceled.Error() {
				if state.key == key {
					state.failedKey = key
				}
				showError(fmt.Errorf("Landform section preview: %w", err))
				return
			}
			if err == nil && state.key == key {
				var values []float64
				if fromJS(msg.Get("values"), &values) != nil || len(values) != len(points) {
					state.failedKey = key
					showError(fmt.Errorf("Landform section preview returned invalid samples."))
					return
				}
				state.values = values
				a.drawCurve()
				return
			}
			if a.selectedLandformPath() != nil {
				a.queueLandformGhost(state)
			}
		}()
	})
}
