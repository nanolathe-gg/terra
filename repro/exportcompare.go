// Compare decoded browser/native exported pixels, TNT bytes, and height cells.
// Usage: go run repro/exportcompare.go browser.ufo native.ufo browser.png native.png native-heights.json map-name
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	_ "image/png"
	"os"
	"strings"

	"github.com/nanolathe-gg/nanolathe/formats"
	"github.com/nanolathe-gg/nanolathe/vfs"
)

func fail(format string, args ...any) { fmt.Fprintf(os.Stderr, format+"\n", args...); os.Exit(1) }
func terrain(archive, name string) ([]byte, *formats.TNT) {
	f := vfs.New()
	defer f.Close()
	if _, err := f.MountArchive(archive, 10); err != nil {
		fail("open archive: %v", err)
	}
	data, err := f.ReadFile("maps/" + name + ".tnt")
	if err != nil {
		fail("read TNT: %v", err)
	}
	t, err := formats.LoadTNT(data)
	if err != nil {
		fail("decode TNT: %v", err)
	}
	return data, t
}
func imageFile(path string) image.Image {
	f, err := os.Open(path)
	if err != nil {
		fail("open image: %v", err)
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		fail("decode image: %v", err)
	}
	return img
}
func main() {
	if len(os.Args) != 7 {
		fail("expected browser.ufo native.ufo browser.png native.png heights.json map-name")
	}
	name := strings.TrimSpace(os.Args[6])
	b, bt := terrain(os.Args[1], name)
	n, nt := terrain(os.Args[2], name)
	if bt.Width != nt.Width || bt.Height != nt.Height {
		fail("TNT dimensions differ")
	}
	bm, nm := imageFile(os.Args[3]), imageFile(os.Args[4])
	if bm.Bounds() != nm.Bounds() {
		fail("PNG dimensions differ")
	}
	pixelDiff := 0
	box := bm.Bounds()
	for y := box.Min.Y; y < box.Max.Y; y++ {
		for x := box.Min.X; x < box.Max.X; x++ {
			br, bg, bb, ba := bm.At(x, y).RGBA()
			nr, ng, nb, na := nm.At(x, y).RGBA()
			if br != nr || bg != ng || bb != nb || ba != na {
				pixelDiff++
			}
		}
	}
	heightDiff := 0
	for i := range bt.Attributes {
		if bt.Attributes[i].Height != nt.Attributes[i].Height {
			heightDiff++
		}
	}
	raw, err := os.ReadFile(os.Args[5])
	if err != nil {
		fail("read native heights: %v", err)
	}
	var heights []int
	if err = json.Unmarshal(raw, &heights); err != nil {
		fail("decode native heights: %v", err)
	}
	if len(heights) != len(nt.Attributes) {
		fail("native height count %d differs from TNT %d", len(heights), len(nt.Attributes))
	}
	jsonDiff := 0
	for i, h := range heights {
		if h != int(nt.Attributes[i].Height) {
			jsonDiff++
		}
	}
	result := map[string]any{"pixels": box.Dx() * box.Dy(), "differentPixels": pixelDiff, "heightCells": len(heights), "differentHeightCells": heightDiff, "nativeJSONHeightDifferences": jsonDiff, "tntBytesEqual": bytes.Equal(b, n), "browserTNTBytes": len(b), "nativeTNTBytes": len(n)}
	out, _ := json.Marshal(result)
	fmt.Println(string(out))
	if pixelDiff != 0 || heightDiff != 0 || jsonDiff != 0 || !bytes.Equal(b, n) {
		os.Exit(1)
	}
}
