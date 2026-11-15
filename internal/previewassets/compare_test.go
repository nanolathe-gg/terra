package previewassets

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func picture(t *testing.T, w, h int, paint func(x, y int) color.RGBA) []byte {
	t.Helper()
	im := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			im.Set(x, y, paint(x, y))
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, im); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// rerender changes a rendering input and stamps a new render of the fixture's
// 2x2 tool picture, as repro/ui-previews.mjs would.
func rerender(t *testing.T, root, dir string, paint func(x, y int) color.RGBA) {
	t.Helper()
	write(t, filepath.Join(root, "renderer.js"), []byte("faster terrain, same pixels"))
	write(t, filepath.Join(dir, "tool-hill.png"), picture(t, 2, 2, paint))
	input, err := Fingerprint(root)
	if err != nil {
		t.Fatal(err)
	}
	if err = Stamp(root, dir, input.SHA256); err != nil {
		t.Fatal(err)
	}
}

func pinnedPaint(x, y int) color.RGBA {
	if x == 0 && y == 0 {
		return color.RGBA{1, 2, 3, 255}
	}
	return color.RGBA{0, 0, 0, 0}
}

func TestUnchangedRenderKeepsBundle(t *testing.T) {
	root, dir, l, data := fixture(t)
	c, _, _ := server(t, l, data)
	pinned, err := os.ReadFile(filepath.Join(dir, "tool-hill.png"))
	if err != nil {
		t.Fatal(err)
	}
	// A faster renderer that draws the same pixels.
	rerender(t, root, dir, pinnedPaint)
	kept, result, err := acceptWithClient(root, dir, DefaultTolerance, c)
	if err != nil || !result.Equivalent {
		t.Fatal("unchanged render was not kept", err, result.Reason)
	}
	if kept.SHA256 != l.SHA256 || kept.RenderedInputsSHA256 != l.InputsSHA256 || kept.InputsSHA256 == l.InputsSHA256 {
		t.Fatalf("lock did not accept the new inputs for the old bundle: %+v", kept)
	}
	if _, err = Check(root); err != nil {
		t.Fatal("accepted inputs still stale", err)
	}
	if err = c.published(kept); err != nil {
		t.Fatal("kept bundle no longer verifies against its own receipt", err)
	}
	restored, err := os.ReadFile(filepath.Join(dir, "tool-hill.png"))
	if err != nil || !bytes.Equal(restored, pinned) {
		t.Fatal("local folder was not restored to the pinned pictures")
	}
	if err = Ensure(root); err != nil {
		t.Fatal("dev server would refuse the restored folder", err)
	}
	// A forged acceptance that hides the bundle's real inputs must still fail.
	forged := kept
	forged.RenderedInputsSHA256 = kept.InputsSHA256
	if err = c.published(forged); err == nil || !strings.Contains(err.Error(), "different inputs") {
		t.Fatal("lock could rename the bundle's rendered inputs", err)
	}
}

func TestVisibleChangeNeedsPublish(t *testing.T) {
	root, dir, l, data := fixture(t)
	c, _, _ := server(t, l, data)
	rerender(t, root, dir, func(x, y int) color.RGBA { return color.RGBA{200, 2, 3, 255} })
	kept, result, err := acceptWithClient(root, dir, DefaultTolerance, c)
	if err != nil {
		t.Fatal(err)
	}
	if result.Equivalent || !strings.Contains(result.Reason, "tool-hill.png frame 0") {
		t.Fatalf("visible change was kept: %+v", result)
	}
	if kept.InputsSHA256 != l.InputsSHA256 || kept.RenderedInputsSHA256 != "" {
		t.Fatal("lock changed without a publish")
	}
	if _, err = Check(root); err == nil {
		t.Fatal("rejected render made inputs fresh")
	}
}

func TestChangedManifestNeedsPublish(t *testing.T) {
	root, dir, l, data := fixture(t)
	c, _, _ := server(t, l, data)
	write(t, filepath.Join(dir, "manifest.json"), []byte(`{"frame":{"width":2,"height":2,"ms":90},"tools":["hill"],"controls":{},"worlds":{"frame":{"width":2,"height":2},"images":{}}}`))
	rerender(t, root, dir, pinnedPaint)
	_, result, err := acceptWithClient(root, dir, DefaultTolerance, c)
	if err != nil {
		t.Fatal(err)
	}
	if result.Equivalent || result.Reason != "the preview manifest changed" {
		t.Fatalf("manifest change was kept: %+v", result)
	}
}

func TestToleranceIsPerFrame(t *testing.T) {
	const w, h = 100, 40 // two 50x40 frames, 2000 pixels each
	base := func(x, y int) color.RGBA { return color.RGBA{uint8(x), uint8(y), 90, 255} }
	pinned := picture(t, w, h, base)
	// Grain: every pixel of both frames off by a few levels.
	grain := picture(t, w, h, func(x, y int) color.RGBA { c := base(x, y); c.B += 3; return c })
	frames, err := comparePNG("lean.png", pinned, grain, 50, DefaultTolerance)
	if err != nil || len(frames) != 2 || frames[0].Changed != 0 || frames[0].MaxDiff != 3 {
		t.Fatalf("grain: %+v %v", frames, err)
	}
	// Two moved pixels in the second frame: 0.1% of that frame, 0.05% of the strip.
	moved := picture(t, w, h, func(x, y int) color.RGBA {
		c := base(x, y)
		if y == 5 && (x == 60 || x == 61) {
			c.R = 255
		}
		return c
	})
	frames, err = comparePNG("lean.png", pinned, moved, 50, DefaultTolerance)
	if err != nil || len(frames) != 1 || frames[0].Frame != 1 || frames[0].Changed != 0.001 {
		t.Fatalf("moved: %+v %v", frames, err)
	}
	// Judged over the whole strip, the same change would pass as invisible.
	if strip := 2.0 / (w * h); frames[0].Changed <= DefaultTolerance.MaxChanged || strip > DefaultTolerance.MaxChanged {
		t.Fatal("a change confined to one frame was diluted by its strip")
	}
}
