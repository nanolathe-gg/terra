package main

import (
	"bytes"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"

	"github.com/nanolathe-gg/nanolathe/formats"
	"github.com/nanolathe-gg/nanolathe/vfs"
)

// Match internal/mapgen/ota.go [fmt ota]: one Network 1 schema with the
// world's climate, ordinary starting resources and numbered StartPos specials.
func encodeOTA(req exportRequest, world worldInfo, starts []start) ([]byte, error) {
	c := world.Climate
	lava := "0"
	if c.Lava {
		lava = "1"
	}
	g := &formats.TDFWriteSection{Name: "GlobalHeader"}
	g.Set("missionname", req.Name).
		Set("missiondescription", req.Description).
		Set("planet", world.Planet).
		Set("missionhint", "").
		Set("brief", "").
		Set("narration", "").
		Set("glamour", "").
		Set("lineofsight", "0").
		Set("mapping", "0").
		Set("tidalstrength", strconv.Itoa(c.Tidal)).
		Set("solarstrength", strconv.Itoa(c.Solar)).
		Set("lavaworld", lava).
		Set("killmul", "50").
		Set("timemul", "0").
		Set("minwindspeed", strconv.Itoa(c.MinWind)).
		Set("maxwindspeed", strconv.Itoa(c.MaxWind)).
		Set("gravity", strconv.Itoa(c.Gravity)).
		Set("numplayers", strconv.Itoa(len(starts))).
		Set("size", fmt.Sprintf("%d x %d", req.UnitsX, req.UnitsY)).
		Set("memory", "32 mb").
		Set("SCHEMACOUNT", "1")
	s := g.Add("Schema 0")
	s.Set("Type", "Network 1").
		Set("aiprofile", "").
		Set("SurfaceMetal", strconv.Itoa(c.SurfaceMetal)).
		Set("MohoMetal", strconv.Itoa(c.MohoMetal)).
		Set("HumanMetal", "1000").
		Set("ComputerMetal", "1000").
		Set("HumanEnergy", "1000").
		Set("ComputerEnergy", "1000").
		Set("MeteorWeapon", "").
		Set("MeteorRadius", "0").
		Set("MeteorDensity", "0").
		Set("MeteorDuration", "0").
		Set("MeteorInterval", "0")
	specials := s.Add("specials")
	for i, st := range starts {
		specials.Add("special"+strconv.Itoa(i)).
			Set("specialwhat", "StartPos"+strconv.Itoa(i+1)).
			Set("XPos", strconv.Itoa(st.X)).
			Set("ZPos", strconv.Itoa(st.Z))
	}
	return formats.EncodeTDF(g)
}

func checkArchive(filename string, req exportRequest, world worldInfo, starts []start, want formats.TNTWrite, otaBytes, tntBytes []byte) (selfCheck, error) {
	var checked selfCheck
	f, err := os.Open(filename)
	if err != nil {
		return checked, err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return checked, err
	}
	fs := vfs.New()
	defer fs.Close()
	// MountArchiveReader calls vfs.NewArchive and exposes its entries through
	// ordinary VFS reads; check the actual staged file before publishing it.
	if _, err := fs.MountArchiveReader(filename, f, stat.Size(), 10, vfs.ArchiveOptions{}); err != nil {
		return checked, err
	}
	entries, err := fs.ReadDir("maps")
	if err != nil {
		return checked, err
	}
	otaPath, tntPath := "maps/"+req.Name+".ota", "maps/"+req.Name+".tnt"
	if len(entries) != 2 || entries[0].IsDir || entries[1].IsDir || !strings.EqualFold(entries[0].Path, otaPath) || !strings.EqualFold(entries[1].Path, tntPath) {
		return checked, fmt.Errorf("archive does not list exactly %s and %s", otaPath, tntPath)
	}
	otaData, err := fs.ReadFile(otaPath)
	if err != nil {
		return checked, err
	}
	tntData, err := fs.ReadFile(tntPath)
	if err != nil {
		return checked, err
	}
	if !bytes.Equal(otaBytes, otaData) || !bytes.Equal(tntBytes, tntData) {
		return checked, fmt.Errorf("archive file reads differ from encoded OTA or TNT")
	}
	checked.Archive = true
	tnt, err := formats.LoadTNT(tntData)
	if err != nil {
		return checked, err
	}
	if tnt.Version != uint32(formats.VersionCanonical) || int(tnt.Width) != want.Width || int(tnt.Height) != want.Height || tnt.SeaLevel != uint32(want.SeaLevel) || len(tnt.FeatureTable) != 0 {
		return checked, fmt.Errorf("decoded TNT header differs")
	}
	if !slices.Equal(tnt.TileIndices, want.TileIndices) || !bytes.Equal(tnt.TileGraphics, want.TileGraphics) {
		return checked, fmt.Errorf("decoded TNT tile map or tile graphics differ")
	}
	if len(tnt.Attributes) != len(want.Heights) {
		return checked, fmt.Errorf("decoded TNT cell count differs")
	}
	for i, a := range tnt.Attributes {
		if a.Height != want.Heights[i] || a.Feature != want.Features[i] || a.Unknown != 0 || a.Metal != 0 {
			return checked, fmt.Errorf("decoded TNT cell (%d,%d) differs", i%want.Width, i/want.Width)
		}
	}
	if int(tnt.MinimapWidth) != want.MinimapWidth || int(tnt.MinimapHeight) != want.MinimapHeight || !bytes.Equal(tnt.Minimap, want.Minimap) {
		return checked, fmt.Errorf("decoded TNT minimap differs")
	}
	checked.TNT = true
	ota, err := formats.LoadOTA(otaData)
	if err != nil {
		return checked, err
	}
	planet, _ := ota.Global.StringValue("planet", "")
	if ota.MissionName != req.Name || ota.MissionDescription != strings.TrimSpace(req.Description) || planet != world.Planet || otaClimate(ota) != *world.Climate || ota.NumPlayers != strconv.Itoa(len(starts)) || ota.Size != fmt.Sprintf("%d x %d", req.UnitsX, req.UnitsY) || len(ota.Schemas) != 1 || ota.Schemas[0].Type != "Network 1" {
		return checked, fmt.Errorf("decoded OTA metadata, climate or schema differs")
	}
	specials := ota.Schemas[0].Section.Section("specials")
	if specials == nil || len(specials.Sections()) != len(starts) {
		return checked, fmt.Errorf("decoded OTA start count differs")
	}
	for i, st := range starts {
		special := specials.Section("special" + strconv.Itoa(i))
		if special == nil {
			return checked, fmt.Errorf("decoded OTA start %d is absent", i+1)
		}
		what, _ := special.StringValue("specialwhat", "")
		if what != "StartPos"+strconv.Itoa(i+1) || int(special.IntValue("xpos", -1)) != st.X || int(special.IntValue("zpos", -1)) != st.Z {
			return checked, fmt.Errorf("decoded OTA start %d differs", i+1)
		}
	}
	checked.OTA = true
	return checked, nil
}
