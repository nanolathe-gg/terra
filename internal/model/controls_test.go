package model

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestControlRulesMatchReference(t *testing.T) {
	b, e := os.ReadFile("testdata/control-parity.json")
	if e != nil {
		t.Fatal(e)
	}
	var data struct {
		Scenarios []map[string]any
		Worlds    []struct {
			Key  string
			I    int
			Want string
		}
		Shapes []struct {
			Key, Kind string
			I         int
			Want      bool
		}
	}
	if e = json.Unmarshal(b, &data); e != nil {
		t.Fatal(e)
	}
	for _, c := range data.Worlds {
		if got := WorldControlRequirement(c.Key, data.Scenarios[c.I]); got != c.Want {
			t.Errorf("world %s scenario %d: got %q want %q", c.Key, c.I, got, c.Want)
		}
	}
	for _, c := range data.Shapes {
		p := map[string]any{}
		for k, v := range data.Scenarios[c.I] {
			p[k] = v
		}
		p["world"] = data.Scenarios[c.I]
		if got := ShapeControlAvailable(c.Key, c.Kind, p); got != c.Want {
			t.Errorf("shape %s/%s scenario %d: got %v want %v", c.Key, c.Kind, c.I, got, c.Want)
		}
	}
}
func TestControlDependenciesExplainUnavailableSettings(t *testing.T) {
	tests := []struct {
		key      string
		v        map[string]any
		contains string
	}{{"shineRockSharp", map[string]any{"shineRock": 0.0}, "Gloss in Shine: rock"}, {"shineSandScale", map[string]any{"shineSandRough": 0.0}, "Roughness in Shine: sand"}, {"ringShiftDir", map[string]any{"ringLayer": 1.0}, "Offset between copies"}, {"shoalBumpPx", map[string]any{"bedLit": 1.0, "deepEdge": 1.0, "shoalBump": 2.0, "waterColored": 1.0}, "Colors"}, {"shelfWander", map[string]any{"waterTones": 1.0, "deepEdge": 1.0}, "one color"}, {"bedSpacing", map[string]any{"rockOrder": 1.0, "column": 1.0, "bedLedge": 1.0}, "authored bed profile"}}
	for _, c := range tests {
		got := WorldControlRequirement(c.key, c.v)
		if !strings.Contains(got, c.contains) {
			t.Errorf("%s: %q missing %q", c.key, got, c.contains)
		}
	}
}
