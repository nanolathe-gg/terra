// Package site assembles the editor's world data and the files shared by the
// development server and static build. Rendering and exporting run in the page.
package site

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type object = map[string]any

type World struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// One line on what the world looks like, for the Start a map dialog's card.
	Description string `json:"description,omitempty"`
}
type Manifest struct {
	Worlds          []World  `json:"worlds"`
	FeatureWorlds   []string `json:"featureWorlds"`
	FeatureFallback string   `json:"featureFallback"`
	Sources         []string `json:"sources"`
}
type Site struct {
	Root         string
	Manifest     Manifest
	defaults     object
	tables       map[string]object
	featureKinds map[string][]string
	configs      map[string]object
	catalog      object
}

func decode(data []byte, target any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	if err := d.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		if err == nil {
			return fmt.Errorf("unexpected trailing JSON value")
		}
		return err
	}
	return nil
}
func obj(v any) object {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return object{}
}
func array(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	return nil
}
func clone(v any) any {
	switch x := v.(type) {
	case map[string]any:
		r := object{}
		for k, v := range x {
			r[k] = clone(v)
		}
		return r
	case []any:
		r := make([]any, len(x))
		for i, v := range x {
			r[i] = clone(v)
		}
		return r
	default:
		return v
	}
}
func merge(ms ...object) object {
	r := object{}
	for _, m := range ms {
		for k, v := range m {
			r[k] = clone(v)
		}
	}
	return r
}
func value(v any, fallback any) any {
	if v == nil {
		return fallback
	}
	return v
}
func text(v any) string { return fmt.Sprint(v) }
func stringsOf(m object) object {
	out := object{}
	for k, v := range m {
		out[k] = text(v)
	}
	return out
}
func keys(m object) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
func readObject(path string) (object, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var m object
	if err = decode(data, &m); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return m, nil
}
func materialPath(world string) string { return "materials/" + world + ".json" }

