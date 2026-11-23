package site

import (
	"bytes"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
)

// Preload hints for the editor's start-up. A module's imports are only known once the module has arrived, so the page's static module
// graph (four levels deep) and the shaders it fetches late cost one round trip each, one after another. These hints list every module the
// entry reaches and every shader and JSON file its modules fetch by name, so the browser asks for them all with the page. A file missing
// from the hints loads as it would without them; a hint names only files that are shipped.
var (
	importFrom    = regexp.MustCompile(`(?m)^\s*(?:import|export)\s[^'";]*?\bfrom\s*['"]([^'"]+\.js)['"]`)
	importDynamic = regexp.MustCompile(`\bimport\(\s*['"]([^'"]+\.js)['"]\s*\)`)
	fetchLiteral  = regexp.MustCompile(`\bfetch\(\s*['"]([^'"]+\.(?:json|wgsl))['"]\s*\)`)
)

// startupModules is the entry and every module it reaches through static imports and literal dynamic imports, entry first, then in the
// order they are found. JSON modules are left out: their requests follow the module that imports them.
func startupModules(entry string, read func(string) ([]byte, error), shipped map[string]bool) ([]string, map[string][]byte, error) {
	order, seen, sources := []string{}, map[string]bool{entry: true}, map[string][]byte{}
	for queue := []string{entry}; len(queue) > 0; queue = queue[1:] {
		name := queue[0]
		data, err := read(name)
		if err != nil {
			return nil, nil, fmt.Errorf("preload: %s: %w", name, err)
		}
		order, sources[name] = append(order, name), data
		var specs [][]byte
		for _, m := range importFrom.FindAllSubmatch(data, -1) {
			specs = append(specs, m[1])
		}
		for _, m := range importDynamic.FindAllSubmatch(data, -1) {
			specs = append(specs, m[1])
		}
		for _, spec := range specs {
			target := path.Clean(path.Join(path.Dir(name), string(spec)))
			if shipped[target] && !seen[target] {
				seen[target] = true
				queue = append(queue, target)
			}
		}
	}
	return order, sources, nil
}

// preloadHints is the <link> tags for the start-up files of the shipped names, or "" when there is no entry module.
func preloadHints(names []string, read func(string) ([]byte, error)) (string, error) {
	const entry = "sculpt.js"
	shipped := map[string]bool{}
	for _, n := range names {
		shipped[n] = true
	}
	if !shipped[entry] {
		return "", nil
	}
	modules, sources, err := startupModules(entry, read, shipped)
	if err != nil {
		return "", err
	}
	fetched := map[string]bool{}
	for _, n := range names {
		if strings.HasSuffix(n, ".wgsl") { // every engine shader is read at start-up (the renderer, rock weather, shape and feed passes)
			fetched[n] = true
		}
	}
	for _, name := range modules {
		for _, m := range fetchLiteral.FindAllSubmatch(sources[name], -1) {
			if target := path.Clean(path.Join(path.Dir(name), string(m[1]))); shipped[target] {
				fetched[target] = true
			}
		}
	}
	files := make([]string, 0, len(fetched))
	for n := range fetched {
		files = append(files, n)
	}
	sort.Strings(files)
	var b strings.Builder
	for _, n := range modules {
		fmt.Fprintf(&b, `<link rel="modulepreload" href="%s">`, n)
	}
	// crossorigin: the page's fetch() asks in cors mode with same-origin credentials, and a preload is used only when its mode matches.
	for _, n := range files {
		fmt.Fprintf(&b, `<link rel="preload" href="%s" as="fetch" crossorigin>`, n)
	}
	return b.String(), nil
}

// withPreloads puts the hints right after <head>: before any relative URL, after the build's <base> (which is inserted there later).
func withPreloads(index []byte, names []string, read func(string) ([]byte, error)) ([]byte, error) {
	if !bytes.Contains(index, []byte("<head>")) {
		return index, nil
	}
	hints, err := preloadHints(names, read)
	if err != nil || hints == "" {
		return index, err
	}
	return bytes.Replace(index, []byte("<head>"), []byte("<head>"+hints), 1), nil
}
