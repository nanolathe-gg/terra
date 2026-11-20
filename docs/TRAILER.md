# Trailer: storyboard and prototype

A 60 to 75 second announcement video. It explains what the editor is and how
it works, shows the real editor on a few worlds, then the game. This page is
the plan; `trailer/` holds the prototype that renders a rough cut. Nothing
here ships with the editor, and the branch (`prototype/trailer`) does not
land.

## The idea

The first half is an explainer, not the editor: you draw paths, you adjust
them, they make a height field, the height turns 3D, weathers, becomes a
solid and is drawn with materials. The explainer is built from one real
map's data and its camera settles into TA's view, so its last frame is the
editor's own render of that map. From there the video is the real editor.

## Shots

Times are targets for the 60 to 75 second cut.

| # | Shot | What is on screen | Time |
| --- | --- | --- | --- |
| 1 | Black canvas | Black, then a line: "A map editor for Total Annihilation". | 0-3 s |
| 2 | Draw | A cursor draws a mesa outline and a river as simple paths with a few nodes. A grayscale height field fades in under the paths. | 3-8 s |
| 3 | Adjust | Drag one node: the path and the heights follow. A cross-section curve bends the mesa's side; a Variation slider roughens it. The heights update at once. | 8-13 s |
| 4 | Into 3D and Time | The height field rises into TA's oblique view. Erosion and talus run as a short time-lapse; a material mask (one color per material) washes over it. | 13-20 s |
| 5 | Solid | Square voxels drop onto the surface and replace the height field. The cliff gets overhangs, ledges and broken blocks with cracks. | 20-24 s |
| 6 | Light and materials | The real materials are drawn in, tile by tile from a rough pass to final. The frame is now the editor's render of this map. | 24-28 s |
| 7 | Worlds, live | The real editor: drawing on a few worlds (green, desert, ice, lava). | 28-45 s |
| 8 | Controls | Sliders and the material graph change the look while the worlds play. Shown in context with 7, not as a separate feature list. | (inside 7) |
| 9 | In game | The same map in Total Annihilation, units crossing it. | 45-53 s |
| 10 | Logo | "Terra" spelled in real terrain, rendered by the engine. | 53-58 s |

## Decisions in this cut

Changes to the owner's first outline (2026-11-19). Strike any of them.

- **The explainer lands on the editor's frame.** Its camera ends in TA's
  view and its layers come from the same map, so there is no cut between the
  explainer and the product.
- **One scene sets up everything.** A mesa (a cliff for overhangs and
  blocks, stepped layers for the mask, talus at its foot) beside a river
  (sand where water meets land).
- **"Total Annihilation" comes first.** Said in shot 1, not left to the end.
- **The game comes before the logo.** The payoff for TA players is a playable map.
- **The logo is a real map.** Its letters are mesas the engine renders.
- **Tiles, not scanlines, in shot 6.** The renderer draws a rough pass and
  refines visible tiles; that reads as rendering and says "fast", where a
  path-tracer scanline suggests slow.
- **The explainer's controls look like the editor's.** The curve and slider
  in shot 3 reappear in shot 8.
- **Overhangs at the size the engine makes them.** The solid exists only in a
  thin shell around the surface: walls bulge, ledges stand out, blocks break
  off. No caves.

## What is real and what is a stand-in

| Shot | Source |
| --- | --- |
| 2-3 paths | The scene's own stroke points. |
| 2-4 heights | `windowHeights` of the scene (the displayed heights, 2 px samples). |
| 4 Time | The Time pass's heights before and after, read back from the engine. |
| 4 material mask | The page's `material` view (and water from the final picture) grouped into four flat classes: a stand-in, since the engine has no mask view and adding one for the trailer would be a second render path. |
| 5 solid | Clay renders (the engine's own, no materials) at coarse and fine voxel sizes. |
| 6 final | The engine's render of the window. |
| 7-8 editor | Screen capture of the editor on our own server. |
| 9 game | A slate until there is real footage. |
| 10 logo | An engine render of a letter scene. |

## State of the rough cut (2026-11-19)

Unfinished, in order of importance:

- **The handoff is not there yet.** The explainer ends on the engine's
  picture of the hero map, but the editor clips then open on a fresh map at
  60% zoom. Next: open the hero scene in the editor at 1x on the same
  window, so the explainer's last frame and the editor's first match.
- **The Height drag in shot 8 shows no visible change** (synthetic slider
  input, and a help popup covers the slider). The material graph is on
  screen for about a second.
- The explainer runs 30 s against the 28 s target; the editor clips play
  faster than real time (stop-motion capture); the section panel is drawn in
  the explainer's own style, not the editor's.
- The in-game shot is a slate, and there is no audio.

## Rendering the rough cut

See `trailer/README.md`. Frames, layer dumps and videos stay outside Git
(`~/terraform-assets/agent-trailer/`); nothing retail is read.
