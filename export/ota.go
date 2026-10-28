package main

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/nanolathe-gg/nanolathe/formats"
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

func checkOTA(otaData []byte, req exportRequest, world worldInfo, starts []start) error {
	ota, err := formats.LoadOTA(otaData)
	if err != nil {
		return err
	}
	planet, _ := ota.Global.StringValue("planet", "")
	if ota.MissionName != req.Name || ota.MissionDescription != strings.TrimSpace(req.Description) || planet != world.Planet || otaClimate(ota) != *world.Climate || ota.NumPlayers != strconv.Itoa(len(starts)) || ota.Size != fmt.Sprintf("%d x %d", req.UnitsX, req.UnitsY) || len(ota.Schemas) != 1 || ota.Schemas[0].Type != "Network 1" {
		return fmt.Errorf("decoded OTA metadata, climate or schema differs")
	}
	specials := ota.Schemas[0].Section.Section("specials")
	if specials == nil || len(specials.Sections()) != len(starts) {
		return fmt.Errorf("decoded OTA start count differs")
	}
	for i, st := range starts {
		special := specials.Section("special" + strconv.Itoa(i))
		if special == nil {
			return fmt.Errorf("decoded OTA start %d is absent", i+1)
		}
		what, _ := special.StringValue("specialwhat", "")
		if what != "StartPos"+strconv.Itoa(i+1) || int(special.IntValue("xpos", -1)) != st.X || int(special.IntValue("zpos", -1)) != st.Z {
			return fmt.Errorf("decoded OTA start %d differs", i+1)
		}
	}
	return nil
}
