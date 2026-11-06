package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/nanolathe-gg/nanolathe/vfs"
)

func (s *terrainStream) minimap() []byte {
	out := make([]byte, 252*252)
	for i := range out {
		v := s.mini[i]
		if v[3] == 0 {
			out[i] = 0x64
			continue
		}
		out[i], _ = s.quantize.index(byte((v[0]+v[3]/2)/v[3]), byte((v[1]+v[3]/2)/v[3]), byte((v[2]+v[3]/2)/v[3]))
	}
	return out
}

func (s *terrainStream) finish() (*exportResult, error) {
	if err := s.ctx.Err(); err != nil {
		return nil, err
	}
	if s.received != len(s.indices) {
		return nil, fmt.Errorf("received %d of %d tiles; include the engine's outer strips", s.received, len(s.indices))
	}
	// Deduplication is over; its hashes would only crowd the merge's memory.
	s.hashes = nil
	// Past the u16 limit, the least important tiles are replaced by their nearest kept tile first.
	if s.store.count > s.tileLimit {
		summary, err := s.mergeTiles()
		if err != nil {
			return nil, err
		}
		s.merge = summary
	}
	// First appearances in the global tile grid define the final numbering.
	// Browser chunk dimensions and the tile-byte spill budget affect neither
	// the TNT index map nor the order of unique tile graphics.
	remap := make([]int32, s.store.count)
	for i := range remap {
		remap[i] = -1
	}
	for i, old := range s.indices {
		if remap[old] < 0 {
			remap[old] = int32(len(s.order))
			s.order = append(s.order, old)
		}
		s.indices[i] = uint32(remap[old])
	}
	ota, err := encodeOTA(s.req, s.world, s.starts)
	if err != nil {
		return nil, err
	}
	mini := s.minimap()
	if err = os.MkdirAll(s.out, 0o755); err != nil {
		return nil, err
	}
	archiveName, indexedName := s.req.Name+".ufo", s.req.Name+"-indexed.png"
	entries, err := os.ReadDir(s.out)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if strings.EqualFold(entry.Name(), archiveName) || strings.EqualFold(entry.Name(), indexedName) {
			return nil, fmt.Errorf("export %q already exists in %s; choose a new name", entry.Name(), s.out)
		}
	}
	// The HTTP bridge uses export-<id> work directories and records ownership
	// outside exports. These exact stage names can be cleaned after a crash.
	s.stageID = strings.TrimPrefix(filepath.Base(s.work), "export-")
	if decoded, e := hex.DecodeString(s.stageID); e != nil || len(decoded) != 16 {
		var token [16]byte
		if _, err = rand.Read(token[:]); err != nil {
			return nil, err
		}
		s.stageID = hex.EncodeToString(token[:])
	}
	tnt, err := os.CreateTemp(s.work, "nanolathe-map-tnt-*")
	if err != nil {
		return nil, err
	}
	tntName := tnt.Name()
	defer os.Remove(tntName)
	defer tnt.Close()
	writer := bufio.NewWriterSize(tnt, 64<<10)
	if err = s.writeTNT(writer, mini); err == nil {
		err = writer.Flush()
	}
	if err != nil {
		return nil, err
	}
	if err = s.checkTNT(tnt, mini); err != nil {
		return nil, fmt.Errorf("TNT self-check: %w", err)
	}
	archiveTemp, err := s.stage("archive", func(w io.Writer) error { return writeStreamArchive(w, s.req.Name, ota, tnt) })
	if err != nil {
		return nil, err
	}
	defer os.Remove(archiveTemp)
	s.measure(tntName, archiveTemp)
	indexedTemp, err := s.stage("indexed", func(w io.Writer) error {
		picture := newTileImage(s)
		encoder := png.Encoder{CompressionLevel: png.BestSpeed}
		return errors.Join(encoder.Encode(contextWriter{s, w}, picture), picture.err)
	})
	if err != nil {
		return nil, err
	}
	defer os.Remove(indexedTemp)
	s.measure(tntName, archiveTemp, indexedTemp)
	if err = s.checkStreamArchive(archiveTemp, ota, tnt); err != nil {
		return nil, fmt.Errorf("archive self-check: %w", err)
	}
	if err = s.ctx.Err(); err != nil {
		return nil, err
	}
	indexedDest, archiveDest := filepath.Join(s.out, indexedName), filepath.Join(s.out, archiveName)
	if err = os.Link(archiveTemp, archiveDest); err != nil {
		return nil, err
	}
	complete := false
	indexedPublished := false
	defer func() {
		if !complete {
			os.Remove(archiveDest)
			if indexedPublished {
				os.Remove(indexedDest)
			}
		}
	}()
	if err = s.ctx.Err(); err != nil {
		return nil, err
	}
	if err = os.Link(indexedTemp, indexedDest); err != nil {
		return nil, err
	}
	indexedPublished = true
	if err = s.ctx.Err(); err != nil {
		return nil, err
	}
	s.measure(tntName, archiveTemp, indexedTemp)
	s.metrics.ExportMilliseconds = time.Since(s.begin).Milliseconds()
	complete = true
	return &exportResult{Name: s.req.Name, Archive: archiveName, Indexed: indexedName, WidthCells: s.width, HeightCells: s.height,
		UniqueTiles: s.store.count, Merge: s.merge, TileSlots: len(s.indices), ExactPixels: s.exact, NearestPixels: s.nearest, FeatureCount: len(s.req.Features), Starts: s.starts,
		SelfCheck: selfCheck{TNT: true, OTA: true, Archive: true}, Metrics: s.metrics}, nil
}

