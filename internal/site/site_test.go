package site

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/base32"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeJSON(t *testing.T, path string, v any) {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, b, 0644); err != nil {
		t.Fatal(err)
	}
}
func fixture(t *testing.T) (*Site, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "materials"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "ui-previews"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"defaults.json", "green.json"} {
		data, err := os.ReadFile(filepath.Join("../../materials", name))
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(root, "materials", name), data, 0644); err != nil {
			t.Fatal(err)
		}
	}
	writeJSON(t, filepath.Join(root, "site.json"), Manifest{Worlds: []World{{ID: "green", Name: "Green Planet"}}, FeatureWorlds: []string{"green"}, FeatureFallback: "green", Sources: []string{"index.html", "example.js"}})
	if err := os.WriteFile(filepath.Join(root, "example.js"), []byte("first"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("editor"), 0644); err != nil {
		t.Fatal(err)
	}
	s, err := Load(root)
	if err != nil {
		t.Fatal(err)
	}
	return s, root
}
func get(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	return w
}
func jsonBody(t *testing.T, w *httptest.ResponseRecorder) object {
	t.Helper()
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	var data object
	if err := decode(w.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}
	return data
}
func TestDevelopmentReload(t *testing.T) {
	s, root := fixture(t)
	h, err := s.Handler(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if w := get(t, h, "/example.js"); w.Body.String() != "first" || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(w)
	}
	if err = os.WriteFile(filepath.Join(root, "example.js"), []byte("later"), 0644); err != nil {
		t.Fatal(err)
	}
	if w := get(t, h, "/example.js"); w.Body.String() != "later" {
		t.Fatal("stale source", w.Body)
	}
	// World overrides and common defaults both reload without restarting the handler.
	path := filepath.Join(root, "materials/green.json")
	table, err := readObject(path)
	if err != nil {
		t.Fatal(err)
	}
	obj(obj(table["world"])["knobDefaults"])["ambient"] = json.Number("0.123")
	writeJSON(t, path, table)
	if got := obj(jsonBody(t, get(t, h, "/config/green.json"))["defaults"])["ambient"]; got != "0.123" {
		t.Fatal("stale world override", got)
	}
	path = filepath.Join(root, "materials/defaults.json")
	defaults, err := readObject(path)
	if err != nil {
		t.Fatal(err)
	}
	obj(defaults["knobs"])["groundPatch"] = 99
	writeJSON(t, path, defaults)
	if got := obj(jsonBody(t, get(t, h, "/config/green.json"))["defaults"])["groundPatch"]; got != "99" {
		t.Fatal("stale common default", got)
	}
	// Adding a source to the manifest is live too.
	s.Manifest.Sources = append(s.Manifest.Sources, "new.js")
	writeJSON(t, filepath.Join(root, "site.json"), s.Manifest)
	if err = os.WriteFile(filepath.Join(root, "new.js"), []byte("new module"), 0644); err != nil {
		t.Fatal(err)
	}
	if w := get(t, h, "/new.js"); w.Code != 200 || w.Body.String() != "new module" {
		t.Fatal(w)
	}
	// A transient JSON error is visible and recovers on the next request.
	if err = os.WriteFile(path, []byte("{"), 0644); err != nil {
		t.Fatal(err)
	}
	if w := get(t, h, "/config/green.json"); w.Code != 503 {
		t.Fatal(w.Code)
	}
	writeJSON(t, path, defaults)
	jsonBody(t, get(t, h, "/config/green.json"))
	for _, path := range []string{"/go.mod", "/../go.mod", "/materials/../../go.mod", "/missing.js"} {
		if w := get(t, h, path); w.Code != 404 {
			t.Fatalf("%s: %d", path, w.Code)
		}
	}
	if w := get(t, h, "/"); w.Code != 200 || w.Body.String() != "editor" {
		t.Fatal(w)
	}
}
func TestGeneratedDeterminism(t *testing.T) {
	s, _ := fixture(t)
	a, err := s.Generated("")
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Generated("")
	if err != nil {
		t.Fatal(err)
	}
	for name, data := range a {
		if !bytes.Equal(data, b[name]) {
			t.Fatalf("%s changed across repeated generation", name)
		}
	}
	for name, data := range a {
		if strings.HasPrefix(name, "config/green") {
			var c object
			if err = decode(data, &c); err != nil {
				t.Fatal(err)
			}
			if _, ok := c["knobDefaults"]; ok {
				t.Fatal("assembly metadata leaked")
			}
			if _, ok := c["variants"]; ok {
				t.Fatal("world variants are gone")
			}
		}
	}
	if safeName("../secret") || safeName("/etc/passwd") || safeName("a/../../secret") || safeName("a\\secret") {
		t.Fatal("unsafe source path accepted")
	}
}
func zipped(t *testing.T, raw []byte) []byte {
	t.Helper()
	var b bytes.Buffer
	gz := gzip.NewWriter(&b)
	if _, err := gz.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func TestLocalSaveLinks(t *testing.T) {
	h := savedMaps(t.TempDir())
	body := zipped(t, []byte(`{"format":"nanolathe-terrain-sculpt","version":6,"nodes":[]}`))
	sum := sha256.Sum256(body)
	want := strings.ToLower(base32.StdEncoding.EncodeToString(sum[:]))[:16]
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", "/api/maps", bytes.NewReader(body)))
		if jsonBody(t, w)["id"] != want {
			t.Fatal(w.Body)
		}
	}
	w := get(t, h, "/api/maps/"+want)
	if w.Code != 200 || w.Header().Get("Content-Encoding") != "gzip" || !bytes.Equal(w.Body.Bytes(), body) {
		t.Fatal(w)
	}
	for _, path := range []string{"/api/maps/../../secret", "/api/maps/aaaaaaaaaaaaaaaa"} {
		if w := get(t, h, path); w.Code != 404 {
			t.Fatal(w)
		}
	}
	for _, raw := range []string{`{`, `{}`, `{"format":"nanolathe-terrain-sculpt","version":true,"nodes":[]}`, `{"format":"nanolathe-terrain-sculpt","version":6,"nodes":[null]}`} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", "/api/maps", bytes.NewReader(zipped(t, []byte(raw)))))
		if w.Code != 400 {
			t.Fatalf("bad save accepted: %s (%d)", raw, w.Code)
		}
	}
	oversized := zipped(t, bytes.Repeat([]byte("x"), maxUncompressed+1))
	if status, _ := saveError(oversized); status != 413 {
		t.Fatal("uncompressed limit", status)
	}
	// A small gzip that inflates past maxRatio times its own size is refused, as the Worker refuses it.
	bomb := zipped(t, bytes.Repeat([]byte("x"), 200*1024))
	if status, _ := saveError(bomb); status != 413 {
		t.Fatal("inflation ratio limit", status)
	}
	for _, b := range [][]byte{[]byte("plain"), body[:len(body)-4]} {
		if status, _ := saveError(b); status != 400 {
			t.Fatal("damaged gzip accepted", status)
		}
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/api/maps", io.LimitReader(strings.NewReader(strings.Repeat("x", maxCompressed+1)), maxCompressed+1)))
	if w.Code != 413 {
		t.Fatal("compressed limit", w.Code)
	}
}

func TestExporterSourceChanges(t *testing.T) {
	root := t.TempDir()
	for _, dir := range []string{"export", "mapdata", "internal"} {
		if err := os.Mkdir(filepath.Join(root, dir), 0755); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"go.mod", "go.sum", "export/main.go"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("before"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	before, err := exporterDigest(root)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, "export/main.go"), []byte("after"), 0644); err != nil {
		t.Fatal(err)
	}
	after, err := exporterDigest(root)
	if err != nil {
		t.Fatal(err)
	}
	if before == after {
		t.Fatal("exporter source edit was not detected")
	}
	if err = os.WriteFile(filepath.Join(root, "export/added.go"), []byte("new source"), 0644); err != nil {
		t.Fatal(err)
	}
	added, err := exporterDigest(root)
	if err != nil {
		t.Fatal(err)
	}
	if added == after {
		t.Fatal("new exporter source was not detected")
	}
}
func TestMalformedConfigInput(t *testing.T) {
	_, root := fixture(t)
	path := filepath.Join(root, "materials/defaults.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, append(data, []byte("{}")...), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err = Load(root); err == nil {
		t.Fatal("trailing JSON value was silently accepted")
	}
}
