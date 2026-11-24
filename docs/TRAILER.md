# Trailer: storyboard and prototype

The announcement video. The current version is the combined cut (below):
sections vs Terra, a real-time take on Green Planet, the same map playing in
Nanolathe, and the TERRA end card. `trailer/` holds the tools that render it,
so it can be regenerated for a release (owner, 2026-11-21). Nothing here
ships with the editor: no file is in `site.json`, the pages are production
tools, and their outputs (frames, videos, the retail section images) stay
outside Git. The earlier sections record the first rough cut and the three
concepts that led to it.

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




## Cartoon cold open (2026-11-23)

The owner's idea: open on the old way, a person stamping maps by hand. Drawn
as a flat-shape cartoon (`cuts.html?cut=cartoon`, 11.6 s): "Making Total
Annihilation maps, the old way"; from above, a hand
with a "HILL 17" rubber stamp prints the same hill all over a sheet of graph
paper, faster and faster; then every print gets the same dashed box and
"HILL 17" tag, and "Every hill: exactly the same." In the match cut the
paper dissolves into the engine's render of seven Terra hills at the same
spots (`trailer/cartoon/hills.json`), each with its own size, height,
outline and breakup: "Terra: every hill its own." Then twelve other
variants of the same seven hills (`stills.mjs --vary 1..12`: new seeds,
size, height, wander and width variation within a fifth) swap in every four
frames to the end of the cut: there is no end to them. The stamps are generic
cartoon hills, not retail art. `assemble-combined.sh <cuts> <take> cartoon`
writes a 68 s version: the cartoon, the quick cut of every world, the
real-time take, the gameplay and the end card (the world cut comes before
the take so the take's Build click leads straight into the game).

## End card (2026-11-23)

The logo is the owner's own map, `trailer/logo-terra.json` (TerraLogo):
"Terra" written on Painted Desert (8 x 8), with boulders scattered left of
the T, three small stamps beside it, an alluvial fan above and shallow
water below. `logo-from-save.mjs` opens it in the real editor through
Open, waits for weathering, and captures the canvas without the editor's
overlays. The card shows the letters only (owner, 2026-11-23), rendered
larger than the card needs (`--zoom 1.2 --size 1920x924 --center
2165,2075`) so a slow push in (14% over the card's 6 s, toward the
letters) stays sharp. Under the picture the name is spelled out, "Terra"
(owner: viewers should not have to read it out of the terrain), then "A
free map editor for Total Annihilation, in your browser" and the address,
terra.nanolathe.gg. The card comes in fast (0.12 s) so the music's last
hit lands on the picture.
`cuts.html` fits the picture above the card's two lines (`?logo=` picks
another picture). It replaces the Green TERRA letters (`logo-green.json`),
which stay for comparison.

## Music (2026-11-23)

`trailer/music.mjs` synthesizes an original upbeat electro-pop score
(owner: modern, exciting, pop-like; a fun tool with endless possibilities)
from oscillators, plucked strings, filtered noise, a sidechain pump, a
ping-pong delay and a reverb with predelay: no samples, no dependencies,
the same bytes every run. `assemble-combined.sh` makes it to the cut: each
segment passes its style and length, so every section starts on its cut. A
major at 120 beats a minute (15 frames a beat) on I-V-vi-IV, with a lead
hook, and the cut keeps to that grid: the cartoon is eight beats from its
match cut to its end, the world montage is three bars, the arrival five and
the battle four, and the take plays whole bars and breathes in what is left.

- Cartoon: pizzicato, a thud with a paper click on each stamp, a deflating
  trombone on "exactly the same"; the match cut opens a filtered chord and
  the hook's first notes on bells; bells on sixteenths over the hill swaps;
  a roll into the montage.
- World montage: a kick, a chord stab and a bell on every world, over a
  rising chord; not a build, so the take can start on its groove.
