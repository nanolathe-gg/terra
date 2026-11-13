// previews manages GPU rendering receipts, release bundles and the CPU-only push gate.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/nanolathe-gg/terraform/internal/previewassets"
)

func run() error {
	if len(os.Args) < 2 {
		return fmt.Errorf("usage: go run ./cmd/previews fingerprint|stamp|package|publish|fetch|check|check-push|install-hook")
	}
	command := os.Args[1]
	f := flag.NewFlagSet(command, flag.ContinueOnError)
	root := f.String("root", ".", "repository root")
	dir := f.String("dir", "", "rendered previews directory (default <root>/ui-previews)")
	expected := f.String("expected-inputs", "", "fingerprint recorded before rendering")
	out := f.String("out", "", "archive path")
	repo := f.String("repo", "nanolathe-gg/terraform", "release repository")
	asJSON := f.Bool("json", false, "print fingerprint and input file checksums")
	published := f.Bool("published", false, "verify the pinned release asset exists and matches its checksum")
	replace := f.Bool("replace", false, "replace local previews with the pinned bundle")
	if err := f.Parse(os.Args[2:]); err != nil {
		return err
	}
	absolute, err := filepath.Abs(*root)
	if err != nil {
		return err
	}
	*root = absolute
	if *dir == "" {
		*dir = filepath.Join(*root, "ui-previews")
	}
	*dir, err = filepath.Abs(*dir)
	if err != nil {
		return err
	}
	switch command {
	case "fingerprint":
		input, err := previewassets.Fingerprint(*root)
		if err != nil {
			return err
		}
		if *asJSON {
			return json.NewEncoder(os.Stdout).Encode(input)
		}
		fmt.Println(input.SHA256)
	case "check-render":
		if _, err = previewassets.VerifyReceipt(*root, *dir); err != nil {
			return err
		}
		fmt.Println("Rendering receipt matches current inputs and files.")
	case "stamp":
		if err = previewassets.Stamp(*root, *dir, *expected); err != nil {
			return err
		}
		fmt.Println("Recorded completed preview render.")
	case "package":
		if *out == "" {
			return fmt.Errorf("package requires --out")
		}
		_, hash, err := previewassets.Pack(*root, *dir, *out)
		if err != nil {
			return err
		}
		fmt.Println(hash)
	case "publish":
		l, err := previewassets.Publish(*root, *dir, *repo)
		if err != nil {
			return err
		}
		fmt.Printf("Published %s (%s) and pinned %s\n", l.Tag, l.SHA256, previewassets.LockName)
	case "fetch":
		if err = previewassets.Fetch(*root, *replace); err != nil {
			return err
		}
		fmt.Println("Pinned preview files are ready.")
	case "check":
		l, err := previewassets.Check(*root)
		if err != nil {
			return err
		}
		if *published {
			if err = previewassets.CheckPublished(l); err != nil {
				return err
			}
		}
		fmt.Println("Previews match their rendering inputs and pinned bundle.")
	case "check-push":
		scanner := bufio.NewScanner(os.Stdin)
		seen := map[string]bool{}
		for scanner.Scan() {
			fields := strings.Fields(scanner.Text())
			if len(fields) != 4 {
				return fmt.Errorf("invalid pre-push input")
			}
			if !strings.HasPrefix(fields[0], "refs/heads/") || strings.Trim(fields[1], "0") == "" || seen[fields[1]] {
				continue
			}
			sha := fields[1]
			seen[sha] = true
			if err = previewassets.CheckHistory(*root, sha); err != nil {
				return err
			}
			l, err := previewassets.CheckRef(*root, sha)
			if err != nil {
				return fmt.Errorf("%s: %w", fields[0], err)
			}
			if err = previewassets.CheckPublished(l); err != nil {
				return fmt.Errorf("%s: %w", fields[0], err)
			}
		}
		return scanner.Err()
	case "install-hook":
		hookPath := filepath.Join(*root, ".githooks")
		c := exec.Command("git", "config", "--local", "core.hooksPath", hookPath)
		c.Dir = *root
		previous := exec.Command("git", "config", "--get", "core.hooksPath")
		previous.Dir = *root
		if b, _ := previous.Output(); strings.TrimSpace(string(b)) != "" && strings.TrimSpace(string(b)) != ".githooks" && strings.TrimSpace(string(b)) != hookPath {
			return fmt.Errorf("existing core.hooksPath is set; integrate .githooks/pre-push with your existing hook")
		}
		if err = c.Run(); err != nil {
			return err
		}
		fmt.Println("Installed the CPU-only preview pre-push gate.")
	default:
		return fmt.Errorf("unknown preview command %q", command)
	}
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
