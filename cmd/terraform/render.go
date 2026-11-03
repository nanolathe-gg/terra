package main

import (
	"bufio"
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
	"strconv"
	"strings"
	"sync"
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
		Format, Biome, Variant                                                                                     string
		Nodes                                                                                                      []model.Node
		Map                                                                                                        map[string]any
		MapData                                                                                                    map[string]any
		Knobs                                                                                                      map[string]any
		Column                                                                                                     any
		Colors                                                                                                     map[string]any
		BaseHeight, SeaLevel, Size, Grid                                                                           float64
		Relief, MineralRing, RingSpread, RingVariation, MaterialWeathering, DepositSpread, TransitionDetail, Scree *float64
		Seed, RefinementSeed                                                                                       *uint32
		Weather, WeatheredView, Clay                                                                               *bool
		Light                                                                                                      string
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
	defaultColumn := config["column"]
	if e = model.ValidateColumn(recipe.Column, defaultColumn); e != nil {
		return e
	}
	if recipe.Column != nil {
		config["column"] = recipe.Column
	}
	if recipe.Size < 2 || recipe.Size > 21000 || recipe.Grid < 2 || recipe.Grid > 10500 || recipe.Size != math.Trunc(recipe.Size) || recipe.Grid != math.Trunc(recipe.Grid) {
		return fmt.Errorf("Invalid scene lattice dimensions")
	}
	if recipe.SeaLevel < 0 || recipe.SeaLevel > 255 || recipe.SeaLevel != math.Trunc(recipe.SeaLevel) {
		return fmt.Errorf("Invalid scene sea level")
	}
	if e = validateSceneGeometry(recipe.Map, recipe.Size, recipe.Grid); e != nil {
		return e
	}
	for _, n := range recipe.Nodes {
		if n.Kind == "" || n.Kind == "raster" {
			return fmt.Errorf("The recipe contains an unsupported stroke")
		}
		if len(n.Points) > 0 {
			p := model.ShapePath{Points: n.Points, Paths: n.Paths}
			if e = model.ValidatePaths(&p); e != nil {
				return e
			}
		}
	}
	if features, ok := recipe.MapData["features"].([]any); ok && len(features) > 0 {
		if err := s.EnsureFeatures(recipe.Biome); err != nil {
			return fmt.Errorf("prepare features: %w", err)
		}
	}
	for k, v := range map[string]float64{"baseHeight": recipe.BaseHeight, "seaLevel": recipe.SeaLevel, "size": recipe.Size, "grid": recipe.Grid} {
		config[k] = v
	}
	config["map"] = recipe.Map
	config["heightBounds"] = []float64{recipe.SeaLevel - 90, recipe.SeaLevel + 300}
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
	tables, e := filepath.Glob(filepath.Join(o.SourceRoot, "materials", "*.json"))
	if e != nil {
		return e
	}
	for _, p := range tables {
		b, err := os.ReadFile(p)
		if err != nil {
			return fmt.Errorf("load material table: %w", err)
		}
		sources["materials/"+filepath.Base(p)] = string(b)
	}
	if sources["materials/palette.json"] == "" {
		return fmt.Errorf("missing materials/palette.json")
	}
	gpu, e := terrain.NewGPU()
	if e != nil {
		return e
	}
	defer gpu.Close()
	info := gpu.Adapter.Info()
	fmt.Printf("GPU: %s (%s)\n", info.Name, info.Backend)
	renderer, e := terrain.NewSceneRenderer(gpu, config, sources, material)
	if e != nil {
		return fmt.Errorf("initialize scene renderer: %w", e)
	}
	defer renderer.Close()
	w, h := int(numberMap(recipe.Map, "width")), int(numberMap(recipe.Map, "height"))
	if w <= 0 || h <= 0 {
		return fmt.Errorf("recipe has no map dimensions")
	}
	colors := map[string]any{}
	if defaults, ok := config["colors"].(map[string]any); ok {
		for k, v := range defaults {
			if c, ok := v.(string); ok {
				var r, g, b int
				if _, err := fmt.Sscanf(c, "#%02x%02x%02x", &r, &g, &b); err == nil {
					colors[k] = []float64{float64(r) / 255, float64(g) / 255, float64(b) / 255}
				}
			}
		}
	}
	for k, v := range recipe.Colors {
		if v == nil {
			delete(colors, k)
		} else {
			colors[k] = v
		}
	}
	for k, v := range model.ColumnColorOverrides(recipe.Column, defaultColumn) {
		colors[k] = v
	}
	knobs := map[string]string{}
	for k, v := range recipe.Knobs {
		knobs[k] = fmt.Sprint(v)
	}
	wc, hc := int(numberMap(recipe.Map, "widthCells")), int(numberMap(recipe.Map, "heightCells"))
	if wc <= 0 || hc <= 0 {
		return fmt.Errorf("recipe has no height dimensions")
	}
	heights := make([]int, wc*hc)
	tileDir, e := os.MkdirTemp("", "terraform-native-tiles-")
	if e != nil {
		return e
	}
	tiles := []nativeTile{}
	defer func() {
		for _, t := range tiles {
			os.Remove(t.path)
		}
		os.Remove(tileDir)
	}()
	draw := terrain.DefaultDrawOptions(config)
	materialOptions, _ := config["material"].(map[string]any)
	if v, ok := materialOptions["ringAmount"].(float64); ok {
		draw.Ring = v
	} else {
		draw.Ring = 0
	}
	if v, ok := materialOptions["ringSpread"].(float64); ok {
		draw.RingSpread = v
	}
	if v, ok := materialOptions["ringVariation"].(float64); ok {
		draw.RingVariation = v
	}
	draw.Full = true
	draw.ExportArt = true
	if recipe.Scree == nil {
		draw.Scree = sceneDefaultScree(config, recipe.Knobs)
	}
	for _, item := range []struct {
		src *float64
		dst *float64
	}{{recipe.Relief, &draw.Detail}, {recipe.MineralRing, &draw.Ring}, {recipe.RingSpread, &draw.RingSpread}, {recipe.RingVariation, &draw.RingVariation}, {recipe.MaterialWeathering, &draw.MaterialWeathering}, {recipe.DepositSpread, &draw.DepositSpread}, {recipe.TransitionDetail, &draw.TransitionDetail}, {recipe.Scree, &draw.Scree}} {
		if item.src != nil {
			*item.dst = *item.src / 100
		}
	}
	draw.RefinementSeed = sceneRefinementSeed(recipe.Seed, recipe.RefinementSeed)
	draw.Weather = sceneExportWeather(draw.Weather, recipe.Weather)
	if recipe.Clay != nil {
		draw.Clay = *recipe.Clay
	}
	draw.AlternateLight = recipe.Light == "alternate"
	const side = 512
	for y := 0; y < h; y += side {
		for x := 0; x < w; x += side {
			tw, th := min(side, w-x), min(side, h-y)
			result, err := renderer.Render(context.Background(), recipe.Nodes, knobs, colors, terrain.SceneWindow{X: x, Y: y, Width: tw, Height: th, Scale: 1, ExportArt: true, ReadHeights: true}, func() terrain.DrawOptions { d := draw; d.Width = tw; d.Height = th; return d }())
			if err != nil {
				return fmt.Errorf("render tile (%d,%d): %w", x, y, err)
			}
			if result.Width != tw || result.Height != th || len(result.RGBA) != tw*th*4 {
				return fmt.Errorf("renderer returned an incomplete tile")
			}
			if result.HeightWidth < 1 || result.HeightHeight < 1 || result.HeightSpacing <= 0 || len(result.Heights) != result.HeightWidth*result.HeightHeight {
				return fmt.Errorf("renderer returned an incomplete height grid")
			}
			for cy := y / 16; cy < min(hc, (y+th+15)/16); cy++ {
				for cx := x / 16; cx < min(wc, (x+tw+15)/16); cx++ {
					value, err := sampleNativeHeight(result, float64(cx*16), float64(cy*16))
					if err != nil {
						return err
					}
					heights[cy*wc+cx] = value
				}
			}
			path := filepath.Join(tileDir, fmt.Sprintf("tile-%d-%d.png", x, y))
			f, err := os.Create(path)
			if err != nil {
				return err
			}
			tiles = append(tiles, nativeTile{x, y, tw, th, path})
			err = png.Encode(f, &image.RGBA{Pix: result.RGBA, Stride: tw * 4, Rect: image.Rect(0, 0, tw, th)})
			if closeErr := f.Close(); err == nil {
				err = closeErr
			}
			if err != nil {
				return err
			}
		}
	}
	if e = os.MkdirAll(out, 0700); e != nil {
		return e
	}
	b, e = json.Marshal(heights)
	if e != nil {
		return e
	}
	if e = os.WriteFile(filepath.Join(out, "heights.json"), b, 0600); e != nil {
		return e
	}
	return exportNative(o, out, recipe.Biome, recipe.SeaLevel, recipe.Map, recipe.MapData, heights, tiles)
}

