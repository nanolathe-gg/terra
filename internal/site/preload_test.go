package site

import (
	"errors"
	"strings"
	"testing"
)

func TestPreloadHints(t *testing.T) {
	files := map[string]string{
		"sculpt.js": "import {a} from './a.js';\nimport palette from './materials/palette.json' with {type: 'json'};\nexport {b} from './b.js';\n" +
			"const later = () => import('./c.js');\nconst missing = () => import('./gone.js');\nfetch('services.json');\nconst css = `import x from 'nope.js'`;",
		"a.js":             "import {b} from './b.js';\nexport const a = () => fetch('engine-shape.wgsl').then(() => fetch('not-shipped.json'));",
		"b.js":             "import {a} from './a.js';\nexport const b = 1;",
		"c.js":             "export const c = 2;",
		"lazy.js":          "export const unused = 3;",
		"engine-frag.wgsl": "", "engine-shape.wgsl": "", "services.json": "{}", "materials/palette.json": "{}", "index.html": "",
	}
	names := []string{}
	for n := range files {
		names = append(names, n)
	}
	read := func(n string) ([]byte, error) {
		if s, ok := files[n]; ok {
			return []byte(s), nil
		}
		return nil, errors.New("missing")
	}
	hints, err := preloadHints(names, read)
	if err != nil {
		t.Fatal(err)
	}
	want := `<link rel="modulepreload" href="sculpt.js"><link rel="modulepreload" href="a.js"><link rel="modulepreload" href="b.js"><link rel="modulepreload" href="c.js">` +
		`<link rel="preload" href="engine-frag.wgsl" as="fetch" crossorigin><link rel="preload" href="engine-shape.wgsl" as="fetch" crossorigin><link rel="preload" href="services.json" as="fetch" crossorigin>`
	if hints != want {
		t.Fatalf("hints:\n%s\nwant:\n%s", hints, want)
	}
	page, err := withPreloads([]byte("<html><head><title>x</title></head></html>"), names, read)
	if err != nil || !strings.HasPrefix(string(page), "<html><head><link rel=\"modulepreload\" href=\"sculpt.js\">") {
		t.Fatalf("page %q, %v", page, err)
	}
	// A page without a head, or a site without the entry module, is left as it is.
	if page, _ := withPreloads([]byte("editor"), names, read); string(page) != "editor" {
		t.Fatalf("headless page changed: %q", page)
	}
	if hints, _ := preloadHints([]string{"index.html", "example.js"}, read); hints != "" {
		t.Fatalf("no entry: %q", hints)
	}
}
