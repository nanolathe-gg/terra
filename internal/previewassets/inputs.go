// Package previewassets manages GPU-rendered previews as pinned release assets.
// Checking freshness hashes inputs and publication metadata; it never renders.
package previewassets

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

const LockName = "preview-assets.json"
const ReceiptName = "rendered.json"

type Lock struct {
	Version      int               `json:"version"`
	Repository   string            `json:"repository"`
	Tag          string            `json:"tag"`
	Asset        string            `json:"asset"`
	SHA256       string            `json:"sha256"`
	InputsSHA256 string            `json:"inputsSHA256"`
	Files        map[string]string `json:"files"`
	// Set when publish kept this bundle for newer inputs because a render at
	// InputsSHA256 showed no visible change: the inputs the bundle's own receipt
	// was rendered from, and the largest accepted difference.
	RenderedInputsSHA256 string `json:"renderedInputsSHA256,omitempty"`
	AcceptedChange       string `json:"acceptedChange,omitempty"`
}

// renderedInputs is the fingerprint inside the bundle's receipt.
func (l Lock) renderedInputs() string {
	if l.RenderedInputsSHA256 != "" {
		return l.RenderedInputsSHA256
	}
	return l.InputsSHA256
}

type Receipt struct {
	Version      int               `json:"version"`
	InputsSHA256 string            `json:"inputsSHA256"`
	Files        map[string]string `json:"files"`
}
type Inputs struct {
	SHA256 string            `json:"sha256"`
	Files  map[string]string `json:"files"`
}
type source struct{ root, ref string }

