package previewassets

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func write(t *testing.T, path string, b []byte) {
	t.Helper()
	if err := os.WriteFile(path, b, 0644); err != nil {
		t.Fatal(err)
	}
}
func fixture(t *testing.T) (string, string, Lock, []byte) {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "ui-previews")
	if err := os.Mkdir(dir, 0755); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(root, "preview-inputs.json"), []byte(`{"version":1,"patterns":["*.js"]}`))
	write(t, filepath.Join(root, "renderer.js"), []byte("render terrain"))
	write(t, filepath.Join(dir, "manifest.json"), []byte(`{"frame":{"width":2,"height":2},"tools":["hill"],"controls":{},"worlds":{"frame":{"width":2,"height":2},"images":{}}}`))
	var b bytes.Buffer
	im := image.NewRGBA(image.Rect(0, 0, 2, 2))
	im.Set(0, 0, color.RGBA{1, 2, 3, 255})
	if err := png.Encode(&b, im); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(dir, "tool-hill.png"), b.Bytes())
	input, err := Fingerprint(root)
	if err != nil {
		t.Fatal(err)
	}
	if err = Stamp(root, dir, input.SHA256); err != nil {
		t.Fatal(err)
	}
	receipt, hash, err := Pack(root, dir, filepath.Join(root, "bundle.tar.gz"))
	if err != nil {
		t.Fatal(err)
	}
	files := receipt.Files
	data, err := os.ReadFile(filepath.Join(dir, ReceiptName))
	if err != nil {
		t.Fatal(err)
	}
	files[ReceiptName] = sum(data)
	l := Lock{Version: 1, Repository: "example/terrain", Tag: "previews-test", Asset: "ui-previews.tar.gz", SHA256: hash, InputsSHA256: input.SHA256, Files: files}
	if err = writeJSON(filepath.Join(root, LockName), l); err != nil {
		t.Fatal(err)
	}
	archive, err := os.ReadFile(filepath.Join(root, "bundle.tar.gz"))
	if err != nil {
		t.Fatal(err)
	}
	return root, dir, l, archive
}
func server(t *testing.T, l Lock, data []byte) (client, *int, *int) {
	t.Helper()
	metadata, downloads := 0, 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/releases/tags/") {
			metadata++
			_ = json.NewEncoder(w).Encode(release{Assets: []releaseAsset{{ID: 7, Name: l.Asset, Digest: "sha256:" + l.SHA256, Size: int64(len(data))}}})
			return
		}
		downloads++
		_, _ = w.Write(data)
	}))
	t.Cleanup(s.Close)
	return client{base: s.URL, http: s.Client(), cache: t.TempDir()}, &metadata, &downloads
}
func TestFreshnessTracksRenderingInputs(t *testing.T) {
	root, dir, l, _ := fixture(t)
	if _, err := Check(root); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(root, "README.md"), []byte("new docs"))
	if _, err := Check(root); err != nil {
		t.Fatal("docs made previews stale", err)
	}
	write(t, filepath.Join(root, "new-shader.js"), []byte("new rendering dependency"))
	if _, err := Check(root); err == nil {
		t.Fatal("new matching input did not invalidate previews")
	}
	if err := os.Remove(filepath.Join(root, "new-shader.js")); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(root, "renderer.js"), []byte("changed terrain"))
	if _, err := Check(root); err == nil {
		t.Fatal("rendering edit did not fail freshness")
	}
	if _, err := VerifyReceipt(root, dir); err == nil {
		t.Fatal("stale render could be packaged")
	}
	if err := Stamp(root, dir, l.InputsSHA256); err == nil {
		t.Fatal("input edits during rendering were accepted")
	}
}
func TestPublicationBindsPixelsToInputs(t *testing.T) {
	root, _, l, data := fixture(t)
	c, metadata, downloads := server(t, l, data)
	if err := c.published(l); err != nil {
		t.Fatal(err)
	}
	if err := c.published(l); err != nil {
		t.Fatal(err)
	}
	if *metadata != 2 || *downloads != 1 {
		t.Fatalf("metadata %d downloads %d", *metadata, *downloads)
	}
	// A forged freshness field with the same old published pixels must fail.
	write(t, filepath.Join(root, "renderer.js"), []byte("new terrain"))
	input, err := Fingerprint(root)
	if err != nil {
		t.Fatal(err)
	}
	l.InputsSHA256 = input.SHA256
	if err = c.published(l); err == nil || !strings.Contains(err.Error(), "different inputs") {
		t.Fatal("editing lock blessed old pixels", err)
	}
}
func TestUnpublishedOrChangedReleaseFails(t *testing.T) {
	_, _, l, data := fixture(t)
	for _, mode := range []string{"missing", "draft", "checksum", "no-asset"} {
		t.Run(mode, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if mode == "missing" {
					http.NotFound(w, r)
					return
				}
				v := release{Assets: []releaseAsset{{ID: 1, Name: l.Asset, Digest: "sha256:" + l.SHA256, Size: int64(len(data))}}}
				if mode == "draft" {
					v.Draft = true
				}
				if mode == "checksum" {
					v.Assets[0].Digest = "sha256:" + strings.Repeat("0", 64)
				}
				if mode == "no-asset" {
					v.Assets = nil
				}
				_ = json.NewEncoder(w).Encode(v)
			}))
			defer s.Close()
			c := client{base: s.URL, http: s.Client(), cache: t.TempDir()}
			if err := c.published(l); err == nil {
				t.Fatal("invalid publication accepted")
			}
		})
	}
}
func TestFetchFromFreshCheckout(t *testing.T) {
	root, dir, l, data := fixture(t)
	c, _, _ := server(t, l, data)
	for _, name := range []string{"tool-hill.png", ReceiptName} {
		if err := os.Remove(filepath.Join(dir, name)); err != nil {
			t.Fatal(err)
		}
	}
	if err := fetchWithClient(root, false, c); err != nil {
		t.Fatal(err)
	}
	for name, hash := range l.Files {
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil || sum(b) != hash {
			t.Fatal("restored asset differs", name, err)
		}
	}
	if err := Ensure(root); err != nil {
		t.Fatal("offline local assets failed", err)
	}
	write(t, filepath.Join(dir, "tool-hill.png"), []byte("local edited picture"))
	if err := fetchWithClient(root, false, c); err == nil {
		t.Fatal("local edits were silently overwritten")
	}
	if err := fetchWithClient(root, true, c); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(dir, "obsolete.png"), []byte("old preview"))
	if err := Ensure(root); err == nil {
		t.Fatal("obsolete PNG accepted")
	}
	if err := fetchWithClient(root, true, c); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "obsolete.png")); !os.IsNotExist(err) {
		t.Fatal("obsolete generated PNG retained")
	}
}
func TestChangedPixelsCannotBePublished(t *testing.T) {
	root, dir, _, _ := fixture(t)
	write(t, filepath.Join(dir, "tool-hill.png"), []byte("not a PNG"))
	if _, err := VerifyReceipt(root, dir); err == nil {
		t.Fatal("modified image accepted")
	}
	if _, _, err := Pack(root, dir, filepath.Join(root, "bad.tar.gz")); err == nil {
		t.Fatal("modified image packaged")
	}
}
func TestOutgoingCommitAndHistory(t *testing.T) {
	root, _, _, _ := fixture(t)
	command := func(args ...string) string {
		t.Helper()
		c := exec.Command("git", args...)
		c.Dir = root
		b, err := c.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %s", args, b)
		}
		return strings.TrimSpace(string(b))
	}
	command("init", "-q")
	command("config", "user.name", "Fixture")
	command("config", "user.email", "fixture@example.invalid")
	command("add", "preview-inputs.json", "renderer.js", LockName, "ui-previews/manifest.json")
	command("commit", "-qm", "clean source")
	sha := command("rev-parse", "HEAD")
	if err := CheckHistory(root, sha); err != nil {
		t.Fatal(err)
	}
	if _, err := CheckRef(root, sha); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(root, "renderer.js"), []byte("uncommitted edit"))
	if _, err := CheckRef(root, sha); err != nil {
		t.Fatal("uncommitted file affected outgoing snapshot", err)
	}
	command("add", "renderer.js")
	command("commit", "-qm", "stale source")
	if _, err := CheckRef(root, "HEAD"); err == nil {
		t.Fatal("stale outgoing commit accepted")
	}
	command("add", "ui-previews/tool-hill.png")
	command("commit", "-qm", "accidental PNG")
	if err := CheckHistory(root, "HEAD"); err == nil {
		t.Fatal("generated image in history accepted")
	}
	command("rm", "--cached", "ui-previews/tool-hill.png")
	command("commit", "-qm", "remove PNG from tip")
	if err := CheckHistory(root, "HEAD"); err == nil {
		t.Fatal("deleting PNG only at tip bypassed history check")
	}
}