type contextWriter struct {
	s *terrainStream
	w io.Writer
}

func (w contextWriter) Write(p []byte) (int, error) {
	if err := w.s.ctx.Err(); err != nil {
		return 0, err
	}
	return w.w.Write(p)
}

func (s *terrainStream) stage(kind string, write func(io.Writer) error) (string, error) {
	name := filepath.Join(s.out, ".map-export-"+s.stageID+"-"+kind+".tmp")
	f, err := os.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
	}
	err = write(contextWriter{s, f})
	if err == nil {
		err = f.Chmod(0o644)
	}
	if err == nil {
		err = f.Sync()
	}
	err = errors.Join(err, f.Close())
	if err != nil {
		os.Remove(name)
		return "", err
	}
	return name, nil
}

func (s *terrainStream) tntHeader() []byte {
	// Canonical header and section packing match formats.EncodeTNT [fmt tnt].
	mapData := 64
	mapAttr := mapData + 2*len(s.indices)
	tileGfx := mapAttr + 4*len(s.heights)
	tileAnims := tileGfx + len(s.order)*1024
	miniMap := tileAnims + 132*len(s.names)
	words := []uint32{0x2000, uint32(s.width), uint32(s.height), uint32(mapData), uint32(mapAttr), uint32(tileGfx), uint32(len(s.order)), uint32(len(s.names)), uint32(tileAnims), uint32(*s.req.SeaLevel), uint32(miniMap), 1, 0, 0, 0, 0}
	header := make([]byte, 0, 64)
	for _, v := range words {
		header = binary.LittleEndian.AppendUint32(header, v)
	}
	return header
}

func (s *terrainStream) writeTNT(w io.Writer, mini []byte) error {
	if _, err := w.Write(s.tntHeader()); err != nil {
		return err
	}
	var word [4]byte
	for _, index := range s.indices {
		binary.LittleEndian.PutUint16(word[:], uint16(index))
		if _, err := w.Write(word[:2]); err != nil {
			return err
		}
	}
	for i, h := range s.heights {
		word[0], word[3] = h, 0
		binary.LittleEndian.PutUint16(word[1:], s.features[i])
		if _, err := w.Write(word[:]); err != nil {
			return err
		}
	}
	var tile [1024]byte
	for _, original := range s.order {
		if err := s.ctx.Err(); err != nil {
			return err
		}
		if err := s.store.read(original, tile[:]); err != nil {
			return err
		}
		if _, err := w.Write(tile[:]); err != nil {
			return err
		}
	}
	for i, name := range s.names {
		var record [132]byte
		binary.LittleEndian.PutUint32(record[:], uint32(i))
		copy(record[4:], name)
		if _, err := w.Write(record[:]); err != nil {
			return err
		}
	}
	binary.LittleEndian.PutUint32(word[:], 252)
	for i := 0; i < 2; i++ {
		if _, err := w.Write(word[:]); err != nil {
			return err
		}
	}
	_, err := w.Write(mini)
	return err
}

