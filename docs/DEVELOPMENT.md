# Development

How to run, change and check Terraform. For why it is built this way, see
[DESIGN.md](DESIGN.md). Agents also follow [AGENTS.md](../AGENTS.md).

## Requirements

- **Go 1.27.1 or later** serves the editor, builds the static site and
  compiles the exporter.
- **A WebGPU browser** with hardware acceleration. On Linux, start Chrome
  with `--enable-unsafe-webgpu --enable-features=Vulkan`, or it falls back to
  software rendering, which the editor refuses. The browser checks add these
  flags themselves (`repro/chrome.mjs`; `CHROME=<path>` picks another binary).
- **Node** runs the checks.
- **Python** with `requirements.txt` is optional. Only the terrain analysis
  and retail research scripts use it.
- **Dawn's Node binding** (npm `webgpu`) is optional, installed outside the
  repository, for the headless GPU checks (`$TERRAFORM_WEBGPU`, see
  `repro/headless.mjs`).

The editor needs no installed game and no private assets.

## First steps

```bash
go run ./cmd/previews install-hook
```

This installs the pre-push check for preview images. The editor's preview
PNGs are published in a pinned GitHub Release, not in Git. The server and the
site build download them when they are missing; while the repository is
private this needs `gh auth login` or `GH_TOKEN`. See
[PREVIEW_ASSETS.md](PREVIEW_ASSETS.md).

## The development server

```bash
go run ./cmd/terraform --port <port> --assets-root /tmp/terraform-dev
```

- `--port` defaults to 8767. `--assets-root` holds local share-link storage
  only. Pick your own values when several people or agents share a machine.
- Source files, the source manifest and the JSON inputs of generated configs
  are reread on every request, so edit and refresh. Exporter Go changes
  rebuild on its next request. Only changes to the server's own Go code need
  a restart.
- `go build -o /tmp/terraform ./cmd/terraform`, then
  `/tmp/terraform --root <checkout> --port <port>`, runs a compiled server.

## Where things live

- **Shared defaults:** `materials/defaults.json`.
- **Worlds:** `materials/<world>.json`, with `world.knobDefaults`,
  `world.engineDefaults`, `world.column` (the rock column), `world.rock`
  (rock types), `world.surface` (surface layers), `world.materials`, and
  `world.tools` and `world.shapes` (the shape buttons).
- **Material library:** `materials/textures.json`. **Palette:**
  `materials/palette.json`.
- **Site manifest:** `site.json` lists the worlds, recipe order and shipped
  source files. `internal/site/` assembles each world's config from it.
- **Layout:** `index.html`. The [design's code map](DESIGN.md#code-map) lists
  the rest.

## Checks

Run the checks that can catch a failure caused by your change.

```bash
repro/check.sh
```

The default `quick` group runs the fast Node unit tests and the world-name
gate, with no GPU, browser or Go. Other groups (`browser`, `engine`, `digest`,
`export`, `features`, `config`, `assets`, `site`) cover specific areas.
[AGENTS.md, Checks](../AGENTS.md#checks) says which to run when, and
[repro/README.md](../repro/README.md) documents the individual tools.

## The static site and deployment

```bash
go run ./cmd/terraform --build-site <dir>
```

This writes `<dir>/index.html` and `<dir>/b/<version>/`, where the version
directory's name hashes all shipped bytes. A deploy therefore never mixes new
scripts with cached old shaders. Any static host can serve the result.

- `--dump-configs <dir>` writes only the generated `config/*.json` and
  `services.json`, for headless rendering and measurements.
- `--maps-url <url>` (or `TERRAFORM_MAPS_URL`) points the static build at
  the share-link Worker ([deploy/worker](../deploy/worker/README.md)).
  Development uses the server's own `/api/maps`.
- `.github/workflows/pages.yml` runs the quick checks, the Go tests and the
  preview checks on every push and pull request, then deploys `main` to
  GitHub Pages. Deployment is skipped while the repository is private.

## Research hosts

`cmd/repro-host` wraps the development server for the optional interaction
and control-audit harnesses:

```bash
go run ./cmd/repro-host --mode interaction --port <port> --out /tmp/terraform-interaction
```

See [repro/interaction](../repro/interaction/README.md) and
[repro/audit](../repro/audit/README.md). `measure/` holds analysis scripts
([measure/README.md](../measure/README.md)).
