# UI review pass — October 30, 2026

Branch: `ui/editor-layout-pass`, based on `a957b20`.
Developed and reviewed in the `terraform-ui-pass` worktree before integration into main.

## Preview

Open http://127.0.0.1:8812/sculpt?scratch=ui-review-final in Chrome with WebGPU.
The prepared review map is on the local server: open **Server**, enter
`ui-selection-review`, and choose **Reload**. It contains two terrain strokes,
one metal deposit, and three player starts. Choose **1×** for the detailed render.

The preview uses `/private/tmp/terraform-ui-assets` for its documents and
exports. It reads the existing prepared terrain assets. To restart it:

```sh
cd /Users/daniel/.codex/worktrees/terraform-ui-pass/terraform
/Users/daniel/src/terraform/.venv/bin/python sculpt.py --port 8812 --assets-root /private/tmp/terraform-ui-assets --prepared
```

## What changed

- Fixed top-left minimap with pointer capture for continuous click-and-drag
  navigation; arrow-key navigation is also available.
- Coloured SVG tool icons and hover/focus labels below the minimap.
- Select replaces the visible Move tool. It exposes move, rotation, scaling,
  height editing, deletion, and a path mode with draggable, insertable, and
  deletable points. The saved tool key remains `move` for compatibility.
- Features and starts are a toolbar tool with placement, deposit, starts,
  erase, and fill modes; only the relevant settings appear.
- Collapsible brush groups with effect switches. Disabled effects collapse;
  switching an effect back on restores its previous value during the session.
- Top-bar sketch save/load, server documents, undo/redo, zoom, rendered/clay.
- Right-side World, Map, Export, and Graphics tabs, with layers below them.
- Newest layers appear first. Drag to reorder, use the arrow buttons, and
  toggle visibility per row. Changes participate in terrain undo/redo.
- Thin footer with tool guidance and elapsed viewport render time. Detailed
  renderer memory statistics live under Graphics.
- Alternate-lighting and legacy weathering controls are hidden. Their stored
  values remain readable so this UI pass does not rewrite existing map art.
- Server document controls lock during startup/save/load, preventing partial
  loads while the editor or a save is still initializing.

## Verification

Checked in Chrome with the real WebGPU renderer:

- All 15 terrain tool panels switch successfully.
- Plateau and hill painting, layer selection, path dragging, point insertion
  and deletion, and undo.
- Rotation by 15 degrees and scaling by 1.1, verified in the saved graph.
- Drag-and-drop layer reordering and visibility changes, including undo.
- Effect switches collapse when off and restore an edited mask choice.
- Metal deposit placement and adding a player start.
- Minimap dragging, zoom, and clay/rendered switching.
- Server save/reload across a full page reload: two strokes, one feature,
  three starts preserved.
- Complete `.ufo` export: 411 unique tiles / 4420 slots, one feature and
  three starts; the export helper's self-check passed.
- Layout at the normal window size and 1024 × 768; tabs and Graphics controls.
- No application errors in Chrome's console during the completed checks.
- JavaScript syntax checks, Python syntax, unique HTML IDs, and
  `git diff --check` passed.

The additional native sketch-download automation stalled; file download and
file-picker round-trip were not verified. Server document round-trip and
map archive export were verified separately. Mobile layouts and a full
cross-biome rendering regression were outside this first UI review pass.

## Canvas, selection, and tool organization refinement

- Narrower sidebars and a smaller minimap leave more room for the terrain.
  **Tools** and **Inspector** independently collapse; their arrangement is
  remembered in this browser. **Focus / Shift F** hides both sidebars and
  restores the previous arrangement when toggled again. Resizing preserves
  the view centre at fixed zoom. The view and selection controls stay reachable.
- Select and Features have labelled buttons. Terrain brushes are grouped into
  **Land**, **Water**, and **Surface**, retaining their coloured icons and
  hover/focus labels.
- Hover previews identify strokes before selection. Move, rotate, and scale
  handles share geometry with their hit targets, retain constant screen sizes,
  and remain reachable for partially visible strokes.
- Transform and Edit path modes have distinct colours and a small canvas
  toolbar, usable with the sidebars hidden. **P** toggles path editing;
  **V** switches to Select/Transform without dropping the selected stroke.
- Precise centre X/Y, rotation, and scale fields commit on Enter or blur.
  Escape cancels an in-progress numeric edit. Each edit is undoable.
- Arrow keys on the canvas nudge the selected stroke or path point by one
  map unit; Shift increases this to ten. Shift constrains a dragged point
  to one axis, snaps rotation to 15° increments, and scale to 10% increments
  relative to the start of the drag. Path mode only drags points.
- Loading a server document now creates a history checkpoint, so undoing its
  subsequent edits returns to the loaded terrain.

Verified in Chrome with WebGPU:

- Independent sidebar collapse and focus/restore; canvas width grows from
  852 to 1,372 px at the review window size without shifting its centre.
- Visible move/rotate/scale handles; path-point drag, insertion, deletion,
  and keyboard nudging. Saved graph confirmed a (+21, −30) point edit while
  the other eight points remained unchanged.
- Numeric X = 1,000, rotation = 30°, and scale = 120%, verified in the saved
  graph; three undos restore the original loaded stroke exactly.
- All 16 terrain/selection buttons and the Features tool still switch;
  P/V mode changes keep the selected stroke. Focus shortcut works in Features
  too (Escape first leaves feature placement, then exits focus).
- 1,024 × 768 layout, normal window layout, and canvas focus view.
- Six geometry tests pass with `node --test repro/selection.test.mjs`, covering
  transform pivots, existing transforms, invalid numeric values, long paths,
  zoom-independent hit targets, path selection, and offscreen/hidden strokes.
- JavaScript/Python syntax, unique HTML IDs, and `git diff --check` pass.
- No application errors in Chrome during the completed refinement checks.

The review map has been restored to its original sample geometry after testing.