- Take: three four-bar stages (kick, bass and arpeggio; then claps, open
  hats and stabs; then the hook on plucks and sixteenth hats), a beat without
  a kick before each stage, then a roll over the last whole bar into the
  drop, which falls on the cut from the finished export to the game.
- Arrival: the first drop, lighter (open voicing at a 3.6 kHz cutoff, the
  hook on bells an octave up, no sixteenth hats).
- Battle: everything (the open voicing at 6.5 kHz, the hook on the lead
  doubled an octave up with a bell above, driving bass, a crash every two
  bars).
- End card: one big open A major hit ringing out for 5 s, the hook's last
  bar on bells, a last A at 4 s.

The arrangement and sound follow a review by another model (2026-11-23):
hats band-passed between 6 and 10 kHz (they had more energy above 14 kHz
than below), claps with a 190 Hz body, a brighter lead filter, the reverb
and delay returns pumping with the kick, a longer kick. Measured, cartoon
version: −14.2 LUFS integrated, true peak −1.1 dBFS; dB RMS about −19.8 in
the stamps, −18.2, −17.1 and −16.4 in the take's stages, −21.2 in the roll,
−14.1 in the arrival, −12.7 in the battle, −15.1 and −23.7 in the end card's
two halves; in the battle, 1.5 to 4 kHz is 5 dB under 0.4 to 1.5 kHz and
everything above 14 kHz is under 4 to 9 kHz. The other version: −14.6 LUFS,
−1.6 dBFS. Checked by spectrogram and levels only, not by ear.

## Combined cut (2026-11-21)

The owner picked B + C and added Nanolathe gameplay. Owner's notes: TERRA
written on Green Planet; Green and Red as the classic defaults people
know; "any world" as a quick cut of every world; the real-time take drags
its tools and shows craters and water; a second or two of metal and trees;
gameplay to prove the map works.

| Part | Source | Length |
| --- | --- | --- |
| Title | `slate.html` | 3 s |
| Sections vs Terra | `cuts.html?cut=sections`, its title and end card cut off; the world cut runs on the music's beat: Green, Red (1 s each), the next six (0.5 s each), Ice (1 s) | 24.3 s |
| Slate | "One take, in real time" | 2.2 s |
| Real-time take | `capture-realtime.mjs` on Green: Mountain, two Hills, Deep water and Crater dragged, Knoll field; then the range is selected again for variation at work (New seed, Height dragged up and back, Outline & variation opened and Wander dragged); three metal deposits round start 1 (200 to 330 px apart), eight trees, then Build game map, filmed until the build has finished and its download link shows. The two starts and start 2's three deposits (in the far corner, off camera, as far apart) are set just before the take. Step labels (`labels.mjs`, from the take's own marks) name each step over the map | 26.8 s |
| Gameplay | Nanolathe `tools/film` with `trailer/nanolathe-film.json` on the take's own `.ufo`: "The same map, exported and in play" / "Nanolathe, an open-source Total Annihilation engine"; the commander lands at start 1 and builds its extractor on a placed deposit beside the lake, then a staged skirmish by the crater from its advance. The bottom 3.4% is cropped: the film tool still draws its game clock there | 18 s |
| End card | `cuts.html?cut=end`, the owner's Terra map (`logo-terra.json`, see End card) with a slow push in and the name spelled out | 6 s |

Assembled by `trailer/assemble-combined.sh` to 80 s (68 s for the cartoon version), with music (see Music). The segments join with hard cuts on the music's beat; only the first fades in and the last fades out.

**Measured (2026-11-23).** The take runs 26.78 s against 26.79 s of wall
clock (58 delivered frames a second), the build taking 3.8 s of it on
camera; about 6 s is the variation step, and the rest is quicker than the first takes (26.3 s without
variation) because the pauses wait only until the view is drawn, plus a
quarter second, and the drags and glides are shorter; nothing is retimed
after capture. Its build passed the exporter's self-check: 1,269 unique
tiles in 4,420 slots, 14 features, 2 starts.

