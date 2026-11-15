package previewassets

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"sort"
	"time"
)

func Inspect(dir string) (map[string]string, error) {
	b, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return nil, err
	}
	var m struct {
		Frame    struct{ Width, Height int }
		Tools    []string
		Controls map[string][]json.RawMessage
		Worlds   struct {
			Frame  struct{ Width, Height int }
			Images map[string]string
		}
	}
	if err = json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	expected := map[string][2]int{}
	for _, tool := range m.Tools {
		expected["tool-"+tool+".png"] = [2]int{m.Frame.Width, m.Frame.Height}
	}
	for id, frames := range m.Controls {
		expected[id+".png"] = [2]int{len(frames) * m.Frame.Width, m.Frame.Height}
	}
	for _, name := range m.Worlds.Images {
		expected[name] = [2]int{m.Worlds.Frame.Width, m.Worlds.Frame.Height}
	}
	if len(expected) == 0 {
		return nil, fmt.Errorf("empty preview manifest")
	}
	out := map[string]string{"manifest.json": sum(b)}
	for name, size := range expected {
		if !validFile(name) || size[0] <= 0 || size[1] <= 0 {
			return nil, fmt.Errorf("invalid preview %q", name)
		}
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return nil, err
		}
		image, err := png.DecodeConfig(bytes.NewReader(b))
		if err != nil || image.Width != size[0] || image.Height != size[1] {
			return nil, fmt.Errorf("preview %s has invalid PNG dimensions", name)
		}
		out[name] = sum(b)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) == ".png" {
			if _, ok := expected[entry.Name()]; !ok {
				return nil, fmt.Errorf("obsolete preview %s; regenerate the full set", entry.Name())
			}
		}
	}
	return out, nil
}
func Stamp(root, dir, expected string) error {
	input, err := Fingerprint(root)
	if err != nil {
		return err
	}
	if expected == "" || input.SHA256 != expected {
		return fmt.Errorf("rendering inputs changed while generating previews; render again")
	}
	files, err := Inspect(dir)
	if err != nil {
		return err
	}
	return writeJSON(filepath.Join(dir, ReceiptName), Receipt{Version: 1, InputsSHA256: input.SHA256, Files: files})
}
func VerifyReceipt(root, dir string) (Receipt, error) {
	var r Receipt
	b, err := os.ReadFile(filepath.Join(dir, ReceiptName))
	if err != nil {
		return r, fmt.Errorf("no rendering receipt; generate the full previews first")
	}
	if err = json.Unmarshal(b, &r); err != nil {
		return r, err
	}
	input, err := Fingerprint(root)
	if err != nil {
		return r, err
	}
	if r.Version != 1 || r.InputsSHA256 != input.SHA256 {
		return r, fmt.Errorf("rendered previews are stale; regenerate before publishing")
	}
	files, err := Inspect(dir)
	if err != nil {
		return r, err
	}
	if len(files) != len(r.Files) {
		return r, fmt.Errorf("preview files changed after rendering")
	}
	for name, hash := range files {
		if r.Files[name] != hash {
			return r, fmt.Errorf("preview %s changed after rendering", name)
		}
	}
	return r, nil
}
func Pack(root, dir, path string) (Receipt, string, error) {
	r, err := VerifyReceipt(root, dir)
	if err != nil {
		return r, "", err
	}
	file, err := os.Create(path)
	if err != nil {
		return r, "", err
	}
	gz := gzip.NewWriter(file)
	gz.Header.ModTime = time.Unix(0, 0)
	tw := tar.NewWriter(gz)
	names := make([]string, 0, len(r.Files)+1)
	for name := range r.Files {
		names = append(names, name)
	}
	names = append(names, ReceiptName)
	sort.Strings(names)
	for _, name := range names {
		b, readErr := os.ReadFile(filepath.Join(dir, name))
		if readErr != nil {
			err = readErr
			break
		}
		if name != ReceiptName && sum(b) != r.Files[name] {
			err = fmt.Errorf("preview changed during packaging: %s", name)
			break
		}
		err = tw.WriteHeader(&tar.Header{Name: name, Mode: 0644, Size: int64(len(b)), ModTime: time.Unix(0, 0)})
		if err != nil {
			break
		}
		if _, err = tw.Write(b); err != nil {
			break
		}
	}
	for _, close := range []func() error{tw.Close, gz.Close, file.Close} {
		if e := close(); err == nil {
			err = e
		}
	}
	if err != nil {
		return r, "", err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return r, "", err
	}
	return r, sum(b), nil
}
func unpack(data []byte, l Lock, dir string) error {
	if sum(data) != l.SHA256 {
		return fmt.Errorf("preview bundle checksum mismatch")
	}
	gz, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	seen := map[string]bool{}
	var total int64
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		hash, ok := l.Files[header.Name]
		if !ok || seen[header.Name] || !validFile(header.Name) || header.Typeflag != tar.TypeReg || header.Size < 0 {
			return fmt.Errorf("unexpected preview archive entry %q", header.Name)
		}
		total += header.Size
		if total > 100*1024*1024 {
			return fmt.Errorf("preview bundle exceeds 100 MB unpacked")
		}
		b, err := io.ReadAll(io.LimitReader(tr, header.Size+1))
		if err != nil {
			return err
		}
		if int64(len(b)) != header.Size || sum(b) != hash {
			return fmt.Errorf("preview checksum mismatch: %s", header.Name)
		}
		if err = os.WriteFile(filepath.Join(dir, header.Name), b, 0644); err != nil {
			return err
		}
		seen[header.Name] = true
	}
	if len(seen) != len(l.Files) {
		return fmt.Errorf("preview bundle is missing files")
	}
	if err = verifyReceiptBytes(data, l); err != nil {
		return err
	}
	_, err = Inspect(dir)
	return err
}
func localState(root string, l Lock) (missing bool, err error) {
	for name, hash := range l.Files {
		b, e := os.ReadFile(filepath.Join(root, "ui-previews", name))
		if os.IsNotExist(e) {
			missing = true
			continue
		}
		if e != nil {
			return missing, e
		}
		if sum(b) != hash {
			return missing, fmt.Errorf("local preview %s differs from the pinned bundle; finish publishing the new render or run go run ./cmd/previews fetch --replace", name)
		}
	}
	entries, e := os.ReadDir(filepath.Join(root, "ui-previews"))
	if e != nil && !os.IsNotExist(e) {
		return missing, e
	}
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) == ".png" {
			if _, ok := l.Files[entry.Name()]; !ok {
				return missing, fmt.Errorf("obsolete local preview %s; run go run ./cmd/previews fetch --replace", entry.Name())
			}
		}
	}
	return missing, nil
}
func Ensure(root string) error              { return fetch(root, false) }
func Fetch(root string, replace bool) error { return fetch(root, replace) }
func fetch(root string, replace bool) error { return fetchWithClient(root, replace, githubClient()) }
func fetchWithClient(root string, replace bool, client client) error {
	l, err := LoadLock(root)
	if err != nil {
		return err
	}
	missing, stateErr := localState(root, l)
	if !replace {
		if stateErr != nil {
			return stateErr
		}
		if !missing {
			return nil
		}
	}
	asset, err := client.asset(l)
	if err != nil {
		return err
	}
	data, err := client.archive(l, asset)
	if err != nil {
		return err
	}
	temp, err := os.MkdirTemp("", "terraform-previews-")
	if err != nil {
		return err
	}
	defer func() {
		for name := range l.Files {
			_ = os.Remove(filepath.Join(temp, name))
		}
		_ = os.Remove(temp)
	}()
	if err = unpack(data, l, temp); err != nil {
		return err
	}
	destination := filepath.Join(root, "ui-previews")
	if err = os.MkdirAll(destination, 0755); err != nil {
		return err
	}
	for name := range l.Files {
		b, err := os.ReadFile(filepath.Join(temp, name))
		if err != nil {
			return err
		}
		target := filepath.Join(destination, name)
		if err = os.WriteFile(target+".tmp", b, 0644); err != nil {
			return err
		}
		if err = os.Rename(target+".tmp", target); err != nil {
			return err
		}
	}
	return pruneGenerated(destination, l)
}

