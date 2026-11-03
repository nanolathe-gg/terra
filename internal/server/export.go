package server

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(p)
}
func (b *lockedBuffer) String() string { b.mu.Lock(); defer b.mu.Unlock(); return b.b.String() }

type exportJob struct {
	mu      sync.Mutex
	id, dir string
	cmd     *exec.Cmd
	input   io.WriteCloser
	output  *bufio.Reader
	stderr  lockedBuffer
}
type exportStore struct {
	o         Options
	mu        sync.Mutex
	jobs      map[string]*exportJob
	closing   bool
	closeCh   chan struct{}
	featureMu sync.Mutex
}

func (s *exportStore) init(o Options) {
	s.o = o
	s.jobs = map[string]*exportJob{}
	s.closeCh = make(chan struct{})
	s.cleanupCrashes()
}
func (s *exportStore) args(args ...string) []string {
	var a []string
	for _, r := range s.o.GameRoots {
		a = append(a, "--root", r)
	}
	return append(a, args...)
}
func (s *exportStore) features(world string) (string, error) {
	if !token.MatchString(world) || strings.Contains(world, "..") {
		return "", fmt.Errorf("invalid world")
	}
	s.featureMu.Lock()
	defer s.featureMu.Unlock()
	target := filepath.Join(s.o.AssetsRoot, "features", world)
	if s.o.Prepared {
		if _, e := os.Stat(filepath.Join(target, "catalog.json")); e != nil {
			return "", e
		}
		return target, nil
	}
	if _, e := os.Stat(filepath.Join(target, "catalog.json")); e == nil {
		return target, nil
	}
	if e := os.MkdirAll(s.o.AssetsRoot, 0700); e != nil {
		return "", e
	}
	catalog, e := exec.Command(s.o.ExportTool, s.args("--catalog")...).Output()
	if e != nil {
		return "", fmt.Errorf("map catalogue helper: %w", e)
	}
	if e = os.WriteFile(filepath.Join(s.o.AssetsRoot, "map-catalog.json"), catalog, 0600); e != nil {
		return "", e
	}
	cmd := exec.Command(s.o.FeatureTool, s.args("--catalog", filepath.Join(s.o.AssetsRoot, "map-catalog.json"), "--world", world, "--out", filepath.Join(s.o.AssetsRoot, "features"))...)
	if b, e := cmd.CombinedOutput(); e != nil {
		return "", fmt.Errorf("feature helper: %s", b)
	}
	return target, nil
}
func (j *exportJob) exchange(command any) (map[string]any, error) {
	if command != nil {
		b, e := json.Marshal(command)
		if e != nil {
			return nil, e
		}
		if _, e = j.input.Write(append(b, '\n')); e != nil {
			return nil, e
		}
	}
	type readResult struct {
		line []byte
		err  error
	}
	ch := make(chan readResult, 1)
	go func() { line, err := j.output.ReadBytes('\n'); ch <- readResult{line, err} }()
	var line []byte
	select {
	case result := <-ch:
		if result.err != nil {
			return nil, fmt.Errorf("export helper stopped: %s", j.stderr.String())
		}
		line = result.line
	case <-time.After(300 * time.Second):
		_ = j.cmd.Process.Kill()
		return nil, fmt.Errorf("Map export helper timed out")
	}
	var v map[string]any
	if e := json.Unmarshal(line, &v); e != nil {
		return nil, e
	}
	return v, nil
}
func (s *exportStore) start(ctx context.Context, req map[string]any) (map[string]any, error) {
	allowed := map[string]bool{"name": true, "description": true, "world": true, "unitsX": true, "unitsY": true, "seaLevel": true, "heights": true, "features": true, "starts": true, "settings": true}
	for k := range req {
		if !allowed[k] {
			return nil, fmt.Errorf("Unknown export metadata field")
		}
	}
	if v, ok := req["features"].([]any); ok && len(v) > 0 {
		world, _ := req["world"].(string)
		if _, e := s.features(world); e != nil {
			return nil, e
		}
	}
	var id [16]byte
	if _, e := rand.Read(id[:]); e != nil {
		return nil, e
	}
	name := hex.EncodeToString(id[:])
	parent, e := os.MkdirTemp("", "terraform-export-jobs-")
	if e != nil {
		return nil, e
	}
	output, e := filepath.Abs(filepath.Join(s.o.AssetsRoot, "exports"))
	if e != nil {
		os.Remove(parent)
		return nil, e
	}
	owner, e := json.Marshal(exportOwner{Version: 1, ID: name, PID: os.Getpid(), Output: output})
	if e != nil {
		os.Remove(parent)
		return nil, e
	}
	if e = os.WriteFile(filepath.Join(parent, "owner.json"), owner, 0600); e != nil {
		os.Remove(parent)
		return nil, e
	}
	dir := filepath.Join(parent, "export-"+name)
	if e = os.Mkdir(dir, 0700); e != nil {
		os.Remove(filepath.Join(parent, "owner.json"))
		os.Remove(parent)
		return nil, e
	}
	cleanup := true
	defer func() {
		if cleanup {
			removeJobDir(dir)
		}
	}()
	b, e := json.Marshal(req)
	if e != nil {
		return nil, e
	}
	manifest := filepath.Join(dir, "manifest.json")
	if e = os.WriteFile(manifest, b, 0600); e != nil {
		return nil, e
	}
	args := s.args("--stream", "--input", manifest, "--out", filepath.Join(s.o.AssetsRoot, "exports"), "--work", dir, "--features-root", filepath.Join(s.o.AssetsRoot, "features"))
	if s.o.Prepared {
		args = append(args, "--catalog-file", filepath.Join(s.o.AssetsRoot, "map-catalog.json"))
	}
	if budget := os.Getenv("NANOLATHE_EXPORT_TILE_BUDGET_MB"); budget != "" {
		args = append(args, "--tile-budget-mb", budget)
	}
	j := &exportJob{id: name, dir: dir, cmd: exec.Command(s.o.ExportTool, args...)}
	j.cmd.Stderr = &j.stderr
	j.input, e = j.cmd.StdinPipe()
	if e != nil {
		return nil, e
	}
	out, e := j.cmd.StdoutPipe()
	if e != nil {
		return nil, e
	}
	j.output = bufio.NewReader(out)
	if e = j.cmd.Start(); e != nil {
		return nil, e
	}
	// A client that leaves while the helper starts must not leave a child
	// process or private temporary directory behind.
	stopWatch := make(chan struct{})
	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		select {
		case <-ctx.Done():
			_ = j.cmd.Process.Kill()
		case <-s.closeCh:
			_ = j.cmd.Process.Kill()
		case <-stopWatch:
		}
	}()
	ready, e := j.exchange(nil)
	close(stopWatch)
	<-watchDone
	if ctx.Err() != nil {
		_ = j.cmd.Process.Kill()
		_ = j.cmd.Wait()
		return nil, ctx.Err()
	}
	if e != nil || ready["ready"] != true {
		j.cmd.Process.Kill()
		j.cmd.Wait()
		if e == nil {
			e = fmt.Errorf("Map export helper did not become ready")
		}
		return nil, e
	}
	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		_ = j.cmd.Process.Kill()
		_ = j.cmd.Wait()
		return nil, fmt.Errorf("Server is shutting down")
	}
	s.jobs[name] = j
	s.mu.Unlock()
	cleanup = false
	return map[string]any{"id": name, "width": ready["width"], "height": ready["height"], "maxChunkSide": ready["maxChunkSide"]}, nil
}