// JSON object order carries the existing recipe picker order. Do not derive it
// from Go's unordered maps, or rewrite the recipe array in alphabetical order.
func orderedKeys(v json.RawMessage) ([]string, error) {
	d := json.NewDecoder(bytes.NewReader(v))
	if _, err := d.Token(); err != nil {
		return nil, err
	}
	var out []string
	for d.More() {
		k, err := d.Token()
		if err != nil {
			return nil, err
		}
		out = append(out, k.(string))
		var skip json.RawMessage
		if err = d.Decode(&skip); err != nil {
			return nil, err
		}
	}
	return out, nil
}
func Load(root string) (*Site, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(root, "site.json"))
	if err != nil {
		return nil, fmt.Errorf("open site.json (run from the repository or pass --root): %w", err)
	}
	s := &Site{Root: root, tables: map[string]object{}, featureKinds: map[string][]string{}, configs: map[string]object{}}
	if err = json.Unmarshal(data, &s.Manifest); err != nil {
		return nil, err
	}
	if len(s.Manifest.Worlds) == 0 {
		return nil, fmt.Errorf("site.json has no worlds")
	}
	s.defaults, err = readObject(filepath.Join(root, "materials/defaults.json"))
	if err != nil {
		return nil, err
	}
	for _, w := range s.Manifest.Worlds {
		if w.ID == "" || strings.ContainsAny(w.ID, "/\\.") {
			return nil, fmt.Errorf("invalid world ID %q", w.ID)
		}
		if _, exists := s.tables[w.ID]; exists {
			return nil, fmt.Errorf("duplicate world %q", w.ID)
		}
		path := filepath.Join(root, materialPath(w.ID))
		s.tables[w.ID], err = readObject(path)
		if err != nil {
			return nil, err
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var table map[string]json.RawMessage
		if err = json.Unmarshal(raw, &table); err != nil {
			return nil, err
		}
		if features, ok := table["features"]; ok {
			s.featureKinds[w.ID], err = orderedKeys(features)
			if err != nil {
				return nil, err
			}
		}
	}
	if s.tables[s.Manifest.FeatureFallback] == nil {
		return nil, fmt.Errorf("unknown feature fallback %q", s.Manifest.FeatureFallback)
	}
	for _, w := range s.Manifest.FeatureWorlds {
		if s.tables[w] == nil {
			return nil, fmt.Errorf("unknown feature world %q", w)
		}
	}
	if err = s.configure(); err != nil {
		return nil, err
	}
	return s, nil
}
func (s *Site) Worlds() []string {
	out := make([]string, 0, len(s.Manifest.Worlds))
	for _, w := range s.Manifest.Worlds {
		out = append(out, w.ID)
	}
	return out
}
func (s *Site) names() object {
	m := object{}
	for _, w := range s.Manifest.Worlds {
		m[w.ID] = w.Name
	}
	return m
}
func (s *Site) descriptions() object {
	m := object{}
	for _, w := range s.Manifest.Worlds {
		if w.Description != "" {
			m[w.ID] = w.Description
		}
	}
	return m
}
func (s *Site) featureCatalog() []any {
	out := []any{}
	allowed := map[string]bool{"tree": true, "shrub": true, "rock": true, "scar": true, "deposit": true, "vent": true}
	names := s.names()
	for _, w := range s.Manifest.FeatureWorlds {
		features := obj(s.tables[w]["features"])
		for _, kind := range s.featureKinds[w] {
			if !allowed[kind] {
				continue
			}
			data := obj(features[kind])
			types := array(data["types"])
			if len(types) == 0 {
				types = []any{object{"share": 1, "params": value(data["params"], object{}), "vary": value(data["vary"], object{})}}
			}
			for i, v := range types {
				shape := obj(v)
				params := merge(obj(data["params"]), obj(shape["params"]))
				count := value(data["count"], 4)
				var n float64
				_ = json.Unmarshal([]byte(text(count)), &n)
				if n > 4 {
					count = 4
				}
				recipe := merge(data, object{"count": count, "types": []any{merge(shape, object{"share": 1, "params": params})}})
				form := text(value(params["species"], value(params["type"], "")))
				if form == "" {
					var tall float64
					_ = json.Unmarshal([]byte(text(value(params["tall"], 0))), &tall)
					form = kind
					if tall > .4 {
						form = "spire"
					}
				}
				if form == "deadConifer" {
					form = "dead conifer"
				}
				cells := ""
				if c, ok := params["cells"].(string); ok && c != "" {
					cells = " (" + strings.ReplaceAll(c, "x", "×") + ")"
				}
				out = append(out, object{"id": fmt.Sprintf("%s-%s-%d", w, kind, i), "kind": kind, "name": fmt.Sprintf("%s · %s %d%s", names[w], form, i+1, cells), "data": recipe})
			}
		}
	}
	return out
}

var materialKnobs = object{"stoneSort": json.Number("0.6"), "stoneRound": 0, "stoneSlab": json.Number("0.05"), "bedCycleVary": 0, "faceBedVary": 1}

