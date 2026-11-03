package model

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

func controlNum(v map[string]any, k string, def float64) float64 {
	x, ok := v[k]
	if !ok || x == nil {
		return def
	}
	switch t := x.(type) {
	case float64:
		return t
	case float32:
		return float64(t)
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case bool:
		if t {
			return 1
		}
		return 0
	case string:
		if t == "" {
			return 0
		}
		n, e := strconv.ParseFloat(t, 64)
		if e == nil {
			return n
		}
	}
	return math.NaN()
}
func inControl(k string, values ...string) bool {
	for _, v := range values {
		if k == v {
			return true
		}
	}
	return false
}
func shapeObject(v map[string]any, k string) map[string]any {
	if m, ok := v[k].(map[string]any); ok {
		return m
	}
	return map[string]any{}
}
func ShapeControlAvailable(key, kind string, p map[string]any) bool {
	n := func(k string) float64 { return controlNum(p, k, 0) }
	form := math.Floor(n("crystalForm") + .5)
	plates := n("shorePlates") > 0
	slab := controlNum(p, "plateMaterial", math.NaN()) < 2
	ridge := math.Floor(n("spurCount")+.5) >= 1 || n("crestJag") > 0 || n("crestVary") > 0 || n("crestTaper") > 0
	shared := inControl(kind, "plateau", "offset", "erase", "paint", "sand", "grass") && !(n("facePx") > 0)
	shouldered := IsShouldered(kind, n("lean"), ridge)
	if shouldered && inControl(key, "baseVary", "baseBump", "faceVariation") {
		return false
	}
	if key == "faceVariation" {
		return shared || n("facePx") > 0
	}
	if key == "softness" {
		curve := shapeObject(p, "curve")
		knotsValue, knots := curve["knots"]
		knots = knots && knotsValue != nil
		form, _ := curve["form"].(string)
		if form == "" && kind == "mountain" {
			form = "mountain"
		}
		return shared || shouldered || (!knots && inControl(form, "mountain", "cliff"))
	}
	if key == "moonLobes" && n("baseVary") > 0 {
		return false
	}
	world := shapeObject(p, "world")
	if key == "styleFace" && controlNum(world, "microRock", 1) <= 0 {
		return false
	}
	if key == "waterDeep" && !deepShows(world, inControl(fmt.Sprint(int(math.Floor(n("waterBed")+.5))), "1", "3")) {
		return false
	}
	if key == "styleDeposits" && controlNum(world, "beachLayer", 0) > 0 && !(controlNum(world, "sand", 0) > 0) && !(controlNum(world, "stoneDensity", 0) > 0) {
		return false
	}
	if key == "facing" {
		return kind == "hill" || inControl(kind, "plateau", "offset") && !(n("facePx") > 0) || n("lean") > 0
	}
	if kind == "crystal" {
		if inControl(key, "crystalTiers", "crystalStep", "crystalFacet", "crystalSizeVar", "crystalSmooth") {
			return form == 1
		}
		if inControl(key, "crystalCount", "crystalSides", "crystalVariation") {
			return form != 1
		}
		if inControl(key, "crystalTop", "crystalLean") {
			return form == 0
		}
		if inControl(key, "crystalAlign", "bergFace", "bergJitter", "bergBreak", "bergRough", "bergTilt", "bergFlat", "bergTiltDir") {
			return form == 2 && (!inControl(key, "bergFlat", "bergTiltDir") || n("bergTilt") > 0)
		}
	}
	if inControl(key, "plateWaterPx", "plateLandPx", "plateSize", "plateGap", "plateHeight", "plateMaterial", "frostNeedles", "crystalShoreSeam", "plateVary") {
		if !plates {
			return false
		}
		if key == "frostNeedles" {
			return !slab
		}
		if inControl(key, "crystalShoreSeam", "plateVary") {
			return slab
		}
		return true
	}
	if inControl(key, "crystalCraterPx", "crystalCraterStep", "crystalCraterSkin") {
		return n("craterFacets") > 0
	}
	if key == "iceFacetSize" {
		return kind == "mountain" && n("iceFacets") > 0
	}
	if inControl(key, "ledge", "terraceJitter") {
		return n("terraces") > 0
	}
	if key == "lavaSpread" {
		return n("shoreLayers") > 0 && n("layerStyle") < .5
	}
	if inControl(key, "layerCircle", "lavaCircleVary") {
		return n("shoreLayers") > 0 && n("layerStyle") >= .5
	}
	return true
}

