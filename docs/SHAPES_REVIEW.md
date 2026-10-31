# Shapes and paths review

Branch: `ui/multipath-shapes`, based on the merged UI pass (`eab38f7`).
This pass was prepared in the `terraform-ui-pass` worktree and reviewed before
merging into `main`.

## Try it

Open http://127.0.0.1:8812/sculpt?scratch=shape-path-review in Chrome.
Under **Server**, enter `ui-shapes-review` and choose **Reload**. This is a
separate review copy; the existing review document is preserved.
Choose **1×**, select the Hill in **Shapes**, and choose **Edit paths**.
The hill has three paths, including two branches attached to its original path.

- A brush button or **New shape** begins a new shape. On release the shape
  is selected, ready to transform or add paths.
- **Add path** draws into the selected shape with its existing settings.
  Start on an existing point to attach the new path there, or start elsewhere
  for a disconnected path. Escape returns to selection.
- In **Edit paths**, choose a path and click a point. **Insert point** adds a
  midpoint on the following segment. **Extend / branch** lets you click new
  points: an endpoint extends its path; an interior point of the selected path
  starts a new branch. Escape ends extension.
- Shared junctions are a single point: dragging or nudging one moves all
  attached paths. The free end of a branch can be edited independently.
- **Delete point** removes that point from every path that references it.
  **Delete path** removes only the selected path and its unused points.
  A shape keeps at least one path and one point; use **Delete shape** to remove it.
- Visibility, whole-shape transforms, shared brush settings, shape ordering,
  undo/redo, and save/reload continue to work. Groups and inherited settings
  are deferred.

## Geometry and persistence

Shapes retain their existing `points` array. Optional `paths` arrays contain
indices into those shared points. Older shapes without `paths` mean one path
through their existing points, preserving the original order and appearance.
The overlay, hit testing, transforms, history, and renderer use this topology.

The renderer prepares each path separately and combines all its segments in
one shape operation. Paths never acquire an implicit connecting segment and
overlap does not repeatedly add height or apply paint. Smoothing and coastal
effects run once over the combined footprint. Separate shapes retain their
ordered terrain operations. Ramps have endpoint reads for each path, all from
the terrain before the shape. Plateau/crater height anchors remain shape-wide.

New sketches use format version 6; versions 4 and 5 still load. New saves require
this editor version. Path references are validated before a document is applied.

## Checks

- `node --test repro/paths.test.mjs repro/selection.test.mjs`: 12 passing tests.
  These cover legacy paths, shared junctions, disconnected paths, insertion,
  deletion, history-safe copying, invalid references, ramp endpoint addressing,
  hill tangent frames, and selection geometry at different zoom levels.
- `repro/pathcheck.html` runs the real shaders with WebGPU. Serve the repository
  with `python3 -m http.server 8813 --bind 127.0.0.1`, open
  http://127.0.0.1:8813/repro/pathcheck.html, and press **Run GPU checks**.
  All 15 terrain tools passed in whole-map and paged modes: duplicating a path
  produced zero difference across the 31 authored planes. Additional checks
  confirmed untouched gaps, non-stacking intersections, independent ramp
  endpoint reads, and stacking between separate shapes.
- Live editor: legacy document loading; adding an attached path; moving its
  shared root (+30, −20) without moving the other points; creating a branch
  by clicking two new points; explicit new-shape creation; a disconnected
  added path; point insertion/deletion; whole-path deletion; undo/redo; and
  full-page reload of the version 6 document. Saved graph assertions confirmed
  shared references, unchanged shape parameters, and preserved shape count.
- JavaScript/Python syntax, unique HTML IDs, and `git diff --check` pass.

The automated GPU cases use representative basic settings, not every combination
of biome presets and optional effects. Export packaging was not rerun in this pass.
