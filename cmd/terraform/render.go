package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/nanolathe-gg/terraform/internal/model"
	"github.com/nanolathe-gg/terraform/internal/server"
	"github.com/nanolathe-gg/terraform/internal/terrain"
	"image"
	"image/png"
	"math"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// renderScene runs the same terrain renderer used by the browser, through the
// native wgpu backend. It fails before creating output when replay is unsupported.
func renderScene(o server.Options, s *server.Server, path, out string) error {
	if out == "" {
		return fmt.Errorf("--out is required with --scene")
	}
	b, e := os.ReadFile(path)
	if e != nil {
		return e
	}
	var recipe struct {
		Format, Biome, Variant           string
		Nodes                            []model.Node
		Map                              map[string]any
		MapData                          map[string]any
		Knobs                            map[string]any
		Colors                           map[string]any
		BaseHeight, SeaLevel, Size, Grid float64
	}
	if e = json.Unmarshal(b, &recipe); e != nil {
		return e
	}
	if recipe.Format != "nanolathe-terrain-sculpt" || recipe.Biome == "" {
		return fmt.Errorf("--scene requires a Terraform editor recipe")
	}
	q := url.Values{"biome": {recipe.Biome}}
	if recipe.Variant != "" {
		q.Set("variant", recipe.Variant)
	}
	req := httptest.NewRequest("GET", "/sculpt-config.json?"+q.Encode(), nil)
	response := httptest.NewRecorder()
	s.ServeHTTP(response, req)
	if response.Code != 200 {
		return fmt.Errorf("world configuration: %s", response.Body.String())
	}
	var config map[string]any
	if e = json.Unmarshal(response.Body.Bytes(), &config); e != nil {
		return e
	}
	for k, v := range map[string]float64{"baseHeight": recipe.BaseHeight, "seaLevel": recipe.SeaLevel, "size": recipe.Size, "grid": recipe.Grid} {
		config[k] = v
	}
	config["map"] = recipe.Map
	tablePath, _ := config["materialTable"].(string)
	b, e = os.ReadFile(filepath.Join(o.SourceRoot, strings.TrimPrefix(tablePath, "/")))
	if e != nil {
		return e
	}
	var material map[string]any
	if e = json.Unmarshal(b, &material); e != nil {
		return e
	}
	sources := map[string]string{}
	paths, e := filepath.Glob(filepath.Join(o.SourceRoot, "*.wgsl"))
	if e != nil {
		return e
	}
	for _, p := range paths {
		b, e = os.ReadFile(p)
		if e != nil {
			return e
		}
		sources[filepath.Base(p)] = string(b)
	}
	gpu, e := terrain.NewGPU()
	if e != nil {
		return e
	}
	defer gpu.Close()
	renderer, e := terrain.NewSceneRenderer(gpu, config, sources, material)
	if e != nil {
		return e
	}
	defer renderer.Close()
	w, h := int(numberMap(recipe.Map, "width")), int(numberMap(recipe.Map, "height"))
	if w <= 0 || h <= 0 {
		return fmt.Errorf("recipe has no map dimensions")
	}
	knobs := map[string]string{}
	for k, v := range recipe.Knobs {
		knobs[k] = fmt.Sprint(v)
	}
	result, e := renderer.Render(context.Background(), recipe.Nodes, knobs, recipe.Colors, terrain.SceneWindow{Width: w, Height: h, Scale: 1}, terrain.DrawOptions{Width: w, Height: h, Full: true})
	if e != nil {
		return e
	}
	if len(result.RGBA) != w*h*4 {
		return fmt.Errorf("renderer returned an incomplete image")
	}
	if e = os.MkdirAll(out, 0700); e != nil {
		return e
	}
	f, e := os.Create(filepath.Join(out, "terrain.png"))
	if e != nil {
		return e
	}
	err := png.Encode(f, &image.RGBA{Pix: result.RGBA, Stride: w * 4, Rect: image.Rect(0, 0, w, h)})
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	heights, e := json.Marshal(result.Heights)
	if e != nil {
		return e
	}
	if e = os.WriteFile(filepath.Join(out, "heights.json"), heights, 0600); e != nil {
		return e
	}
	return exportNative(o, out, recipe.Biome, recipe.SeaLevel, recipe.Map, recipe.MapData, result)

}
func numberMap(m map[string]any, k string) float64 { v, _ := m[k].(float64); return v }