const hardStep = "Hard shallow-to-deep step, or a water stroke's Hard edge"
const litBed = "Lit bed under shallow water, or a water stroke's Lit bed"
const litReplaced = "A Shallow water or Deep water color replaces the lit bed: clear it in Colors to use this setting."
const crackedBed = "Give a water stroke the Cracked bed look (Shallow water look) to use this setting."
const rampIdle = "The ramp is drawn only where the step is off: choose Ramp in Hard shallow-to-deep step, or give a water stroke a Faded edge, to use this setting."

func deepShows(v map[string]any, litStroke bool) bool {
	return controlNum(v, "waterTones", 2) == 2 || controlNum(v, "bedLit", 0) > 0 || litStroke || controlNum(v, "crystalShallow", 0) > 0
}
func deepIdle(v map[string]any) string {
	kind := "one color"
	if controlNum(v, "waterTones", 0) == 3 {
		kind = "a third color that follows the depth"
	}
	return "This world's water has " + kind + ", so the shallow-to-deep step shows only where a lit bed or crystal shallows draw it. Enable Lit bed under shallow water, or give a water stroke a Lit bed, to use this setting."
}

var shineLobe = regexp.MustCompile(`^shine(Ground|Slope|Rock|Sand|Crystal)(Sharp|Scale)$`)

