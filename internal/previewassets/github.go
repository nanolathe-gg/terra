package previewassets

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type releaseAsset struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Digest string `json:"digest"`
	Size   int64  `json:"size"`
}
type release struct {
	Draft  bool           `json:"draft"`
	Assets []releaseAsset `json:"assets"`
}
type apiError struct{ status int }

func (e apiError) Error() string {
	return fmt.Sprintf("GitHub preview release request failed (HTTP %d); authenticate with gh auth login or GH_TOKEN for private repositories", e.status)
}

type client struct {
	base, token string
	http        *http.Client
	cache       string
}

func githubClient() client {
	token := os.Getenv("GH_TOKEN")
	if token == "" {
		token = os.Getenv("GITHUB_TOKEN")
	}
	if token == "" {
		if b, err := exec.Command("gh", "auth", "token", "--hostname", "github.com").Output(); err == nil {
			token = strings.TrimSpace(string(b))
		}
	}
	cache, cacheErr := os.UserCacheDir()
	if cacheErr == nil {
		cache = filepath.Join(cache, "terraform", "previews")
	} else {
		cache = ""
	}
	return client{base: "https://api.github.com", token: token, http: &http.Client{Timeout: 90 * time.Second}, cache: cache}
}
func (c client) get(path, accept string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	r, err := http.NewRequestWithContext(ctx, "GET", c.base+path, nil)
	if err != nil {
		return nil, err
	}
	r.Header.Set("Accept", accept)
	r.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if c.token != "" {
		r.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(r)
	if err != nil {
		return nil, fmt.Errorf("could not download GitHub preview metadata or asset")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, apiError{resp.StatusCode}
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 100*1024*1024+1))
	if len(data) > 100*1024*1024 {
		return nil, fmt.Errorf("preview response exceeds 100 MB")
	}
	return data, err
}
func (c client) asset(l Lock) (releaseAsset, error) {
	b, err := c.get("/repos/"+l.Repository+"/releases/tags/"+url.PathEscape(l.Tag), "application/vnd.github+json")
	if err != nil {
		return releaseAsset{}, err
	}
	var r release
	if err = json.Unmarshal(b, &r); err != nil {
		return releaseAsset{}, err
	}
	if r.Draft {
		return releaseAsset{}, fmt.Errorf("preview bundle is still a draft; publish it before pushing")
	}
	for _, a := range r.Assets {
		if a.Name == l.Asset {
			if a.Digest != "" && a.Digest != "sha256:"+l.SHA256 {
				return a, fmt.Errorf("published preview bundle checksum does not match the lock")
			}
			return a, nil
		}
	}
	return releaseAsset{}, missingAssetError{asset: l.Asset, tag: l.Tag}
}

// missingAssetError answers a release that exists without the bundle's asset (a release made
// by hand, or a create whose upload did not finish): publish uploads into it instead of failing.
type missingAssetError struct{ asset, tag string }

