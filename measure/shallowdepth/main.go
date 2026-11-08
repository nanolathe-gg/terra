// shallowdepth prints, for each retail TNT named on the command line, how deep its water is where the art draws it in the shallow
// (light) blue and where in the deep blue (numbers only; nothing is written). A cell's depth is the sea level less the lowest of its four
// corner heights, as the passability view reads it (sculpt-passability.js); its color is the majority of its 256 art pixels that are
// water blue (blue at least 150 and 80 over red), light where green is at least 94 (between Green's measured shallow and deep means).
// Run from the repository root, names as the maps folder has them:
//
//	go run ./measure/shallowdepth [--root DIR] "the wayneston ford engagement" "evad river confluence" ...
//
// docs/PASSABILITY.md holds the Green table (November 7, 2026).
package main

import (
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"strings"

	"github.com/nanolathe-gg/nanolathe/vfs"
)

func main() {
	root := flag.String("root", "", "content root; default ~/TotalAnnihilation")
	palPath := flag.String("palette", "materials/palette.json", "palette json")
	flag.Parse()
	if *root == "" {
		home, _ := os.UserHomeDir()
		*root = home + "/TotalAnnihilation"
	}
	var pal struct{ Indexed [][3]int }
	b, _ := os.ReadFile(*palPath)
	if err := json.Unmarshal(b, &pal); err != nil {
		panic(err)
	}
	want := map[string]bool{}
	for _, n := range flag.Args() {
		want[strings.ToLower(n)] = true
	}
	fs := vfs.New()
	if err := fs.MountGameDirectories([]string{*root}); err != nil {
		panic(err)
	}
	entries, _ := fs.ReadDir("maps")
	bands := []int{0, 4, 8, 12, 16, 20, 24, 30, 36, 42, 50, 60, 255}
	totS, totD := make([]int, len(bands)), make([]int, len(bands))
	seen := map[string]bool{}
	for _, e := range entries {
		name := strings.ToLower(strings.TrimSuffix(path.Base(strings.ReplaceAll(e.Path, `\`, "/")), path.Ext(e.Path)))
		if e.IsDir || strings.ToLower(path.Ext(e.Path)) != ".tnt" || !want[name] || seen[name] {
			continue
		}
		seen[name] = true
		f, err := fs.Open(e.Path)
		if err != nil {
			continue
		}
		all, _ := io.ReadAll(f)
		f.Close()
		u32 := func(o int) int { return int(binary.LittleEndian.Uint32(all[o:])) }
		if u32(0) != 0x2000 {
			continue
		}
		w, h, pData, pAttr, pGfx, sea := u32(4), u32(8), u32(12), u32(16), u32(20), u32(36)
		height := func(x, z int) int { return int(all[pAttr+4*(z*w+x)]) }
		pixel := func(px, py int) [3]int {
			t := int(binary.LittleEndian.Uint16(all[pData+2*((py/32)*(w/2)+px/32):]))
			return pal.Indexed[all[pGfx+t*1024+(py%32)*32+px%32]]
		}
		s, d := make([]int, len(bands)), make([]int, len(bands))
		var sDepths []int
		for z := 0; z < h-1; z++ {
			for x := 0; x < w-1; x++ {
				low := min(height(x, z), height(x+1, z), height(x, z+1), height(x+1, z+1))
				depth := sea - low
				if depth < 1 {
					continue
				}
				ns, nd := 0, 0
				for py := z * 16; py < z*16+16; py++ {
					for px := x * 16; px < x*16+16; px++ {
						c := pixel(px, py)
						if c[2] < 150 || c[2] < c[0]+80 {
							continue
						}
						if c[1] >= 94 {
							ns++
						} else {
							nd++
						}
					}
				}
				k := sort.SearchInts(bands, depth) // band index: bands[k-1] < depth <= bands[k]
				if ns >= 128 {
					s[k]++
					sDepths = append(sDepths, depth)
				} else if nd >= 128 {
					d[k]++
				}
			}
		}
		sort.Ints(sDepths)
		tot, ok := 0, 0
		for _, v := range s {
			tot += v
		}
		for _, v := range sDepths {
			if v <= 12 {
				ok++
			}
		}
		if tot == 0 {
			fmt.Printf("%-36s sea %3d  no shallow-colored water\n", name, sea)
			continue
		}
		fmt.Printf("%-36s sea %3d  shallow-colored %5d  <=12 deep %5.1f%%  depth p50 %d p90 %d\n", name, sea, tot, 100*float64(ok)/float64(tot), sDepths[len(sDepths)/2], sDepths[len(sDepths)*9/10])
		for i := range bands {
			totS[i] += s[i]
			totD[i] += d[i]
		}
	}
	fmt.Println("\npooled: depth band, shallow-colored cells, deep-colored cells")
	for i := 1; i < len(bands); i++ {
		fmt.Printf("  %3d-%-3d  %6d  %6d\n", bands[i-1]+1, bands[i], totS[i], totD[i])
	}
}
