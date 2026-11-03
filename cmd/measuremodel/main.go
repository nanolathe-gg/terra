// Command measuremodel exposes the editor's numeric models to offline measurements.
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/nanolathe-gg/terraform/internal/model"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: measuremodel material|curves")
		os.Exit(2)
	}
	enc := json.NewEncoder(os.Stdout)
	switch os.Args[1] {
	case "material":
		var raw map[string]json.RawMessage
		if err := json.NewDecoder(os.Stdin).Decode(&raw); err != nil {
			panic(err)
		}
		delete(raw, "placement") // placement is unrelated to generated material swatches
		b, err := json.Marshal(raw)
		if err != nil {
			panic(err)
		}
		var table model.MaterialTable
		if err = json.Unmarshal(b, &table); err != nil {
			panic(err)
		}
		if err := enc.Encode(map[string]any{"rows": model.MaterialRows(table), "rowsPerLayer": model.MaterialRowsPerLayer}); err != nil {
			panic(err)
		}
	case "curves":
		curves := map[string][]float64{}
		for _, form := range []string{"hill", "mountain", "plateau", "mesa", "cliff", "terrace"} {
			knots, _ := model.FormKnots(form, .5)
			f := model.KnotCurve(knots)
			samples := make([]float64, 65537)
			for i := range samples {
				samples[i] = f(float64(i) / 65536)
			}
			curves[form] = samples
		}
		if err := enc.Encode(curves); err != nil {
			panic(err)
		}
	default:
		fmt.Fprintln(os.Stderr, "unknown measurement model")
		os.Exit(2)
	}
}
