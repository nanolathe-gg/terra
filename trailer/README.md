# Trailer prototype

Renders the rough cut described in [docs/TRAILER.md](../docs/TRAILER.md).
Nothing here is part of the editor or the static site. Outputs go to an
assets folder outside Git (here `A=~/terraform-assets/agent-trailer`). Use
your own CDP ports and your own editor server, never 8801 or 9450.

| Step | Command | Makes |
| --- | --- | --- |
| Layers | `node trailer/layers.mjs trailer/scene.json $A/layers` | The hero scene's stages from the engine on Dawn: heights at each keyframe, before and after the Time pass, and the clay, coarse-voxel, material-view and final pictures. About 5 s. |
| Explainer | `node trailer/render-explainer.mjs $A/layers $A/out/explainer.mp4 --port <cdp>` | Shots 1-6 from `explainer.html` in headless Chrome, 900 frames. Add `--stills 5,12,20` to check single seconds as PNGs. |
| Editor | `node trailer/capture-editor.mjs --server http://127.0.0.1:<yours> --port <cdp> --out $A/editor` | Shots 7-8: the real editor drawing on green, desert, ice and lava, a Height drag, the material graph. Stop-motion frames, so it plays faster than real time. |
| Logo | `node trailer/layers.mjs trailer/logo-desert.json $A/logo-desert` | "TERRA" as plateau strokes (Desert reads cleanly; Green's plateau walls are too ragged for letters). |
| Slate | `node trailer/render-explainer.mjs $A/layers $A/out/slate-game.mp4 --port <cdp> --page 'slate.html?title=In-game%20footage%20here&seconds=4'` | The placeholder for the in-game shot. |
| Cut | `trailer/assemble.sh $A` | `$A/out/trailer-rough.mp4`. |

The editor server is the usual development one, started from this worktree:
`go run ./cmd/terraform --port <yours> --assets-root /tmp/nanolathe-map-editor/agent-trailer`.

Edits in the explainer are the scene's `trailer.steps` (a node moved, card
numbers eased), applied in order; the layers after them render the final
state, so the explainer's last frame is the engine's own picture of that map.

## The three concepts (2026-11-21)

With `A=~/terraform-assets/agent-trailer/v2`:

| Step | Command |
| --- | --- |
| World stills | `for w in green red archipelago moon lush lava desert crystal ice; do node trailer/stills.mjs trailer/worlds/$w.json $A/worlds/$w --steps; done` (add `--tiles --cells` for Green's tile count) |
| Ridge stills | `for f in trailer/sections/*.json; do node trailer/stills.mjs $f $A/sections/$(basename $f .json); done` |
| Logo | `node trailer/stills.mjs trailer/logo-desert.json $A/logo` |
| Retail sections | Copy the chosen PNGs from `~/terraform-assets/green-planet-sections/png/{hills,flat}` into `$A/retail/` (never into the repository). |
| Cuts A and B | `node trailer/render-explainer.mjs $A $A/out/worlds.mp4 --port <cdp> --page 'cuts.html?cut=worlds'` (and `cut=sections`) |
| Cut C | `node trailer/capture-realtime.mjs --server http://127.0.0.1:<yours> --port <cdp> --out $A/out/realtime-raw.mp4`, then join a slate and the end card with ffmpeg. |

`stills.mjs` turns a world's own tools (Canyon, Cone, Atoll...) into the
library shape and card its toolbar button starts from, because scenes name
only library shapes.

## The combined cut (2026-11-21)

With `A=~/terraform-assets/agent-trailer/v2` (cuts) and `B=~/terraform-assets/agent-trailer/v3` (take):

1. `node trailer/capture-realtime.mjs --server http://127.0.0.1:<yours> --port <cdp> --out $B/realtime-raw.mp4 --ufo $B/ufo`
2. Point `trailer/nanolathe-film.json` at the map name (`Terra Valley`), then from `~/src/nanolathe`:
   `tools/film <path>/nanolathe-film.json $B/film/terra-gameplay.mp4 --root ~/TotalAnnihilation --root $B/ufo`
3. The end card's logo from the owner's map (it opens in the editor, so it needs your server):
   `node trailer/logo-from-save.mjs --server http://127.0.0.1:<yours> --port <cdp> --save trailer/logo-terra.json --zoom 0.8 --center 2215,2075 --out $A/logo-terra/final.png`
4. Render `cuts.html?cut=sections`, `cuts.html?cut=end` and the two slates with `render-explainer.mjs` into `$A/out`.
5. `trailer/assemble-combined.sh $A $B` (add `cartoon` for the cartoon version)