func WorldControlRequirement(key string, v map[string]any) string {
	n := func(k string) float64 { return controlNum(v, k, 0) }
	needs := func(parent, label string) string {
		if r := WorldControlRequirement(parent, v); r != "" {
			return r
		}
		if n(parent) <= 0 {
			return "Enable " + label + " to use this setting."
		}
		return ""
	}
	if inControl(key, "undulationScale", "undulationCover") {
		return needs("undulation", "Undulation height")
	}
	if (inControl(key, "bedHeight", "bedVary", "bedPunch") || key == "bedSpacing" && n("cliffRise") <= 0) && n("column") > 0 {
		return "The authored bed profile supplies this value. Random bed controls do not apply."
	}
	if inControl(key, "strata", "strataContrast", "strataGrain") && n("column") <= 0 {
		return "This world has no rock column."
	}
	if key == "bedDipDir" {
		if r := WorldControlRequirement("bedDip", v); r != "" {
			return r
		}
		if n("bedDip") == 0 {
			return "Set Bed tilt above or below zero to choose its direction."
		}
		return ""
	}
	if inControl(key, "bedSpacing", "bedHeight", "bedVary", "bedDip", "bedDipDir", "bedLedge", "jointDepth", "grooveSpacing", "grooveAngle", "grooveRun", "bedPunch", "gullyDepth", "gullyWidth", "gullyShade", "ribTilt", "facetTilt", "facetCoarse") && n("rockOrder") <= 0 {
		return "Enable ordered Rock structure to use this setting."
	}
	if inControl(key, "grooveSpacing", "grooveAngle") {
		if n("jointDepth") > 0 || n("gullyDepth") > 0 || n("ribTilt") > 0 {
			return ""
		}
		return "Set Joint depth, Gully depth or Rib tilt above zero to use this setting."
	}
	if key == "grooveRun" {
		if n("jointDepth") > 0 || n("gullyDepth") > 0 {
			return ""
		}
		return "Set Joint depth or Gully depth above zero to use this setting."
	}
	if key == "cliffStagger" {
		if n("rockOrder") <= 0 {
			return "Enable ordered Rock structure to use this setting."
		}
		if n("cliffFollow") <= 0 {
			return "Choose Follow terrain in Structure orientation to use this setting."
		}
		return needs("jointDepth", "Joint depth")
	}
	if key == "sandBandSpacing" {
		return needs("sandBanding", "Streaks on sand and ramps")
	}
	if key == "bedDotCell" {
		return needs("bedDots", "Bed speckles")
	}
	if key == "pockSize" {
		return needs("pockmark", "Surface pits")
	}
	if strings.HasPrefix(key, "moonCup") && key != "moonCups" {
		return needs("moonCups", "Slope cups")
	}
	if strings.HasPrefix(key, "moonRib") && key != "moonRibs" {
		return needs("moonRibs", "Slope ribs")
	}
	if key == "moonFoldSpacing" {
		return needs("moonFolds", "Contour folds")
	}
	if inControl(key, "lavaPillow", "lavaChip", "lavaVeins", "lavaCalm") {
		return needs("lavaCrust", "Pillow crust strength")
	}
	if inControl(key, "frostGapReach", "frostGapSize", "frostGapDepth") {
		return needs("frostGaps", "Shore pockets")
	}
	if inControl(key, "gullyWidth", "gullyShade") {
		return needs("gullyDepth", "Gully depth")
	}
	if inControl(key, "rockFrom", "cliffFollow", "cliffReach", "cliffWide", "cliffFlat", "cliffRise", "cliffBed", "cliffStagger", "cliffFine", "cliffDomain") && n("rockOrder") <= 0 {
		return "Enable ordered Rock structure to use this setting."
	}
	if inControl(key, "cliffReach", "cliffWide", "cliffFlat", "cliffBed", "cliffFine", "cliffDomain") && n("cliffFollow") <= 0 {
		return "Choose Follow terrain in Structure orientation to use this setting."
	}
	if inControl(key, "facetCoarse", "cliffFine") {
		return needs("facetTilt", "Facet tilt")
	}
	bedsJoints := n("jointDepth") > 0 && n("cliffFollow") > 0 && n("cliffStagger") > 0 && inControl(key, "bedSpacing", "bedHeight", "bedVary", "bedDip", "cliffBed")
	bedsBlocks := n("blocks") > 0 && key == "cliffBed"
	if inControl(key, "bedSpacing", "bedHeight", "bedVary", "bedDip", "bedPunch", "cliffRise", "cliffBed") && n("bedLedge") <= 0 && !bedsJoints && !bedsBlocks {
		return "Set Ledge above zero in Rock structure to give the beds relief."
	}
	if inControl(key, "strataContrast", "strataGrain") {
		return needs("strata", "Strength (painted beds) in Strata")
	}
	if inControl(key, "baseBand", "desertCapFlat") {
		if n("column") <= 0 {
			return "This world has no rock column."
		}
		if r := needs("strata", "Strength (painted beds) in Strata"); r != "" {
			return r
		}
		if key == "desertCapFlat" && n("capBed") <= 0 {
			return "The rock column has no cap bed: a section of two beds where one fills over 88 percent of the cycle. Edit the column to add one."
		}
		return ""
	}
	if inControl(key, "baseBandLow", "baseBandHigh", "baseBandWander", "baseBandGaps") {
		return needs("baseBand", "Gray band strength")
	}
	noSlope := n("slopeTexture") <= 0 && n("slopeSand") <= 0 && controlNum(v, "microRock", 1) <= 0
	if noSlope && (key == "shineSlope" || key == "shineSlopeSharp" || key == "shineSlopeScale" || key == "shineSlopeRough") {
		return "This world's faces are one material and Sampled slope texture is 0, so the slope cover has no share to shine. Raise Sampled slope texture to use this setting."
	}
	shiny, rough := false, false
	for _, m := range []string{"Ground", "Slope", "Rock", "Sand", "Crystal"} {
		if m == "Slope" && noSlope {
			continue
		}
		shiny = shiny || n("shine"+m) > 0
		rough = rough || n("shine"+m+"Rough") > 0
	}
	if lobe := shineLobe.FindStringSubmatch(key); lobe != nil {
		suffix, label := "Rough", "Roughness"
		if lobe[2] == "Sharp" {
			suffix, label = "", "Gloss"
		}
		name := map[string]string{"Ground": "ground", "Slope": "slope cover", "Rock": "rock", "Sand": "sand", "Crystal": "crystal"}[lobe[1]]
		return needs("shine"+lobe[1]+suffix, label+" in Shine: "+name)
	}
	if inControl(key, "shineWhite", "shineHeadroom") {
		if shiny {
			return ""
		}
		return "Set a Gloss above zero in one of the Shine groups to use this setting."
	}
	if key == "shineStretch" {
		if rough {
			return ""
		}
		return "Set a Roughness above zero in one of the Shine groups to use this setting."
	}
	if inControl(key, "shineGate", "shineOutside", "shineSlopeGate") {
		if shiny || rough {
			return ""
		}
		return "Set a Gloss or Roughness above zero in one of the Shine groups to use this setting."
	}
	if inControl(key, "faceEdge", "gullyRock", "iceSlate") && controlNum(v, "microRock", 1) <= 0 {
		return "This world's faces are one material, not rock and moss interleaved, so there is nothing for this setting to place."
	}
	if inControl(key, "wind", "ripple", "rippleHeight", "sandDust", "sandGrain", "sandGrass", "sandLight") && n("beachLayer") > 0 {
		return needs("sand", "Weathering supply in Sand")
	}
	if key == "slopeTexture" && n("slopeSand") > 0 {
		return "The slopes of this world are sand, which has no texture to scale."
	}
	if key == "slopeTexture" && n("slopeReplaced") > 0 && !shiny && !rough {
		return "The sediment transition replaces the slope color at 100 percent Material weathering, so this scales only the slope's gloss. Lower Material weathering, or set a Gloss or Roughness above zero in one of the Shine groups, to use this setting."
	}
	if inControl(key, "dither", "landDither") && n("paletteMix") > 0 {
		return "Choose Nearest color in the Palette to use this setting."
	}
	if inControl(key, "bedTint", "bedBright", "bedContrast", "bedFlat", "bedDots", "shoalGrain") {
		if n("waterColored") > 0 {
			return litReplaced
		}
		return needs("bedLit", litBed)
	}
	if key == "bedLit" && n("waterColored") > 0 {
		if n("deepEdge") > 0 && n("paletteMix") <= 0 && n("dither") > 0 {
			return ""
		}
		return litReplaced
	}
	if key == "deepEdge" {
		if deepShows(v, false) {
			return ""
		}
		return deepIdle(v)
	}
	if inControl(key, "shallowDepth", "deepDepth") {
		if n("waterTones") == 3 || deepShows(v, false) {
			return ""
		}
		return deepIdle(v)
	}
	if inControl(key, "waterSoft", "bandWater") {
		if n("waterTones") == 3 {
			return ""
		}
		if !deepShows(v, false) {
			return deepIdle(v)
		}
		if n("rampWater") > 0 {
			return ""
		}
		return rampIdle
	}
	if inControl(key, "stepSoftPx", "shelfWander", "shoalRag") {
		return needs("deepEdge", hardStep)
	}
	if key == "crackedStep" {
		if r := needs("deepEdge", hardStep); r != "" {
			return r
		}
		if n("crackedBed") > 0 {
			return ""
		}
		return crackedBed
	}
	if key == "shoalBump" {
		if n("waterColored") > 0 {
			return litReplaced
		}
		if r := needs("bedLit", litBed); r != "" {
			return r
		}
		return needs("deepEdge", hardStep)
	}
	if key == "shoalBumpPx" {
		return needs("shoalBump", "Lit bumps in the bed")
	}
	if len(key) > 4 && strings.HasPrefix(key, "ring") && key[4] >= 'A' && key[4] <= 'Z' && n("ringLayer") <= 0 {
		return "This world draws no mineral fringe."
	}
	if key == "beachWidth" && n("beachLayer") <= 0 {
		return "This world has no beach layer."
	}
	if key == "groundTiles" && n("groundTiled") <= 0 {
		return "This world's ground is one texture, not tiles. Choose another world's Ground pattern to use this setting."
	}
	if inControl(key, "ringShiftDir", "ringScatter") {
		return needs("ringShift", "Offset between copies")
	}
	if key == "ringPatchSize" {
		return needs("ringPatch", "Reach variation")
	}
	return ""
}
