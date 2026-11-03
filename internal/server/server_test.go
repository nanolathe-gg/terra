package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func testServer(t *testing.T) *Server {
	t.Helper()
	root := filepath.Join("..", "..")
	s, e := New(Options{SourceRoot: root, AssetsRoot: t.TempDir(), Prepared: true})
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func request(t *testing.T, s *Server, method, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, bytes.NewReader(body))
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func TestWorldsAndVariants(t *testing.T) {
	s := testServer(t)
	for _, world := range s.Biomes {
		w := request(t, s, "GET", "/sculpt-config.json?biome="+world, nil)
		if w.Code != 200 {
			t.Fatalf("%s: %d %s", world, w.Code, w.Body)
		}
		var c map[string]any
		if e := json.Unmarshal(w.Body.Bytes(), &c); e != nil {
			t.Fatal(e)
		}
		if c["biomeId"] != world {
			t.Fatal(c["biomeId"])
		}
		for variant := range s.worlds.Variants[world] {
			w = request(t, s, "GET", fmt.Sprintf("/sculpt-config.json?biome=%s&variant=%s", world, variant), nil)
			if w.Code != 200 {
				t.Fatalf("%s/%s: %d", world, variant, w.Code)
			}
		}
	}
	if w := request(t, s, "GET", "/sculpt-config.json?biome=missing", nil); w.Code != 404 {
		t.Fatal(w.Code)
	}
}
func TestDocumentRevisionAndChunks(t *testing.T) {
	s := testServer(t)
	p := "/map-document?id=test"
	if w := request(t, s, "GET", p, nil); w.Code != 404 {
		t.Fatal(w.Code)
	}
	w := request(t, s, "PUT", p, []byte(`{"name":"a"}`))
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	w = request(t, s, "PUT", p, []byte(`{"name":"a"}`))
	var v map[string]any
	json.Unmarshal(w.Body.Bytes(), &v)
	if v["revision"] != float64(1) {
		t.Fatal(v)
	}
	c := "/map-document/chunk?id=test&key=0_0"
	w = request(t, s, "PUT", c, []byte("data"))
	json.Unmarshal(w.Body.Bytes(), &v)
	if v["changed"] != true || v["revision"] != float64(2) {
		t.Fatal(v)
	}
	w = request(t, s, "PUT", c, []byte("data"))
	json.Unmarshal(w.Body.Bytes(), &v)
	if v["changed"] != false || v["revision"] != float64(2) {
		t.Fatal(v)
	}
	w = request(t, s, "GET", c, nil)
	if w.Body.String() != "data" || w.Header().Get("ETag") == "" {
		t.Fatal(w)
	}
	w = request(t, s, "DELETE", c, nil)
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	w = request(t, s, "GET", c, nil)
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
	w = request(t, s, "PUT", "/map-document?id=../bad", []byte(`{}`))
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
}
func TestStaticAndCatalog(t *testing.T) {
	s := testServer(t)
	for _, p := range []string{"/sculpt", "/materials/green.json", "/map-catalog.json"} {
		if w := request(t, s, "GET", p, nil); w.Code != http.StatusOK {
			t.Fatalf("%s: %d", p, w.Code)
		}
	}
	if w := request(t, s, "GET", "/go.mod", nil); w.Code != 404 {
		t.Fatal(w.Code)
	}
	if _, e := os.Stat(filepath.Join(s.SourceRoot, "sculpt.html")); e != nil {
		t.Fatal(e)
	}
}
func TestStreamExport(t *testing.T) {
	s := testServer(t)
	helper := filepath.Join(t.TempDir(), "helper")
	script := `#!/bin/sh
printf '%s\n' '{"ready":true,"width":512,"height":512,"maxChunkSide":512}'
while IFS= read -r line; do
 case "$line" in
 *'"finish"'*) printf '%s\n' '{"archive":"example.ufo"}'; exit 0;;
 *) printf '%s\n' '{"accepted":true}';;
 esac
done
`
	if e := os.WriteFile(helper, []byte(script), 0700); e != nil {
		t.Fatal(e)
	}
	s.exports.o.ExportTool = helper
	w := request(t, s, "POST", "/map-export/start", []byte(`{"name":"example","world":"green"}`))
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	var ready map[string]any
	json.Unmarshal(w.Body.Bytes(), &ready)
	id := ready["id"].(string)
	w = request(t, s, "POST", "/map-export/chunk?id="+id+"&x=0&y=0&width=512&height=512", []byte("png"))
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	w = request(t, s, "POST", "/map-export/finish?id="+id, nil)
	if w.Code != 200 {
		t.Fatal(w.Body)
	}
	var result map[string]any
	json.Unmarshal(w.Body.Bytes(), &result)
	if result["archive"] != "example.ufo" {
		t.Fatal(result)
	}
	w = request(t, s, "POST", "/map-export/finish?id="+id, nil)
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
}
