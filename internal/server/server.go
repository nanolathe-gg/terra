package server

import (
	"embed"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

//go:embed worlds.json
var worldData embed.FS

type Options struct {
	SourceRoot, AssetsRoot, ExportTool, FeatureTool string
	GameRoots                                       []string
	Prepared                                        bool
	Biomes                                          []string
}
type Server struct {
	Options
	worlds struct {
		Configs  map[string]map[string]any            `json:"configs"`
		Variants map[string]map[string]map[string]any `json:"variants"`
		Names    map[string]string                    `json:"names"`
	}
	documents documentStore
	exports   exportStore
}

func New(o Options) (*Server, error) {
	s := &Server{Options: o}
	b, e := worldData.ReadFile("worlds.json")
	if e != nil {
		return nil, e
	}
	if e = json.Unmarshal(b, &s.worlds); e != nil {
		return nil, e
	}
	if len(s.Biomes) == 0 {
		s.Biomes = []string{"green", "red", "archipelago", "moon", "zhon", "lava", "desert", "crystal", "ice"}
	}
	s.documents.root = filepath.Join(o.AssetsRoot, "documents", "documents")
	s.exports.init(o)
	return s, nil
}
func reply(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(v)
}
func bad(w http.ResponseWriter, e error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(400)
	json.NewEncoder(w).Encode(map[string]string{"error": e.Error()})
}
func clone(m map[string]any) map[string]any {
	b, _ := json.Marshal(m)
	var v map[string]any
	json.Unmarshal(b, &v)
	return v
}
func merge(dst map[string]any, src any) {
	if m, ok := src.(map[string]any); ok {
		for k, v := range m {
			dst[k] = v
		}
	}
}
func (s *Server) config(world, variant string) (map[string]any, error) {
	available := false
	for _, w := range s.Biomes {
		if w == world {
			available = true
		}
	}
	c, ok := s.worlds.Configs[world]
	if !available || !ok {
		return nil, fmt.Errorf("unknown or unavailable world: %s", world)
	}
	c = clone(c)
	names := map[string]string{}
	patterns := map[string]any{}
	for _, w := range s.Biomes {
		if name, ok := s.worlds.Names[w]; ok {
			names[w] = name
			b, e := os.ReadFile(filepath.Join(s.SourceRoot, "materials", w+".json"))
			var table map[string]any
			if e == nil && json.Unmarshal(b, &table) == nil {
				if _, ok := table["ground"]; ok {
					patterns[w] = map[string]any{"name": name, "groundTable": "/materials/" + w + ".json"}
				}
			}
		}
	}
	c["biomes"] = names
	c["groundPatterns"] = patterns
	labels := map[string]any{}
	for k, v := range s.worlds.Variants[world] {
		labels[k] = v["label"]
	}
	c["variants"] = labels
	if variant != "" {
		v, ok := s.worlds.Variants[world][variant]
		if !ok {
			return nil, fmt.Errorf("unknown variant %s of world %s", variant, world)
		}
		d := c["defaults"].(map[string]any)
		if knobs, ok := v["knobs"].(map[string]any); ok {
			for k, x := range knobs {
				d[k] = fmt.Sprint(x)
			}
		}
		if v["river"] == true {
			if river, ok := c["river"].(map[string]any); ok {
				for k, x := range river {
					if dst, ok := c[k].(map[string]any); ok {
						merge(dst, x)
					}
				}
			}
		}
		colors, _ := c["colors"].(map[string]any)
		if colors == nil {
			colors = map[string]any{}
		}
		base := map[string]any{}
		merge(base, colors)
		c["baseColors"] = base
		merge(colors, v["colors"])
		c["colors"] = colors
		if dst, ok := c["material"].(map[string]any); ok {
			merge(dst, v["material"])
		}
		merge(c, v["config"])
		c["variant"] = variant
	}
	return c, nil
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if strings.HasPrefix(r.URL.Path, "/map-document") {
		s.documents.serve(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/map-export") || strings.HasPrefix(r.URL.Path, "/map-features/") {
		s.exports.serve(w, r)
		return
	}
	if r.Method != "GET" {
		http.NotFound(w, r)
		return
	}
	switch r.URL.Path {
	case "/sculpt-config.json":
		world := r.URL.Query().Get("biome")
		if world == "" && len(s.Biomes) > 0 {
			world = s.Biomes[0]
		}
		c, e := s.config(world, r.URL.Query().Get("variant"))
		if e != nil {
			http.Error(w, e.Error(), 404)
			return
		}
		reply(w, c)
		return
	case "/map-catalog.json":
		worlds := map[string]any{}
		for _, world := range s.Biomes {
			b, e := os.ReadFile(filepath.Join(s.SourceRoot, "materials", world+".json"))
			var t map[string]any
			if e == nil && json.Unmarshal(b, &t) == nil {
				if x, ok := t["world"].(map[string]any); ok {
					worlds[world] = x["export"]
				}
			}
		}
		reply(w, map[string]any{"worlds": worlds})
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" || name == "sculpt" {
		name = "sculpt.html"
	}
	if strings.Contains(name, "..") || strings.ContainsRune(name, '\\') {
		http.NotFound(w, r)
		return
	}
	allowed := strings.HasPrefix(name, "materials/") || strings.HasPrefix(name, "web/") || strings.HasPrefix(name, "sculpt") || strings.HasPrefix(name, "engine-")
	if !allowed {
		http.NotFound(w, r)
		return
	}
	f, e := os.Open(filepath.Join(s.SourceRoot, name))
	if e != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil || st.IsDir() {
		http.NotFound(w, r)
		return
	}
	if strings.HasSuffix(name, ".wasm") {
		w.Header().Set("Content-Type", "application/wasm")
		w.Header().Add("Vary", "Accept-Encoding")
		if acceptsGzip(r.Header.Get("Accept-Encoding")) {
			if compressed, err := os.Open(filepath.Join(s.SourceRoot, name+".gz")); err == nil {
				defer compressed.Close()
				if cs, err := compressed.Stat(); err == nil && !cs.IsDir() && !cs.ModTime().Before(st.ModTime()) {
					f = compressed
					st = cs
					w.Header().Set("Content-Encoding", "gzip")
				}
			}
		}
	}
	if strings.HasSuffix(name, ".wgsl") {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	}
	http.ServeContent(w, r, name, st.ModTime(), f)
}

func acceptsGzip(header string) bool {
	wildcard := false
	for _, item := range strings.Split(header, ",") {
		parts := strings.Split(item, ";")
		encoding := strings.TrimSpace(parts[0])
		q := 1.
		for _, param := range parts[1:] {
			pair := strings.SplitN(strings.TrimSpace(param), "=", 2)
			if len(pair) == 2 && pair[0] == "q" {
				q, _ = strconv.ParseFloat(pair[1], 64)
			}
		}
		if encoding == "gzip" {
			return q > 0
		}
		if encoding == "*" {
			wildcard = q > 0
		}
	}
	return wildcard
}
