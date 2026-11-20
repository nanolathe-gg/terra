# Map, world and local settings: a proposal

Status: **decided** (owner, 2026-11-19), being built on branch
`proposal/map-scope`. Written 2026-11-19 against main b769206e. Code
references are to that commit. **[code]** means I read it in the source,
**[inferred]** means I traced it but did not run it in a browser.

## Owner's decisions (2026-11-19)

These override the options and recommendations in sections 2 to 8.

1. **Storage: A, a full snapshot.** "This is safest. Each file can be its own
   world and won't change." Retuning a built-in world never changes an
   existing map or file.
2. **No "changed" marks on world values.** "This just makes things confusing
   without much added value." Strokes keep their existing `edited` lists,
   which let a world switch keep what was changed by hand on a shape.
3. **Start a map lists only the built-in worlds.** Any other look is started
   from a map file or a map link ("start a new map from here"). Anything kept
   only in this browser can be cleared with the browser's cache, so it is not
   offered as a world.
4. **Changing the base world keeps the fork**: the copy gets the new world and
   the original stays in Maps.
5. **Stored worlds are converted once** into empty maps, then the store goes.
6. **The pane keeps the name World.**
7. **Apply look keeps the seven cards**: Ground, Water, Rock types, Surface
   layers, Light & weather, Tools, Features.

"Go ahead and capture these decisions, then implement everything."

## As built (branch `proposal/map-scope`, 2026-11-19)

Where this differs from sections 2 to 8, this section wins.

- **The map holds everything** that changes the export or is kit:
  - every row's value;
  - the colors;
  - the world materials;
  - the surface layers;
  - the rock column, with the built-in's own column normalized back on load;
  - the feature styles, rock types and tools;
  - the world's engine tables (`material`, `water` and `placement`,
    `worldSettings.engine`). Retuning one of these changed a saved map's
    pixels, so they are kept too.

  `repro/map-snapshot.mjs` retunes nine parts of Green and checks that a
  saved map's save and pixels stay the same.
- **Still built from data, not kept:**
  - the toolbar's built-in buttons and their presets (for new shapes only);
  - rock recipes and material starting points (for adding only);
  - the feature generator's tables (for new features only).
- **Local:** the GPU budget, preview quality, panels and weathered view.
  - The TA palette and Art/Clay stay map settings. Export does not visibly
    force either one, so moving them could change exported art. This is
    unverified, so they were left alone.
  - The camera key `view` no longer counts as a world setting.
- **No world store.** It is read once to convert, then removed:
  - every world of your own, and every built-in world you changed, becomes
    an empty 4 × 4 map named after it;
  - a world a map brought with it (`openedFrom`) is skipped;
  - a map made by an earlier build gets its world tools turned into map
    tools, and its rock types lose their world provenance, when it is opened
    or used as a look source (`mapOwnedKit`).
- **Start a map** lists only the built-in worlds. To use another map's look,
  open its file or link, then choose **Map › New map with this look**.
- **World › Apply look from…** takes a built-in world, one of this browser's
  maps, or a map file.
  - It has the seven cards, plus the choice to keep or reset hand-edited
    shape settings.
  - Within one world it applies in place as one undo step.
  - A whole look from another world forks the map there.
  - Its note says how many rock types and tools it replaces.
- **Apply look replaces the world select, Reset and Reset shapes** (owner,
  2026-11-19: "Fold into Apply look"). The dialog opens on the map's own
  built-in world with every card checked, which is a full reset; another
  world, whole, is a world switch (a fork); no card with "Reset every
  shape" resets the shapes. A world switch now takes the other world's rock
  types and tools too: to keep this map's, apply Rock types or Tools from
  the map left behind (it stays in Maps).
- **No "changed" marks on world values.** Strokes' existing `edited` lists
  are now saved in files and share links too.

## 1. What is wrong today

Every World row says "Every map in Green Planet". The editor cannot keep that
promise, and it spreads one artist's work over six places.

**Where things are kept.**

