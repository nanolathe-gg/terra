package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
)

type chunkRecord struct {
	File  string `json:"file"`
	Bytes int    `json:"bytes"`
	SHA   string `json:"sha256"`
}
type docState struct {
	Document map[string]any         `json:"document"`
	Chunks   map[string]chunkRecord `json:"chunks"`
	Revision int                    `json:"revision"`
}
type documentStore struct {
	root string
	mu   sync.Mutex
}

var token = regexp.MustCompile(`^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$`)

func atomic(path string, b []byte) error {
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".document-")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if _, e = f.Write(b); e == nil {
		e = f.Sync()
	}
	if c := f.Close(); e == nil {
		e = c
	}
	if e != nil {
		return e
	}
	return os.Rename(f.Name(), path)
}
func (d *documentStore) serve(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/map-document" && r.URL.Path != "/map-document/chunk" {
		http.NotFound(w, r)
		return
	}
	q := r.URL.Query()
	ids := q["id"]
	if len(ids) != 1 || !token.MatchString(ids[0]) || strings.Contains(ids[0], "..") {
		bad(w, fmt.Errorf("One valid document id is required"))
		return
	}
	id := ids[0]
	key := ""
	ischunk := strings.HasSuffix(r.URL.Path, "/chunk")
	if ischunk {
		keys := q["key"]
		if len(keys) != 1 || !token.MatchString(keys[0]) || strings.Contains(keys[0], "..") {
			bad(w, fmt.Errorf("One valid chunk key is required"))
			return
		}
		key = keys[0]
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	dir := filepath.Join(d.root, id)
	path := filepath.Join(dir, "document.json")
	state := docState{Document: map[string]any{}, Chunks: map[string]chunkRecord{}}
	data, e := os.ReadFile(path)
	exists := e == nil
	if exists {
		if e = json.Unmarshal(data, &state); e != nil {
			bad(w, e)
			return
		}
	} else if !os.IsNotExist(e) {
		bad(w, e)
		return
	}
	save := func() error {
		b, e := json.Marshal(state)
		if e != nil {
			return e
		}
		return atomic(path, b)
	}
	result := func() map[string]any {
		keys := make([]string, 0, len(state.Chunks))
		for k := range state.Chunks {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		list := []any{}
		for _, k := range keys {
			v := state.Chunks[k]
			list = append(list, map[string]any{"key": k, "bytes": v.Bytes, "sha256": v.SHA})
		}
		return map[string]any{"id": id, "document": state.Document, "revision": state.Revision, "chunks": list}
	}
	switch r.Method {
	case "GET":
		if !exists {
			http.NotFound(w, r)
			return
		}
		if !ischunk {
			reply(w, result())
			return
		}
		rec, ok := state.Chunks[key]
		if !ok {
			http.NotFound(w, r)
			return
		}
		b, e := os.ReadFile(filepath.Join(dir, rec.File))
		if e != nil {
			bad(w, e)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("ETag", `"`+rec.SHA+`"`)
		w.Write(b)
	case "PUT":
		limit := int64(16 << 20)
		if ischunk {
			limit = 32 << 20
		}
		if r.ContentLength < 0 || r.ContentLength > limit || (!ischunk && r.ContentLength == 0) {
			bad(w, fmt.Errorf("Document request exceeds %d MiB", limit>>20))
			return
		}
		b, e := io.ReadAll(io.LimitReader(r.Body, limit+1))
		if e != nil || int64(len(b)) != r.ContentLength {
			bad(w, fmt.Errorf("Document request ended before Content-Length"))
			return
		}
		if !ischunk {
			var doc map[string]any
			if e = json.Unmarshal(b, &doc); e != nil || doc == nil {
				bad(w, fmt.Errorf("Document metadata must be a JSON object"))
				return
			}
			old, _ := json.Marshal(state.Document)
			next, _ := json.Marshal(doc)
			if !exists || string(old) != string(next) {
				state.Document = doc
				state.Revision++
				if e = save(); e != nil {
					bad(w, e)
					return
				}
			}
			reply(w, result())
			return
		}
		hash := sha256.Sum256(b)
		sha := hex.EncodeToString(hash[:])
		prev, ok := state.Chunks[key]
		changed := !ok || prev.SHA != sha
		if changed {
			file := "chunk-" + key + "-" + sha + ".bin"
			if e = atomic(filepath.Join(dir, file), b); e != nil {
				bad(w, e)
				return
			}
			state.Chunks[key] = chunkRecord{file, len(b), sha}
			state.Revision++
			if e = save(); e != nil {
				bad(w, e)
				return
			}
			if ok {
				os.Remove(filepath.Join(dir, prev.File))
			}
		}
		reply(w, map[string]any{"id": id, "key": key, "bytes": len(b), "sha256": sha, "changed": changed, "revision": state.Revision})
	case "DELETE":
		if ischunk {
			if prev, ok := state.Chunks[key]; ok {
				delete(state.Chunks, key)
				state.Revision++
				if e = save(); e != nil {
					bad(w, e)
					return
				}
				os.Remove(filepath.Join(dir, prev.File))
			}
		} else {
			for _, v := range state.Chunks {
				os.Remove(filepath.Join(dir, v.File))
			}
			os.Remove(path)
			os.Remove(dir)
		}
		reply(w, map[string]any{"id": id, "deleted": true})
	default:
		http.NotFound(w, r)
	}
}
