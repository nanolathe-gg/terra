// Package reprohost serves the optional interaction and audit harnesses around
// the normal site handler. Instrumentation never ships in the editor's build.
package reprohost

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/nanolathe-gg/terraform/internal/site"
)

type Options struct{ Mode, Source, Tools, Out, Assets, Evidence, Report string }
type Host struct {
	options Options
	editor  http.Handler
	output  *os.Root
	worlds  map[string]bool
}

func New(o Options) (*Host, error) {
	if o.Mode != "interaction" && o.Mode != "audit" {
		return nil, fmt.Errorf("choose --mode interaction or audit")
	}
	if o.Out == "" {
		return nil, fmt.Errorf("--out is required")
	}
	if o.Source == "" {
		o.Source = "."
	}
	if o.Tools == "" {
		o.Tools = "."
	}
	var err error
	o.Source, err = filepath.Abs(o.Source)
	if err != nil {
		return nil, err
	}
	o.Tools, err = filepath.Abs(o.Tools)
	if err != nil {
		return nil, err
	}
	s, err := site.Load(o.Source)
	if err != nil {
		return nil, err
	}
	editor, err := s.Handler(filepath.Join(o.Out, "links"))
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(o.Out, 0755); err != nil {
		return nil, err
	}
	output, err := os.OpenRoot(o.Out)
	if err != nil {
		return nil, err
	}
	h := &Host{options: o, editor: editor, output: output, worlds: map[string]bool{}}
	for _, w := range s.Worlds() {
		h.worlds[w] = true
	}
	return h, nil
}
func (h *Host) Close() error { return h.output.Close() }
func answer(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func failed(w http.ResponseWriter, status int, err error) {
	answer(w, status, map[string]string{"error": err.Error()})
}
func localName(name string) bool {
	return filepath.IsLocal(name) && !strings.Contains(name, "\\") && !strings.Contains(name, "..")
}
func rootedFile(root, name string) ([]byte, error) {
	if root == "" || !localName(name) {
		return nil, fmt.Errorf("invalid file path")
	}
	r, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return r.ReadFile(name)
}
func sendFile(w http.ResponseWriter, r *http.Request, root, name string) {
	data, err := rootedFile(root, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	kind := mime.TypeByExtension(filepath.Ext(name))
	if kind == "" {
		kind = "application/octet-stream"
	}
	w.Header().Set("Content-Type", kind)
	w.Header().Set("Content-Length", fmt.Sprint(len(data)))
	if r.Method != "HEAD" {
		_, _ = w.Write(data)
	}
}
func (h *Host) scenes() (map[string]json.RawMessage, error) {
	dir := filepath.Join(h.options.Source, "repro/scenes")
	files, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := map[string]json.RawMessage{}
	for _, f := range files {
		if f.IsDir() || filepath.Ext(f.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, f.Name()))
		if err != nil {
			return nil, err
		}
		if !json.Valid(data) {
			return nil, fmt.Errorf("invalid scene %s", f.Name())
		}
		out[strings.TrimSuffix(f.Name(), ".json")] = data
	}
	return out, nil
}
func readJSON(path string) (map[string]any, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var v map[string]any
	err = json.Unmarshal(b, &v)
	return v, err
}
func (h *Host) defaults() (map[string]any, error) {
	shared, err := readJSON(filepath.Join(h.options.Source, "materials/defaults.json"))
	if err != nil {
		return nil, err
	}
	worlds, engine := map[string]any{}, map[string]any{}
	for world := range h.worlds {
		table, err := readJSON(filepath.Join(h.options.Source, "materials", world+".json"))
		if err != nil {
			return nil, err
		}
		data, ok := table["world"].(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%s has no world data", world)
		}
		worlds[world] = data["knobDefaults"]
		engine[world] = data["engineDefaults"]
	}
	return map[string]any{"defaults": shared["knobs"], "worlds": worlds, "engine": engine}, nil
}
func (h *Host) save(w http.ResponseWriter, r *http.Request, name string) {
	if !localName(name) || (filepath.Ext(name) != ".json" && filepath.Ext(name) != ".png") {
		failed(w, 400, fmt.Errorf("save a .json or .png path under the output directory"))
		return
	}
	const limit = 32 * 1024 * 1024
	if r.ContentLength > limit {
		failed(w, 413, fmt.Errorf("evidence exceeds 32 MB"))
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		if _, ok := err.(*http.MaxBytesError); ok {
			failed(w, 413, fmt.Errorf("evidence exceeds 32 MB"))
		} else {
			failed(w, 400, err)
		}
		return
	}
	if err = h.output.MkdirAll(filepath.Dir(name), 0755); err == nil {
		err = h.output.WriteFile(name, data, 0644)
	}
	if err != nil {
		failed(w, 400, err)
		return
	}
	answer(w, 200, map[string]string{"saved": name})
}

// Only HTML/JS that needs instrumentation is buffered. Wasm and all other files
// go through the normal development handler without another serving pipeline.
type capture struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (c *capture) Header() http.Header    { return c.header }
func (c *capture) WriteHeader(status int) { c.status = status }
func (c *capture) Write(b []byte) (int, error) {
	if c.status == 0 {
		c.status = 200
	}
	return c.body.Write(b)
}
func (h *Host) instrument(w http.ResponseWriter, r *http.Request) {
	c := &capture{header: http.Header{}}
	request := r.Clone(r.Context())
	request.Method = "GET"
	h.editor.ServeHTTP(c, request)
	if c.status == 0 {
		c.status = 200
	}
	data := c.body.Bytes()
	if c.status == 200 {
		if r.URL.Path == "/sculpt.js" {
			name := "hook.js"
			if h.options.Mode == "interaction" {
				name = "expose.js"
			}
			hook, err := rootedFile(filepath.Join(h.options.Tools, "repro", h.options.Mode), name)
			if err != nil {
				failed(w, 500, err)
				return
			}
			data = append(data, []byte("\nif(experiment.has(\""+h.options.Mode+"\")){\n")...)
			data = append(data, hook...)
			data = append(data, []byte("\n}\n")...)
		} else if h.options.Mode == "interaction" {
			data = bytes.Replace(data, []byte("<head>"), []byte(`<head><script src="/interaction/hooks.js"></script>`), 1)
		}
	}
	for key, values := range c.header {
		w.Header()[key] = values
	}
	w.Header().Set("Content-Length", fmt.Sprint(len(data)))
	w.WriteHeader(c.status)
	if r.Method != "HEAD" {
		_, _ = w.Write(data)
	}
}
func (h *Host) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	path := r.URL.Path
	prefix := "/" + h.options.Mode + "/"
	if r.Method == "POST" && strings.HasPrefix(path, prefix+"save/") {
		h.save(w, r, strings.TrimPrefix(path, prefix+"save/"))
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		http.NotFound(w, r)
		return
	}
	if path == prefix+"scenes.json" {
		scenes, err := h.scenes()
		if err != nil {
			failed(w, 400, err)
		} else {
			answer(w, 200, scenes)
		}
		return
	}
	if h.options.Mode == "audit" {
		if path == "/audit/defaults.json" {
			data, err := h.defaults()
			if err != nil {
				failed(w, 400, err)
			} else {
				answer(w, 200, data)
			}
			return
		}
		if path == "/audit/inventory.json" {
			sendFile(w, r, h.options.Evidence, "inventory.json")
			return
		}
		before := map[string]string{"/audit/erosion-before.js": "sculpt-erosion.js", "/audit/fields-before.js": "sculpt-gpu-fields.js", "/audit/features-before.js": "sculpt-features.js"}
		if file, ok := before[path]; ok {
			data, err := rootedFile(filepath.Join(h.options.Evidence, "baseline"), file)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
			if r.Method != "HEAD" {
				_, _ = w.Write(bytes.ReplaceAll(data, []byte("from './sculpt-"), []byte("from '/sculpt-")))
			}
			return
		}
		if strings.HasPrefix(path, "/audit-report/") {
			sendFile(w, r, h.options.Report, strings.TrimPrefix(path, "/audit-report/"))
			return
		}
		if strings.HasPrefix(path, "/sculpt-assets/") {
			parts := strings.Split(strings.TrimPrefix(path, "/sculpt-assets/"), "/")
			if len(parts) != 2 || !h.worlds[parts[0]] {
				http.NotFound(w, r)
				return
			}
			sendFile(w, r, h.options.Assets, "assets-"+parts[0]+"/"+parts[1])
			return
		}
	}
	if strings.HasPrefix(path, prefix) {
		sendFile(w, r, filepath.Join(h.options.Tools, "repro", h.options.Mode), strings.TrimPrefix(path, prefix))
		return
	}
	if strings.HasPrefix(path, "/results/") {
		sendFile(w, r, h.options.Out, strings.TrimPrefix(path, "/results/"))
		return
	}
	if path == "/" || path == "/index.html" || path == "/sculpt.js" {
		h.instrument(w, r)
		return
	}
	h.editor.ServeHTTP(w, r)
}
