package main

import (
	"crypto/sha256"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/nanolathe-gg/nanolathe/formats"
	"github.com/nanolathe-gg/nanolathe/tools/map-editor/mapdata"
)

// Follow [fmt gaf] "Composed frames": every leaf uses the same anchor and
// children draw in table order. Include children outside the parent canvas;
// the adjusted offsets keep the same anchor after that bounds expansion.
// Alternate children require the destination's ALP pixels and cannot be
// represented faithfully by this catalogue's single transparent PNG.
func spriteImage(frame *formats.GAFFrame, palette [256][3]byte) (*image.NRGBA, int, int, bool, error) {
	bounds := image.Rect(-int(frame.XOffset), -int(frame.YOffset), int(frame.Width)-int(frame.XOffset), int(frame.Height)-int(frame.YOffset))
	var leaves []*formats.GAFFrame
	var collect func(*formats.GAFFrame, bool) error
	collect = func(f *formats.GAFFrame, child bool) error {
		if child && f.AlternateBlitter != 0 {
			return fmt.Errorf("alternate GAF subframe needs destination-dependent ALP rendering")
		}
		if len(f.Subframes) > 0 {
			for _, c := range f.Subframes {
				if err := collect(c, true); err != nil {
					return err
				}
			}
		} else {
			bounds = bounds.Union(image.Rect(-int(f.XOffset), -int(f.YOffset), int(f.Width)-int(f.XOffset), int(f.Height)-int(f.YOffset)))
			leaves = append(leaves, f)
		}
		return nil
	}
	if err := collect(frame, false); err != nil {
		return nil, 0, 0, false, err
	}
	if bounds.Empty() {
		return nil, 0, 0, false, nil
	}
	if int64(bounds.Dx())*int64(bounds.Dy()) > 16<<20 {
		return nil, 0, 0, false, fmt.Errorf("composed sprite bounds %dx%d exceed the PNG pixel budget", bounds.Dx(), bounds.Dy())
	}
	img := image.NewNRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	drawn := false
	for _, f := range leaves {
		for y := 0; y < int(f.Height); y++ {
			for x := 0; x < int(f.Width); x++ {
				at := y*int(f.Width) + x
				if f.Transparent[at] {
					continue
				}
				c := palette[f.Pixels[at]]
				img.SetNRGBA(x-int(f.XOffset)-bounds.Min.X, y-int(f.YOffset)-bounds.Min.Y, color.NRGBA{R: c[0], G: c[1], B: c[2], A: 255})
				drawn = true
			}
		}
	}
	return img, -bounds.Min.X, -bounds.Min.Y, drawn, nil
}

func safeBasename(key string) string {
	// Filenames never inherit path separators, reserved names or punctuation
	// from authored feature names. The full digest also keeps names distinct.
	sum := sha256.Sum256([]byte(key))
	return fmt.Sprintf("feature-%x", sum)
}

func writeSprite(out, world, filename string, img image.Image, xoff, yoff int) (mapdata.Sprite, error) {
	s := mapdata.Sprite{URL: "/map-features/" + world + "/" + filename, Width: img.Bounds().Dx(), Height: img.Bounds().Dy(), XOffset: xoff, YOffset: yoff}
	err := publish(filepath.Join(out, filename), func(w io.Writer) error { return png.Encode(w, img) })
	return s, err
}

// Publish complete derived files atomically, replacing a previous generated
// file or a stale symlink itself rather than following its target.
func publish(name string, write func(io.Writer) error) error {
	f, err := os.CreateTemp(filepath.Dir(name), ".map-features-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	err = write(f)
	if err == nil {
		err = f.Chmod(0o644)
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), name)
}

func resolvedPath(name string) (string, error) {
	absolute, err := filepath.Abs(name)
	if err != nil {
		return "", err
	}
	var suffix []string
	for {
		resolved, err := filepath.EvalSymlinks(absolute)
		if err == nil {
			for i := len(suffix) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, suffix[i])
			}
			return resolved, nil
		}
		if !os.IsNotExist(err) || filepath.Dir(absolute) == absolute {
			return "", err
		}
		suffix = append(suffix, filepath.Base(absolute))
		absolute = filepath.Dir(absolute)
	}
}

func refuseContentOutput(out string, roots []string) error {
	output, err := resolvedPath(out)
	if err != nil {
		return err
	}
	for _, root := range roots {
		resolved, err := resolvedPath(root)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(strings.ToLower(resolved), strings.ToLower(output))
		if err != nil {
			return err
		}
		if rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return fmt.Errorf("output %s is inside content root %s; use a separate feature directory", out, root)
		}
	}
	return nil
}