type exportOwner struct {
	Version int    `json:"version"`
	ID      string `json:"id"`
	PID     int    `json:"pid"`
	Output  string `json:"output"`
}

// Recover only explicitly owned jobs whose server process no longer exists.
func (s *exportStore) cleanupCrashes() {
	output, err := filepath.Abs(filepath.Join(s.o.AssetsRoot, "exports"))
	if err != nil {
		return
	}
	entries, err := os.ReadDir(os.TempDir())
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "terraform-export-jobs-") {
			continue
		}
		parent := filepath.Join(os.TempDir(), entry.Name())
		ownerPath := filepath.Join(parent, "owner.json")
		info, err := os.Lstat(ownerPath)
		if err != nil || !info.Mode().IsRegular() || info.Size() > 4096 {
			continue
		}
		b, err := os.ReadFile(ownerPath)
		if err != nil {
			continue
		}
		var owner exportOwner
		if json.Unmarshal(b, &owner) != nil || owner.Version != 1 || owner.Output != output || owner.PID <= 0 || !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(owner.ID) {
			continue
		}
		// A live process, an inaccessible process, and other errors all mean skip.
		if err := syscall.Kill(owner.PID, 0); !errors.Is(err, syscall.ESRCH) {
			continue
		}
		dir := filepath.Join(parent, "export-"+owner.ID)
		info, err = os.Lstat(dir)
		if err != nil || !info.IsDir() {
			continue
		}
		removeJobDir(dir)
		for _, kind := range []string{"archive", "indexed"} {
			os.Remove(filepath.Join(output, ".map-export-"+owner.ID+"-"+kind+".tmp"))
		}
	}
}

