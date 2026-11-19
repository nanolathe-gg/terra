package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"slices"
	"strings"

	"github.com/nanolathe-gg/nanolathe/formats"
	"github.com/nanolathe-gg/nanolathe/vfs"
)

type climate struct {
	MinWind      int  `json:"minWind"`
	MaxWind      int  `json:"maxWind"`
	Tidal        int  `json:"tidal"`
	Solar        int  `json:"solar"`
	Gravity      int  `json:"gravity"`
	SurfaceMetal int  `json:"surfaceMetal"`
	MohoMetal    int  `json:"mohoMetal"`
	Lava         bool `json:"lava"`
}

type worldInfo struct {
	Planet          string   `json:"planet,omitempty"`
	DefaultSeaLevel *int     `json:"defaultSeaLevel,omitempty"`
	Climate         *climate `json:"climate,omitempty"`
	Sources         []string `json:"sources"`
	DisabledReason  string   `json:"disabledReason,omitempty"`
}

type catalog struct {
	Worlds         map[string]worldInfo `json:"worlds"`
	Palette        [256][3]byte         `json:"palette"`
	InstalledNames []string             `json:"installedNames"`
}

// Only these map basenames are recorded here, from repro/scenes/*-1..3.json.
// Planet names, climate and sea defaults come from mounted OTA/TNT pairs,
// never from an editor world ID. Keep this small list in step with those scenes.
var worldExamples = []struct {
	ID   string
	Maps []string
}{
	{"green", []string{"pc games' evad river delta", "great divide", "the barrier reef"}},
	{"red", []string{"red planet", "red river", "gods of war"}},
	{"archipelago", []string{"hundred isles", "canal crossing", "east indeez"}},
	{"moon", []string{"cc21", "full moon", "ac20"}},
	{"lava", []string{"kill the middle", "red hot lava", "lava & two hills"}},
	{"desert", []string{"painted desert", "the desert triad"}},
	{"crystal", []string{"crystal cracked", "crystal isles", "brilliant cut lake"}},
	{"ice", []string{"ice scream", "icy bergs", "polar range"}},
	{"lush", []string{"luschaven", "the bayou", "crossing two rivers"}},
}

type catalogMap struct {
	OTA     string
	TNT     string
	Planet  string
	Climate climate
}