| Store | What it holds |
| --- | --- |
| Map body (IndexedDB) | Strokes, rock types 1-15, all materials, map tools, brush cards, the rock column, and a **full snapshot of the world** (`worldSettings`: about 357 knob values, colors, kept materials, surface, authored kit) |
| World store (localStorage) | Your edits to each world: knobs, colors, materials, surface, feature defaults, world tools, world rock catalog |
| World files | A third format, assembled partly from the open map |
| Share links | The map body, world snapshot included |
| Browser settings | Panels, preview quality, GPU budget, weathered view |
| Undo history | Includes world-store snapshots |

**The live link does not work.** Edit a World row in map B and the store
changes. Reopen older map A: its snapshot no longer matches, so A opens in a
new world, "Green Planet from A" (`sculpt.js:3209-3214`, `sameSavedWorld` in
`sculpt-save.js:52`) **[code]**. World edits reach new maps and maps whose
snapshot still matches, and nothing else. The machinery for a shared, live
world exists, but it delivers forks.

**Other consequences [code unless marked]:**

- **Two tabs overwrite each other's worlds.** `loadWorlds` runs once at boot
  and `saveWorlds` writes the whole object, so the last tab to save wins for
  every world. Undo in one tab can roll back another tab's world edits.
- **Deleted worlds come back** whenever you open a map that embeds one
  (`sculpt.js:3215`).
- **A share link made in one of your own worlds opens in the built-in base**,
  with its values as session overrides **[inferred]**.
- **The camera key `view` sits in `worldKeys`**, so a map saved after a world
  switch can fork its world on the next refresh. A probe of the pure functions
  confirms the comparison fails; the browser path is **[inferred]**.
- **One pane writes to three scopes.** Most rows go to the world. The world's
  rock rows go to both the world and the map. Its beds (the rock column) go to
  the map only. The TA palette toggle sits in View but is stored per world.
  This was problem 7 of the 2026-11-09 audit (`docs/REDESIGN_PLAN.md:740`),
  and it is still true.
- **Silent scope changes:**
  - Save as tool to the world quietly makes the shape's rock type
    world-owned.
  - Deleting a world-owned rock type removes it from the world without
    saying so.
  - Reset drops the tools you authored for the world, although its tooltip
    says it keeps map content.
- **Rules a map maker has to learn:** "Save new rock types to This world /
  This map"; built-in worlds keep their rock types in the map, your own worlds
  keep them in the world; "Use for my Green Planet"; "Green Planet before
  <map>"; switching world forks the map.

**What it costs to keep.** `sculpt-world-kit.js` (20 KB),
`sculpt-save.js` (7.5 KB), about 11 KB of world-material adopt/keep logic in
`sculpt-materials.js`, and roughly 35 KB of `sculpt.js` (World panel, New
world, Reset, import/export, adopt, boot reconciliation, rock scope). Its
tests are mainly `repro/world-kit.test.mjs` (213 lines) and
`save.test.mjs` (68).

## 2. The proposal: one document, many starting points

The owner's idea, sharpened:

> **The map holds everything an artist made or chose. The browser holds only
> what describes this machine or this session. A world is a starting point
> for a map, not a place a map lives.**

### 2.1 Which scope a setting has

Two tests decide it.

1. **Map:** the setting changes the exported map, **or** it is kit that a
   collaborator opening the map needs to keep working. Kit means the tool
   list and brush cards, rock types and materials (including unused ones),
   feature-set defaults and surface layers.
2. **Local:** the setting describes this machine or this session.