func pruneGenerated(dir string, l Lock) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) == ".png" {
			if _, ok := l.Files[entry.Name()]; !ok {
				if err = os.Remove(filepath.Join(dir, entry.Name())); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// The receipt inside the checksum-pinned archive binds the rendered pixels to
// the fingerprint they were rendered from. The lock may name newer accepted
// inputs (publish records them after a render shows no visible change); the
// receipt must still match the inputs the bundle itself came from.
func verifyReceiptBytes(data []byte, l Lock) error {
	if sum(data) != l.SHA256 {
		return fmt.Errorf("preview bundle checksum mismatch")
	}
	gz, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	var total int64
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return fmt.Errorf("published bundle has no rendering receipt")
		}
		if err != nil {
			return err
		}
		total += h.Size
		if h.Size < 0 || total > 100*1024*1024 {
			return fmt.Errorf("invalid preview archive size")
		}
		if h.Name != ReceiptName {
			continue
		}
		if h.Typeflag != tar.TypeReg || h.Size > 1024*1024 {
			return fmt.Errorf("invalid rendering receipt")
		}
		b, err := io.ReadAll(io.LimitReader(tr, 1024*1024+1))
		if err != nil {
			return err
		}
		if sum(b) != l.Files[ReceiptName] {
			return fmt.Errorf("rendering receipt checksum mismatch")
		}
		var r Receipt
		if err = json.Unmarshal(b, &r); err != nil {
			return err
		}
		if r.Version != 1 || r.InputsSHA256 != l.renderedInputs() || len(r.Files)+1 != len(l.Files) {
			return fmt.Errorf("published previews were rendered from different inputs; re-render and publish")
		}
		for name, hash := range r.Files {
			if hash != l.Files[name] {
				return fmt.Errorf("published preview file list differs from lock")
			}
		}
		return nil
	}
}