func git(root string, args ...string) ([]byte, error) {
	c := exec.Command("git", args...)
	c.Dir = root
	b, err := c.Output()
	if err != nil {
		return nil, fmt.Errorf("git %s failed: %w", args[0], err)
	}
	return b, nil
}
func (s source) read(name string) ([]byte, error) {
	if s.ref != "" {
		return git(s.root, "show", s.ref+":"+name)
	}
	return os.ReadFile(filepath.Join(s.root, filepath.FromSlash(name)))
}
func sum(b []byte) string     { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func validHash(s string) bool { b, err := hex.DecodeString(s); return err == nil && len(b) == 32 }
func validFile(name string) bool {
	return name != "" && filepath.Base(name) == name && !strings.ContainsAny(name, "/\\") && ((name == "manifest.json" || name == ReceiptName) || strings.HasSuffix(name, ".png"))
}
func readLock(s source) (Lock, error) {
	var l Lock
	b, err := s.read(LockName)
	if err != nil {
		return l, fmt.Errorf("missing %s: generate and publish previews first", LockName)
	}
	if err = json.Unmarshal(b, &l); err != nil {
		return l, err
	}
	parts := strings.Split(l.Repository, "/")
	if l.Version != 1 || len(parts) != 2 || !validHash(l.SHA256) || !validHash(l.InputsSHA256) || (l.RenderedInputsSHA256 != "" && !validHash(l.RenderedInputsSHA256)) || l.Tag == "" || l.Asset == "" || len(l.Files) == 0 {
		return l, fmt.Errorf("invalid preview asset lock")
	}
	for _, part := range append(parts, l.Tag, l.Asset) {
		if part == "" || strings.ContainsAny(part, "/?#\\\r\n") {
			return l, fmt.Errorf("invalid preview release identifier")
		}
	}
	if _, ok := l.Files[ReceiptName]; !ok {
		return l, fmt.Errorf("preview lock has no rendering receipt")
	}
	if _, ok := l.Files["manifest.json"]; !ok {
		return l, fmt.Errorf("preview lock has no manifest")
	}
	for name, hash := range l.Files {
		if !validFile(name) || !validHash(hash) {
			return l, fmt.Errorf("invalid preview file %q", name)
		}
	}
	return l, nil
}
func LoadLock(root string) (Lock, error) { return readLock(source{root: root}) }
func fingerprint(s source) (Inputs, error) {
	out := Inputs{Files: map[string]string{}}
	b, err := s.read("preview-inputs.json")
	if err != nil {
		return out, err
	}
	var config struct {
		Version  int      `json:"version"`
		Patterns []string `json:"patterns"`
	}
	if err = json.Unmarshal(b, &config); err != nil {
		return out, err
	}
	if config.Version != 1 || len(config.Patterns) == 0 {
		return out, fmt.Errorf("invalid preview input patterns")
	}
	names := map[string]bool{"preview-inputs.json": true}
	var tracked []string
	if s.ref != "" {
		b, err = git(s.root, "ls-tree", "-r", "-z", "--name-only", s.ref)
		if err != nil {
			return out, err
		}
		tracked = strings.Split(strings.TrimSuffix(string(b), "\x00"), "\x00")
	}
	for _, pattern := range config.Patterns {
		if filepath.IsAbs(pattern) || strings.Contains(pattern, "..") {
			return out, fmt.Errorf("invalid input pattern %q", pattern)
		}
		matches := []string{}
		if s.ref == "" {
			paths, err := filepath.Glob(filepath.Join(s.root, pattern))
			if err != nil {
				return out, err
			}
			for _, p := range paths {
				rel, err := filepath.Rel(s.root, p)
				if err != nil {
					return out, err
				}
				matches = append(matches, filepath.ToSlash(rel))
			}
		} else {
			for _, name := range tracked {
				ok, err := filepath.Match(pattern, name)
				if err != nil {
					return out, err
				}
				if ok {
					matches = append(matches, name)
				}
			}
		}
		if len(matches) == 0 {
			return out, fmt.Errorf("preview input pattern %q matched no files", pattern)
		}
		for _, name := range matches {
			names[name] = true
		}
	}
	keys := make([]string, 0, len(names))
	for name := range names {
		keys = append(keys, name)
	}
	sort.Strings(keys)
	h := sha256.New()
	for _, name := range keys {
		b, err := s.read(name)
		if err != nil {
			return out, err
		}
		hash := sum(b)
		out.Files[name] = hash
		h.Write([]byte(name + "\x00" + hash + "\n"))
	}
	out.SHA256 = hex.EncodeToString(h.Sum(nil))
	return out, nil
}
func Fingerprint(root string) (Inputs, error) { return fingerprint(source{root: root}) }
func Check(root string) (Lock, error)         { return check(source{root: root}) }
func check(s source) (Lock, error) {
	l, err := readLock(s)
	if err != nil {
		return l, err
	}
	input, err := fingerprint(s)
	if err != nil {
		return l, err
	}
	if input.SHA256 != l.InputsSHA256 {
		return l, fmt.Errorf("previews are stale: rendering inputs changed; run repro/ui-previews.mjs with your own server/port, then go run ./cmd/previews publish")
	}
	b, err := s.read("ui-previews/manifest.json")
	if err != nil {
		return l, fmt.Errorf("preview manifest is missing; run go run ./cmd/previews fetch")
	}
	if sum(b) != l.Files["manifest.json"] {
		return l, fmt.Errorf("preview manifest differs from the published bundle; re-render and publish")
	}
	return l, nil
}
func CheckRef(root, ref string) (Lock, error) {
	if _, err := git(root, "rev-parse", "--verify", ref+"^{commit}"); err != nil {
		return Lock{}, err
	}
	return check(source{root: root, ref: ref})
}
func CheckHistory(root, ref string) error {
	b, err := git(root, "rev-list", "--objects", ref)
	if err != nil {
		return err
	}
	for _, line := range strings.Split(string(b), "\n") {
		_, path, ok := strings.Cut(line, " ")
		if ok && (strings.HasPrefix(path, "smoke-out/") || (strings.HasPrefix(path, "ui-previews/") && strings.HasSuffix(path, ".png"))) {
			return fmt.Errorf("push would reintroduce generated files in history (%s); cherry-pick changes onto cleaned main", path)
		}
	}
	return nil
}
func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(b, '\n'), 0644)
}
