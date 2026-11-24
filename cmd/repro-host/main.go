// repro-host runs the optional interaction/audit harness around the normal editor.
package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/nanolathe-gg/terra/internal/previewassets"
	"github.com/nanolathe-gg/terra/internal/reprohost"
)

func run() error {
	o := reprohost.Options{}
	flag.StringVar(&o.Mode, "mode", "", "interaction or audit")
	flag.StringVar(&o.Source, "source", ".", "editor checkout to serve")
	flag.StringVar(&o.Tools, "tools", ".", "checkout containing the harness files")
	flag.StringVar(&o.Out, "out", "", "output directory for PNG/JSON evidence (required)")
	flag.StringVar(&o.Assets, "assets", "/tmp/terraform-tool-audit/assets", "audit's read-only reference assets")
	flag.StringVar(&o.Evidence, "evidence", "/tmp/terraform-tool-audit", "audit inventory and baseline sources")
	flag.StringVar(&o.Report, "report", "", "optional audit report directory")
	port := flag.Int("port", 0, "owned loopback port (required)")
	flag.Parse()
	if flag.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: %v", flag.Args())
	}
	if *port < 1 || *port > 65535 {
		return fmt.Errorf("give --port between 1 and 65535")
	}
	if err := previewassets.Ensure(o.Source); err != nil {
		return err
	}
	h, err := reprohost.New(o)
	if err != nil {
		return err
	}
	defer h.Close()
	fmt.Printf("%s host: http://127.0.0.1:%d/%s/index.html source=%s\n", o.Mode, *port, o.Mode, o.Source)
	return (&http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", *port), Handler: h, ReadHeaderTimeout: 10 * time.Second}).ListenAndServe()
}
func main() {
	log.SetFlags(0)
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