func (e missingAssetError) Error() string {
	return fmt.Sprintf("preview asset %s is not published in release %s", e.asset, e.tag)
}
func (c client) download(l Lock, a releaseAsset) ([]byte, error) {
	data, err := c.get(fmt.Sprintf("/repos/%s/releases/assets/%d", l.Repository, a.ID), "application/octet-stream")
	if err != nil {
		return nil, err
	}
	if sum(data) != l.SHA256 {
		return nil, fmt.Errorf("downloaded preview bundle checksum mismatch")
	}
	return data, nil
}
func (c client) archive(l Lock, a releaseAsset) ([]byte, error) {
	path := filepath.Join(c.cache, l.SHA256+".tar.gz")
	if c.cache != "" {
		if data, err := os.ReadFile(path); err == nil && sum(data) == l.SHA256 {
			return data, nil
		}
	}
	data, err := c.download(l, a)
	if err != nil {
		return nil, err
	}
	if c.cache != "" {
		if err = os.MkdirAll(c.cache, 0755); err == nil {
			file, e := os.CreateTemp(c.cache, "download-*.tmp")
			if e == nil {
				name := file.Name()
				defer os.Remove(name)
				_, e = file.Write(data)
				closeErr := file.Close()
				if e == nil && closeErr == nil {
					_ = os.Rename(name, path)
				}
			}
		}
	}
	return data, nil
}
func (c client) published(l Lock) error {
	a, err := c.asset(l)
	if err != nil {
		return err
	}
	data, err := c.archive(l, a)
	if err != nil {
		return err
	}
	return verifyReceiptBytes(data, l)
}
func CheckPublished(l Lock) error { return githubClient().published(l) }
// Publish keeps the pinned bundle when the render in dir shows no visible
// change from it (see Tolerance); otherwise, or with force, it uploads the
// render as a new release and pins it. It reports the comparison either way.
func Publish(root, dir, repository string, force bool, tol Tolerance) (Lock, Comparison, error) {
	var result Comparison
	if !force {
		l, kept, err := acceptWithClient(root, dir, tol, githubClient())
		if err != nil || kept.Equivalent {
			return l, kept, err
		}
		result = kept
	}
	l, err := publish(root, dir, repository)
	return l, result, err
}
func publish(root, dir, repository string) (Lock, error) {
	var l Lock
	temp, err := os.MkdirTemp("", "terraform-preview-publish-")
	if err != nil {
		return l, err
	}
	defer os.Remove(temp)
	archive := filepath.Join(temp, "ui-previews.tar.gz")
	defer os.Remove(archive)
	receipt, hash, err := Pack(root, dir, archive)
	if err != nil {
		return l, err
	}
	l = Lock{Version: 1, Repository: repository, Tag: "previews-" + hash[:16], Asset: "ui-previews.tar.gz", SHA256: hash, InputsSHA256: receipt.InputsSHA256, Files: receipt.Files}
	parts := strings.Split(repository, "/")
	if len(parts) != 2 {
		return l, fmt.Errorf("use repository owner/name")
	}
	for _, part := range parts {
		if part == "" || strings.ContainsAny(part, "/?#\\\r\n") {
			return l, fmt.Errorf("invalid repository")
		}
	}
	receiptBytes, err := os.ReadFile(filepath.Join(dir, ReceiptName))
	if err != nil {
		return l, err
	}
	l.Files[ReceiptName] = sum(receiptBytes)
	c := githubClient()
	_, err = c.asset(l)
	if e, notFound := err.(apiError); notFound && e.status == 404 {
		// Release tags point to a tiny parentless metadata commit. They never pin
		// application history or the PNGs in Git, including during history cleanup.
		metadata, _ := json.MarshalIndent(l, "", "  ")
		blob, err := gitInput(root, metadata, "hash-object", "-w", "--stdin")
		if err != nil {
			return l, err
		}
		tree, err := gitInput(root, []byte("100644 blob "+strings.TrimSpace(string(blob))+"\tpreview-bundle.json\n"), "mktree")
		if err != nil {
			return l, err
		}
		commit, err := gitInput(root, []byte("Preview bundle "+hash+"\n"), "commit-tree", strings.TrimSpace(string(tree)))
		if err != nil {
			return l, err
		}
		remote := "https://github.com/" + repository + ".git"
		if err = run(root, "git", "push", remote, strings.TrimSpace(string(commit))+":refs/tags/"+l.Tag); err != nil {
			return l, err
		}
		notes := filepath.Join(temp, "notes.txt")
		defer os.Remove(notes)
		if err = os.WriteFile(notes, []byte("Authored procedural editor previews.\n\nRendering inputs SHA-256: "+l.InputsSHA256+"\nBundle SHA-256: "+l.SHA256+"\n"), 0644); err != nil {
			return l, err
		}
		if err = run(root, "gh", "release", "create", l.Tag, archive, "--repo", repository, "--verify-tag", "--prerelease", "--latest=false", "--title", "Editor preview assets "+hash[:12], "--notes-file", notes); err != nil {
			return l, err
		}
	} else if _, missing := err.(missingAssetError); missing {
		// The release exists but its asset does not: upload into it, so a partial publish
		// (a hand-made release, or a create whose upload failed) recovers by running publish again.
		if err = run(root, "gh", "release", "upload", l.Tag, archive, "--repo", repository, "--clobber"); err != nil {
			return l, err
		}
	} else if err != nil {
		return l, err
	}
	if err = c.published(l); err != nil {
		return l, err
	}
	if _, err = VerifyReceipt(root, dir); err != nil {
		return l, err
	}
	// The renderer updates the tracked runtime manifest; publication pins exactly
	// those bytes. Copy the validated asset set, including its rendering receipt.
	destination := filepath.Join(root, "ui-previews")
	if err = os.MkdirAll(destination, 0755); err != nil {
		return l, err
	}
	if filepath.Clean(dir) != filepath.Clean(destination) {
		// Temp and rename, as fetch copies: a dev server reading ui-previews never sees a partial file.
		for name := range l.Files {
			b, e := os.ReadFile(filepath.Join(dir, name))
			if e != nil {
				return l, e
			}
			target := filepath.Join(destination, name)
			if e = os.WriteFile(target+".tmp", b, 0644); e != nil {
				return l, e
			}
			if e = os.Rename(target+".tmp", target); e != nil {
				return l, e
			}
		}
	}
	if err = pruneGenerated(destination, l); err != nil {
		return l, err
	}
	if err = writeJSON(filepath.Join(root, LockName), l); err != nil {
		return l, err
	}
	return l, nil
}
func gitInput(root string, input []byte, args ...string) ([]byte, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = root
	cmd.Stdin = bytes.NewReader(input)
	b, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git %s failed: %w", args[0], err)
	}
	return b, nil
}
func run(root, name string, args ...string) error {
	c := exec.Command(name, args...)
	c.Dir = root
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	if err := c.Run(); err != nil {
		return fmt.Errorf("%s failed: %w", name, err)
	}
	return nil
}