Variation comes after every shape is down, because a new seed also changes
the seeds of the shapes drawn after it (the lake came out fatter and
reached the metal). The Height drag goes to the top and back to 236: the
range at 266 or more clamps game heights (7 to 49 cells) and the Export
pane warns on camera. Shapes' seeds also differ from run to run, so the
lake ends a little short of the metal to keep it dry whatever the outline.
Many takes show black flashes of one to three frames over the area being
drawn (an editor preview issue the owner set aside); the take kept here has
none (checked frame by frame), and its starts and deposits all have game
heights 84 within 48 px (dry base 84, sea 75); it was the fourth of four
tries. Nanolathe loaded
`Terra Valley.ufo` from a second `--root` (the TA install is never
written): the commander landed at start 1 (1130, 880) and built its
extractor at (1032, 952), about 120 px away, finished about 9.5 s into the
film; the other commander stays in the far corner with its own metal. It
staged 71 units for the battle and skipped 21 it could not place.

Before 2026-11-23 both commanders walked to the map's only metal: ours
along the lake, the other from the far corner, so they met there.

**Open.** The gameplay is Nanolathe, the open-source TA engine, not the
original game; the card's "plays in the game" claim is untested in TA
itself. No audio.

## Three concepts (2026-11-21)

The owner asked for alternatives aimed at four points: it is for Total
Annihilation and exported maps play in the game; artists are in control
but anybody can use it; it looks great and works in real time; it beats
pasting pre-rendered pieces. Each concept is a 30-second prototype that
ends on the same card (the TERRA logo, "A map editor for Total
Annihilation", "Exports .ufo maps that play in the game"). The river tool is
left out (owner, 2026-11-21), and Terra's shapes are natural ones (smooth,
meandering paths), not zig-zags (owner, 2026-11-21).

| Concept | What it shows | Points it covers |
| --- | --- | --- |
| A. Every world (`cuts.html?cut=worlds`) | Green built stroke by stroke, then the eight other worlds, each from its own signature tools (Cone and Vent, Atoll, Hoodoos, Ice cliff...), then a 3x push into 1x pixels. | Looks great; artist control through each world's presets; TA in the title and end card. |
| B. Sections vs Terra (`cuts.html?cut=sections`) | TA's own Green Planet map-editor sections pasted along a ridge path the way a map maker would, their squares shown; then Terra draws the same ridge, bends it, and shows it on Painted Desert and Ice. | Better than pasting ready-made pieces; artist control; easy. |
| C. One take, real time (`capture-realtime.mjs`) | The real editor at 1x on Painted Desert: butte, hoodoos, gray dome, a curving ridge, the butte widened with Size, then the Export pane. A clock badge runs throughout. | Real time; easy; Export for TA. |

**Real and stand-in.** Every Terra picture is the engine's own render (A,
B) or a screen capture of the editor (C). Concept B's section half uses
the retail Green Planet sections (decoded from `worlds.hpi` into
`~/terraform-assets/green-planet-sections`, read-only). That is the owner's
call of 2026-11-21: compare against the real thing, not an illustration.
The section images and every frame made from them stay outside Git; the
repository holds only the code that composes them. In-game footage is still
a gap in all three: only the owner can capture TA.

**Measured.** Concept C's take lasts 21.54 s against 21.52 s of wall clock,
at 57 delivered frames a second; its Size drag changed 213,926 canvas
pixels. The Green scene of concept A exports 1,070 distinct 32-px tiles
out of 4,420 (level ground reuses its own tiles by design).

**Section placement in B.** The ridge runs northwest to southeast, the
direction the elongated Green sections are drawn in, and the pieces are
the closest matches (Green27, 17, 18, 28), centered on the path and
snapped to 32 px. The caption claims only what the frames show: fixed
shapes and directions, joined at the edges of their squares.

## State of the first rough cut (2026-11-19)

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
