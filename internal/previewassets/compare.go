package previewassets

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"sort"
)

// Tolerance decides when a new render matches the pinned bundle closely enough
// to keep it. A pixel counts as moved when any channel differs by more than
// PixelDelta levels (of 255); a frame changes visibly when more than MaxChanged
// of its pixels moved. Frames are compared one by one so a change in one slider
// value is not diluted by the rest of its strip.
type Tolerance struct {
	PixelDelta int
	MaxChanged float64
}

// Renders are deterministic on one machine, so unchanged pictures match
// exactly. The cutoff sits well under the smallest real change measured on
// past bundles: the wrong crystal tool picture of 2026-11-14 moved 0.117% of
// its frame.
var DefaultTolerance = Tolerance{PixelDelta: 8, MaxChanged: 0.0005}

type FrameChange struct {
	File    string
	Frame   int
	Changed float64 // share of the frame's pixels that moved more than PixelDelta
	MaxDiff int     // largest channel difference in the frame
}

type Comparison struct {
	Equivalent bool
	Reason     string        // why the render cannot be kept, when it is not equivalent
	Frames     []FrameChange // frames with any difference, most changed first
}

func (c Comparison) Worst() (FrameChange, bool) {
	if len(c.Frames) == 0 {
		return FrameChange{}, false
	}
	return c.Frames[0], true
}

func (f FrameChange) String() string {
	return fmt.Sprintf("%s frame %d: %.3f%% of pixels moved, largest difference %d", f.File, f.Frame, 100*f.Changed, f.MaxDiff)
}

func decode(b []byte) (image.Image, error) { return png.Decode(bytes.NewReader(b)) }

func comparePNG(name string, pinned, rendered []byte, frameWidth int, tol Tolerance) ([]FrameChange, error) {
	a, err := decode(pinned)
	if err != nil {
		return nil, fmt.Errorf("pinned %s: %w", name, err)
	}
	b, err := decode(rendered)
	if err != nil {
		return nil, fmt.Errorf("rendered %s: %w", name, err)
	}
	ra, rb := a.Bounds(), b.Bounds()
	if ra.Dx() != rb.Dx() || ra.Dy() != rb.Dy() {
		return nil, fmt.Errorf("%s changed size", name)
	}
	frames := 1
	if frameWidth > 0 && ra.Dx()%frameWidth == 0 {
		frames = ra.Dx() / frameWidth
	}
	width := ra.Dx() / frames
	out := []FrameChange{}
	for f := 0; f < frames; f++ {
		moved, maxDiff := 0, 0
		for y := 0; y < ra.Dy(); y++ {
			for x := f * width; x < (f+1)*width; x++ {
				r1, g1, b1, a1 := a.At(ra.Min.X+x, ra.Min.Y+y).RGBA()
				r2, g2, b2, a2 := b.At(rb.Min.X+x, rb.Min.Y+y).RGBA()
				d := 0
				for _, p := range [4][2]uint32{{r1, r2}, {g1, g2}, {b1, b2}, {a1, a2}} {
					v := int(p[0]>>8) - int(p[1]>>8)
					if v < 0 {
						v = -v
					}
					if v > d {
						d = v
					}
				}
				if d > maxDiff {
					maxDiff = d
				}
				if d > tol.PixelDelta {
					moved++
				}
			}
		}
		if maxDiff > 0 {
			out = append(out, FrameChange{File: name, Frame: f, Changed: float64(moved) / float64(width*ra.Dy()), MaxDiff: maxDiff})
		}
	}
	return out, nil
}