type nativeTile struct {
	x, y, w, h int
	path       string
}

func sampleNativeHeight(result *terrain.SceneResult, x, y float64) (int, error) {
	fx := (x - result.HeightOriginX) / result.HeightSpacing
	fy := (y - result.HeightOriginY) / result.HeightSpacing
	if fx < 0 || fy < 0 || fx > float64(result.HeightWidth-1) || fy > float64(result.HeightHeight-1) {
		return 0, fmt.Errorf("height grid does not cover (%g,%g)", x, y)
	}
	ix, iy := int(fx), int(fy)
	jx, jy := min(ix+1, result.HeightWidth-1), min(iy+1, result.HeightHeight-1)
	sx, sy := fx-float64(ix), fy-float64(iy)
	at := func(x, y int) float64 { return float64(result.Heights[y*result.HeightWidth+x]) }
	v := (at(ix, iy)*(1-sx)+at(jx, iy)*sx)*(1-sy) + (at(ix, jy)*(1-sx)+at(jx, jy)*sx)*sy
	return int(math.Round(math.Max(0, math.Min(255, v)))), nil
}

func numberMap(m map[string]any, k string) float64 { v, _ := m[k].(float64); return v }

func sceneDefaultScree(config, knobs map[string]any) float64 {
	value := any(nil)
	for _, source := range []map[string]any{mapObject(config["defaults"]), mapObject(config["engineDefaults"]), knobs} {
		if v, ok := source["scree"]; ok {
			value = v
		}
	}
	var n float64
	switch v := value.(type) {
	case float64:
		n = v
	case string:
		n, _ = strconv.ParseFloat(v, 64)
	}
	return math.Max(0, math.Min(100, n)) / 100
}
func mapObject(v any) map[string]any { m, _ := v.(map[string]any); return m }

