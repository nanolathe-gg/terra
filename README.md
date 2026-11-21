# Terraform

A terrain and map editor for **Total Annihilation** that runs in your browser.

Sketch hills, mountains, plateaus, rivers and coasts with a few strokes. The
GPU grows realistic, weathered ground from them, with eroded cliffs, scree,
sand, grass and individual stones, at the game's own pixel scale and in its
256-color palette. Place trees, rocks and start positions, then export a
playable `.ufo` map.

> **Status: experimental.** Terraform is under active development and not yet
> released. Saved maps and share links may stop working between versions.
> Exported `.ufo` files are the only stable output.

## Features

- **Shape by drawing.** Every shape is a path with a cross-section you can
  edit: raise, cut or flatten to a height, with lean, terraces, gullies,
  talus and outline variation.
- **Weathering on the GPU.** Erosion, deposition, rock weathering and surface
  layers (soil, grass, moss, sand, snow) follow the terrain you drew.
- **Real rock.** A rock column of hard and soft beds, with dip and folds,
  rendered as a voxel solid so cliffs break into ledges and blocks.
- **Nine starting worlds:** Green Planet, Red Planet, Archipelago, Moon,
  Lush, Lava, Painted Desert, Crystal and Ice. Every setting is yours to
  change, and each map keeps its own copy of its world.
- **A material editor.** Ground, water and rock textures are node graphs you
  can edit and reuse.
- **Features and gameplay.** Generated trees and rocks, start positions,
  metal and game settings, plus a passability view for unit movement.
- **Export in the browser.** The `.ufo` exporter runs locally in the page.
  No game files are needed and nothing is uploaded.
- **Share a map** as a link, or save it as a file.

All art is generated. Terraform contains no artwork from the original game,
and it doesn't need an installed copy.

## Using it

Terraform needs a browser with WebGPU and hardware acceleration: current
Chrome or Edge, Safari 26, or Firefox with WebGPU enabled. Open the editor,
choose a world and map size, and start drawing. Hover over any control for
help.

The hosted editor will be at <https://terra.nanolathe.gg> once the project
is public. Until then, run it locally.

## Running locally

You need [Go](https://go.dev/) 1.27.1 or later.

```bash
git clone https://github.com/nanolathe-gg/terraform.git
```

```bash
cd terraform && go run ./cmd/terraform --port 8080
```

Then open <http://127.0.0.1:8080/>. To build the static site instead:

```bash
go run ./cmd/terraform --build-site /tmp/terraform-site
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the development setup and
checks.

## Documentation

- [Design](docs/DESIGN.md): goals, principles, decisions and architecture
- [Development](docs/DEVELOPMENT.md): setup, server, checks and the static site
- [All docs](docs/README.md)
- [AGENTS.md](AGENTS.md): rules for anyone, human or AI agent, changing the code

## License

[MIT](LICENSE). Total Annihilation is a trademark of its respective owners.
Terraform is an independent fan project and is not affiliated with them.