func (s *Site) configure() error {
	names := s.names()
	features := s.featureCatalog()
	beaches, shapes, worlds := object{}, object{}, object{}
	for _, w := range s.Worlds() {
		table := s.tables[w]
		world := merge(obj(table["world"]))
		overrides := obj(world["knobDefaults"])
		engine := obj(world["engineDefaults"])
		delete(world, "knobDefaults")
		delete(world, "engineDefaults")
		delete(world, "export")
		base := value(world["baseHeight"], 24)
		delete(world, "baseHeight")
		material := merge(object{"site": s.defaults["site"]}, obj(table["material"]))
		// The world's surfaces: the slope cover and the rock always, a beach and the mineral margins' fringe and body where its world.materials names one
		// (sculpt-materials.js MAP_ROLES); the draw reads which optional stages it has from this list.
		roles := obj(obj(table["world"])["materials"])
		surfaces := []any{"slopeGrass", "rock"}
		for _, k := range []string{"beach", "fringe", "body"} {
			if _, ok := roles[k]; ok {
				surfaces = append(surfaces, k)
			}
		}
		c := merge(object{"biome": names[w], "biomeId": w, "size": 1024, "grid": 512, "seaLevel": 0, "baseHeight": base, "materialTable": materialPath(w), "layers": surfaces, "material": material, "water": table["water"]}, world)
		// The world's surface layers (docs/SURFACE_LAYERS.md): its own (world.surface) or the shared default stack.
		if _, ok := c["surface"]; !ok {
			c["surface"] = clone(s.defaults["surface"])
		}
		// A layer's material "@soil" is the world's own (world.materials.soil): the default stack names each engine surface's material by
		// role, and each world says which library material that is.
		if layers, ok := c["surface"].([]any); ok {
			for _, l := range layers {
				layer, ok := l.(map[string]any)
				if !ok {
					continue
				}
				if m, ok := layer["material"].(string); ok && strings.HasPrefix(m, "@") {
					if key, ok := roles[m[1:]].(string); ok {
						layer["material"] = key
					} else {
						delete(layer, "material")
					}
				}
			}
		}
		if river, ok := table["river"]; ok {
			c["river"] = clone(river)
		}
		fallback := object{}
		for _, k := range []string{"tree", "shrub", "rock", "scar"} {
			if v, ok := obj(s.tables[s.Manifest.FeatureFallback]["features"])[k]; ok {
				fallback[k] = v
			}
		}
		c["features"] = merge(fallback, obj(table["features"]))
		c["featureCatalog"] = clone(features)
		knobs := merge(obj(s.defaults["knobs"]))
		for k, v := range materialKnobs {
			knobs[k] = value(material[k], v)
		}
		knobs["shallowDepth"] = value(material["shallowDepth"], 2)
		knobs["deepDepth"] = value(material["deepDepth"], 42)
		knobs = merge(knobs, overrides)
		c["defaults"] = merge(obj(c["defaults"]), stringsOf(knobs))
		c["engineDefaults"] = stringsOf(engine)
		c["knobs"] = keys(knobs)
		if _, ok := roles["beach"]; ok {
			m := object{}
			for _, k := range []string{"beachWidth", "beachHeight", "beachRGB"} {
				if v, ok := obj(table["material"])[k]; ok {
					m[k] = v
				}
			}
			beaches[w] = object{"name": names[w], "table": materialPath(w), "material": m, "beachMaterial": roles["beach"]}
		}
		shapes[w] = value(c["shapes"], object{})
		delete(c, "shapes")
		worlds[w] = obj(table["world"])["export"]
		s.configs[w] = c
	}
	for _, c := range s.configs {
		c["worldShapes"] = clone(shapes)
		c["biomes"] = clone(names)
		c["biomeDescriptions"] = s.descriptions()
		c["beachSources"] = clone(beaches)
	}
	s.catalog = object{"worlds": worlds}
	return nil
}

// Browser pickers enumerate these objects. Preserve their authored order even
// though ordinary JSON objects use Go's deterministic alphabetical encoding.
type orderedObject struct {
	values object
	order  []string
}

func (o orderedObject) MarshalJSON() ([]byte, error) {
	var b bytes.Buffer
	b.WriteByte('{')
	seen := map[string]bool{}
	first := true
	for _, k := range append(append([]string{}, o.order...), keys(o.values)...) {
		if seen[k] {
			continue
		}
		v, ok := o.values[k]
		if !ok {
			continue
		}
		seen[k] = true
		key, _ := json.Marshal(k)
		val, err := json.Marshal(v)
		if err != nil {
			return nil, err
		}
		if !first {
			b.WriteByte(',')
		}
		first = false
		b.Write(key)
		b.WriteByte(':')
		b.Write(val)
	}
	b.WriteByte('}')
	return b.Bytes(), nil
}
func (s *Site) pickerOrder(c object, w string) object {
	for _, k := range []string{"biomes", "biomeDescriptions", "worldShapes", "beachSources"} {
		c[k] = orderedObject{obj(c[k]), s.Worlds()}
	}
	return c
}

func (s *Site) Generated(mapsURL string) (map[string][]byte, error) {
	services := object{"defaultWorld": s.Worlds()[0], "worlds": s.Worlds()}
	if mapsURL != "" {
		services["maps"] = object{"available": true, "url": mapsURL}
	}
	data := map[string]any{"services.json": services, "config/catalog.json": s.catalog}
	for _, w := range s.Worlds() {
		data["config/"+w+".json"] = s.pickerOrder(merge(s.configs[w]), w)
	}
	out := map[string][]byte{}
	for name, v := range data {
		body, err := json.Marshal(v)
		if err != nil {
			return nil, err
		}
		out[name] = body
	}
	return out, nil
}
func WriteFiles(root string, files map[string][]byte) error {
	for name, data := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(path, data, 0644); err != nil {
			return err
		}
	}
	return nil
}