func exportNative(o server.Options, out, world string, sea float64, geometry, data map[string]any, result *terrain.SceneResult) error {
	wc, hc := int(numberMap(geometry, "widthCells")), int(numberMap(geometry, "heightCells"))
	if wc <= 0 || hc <= 0 || result.HeightWidth < 1 || result.HeightHeight < 1 || result.HeightSpacing <= 0 || len(result.Heights) != result.HeightWidth*result.HeightHeight {
		return fmt.Errorf("renderer returned an incomplete height grid")
	}
	sample := func(x, y float64) int {
		fx := math.Max(0, math.Min(float64(result.HeightWidth-1), (x-result.HeightOriginX)/result.HeightSpacing))
		fy := math.Max(0, math.Min(float64(result.HeightHeight-1), (y-result.HeightOriginY)/result.HeightSpacing))
		ix, iy := int(fx), int(fy)
		jx, jy := min(ix+1, result.HeightWidth-1), min(iy+1, result.HeightHeight-1)
		sx, sy := fx-float64(ix), fy-float64(iy)
		at := func(x, y int) float64 { return float64(result.Heights[y*result.HeightWidth+x]) }
		v := (at(ix, iy)*(1-sx)+at(jx, iy)*sx)*(1-sy) + (at(ix, jy)*(1-sx)+at(jx, jy)*sx)*sy
		return int(math.Round(math.Max(0, math.Min(255, v))))
	}
	heights := make([]int, wc*hc)
	for y := 0; y < hc; y++ {
		for x := 0; x < wc; x++ {
			heights[y*wc+x] = sample(float64(x*16), float64(y*16))
		}
	}
	name, _ := data["name"].(string)
	if name == "" {
		name = "Sculpt map"
	}
	description, _ := data["description"].(string)
	manifest := map[string]any{"name": name, "description": description, "world": world, "unitsX": geometry["unitsX"], "unitsY": geometry["unitsY"], "seaLevel": sea, "heights": heights}
	for _, k := range []string{"features", "starts", "settings"} {
		if v, ok := data[k]; ok {
			manifest[k] = v
		}
	}
	temp, e := os.MkdirTemp("", "terraform-native-export-")
	if e != nil {
		return e
	}
	defer func() {
		os.Remove(filepath.Join(temp, "manifest.json"))
		os.Remove(filepath.Join(temp, "chunk.png"))
		os.Remove(temp)
	}()
	b, e := json.Marshal(manifest)
	if e != nil {
		return e
	}
	mp := filepath.Join(temp, "manifest.json")
	if e = os.WriteFile(mp, b, 0600); e != nil {
		return e
	}
	args := []string{}
	for _, r := range o.GameRoots {
		args = append(args, "--root", r)
	}
	args = append(args, "--stream", "--input", mp, "--out", out, "--work", temp, "--features-root", filepath.Join(o.AssetsRoot, "features"))
	if o.Prepared {
		args = append(args, "--catalog-file", filepath.Join(o.AssetsRoot, "map-catalog.json"))
	}
	cmd := exec.Command(o.ExportTool, args...)
	in, e := cmd.StdinPipe()
	if e != nil {
		return e
	}
	stdout, e := cmd.StdoutPipe()
	if e != nil {
		return e
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if e = cmd.Start(); e != nil {
		return e
	}
	done := false
	defer func() {
		in.Close()
		if !done {
			cmd.Process.Kill()
			cmd.Wait()
		}
	}()
	reader := bufio.NewReader(stdout)
	exchange := func(v any) (map[string]any, error) {
		if v != nil {
			b, e := json.Marshal(v)
			if e != nil {
				return nil, e
			}
			if _, e = in.Write(append(b, '\n')); e != nil {
				return nil, e
			}
		}
		line, e := reader.ReadBytes('\n')
		if e != nil {
			return nil, fmt.Errorf("map export helper: %s", stderr.String())
		}
		var result map[string]any
		e = json.Unmarshal(line, &result)
		return result, e
	}
	ready, e := exchange(nil)
	if e != nil {
		return e
	}
	if ready["ready"] != true {
		return fmt.Errorf("map export helper was not ready")
	}
	limit := int(numberMap(ready, "maxChunkSide"))
	if limit <= 0 {
		return fmt.Errorf("map export helper returned an invalid chunk limit")
	}
	img := &image.RGBA{Pix: result.RGBA, Stride: result.Width * 4, Rect: image.Rect(0, 0, result.Width, result.Height)}
	for y := 0; y < result.Height; y += limit {
		for x := 0; x < result.Width; x += limit {
			w, h := min(limit, result.Width-x), min(limit, result.Height-y)
			p := filepath.Join(temp, "chunk.png")
			f, e := os.Create(p)
			if e != nil {
				return e
			}
			e = png.Encode(f, img.SubImage(image.Rect(x, y, x+w, y+h)))
			if ce := f.Close(); e == nil {
				e = ce
			}
			if e != nil {
				return e
			}
			if _, e = exchange(map[string]any{"op": "chunk", "x": x, "y": y, "width": w, "height": h, "path": p}); e != nil {
				return e
			}
			os.Remove(p)
		}
	}
	v, e := exchange(map[string]any{"op": "finish"})
	if e != nil {
		return e
	}
	if e = cmd.Wait(); e != nil {
		return fmt.Errorf("map export helper: %s", stderr.String())
	}
	done = true
	fmt.Printf("Exported %v and %v\n", v["archive"], v["indexed"])
	return nil
}