func readCatalog(fs vfs.FSOps) (catalog, error) {
	result := catalog{Worlds: make(map[string]worldInfo), InstalledNames: []string{}}
	pal, err := readPalette(fs)
	if err != nil {
		return result, fmt.Errorf("read terrain palette: %w", err)
	}
	result.Palette = pal
	entries, err := fs.ReadDir("maps")
	if err != nil {
		return result, err
	}
	installed := make(map[string]bool)
	mapsByName := make(map[string]catalogMap)
	var maps []catalogMap
	for _, entry := range entries {
		if entry.IsDir {
			continue
		}
		ext := strings.ToLower(path.Ext(entry.Path))
		if ext != ".ota" && ext != ".tnt" {
			continue
		}
		base := strings.TrimSuffix(path.Base(entry.Path), path.Ext(entry.Path))
		if !installed[strings.ToLower(base)] {
			original := entry.OriginalPath
			if original == "" {
				original = entry.Path
			}
			name := strings.TrimSuffix(path.Base(strings.ReplaceAll(original, `\`, "/")), path.Ext(original))
			result.InstalledNames = append(result.InstalledNames, name)
			installed[strings.ToLower(base)] = true
		}
		if ext != ".ota" {
			continue
		}
		tntPath := strings.TrimSuffix(entry.Path, path.Ext(entry.Path)) + ".tnt"
		if _, err := fs.Stat(tntPath); err != nil {
			if errors.Is(err, vfs.ErrNotFound) || errors.Is(err, os.ErrNotExist) {
				continue
			}
			return result, err
		}
		ota, err := formats.LoadOTAFile(fs, entry.Path)
		if errors.Is(err, formats.ErrMissingOTAHeader) {
			continue
		}
		if err != nil {
			return result, fmt.Errorf("read %s for world climate: %w", entry.Path, err)
		}
		planet, _ := ota.Global.StringValue("planet", "")
		m := catalogMap{OTA: entry.Path, TNT: tntPath, Planet: strings.TrimSpace(planet), Climate: otaClimate(ota)}
		maps = append(maps, m)
		mapsByName[strings.ToLower(base)] = m
	}
	slices.SortFunc(result.InstalledNames, func(a, b string) int { return strings.Compare(strings.ToLower(a), strings.ToLower(b)) })
	for _, example := range worldExamples {
		world := worldInfo{Sources: []string{}}
		for _, name := range example.Maps {
			m, ok := mapsByName[name]
			if !ok {
				continue
			}
			if m.Planet == "" {
				world.DisabledReason = fmt.Sprintf("its example map %s names no planet, so the game has none to use", m.OTA)
				break
			}
			if world.Planet != "" && !strings.EqualFold(world.Planet, m.Planet) {
				world.DisabledReason = fmt.Sprintf("its example maps name different planets (%s and %s)", world.Planet, m.Planet)
				break
			}
			if world.Planet == "" {
				world.Planet = m.Planet
			}
		}
		if world.DisabledReason == "" && world.Planet == "" {
			world.DisabledReason = "none of its example maps is installed, so its planet is unknown"
		}
		if world.DisabledReason == "" {
			var climates []climate
			var seaLevels []int
			for _, m := range maps {
				if strings.EqualFold(world.Planet, m.Planet) {
					seaLevel, err := readSeaLevel(fs, m.TNT)
					if err != nil {
						return result, fmt.Errorf("read %s for world sea level: %w", m.TNT, err)
					}
					seaLevels = append(seaLevels, seaLevel)
					world.Sources = append(world.Sources, m.OTA)
					climates = append(climates, m.Climate)
				}
			}
			// Use the same upper median as the climate defaults.
			slices.Sort(seaLevels)
			seaLevel := seaLevels[len(seaLevels)/2]
			world.DefaultSeaLevel = &seaLevel
			c := medianClimate(climates)
			world.Climate = &c
		}
		result.Worlds[example.ID] = world
	}
	result.Worlds["zhon"] = worldInfo{Sources: []string{}, DisabledReason: "no game map uses Zhon yet, so it has no planet or climate for the game to use. Its maps still save and open in the editor."}
	return result, nil
}

// Only the fixed header is needed for a new map's default [fmt tnt]
// "Header (0x40 bytes)". Both supported versions put SeaLevel in this word;
// avoid allocating and decoding terrain cells, tiles and features here.
func readSeaLevel(fs vfs.FSOps, name string) (int, error) {
	f, err := fs.Open(name)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	var header [0x40]byte
	if _, err := io.ReadFull(f, header[:]); err != nil {
		return 0, err
	}
	version := formats.Version(binary.LittleEndian.Uint32(header[:4]))
	if version != formats.VersionCanonical && version != formats.VersionLegacy {
		return 0, fmt.Errorf("unsupported TNT version 0x%04x", version)
	}
	return int(binary.LittleEndian.Uint32(header[0x24:0x28])), nil
}

func readPalette(fs vfs.FSOps) ([256][3]byte, error) {
	var out [256][3]byte
	data, err := fs.ReadFileLimit("palettes/palette.pal", 1<<20)
	var pal *formats.Palette
	if errors.Is(err, vfs.ErrNotFound) || errors.Is(err, os.ErrNotExist) || err == nil && len(data) == 0 {
		// Match Nanolathe's in-memory PCX fallback [fmt pal]; do not write
		// recovered palettes or derived tables into the content root.
		pcx, pcxErr := formats.LoadPCXFile(fs, "palettes/palette.pcx")
		if pcxErr != nil {
			return out, pcxErr
		}
		pal = &formats.Palette{Colors: pcx.Palette}
	} else {
		if err != nil {
			return out, err
		}
		pal, err = formats.LoadPAL(data)
		if err != nil {
			return out, err
		}
	}
	for i, c := range pal.Colors {
		out[i] = [3]byte{c.R, c.G, c.B}
	}
	return out, nil
}

func otaClimate(ota *formats.OTA) climate {
	g := ota.Global
	c := climate{
		MinWind: int(g.IntValue("minwindspeed", 0)), MaxWind: int(g.IntValue("maxwindspeed", 0)),
		Tidal: int(g.FloatValue("tidalstrength", 0)), Solar: int(g.IntValue("solarstrength", 0)),
		Gravity: int(g.IntValue("gravity", 0)), Lava: g.IntValue("lavaworld", 0) > 0,
	}
	if len(ota.Schemas) > 0 {
		s := ota.Schemas[0].Section
		c.SurfaceMetal, c.MohoMetal = int(s.IntValue("surfacemetal", 0)), int(s.IntValue("mohometal", 0))
	}
	return c
}

// The generator takes the upper middle value for an even-size sample, and
// requires a strict majority for lava (cmd/nanolathe/mapgen_world.go).
func medianClimate(samples []climate) climate {
	median := func(value func(climate) int) int {
		v := make([]int, len(samples))
		for i, c := range samples {
			v[i] = value(c)
		}
		slices.Sort(v)
		return v[len(v)/2]
	}
	lavaMaps := 0
	for _, c := range samples {
		if c.Lava {
			lavaMaps++
		}
	}
	return climate{
		MinWind: median(func(c climate) int { return c.MinWind }), MaxWind: median(func(c climate) int { return c.MaxWind }),
		Tidal: median(func(c climate) int { return c.Tidal }), Solar: median(func(c climate) int { return c.Solar }),
		Gravity:      median(func(c climate) int { return c.Gravity }),
		SurfaceMetal: median(func(c climate) int { return c.SurfaceMetal }), MohoMetal: median(func(c climate) int { return c.MohoMetal }),
		Lava: 2*lavaMaps > len(samples),
	}
}