func (s *terrainStream) checkTNT(file *os.File, mini []byte) error {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	r := bufio.NewReaderSize(file, 64<<10)
	header := make([]byte, 64)
	if _, err := io.ReadFull(r, header); err != nil {
		return err
	}
	if !bytes.Equal(header, s.tntHeader()) {
		return fmt.Errorf("decoded canonical header differs")
	}
	var cell [4]byte
	for i, want := range s.indices {
		if _, err := io.ReadFull(r, cell[:2]); err != nil {
			return err
		}
		if int(want) >= len(s.order) || uint32(binary.LittleEndian.Uint16(cell[:])) != want {
			return fmt.Errorf("decoded tile index %d differs", i)
		}
	}
	for i, h := range s.heights {
		if _, err := io.ReadFull(r, cell[:]); err != nil {
			return err
		}
		if cell[0] != h || binary.LittleEndian.Uint16(cell[1:]) != s.features[i] || cell[3] != 0 {
			return fmt.Errorf("decoded attribute at (%d,%d) differs", i%s.width, i/s.width)
		}
	}
	var got, want [1024]byte
	for i, original := range s.order {
		if _, err := io.ReadFull(r, got[:]); err != nil {
			return err
		}
		if err := s.store.read(original, want[:]); err != nil {
			return err
		}
		if !bytes.Equal(got[:], want[:]) {
			return fmt.Errorf("decoded tile %d differs", i)
		}
	}
	for i, name := range s.names {
		var record [132]byte
		if _, err := io.ReadFull(r, record[:]); err != nil {
			return err
		}
		if binary.LittleEndian.Uint32(record[:]) != uint32(i) || string(bytes.TrimRight(record[4:], "\x00")) != name {
			return fmt.Errorf("decoded feature record %d differs", i)
		}
	}
	for i := 0; i < 2; i++ {
		if _, err := io.ReadFull(r, cell[:]); err != nil {
			return err
		}
		if binary.LittleEndian.Uint32(cell[:]) != 252 {
			return fmt.Errorf("decoded minimap dimensions differ")
		}
	}
	decoded := make([]byte, len(mini))
	if _, err := io.ReadFull(r, decoded); err != nil {
		return err
	}
	if !bytes.Equal(decoded, mini) {
		return fmt.Errorf("decoded minimap pixels differ")
	}
	if _, err := r.ReadByte(); err != io.EOF {
		return fmt.Errorf("unexpected bytes after minimap")
	}
	return nil
}

// Public vfs.WriteArchive accepts whole file byte slices. Reuse its canonical
// empty-file directory, patch only the two stored record pointers/sizes, then
// copy the files through a fixed buffer [fmt hpi] "Writing archives".
func writeStreamArchive(w io.Writer, name string, ota []byte, tnt *os.File) error {
	stat, err := tnt.Stat()
	if err != nil {
		return err
	}
	var directory bytes.Buffer
	if err = vfs.WriteArchive(&directory, []vfs.ArchiveFile{{Path: "maps/" + name + ".ota"}, {Path: "maps/" + name + ".tnt"}}, vfs.ArchiveWriteOptions{}); err != nil {
		return err
	}
	data := directory.Bytes()
	le := binary.LittleEndian
	end := int(le.Uint32(data[8:]))
	root := int(le.Uint32(data[16:]))
	rootEntry := int(le.Uint32(data[root+4:]))
	maps := int(le.Uint32(data[rootEntry+4:]))
	entries := int(le.Uint32(data[maps+4:]))
	offset := uint32(end)
	for i, size := range []int64{int64(len(ota)), stat.Size()} {
		record := int(le.Uint32(data[entries+9*i+4:]))
		le.PutUint32(data[record:], offset)
		le.PutUint32(data[record+4:], uint32(size))
		offset += uint32(size)
	}
	if _, err = w.Write(data[:end]); err != nil {
		return err
	}
	if _, err = w.Write(ota); err != nil {
		return err
	}
	if _, err = tnt.Seek(0, io.SeekStart); err != nil {
		return err
	}
	if _, err = io.CopyBuffer(w, tnt, make([]byte, 64<<10)); err != nil {
		return err
	}
	_, err = w.Write(data[end:])
	return err
}

