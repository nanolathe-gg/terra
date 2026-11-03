package main

import (
	"flag"
	"fmt"
	"github.com/nanolathe-gg/terraform/internal/server"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type roots []string

func (r *roots) String() string     { return strings.Join(*r, ",") }
func (r *roots) Set(s string) error { *r = append(*r, s); return nil }
func main() {
	var o server.Options
	var port int
	var biomes string
	var gr roots
	flag.IntVar(&port, "port", 8767, "HTTP port")
	flag.StringVar(&o.SourceRoot, "source-root", ".", "editor source root")
	flag.StringVar(&o.AssetsRoot, "assets-root", "/private/tmp/nanolathe-map-editor", "assets and documents root")
	flag.StringVar(&o.ExportTool, "export-tool", "", "map exporter helper")
	flag.StringVar(&o.FeatureTool, "feature-tool", "", "feature helper")
	flag.StringVar(&biomes, "biomes", "green,red,archipelago,moon,zhon,lava,desert,crystal,ice", "served worlds")
	flag.BoolVar(&o.Prepared, "prepared", false, "use prepared catalogues")
	flag.Var(&gr, "game-root", "content root (repeatable)")
	flag.Parse()
	o.Biomes = strings.Split(biomes, ",")
	if o.ExportTool == "" {
		o.ExportTool = filepath.Join(o.AssetsRoot, "map-export")
	}
	if o.FeatureTool == "" {
		o.FeatureTool = filepath.Join(o.AssetsRoot, "bin", "map-features")
	}
	if len(gr) == 0 {
		home, _ := os.UserHomeDir()
		gr = append(gr, filepath.Join(home, "TotalAnnihilation"))
	}
	o.GameRoots = gr
	s, e := server.New(o)
	if e != nil {
		log.Fatal(e)
	}
	fmt.Printf("Shared-surface sculptor: http://127.0.0.1:%d/sculpt\n", port)
	log.Fatal(http.ListenAndServe(fmt.Sprintf("127.0.0.1:%d", port), s))
}
