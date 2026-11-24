package reprohost

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nanolathe-gg/terra/internal/site"
)

func fixture(t *testing.T, mode string) (*Host, Options) {
	t.Helper()
	source, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	o := Options{Mode: mode, Source: source, Tools: t.TempDir(), Out: t.TempDir(), Assets: t.TempDir(), Evidence: t.TempDir(), Report: t.TempDir()}
	dir := filepath.Join(o.Tools, "repro", mode)
	if err = os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string]string{"index.html": "harness", "hooks.js": "window.fixtureHooks=true;", "expose.js": "window.fixtureExpose=true;", "hook.js": "window.fixtureAudit=true;"} {
		if err = os.WriteFile(filepath.Join(dir, name), []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	h, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close() })
	return h, o
}
func request(h http.Handler, method, path string, body []byte) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(method, path, bytes.NewReader(body)))
	return w
}
func TestHarnessUsesEditorAndLiveFiles(t *testing.T) {
	for _, mode := range []string{"interaction", "audit"} {
		t.Run(mode, func(t *testing.T) {
			h, o := fixture(t, mode)
			w := request(h, "GET", "/?"+mode+"=1", nil)
			if w.Code != 200 || !strings.Contains(w.Body.String(), `id="terrain"`) {
				t.Fatal(w.Code)
			}
			if strings.Contains(w.Body.String(), "/interaction/hooks.js") != (mode == "interaction") {
				t.Fatal("wrong HTML instrumentation")
			}
			w = request(h, "GET", "/sculpt.js", nil)
			if w.Code != 200 || !strings.Contains(w.Body.String(), `if(experiment.has("`+mode+`"))`) {
				t.Fatal("missing guarded API")
			}
			normal, err := site.Load(o.Source)
			if err != nil {
				t.Fatal(err)
			}
			plain, err := normal.Handler(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if body := request(plain, "GET", "/sculpt.js", nil).Body.String(); strings.Contains(body, "fixtureExpose") || strings.Contains(body, "fixtureAudit") {
				t.Fatal("research hooks reached normal editor")
			}
			path := "/" + mode + "/index.html"
			if request(h, "GET", path, nil).Body.String() != "harness" {
				t.Fatal("harness missing")
			}
			if err = os.WriteFile(filepath.Join(o.Tools, "repro", mode, "index.html"), []byte("updated harness"), 0644); err != nil {
				t.Fatal(err)
			}
			if request(h, "GET", path, nil).Body.String() != "updated harness" {
				t.Fatal("stale harness file")
			}
			var scenes map[string]json.RawMessage
			w = request(h, "GET", "/"+mode+"/scenes.json", nil)
			if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &scenes) != nil || len(scenes) == 0 {
				t.Fatal("scenes unavailable")
			}
			if w = request(h, "GET", "/config/green.json", nil); w.Code != 200 || !strings.Contains(w.Body.String(), `"biomeId":"green"`) {
				t.Fatal("normal config route unavailable")
			}
		})
	}
}
func TestEvidenceSaveIsScopedAndRoundTrips(t *testing.T) {
	for _, mode := range []string{"interaction", "audit"} {
		t.Run(mode, func(t *testing.T) {
			h, o := fixture(t, mode)
			data := []byte(`{"capture":1}`)
			if w := request(h, "POST", "/"+mode+"/save/trial/capture.json", data); w.Code != 200 {
				t.Fatal(w.Body)
			}
			if w := request(h, "GET", "/results/trial/capture.json", nil); w.Code != 200 || !bytes.Equal(w.Body.Bytes(), data) {
				t.Fatal(w)
			}
			for _, name := range []string{"../outside.json", "/absolute.json", "bad.js", "dir\\escape.json"} {
				if w := request(h, "POST", "/"+mode+"/save/"+name, data); w.Code != 400 {
					t.Fatalf("accepted %q: %d", name, w.Code)
				}
			}
			outside := t.TempDir()
			if err := os.WriteFile(filepath.Join(outside, "secret.json"), []byte("outside"), 0644); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(outside, filepath.Join(o.Out, "escape")); err != nil {
				t.Fatal(err)
			}
			if w := request(h, "POST", "/"+mode+"/save/escape/outside.json", data); w.Code != 400 {
				t.Fatal("symlink write escaped output", w.Code)
			}
			if _, err := os.Stat(filepath.Join(outside, "outside.json")); !os.IsNotExist(err) {
				t.Fatal("wrote outside output")
			}
			if w := request(h, "GET", "/results/escape/secret.json", nil); w.Code != 404 {
				t.Fatal("symlink read escaped output")
			}
			r := httptest.NewRequest("POST", "/"+mode+"/save/large.png", strings.NewReader("small"))
			r.ContentLength = 32*1024*1024 + 1
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != 413 {
				t.Fatal("missing evidence limit", w.Code)
			}
		})
	}
}
func TestAuditReferenceRoutes(t *testing.T) {
	h, o := fixture(t, "audit")
	if err := os.Mkdir(filepath.Join(o.Evidence, "baseline"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(o.Evidence, "baseline/sculpt-erosion.js"), []byte("import {x} from './sculpt-x.js';"), 0644); err != nil {
		t.Fatal(err)
	}
	if w := request(h, "GET", "/audit/erosion-before.js", nil); w.Code != 200 || !strings.Contains(w.Body.String(), "from '/sculpt-x.js'") {
		t.Fatal(w)
	}
	if err := os.WriteFile(filepath.Join(o.Evidence, "inventory.json"), []byte(`{"controls":[]}`), 0644); err != nil {
		t.Fatal(err)
	}
	if w := request(h, "GET", "/audit/inventory.json", nil); w.Code != 200 {
		t.Fatal(w)
	}
	var defaults map[string]map[string]any
	w := request(h, "GET", "/audit/defaults.json", nil)
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &defaults) != nil || defaults["worlds"]["green"] == nil || len(defaults["defaults"]) == 0 {
		t.Fatal("defaults missing")
	}
	if err := os.WriteFile(filepath.Join(o.Report, "index.html"), []byte("report"), 0644); err != nil {
		t.Fatal(err)
	}
	if w := request(h, "GET", "/audit-report/index.html", nil); w.Code != 200 || w.Body.String() != "report" {
		t.Fatal(w)
	}
	if err := os.Mkdir(filepath.Join(o.Assets, "assets-green"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(o.Assets, "assets-green/reference.png"), []byte("authored test bytes"), 0644); err != nil {
		t.Fatal(err)
	}
	if w := request(h, "GET", "/sculpt-assets/green/reference.png", nil); w.Code != 200 {
		t.Fatal(w)
	}
	if w := request(h, "GET", "/sculpt-assets/unknown/reference.png", nil); w.Code != 404 {
		t.Fatal(w)
	}
}