// comparePictures compares a complete, stamped render in dir against the pinned
// bundle's pictures in pinnedDir. The file set and runtime manifest must be
// identical: a new tool, control or frame always needs a real publish.
func comparePictures(l Lock, pinnedDir, dir string, rendered Receipt, tol Tolerance) (Comparison, error) {
	c := Comparison{}
	if len(rendered.Files)+1 != len(l.Files) {
		c.Reason = "the set of preview files changed"
		return c, nil
	}
	for name := range rendered.Files {
		if _, ok := l.Files[name]; !ok {
			c.Reason = "new preview file " + name
			return c, nil
		}
	}
	if rendered.Files["manifest.json"] != l.Files["manifest.json"] {
		c.Reason = "the preview manifest changed"
		return c, nil
	}
	manifest, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return c, err
	}
	var m struct{ Frame struct{ Width int } }
	if err = json.Unmarshal(manifest, &m); err != nil {
		return c, err
	}
	names := make([]string, 0, len(rendered.Files))
	for name := range rendered.Files {
		if filepath.Ext(name) == ".png" {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	for _, name := range names {
		if rendered.Files[name] == l.Files[name] {
			continue
		}
		pinned, err := os.ReadFile(filepath.Join(pinnedDir, name))
		if err != nil {
			return c, err
		}
		fresh, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return c, err
		}
		frames, err := comparePNG(name, pinned, fresh, m.Frame.Width, tol)
		if err != nil {
			return c, err
		}
		c.Frames = append(c.Frames, frames...)
	}
	sort.SliceStable(c.Frames, func(i, j int) bool {
		if c.Frames[i].Changed != c.Frames[j].Changed {
			return c.Frames[i].Changed > c.Frames[j].Changed
		}
		return c.Frames[i].MaxDiff > c.Frames[j].MaxDiff
	})
	c.Equivalent = true
	if worst, ok := c.Worst(); ok && worst.Changed > tol.MaxChanged {
		c.Equivalent = false
		c.Reason = "visible change in " + worst.String()
	}
	return c, nil
}

// pinnedPictures unpacks the pinned bundle (from the checksum cache when
// present) into a temporary folder and returns it with its cleanup.
func pinnedPictures(l Lock, c client) (string, func(), error) {
	asset, err := c.asset(l)
	if err != nil {
		return "", nil, err
	}
	data, err := c.archive(l, asset)
	if err != nil {
		return "", nil, err
	}
	temp, err := os.MkdirTemp("", "terraform-previews-pinned-")
	if err != nil {
		return "", nil, err
	}
	cleanup := func() {
		for name := range l.Files {
			_ = os.Remove(filepath.Join(temp, name))
		}
		_ = os.Remove(temp)
	}
	if err = unpack(data, l, temp); err != nil {
		cleanup()
		return "", nil, err
	}
	return temp, cleanup, nil
}

func compareWithClient(root, dir string, tol Tolerance, c client) (Lock, Comparison, error) {
	l, err := LoadLock(root)
	if err != nil {
		return l, Comparison{}, err
	}
	rendered, err := VerifyReceipt(root, dir)
	if err != nil {
		return l, Comparison{}, err
	}
	pinned, cleanup, err := pinnedPictures(l, c)
	if err != nil {
		return l, Comparison{}, err
	}
	defer cleanup()
	result, err := comparePictures(l, pinned, dir, rendered, tol)
	return l, result, err
}

// Compare reports how a complete render at the current inputs differs from the
// pinned bundle. It changes nothing.
func Compare(root, dir string, tol Tolerance) (Comparison, error) {
	_, result, err := compareWithClient(root, dir, tol, githubClient())
	return result, err
}

// acceptWithClient keeps the pinned bundle when a render at the current inputs
// shows no visible change: the lock records the current inputs as accepted
// while the bundle keeps the receipt of the inputs it was rendered from, and
// the local folder returns to the pinned pictures. Every comparison is against
// the pinned pixels, so small accepted changes cannot add up unnoticed.
func acceptWithClient(root, dir string, tol Tolerance, c client) (Lock, Comparison, error) {
	l, result, err := compareWithClient(root, dir, tol, c)
	if err != nil || !result.Equivalent {
		return l, result, err
	}
	input, err := Fingerprint(root)
	if err != nil {
		return l, result, err
	}
	l.RenderedInputsSHA256 = l.renderedInputs()
	l.InputsSHA256 = input.SHA256
	l.AcceptedChange = "none"
	if worst, ok := result.Worst(); ok {
		l.AcceptedChange = worst.String()
	}
	if l.InputsSHA256 == l.RenderedInputsSHA256 {
		l.RenderedInputsSHA256, l.AcceptedChange = "", ""
	}
	if err = writeJSON(filepath.Join(root, LockName), l); err != nil {
		return l, result, err
	}
	return l, result, fetchWithClient(root, true, c)
}
