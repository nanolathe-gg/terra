package server

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func testServer(t *testing.T) *Server {
	t.Helper()
	root := filepath.Join("..", "..")
	s, e := New(Options{SourceRoot: root, AssetsRoot: t.TempDir(), Prepared: true})
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(s.Close)
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

// The subprocess stderr copier can still be writing while an export error is
// reported. Exercise both operations concurrently under the race detector.
func TestExportStderrConcurrentRead(t *testing.T) {
	var output lockedBuffer
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			_, _ = output.Write([]byte("helper diagnostic\n"))
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			_ = output.String()
		}
	}()
	wg.Wait()
	if !strings.Contains(output.String(), "helper diagnostic") {
		t.Fatal("missing helper diagnostic")
	}
}

func TestCanceledExportStartCleansUp(t *testing.T) {
	s := testServer(t)
	helper := filepath.Join(t.TempDir(), "helper")
	marker := filepath.Join(t.TempDir(), "started")
	if e := os.WriteFile(helper, []byte("#!/bin/sh\ntouch \""+marker+"\"\nexec sleep 30\n"), 0700); e != nil {
		t.Fatal(e)
	}
	s.exports.o.ExportTool = helper
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, e := s.exports.start(ctx, map[string]any{"world": "green"})
		done <- e
	}()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, e := os.Stat(marker); e == nil {
			break
		}
		if time.Now().After(deadline) {
			cancel()
			t.Fatal("helper did not start")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	select {
	case e := <-done:
		if !errors.Is(e, context.Canceled) {
			t.Fatalf("expected cancellation, got %v", e)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("canceled start did not stop helper")
	}
	if len(s.exports.jobs) != 0 {
		t.Fatal("canceled start retained an export job")
	}
}

func TestCloseStopsExport(t *testing.T) {
	s := testServer(t)
	helper := filepath.Join(t.TempDir(), "helper")
	script := "#!/bin/sh\nprintf '%s\\n' '{\"ready\":true}'\nexec sleep 30\n"
	if e := os.WriteFile(helper, []byte(script), 0700); e != nil {
		t.Fatal(e)
	}
	s.exports.o.ExportTool = helper
	ready, e := s.exports.start(context.Background(), map[string]any{"world": "green"})
	if e != nil {
		t.Fatal(e)
	}
	j := s.exports.jobs[ready["id"].(string)]
	staged := filepath.Join(s.AssetsRoot, "exports", ".map-export-"+j.id+"-archive.tmp")
	if e := os.MkdirAll(filepath.Dir(staged), 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(staged, []byte("partial"), 0600); e != nil {
		t.Fatal(e)
	}
	s.Close()
	if _, e := os.Stat(staged); !os.IsNotExist(e) {
		t.Fatalf("staged archive remains: %v", e)
	}
	if len(s.exports.jobs) != 0 {
		t.Fatal("close retained job")
	}
	if _, e := os.Stat(j.dir); !os.IsNotExist(e) {
		t.Fatalf("temporary directory remains: %v", e)
	}
	if _, e := s.exports.start(context.Background(), map[string]any{"world": "green"}); e == nil {
		t.Fatal("start succeeded after close")
	}
}

func TestRecoverOnlyDeadOwnedExportJobs(t *testing.T) {
	temp, assets, foreign := t.TempDir(), t.TempDir(), t.TempDir()
	t.Setenv("TMPDIR", temp)
	output, _ := filepath.Abs(filepath.Join(assets, "exports"))
	otherOutput, _ := filepath.Abs(filepath.Join(foreign, "exports"))
	if err := os.MkdirAll(output, 0700); err != nil {
		t.Fatal(err)
	}
	makeJob := func(id string, pid int, out string) (string, string) {
		parent := filepath.Join(temp, "terraform-export-jobs-"+id)
		dir := filepath.Join(parent, "export-"+id)
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		b, _ := json.Marshal(exportOwner{Version: 1, ID: id, PID: pid, Output: out})
		if err := os.WriteFile(filepath.Join(parent, "owner.json"), b, 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte("{}"), 0600); err != nil {
			t.Fatal(err)
		}
		stage := filepath.Join(output, ".map-export-"+id+"-archive.tmp")
		if err := os.WriteFile(stage, []byte("partial"), 0600); err != nil {
			t.Fatal(err)
		}
		return parent, stage
	}
	dead, stage := makeJob(strings.Repeat("a", 32), 2147483647, output)
	active, activeStage := makeJob(strings.Repeat("b", 32), os.Getpid(), output)
	other, otherStage := makeJob(strings.Repeat("c", 32), 2147483647, otherOutput)
	s, err := New(Options{SourceRoot: filepath.Join("..", ".."), AssetsRoot: assets, Prepared: true})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, p := range []string{dead, stage} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("dead owned job remains: %s (%v)", p, err)
		}
	}
	for _, p := range []string{active, activeStage, other, otherStage} {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("unowned or live job removed: %s (%v)", p, err)
		}
	}
}