func sceneRefinementSeed(seed, refinement *uint32) uint32 {
	if refinement != nil {
		return *refinement
	}
	if seed != nil {
		return *seed
	}
	return 2701
}
func sceneExportWeather(fallback bool, weather *bool) bool {
	if weather != nil {
		return *weather
	}
	return fallback
}

// Validate the complete map geometry before GPU initialization or allocation.
func validateSceneGeometry(m map[string]any, size, grid float64) error {
	x, y := numberMap(m, "unitsX"), numberMap(m, "unitsY")
	if x < 1 || x > 40 || y < 1 || y > 40 || x != math.Trunc(x) || y != math.Trunc(y) {
		return fmt.Errorf("Invalid map dimensions: expected 1–40 whole units per side")
	}
	wc, hc := x*32+2, y*32+8
	w, h := wc*16, hc*16
	for k, expected := range map[string]float64{"widthCells": wc, "heightCells": hc, "width": w, "height": h, "playRight": x * 512, "playBottom": y * 512} {
		if numberMap(m, k) != expected {
			return fmt.Errorf("Invalid map geometry: %s must be %g", k, expected)
		}
	}
	if size != math.Max(w, h)+160 || grid != math.Floor(size/2) {
		return fmt.Errorf("Map geometry and scene lattice do not match")
	}
	return nil
}

type synchronizedBuffer struct {
	mu sync.Mutex
	b  strings.Builder
}

func (b *synchronizedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(p)
}
func (b *synchronizedBuffer) String() string { b.mu.Lock(); defer b.mu.Unlock(); return b.b.String() }

func exportNative(o server.Options, out, world string, sea float64, geometry, data map[string]any, heights []int, tiles []nativeTile) error {
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
	var stderr synchronizedBuffer
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
	for _, tile := range tiles {
		if tile.w > limit || tile.h > limit {
			return fmt.Errorf("export helper chunk limit is smaller than render tiles")
		}
		if _, e = exchange(map[string]any{"op": "chunk", "x": tile.x, "y": tile.y, "width": tile.w, "height": tile.h, "path": tile.path}); e != nil {
			return e
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
