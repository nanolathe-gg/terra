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