func TestCompressedWASMDelivery(t *testing.T) {
	s := testServer(t)
	s.SourceRoot = t.TempDir()
	dir := filepath.Join(s.SourceRoot, "web")
	if e := os.Mkdir(dir, 0700); e != nil {
		t.Fatal(e)
	}
	payload := []byte("\x00asm\x01\x00\x00\x00")
	path := filepath.Join(dir, "editor.wasm")
	if e := os.WriteFile(path, payload, 0600); e != nil {
		t.Fatal(e)
	}
	var compressed bytes.Buffer
	z := gzip.NewWriter(&compressed)
	_, _ = z.Write(payload)
	if e := z.Close(); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(path+".gz", compressed.Bytes(), 0600); e != nil {
		t.Fatal(e)
	}
	for _, accept := range []string{"gzip, deflate, br", "gzip;q=0, *;q=1", "identity"} {
		req := httptest.NewRequest("GET", "/web/editor.wasm", nil)
		req.Header.Set("Accept-Encoding", accept)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, req)
		if w.Code != 200 || w.Header().Get("Content-Type") != "application/wasm" {
			t.Fatalf("%s: %d %v", accept, w.Code, w.Header())
		}
		got := w.Body.Bytes()
		if accept == "gzip, deflate, br" {
			if w.Header().Get("Content-Encoding") != "gzip" {
				t.Fatal("gzip was not selected")
			}
			reader, e := gzip.NewReader(bytes.NewReader(got))
			if e != nil {
				t.Fatal(e)
			}
			got, e = io.ReadAll(reader)
			reader.Close()
			if e != nil {
				t.Fatal(e)
			}
		} else if w.Header().Get("Content-Encoding") != "" {
			t.Fatal("ignored gzip refusal")
		}
		if !bytes.Equal(got, payload) {
			t.Fatal("WASM changed in delivery")
		}
	}
}

func TestExportIdleReaperSkipsActiveRequests(t *testing.T) {
	s := testServer(t)
	helper := filepath.Join(t.TempDir(), "helper")
	script := "#!/bin/sh\nprintf '%s\\n' '{\"ready\":true}'\nexec sleep 30\n"
	if err := os.WriteFile(helper, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	s.exports.o.ExportTool = helper
	ready, err := s.exports.start(context.Background(), map[string]any{"world": "green"})
	if err != nil {
		t.Fatal(err)
	}
	id := ready["id"].(string)
	request := httptest.NewRequest("POST", "/map-export/chunk?id="+id, nil)
	job, err := s.exports.getJob(request)
	if err != nil {
		t.Fatal(err)
	}
	s.exports.mu.Lock()
	job.lastUsed = time.Now().Add(-2 * exportIdleTimeout)
	s.exports.mu.Unlock()
	s.exports.expireIdle(time.Now())
	s.exports.mu.Lock()
	stillActive := s.exports.jobs[id] == job
	s.exports.mu.Unlock()
	if !stillActive {
		t.Fatal("reaped an active request")
	}
	s.exports.releaseJob(job)
	s.exports.expireIdle(time.Now())
	s.exports.mu.Lock()
	if s.exports.jobs[id] != job {
		s.exports.mu.Unlock()
		t.Fatal("release failed to refresh the idle deadline")
	}
	job.lastUsed = time.Now().Add(-2 * exportIdleTimeout)
	s.exports.mu.Unlock()
	s.exports.expireIdle(time.Now())
	if _, err := os.Stat(job.dir); !os.IsNotExist(err) {
		t.Fatalf("idle job directory remains: %v", err)
	}
	if _, err := s.exports.getJob(request); err == nil {
		t.Fatal("reaped job still available")
	}
	s.Close()
	select {
	case <-s.exports.reaperDone:
	default:
		t.Fatal("server close left its reaper running")
	}
}

func TestExportIdleReaperDoesNotInterruptExchange(t *testing.T) {
	s := testServer(t)
	helperDir := t.TempDir()
	helper, marker := filepath.Join(helperDir, "helper"), filepath.Join(helperDir, "waiting")
	script := "#!/bin/sh\nprintf '%s\\n' '{\"ready\":true}'\nIFS= read -r line\ntouch \"" + marker + "\"\nexec sleep 30\n"
	if err := os.WriteFile(helper, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	s.exports.o.ExportTool = helper
	ready, err := s.exports.start(context.Background(), map[string]any{"world": "green"})
	if err != nil {
		t.Fatal(err)
	}
	id := ready["id"].(string)
	done := make(chan int, 1)
	go func() {
		r := httptest.NewRequest("POST", "/map-export/chunk?id="+id+"&x=0&y=0&width=1&height=1", bytes.NewReader([]byte("png")))
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		done <- w.Code
	}()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(marker); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("helper did not enter exchange")
		}
		time.Sleep(time.Millisecond)
	}
	s.exports.mu.Lock()
	job := s.exports.jobs[id]
	job.lastUsed = time.Now().Add(-2 * exportIdleTimeout)
	s.exports.mu.Unlock()
	s.exports.expireIdle(time.Now())
	s.exports.mu.Lock()
	active := s.exports.jobs[id] == job
	s.exports.mu.Unlock()
	if !active {
		t.Fatal("reaper interrupted active helper exchange")
	}
	w := request(t, s, "DELETE", "/map-export?id="+id, nil)
	if w.Code != 200 {
		t.Fatalf("cancel: %d %s", w.Code, w.Body)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("canceled exchange did not stop")
	}
}
