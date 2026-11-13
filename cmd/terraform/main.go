// terraform serves development files, builds the static site, or emits configs.
// Rendering and .ufo export always run in the browser.
package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/nanolathe-gg/terraform/internal/site"
)

func run() error {
	root := flag.String("root", ".", "repository root (defaults to current directory)")
	port := flag.Int("port", 8767, "development server port (loopback only)")
	assets := flag.String("assets-root", "/private/tmp/nanolathe-map-editor", "local save-link storage; worlds need no external assets")
	build := flag.String("build-site", "", "write the static site to this directory and exit")
	dump := flag.String("dump-configs", "", "write generated configuration files to this directory and exit")
	mapsDefault := os.Getenv("TERRAFORM_MAPS_URL")
	if mapsDefault == "" {
		mapsDefault = site.MapsURL
	}
	maps := flag.String("maps-url", mapsDefault, "static build's save-link Worker URL")
	flag.Parse()
	if flag.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: %v", flag.Args())
	}
	if *build != "" && *dump != "" {
		return fmt.Errorf("choose --build-site or --dump-configs")
	}
	s, err := site.Load(*root)
	if err != nil {
		return err
	}
	if *dump != "" {
		files, err := s.Generated("")
		if err != nil {
			return err
		}
		return site.WriteFiles(*dump, files)
	}
	if *build != "" {
		path, err := s.Build(*build, *maps)
		if err != nil {
			return err
		}
		fmt.Println(path)
		return nil
	}
	if *port < 1 || *port > 65535 {
		return fmt.Errorf("port must be between 1 and 65535")
	}
	handler, err := s.Handler(*assets)
	if err != nil {
		return err
	}
	fmt.Printf("Terrain editor: http://127.0.0.1:%d/\n", *port)
	server := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", *port), Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	return server.ListenAndServe()
}
func main() {
	log.SetFlags(0)
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
