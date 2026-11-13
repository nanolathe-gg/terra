package site

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/base32"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

const maxCompressed = 1024 * 1024
const maxUncompressed = 16 * 1024 * 1024

var mapID = regexp.MustCompile(`^[a-z2-7]{16}$`)

func reply(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
func refusal(w http.ResponseWriter, status int, message string) {
	reply(w, status, object{"error": message})
}
func saveError(body []byte) (int, string) {
	if len(body) < 2 || body[0] != 0x1f || body[1] != 0x8b {
		return 400, "The body is not gzip data. Send the save compressed with gzip."
	}
	gz, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		return 400, "The gzip data is damaged or does not hold UTF-8 text."
	}
	defer gz.Close()
	raw, err := io.ReadAll(io.LimitReader(gz, maxUncompressed+1))
	if len(raw) > maxUncompressed {
		return 413, "The save is too large once uncompressed (limit 16 MB)."
	}
	if err != nil || !utf8.Valid(raw) {
		return 400, "The gzip data is damaged or does not hold UTF-8 text."
	}
	var v any
	if err = json.Unmarshal(raw, &v); err != nil {
		return 400, "The save is not valid JSON."
	}
	save, ok := v.(map[string]any)
	if !ok || save["format"] != "nanolathe-terrain-sculpt" {
		return 400, "This is not a Terraform save: its format must be nanolathe-terrain-sculpt."
	}
	version, ok := save["version"].(float64)
	if !ok || version < 1 || version != float64(int64(version)) {
		return 400, "This is not a Terraform save: it has no version number."
	}
	nodes, ok := save["nodes"].([]any)
	if !ok {
		return 400, "This is not a Terraform save: nodes must be a list of stroke objects."
	}
	for _, n := range nodes {
		if _, ok := n.(map[string]any); !ok {
			return 400, "This is not a Terraform save: nodes must be a list of stroke objects."
		}
	}
	return 0, ""
}
func savedMaps(root string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/api/maps" {
			body, err := io.ReadAll(io.LimitReader(r.Body, maxCompressed+1))
			if len(body) > maxCompressed {
				refusal(w, 413, "The save is too large (limit 1 MB compressed).")
				return
			}
			if err != nil {
				refusal(w, 400, "Could not read the save.")
				return
			}
			if status, message := saveError(body); status != 0 {
				refusal(w, status, message)
				return
			}
			hash := sha256.Sum256(body)
			id := strings.ToLower(base32.StdEncoding.EncodeToString(hash[:]))[:16]
			dir := filepath.Join(root, "maps")
			if err = os.MkdirAll(dir, 0755); err == nil {
				// A unique temporary file avoids races between simultaneous posts of the same save.
				var f *os.File
				f, err = os.CreateTemp(dir, "save-*.tmp")
				if err == nil {
					name := f.Name()
					defer os.Remove(name)
					_, err = f.Write(body)
					closeErr := f.Close()
					if err == nil {
						err = closeErr
					}
					if err == nil {
						err = os.Rename(name, filepath.Join(dir, id+".json.gz"))
					}
				}
			}
			if err != nil {
				refusal(w, 500, "Could not store the save.")
				return
			}
			reply(w, 200, object{"id": id})
			return
		}
		if (r.Method == http.MethodGet || r.Method == http.MethodHead) && strings.HasPrefix(r.URL.Path, "/api/maps/") {
			id := strings.TrimPrefix(r.URL.Path, "/api/maps/")
			if !mapID.MatchString(id) {
				refusal(w, 404, "No saved map has this id.")
				return
			}
			body, err := os.ReadFile(filepath.Join(root, "maps", id+".json.gz"))
			if err != nil {
				refusal(w, 404, "No saved map has this id.")
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Content-Encoding", "gzip")
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			w.Header().Set("Content-Length", fmt.Sprint(len(body)))
			if r.Method == http.MethodGet {
				_, _ = w.Write(body)
			}
			return
		}
		http.NotFound(w, r)
	})
}

// Handler reads source bytes on each request. Generated files also reload their
// JSON inputs on every request, so development edits never need a server restart.
// Only changes to this Go program itself require restarting the process.
func (s *Site) Handler(assetsRoot string) (http.Handler, error) {
	maps := savedMaps(assetsRoot)
	exporter := &Exporter{root: s.Root}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/maps" || strings.HasPrefix(r.URL.Path, "/api/maps/") {
			maps.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		if !safeName(name) {
			http.NotFound(w, r)
			return
		}
		if name == "map-export.wasm" || name == "wasm_exec.js" {
			data, err := exporter.Get(name)
			if err != nil {
				refusal(w, 503, err.Error())
				return
			}
			serveBytes(w, r, name, data)
			return
		}
		if name == "services.json" || strings.HasPrefix(name, "config/") {
			current, err := Load(s.Root)
			if err != nil {
				refusal(w, 503, err.Error())
				return
			}
			generated, err := current.Generated("api/maps")
			if err != nil {
				refusal(w, 503, err.Error())
				return
			}
			if data, ok := generated[name]; ok {
				serveBytes(w, r, name, data)
				return
			}
			http.NotFound(w, r)
			return
		}
		// Reload the small source manifest too, so adding a shipped file or preview
		// during development takes effect without restarting the server.
		manifest, err := os.ReadFile(filepath.Join(s.Root, "site.json"))
		if err != nil {
			refusal(w, 503, err.Error())
			return
		}
		current := &Site{Root: s.Root}
		if err = json.Unmarshal(manifest, &current.Manifest); err != nil {
			refusal(w, 503, err.Error())
			return
		}
		sources, err := current.Sources()
		if err != nil {
			refusal(w, 503, err.Error())
			return
		}
		if path, ok := sources[name]; ok {
			data, err := os.ReadFile(path)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			serveBytes(w, r, name, data)
			return
		}
		http.NotFound(w, r)
	}), nil
}
func serveBytes(w http.ResponseWriter, r *http.Request, name string, data []byte) {
	content := mime.TypeByExtension(filepath.Ext(name))
	if content == "" {
		content = "text/plain; charset=utf-8"
	}
	w.Header().Set("Content-Type", content)
	w.Header().Set("Content-Length", fmt.Sprint(len(data)))
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodGet {
		_, _ = w.Write(data)
	}
}