// EnsureFeatures prepares the catalogue required by native exports with placements.
func (s *Server) EnsureFeatures(world string) error {
	_, err := s.exports.features(world)
	return err
}

func removeJobDir(dir string) {
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.Name() == "manifest.json" || e.Name() == "chunk.png" || strings.HasPrefix(e.Name(), "nanolathe-map-tiles-") || strings.HasPrefix(e.Name(), "nanolathe-map-tnt-") {
			os.Remove(filepath.Join(dir, e.Name()))
		}
	}
	if os.Remove(dir) == nil {
		os.Remove(filepath.Join(filepath.Dir(dir), "owner.json"))
		os.Remove(filepath.Dir(dir))
	}
}
func (s *exportStore) discard(j *exportJob) {
	s.mu.Lock()
	delete(s.jobs, j.id)
	s.mu.Unlock()
	j.input.Close()
	if j.cmd.ProcessState == nil {
		j.cmd.Process.Kill()
		j.cmd.Wait()
	}
	removeJobDir(j.dir)
	// The exporter derives these exact staging names from the work directory.
	// They can survive a killed helper during final archive assembly.
	for _, kind := range []string{"archive", "indexed"} {
		os.Remove(filepath.Join(s.o.AssetsRoot, "exports", ".map-export-"+j.id+"-"+kind+".tmp"))
	}
}
func (s *exportStore) getJob(r *http.Request) (*exportJob, error) {
	v := r.URL.Query()["id"]
	if len(v) != 1 || !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(v[0]) {
		return nil, fmt.Errorf("One valid export id is required")
	}
	s.mu.Lock()
	j := s.jobs[v[0]]
	s.mu.Unlock()
	if j == nil {
		return nil, fmt.Errorf("Export id is unknown or no longer active")
	}
	return j, nil
}
func requestObject(r *http.Request, limit int64) (map[string]any, error) {
	if r.ContentLength <= 0 || r.ContentLength > limit {
		return nil, fmt.Errorf("Export request must be between 1 byte and %d MiB", limit>>20)
	}
	b, e := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if e != nil || int64(len(b)) != r.ContentLength {
		return nil, fmt.Errorf("Export request ended before Content-Length")
	}
	var m map[string]any
	if e = json.Unmarshal(b, &m); e != nil || m == nil {
		return nil, fmt.Errorf("Expected an export object")
	}
	return m, nil
}
func (s *exportStore) chunk(j *exportJob, coords []int, b []byte) (map[string]any, error) {
	if len(b) == 0 || len(b) > 64<<20 {
		return nil, fmt.Errorf("A PNG chunk must be between 1 byte and 64 MiB")
	}
	p := filepath.Join(j.dir, "chunk.png")
	if e := os.WriteFile(p, b, 0600); e != nil {
		return nil, e
	}
	defer os.Remove(p)
	v, e := j.exchange(map[string]any{"op": "chunk", "x": coords[0], "y": coords[1], "width": coords[2], "height": coords[3], "path": p})
	if e == nil {
		v["id"] = j.id
	}
	return v, e
}
func (s *exportStore) finish(j *exportJob) (map[string]any, error) {
	v, e := j.exchange(map[string]any{"op": "finish"})
	if e != nil {
		return nil, e
	}
	if e = j.cmd.Wait(); e != nil {
		return nil, fmt.Errorf("map export helper failed: %s", j.stderr.String())
	}
	return v, nil
}
func (s *exportStore) serve(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	if strings.HasPrefix(p, "/map-features/") {
		parts := strings.Split(strings.TrimPrefix(p, "/map-features/"), "/")
		if len(parts) != 2 || !token.MatchString(parts[0]) || filepath.Base(parts[1]) != parts[1] || !(parts[1] == "catalog.json" || strings.HasSuffix(parts[1], ".png")) {
			http.NotFound(w, r)
			return
		}
		dir := filepath.Join(s.o.AssetsRoot, "features", parts[0])
		if parts[1] == "catalog.json" {
			_, catalogErr := os.Stat(filepath.Join(dir, "catalog.json"))
			_, helperErr := os.Stat(s.o.FeatureTool)
			if catalogErr != nil && (s.o.Prepared || helperErr != nil) {
				reply(w, map[string]any{"world": parts[0], "features": []any{}, "unavailable": "This server has no feature catalogue installed, so no features can be placed; start positions remain editable."})
				return
			}
		}
		dir, e := s.features(parts[0])
		if e != nil {
			bad(w, e)
			return
		}
		http.ServeFile(w, r, filepath.Join(dir, parts[1]))
		return
	}
	if strings.HasPrefix(p, "/map-exports/") {
		name := strings.TrimPrefix(p, "/map-exports/")
		if filepath.Base(name) != name || !(strings.HasSuffix(strings.ToLower(name), ".ufo") || strings.HasSuffix(strings.ToLower(name), ".png")) {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", name))
		http.ServeFile(w, r, filepath.Join(s.o.AssetsRoot, "exports", name))
		return
	}
	if r.Method == "POST" && p == "/map-export/start" {
		m, e := requestObject(r, 16<<20)
		if e != nil {
			bad(w, e)
			return
		}
		v, e := s.start(r.Context(), m)
		if e != nil {
			bad(w, e)
			return
		}
		// If delivery fails, the client cannot know the job ID to cancel it.
		w.Header().Set("Content-Type", "application/json")
		if e := json.NewEncoder(w).Encode(v); e != nil || r.Context().Err() != nil {
			s.mu.Lock()
			j := s.jobs[v["id"].(string)]
			s.mu.Unlock()
			if j != nil {
				j.mu.Lock()
				s.discard(j)
				j.mu.Unlock()
			}
		}
		return
	}
	if r.Method == "POST" && p == "/map-export" {
		s.legacy(w, r)
		return
	}
	if !(r.Method == "DELETE" && p == "/map-export" || r.Method == "POST" && (p == "/map-export/chunk" || p == "/map-export/finish")) {
		http.NotFound(w, r)
		return
	}
	j, e := s.getJob(r)
	if e != nil {
		bad(w, e)
		return
	}
	if r.Method == "DELETE" {
		j.cmd.Process.Kill()
		j.mu.Lock()
		defer j.mu.Unlock()
		s.discard(j)
		reply(w, map[string]any{"id": j.id, "cancelled": true})
		return
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	var v map[string]any
	if strings.HasSuffix(p, "/chunk") {
		coords := []int{}
		for _, k := range []string{"x", "y", "width", "height"} {
			q := r.URL.Query()[k]
			if len(q) != 1 || !regexp.MustCompile(`^[0-9]{1,6}$`).MatchString(q[0]) {
				e = fmt.Errorf("One integer chunk %s is required", k)
				break
			}
			n, _ := strconv.Atoi(q[0])
			coords = append(coords, n)
		}
		if e == nil {
			if r.ContentLength <= 0 || r.ContentLength > 64<<20 {
				e = fmt.Errorf("A PNG chunk must be between 1 byte and 64 MiB")
			} else {
				var b []byte
				b, e = io.ReadAll(io.LimitReader(r.Body, (64<<20)+1))
				if e == nil && int64(len(b)) != r.ContentLength {
					e = fmt.Errorf("PNG upload ended before Content-Length")
				}
				if e == nil {
					v, e = s.chunk(j, coords, b)
				}
			}
		}
	} else {
		v, e = s.finish(j)
		if e == nil {
			s.discard(j)
		}
	}
	if e != nil {
		s.discard(j)
		bad(w, e)
		return
	}
	reply(w, v)
}
func (s *exportStore) legacy(w http.ResponseWriter, r *http.Request) {
	m, e := requestObject(r, 96<<20)
	if e != nil {
		bad(w, e)
		return
	}
	chunks, ok := m["chunks"].([]any)
	delete(m, "chunks")
	if !ok || len(chunks) < 1 || len(chunks) > 25 {
		bad(w, fmt.Errorf("Expected 1–25 terrain chunks"))
		return
	}
	ready, e := s.start(r.Context(), m)
	if e != nil {
		bad(w, e)
		return
	}
	s.mu.Lock()
	j := s.jobs[ready["id"].(string)]
	s.mu.Unlock()
	j.mu.Lock()
	defer j.mu.Unlock()
	defer s.discard(j)
	sort.Slice(chunks, func(a, b int) bool {
		x, _ := chunks[a].(map[string]any)
		y, _ := chunks[b].(map[string]any)
		return num(x["y"]) < num(y["y"]) || num(x["y"]) == num(y["y"]) && num(x["x"]) < num(y["x"])
	})
	for _, raw := range chunks {
		c, ok := raw.(map[string]any)
		if !ok {
			bad(w, fmt.Errorf("Invalid chunk"))
			return
		}
		str, _ := c["png"].(string)
		b, err := base64.StdEncoding.DecodeString(str)
		if err != nil || len(b) < 24 || string(b[:8]) != "\x89PNG\r\n\x1a\n" {
			bad(w, fmt.Errorf("Expected a PNG terrain chunk"))
			return
		}
		_, e = s.chunk(j, []int{num(c["x"]), num(c["y"]), int(binary.BigEndian.Uint32(b[16:20])), int(binary.BigEndian.Uint32(b[20:24]))}, b)
		if e != nil {
			bad(w, e)
			return
		}
	}
	v, e := s.finish(j)
	if e != nil {
		bad(w, e)
		return
	}
	reply(w, v)
}
func num(v any) int { f, _ := v.(float64); return int(f) }

// Close stops all outstanding export helpers and removes their temporary files.
func (s *Server) Close() {
	s.exports.mu.Lock()
	if s.exports.closing {
		s.exports.mu.Unlock()
		return
	}
	s.exports.closing = true
	close(s.exports.closeCh)
	jobs := make([]*exportJob, 0, len(s.exports.jobs))
	for _, j := range s.exports.jobs {
		jobs = append(jobs, j)
	}
	s.exports.mu.Unlock()
	for _, j := range jobs {
		_ = j.cmd.Process.Kill()
	}
	for _, j := range jobs {
		j.mu.Lock()
		s.exports.discard(j)
		j.mu.Unlock()
	}
}