func (s *terrainStream) checkStreamArchive(path string, ota []byte, tnt *os.File) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	fs := vfs.New()
	defer fs.Close()
	if _, err = fs.MountArchiveReader(path, f, info.Size(), 10, vfs.ArchiveOptions{}); err != nil {
		return err
	}
	entries, err := fs.ReadDir("maps")
	if err != nil {
		return err
	}
	otaPath, tntPath := "maps/"+s.req.Name+".ota", "maps/"+s.req.Name+".tnt"
	if len(entries) != 2 || entries[0].IsDir || entries[1].IsDir || !strings.EqualFold(entries[0].Path, otaPath) || !strings.EqualFold(entries[1].Path, tntPath) {
		return fmt.Errorf("archive must contain exactly its OTA and TNT")
	}
	got, err := fs.ReadFile(otaPath)
	if err != nil {
		return err
	}
	if !bytes.Equal(got, ota) {
		return fmt.Errorf("archive OTA differs")
	}
	if err = checkOTA(got, s.req, s.world, s.starts); err != nil {
		return err
	}
	if _, err = tnt.Seek(0, io.SeekStart); err != nil {
		return err
	}
	buffer := make([]byte, 64<<10)
	var offset int64
	for {
		if err = s.ctx.Err(); err != nil {
			return err
		}
		n, readErr := tnt.Read(buffer)
		if n > 0 {
			got, err = fs.ReadFileRange(tntPath, offset, n)
			if err != nil {
				return err
			}
			if !bytes.Equal(buffer[:n], got) {
				return fmt.Errorf("archive TNT differs at byte %d", offset)
			}
			offset += int64(n)
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	if offset != entries[1].Size {
		return fmt.Errorf("archive TNT length differs")
	}
	return nil
}

// PNG's PalettedImage interface streams one scanline at a time. Cache only
// one 32px tile row; its maximum is 641 KiB at 40 units, rather than a full
// 403 MiB indexed image (or a 1.6 GiB RGBA image).
type tileImage struct {
	s      *terrainStream
	colors color.Palette
	row    []byte
	rowY   int
	err    error
}

func newTileImage(s *terrainStream) *tileImage {
	colors := make(color.Palette, 256)
	for i, c := range s.palette {
		colors[i] = color.RGBA{c[0], c[1], c[2], 255}
	}
	return &tileImage{s: s, colors: colors, row: make([]byte, (s.width/2)*1024), rowY: -1}
}
func (p *tileImage) ColorModel() color.Model { return p.colors }
func (p *tileImage) Bounds() image.Rectangle { return image.Rect(0, 0, p.s.width*16, p.s.height*16) }
func (p *tileImage) At(x, y int) color.Color { return p.colors[p.ColorIndexAt(x, y)] }
func (p *tileImage) ColorIndexAt(x, y int) uint8 {
	if p.err != nil {
		return 0
	}
	if row := y / 32; row != p.rowY {
		for tx := 0; tx < p.s.width/2; tx++ {
			index := p.s.indices[row*(p.s.width/2)+tx]
			p.err = p.s.store.read(p.s.order[index], p.row[tx*1024:(tx+1)*1024])
			if p.err != nil {
				return 0
			}
		}
		p.rowY = row
	}
	return p.row[(x/32)*1024+(y%32)*32+x%32]
}
