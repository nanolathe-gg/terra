# LP0c: stopped on tile-size-dependent pixels, 2026-11-12

**Result [measured]: not accepted.** Before any editor change, the acceptance
script found **1 differing pixel** between 128 px and 256 px tiles on
`green-2`, `map16`. The largest RGB channel difference is **16/255**.
A second fresh process reproduced the same count and magnitude. Both runs'
repeated 256 px pictures match themselves exactly; 512 px matches 256 px.
There are no reported GPU errors. The cause and pixel location have not
been investigated.

The card says, “If any scene's pixels do depend on the tile size, stop and
report.” Work stopped at that condition. No tolerance was introduced, no
editor file changed, and LP0b was not started. This is an existing-main
result, not a regression from an LP0c implementation.

**Base [measured/read].** In `lp0/bench`, merged current main `8e42ae8e`
and current `plan/live-preview` `6758d33b`, producing `36ca1e99`. Ran
`repro/check.sh quick --worlds none`: **205 tests passed, 0/34 scenes
changed**, regional replay and voxel checks passed. Then created
`lp0c/view-tiles` in `~/src/terraform-wt-lp0c` from that checked base.
`git merge main` on this card reports already up to date. All editor and
engine files on this branch match main.

**Pixel counts [measured].** Ran the owner's existing
`~/terraform-assets/agent-live-preview/tilesize.mjs` sequentially, in scene
filename order and map4/map16 order, through the view's fed render path
under Node/Dawn. Each check scene's complete window is **1024 × 1024 at
(0,0)**, matching `repro/render.mjs`; the script's smaller default window
was overridden explicitly. Each process renders 256, 128, 512, then 256
again. Counts below compare 128 with 256; every completed comparison's
256 repeat and 512-versus-256 count is 0.

| Scene | map4 differing pixels | map16 differing pixels |
| --- | ---: | ---: |
| archipelago-1 | 0 | 0 |
| archipelago-2 | 0 | 0 |
| archipelago-3 | 0 | 0 |
| crystal-1 | 0 | 0 |
| crystal-2 | 0 | 0 |
| crystal-3 | 0 | 0 |
| desert-1 | 0 | 0 |
| desert-2 | 0 | 0 |
| desert-3 | 0 | 0 |
| green-1 | 0 | 0 |
| green-2 | 0 | **1; fresh-process confirmation: 1** |

**22 of 68 scene/map combinations completed** (11 of 34 scenes on both
maps). The remaining 46 combinations were not run after the stop. These
counts extend the plan's three-scene/map4 evidence; they do not contradict
that narrower claim. The existing render check permits up to 16 pixels
between 256 and 512 px tiles, but LP0c's 128-versus-256 test permits none.
The passing quick tier therefore does not settle this failure.

**Conditions and retained evidence.** Apple M3 Pro / 18 GiB, macOS 26.6.2
(25G83), Node v24.5.0 with the existing Dawn binding. GPU query 512 MiB,
heap 1536 MiB; the acceptance script raises the renderer's budget to
1024 MiB after opening the scene. These are pixel counts, not Chrome
latency measurements. `ps -Ao pcpu,command -r | head` was captured before
the sweep and confirmation; other Chrome/desktop and indexing activity
was present. No speed claim is made from the elapsed times. The display
was kept awake. No server or Chrome check was started, so there was no
fresh-server warm-up to discard.

Small count results, the exact acceptance script, its SHA-256, the checked
commit IDs and load snapshots are retained in
`~/terraform-assets/agent-lp0c/` (`counts.json`, `tilesize.mjs`). Script
SHA-256: `1f001574bc5365dbd6985d38196f4028b9c6fb13dc3c0efd94647114d4ea5c17`.
Generated check images and temporary logs were read and deleted.

Reproduce the failing count with the retained script:

```sh
node ~/terraform-assets/agent-lp0c/tilesize.mjs \
  ~/src/terraform-wt-lp0c/repro/scenes/green-2.json \
  --repo ~/src/terraform-wt-lp0c --map 16 \
  --x 0 --y 0 --w 1024 --h 1024
```

**Unfinished.** LP0c's tile-size change, remaining pixel counts, alternating
Chrome latency runs, 35-tile count, Surface cache-retention check and land
tier are not done: the pixel acceptance test stopped the card before
implementation. No plan change was needed. Nothing landed or was pushed.
LP0b and subsequent cards remain unstarted.
