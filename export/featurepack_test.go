package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nanolathe-gg/nanolathe/formats"
	"github.com/nanolathe-gg/nanolathe/vfs"
)

func testFrame(w, h, index int) packFrame {
	px, opaque := bytes.Repeat([]byte{byte(index)}, w*h), bytes.Repeat([]byte{1}, w*h)
	opaque[0] = 0
	return packFrame{Width: w, Height: h, X: w / 2, Y: h - 1, Duration: 10, Pixels: px, Opaque: opaque}
}

func testPack() featurePack {
	keys := func(kv ...string) [][2]string {
		var out [][2]string
		for i := 0; i < len(kv); i += 2 {
			out = append(out, [2]string{kv[i], kv[i+1]})
		}
		return out
	}
	return featurePack{Prefix: "TFab12", Defs: []packDef{
		{Name: "TFab12Tree1", Keys: keys("description", "Tree", "footprintx", "1", "footprintz", "1", "height", "40", "filename", "tfab12", "seqname", "tfab12t1", "seqnameshad", "tfab12t1s",
			"seqnameburn", "tfab12t1b", "energy", "250", "flamable", "1", "featureburnt", "TFab12Tree1B", "featuredead", "TFab12Smudge", "featurereclamate", "TFab12Smudge", "burnweapon", "TreeBurn")},
		{Name: "TFab12Tree1B", Keys: keys("description", "Burnt Tree", "footprintx", "1", "footprintz", "1", "filename", "tfab12", "seqname", "tfab12t1x", "energy", "50", "featuredead", "TFab12Smudge")},
		{Name: "TFab12Smudge", Keys: keys("footprintx", "1", "footprintz", "1", "filename", "tfab12", "seqname", "tfab12sm", "animtrans", "1", "featuredead", "TFab12Smudge")},
		{Name: "TFab12Metal127", Keys: keys("description", "Metal", "footprintx", "3", "footprintz", "3", "filename", "tfab12", "seqname", "tfab12void", "metal", "127", "indestructible", "1")},
		{Name: "TFab12Rock1", Keys: keys("footprintx", "2", "footprintz", "2", "filename", "tfab12", "seqname", "tfab12r1", "metal", "50")},
	}, Sequences: []packSequence{
		{Name: "tfab12t1", Frames: []packFrame{testFrame(40, 60, 42)}}, {Name: "tfab12t1s", Frames: []packFrame{testFrame(30, 20, 95)}},
		{Name: "tfab12t1b", Frames: []packFrame{testFrame(40, 61, 200), testFrame(41, 62, 201), testFrame(40, 63, 202)}},
		{Name: "tfab12t1x", Frames: []packFrame{testFrame(20, 50, 94)}}, {Name: "tfab12sm", Frames: []packFrame{testFrame(20, 16, 63)}},
		{Name: "tfab12void", Frames: []packFrame{{Width: 1, Height: 1, Duration: 10, Pixels: []byte{9}, Opaque: []byte{0}}}},
		{Name: "tfab12r1", Frames: []packFrame{testFrame(30, 24, 90)}},
	}}
}

func TestPackKeepsWhatThePlacedFeaturesReach(t *testing.T) {
	p, err := checkPack(testPack(), []string{"tfab12tree1", "TFab12Metal127"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(p.sections, ",") != "TFab12Tree1,TFab12Tree1B,TFab12Smudge,TFab12Metal127" {
		t.Fatalf("sections %v: the tree, its burnt and dead successors and the deposit, not the unplaced rock", p.sections)
	}
	if _, ok := p.sequences["tfab12r1"]; ok || p.sequences["tfab12t1b"] != 3 {
		t.Fatalf("sequences %v", p.sequences)
	}
	if p.defs["tfab12metal127"].footprintX != 3 || p.tdf != "features/tfab12/tfab12.tdf" || p.gaf != "anims/tfab12.gaf" {
		t.Fatalf("defs %v, files %s %s", p.defs, p.tdf, p.gaf)
	}
	gaf, err := formats.LoadGAF(p.files[0].Data)
	if err != nil || len(gaf.Entries) != 6 {
		t.Fatalf("bank: %v, %d entries", err, len(gaf.Entries))
	}
}

func TestPackRefusesWhatTheGameWouldNot(t *testing.T) {
	for name, edit := range map[string]func(*featurePack){
		"retail-like prefix":  func(p *featurePack) { p.Prefix = "trees" },
		"name without prefix": func(p *featurePack) { p.Defs[4].Name = "Rock1" },
		"missing successor":   func(p *featurePack) { p.Defs[2].Keys[len(p.Defs[2].Keys)-1][1] = "TFab12Gone" },
		"unknown sequence":    func(p *featurePack) { p.Defs[0].Keys[5][1] = "tfab12none" },
		"other bank":          func(p *featurePack) { p.Defs[0].Keys[4][1] = "trees" },
		"metal over a byte":   func(p *featurePack) { p.Defs[3].Keys[6][1] = "300" },
		"long description":    func(p *featurePack) { p.Defs[0].Keys[0][1] = "A tree with a long name" },
		"unknown key":         func(p *featurePack) { p.Defs[0].Keys = append(p.Defs[0].Keys, [2]string{"object", "tree.3do"}) },
		"short pixels":        func(p *featurePack) { p.Sequences[0].Frames[0].Pixels = p.Sequences[0].Frames[0].Pixels[:10] },
		"sequence name > 31":  func(p *featurePack) { p.Sequences[0].Name = strings.Repeat("a", 32) },
		"weapon not retail's": func(p *featurePack) { p.Defs[0].Keys[len(p.Defs[0].Keys)-1][1] = "Nuke" },
		"placed name unknown": func(p *featurePack) { p.Defs[3].Name = "TFab12Metal99" },
	} {
		pack := testPack()
		edit(&pack)
		if _, err := checkPack(pack, []string{"TFab12Tree1", "TFab12Metal127"}); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

// The archive carries the pack's files beside the map's OTA and TNT; the TNT stays the last file, and the self-check reads all back.
func TestArchiveCarriesTheFeatureFiles(t *testing.T) {
	p, err := checkPack(testPack(), []string{"TFab12Tree1"})
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	tnt, err := os.Create(filepath.Join(dir, "map.tnt"))
	if err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte("TNT!"), 5000)
	tnt.Write(payload)
	var out bytes.Buffer
	if err := writeStreamArchive(&out, "Pack Test", []byte("[GlobalHeader]{}"), tnt, p.files); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "Pack Test.ufo")
	if err := os.WriteFile(path, out.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	fs := vfs.New()
	defer fs.Close()
	f, _ := os.Open(path)
	defer f.Close()
	if _, err := fs.MountArchiveReader(path, f, int64(out.Len()), 10, vfs.ArchiveOptions{}); err != nil {
		t.Fatal(err)
	}
	got, err := fs.ReadFile("maps/Pack Test.tnt")
	if err != nil || !bytes.Equal(got, payload) {
		t.Fatalf("TNT read back %d bytes, %v", len(got), err)
	}
	if err := checkPackFiles(fs, p); err != nil {
		t.Fatal(err)
	}
}
