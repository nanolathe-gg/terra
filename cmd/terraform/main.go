package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"github.com/nanolathe-gg/terraform/internal/server"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

type roots []string

func (r *roots) String() string     { return strings.Join(*r, ",") }
func (r *roots) Set(s string) error { *r = append(*r, s); return nil }
func main() {
	var o server.Options
	var port int
	var biomes, scene, output string
	var gr roots
	flag.IntVar(&port, "port", 8767, "HTTP port")
	flag.StringVar(&scene, "scene", "", "render an editor recipe without a browser")
	flag.StringVar(&output, "out", "", "output directory for native scene render")
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
	defer s.Close()
	if scene != "" {
		if e := renderScene(o, s, scene, output); e != nil {
			log.Fatal(e)
		}
		return
	}
	fmt.Printf("Shared-surface sculptor: http://127.0.0.1:%d/sculpt\n", port)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	host := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", port), Handler: s, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		s.Close()
		shutdown, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_ = host.Shutdown(shutdown)
	}()
	if err := host.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Print(err)
		os.Exit(1)
	}
}
