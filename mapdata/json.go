// Package mapdata reads the editor tools' local interchange files.
package mapdata

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
)

// ReadJSON bounds local interchange files independently of retail formats.
func ReadJSON(name string, dst any) error { return ReadJSONLimit(name, dst, 16<<20) }

// ReadJSONLimit reads one JSON object of at most limit bytes (a map's feature pack, with every burn frame, runs to tens of MB).
func ReadJSONLimit(name string, dst any, limit int64) error {
	f, err := os.Open(name)
	if err != nil {
		return err
	}
	defer f.Close()
	d := json.NewDecoder(io.LimitReader(f, limit))
	if err := d.Decode(dst); err != nil {
		return fmt.Errorf("read %s: %w", name, err)
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return fmt.Errorf("read %s: expected one JSON object", name)
	}
	return nil
}
