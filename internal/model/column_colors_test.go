package model

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestColumnColorsRespectPaletteUntilEdited(t *testing.T) {
	defaults := map[string]any{"colors": []any{[]any{128., 64., 32.}}, "bands": []any{3.7, .5}}
	var column map[string]any
	data, _ := json.Marshal(defaults)
	if err := json.Unmarshal(data, &column); err != nil {
		t.Fatal(err)
	}
	if got := ColumnColorOverrides(column, defaults); len(got) != 0 {
		t.Fatalf("unchanged column overrides palette: %v", got)
	}
	column["colors"].([]any)[0] = []any{255., 0., 128.}
	want := map[string]any{"strata1": []float64{1, 0, 128. / 255}}
	if got := ColumnColorOverrides(column, defaults); !reflect.DeepEqual(got, want) {
		t.Fatalf("edited column colors = %v, want %v", got, want)
	}
	if got := ColumnColorOverrides(nil, defaults); len(got) != 0 {
		t.Fatal(got)
	}
}
