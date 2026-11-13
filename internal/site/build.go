package site

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const MapsURL = "https://terraform-savelinks.danielgtaylor.workers.dev/maps"

func safeName(name string) bool {
	return name != "" && !filepath.IsAbs(name) && !strings.Contains(name, "\\") && filepath.ToSlash(filepath.Clean(name)) == name && name != ".." && !strings.HasPrefix(name, "../")
}
func (s *Site) Sources() (map[string]string, error) {
	out := map[string]string{}
	for _, name := range s.Manifest.Sources {
		if !safeName(name) {
			return nil, fmt.Errorf("invalid source path %q", name)
		}
		out[name] = filepath.Join(s.Root, filepath.FromSlash(name))
	}
	for _, w := range s.Worlds() {
		out[materialPath(w)] = filepath.Join(s.Root, materialPath(w))
	}
	out["materials/palette.json"] = filepath.Join(s.Root, "materials/palette.json")
	previews, err := os.ReadDir(filepath.Join(s.Root, "ui-previews"))
	if err != nil {
		return nil, err
	}
	for _, f := range previews {
		if !f.IsDir() && (filepath.Ext(f.Name()) == ".png" || filepath.Ext(f.Name()) == ".json") {
			out["ui-previews/"+f.Name()] = filepath.Join(s.Root, "ui-previews", f.Name())
		}
	}
	return out, nil
}
func goCommand(ctx context.Context, root string, args ...string) *exec.Cmd {
	c := exec.CommandContext(ctx, "go", args...)
	c.Dir = root
	return c
}
func buildExporter(root string) (map[string][]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	dir, err := os.MkdirTemp("", "terraform-exporter-")
	if err != nil {
		return nil, err
	}
	defer os.Remove(dir)
	target := filepath.Join(dir, "map-export.wasm")
	defer os.Remove(target)
	cmd := goCommand(ctx, root, "build", "-trimpath", "-buildvcs=false", "-ldflags=-s -w", "-o", target, "./export")
	// Remove inherited target settings before selecting the browser target.
	for _, e := range os.Environ() {
		if !strings.HasPrefix(e, "GOOS=") && !strings.HasPrefix(e, "GOARCH=") {
			cmd.Env = append(cmd.Env, e)
		}
	}
	cmd.Env = append(cmd.Env, "GOOS=js", "GOARCH=wasm")
	if output, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("build browser exporter (Go must be on PATH): %w\n%s", err, output)
	}
	wasm, err := os.ReadFile(target)
	if err != nil {
		return nil, err
	}
	goroot, err := goCommand(ctx, root, "env", "GOROOT").Output()
	if err != nil {
		return nil, err
	}
	for _, d := range []string{"lib", "misc"} {
		support, err := os.ReadFile(filepath.Join(strings.TrimSpace(string(goroot)), d, "wasm", "wasm_exec.js"))
		if err == nil {
			return map[string][]byte{"map-export.wasm": wasm, "wasm_exec.js": support}, nil
		}
	}
	return nil, fmt.Errorf("Go has no wasm_exec.js under %s", strings.TrimSpace(string(goroot)))
}
func exporterDigest(root string) (string, error) {
	files := []string{"go.mod", "go.sum"}
	for _, dir := range []string{"export", "mapdata", "internal"} {
		if err := filepath.WalkDir(filepath.Join(root, dir), func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !d.IsDir() && filepath.Ext(path) == ".go" {
				rel, err := filepath.Rel(root, path)
				if err != nil {
					return err
				}
				files = append(files, filepath.ToSlash(rel))
			}
			return nil
		}); err != nil {
			return "", err
		}
	}
	sort.Strings(files)
	h := sha256.New()
	for _, name := range files {
		data, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			return "", err
		}
		h.Write([]byte(name + "\x00"))
		h.Write(data)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// Exporter rebuilds on the next request after Go sources change, sharing one build
// between the .wasm and its matching wasm_exec.js. A failed build is retried.
type Exporter struct {
	root   string
	mu     sync.Mutex
	digest string
	files  map[string][]byte
}

func (e *Exporter) Get(name string) ([]byte, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	digest, err := exporterDigest(e.root)
	if err != nil {
		return nil, err
	}
	if digest != e.digest {
		files, err := buildExporter(e.root)
		if err != nil {
			return nil, err
		}
		e.files = files
		e.digest = digest
	}
	return e.files[name], nil
}
func (s *Site) Build(out, mapsURL string) (string, error) {
	files, err := s.Generated(mapsURL)
	if err != nil {
		return "", err
	}
	sources, err := s.Sources()
	if err != nil {
		return "", err
	}
	for name, path := range sources {
		files[name], err = os.ReadFile(path)
		if err != nil {
			return "", err
		}
	}
	exporter, err := buildExporter(s.Root)
	if err != nil {
		return "", err
	}
	for name, data := range exporter {
		files[name] = data
	}
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	h := sha256.New()
	for _, name := range names {
		sum := sha256.Sum256(files[name])
		h.Write([]byte(name + "\x00"))
		h.Write(sum[:])
	}
	version := hex.EncodeToString(h.Sum(nil))[:10]
	target := filepath.Join(out, "b", version)
	if err = WriteFiles(target, files); err != nil {
		return "", err
	}
	index := fmt.Sprintf(`<!DOCTYPE html>
<html lang="en-US"><head><meta charset="utf-8"><title>Terra</title><script>location.replace("b/%[1]s/sculpt.html"+location.search+location.hash)</script><noscript><meta http-equiv="refresh" content="0;url=b/%[1]s/sculpt.html"></noscript></head><body><a href="b/%[1]s/sculpt.html">Open Terra</a></body></html>
`, version)
	if err = os.WriteFile(filepath.Join(out, "index.html"), []byte(index), 0644); err != nil {
		return "", err
	}
	return target, nil
}