| Setting | Today | Proposed |
| --- | --- | --- |
| Strokes, size, sea level, base height, seeds | Map | Map |
| World rows (KNOBS), colors, light and sun | World + map snapshot | **Map** |
| Ground, water, role and layer materials | World wins on load | **Map** |
| Surface layers | World | **Map** |
| Rock types and the world's rock | Map slots + world catalog + `worldKey` provenance | **Map** |
| Rock column | Map | Map |
| Tools (built-in list, authored, map tools) and brush cards | Config + world + map | **Map** (one list) |
| Feature set and placements | Map, world seeds new maps | Map |
| Erosion switch (`weather`), relief, softness, material weathering, deposit spread, transition detail | Map | Map: they change heights and art |
| TA palette | World knob (it sets the renderer's `uQuantize`), toggle in View | **Local** if export applies the palette regardless; map if it does not. Unverified |
| Art/Clay (`clay`) | Map | **Local** (a view mode) if export forces Art. It feeds `drawOptions`; unverified |
| `light` (hidden original/alternate) | Map | Map if it changes final art; otherwise remove it |
| Camera, selection, open panel | Carried only through reloads | Local, per map id (IndexedDB meta, not the body) |
| GPU budget, preview quality, panels, weathered view | Local | Local |
| Clipboard (rock recipe, material) | System clipboard | Unchanged |

Before building, verify each row in this table against what export reads,
not against its label.

### 2.2 Worlds become starting points

A starting point is any of:

- **A built-in world:** the shipped `materials/<world>.json`, read-only.
- **Any map you have:** its look and kit, without its strokes.
- **A share link.**

**Start a map** lists the built-in worlds, then your maps. Choose one and a
size, and you get a blank map with that look and kit. There is no "Save as new
world": to keep a look, keep a map. An empty map named "Ash Desert" is a
world. If the Maps list should stay uncluttered, add one optional mark,
"Show in Start a map" (owner decision 2).

**Opening a share link** asks one thing: **Open this map** or **Start a new
map with its look**. That is the owner's "create new map from this link". The
separate world file format goes away; Download file is the map.

### 2.3 One command for looks: Apply look from…

**Apply look from…** replaces:

- the world select (switch world)
- Use for my world
- Reset
- Import world (a map file is a source)
- Reset shapes to world defaults

Save as new world and Delete this world need no replacement: you keep or
delete a map.

The dialog has three parts:

1. **Source:** a built-in world, one of your maps, a map file, or a link.
2. **What to take**, one checkbox per World home card: Ground, Water, Rock
   types, Surface layers, Light & weather, Tools, Features. All are checked by
   default. Unchecked cards keep this map's settings.
3. **Shapes:** "Keep what I changed by hand" (the default) or "Reset every
   shape to the new tools' defaults".

These cover today's flows:

| Today | With Apply look |
| --- | --- |
| Switch to Desert | Apply look from Desert, all cards |
| Reset | Apply look from the built-in base, all cards |
| Use another map's rock types in this one | Apply look from that map, Rock types only |
| Reset shapes to world defaults | Apply with no cards checked and "Reset every shape" |

Today you can borrow single rock types (Copy/Paste, "Add a rock type
from…"). Apply look adds whole cards from any source in one step, for example
Desert's rock types and light under Green's ground.

**What happens to shapes.** This is what `carryNodes`/`carryStrokes` do today
(`sculpt.js:1943`, `sculpt-tools.js:74`): settings a shape's artist changed
by hand stay, and the rest take the new tool's defaults. A tool the new kit
lacks becomes Landform, the round-trip loss the owner accepted on 2026-11-11.
A stroke with no `edited` list keeps every number as it is.

**Rocks and materials map by key, then by name, then to the default rock.**
Ground and water map by role. Apply checks the 15 rock slots and the material
budget **before** changing anything. If they don't fit, it refuses and says
which card overflowed, with no partial change. `instantiateWorldKit` already
works this way.

**Undo.** If the base world doesn't change (applying from another Green map,
Reset, partial applies within one base), Apply is in place and one Undo step.
A partial apply from a source with a different base (Desert's rock types into
a Green map) keeps this map's base. Whether every card works under another
base's engine data is unsized: the kit code already has a path for "a world
rock type needs a material role this world does not have".
Changing the base world reloads the page today (`goToWorld` →
`leaveFor`), because the world config is loaded at boot. Two options
(owner decision 3):

- **(a) Keep the reload and "Fork it" (owner, 2026-11-19).** The copy gets
  the new look and the original stays in Maps. The fork stands in for Undo.
- **(b) Apply in place with Undo.** This needs a second config loaded without
  a reload. It is engineering I have not sized.

Recommendation: (a) now, (b) only if forks crowd the Maps list.

### 2.4 Libraries

- **Built-in libraries stay app data:** the rock recipes (31), material
  starting points, shape presets and the palette.
- **No personal library store.** Your other maps are the library:
  - "Add a rock type from…" and the material library drawer gain a
    **From your maps** group, which reads rock types and materials from saved
    maps (their meta or bodies).
  - Copy/paste keeps working through the clipboard.

### 2.5 Wording

- All scope tags go except **This shape** / **New shapes** on the brush card,
  the one place where scope still means something.
- The World pane header reads "Started from Green Planet · 12 changes",
  with Compare/Reset next to it.
- The pane can keep its name. "Look" is the alternative (owner decision 5).

## 3. How a map stores its look (owner decision 1)

This is the owner's call: it decides whether retuning a built-in world
changes existing maps.

The question covers the kit as well as the rows. Built-in tools and the
world's rock catalog are derived from config today on purpose, so that config
revisions reach every world (`sculpt-world-kit.js:67`, `:79`).

| | A. Full snapshot | B. Sparse diff against the built-in | C. Full values plus recorded "set on purpose" marks |
| --- | --- | --- | --- |
| Map is self-contained | Yes | No: it needs the same build's config | Yes |
| Retuning Green changes existing maps | Never | Silently, including what share links show | Only unmarked values, and only through "Update from Green" (or automatically, by policy) |
| "12 changes" and Reset | Computed by comparing with today's built-in, which drifts as it is retuned | Free | Exact: the marks |
| Size | About today's (~150 KB) | Smallest | About today's |

**What a mark means under C.** A mark is recorded when a value is set, not
computed by comparison. That differs from strokes' `edited` list, which
`markEdited` computes at save time against the tool's defaults. Comparison
breaks once the built-in is retuned: an old default suddenly "differs".

- Editing a row, rock type, tool or material marks it.
- **Apply look from a built-in world** takes its values for the checked cards
  and clears their marks: they follow that world again.
- **Apply look from a map** (including Start a map from "Ash Desert") copies
  its values **and its marks**. Anything taken from a source with a different
  base arrives marked, because it is not this base's.
- **"12 changes"** counts marks: differences from the built-in base,
  inherited ones included. The header says so: "Started from Ash Desert ·
  based on Desert · 12 changes". Reset returns to built-in Desert; Apply look
  from Ash Desert returns to Ash Desert.
- **Kit:** the same rule per entry. Unmarked built-in tools and rock types
  follow the base, which keeps today's "config revisions reach every world" for
  untouched entries. Authored or edited entries are marked and stay.

**Recommendation: C.** It matches "everything is in the map", it makes the
count exact, and it keeps one storage path. Before release, during heavy
tuning, the owner may choose that unmarked values follow the built-in
automatically on load (B's behavior), and switch that off at release. That is
a policy choice, not a second storage path.

**Share links and files.** Strokes' `edited` lists are written only into the
browser's working copy (`workingCopy()`, `sculpt.js:1928`). Download file and
share links use `sketch()`, which drops them. A stroke without the list keeps
every number on a world switch (`carryStrokes`), so a map that arrives by
link does not carry its unedited settings to a new world's defaults. Put the
lists, and the look's marks, in `sketch()`. I expect no Worker change, since
the marks sit inside existing top-level fields **[inferred: I read only its
top-level whitelist]**.

**What stays in the built-in config whatever the choice:** engine-only world
data (`engineDefaults`), the export catalog and climate, and the shape-preset
and recipe libraries. The map keeps one `base` world id that supplies them.
Apply look with every card checked changes the base; a partial apply keeps
it.

## 4. Alternatives considered

1. **Fix the live link** (a world referenced by maps, with per-map overrides,
   like Figma components or CSS).
   - It needs versioning, conflict rules and cross-tab sync.
   - Share links and files can never be live: they must carry a snapshot, so
     the shared picture would still depend on the receiving browser.
   - It is what the current code set out to be, and it ended in forks.
   - **Loses** on complexity, with no clear benefit for one artist making
     maps.
2. **Snapshot maps plus a separate world library that only seeds new maps.**
   The runner-up, and much simpler than today. It still keeps:
   - a second store and a second file format;
   - a second share kind;
   - the "save this tool/rock to the world or the map?" choice.

   "Any map is a starting point" gives the same thing with none of these.
   **Loses** narrowly. Pick it if the owner wants worlds listed apart from
   maps; decision 2's mark gives most of that.
3. **Per-card preset libraries** (ground looks, rock sets, light presets,
   tool kits; a world is a bundle of them). Good for mixing and matching, but
   it means five more stores. Apply look's card checkboxes, with any map as a
   source, deliver the mixing. **Loses** on stores and UI.
4. **Projects** (a map pack sharing one look). Real for map packs, but not
   needed now. If it comes up later: "Apply this look to other maps…" as a
   batch. **Deferred.**

## 5. What this supersedes (the owner approves each)

- MATERIALS.md (2026-11-14): "the world owns its ground and its water…
  every map drawn in that world shows it". Under this proposal the map owns
  them.
- SURFACE_LAYERS.md decisions 4 and 5 (2026-11-16): layer and role materials
  stay with the world, and the surface list is a world setting. Both become
  map settings.
- Commit 2fe50540 (2026-11-17): built-in rock types belong to the map, your
  own worlds' to the world. Everything belongs to the map.
- "Fork it" (2026-11-19): kept for base changes under decision 3(a).
- AGENTS.md rule 9: "their settings become the world's defaults" becomes
  "become the map's, and any map can start new ones".
- AGENTS.md rule 7: "A world is data: its numbers in
  `materials/<world>.json`" stays true for built-in worlds. A map carries a
  copy.
- AGENTS.md rule 8: "Add no separate … save formats". This proposal removes
  the world file format, so it moves closer to the rule.

## 6. Stored worlds (owner decision 4)

Rule 7 says no migrations. The owner's own stored worlds, though, are work.
The options:

- **(a)** One time, turn each stored world into an empty map with its name,
  then drop the store.
- **(b)** Drop the store.

(a) is about 20 lines and runs once. Recommendation: (a), then delete the
code.

## 7. Build order

Each slice lands on its own and leaves the editor consistent.

1. **Scope fixes, no model change:**
   - take `view` out of `worldKeys` (a real bug);
   - write strokes' `edited` lists in `sketch()`, so shared and downloaded
     maps carry like local ones;
   - make the palette toggle and Clay local, if export applies the palette
     and forces Art (verify first).

   These help even if nothing else is built.
2. **The map holds everything:**
   - World edits write the map only;
   - the world store becomes a read-only seed for New map;
   - scope tags and Save-to choices go (everything saves to the map);
   - opening a map never forks or writes a world.
3. **Start a map from any map or link; Apply look from…** Apply replaces the
   world select, Reset, adopt and Reset shapes.
4. **Delete:**
   - the world store and world files;
   - `worldKey` provenance and `sameSavedWorld`, plus the rest of
     `sculpt-world-kit.js` that only reconciles scopes;
   - the migration per decision 4.

Checks per slice: quick, a browser smoke on Green and Desert, `save-load.mjs`
and `share`. Add `config` for slice 4.

## 8. Owner decisions

1. **Storage:** A, B or C (recommended: C, with recorded marks). Before
   release, should unmarked values follow built-in retuning automatically?
2. **Starting points:** every map in Start a map, or only maps marked "Show
   in Start a map" (recommended: the mark).
3. **Changing base world:** fork as today (recommended), or in place with
   Undo.
4. **Stored worlds:** convert once to empty maps (recommended), or drop.
5. **Pane name:** World or Look.
6. **Apply look's cards:** confirm the seven (Ground, Water, Rock types,
   Surface layers, Light & weather, Tools, Features), or merge some.
