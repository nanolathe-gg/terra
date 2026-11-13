# Interface inventory

The current navigation below describes the accepted interface implemented on
2026-11-12. It was checked from the source and with focused Chrome spots on
Green. The 19-world audit, numeric defaults, disabled counts, row totals,
and pixel geometry in the historical appendix were **not remeasured**.
Those numbers describe `8e42ae8e`, before this redesign.

## Current layout and locations

There is one editor, `/sculpt`. The static site's `index.html` forwards to it.
Layout is authored in `sculpt.html`; control rows remain in their World or
Build homes. Storage, save-file fields, undo and rendering use the existing
editor state.

| Area | Current contents and behavior |
| --- | --- |
| Top bar | New, map name and dimensions (Map menu), Open, Save, Undo/Redo; Build/World; current-world badge; Art/Clay/Passability, View, Settings, panel toggles, Focus, Export. Long map names truncate visually and keep the full name in the hover title. |
| Tool rail | Select, Land, Water, Brushes, Features, Starts, Shapes, Expand. Land/Water/Brushes flyouts show tool names and existing rendered examples; Expand keeps the full palette visible. |
| Build side panel | Tool or selected-shape card with Profile, Size & height, Rock & cover, Outline & variation, Details and Advanced groups; features use their existing Place/Erase/Fill modes and kind tabs. Starts has its own rail entry into the same feature state. |
| Shape profile | Cross-section and height-along-path canvases beside the selected-point and bulk numeric editors in Full size. Live terrain preview uses the same renderer. |
| World side panel | World, Colors, Ground, Vegetation, Rock types, Cliffs & stones, Sand, Water & shores, Rain & erosion, Light & shine, Palette. Larger sections have tabs. Search spans authored labels and subgroup names, including hover-only parenthetical explanations, without matching every row solely through an ancestor section name. All includes fine controls. |
| Unavailable World rows | Eligible disabled rows fold by their requirement reason within each subgroup. Keyboard-operable Show/Hide buttons retain their reason, count and row associations. Search reveals matching disabled rows with reasons. Changing a parent setting re-evaluates availability immediately. |
| Rock types | Persistent selected-rock picker with chips, Manage and recipe add. Every tab edits that selected rock; world rock remains slot zero. Layers opens the named rock-column sheet beside the World panel. |
| Rock-column sheet | Selected rock name, proportional colored bed stack (hardness affects inset), existing section/bed numeric table, bands, wander, material slots and Restore world column. Done/Escape closes it; undo/save and load/export locks remain the editor's. Hiding the side panel closes it. |
| Light & shine › Shine | Ground, Slope cover, Sand and Crystal segments filter their existing four material controls; common controls remain available under the existing fine-control/requirement rules. Rock shine stays with the selected rock type in Surface & crust. |
| Features › Fill | Brush/Lasso/Flood segmented buttons write the existing fill region. Density, clustering, spacing, seed, margins and radius stay in the existing fill state. Kind changes refresh the footer hint immediately. |
| Map menu | Name/description, map size and sea level, OTA settings, clear/reset actions and Restore my previous map when one is retained. Shared-map arrival opens this notice here without creating a new share link. |
| Export dialog | Existing .ufo export, cancel/status and viewport PNG export; Share link and Copy are here, using the same service and existing IDs. |
| New / first run | One world-and-size picker, nine engine-rendered authored thumbnails, map name, standard/custom sizes, Create blank map and Open. Uses the existing previous-map slot. Images are committed in `ui-previews/world-*.png` and included in static builds. |
| Canvas | View/zoom controls and navigator overlay; selection actions appear with a selection. Shapes opens its existing list as an overlay. |
| Footer | Tool/feature help, rendering progress/status, timing/height information and saved-state disclosure. |

## Thumbnail reproduction

`node repro/ui-previews.mjs --worlds-only --server <your-server> --port <your-CDP>`
regenerates only the nine default-world thumbnails, preserving the hover
atlases and their manifest entries. Omitting `--worlds-only` regenerates both
sets. The manifest records the authored hill fixture, seed, crop and frame;
all images go through the normal GPU pipeline and wait for export-ready
terrain. No retail map, crop, picture or scene is read. The site test checks
that all nine PNGs ship with the static build.

## Verification scope

The compact browser checks cover the changed navigation and control behavior,
including New/previous restoration, Shine filtering, disabled-row reveal,
column edit/undo, Fill regions and feature hints. This refresh does not claim
a full UI review, control-impact measurement or another 19-world audit.

---

The appendix below preserves the original audit evidence. Its old-location
columns and dimensions are historical; use the current layout above for
navigation. Accepted-destination columns record design intent, and the current
layout takes precedence where the final wording differs.

# Historical baseline audit

Every screen, tab, tool, control and gesture of the editor as it stood on
main `8e42ae8e` on 2026-11-12: what it is, what it does, where it lives,
what it writes to, and where the redesign proposal puts it. 714 rows.

This is a record, not a rule. It was read from the live page; when the page
changes, the page is right. The mockups built from these rows, and the
reasons for the proposed homes, are in the owner's artifact "Terra interface
redesign" (not in the repository).

## How the baseline was read

- One page, `/sculpt`, at 1440 x 900 in Chrome 157 with WebGPU (Apple
  Metal), from a worktree of main with its own server and browser profile.
  Each of the 9 worlds and 10 looks (variants) was loaded fresh and its panes
  read before any edit: green, green-evad, green-modern, red, archipelago, moon, moon-pitted, moon-cracked, zhon, zhon-river, lava, desert, desert-triad, desert-modern, crystal, ice, ice-bergs, ice-crystal, ice-snow.
- For each load: the toolbar, each tool's card with every group open, the
  Features tool's four modes and six kinds, the World tab with fine controls
  on, the Map, Shapes, Export and Settings panes, the top bar, the dock, the
  footer and the map's own bars.
- "Green value" is the value on Green Planet with no look chosen (for a row
  Green lacks, the first world that has it). "Worlds"
  counts the 19 world and look loads in which the row is disabled, with the
  panel's own reason.
- "Saved in" was read from the code (`sketch()` in `sculpt.js`, the world
  store, the storage keys), not measured.
- "Accepted destination" is direction B of the redesign proposal, which the owner
  chose on 12 November. Every row has one (a script fails otherwise). No
  control is removed and every id is kept.
- Rock & cliffs splits in two there. "Rock types" holds the rows that read
  and write the selected rock type (`ROCK_KEYS`, its name, colors and
  column) under a picker that stays in view. "Cliffs & stones" holds the
  world's rows that act on every rock type.
- Not swept here: how much each row changes the picture. The last sweep
  (9 November, Green only) is stale and is not repeated in this file.

## Historical geometry at 1440 x 900

| Region | Position and size (px) |
| --- | --- |
| Top bar | 1440 × 48 |
| Toolbar (left) | 88 × 660, two columns of icons |
| Map view | 1048 × 628 (50.8% of the window), under a 32 px caption bar |
| Side panel (right) | 304 × 828; tabs Tool, World, Map, Shapes; Export and Settings open from the top bar |
| Dock (bottom) | 1136 × 168: navigator, cross-section, length vs. height |
| Footer | 1440 × 24 |

There is one screen. The build's `index.html` only forwards to it.

## Historical counts

| Area at the baseline | Rows |
| --- | --- |
| World | 361 |
| Settings | 9 |
| Shape card | 114 |
| Tool tab | 22 |
| Features tool | 76 |
| Toolbar | 37 |
| Map | 17 |
| Shapes | 6 |
| Export | 6 |
| Top bar | 20 |
| Dock | 8 |
| Canvas | 11 |
| Footer | 6 |
| Hidden | 1 |
| Keyboard & pointer | 14 |
| Address parameters | 6 |
| **Total** | **714** |

| Measured | Value |
| --- | --- |
| World tab height, default view, by world | 10016 to 11333 px (Green 10405); the panel shows 787 px |
| World tab height with fine controls and every group open | 12930 to 14384 px |
| World slider and choice rows | 246 in the World tab (176 in the default view, 70 fine) and 3 in Settings (Palette) |
| World rows disabled, by world or look | green 65, green-evad 65, green-modern 57, red 67, archipelago 72, moon 62, moon-pitted 67, moon-cracked 79, zhon 87, zhon-river 87, lava 70, desert 71, desert-triad 72, desert-modern 48, crystal 71, ice 74, ice-bergs 82, ice-crystal 82, ice-snow 82 |
| Rows on a tool's card on Green (visible with groups open) | move 6, landform 50, plateau 51, hill 49, mountain 51, knoll 49, ramp 48, valleyV 47, valleyU 47, valleyT 50, crater 51, fissure 23, deep 47, shallow 49, river 43, braided 43, smooth 8, erase 10, paint 11, sand 9, grass 9 |
| Card height with groups open | Plateau 1792 px, River 1514 px, a tree style 1727 px |

## Tools

| Tool | Key | Group at the baseline | What it does | Worlds | Accepted destination |
| --- | --- | --- | --- | --- | --- |
| Select | `move` | Select and place | Select a shape to edit its curves, settings, paths or transform. (mode; 6 rows on its card) | all 19 | Build › Tool rail › Select |
| Features & starts | `features` | Select and place | Place map features and player start positions. (mode; 25 rows on its card) splits into Features and Starts on the rail (same tool underneath) | all 19 | Build › Tool rail › Features |
| Landform | `landform` | Shape tools | (the one Landform shape with its own starting values; 50 rows on its card) | all 19 | Build › Tool rail › Land |
| Plateau / Mesa | `plateau` | Shape tools | A broad, level top with steep sides. (the one Landform shape with its own starting values; 51 rows on its card) named by the world: Plateau on green, green-evad, green-modern, red, archipelago, moon, moon-pitted, moon-cracked, zhon, zhon-river, lava, crystal, ice, ice-bergs, ice-crystal, ice-snow; Mesa on desert, desert-triad, desert-modern | all 19 | Build › Tool rail › Land |
| Hill | `hill` | Shape tools | A rounded ridge with a gentle crest. (the one Landform shape with its own starting values; 49 rows on its card) | all 19 | Build › Tool rail › Land |
| Mountain | `mountain` | Shape tools | A narrow, pointed crest; a path makes a range. (the one Landform shape with its own starting values; 51 rows on its card) | all 19 | Build › Tool rail › Land |
| Knoll | `knoll` | Shape tools | (the one Landform shape with its own starting values; 49 rows on its card) | 3 of 19: green, green-evad, green-modern | Build › Tool rail › Land |
| Ramp | `ramp` | Shape tools | An incline along a path. (the one Landform shape with its own starting values; 48 rows on its card) | all 19 | Build › Tool rail › Land |
| V valley | `valleyV` | Shape tools | A narrow, V-shaped cut. (the one Landform shape with its own starting values; 47 rows on its card) | all 19 | Build › Tool rail › Land |
| U valley | `valleyU` | Shape tools | A broad valley with a rounded floor. (the one Landform shape with its own starting values; 47 rows on its card) | all 19 | Build › Tool rail › Land |
| Terraced valley | `valleyT` | Shape tools | A valley with steps along its sides. (the one Landform shape with its own starting values; 50 rows on its card) | all 19 | Build › Tool rail › Land |
| Crater | `crater` | Shape tools | A bowl with a raised rim. (the one Landform shape with its own starting values; 51 rows on its card) | all 19 | Build › Tool rail › Land |
| Fissure | `fissure` | Shape tools | A narrow fracture cut into the ground. (its own shape kind; 23 rows on its card) | all 19 | Build › Tool rail › Land |
| Deep water / Lava lake | `deep` | Water tools | Cut below sea level to make deep water. (the one Landform shape with its own starting values; 47 rows on its card) named by the world: Deep water on green, green-evad, green-modern, red, archipelago, zhon, zhon-river, desert, desert-triad, desert-modern, crystal, ice, ice-bergs, ice-crystal, ice-snow; Lava lake on lava | 16 of 19: green, green-evad, green-modern, red, archipelago, zhon, zhon-river, lava, desert, desert-triad, desert-modern, crystal, ice, ice-bergs, ice-crystal, ice-snow | Build › Tool rail › Water |
| Shallow water / Lava shallows | `shallow` | Water tools | Cut a shallow shelf beneath the water. (the one Landform shape with its own starting values; 49 rows on its card) named by the world: Shallow water on green, green-evad, green-modern, red, archipelago, zhon, zhon-river, desert, desert-triad, desert-modern, crystal, ice, ice-bergs, ice-crystal, ice-snow; Lava shallows on lava | 16 of 19: green, green-evad, green-modern, red, archipelago, zhon, zhon-river, lava, desert, desert-triad, desert-modern, crystal, ice, ice-bergs, ice-crystal, ice-snow | Build › Tool rail › Water |
| River / Lava river | `river` | Water tools | A water channel along the path; bends build sand bars. (the one Landform shape with its own starting values; 43 rows on its card) named by the world: River on green, green-evad, green-modern, red, archipelago, zhon, zhon-river, desert, desert-triad, desert-modern, crystal, ice, ice-bergs, ice-crystal, ice-snow; Lava river on lava | 16 of 19: green, green-evad, green-modern, red, archipelago, zhon, zhon-river, lava, desert, desert-triad, desert-modern, crystal, ice, ice-bergs, ice-crystal, ice-snow | Build › Tool rail › Water |
| Braided river / Lava channels | `braided` | Water tools | A mostly dry gravel bed with thin threads of water. (the one Landform shape with its own starting values; 43 rows on its card) named by the world: Braided river on green, green-evad, green-modern, red, archipelago, zhon, zhon-river, desert, desert-triad, desert-modern, crystal, ice, ice-bergs, ice-crystal, ice-snow; Lava channels on lava | 16 of 19: green, green-evad, green-modern, red, archipelago, zhon, zhon-river, lava, desert, desert-triad, desert-modern, crystal, ice, ice-bergs, ice-crystal, ice-snow | Build › Tool rail › Water |
| Smooth | `smooth` | Paint tools | Soften changes in height beneath the brush. (a brush stroke; 8 rows on its card) | all 19 | Build › Tool rail › Brushes |
| Reset ground | `erase` | Paint tools | Bring terrain back toward the base ground. (a brush stroke; 10 rows on its card) | all 19 | Build › Tool rail › Brushes |
| Surface paint | `paint` | Paint tools | Paint materials and local surface effects (23 channels). (a brush stroke; 11 rows on its card) | all 19 | Build › Tool rail › Brushes |
| Sand cover | `sand` | Paint tools | Paint sand coverage onto the terrain. (a brush stroke; 9 rows on its card) | all 19 | Build › Tool rail › Brushes |
| Ground cover | `grass` | Paint tools | Restore ground cover beneath the brush. (a brush stroke; 9 rows on its card) | all 19 | Build › Tool rail › Brushes |
| Granite tor | `tor` | Shape tools | (the one Landform shape with its own starting values; 53 rows on its card) | 1 of 19: green-modern | Build › Tool rail › Land |
| Basalt wall | `basaltWall` | Shape tools | (the one Landform shape with its own starting values; 51 rows on its card) | 1 of 19: green-modern | Build › Tool rail › Land |
| Limestone scarp | `limestoneScarp` | Shape tools | (the one Landform shape with its own starting values; 52 rows on its card) | 1 of 19: green-modern | Build › Tool rail › Land |
| Canyon | `canyon` | Shape tools | (the one Landform shape with its own starting values; 51 rows on its card) | 1 of 19: red | Build › Tool rail › Land |
| Island | `island` | Shape tools | (the one Landform shape with its own starting values; 49 rows on its card) | 1 of 19: archipelago | Build › Tool rail › Land |
| Reef | `reef` | Water tools | (the one Landform shape with its own starting values; 51 rows on its card) | 1 of 19: archipelago | Build › Tool rail › Water |
| Small crater | `smallCrater` | Shape tools | (the one Landform shape with its own starting values; 50 rows on its card) | 3 of 19: moon, moon-pitted, moon-cracked | Build › Tool rail › Land |
| Old basin | `basin` | Shape tools | (the one Landform shape with its own starting values; 50 rows on its card) | 3 of 19: moon, moon-pitted, moon-cracked | Build › Tool rail › Land |
| Rille | `rille` | Shape tools | (the one Landform shape with its own starting values; 47 rows on its card) | 3 of 19: moon, moon-pitted, moon-cracked | Build › Tool rail › Land |
| Cinder cone | `cone` | Shape tools | (the one Landform shape with its own starting values; 49 rows on its card) | 1 of 19: lava | Build › Tool rail › Land |
| Obsidian / Crystals / Iceberg | `crystal` | Shape tools | Clusters of faceted crystals, columns or blocks. (the one Landform shape with its own starting values; 59 rows on its card) named by the world: Obsidian on lava; Crystals on crystal; Iceberg on ice, ice-bergs, ice-crystal, ice-snow | 6 of 19: lava, crystal, ice, ice-bergs, ice-crystal, ice-snow | Build › Tool rail › Land |
| Butte | `butte` | Shape tools | (the one Landform shape with its own starting values; 54 rows on its card) | 3 of 19: desert, desert-triad, desert-modern | Build › Tool rail › Land |
| Hoodoos | `hoodoos` | Shape tools | (the one Landform shape with its own starting values; 60 rows on its card) | 3 of 19: desert, desert-triad, desert-modern | Build › Tool rail › Land |
| Shale badlands | `badlands` | Shape tools | (the one Landform shape with its own starting values; 51 rows on its card) | 1 of 19: desert-modern | Build › Tool rail › Land |
| Crystal spires | `spires` | Shape tools | (the one Landform shape with its own starting values; 60 rows on its card) | 1 of 19: crystal | Build › Tool rail › Land |

Each world lists its own shape and water tools (20 of the 37 rows above are on some worlds only; a
variant is counted as a world here). Select, Features, Landform, Fissure and
the five Paint tools are on every world. Every shape and water tool is the
one Landform shape with its own starting values, and they share one card;
Fissure is its own shape kind; the Paint tools are brush strokes. A map can
add tools of its own (Save as tool). Select has the shortcut V. Tools show an
icon only; the name, and a rendered example where `ui-previews/` has one,
appear on hover.

## Top bar

| Control | Id or key | Kind, range, Green value | What it does | Saved in | Shown at the baseline | Worlds | Accepted destination |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Save | `save` | button | Download the map recipe | editor | default view |  | Top bar › File › Save map file |
| Load | `load` | button | Open a saved map recipe | editor | default view |  | Top bar › File › Open map file |
| Share link | `share-url` | text |  | editor | hidden until needed |  | Top bar › Export dialog › Share link |
| Copy | `share-copy` | button |  | editor | hidden until needed |  | Top bar › Export dialog › Share link |
| Restore my previous map | `share-restore` | button | Your own map was kept when this one opened. | editor | hidden until needed |  | Top bar › Map menu › Restore my previous map (after a shared map opens) |
| ↶ Undo | `undo` | button | Undo · ⌘ / Ctrl Z | map file | default view |  | Top bar › Undo / Redo |
| ↷ Redo | `redo` | button | Redo · ⌘ / Ctrl Shift Z | map file | default view |  | Top bar › Undo / Redo |
| Export | `open-export` | button |  | editor | default view |  | Top bar › Export button |
| Settings | `open-graphics` | button |  | editor | default view |  | Top bar › Settings |
| Fit | `fit` | button |  | editor | default view |  | Canvas › Zoom cluster |
| 1× | `one` | button |  | editor | default view |  | Canvas › Zoom cluster |
| − | `zoom-out` | button |  | editor | default view |  | Canvas › Zoom cluster |
| Zoom | `zoom` | choice; Fit map / 25% / 50% / 100% / 200% / 400%; Green: 1 |  | editor | default view |  | Canvas › Zoom cluster |
| + | `zoom-in` | button |  | editor | default view |  | Canvas › Zoom cluster |
| Art | `view-rendered` | button |  | map file | default view |  | Top bar › View switch › Art |
| Clay | `view-clay` | button |  | map file | default view |  | Top bar › View switch › Clay |
| Passability | `view-passability` | button |  | not saved | default view |  | Top bar › View switch › Passability |
| clay | `clay` | switch; Green: false |  | map file | hidden until needed |  | Top bar › View switch › hidden checkbox behind Clay |
| Tile grid | `tile-grid` | switch; Green: false | 16 px height-cell grid in map coordinates; heavier lines every 128 px. | not saved | default view |  | Top bar › View menu › Tile grid |
| Weathering | `weather` | switch; Green: true | Apply terrain weathering to this map, including export. | map file | default view |  | World › Rain & erosion › Erosion switch |

## Shape card (Tool tab)

One set of rows for every drawing tool; a tool shows the rows its shape
uses. "Shown at the baseline" counts the 19 drawing tools that show the row by
default on Green; the others appear when their parent is on.

| Control | Id or key | Kind, range, Green value | What it does | Saved in | Shown at the baseline | Worlds | Accepted destination |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Seed | `seed` | number; 0 to 4294967295; Green: 2701 | Used for the next shape, then a fresh seed is chosen. | shape (map file) | shown by default for 20 of 19 drawing tools |  | Build › Shape card › Advanced |
| ↻ Reroll | `seed-randomize` | button | Used for the next shape, then a fresh seed is chosen. | shape (map file) | shown by default for 20 of 19 drawing tools |  | Build › Shape card › Header > New seed |
| Tool preset | `tool-style` | choice; Green Planet / Red Planet / Archipelago / Moon / Zhon / Painted Desert / Lava / Crystal / …; Green: green | Starting values for this tool. Materials and colors come from the World (right panel). | shape (map file) | shown by default for 20 of 19 drawing tools |  | Build › Shape card › Advanced |
| Brush diameter | `diameter` | slider; 16 to 1200, step 1; Green: 800 |  | shape (map file) | shown by default for 20 of 19 drawing tools |  | Build › Shape card › Size & height |
| Rise / Depth / Strength | `amount` | slider; 5 to 160, step 1; Green: 70 |  | shape (map file) | shown by default for 5 of 19 drawing tools |  | Build › Shape card › Size & height |
| Roughness / Edge freedom | `roughness` | slider; 0 to 100, step 1; Green: 0 |  | shape (map file) | shown by default for 5 of 19 drawing tools |  | Build › Shape card › Size & height |
| Slope softness | `softness` | slider; 0 to 100, step 1; Green: 50 | Higher values make broader, gentler slopes. | shape (map file) | shown by default for 4 of 19 drawing tools |  | Build › Shape card › Size & height |
| Height reference | `lf-height-reference` | choice; Fixed elevation / Sea level / Ground; Green: 0 | Fixed elevation uses map height units. Sea level measures above or below the current sea; negative heights are below water. Ground measures from the ground under each place the shape covers, so the shape follows the ground it lands on, slopes included: negative heights dig into it (a crater's bowl), and a section that dips below 0 rises above it (the crater's rim). | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Size & height |
| Elevation (height units) / Height above sea (units) | `lf-elevation` | slider; -80 to 300, step 1; Green: 214 | The height of the crest, in height units. The section canvas marks the plain (the map's base height) and the sea. Combine decides what the landform does to the ground it meets. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Size & height |
| Combine | `lf-combine` | choice; Raise to / Cut to / Flatten to; Green: 0 | Raise to keeps the higher of the ground and the landform. Cut to keeps the lower. Flatten to sets the ground to the landform wherever it reaches, up or down. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Size & height |
| Smooth route | `lf-route-smooth` | slider; 0 to 100, step 5; Green: 0 | Keep the center of this landform clear of surface relief, cracks and debris, and protect its grade from weathering. The shoulders fade into the surrounding terrain. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Size & height |
| Lean (back length over face) | `lean` | slider; 0 to 400, step 5; Green: 100 | How much longer the slope toward the lean side runs than the one away from it (100 or 0: the same both sides). | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Profile |
| Lean toward | `facing` | choice; World default (north) / Left of the line / Right of the line / North / North-east / East /…; Green: 3 | The side the shape leans toward, the long gentle slope: a map direction or a side of the line you draw (a ridge's steep face is the opposite side). | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Profile |
| Wander (px) | `lf-wander` | slider; 0 to 200, step 2; Green: 90 | How far the outline moves in and out around the sides and ends, in waves as long as the Variation size. The drawn crest stays in place. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Outline & variation |
| Width variation | `lf-width-vary` | slider; 0 to 100, step 5; Green: 35 | How much the section widens and narrows along the path (100: from half to twice its width). | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Outline & variation |
| Height variation (units) | `lf-height-vary` | slider; 0 to 40, step 1; Green: 0 | How far the surface rises and falls, in height units, in waves as long as the Variation size. It is zero at the feet. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Outline & variation |
| Variation size (px) | `lf-vary-size` | slider; 20 to 400, step 10; Green: 140 | The wavelength of the wander and of the width and height variation. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Outline & variation |
| Variation along the wall | `lf-wall-vary` | slider; 0 to 100, step 5; Green: 0 | How much one wall differs from stretch to stretch. 0: the same wander and the same gullies all the way round. Higher: the outline also bends in long waves, three Variation sizes across, with alcoves and salients; its small teeth come and go, so some stretches run straight; the Gullies leave some stretches plain, cut others far deeper, and run closer or wider apart; and Hard beds end and step more often. | shape (map file) | shown by default for 11 of 19 drawing tools |  | Build › Shape card › Outline & variation |
| Variation at the foot | `lf-vary-foot` | slider; 0 to 200, step 5; Green: 115 | How much of the variation acts at the foot of the section (100: all of it, 0: none, 200: twice). It blends into the next one up to the middle of the section. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Outline & variation |
| Variation up the section | `lf-vary-middle` | slider; 0 to 200, step 5; Green: 145 | How much of the variation acts from the middle of the section to its crest. Set the foot to 0 and this to 200 for variation that grows toward the crest. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Outline & variation |
| Gullies | `lf-gullies` | slider; 0 to 100, step 5; Green: 60 | Cut the raised faces into a divide, spurs off it and V-gullies that branch as they run down the fall line, deepest on steep faces and fading at the foot. Their depth varies along a wall, and where they cut deepest the wall stands back in bays between buttresses, so the rim leaves the drawn line. 0: smooth faces and the drawn rim. | shape (map file) | shown by default for 8 of 19 drawing tools |  | Build › Shape card › Details > Gullies |
| Talus reach (px) | `lf-talus` | slider; 0 to 200, step 5; Green: 40 | How far loose material runs out from the foot of a raised face: a concave apron that rests at the world's talus angle against the face and comes down level at its toe this far out, fanning from the widest gullies into one skirt. A longer reach makes a longer, gentler apron, not a taller one. Below any wall the Gullies cut, the ravines also lay fans of debris that end this far beyond the foot, whatever the slope. Loose ground carries stones and no rock detail. 0: no talus. It needs Gullies, for the chutes. | shape (map file) | shown by default for 2 of 19 drawing tools |  | Build › Shape card › Details > Gullies |
| Gully size | `lf-gully-size` | slider; 10 to 100, step 5; Green: 20 | How far apart the widest gullies run, as a share of the face from crest to foot; each finer set is half as far apart. Low: close rills; high: a few broad valleys between big spurs. | shape (map file) | shown by default for 2 of 19 drawing tools |  | Build › Shape card › Details > Gullies |
| Hard beds | `lf-beds` | slider; 0 to 8, step 1; Green: 0 | Stand the raised face in this many cliff bands, one above another, with a gentler slope under each: hard beds that stand and soft ones that lie back. Each band keeps its level round every spur and up every gully, waves a little along the wall, and thins out over some stretches, so ledges end and the next steps out. The level top and the ground at the foot do not move. 0: the face as drawn. | shape (map file) | shown by default for 5 of 19 drawing tools |  | Build › Shape card › Details > Hard beds |
| Soft beds lie back | `lf-bed-soft` | slider; 0 to 100, step 5; Green: 60 | How far the soft bed under each hard one lies back, and so how steep the hard bed stands. 0: the face keeps its drawn slope. 100: the soft beds are nearly level benches and the hard beds stand about two and a half times as steep as the face was drawn. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Hard beds |
| Ejecta | `lf-ejecta` | slider; 0 to 300, step 5; Green: 0 | Material thrown out round the shape: a blanket that thins away from its rim (or, on a shape that peaks on its path, its foot), broken into radial streaks and ragged lobes. Drag to aim it: the drag is the projectile's path and the shape lands at its end. A click throws it all round; a short drag gathers it downrange and, longer, leaves a gap uprange; a drag longer than the diameter throws to both sides. The path before the landing is a groove, at each place as deep and as wide as Length vs. height sets. | shape (map file) | shown by default for 12 of 19 drawing tools |  | Build › Shape card › Details > Impact |
| Buckling | `lf-buckling` | slider; 0 to 300, step 5; Green: 0 | A big impact buckles the ground just beyond its rim into broken rings of uplifted blocks, highest by the rim and gone by about 1.7 rim radii, more downrange as the ejecta are. It grows with the shape: none while its rim is under about 30 px from its center, all of it from about 160 px. It shows on a shape that digs into the ground it lands on (Height reference Ground, a height below 0); with it on, a drag lands the shape at its end, as Ejecta says. | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Details > Impact |
| Secondaries | `lf-secondaries` | slider; 0 to 12, step 1; Green: 0 | Small copies of the shape thrown beyond the ejecta, some in short chains along a ray; they gather downrange, or to the sides, as the ejecta do. With any impact row on, a drag lands the shape at its end, as Ejecta says. | shape (map file) | shown by default for 12 of 19 drawing tools |  | Build › Shape card › Details > Impact |
| Secondaries' distance (rim radii) | `lf-secondary-distance` | slider; 8 to 40, step 1; Green: 16 | How far out the secondaries fall, in rim radii from the center: from this distance to twice as far, and their chains a little farther. 1 lands the nearest on the rim; retail Moon's small craters gather 1 to 2 rim radii out. It shows once Secondaries is 1 or more. | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Details > Impact |
| Face width variation | `face-variation` | slider; 0 to 150, step 5; Green: 0 | How much the edge face widens and narrows along the outline (on a carried cross-section, every width of it). | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Outline & variation |
| Shore lobes | `fingers` | slider; 0 to 150, step 5; Green: 0 | Interlocking land fingers and inlets along the shore. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Details > Shore |
| Lobe size | `finger-size` | slider; 20 to 300, step 5; Green: 100 | Fingers on the joined coast: length and (less) width of each finger. Fingers never reach past this stroke's bank. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Shore |
| Layer width (px) | `layer-px` | slider; 4 to 60, step 1; Green: 12 | Width of one shoreline step, ledge and riser together. The step count times this is how far the terraces reach inland. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Steps |
| Riser height (units; 0 fits the bank) | `layer-riser` | slider; 0 to 80, step 1; Green: 0 | Height of each step. 0 shares the bank's whole rise out between the layers, so the last one meets the plain. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Steps |
| Steps follow | `lf-step-reference` | choice; Profile / Shoreline / Circular shoreline; Green: 0 | Profile steps divide the drawn section. Shoreline steps follow the joined waterline, including overlaps and uneven banks. Circular shoreline steps cut scalloped arcs. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Details > Steps |
| Steps | `sec-terraces` | slider; 0 to 8, step 1; Green: 0 | Cut the face into this many flat ledges with risers between them. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Details > Steps |
| Flat share of a step | `sec-ledge` | slider; 0 to 90, step 5; Green: 60 | How much of each step is flat; the rest is the riser. | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Details > Steps |
| Step variation | `sec-terrace-jitter` | slider; 0 to 100, step 5; Green: 35 | How much riser positions and step heights wander along the outline. | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Details > Steps |
| Step breakup | `sec-breakup` | slider; 0 to 100, step 5; Green: 0 | How many stretches of the terraces lose their shelf, so the steps no longer run unbroken round the shape (100: most stretches lose it, and short ledges survive). 0 keeps the terraces whole. | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Details > Steps |
| Layer width variation | `layer-vary` | slider; 0 to 100, step 5; Green: 0 | How much each layer's width and riser height change along the shore and from one layer to the next, so risers bunch, part and merge as retail's do. 0 keeps the even layers. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Steps |
| Circle size (px, circular layers) | `layer-circle` | slider; 8 to 80, step 1; Green: 26 | Circular layers: the typical radius of the round bites cut from the bank. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Steps |
| Circular bite variation | `lava-circle-vary` | slider; 0 to 100, step 5; Green: 0 | Circular layers: how much the bites differ from one another, in radius (a few large among many small), in the spacing of their rings, and in how many sites keep one, so they gather in clusters with bare stretches, as retail lava-2's do. 0: the even circles. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Steps |
| Layer width spread | `lava-spread` | slider; 0 to 200, step 5; Green: 0 | Contour layers: extra spread in layer width along the shore, on top of Layer width variation (100 is about 2.7 times between the narrowest and the widest). 0: none. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Steps |
| Spurs | `spur-count` | slider; 0 to 12, step 1; Green: 0 | Tapering spurs that branch off this ridge, grown from the shape's own seed. Each joins its parent at the crest; on a section that dips below the ground and peaks before its path (a crater's rim), they leave from that peak. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Details > Spurs |
| Spur length (px) | `spur-length` | slider; 20 to 400, step 10; Green: 120 | Average reach of a spur; each runs from about half to one and a half times this. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Spurs |
| Spur angle spread | `spur-spread` | slider; 0 to 100, step 5; Green: 40 | 0: spurs leave swept back at about 40 degrees (off a click, straight out); 100: scattered up to square and beyond, and more winding. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Spurs |
| Spur width | `spur-width` | slider; 20 to 200, step 5; Green: 80 | A spur's width at its root, as a share of the ridge's own; it flares a little where it joins. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Spurs |
| Spur taper | `spur-taper` | slider; 0 to 100, step 5; Green: 60 | How much a spur narrows and lowers toward its tip. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Spurs |
| Spur height | `spur-height` | slider; 10 to 100, step 5; Green: 70 | A spur's root height as a share of the ridge's crest (of the peak it leaves from). | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Spurs |
| Spur forks | `spur-forks` | slider; 0 to 100, step 5; Green: 0 | The share of spurs that fork once, two thirds of the way out, into a shorter spur. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Spurs |
| Bulbous spur tips | `spur-bulb` | slider; 0 to 100, step 5; Green: 0 | Swells the outer half of every spur into a rounded lobe, so it ends in a knuckle, not a point. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Spurs |
| Spur variation | `crest-vary` | slider; 0 to 100, step 5; Green: 0 | Each spur swells and narrows, and rises and dips, along its length, in waves about two spur widths long, so the spurs read as uneven ridges, not smooth tapering ones. 0: even spurs. It acts on spurs, so it shows once Spurs is on. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Spurs |
| Branches | `fissure-branches` | slider; 0 to 12, step 1; Green: 3 | Side cuts that leave the main cut, and fork once, grown from the shape's own seed. Network mode ignores them. | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Details > Branches |
| Branch length (px) | `fissure-branch-len` | slider; 20 to 300, step 5; Green: 90 | Average reach of a branch; each runs from about half to one and a half times this. | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Details > Branches |
| Branch angle spread | `fissure-branch-spread` | slider; 0 to 100, step 5; Green: 50 | 0: branches leave at about 25 degrees to the cut; 100: up to square. | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Details > Branches |
| Cut layout | `fissure-network` | choice; Path cut / Fracture network; Green: 0 | 0: cut along the stroke. 1: a connected polygonal fracture network over the stroke's whole footprint (Diameter sets how far it reaches), as on Red's rock platforms. | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Details > Fracture network |
| Network block size (px) | `fissure-cell` | slider; 30 to 160, step 5; Green: 70 | Typical width of a block between the cuts. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Fracture network |
| Shore plates | `shore-plates` | slider; 0 to 1, step 1; Green: 0 | Add a band of broken plates on this stroke only. Off preserves the original water shape. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Details > Shore |
| Plates: water width (px) | `plate-water-px` | slider; 0 to 240, step 4; Green: 64 | Reach from this stroke's waterline into the water. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Shore |
| Plates: land width (px) | `plate-land-px` | slider; 0 to 240, step 4; Green: 96 | Reach from this stroke's waterline onto land, with broken pressure ridges. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Shore |
| Plate size (px) | `plate-size` | slider; 8 to 96, step 2; Green: 28 | Typical width of the interlocking polygonal plates. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Shore |
| Plate gap (px) | `plate-gap` | slider; 0 to 160, step 5; Green: 20 | Open gap between adjacent plates. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Shore |
| Plate height above sea | `plate-height` | slider; 0 to 240, step 5; Green: 30 | Flat water plates sit this high above sea; land keeps its existing height. Rock slabs: how far the land slabs stand above their seams. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Shore |
| Shore structure | `plate-material` | choice; Polygonal slabs / Needle band; Green: 1 | 2: frost crystals, parallel straight needles in patches of three directions, cut by straight seams, thinning toward deep water (Plate size is the patch, Plate gap the needle spacing; retail Ice). 1: low flat rock slabs that interlock along the shore with dark seams between them, and a shallow ledge under the water (Crystal). The band follows this stroke's own waterline, so separate shores stay separate. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Shore |
| Frost needle share (plate material 2) | `frost-needles` | slider; 0 to 100, step 5; Green: 50 | Frost crystals: the share of patches that carry needles at all; the rest of the band is plain ice. Needles in a patch are also dropped at random, so lines are sparse, fine and of varied length. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Shore |
| Slab variety | `plate-vary` | slider; 0 to 100, step 5; Green: 0 | Rock slabs (Plate material 1): in patches, a slab breaks into a fine mesh of cells about 0.4 of Plate size inside its own outline, so the large seams stay. This sets the share of slabs that break; 0 keeps every slab whole. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Shore |
| Slab seam weight | `crystal-shore-seam` | slider; 50 to 65, step 1; Green: 50 | Rock slabs: the crystal-field value of a seam. 50 is the earlier black seam; higher values thin it (the shader inks only below 66) toward the hairline seams of retail's shore band. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Shore |
| Shallow-to-deep edge | `water-deep` | choice; World default / Hard / Faded; Green: 0 | World default keeps the World panel's Shallow-to-deep step. Hard: the shallow color stops at one depth with ragged stairs (retail Green). Faded: the color follows the depth ramp gradually (retail Archipelago). | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Details > Shore |
| Shore | `water-shore` | choice; World default / Soft bank; Green: 0 | World default keeps the World panel's Rock at shores and Rock shelf under water: an open, wave-cut shore of bare jointed rock. Soft bank: no shore rock round this water, on land or on the bed (an inland lake). | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Shore |
| Surf | `water-surf` | slider; 0 to 100, step 5; Green: 0 | How much the shore is worked by waves, where this stroke makes water. 0: the shore is drawn as before. A little: a thin, broken wet strip and a few flecks of foam at the waterline. More: wider wet sand, wrack lines, a beach of sand whose inland edge breaks into the grass, cusps (the land is shaped to a gentle face, a berm and a slight back-slope, up to a few units tall) and a broken breaker line over the shallows. A rocky shore is painted with the Paint tool's rock. | shape (map file) | shown by default for 9 of 19 drawing tools |  | Build › Shape card › Details > Shore |
| Crest taper (both ends) | `crest-taper` | slider; 0 to 100, step 5; Green: 0 | The crest narrows and lowers toward both ends of its path; it multiplies the height along the path. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Outline & variation |
| Facets | `ice-facets` | slider; 0 to 100, step 5; Green: 0 | Breaks the shape into facets of the Facet shape, each as high as the shape at its center, so the section and along curves shape the cluster or ridge they make. This sets how much of it: angular facets and columns cover this share of the surface (the rest stays smooth), prisms stand on this share of their places. On a landform that digs into the ground (Height reference Ground, below 0) the facets are angular, planes fitted to its own surface up and down, and this is how fully they replace it. 0 keeps the smooth surface. A landform with shore features keeps those instead. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Details > Facets |
| Facet shape | `lf-facet-form` | choice; Angular facets / Stepped columns / Prisms; Green: 0 | Angular facets: tilted planes fitted to the shape's own surface, a little steeper, stepped off their neighbors. Stepped columns: the surface tiled with flat polygonal columns, stepped up and down. Prisms: separate polygonal prisms standing on the ground, scattered over the shape (a cluster round a click, a ridge along a drag): crystal shards, or as wide as the shape, one block. A landform that digs takes angular facets. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Facets |
| Surface | `lf-facet-surface` | choice; Rock / Crystal; Green: 0 | Rock: the facets are the shape's own ground, lit with the world's slope relief and light (rock facets, ice blocks). Crystal: clean crystal in the world's crystal color; each column or prism is shaded on its own and outlined, and angular facets become one crystal skin under the world's thin crystal web (Crystal's crater walls). | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Facets |
| Facet width (px) | `ice-facet-size` | slider; 8 to 1000, step 2; Green: 36 | The typical width of one facet, column or prism, and the spacing of the prisms. A prism as wide as the shape stands alone. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Facets |
| Step height | `crystal-step` | slider; 0 to 64, step 1; Green: 5 | Angular facets and stepped columns: how far each facet or column steps up or down from the shape under it, in height units. Angular facets on a raised shape stand up to about twice this above it; on a landform that digs, this either way; columns up to about twice this either way, with about 40% flush (retail Crystal's columns: 16; its crater walls: 1). | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Facets |
| Level tops | `crystal-tiers` | slider; 0 to 100, step 5; Green: 0 | Stepped columns and prisms: how level each top stands. 100: level at the height of the shape at the element's center, so it steps distinctly from its neighbors. 0: the top keeps the slope of the shape under it, as one plane across the element (a lean, a sloping section or different front and back sections tilt it: an ice slab's tilted top). | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Facets |
| Top tilt | `crystal-facet` | slider; 0 to 100, step 5; Green: 0 | Stepped columns: tilts each column's top into one or two planes that meet at a crease, so the tops read as crumpled multi-facet crystal, not flat plates. 0 keeps flat tops. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Facets |
| Size mix | `crystal-size-var` | slider; 0 to 100, step 5; Green: 0 | Stepped columns: mixes three column widths (Facet width, about half and about a third of it), the small ones where the shape stands highest and in patches. 0 keeps one width. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Facets |
| Polygon sides | `crystal-sides` | slider; 3 to 10, step 1; Green: 6 | Prisms: the sides of each prism's outline (Variation mixes a few more and fewer). | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Facets |
| Flat top share | `crystal-top` | slider; 0 to 95, step 5; Green: 20 | Prisms: the share of each prism that is its flat top. 0: pointed; higher cuts the tops level, with shorter, steeper faces (an ice block). | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Facets |
| Variation | `crystal-variation` | slider; 0 to 100, step 5; Green: 50 | Prisms: the spread of their sizes, heights and side counts, and how much looser their spacing gets. 0: even sizes, still irregularly spaced. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Facets |
| Align to the path | `crystal-align` | slider; 0 to 100, step 5; Green: 0 | Prisms: 0 turns each prism at random, 100 sets its faces square to the path where it stands (four sides then make blocks that follow the path). | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Facets |
| Outline jitter | `berg-jitter` | slider; 0 to 100, step 5; Green: 50 | Prisms: how far each face's angle and distance stray from a regular polygon. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Facets |
| Corner cuts | `berg-break` | slider; 0 to 8, step 1; Green: 3 | Prisms: extra planes that cut corners off each prism. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Facets |
| Face roughness | `berg-rough` | slider; 0 to 30, step 1; Green: 6 | Prisms: fractal roughness added to the height, from 40 px lumps to 4 px grain. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Facets |
| Rock | `lf-rock` | choice; Rock beneath / World rock / Smooth soil; Green: -1 | The rock this shape is made of, one of the map's rock presets (World pane, Rock & cliffs). Rock beneath keeps whatever rock is already there: the world's own, or an earlier shape's. The shape claims its rock wherever it moves the ground, so a later shape wins where it overlaps an earlier one. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Rock & cover |
| Local vegetation | `style-vegetation` | slider; -100 to 100, step 5; Green: 0 | Grass and moss cover inside the shape, times 1 + this: below 0 more bare rock, above 0 more cover. | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Rock & cover |
| Width (px) | `fissure-width` | slider; 2 to 24, step 1; Green: 5 | Width of the cut at its widest. The grid is 2 px, so a cut never reads narrower than about 4 px, however thin it is set. | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Details > Cut |
| Jaggedness | `fissure-jag` | slider; 0 to 100, step 5; Green: 50 | How far the cut zigzags off its path, and how its depth varies along it. | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Details > Cut |
| Taper | `fissure-taper` | slider; 0 to 100, step 5; Green: 60 | How much the cut narrows and shallows toward its ends and its branch tips. | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Details > Cut |
| Fractured rock beside the cut | `fissure-crack` | slider; 0 to 100, step 5; Green: 40 | Raises the world's own crack field along the cut, so the rock beside it breaks up (0 leaves only the cut). | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Details > Cut |
| Darkness | `fissure-dark` | slider; 0 to 100, step 5; Green: 60 | Paints the world's own wet (dark) ground along the cut, so it reads dark whatever the ground (it layers on rock, snow or moss). | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Details > Cut |
| Paint | `paint-channel` | choice; Rock / Snow or ice / Wet or dark ground / Moss / Denser scatter / Sparser scatter / Ground…; Green: 1 | What the brush paints. Denser scatter supplies its own stones where the World panel's Boulders and Debris are 0 and multiplies them where they are not. Style settings go more or less than the world's own value; Strength is how far. Erase clears every mask and style under the brush. | shape (map file) | shown by default for 1 of 19 drawing tools |  | Build › Shape card › Size & height > Paint |
| Layer edge jag (px) | `layer-jag` | slider; 0 to 12, step 1; Green: 0 | Shoreline steps: how far each step's edge zigzags, in runs of about 8 px, so the risers read ragged as retail lava's banks do; the waterline itself stays. 0: the edges wander smoothly. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Details > Steps |
| Cracks | `cracks` | slider; 0 to 100, step 1; Green: 40 | How cracked this shape is. Crack style, depth and block size are World settings (right panel). | shape (map file) | shown by default for 14 of 19 drawing tools |  | Build › Shape card › Rock & cover |
| Name | `tool-save-name` | text |  | shape (map file) | hidden until its parent is on |  | Build › Shape card › Header menu > Save as tool |
| Color | `tool-save-color` | color; Green: #d6c8a6 |  | shape (map file) | hidden until its parent is on |  | Build › Shape card › Header menu > Save as tool |
| Save as tool | `tool-save-button` | button |  | shape (map file) | hidden until its parent is on |  | Build › Shape card › Header menu > Save as tool |
| Delete this tool | `tool-delete` | button | Removes this map's tool from the toolbar. Shapes drawn with it keep their settings and show as Landform. | shape (map file) | hidden until its parent is on |  | Build › Shape card › Header menu > Delete this tool (a map's own tool) |
| Gullies (group switch) | `` | switch | Off sets the group's main value to 0 and collapses it; on restores the last value. | shape (map file) |  |  | Build › Shape card › Details > Gullies chip |
| Shore lobes (group switch) | `` | switch | Off sets the group's main value to 0 and collapses it; on restores the last value. | shape (map file) |  |  | Build › Shape card › Details > Shore chip |
| Spurs (group switch) | `` | switch | Off sets the group's main value to 0 and collapses it; on restores the last value. | shape (map file) |  |  | Build › Shape card › Details > Spurs chip |
| Branches (group switch) | `` | switch | Off sets the group's main value to 0 and collapses it; on restores the last value. | shape (map file) |  |  | Build › Shape card › Details > Branches chip |
| Fracture network (group switch) | `` | switch | Off sets the group's main value to 0 and collapses it; on restores the last value. | shape (map file) |  |  | Build › Shape card › Details > Fracture network chip |
| Shore plates (group switch) | `` | switch | Off sets the group's main value to 0 and collapses it; on restores the last value. | shape (map file) |  |  | Build › Shape card › Details > Shore chip |
| Facets (group switch) | `` | switch | Off sets the group's main value to 0 and collapses it; on restores the last value. | shape (map file) |  |  | Build › Shape card › Details > Facets chip |
| Local vegetation (group switch) | `` | switch | Off sets the group's main value to 0 and collapses it; on restores the last value. | shape (map file) |  |  | Build › Shape card › Details > Local vegetation chip |
| Jaggedness (group switch) | `` | switch | Off sets the group's main value to 0 and collapses it; on restores the last value. | shape (map file) |  |  | Build › Shape card › Details > Cut chip |
| Taper (group switch) | `` | switch | Off sets the group's main value to 0 and collapses it; on restores the last value. | shape (map file) |  |  | Build › Shape card › Details > Cut chip |
| Fractured rock beside the cut (group switch) | `` | switch | Off sets the group's main value to 0 and collapses it; on restores the last value. | shape (map file) |  |  | Build › Shape card › Details > Cut chip |
| Darkness (group switch) | `` | switch | Off sets the group's main value to 0 and collapses it; on restores the last value. | shape (map file) |  |  | Build › Shape card › Details > Cut chip |
| Layer edge jag (group switch) | `` | switch | Off sets the group's main value to 0 and collapses it; on restores the last value. | shape (map file) |  |  | Build › Shape card › Details > Steps chip |
| Cracks (group switch) | `` | switch | Off sets the group's main value to 0 and collapses it; on restores the last value. | shape (map file) |  |  | Build › Shape card › Details > Cracks chip |

## Selection (Tool tab, when a shape or feature is selected)

| Control | Id or key | Kind, range, Green value | What it does | Saved in | Shown at the baseline | Worlds | Accepted destination |
| --- | --- | --- | --- | --- | --- | --- | --- |
| New shape | `draw-new` | button | The next stroke starts a new shape. | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Draw |
| Add path | `draw-add` | button | The next stroke adds a path to the selected shape. | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Draw |
| Transform | `transform-mode` | button | Selection mode: move, rotate and scale handles. | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Selection |
| Edit path (P) | `edit-path` | button | Selection mode: drag, insert and delete path points. | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Selection |
| Insert point | `path-add` | button |  | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Path |
| Delete point | `path-delete` | button |  | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Path |
| Extend / branch | `path-extend` | button |  | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Path |
| Delete path | `path-remove` | button |  | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Path |
| Shape paths (list) | `shape-path-list` | button | Pick one of a shape's paths. | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Path |
| Rotate left 15° | `rotate-left` | button |  | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Transform |
| Rotate right 15° | `rotate-right` | button |  | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Transform |
| Scale down 10% | `scale-down` | button |  | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Transform |
| Scale up 10% | `scale-up` | button |  | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Transform |
| Center X | `selection-x` | number |  | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Transform > Numbers |
| Center Y | `selection-y` | number |  | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Transform > Numbers |
| Rotation ° | `selection-rotation` | number |  | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Transform > Numbers |
| Scale % | `selection-scale` | number |  | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Transform > Numbers |
| Deselect | `selection-clear` | button |  | shape (map file) | when a shape or feature is selected |  | Build › Canvas bar › Selection |
| Delete shape | `selection-delete` | button |  | shape (map file) | when a shape or feature is selected |  | Build › Shape card › Header |
| Metal (selected deposit) | `feature-selection-metal` | slider | What an extractor on the deposit draws. | shape (map file) | when a shape or feature is selected |  | Build › Feature card › Selected feature |
| Re-roll (selected feature) | `feature-reroll` | button | Swap for another variant of the same kind. | shape (map file) | when a shape or feature is selected |  | Build › Feature card › Selected feature |
| Delete (selected feature) | `feature-delete` | button |  | shape (map file) | when a shape or feature is selected |  | Build › Feature card › Selected feature |

## Features tool

| Control | Id or key | Kind, range, Green value | What it does | Saved in | Shown at the baseline | Worlds | Accepted destination |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Place | `place` | button |  | tool state | modes/kinds: deposit, vent, tree, shrub, rock, scar, erase, starts, fill (needs: deposit, vent, tree, shrub, rock, scar, erase, starts, fill) | all 19 | Build › Features tool › Mode |
| Erase | `erase` | button |  | tool state | modes/kinds: deposit, vent, tree, shrub, rock, scar, erase, starts, fill (needs: deposit, vent, tree, shrub, rock, scar, erase, starts, fill) | all 19 | Build › Features tool › Mode |
| Starts | `starts` | button |  | tool state | modes/kinds: deposit, vent, tree, shrub, rock, scar, erase, starts, fill (needs: deposit, vent, tree, shrub, rock, scar, erase, starts, fill) | all 19 | Build › Features tool › Mode |
| Fill | `fill` | button |  | tool state | modes/kinds: deposit, vent, tree, shrub, rock, scar, erase, starts, fill (needs: deposit, vent, tree, shrub, rock, scar, erase, starts, fill) | all 19 | Build › Features tool › Mode |
| Kind | `feature-kind` | choice; Metal deposit / Geothermal vent / Tree / Shrub / Rock / Scar; Green: deposit |  | tool state | modes/kinds: deposit, vent, tree, shrub, rock, scar (needs: deposit, vent, tree, shrub, rock, scar) | all 19 | Build › Features tool › Palette |
| Recipe | `feature-recipe` | choice; Green Planet metal deposit; Green: 0 |  | tool state | modes/kinds: deposit, vent, tree, shrub, rock, scar (needs: deposit, vent, tree, shrub, rock, scar) | all 19 | Build › Features tool › Palette |
| Duplicate recipe | `feature-duplicate-recipe` | button |  | feature recipe (map file) | modes/kinds: deposit, vent, tree, shrub, rock, scar (needs: deposit, vent, tree, shrub, rock, scar) | all 19 | Build › Features tool › Style: manage |
| Remove recipe | `feature-remove-recipe` | button |  | feature recipe (map file) | modes/kinds: deposit, vent, tree, shrub, rock, scar (needs: deposit, vent, tree, shrub, rock, scar) | all 19 | Build › Features tool › Style: manage |
| Recipe name | `feature-recipe-name` | text; Green: Green Planet metal deposit |  | feature recipe (map file) | modes/kinds: deposit, vent, tree, shrub, rock, scar (needs: deposit, vent, tree, shrub, rock, scar) | all 19 | Build › Features tool › Style: manage |
| All worlds’ recipes | `feature-preset` | choice; Metal deposit · default / Green Planet · deposit 1 / Moon · deposit 1 / Painted Desert · d…; Green: deposit-default | A starting look you can edit independently. All recipes use this world’s light. | feature recipe (map file) | modes/kinds: deposit, vent, tree, shrub, rock, scar (needs: deposit, vent, tree, shrub, rock, scar) | all 19 | Build › Features tool › Style: manage |
| Add recipe | `feature-add-recipe` | button | A starting look you can edit independently. All recipes use this world’s light. | feature recipe (map file) | modes/kinds: deposit, vent, tree, shrub, rock, scar (needs: deposit, vent, tree, shrub, rock, scar) | all 19 | Build › Features tool › Style: manage |
| Variant to place (Random, or one of the recipe's 1 to 16 variants) | `feature-variants` | button | Thumbnails of this recipe's variants; the chosen one is placed on a click. | tool state | modes/kinds: deposit, vent, tree, shrub, rock, scar (needs: deposit, vent, tree, shrub, rock, scar) | all 19 | Build › Features tool › Palette |
| Variants | `feature-count` | slider; 1 to 16, step 1; Green: 4 |  | feature recipe (map file) | modes/kinds: deposit, vent, tree, shrub, rock, scar (needs: deposit, vent, tree, shrub, rock, scar) | all 19 | Build › Features tool › Style: manage |
| ↻ New variants | `feature-new-set` | button |  | feature recipe (map file) | modes/kinds: deposit, vent, tree, shrub, rock, scar (needs: deposit, vent, tree, shrub, rock, scar) | all 19 | Build › Features tool › Style: manage |
| Metal for new deposits | `feature-deposit-metal` | slider; 0 to 255, step 1; Green: 127 | Each placed deposit keeps its own metal; select one (V) to change it. | feature recipe (map file) | modes/kinds: deposit (needs: deposit) | all 19 | Build › Features tool › Place |
| Size | `feature-form-vent-size` | slider; 0.6 to 1.6, step 0.05; Green: 1.00 |  | feature recipe (map file) | modes/kinds: vent (needs: vent) | all 19 | Build › Features tool › Style: edit |
| Tree shape | `feature-species` | choice; Recipe’s original shapes / Broadleaf / Conifer / Tendril plant / Dead broadleaf / Dead con… |  | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Height | `feature-form-tree-height` | slider; 30 to 110, step 1; Green: 69 |  | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Width / height | `feature-form-tree-width` | slider; 0.42 to 1.05, step 0.01; Green: 0.71 |  | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Foliage density | `feature-form-tree-density` | slider; 0 to 1, step 0.05; Green: 0.45 |  | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Crown roughness | `feature-form-tree-crown` | slider; 0 to 1, step 0.05; Green: 0.60 |  | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Canopy style | `feature-canopy-style` | choice; Recipe’s original canopy / Full crown / Separate leaf clusters / Arching palm fronds |  | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Exposed trunk | `feature-form-tree-canopyLift` | slider; 0 to 65, step 5; Green: 0% |  | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Height variation | `feature-form-tree-heightVariation` | slider; 0 to 60, step 5; Green: Preset |  | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Width variation | `feature-form-tree-widthVariation` | slider; 0 to 60, step 5; Green: Preset |  | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Tendril count | `feature-form-tree-arms` | slider; 1 to 16, step 1; Green: 7 | Choose a tendril shape. | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Tendril length (px) | `feature-form-tree-reach` | slider; 12 to 100, step 1; Green: 50 | Choose a tendril shape. | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Tendril thickness (px) | `feature-form-tree-thick` | slider; 1.2 to 10, step 0.2; Green: 3.2 | Choose a tendril shape. | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Tendril length variation | `feature-form-tree-reachVariation` | slider; 0 to 60, step 5; Green: Preset | Choose a tendril shape. | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Tendril thickness variation | `feature-form-tree-thickVariation` | slider; 0 to 60, step 5; Green: Preset | Choose a tendril shape. | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Tendril curl | `feature-form-tree-curl` | slider; 0 to 1, step 0.05; Green: 0.60 | Choose a tendril shape. | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Wood color | `feature-trunk-color` | color; Green: #3b3323 |  | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Crown taper | `feature-taper` | slider; 0 to 1, step 0.05; Green: 0.50 | Broadleaf crowns: round tops to tops that narrow upward. | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Crown peaks | `feature-peaks` | slider; 0 to 1, step 0.05; Green: 0.50 | Broadleaf crowns: a smooth top to irregular peaks along it. | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Base color | `feature-tree-color` | color; Green: #11723c | Base and second colors retain their light and shade. Coverage and patch size create two-color camouflage. | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Second color | `feature-tree-accent-color` | color; Green: #b8c277 | Increase second color coverage to show the pattern. | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Second color coverage | `feature-form-tree-accentAmount` | slider; 0 to 100, step 5; Green: 0% |  | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Color patch size (px) | `feature-form-tree-patternScale` | slider; 2 to 24, step 1; Green: 8 | Increase second color coverage to show the pattern. | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Energy from | `feature-energy-lo` | slider; 0 to 5000, step 1; Green: 250 |  | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| to | `feature-energy-hi` | slider; 0 to 5000, step 1; Green: 250 |  | feature recipe (map file) | modes/kinds: tree (needs: tree) | all 19 | Build › Features tool › Style: edit |
| Height variation | `feature-form-shrub-heightVariation` | slider; 0 to 60, step 5; Green: Preset |  | feature recipe (map file) | modes/kinds: shrub (needs: shrub) | all 19 | Build › Features tool › Style: edit |
| Width variation | `feature-form-shrub-widthVariation` | slider; 0 to 60, step 5; Green: Preset |  | feature recipe (map file) | modes/kinds: shrub (needs: shrub) | all 19 | Build › Features tool › Style: edit |
| Height | `feature-form-shrub-height` | slider; 14 to 40, step 1; Green: 26 |  | feature recipe (map file) | modes/kinds: shrub (needs: shrub) | all 19 | Build › Features tool › Style: edit |
| Width | `feature-form-shrub-width` | slider; 20 to 50, step 1; Green: 33 |  | feature recipe (map file) | modes/kinds: shrub (needs: shrub) | all 19 | Build › Features tool › Style: edit |
| Density | `feature-form-shrub-density` | slider; 0 to 1, step 0.05; Green: 0.10 |  | feature recipe (map file) | modes/kinds: shrub (needs: shrub) | all 19 | Build › Features tool › Style: edit |
| Base color | `feature-shrub-color` | color; Green: #43972b | This recipe’s shrubs keep their light and shade. Other recipes keep their colors. | feature recipe (map file) | modes/kinds: shrub (needs: shrub) | all 19 | Build › Features tool › Style: edit |
| Second color | `feature-shrub-accent-color` | color; Green: #b8c277 | Increase second color coverage to show the pattern. | feature recipe (map file) | modes/kinds: shrub (needs: shrub) | all 19 | Build › Features tool › Style: edit |
| Second color coverage | `feature-form-shrub-accentAmount` | slider; 0 to 100, step 5; Green: 0% |  | feature recipe (map file) | modes/kinds: shrub (needs: shrub) | all 19 | Build › Features tool › Style: edit |
| Color patch size (px) | `feature-form-shrub-patternScale` | slider; 2 to 24, step 1; Green: 8 | Increase second color coverage to show the pattern. | feature recipe (map file) | modes/kinds: shrub (needs: shrub) | all 19 | Build › Features tool › Style: edit |
| Height variation | `feature-form-rock-heightVariation` | slider; 0 to 60, step 5; Green: Preset |  | feature recipe (map file) | modes/kinds: rock (needs: rock) | all 19 | Build › Features tool › Style: edit |
| Width variation | `feature-form-rock-widthVariation` | slider; 0 to 60, step 5; Green: Preset |  | feature recipe (map file) | modes/kinds: rock (needs: rock) | all 19 | Build › Features tool › Style: edit |
| Spire height | `feature-form-rock-tall` | slider; 0 to 1, step 0.05; Green: 0.00 |  | feature recipe (map file) | modes/kinds: rock (needs: rock) | all 19 | Build › Features tool › Style: edit |
| Flatness | `feature-form-rock-flat` | slider; 0 to 1, step 0.05; Green: 0.00 |  | feature recipe (map file) | modes/kinds: rock (needs: rock) | all 19 | Build › Features tool › Style: edit |
| Size within footprint | `feature-form-rock-size` | slider; 0.7 to 1.15, step 0.01; Green: 1.00 |  | feature recipe (map file) | modes/kinds: rock (needs: rock) | all 19 | Build › Features tool › Style: edit |
| Pitting | `feature-form-rock-pits` | slider; 0 to 1, step 0.05; Green: 0.00 |  | feature recipe (map file) | modes/kinds: rock (needs: rock) | all 19 | Build › Features tool › Style: edit |
| Grain | `feature-form-rock-grain` | slider; 0 to 1, step 0.05; Green: 0.60 |  | feature recipe (map file) | modes/kinds: rock (needs: rock) | all 19 | Build › Features tool › Style: edit |
| Rock shading | `feature-shade` | slider; 0 to 1, step 0.05; Green: 0.60 | Soft to strong shading away from the sun. | feature recipe (map file) | modes/kinds: rock (needs: rock) | all 19 | Build › Features tool › Style: edit |
| Rock angularity | `feature-angular` | slider; 0 to 1, step 0.05; Green: 0.50 | Round boulders to blocks with flat faces and sharp edges. | feature recipe (map file) | modes/kinds: rock (needs: rock) | all 19 | Build › Features tool › Style: edit |
| Rock color | `feature-rock-color` | color; Green: #949494 | This recipe’s rocks keep their light and shade. Other recipes keep their colors. | feature recipe (map file) | modes/kinds: rock (needs: rock) | all 19 | Build › Features tool › Style: edit |
| Second color | `feature-rock-accent-color` | color; Green: #b8c277 | Increase second color coverage to show the pattern. | feature recipe (map file) | modes/kinds: rock (needs: rock) | all 19 | Build › Features tool › Style: edit |
| Second color coverage | `feature-form-rock-accentAmount` | slider; 0 to 100, step 5; Green: 0% |  | feature recipe (map file) | modes/kinds: rock (needs: rock) | all 19 | Build › Features tool › Style: edit |
| Color patch size (px) | `feature-form-rock-patternScale` | slider; 2 to 24, step 1; Green: 8 | Increase second color coverage to show the pattern. | feature recipe (map file) | modes/kinds: rock (needs: rock) | all 19 | Build › Features tool › Style: edit |
| Metal from | `feature-rock-metal-lo` | slider; 0 to 255, step 1; Green: 25 |  | feature recipe (map file) | modes/kinds: rock (needs: rock) | all 19 | Build › Features tool › Style: edit |
| to | `feature-rock-metal-hi` | slider; 0 to 255, step 1; Green: 100 |  | feature recipe (map file) | modes/kinds: rock (needs: rock) | all 19 | Build › Features tool › Style: edit |
| Size | `feature-form-scar-size` | slider; 0.3 to 1.3, step 0.05; Green: 1.10 |  | feature recipe (map file) | modes/kinds: scar (needs: scar) | all 19 | Build › Features tool › Style: edit |
| Density | `feature-form-scar-density` | slider; 0 to 1, step 0.05; Green: 0.55 |  | feature recipe (map file) | modes/kinds: scar (needs: scar) | all 19 | Build › Features tool › Style: edit |
| Start positions | `start-list` | choice; 1: (256, 256) / 2: (1792, 1792); Green: 0 | Click empty ground to add a start. Drag a numbered marker, or Shift-click ground, to move the selected start. Keep 1–10 starts. | feature recipe (map file) | modes/kinds: starts (needs: starts) | all 19 | Build › Starts tool › Starts tool |
| Remove selected start | `start-remove` | button | Click empty ground to add a start. Drag a numbered marker, or Shift-click ground, to move the selected start. Keep 1–10 starts. | feature recipe (map file) | modes/kinds: starts (needs: starts) | all 19 | Build › Starts tool › Starts tool |
| Mix | `fill-kind` | choice; Trees / Shrubs / Rocks; Green: tree |  | tool state | modes/kinds: fill (needs: fill) | all 19 | Build › Features tool › Fill |
| Region | `fill-region` | choice; Brush / Lasso / Flood; Green: brush |  | tool state | modes/kinds: fill (needs: fill) | all 19 | Build › Features tool › Fill |
| Density | `fill-density` | slider; 0 to 100, step 1; Green: 15% |  | tool state | modes/kinds: fill (needs: fill) | all 19 | Build › Features tool › Fill |
| Clustering | `fill-clustering` | slider; 0 to 1, step 0.05; Green: 0.50 |  | tool state | modes/kinds: fill (needs: fill) | all 19 | Build › Features tool › Fill |
| Footprint gap (cells) | `fill-gap` | slider; 0 to 16, step 1; Green: 1 |  | tool state | modes/kinds: fill (needs: fill) | all 19 | Build › Features tool › Fill |
| Seed | `fill-seed` | number; 0 to 4294967295; Green: 2701 |  | tool state | modes/kinds: fill (needs: fill) | all 19 | Build › Features tool › Fill |
| Start / deposit margin (px) | `fill-margin` | slider; 0 to 4096, step 16; Green: 96 |  | tool state | modes/kinds: fill (needs: fill) | all 19 | Build › Features tool › Fill |
| Brush radius (px) | `fill-radius` | slider; 16 to 1024, step 16; Green: 128 |  | tool state | modes/kinds: fill (needs: fill) | all 19 | Build › Features tool › Fill |

## World tab

| Control | Id or key | Kind, range, Green value | What it does | Saved in | Shown at the baseline | Worlds | Accepted destination |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Unique ground tiles | `knob-groundTiles` | slider; 1 to 16, step 1; Green: 16 |  | world (this browser) | default view | disabled on 3 of 19: This world's ground is one texture, not tiles. Choose another world's Ground pattern to use this setting. | World › Ground › Pattern |
| Pattern contrast | `knob-groundContrast` | slider; 0 to 2, step 0.05; Green: 1 |  | world (this browser) | default view | active on all 19 | World › Ground › Pattern |
| Ground patches (damp and dusty tones) | `knob-groundPatch` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Ground › Pattern |
| Patch size (px) | `knob-groundPatchSize` | slider; 60 to 400, step 10; Green: 200 |  | world (this browser) | default view (needs: Ground patches) | disabled on 19 of 19: Enable Ground patches to use this setting. | World › Ground › Pattern |
| Undulation height | `knob-undulation` | slider; 0 to 16, step 0.5; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Ground › Terrain shape |
| Undulation size (px) | `knob-undulationScale` | slider; 48 to 400, step 8; Green: 48 |  | world (this browser) | default view (needs: Undulation height) | disabled on 19 of 19: Enable Undulation height to use this setting. | World › Ground › Terrain shape |
| Undulating share of land | `knob-undulationCover` | slider; 0 to 1, step 0.05; Green: 0.4 |  | world (this browser) | default view (needs: Undulation height) | disabled on 19 of 19: Enable Undulation height to use this setting. | World › Ground › Terrain shape |
| Undulation in the art | `knob-undulationArt` | slider; 0 to 1, step 0.05; Green: 1 |  | world (this browser) | default view (needs: Undulation height) | disabled on 19 of 19: Enable Undulation height to use this setting. | World › Ground › Terrain shape |
| Landform face steepness | `knob-faceSteep` | slider; 1 to 4, step 0.1; Green: 1 |  | world (this browser) | default view | active on all 19 | World › Ground › Terrain shape |
| Scale (px) | `knob-reliefScale` | slider; 8 to 64, step 1; Green: 28 |  | world (this browser) | default view | active on all 19 | World › Ground › Bumps & relief |
| Strength | `knob-reliefAmount` | slider; 0 to 1.2, step 0.05; Green: 0.25 |  | world (this browser) | default view | active on all 19 | World › Ground › Bumps & relief |
| Lumps | `knob-reliefLumps` | slider; 0 to 1, step 0.05; Green: 0.7 |  | world (this browser) | default view | active on all 19 | World › Ground › Bumps & relief |
| Branching | `knob-reliefBranch` | slider; 0 to 4, step 0.1; Green: 2 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Ground › Bumps & relief |
| Warp (px) | `knob-reliefWarp` | slider; 0 to 24, step 1; Green: 10 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Ground › Bumps & relief |
| Patchiness | `knob-reliefPatchy` | slider; 0 to 1, step 0.05; Green: 1 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Ground › Bumps & relief |
| Rib irregularity | `knob-reliefJitter` | slider; 0 to 1, step 0.05; Green: 0.8 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Ground › Bumps & relief |
| Gentle-slope relief | `knob-gentleRelief` | slider; 0 to 1, step 0.05; Green: 0.6 |  | world (this browser) | default view | active on all 19 | World › Ground › Bumps & relief |
| Ground bumps | `knob-plainRelief` | slider; 0 to 3, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Ground › Bumps & relief |
| Painted ground bumps | `knob-lumpRelief` | slider; 0 to 8, step 0.1; Green: 4 |  | world (this browser) | default view | active on all 19 | World › Ground › Bumps & relief |
| Octaves | `knob-reliefOctaves` | slider; 1 to 6, step 1; Green: 5 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Ground › Bumps & relief |
| Wormy relief on slopes | `knob-worms` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Ground › Bumps & relief |
| Vegetation cover (0 off) | `knob-vegetationCover` | slider; 0 to 2, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Vegetation › Cover |
| Lushness | `knob-lushness` | slider; -1 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Vegetation › Cover |
| Bare soil where cover thins | `knob-soilRim` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Vegetation › Cover |
| Rain (wets channels and hollows, and wears the ground) | `knob-erosionRain` | slider; 0 to 2, step 0.05; Green: 1 |  | world (this browser) | default view | active on all 19 | World › Rain & erosion › Rain & erosion |
| Moisture | `knob-wetSwath` | slider; 0 to 1, step 0.05; Green: 0.35 |  | world (this browser) | default view | disabled on 16 of 19: With no rain no ground is wet, so Moisture has nothing to move. Raise Rain to use this setting. | World › Rain & erosion › Rain & erosion |
| Wet ground: darker and glossy where water lies | `knob-wetGround` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Rain & erosion › Rain & erosion |
| Vegetation relief | `knob-plantRelief` | slider; 0 to 2, step 0.05; Green: 1 |  | world (this browser) | default view (needs: Vegetation cover) | disabled on 18 of 19: Raise Vegetation cover to use this setting. | World › Vegetation › Cover |
| Flower density | `knob-flowerDensity` | slider; 0 to 4, step 0.05; Green: 1 |  | world (this browser) | default view (needs: Vegetation cover) | disabled on 18 of 19: Raise Vegetation cover to use this setting. | World › Vegetation › Cover |
| Slope-cover brightness | `knob-hillLight` | slider; 0.6 to 1.6, step 0.01; Green: 1 |  | world (this browser) | default view | active on all 19 | World › Ground › Slope cover |
| Fringe fade length | `knob-ringFade` | slider; 0 to 2, step 0.05; Green: 0 |  | world (this browser) | only with "Show fine controls" | disabled on 18 of 19: This world draws no mineral fringe. | World › Water & shores › Mineral fringe |
| Fill light on shaded faces | `knob-faceFill` | slider; 0 to 0.5, step 0.02; Green: 0.18 |  | world (this browser) | default view | active on all 19 | World › Light & shine › Sun & shade |
| Bare rock to the crown | `knob-rockCrown` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Where rock shows |
| Painted sand to the crown (sand bars) | `knob-sandCrown` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Sand › Sand |
| Sampled slope texture | `knob-slopeTexture` | slider; 0 to 1, step 0.05; Green: 0.3 |  | world (this browser) | default view | disabled on 4 of 19: The ground cover decides the slope cover while Vegetation cover is above 0. / The sediment transition replaces the slope color at 100 percent Material weathering, so this scales only the slope's gloss. Lower Material weathering, or set a Gloss or Roughness above zero in one of the Shine groups, to use this setting. / The slopes of this world are sand, which has no texture to s | World › Ground › Slope cover |
| Moss from ground | `knob-moss` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Vegetation › Cover |
| Dark slope marks | `knob-slopeMarks` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Ground › Slope cover |
| Joined slope wrinkles | `knob-wrinkles` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Ground › Slope cover |
| Gloss (highlight strength) | `knob-shineRock` | slider; 0 to 2, step 0.05; Green: 0.35 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Surface & crust |
| Reflection sharpness (polish) | `knob-shineRockSharp` | slider; 2 to 200, step 2; Green: 2 |  | rock type (map file), and the world in this browser | default view (needs: Gloss) | disabled on 9 of 19: Enable Gloss in Shine: rock to use this setting. | World › Rock types › Surface & crust |
| Micro roughness (grain slope) | `knob-shineRockRough` | slider; 0 to 2, step 0.05; Green: 0.2 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Surface & crust |
| Grain width (px) | `knob-shineRockScale` | slider; 1 to 24, step 0.5; Green: 5 |  | rock type (map file), and the world in this browser | default view (needs: Roughness) | disabled on 9 of 19: Enable Roughness in Shine: rock to use this setting. | World › Rock types › Surface & crust |
| Rock glints kept outside painted rock | `knob-shineOutside` | slider; 0 to 1, step 0.05; Green: 1 |  | world (this browser) | only with "Show fine controls" (needs: a Gloss) | disabled on 9 of 19: Set a Gloss or Roughness above zero in one of the Shine groups to use this setting. | World › Light & shine › Shine |
| Supply | `knob-looseSupply` | slider; 0 to 1, step 0.05; Green: 0.1 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Loose stones |
| Size (median, px) | `knob-looseSize` | slider; 2 to 24, step 1; Green: 4 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Stones & debris |
| Boulders under walls | `knob-boulders` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Loose stones |
| Size sorting | `knob-stoneSort` | slider; 0 to 1, step 0.05; Green: 0.5 |  | rock type (map file), and the world in this browser | default view (needs: loose-stone Supply, Boulders) | disabled on 12 of 19: Raise loose-stone Supply, Boulders or Cliff debris accumulation, or paint Denser scatter, to shape the stones. | World › Rock types › Stones & debris |
| Rounded fragments (share) | `knob-stoneRound` | slider; 0 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view (needs: loose-stone Supply, Boulders) | disabled on 12 of 19: Raise loose-stone Supply, Boulders or Cliff debris accumulation, or paint Denser scatter, to shape the stones. | World › Rock types › Stones & debris |
| Flat fragments (share) | `knob-stoneSlab` | slider; 0 to 1, step 0.05; Green: 0.05 |  | rock type (map file), and the world in this browser | default view (needs: loose-stone Supply, Boulders) | disabled on 12 of 19: Raise loose-stone Supply, Boulders or Cliff debris accumulation, or paint Denser scatter, to shape the stones. | World › Rock types › Stones & debris |
| Knolls (share of stones that are ground rings around a hollow) | `knob-looseKnoll` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Loose stones |
| Frost (crack depth; above 1 the fine fractures fill in) | `knob-crackSeverity` | slider; 0 to 1.5, step 0.05; Green: 0.6 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Cracks |
| Block size (px) | `knob-crackSpacing` | slider; 16 to 96, step 2; Green: 40 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Cracks |
| Major cracks | `knob-crackMajor` | slider; 0 to 1, step 0.05; Green: 0.8 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Cliffs & stones › Cracks |
| Minor cracks | `knob-crackMinor` | slider; 0 to 1, step 0.05; Green: 0.75 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Cliffs & stones › Cracks |
| Hairline crazing | `knob-crackHairline` | slider; 0 to 1, step 0.05; Green: 0.6 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Cliffs & stones › Cracks |
| Facets (block relief) | `knob-crackBlocks` | slider; 0 to 1.5, step 0.05; Green: 0.6 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Cliffs & stones › Cracks |
| Width (px) | `knob-crackWidth` | slider; 0.5 to 2.5, step 0.1; Green: 1 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Cliffs & stones › Cracks |
| Majors: rills to plates | `knob-crackNetwork` | slider; 0 to 1, step 0.05; Green: 0.35 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Cliffs & stones › Cracks |
| Floor darkness | `knob-crackDark` | slider; 0 to 1, step 0.05; Green: 0.75 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Cliffs & stones › Cracks |
| Strength | `knob-banding` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Bands |
| Riser share | `knob-bandSoftness` | slider; 0.05 to 1, step 0.05; Green: 0.35 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Cliffs & stones › Bands |
| Rings in water color | `knob-bandWater` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | only with "Show fine controls" | disabled on 4 of 19: The ramp is drawn only where the step is off: choose Ramp in Hard shallow-to-deep step, or give a water stroke a Faded edge, to use this setting. | World › Cliffs & stones › Bands |
| Streaks on sand and ramps | `knob-sandBanding` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Bands |
| Streak height step | `knob-sandBandSpacing` | slider; 0.3 to 4, step 0.1; Green: 2 |  | world (this browser) | only with "Show fine controls" (needs: Streaks on sand and ramps) | disabled on 17 of 19: Enable Streaks on sand and ramps to use this setting. | World › Cliffs & stones › Bands |
| Layer color coverage (0.5 rock, 1 whole outcrop) | `knob-strata` | slider; 0 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view (needs: a rock column) | disabled on 13 of 19: Add a rock column in the Rock column panel to use this setting. | World › Rock types › Layers |
| Color strength | `knob-strataContrast` | slider; 0 to 1, step 0.05; Green: 0.6 |  | rock type (map file), and the world in this browser | default view (needs: Layer color coverage; a rock column) | disabled on 16 of 19: Enable Layer color coverage in Strata to use this setting. / Add a rock column in the Rock column panel to use this setting. | World › Rock types › Layers |
| Bed grain | `knob-strataGrain` | slider; 0 to 1, step 0.05; Green: 1 |  | rock type (map file), and the world in this browser | only with "Show fine controls" (needs: Layer color coverage; a rock column) | disabled on 16 of 19: Enable Layer color coverage in Strata to use this setting. / Add a rock column in the Rock column panel to use this setting. | World › Rock types › Layers |
| Bed tilt (height per px; 2 north: level rows) | `knob-bedDip` | slider; -4 to 4, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Layers |
| Bed tilt toward (deg, 0 east, 90 south) | `knob-bedDipDir` | slider; 0 to 360, step 5; Green: 90 |  | rock type (map file), and the world in this browser | default view (needs: Bed tilt) | disabled on 19 of 19: Set Bed tilt above or below zero, or raise Fold amplitude, to choose its direction. | World › Rock types › Layers |
| Depth | `knob-rockFace` | slider; 0 to 4, step 0.1; Green: 2 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Exposure & relief |
| Rock share of steep faces | `knob-faceRock` | slider; 0 to 1, step 0.05; Green: 0.9 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Exposure & relief |
| Starts at slope | `knob-rockFaceFrom` | slider; 0.2 to 2, step 0.05; Green: 0.2 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Exposure & relief |
| Bare rock at rims (px) | `knob-rimReach` | slider; 0 to 80, step 2; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Where rock shows |
| Rock at shores (px inland) | `knob-shoreRock` | slider; 0 to 96, step 2; Green: 0 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Cliffs & stones › Where rock shows |
| Rock shelf under water (px out) | `knob-shoreShelf` | slider; 0 to 96, step 2; Green: 0 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Cliffs & stones › Where rock shows |
| Extrusion bias: inset to projecting | `knob-faceExtrude` | slider; -1 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Exposure & relief |
| Broad bulges and alcoves | `knob-faceMass` | slider; 0 to 3, step 0.05; Green: 2.6 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Exposure & relief |
| Whole blocks (share of blocks) | `knob-faceWhole` | slider; 0 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Blocks & joints |
| Whole large blocks (share of blocks) | `knob-faceWholeLarge` | slider; 0 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Blocks & joints |
| Block regularity (0 scattered, 1 a grid) | `knob-faceRegular` | slider; 0 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Blocks & joints |
| Block offsets and tilts | `knob-faceBlock` | slider; 0 to 6, step 0.1; Green: 3 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Blocks & joints |
| Joint spacing (px) | `knob-faceBlockSize` | slider; 4 to 48, step 1; Green: 7 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Blocks & joints |
| Block length / width | `knob-faceStretch` | slider; 0.25 to 4, step 0.05; Green: 1 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Blocks & joints |
| Block height / layer height (blocks are never under 3.5 units tall) | `knob-faceBlockHeight` | slider; 0.25 to 6, step 0.05; Green: 1 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Blocks & joints |
| Joint tilt from vertical (deg) | `knob-faceJointTilt` | slider; -65 to 65, step 1; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Blocks & joints |
| Block size variation | `knob-faceScaleVary` | slider; 0 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Blocks & joints |
| Block release | `knob-faceBreak` | slider; 0 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Blocks & joints |
| Rounded blocks | `knob-faceRound` | slider; 0 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Blocks & joints |
| Joint depth | `knob-faceJoint` | slider; 0 to 3, step 0.05; Green: 0.15 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Blocks & joints |
| Joint opening width | `knob-faceJointWidth` | slider; 0.25 to 3, step 0.05; Green: 1 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Blocks & joints |
| Secondary fracture depth | `knob-faceSecondary` | slider; 0 to 2, step 0.05; Green: 0.35 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Blocks & joints |
| Fracture continuity | `knob-faceContinuity` | slider; 0 to 1, step 0.05; Green: 1 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Blocks & joints |
| Joint orientation from north-south (deg) | `knob-faceLean` | slider; -45 to 45, step 1; Green: 28 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Blocks & joints |
| Variation between repeated beds | `knob-bedCycleVary` | slider; 0 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | disabled on 14 of 19: Add at least two beds to a Rock column section to vary their repetition. | World › Rock types › Layers |
| Layer waviness | `knob-faceBedVary` | slider; 0 to 3, step 0.05; Green: 1 |  | rock type (map file), and the world in this browser | default view (needs: a rock column) | disabled on 13 of 19: Add a rock column in the Rock column panel to use this setting. | World › Rock types › Layers |
| Layer thickness (height) | `knob-faceBed` | slider; 2 to 30, step 0.5; Green: 2.5 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Layers |
| Hard-layer ledges | `knob-faceLedge` | slider; 0 to 4, step 0.05; Green: 1.2 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Layers |
| Layer variation length (px) | `knob-faceRun` | slider; 20 to 300, step 5; Green: 90 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Layers |
| Fold amplitude (height) | `knob-faceFold` | slider; 0 to 48, step 1; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Layers |
| Broken layer edges | `knob-faceSpall` | slider; 0 to 4, step 0.1; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Layers |
| Fine layer relief | `knob-faceLamina` | slider; 0 to 3, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Layers |
| Fine layer spacing (height units) | `knob-faceLaminaSize` | slider; 6 to 16, step 0.5; Green: 6 |  | rock type (map file), and the world in this browser | default view (needs: Fine layer relief) | disabled on 18 of 19: Enable Fine layer relief to use this setting. | World › Rock types › Layers |
| Soil-covered terraces | `knob-faceLayers` | slider; 0 to 2, step 0.05; Green: 1 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Layers |
| Grass on ledges and flat tops | `knob-faceGrass` | slider; 0 to 1, step 0.05; Green: 0.4 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Layers |
| Weathering: rounded edges, open joints | `knob-faceWear` | slider; 0 to 1, step 0.05; Green: 0.15 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Weathering |
| Pitting | `knob-faceCrease` | slider; 0 to 6, step 0.1; Green: 1 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Weathering |
| Pit size (px) | `knob-faceCreaseSize` | slider; 3 to 24, step 1; Green: 6 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Weathering |
| Scratches and water grooves | `knob-faceScratch` | slider; 0 to 6, step 0.1; Green: 1 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Weathering |
| Groove spacing (px) | `knob-faceScratchSize` | slider; 3 to 20, step 0.5; Green: 7 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Weathering |
| Groove length (px) | `knob-faceScratchLength` | slider; 4 to 160, step 2; Green: 50 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Weathering |
| Groove tilt from vertical (deg) | `knob-faceScratchAngle` | slider; -90 to 90, step 5; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Weathering |
| Embedded fragment relief | `knob-faceClast` | slider; 0 to 4, step 0.1; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Weathering |
| Embedded fragment size (px) | `knob-faceClastSize` | slider; 3 to 32, step 1; Green: 12 |  | rock type (map file), and the world in this browser | default view (needs: Embedded fragment relief) | disabled on 19 of 19: Enable Embedded fragment relief to use this setting. | World › Rock types › Weathering |
| Fine detail clustering | `knob-faceDetailPatch` | slider; 0 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Weathering |
| Grit relief | `knob-faceGrit` | slider; 0 to 2, step 0.05; Green: 0.5 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Weathering |
| Grit size (px) | `knob-faceGritSize` | slider; 1 to 6, step 0.1; Green: 1.3 |  | rock type (map file), and the world in this browser | default view (needs: Grit relief, Mineral contrast,) | disabled on 14 of 19: Raise Grit relief, Mineral contrast, or a lit weathered crust to use Grit size. | World › Rock types › Weathering |
| Runoff exposure | `knob-runoff` | slider; 0 to 2, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Weathering |
| Catchment variation size (px) | `knob-runoffScale` | slider; 8 to 80, step 2; Green: 24 |  | rock type (map file), and the world in this browser | default view (needs: Runoff exposure) | disabled on 16 of 19: Enable Runoff exposure to use this setting. | World › Rock types › Weathering |
| Channel concentration | `knob-runoffConcentration` | slider; 0 to 1, step 0.05; Green: 0.65 |  | rock type (map file), and the world in this browser | default view (needs: Runoff exposure) | disabled on 16 of 19: Enable Runoff exposure to use this setting. | World › Rock types › Weathering |
| Channel incision | `knob-runoffCut` | slider; 0 to 8, step 0.1; Green: 2 |  | rock type (map file), and the world in this browser | default view (needs: Runoff exposure) | disabled on 16 of 19: Enable Runoff exposure to use this setting. | World › Rock types › Weathering |
| Mineral staining | `knob-runoffStain` | slider; 0 to 1, step 0.05; Green: 0.5 |  | rock type (map file), and the world in this browser | default view (needs: Runoff exposure) | disabled on 16 of 19: Enable Runoff exposure to use this setting. | World › Rock types › Weathering |
| Cliff debris accumulation | `knob-debrisAmount` | slider; 0 to 2, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Stones & debris |
| Rockfall reach (px) | `knob-debrisReach` | slider; 8 to 96, step 2; Green: 56 |  | rock type (map file), and the world in this browser | default view (needs: Cliff debris accumulation) | disabled on 17 of 19: Enable Cliff debris accumulation to use this setting. | World › Rock types › Stones & debris |
| Accumulated bed thickness | `knob-debrisDepth` | slider; 0 to 12, step 0.25; Green: 4 |  | rock type (map file), and the world in this browser | default view (needs: Cliff debris accumulation) | disabled on 17 of 19: Enable Cliff debris accumulation to use this setting. | World › Rock types › Stones & debris |
| Color deepens with thickness | `knob-absorbDepth` | slider; 0 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Colors & recipe |
| Colored cast shadow | `knob-shadowTint` | slider; 0 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Colors & recipe |
| Shadow and crevice depth | `knob-faceShade` | slider; 0 to 1, step 0.05; Green: 0.65 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Surface & crust |
| Color variation between blocks | `knob-faceTone` | slider; 0 to 0.5, step 0.01; Green: 0.12 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Surface & crust |
| Fresh fracture contrast | `knob-faceFresh` | slider; 0 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Surface & crust |
| Weathered crust coverage | `knob-faceRind` | slider; 0 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Surface & crust |
| Weathering penetration (art units) | `knob-faceRindDepth` | slider; 0 to 20, step 0.25; Green: 6 |  | rock type (map file), and the world in this browser | default view (needs: fresh fractures) | disabled on 16 of 19: Enable fresh fractures or a weathered crust, with Block release, Broken layer edges, or Joint depth. | World › Rock types › Surface & crust |
| Crust lightness (dark to bleached) | `knob-faceRindTone` | slider; -0.65 to 0.65, step 0.05; Green: -0.2 |  | rock type (map file), and the world in this browser | default view (needs: Weathered crust coverage) | disabled on 16 of 19: Enable Weathered crust coverage to use this setting. | World › Rock types › Surface & crust |
| Crust oxidation | `knob-faceRindWarmth` | slider; 0 to 1, step 0.05; Green: 0.35 |  | rock type (map file), and the world in this browser | default view (needs: Weathered crust coverage) | disabled on 16 of 19: Enable Weathered crust coverage to use this setting. | World › Rock types › Surface & crust |
| Crust finish (0 polished, 1 rough) | `knob-faceRindRough` | slider; 0 to 1, step 0.05; Green: 0.65 |  | rock type (map file), and the world in this browser | default view (needs: Weathered crust coverage) | disabled on 16 of 19: Enable Weathered crust coverage to use this setting. | World › Rock types › Surface & crust |
| Mineral contrast | `knob-faceMineral` | slider; 0 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Surface & crust |
| Layer tint: lighter and darker | `knob-faceStrata` | slider; 0 to 0.5, step 0.01; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Surface & crust |
| Wetness: darker rock, smoother reflections | `knob-faceWet` | slider; 0 to 1, step 0.05; Green: 0 |  | rock type (map file), and the world in this browser | default view | active on all 19 | World › Rock types › Surface & crust |
| Coast ramp (share of the drawn slope kept) | `knob-coastRamp` | slider; 0.05 to 1, step 0.05; Green: 0.75 |  | world (this browser) | default view | active on all 19 | World › Water & shores › Shore & beach |
| Beach width (worlds with beaches) | `knob-beachWidth` | slider; 0 to 2, step 0.05; Green: 0.6 |  | world (this browser) | default view | disabled on 17 of 19: This world has no beach of its own. Choose another world's Beach in Colors & base pattern to use this setting. | World › Water & shores › Shore & beach |
| Sand apron round raised rock (px) | `knob-apron` | slider; 0 to 120, step 2; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Water & shores › Shore & beach |
| Shallow until depth | `knob-shallowDepth` | slider; 0 to 60, step 1; Green: 24 |  | world (this browser) | default view | active on all 19 | World › Water & shores › Depths & edges |
| Deep from depth | `knob-deepDepth` | slider; 10 to 100, step 1; Green: 60 |  | world (this browser) | default view | active on all 19 | World › Water & shores › Depths & edges |
| Color depth averaging (px) | `knob-waterSoft` | slider; 0 to 64, step 2; Green: 32 |  | world (this browser) | only with "Show fine controls" | disabled on 4 of 19: The ramp is drawn only where the step is off: choose Ramp in Hard shallow-to-deep step, or give a water stroke a Faded edge, to use this setting. | World › Water & shores › Depths & edges |
| Crisp waterline (shore to shallow) | `knob-crispShore` | slider; 0 to 1, step 0.05; Green: 1 |  | world (this browser) | default view | active on all 19 | World › Water & shores › Depths & edges |
| Hard shallow-to-deep step (0 ramp) | `knob-deepEdge` | choice; Ramp / Hard step; Green: 1 |  | world (this browser) | default view | active on all 19 | World › Water & shores › Depths & edges |
| Bed tint strength | `knob-bedTint` | slider; 0 to 1, step 0.05; Green: 1 |  | world (this browser) | default view | active on all 19 | World › Water & shores › Water bed |
| Tinted bed brightness | `knob-bedBright` | slider; 0.5 to 1.5, step 0.02; Green: 1 |  | world (this browser) | default view | active on all 19 | World › Water & shores › Water bed |
| Bed light carried through the tint | `knob-bedContrast` | slider; 0 to 1.5, step 0.05; Green: 0.7 |  | world (this browser) | default view | active on all 19 | World › Water & shores › Water bed |
| Bed lumps (lit relief under shallows) | `knob-bedRelief` | slider; 0 to 3, step 0.05; Green: 2 |  | world (this browser) | default view | active on all 19 | World › Water & shores › Water bed |
| Waterline rim and lip | `knob-shoreEdge` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Water & shores › Shore & beach |
| Rock on low banks | `knob-bankRock` | slider; 0 to 1, step 0.05; Green: 0.25 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Water & shores › Shore & beach |
| Threshold edge softness (px) | `knob-stepSoftPx` | slider; 1 to 40, step 1; Green: 1 |  | world (this browser) | only with "Show fine controls" (needs: Hard shallow-to-deep step,) | disabled on 15 of 19: Enable Hard shallow-to-deep step, or a water stroke's Hard edge to use this setting. | World › Water & shores › Depths & edges |
| Shelf wander (depth units) | `knob-shelfWander` | slider; 0 to 40, step 1; Green: 24 |  | world (this browser) | default view (needs: Hard shallow-to-deep step,) | disabled on 15 of 19: Enable Hard shallow-to-deep step, or a water stroke's Hard edge to use this setting. | World › Water & shores › Depths & edges |
| Bed lit by its own relief only | `knob-bedFlat` | slider; 0 to 1, step 0.05; Green: 1 |  | world (this browser) | default view | active on all 19 | World › Water & shores › Water bed |
| Shallow-to-deep notches (px) | `knob-shoalRag` | slider; 0 to 16, step 0.5; Green: 5 |  | world (this browser) | only with "Show fine controls" (needs: Hard shallow-to-deep step,) | disabled on 15 of 19: Enable Hard shallow-to-deep step, or a water stroke's Hard edge to use this setting. | World › Water & shores › Depths & edges |
| Hard waterline stairs (px) | `knob-shoalStairs` | slider; 0 to 6, step 0.1; Green: 2 |  | world (this browser) | only with "Show fine controls" | disabled on 1 of 19: Waterline blur replaces the stairs. Set it to 0 to use this setting. | World › Water & shores › Depths & edges |
| Waterline blur (px) | `knob-shoalShoreSoft` | slider; 0 to 12, step 0.5; Green: 0 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Water & shores › Depths & edges |
| Fringe contour lines: contrast | `knob-ringContrast` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | disabled on 18 of 19: This world draws no mineral fringe. | World › Water & shores › Mineral fringe |
| Fringe contour lines: count | `knob-ringCount` | slider; 1 to 30, step 1; Green: 7 |  | world (this browser) | default view | disabled on 18 of 19: This world draws no mineral fringe. | World › Water & shores › Mineral fringe |
| Fringe contour lines: reach | `knob-ringSize` | slider; 0.1 to 2, step 0.05; Green: 1 |  | world (this browser) | default view | disabled on 18 of 19: This world draws no mineral fringe. | World › Water & shores › Mineral fringe |
| Offset between copies (px; 0: concentric lines) | `knob-ringShift` | slider; 0 to 30, step 0.5; Green: 0 |  | world (this browser) | default view | disabled on 18 of 19: This world draws no mineral fringe. | World › Water & shores › Mineral fringe |
| Drift direction (deg clockwise from east) | `knob-ringShiftDir` | slider; 0 to 360, step 5; Green: 315 |  | world (this browser) | only with "Show fine controls" | disabled on 18 of 19: This world draws no mineral fringe. | World › Water & shores › Mineral fringe |
| Direction wander (share of a half turn) | `knob-ringScatter` | slider; 0 to 1, step 0.05; Green: 0.5 |  | world (this browser) | only with "Show fine controls" | disabled on 18 of 19: This world draws no mineral fringe. | World › Water & shores › Mineral fringe |
| Outline waver (px) | `knob-ringWobble` | slider; 0 to 10, step 0.5; Green: 3 |  | world (this browser) | only with "Show fine controls" | disabled on 18 of 19: This world draws no mineral fringe. | World › Water & shores › Mineral fringe |
| Lobe size (px) | `knob-ringLobe` | slider; 8 to 60, step 1; Green: 22 |  | world (this browser) | only with "Show fine controls" | disabled on 18 of 19: This world draws no mineral fringe. | World › Water & shores › Mineral fringe |
| Pale tint where copies overlap | `knob-ringFill` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | only with "Show fine controls" | disabled on 18 of 19: This world draws no mineral fringe. | World › Water & shores › Mineral fringe |
| Reach varies along the outline | `knob-ringPatch` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | only with "Show fine controls" | disabled on 18 of 19: This world draws no mineral fringe. | World › Water & shores › Mineral fringe |
| Reach variation size (px) | `knob-ringPatchSize` | slider; 30 to 400, step 5; Green: 120 |  | world (this browser) | only with "Show fine controls" | disabled on 18 of 19: This world draws no mineral fringe. | World › Water & shores › Mineral fringe |
| Retail rose, paler outward | `knob-ringTone` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | disabled on 18 of 19: This world draws no mineral fringe. | World › Water & shores › Mineral fringe |
| Dark crease at each step foot, any facing | `knob-layerCrease` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Bands |
| Shine only on slopes above (0: everywhere) | `knob-shineSlopeGate` | slider; 0 to 1.5, step 0.05; Green: 0 |  | world (this browser) | only with "Show fine controls" (needs: a Gloss) | disabled on 9 of 19: Set a Gloss or Roughness above zero in one of the Shine groups to use this setting. | World › Light & shine › Shine |
| Needle hairlines | `knob-iceFrost` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Special surfaces |
| Melt pockets: share of cells at the coast | `knob-frostGaps` | slider; 0 to 0.6, step 0.01; Green: 0.17 |  | world (this browser) | default view | active on all 19 | World › Water & shores › Shore & beach |
| Melt pockets: reach inland (share of the band) | `knob-frostGapReach` | slider; 0.2 to 1.2, step 0.05; Green: 0.65 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Water & shores › Shore & beach |
| Melt pockets: size (px) | `knob-frostGapSize` | slider; 3 to 24, step 1; Green: 11 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Water & shores › Shore & beach |
| Melt pockets: depth below the sea | `knob-frostGapDepth` | slider; 0.5 to 6, step 0.1; Green: 3 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Water & shores › Shore & beach |
| Tint (Colors: Low ground) | `knob-lowTint` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Ground › Low ground |
| Reach (height above the sea) | `knob-lowReach` | slider; 0.5 to 40, step 0.5; Green: 6 |  | world (this browser) | default view (needs: Tint) | disabled on 17 of 19: Raise Tint or lower Grain kept in Low ground to use this setting. | World › Ground › Low ground |
| Grain kept (low ground and water) | `knob-lowGrain` | slider; 0 to 1, step 0.05; Green: 1 |  | world (this browser) | default view | active on all 19 | World › Ground › Low ground |
| Deposit supply | `knob-sand` | slider; 0 to 2, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Sand › Sand |
| Wind drifts (sand in the lee of rises) | `knob-sandLee` | slider; 0 to 2, step 0.05; Green: 0 |  | world (this browser) | default view (needs: Deposit supply) | disabled on 19 of 19: Enable Deposit supply in Sand to use this setting. | World › Sand › Sand |
| Wind toward (degrees; ripples and drifts) | `knob-wind` | slider; 0 to 360, step 5; Green: 20 |  | world (this browser) | default view (needs: Weathering supply) | disabled on 2 of 19: Enable Weathering supply in Sand to use this setting. | World › Sand › Sand |
| Dusting tint | `knob-sandDust` | slider; 0 to 1, step 0.05; Green: 0.5 |  | world (this browser) | only with "Show fine controls" (needs: Weathering supply) | disabled on 2 of 19: Enable Weathering supply in Sand to use this setting. | World › Sand › Sand |
| Vegetation through sand | `knob-sandGrass` | slider; 0 to 1, step 0.05; Green: 0.6 |  | world (this browser) | only with "Show fine controls" (needs: Weathering supply) | disabled on 2 of 19: Enable Weathering supply in Sand to use this setting. | World › Sand › Sand |
| Weathered lightness | `knob-sandLight` | slider; 0 to 1, step 0.05; Green: 0.25 |  | world (this browser) | default view (needs: Weathering supply) | disabled on 2 of 19: Enable Weathering supply in Sand to use this setting. | World › Sand › Sand |
| Rock grain in sand | `knob-sandGrain` | slider; 0 to 1, step 0.05; Green: 0.8 |  | world (this browser) | default view (needs: Weathering supply) | disabled on 2 of 19: Enable Weathering supply in Sand to use this setting. | World › Sand › Sand |
| Ripple length (px) | `knob-ripple` | slider; 0 to 16, step 1; Green: 7 |  | world (this browser) | default view (needs: Weathering supply) | disabled on 2 of 19: Enable Weathering supply in Sand to use this setting. | World › Sand › Sand |
| Ripple height | `knob-rippleHeight` | slider; 0 to 3, step 0.1; Green: 1.4 |  | world (this browser) | default view (needs: Weathering supply) | disabled on 2 of 19: Enable Weathering supply in Sand to use this setting. | World › Sand › Sand |
| Gray band strength | `knob-baseBand` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view (needs: Layer color coverage; a rock column) | disabled on 16 of 19: Enable Layer color coverage in Strata to use this setting. / Add a rock column in the Rock column panel to use this setting. | World › Cliffs & stones › Bands |
| Window from (height) | `knob-baseBandLow` | slider; 0 to 12, step 0.5; Green: 4 |  | world (this browser) | only with "Show fine controls" (needs: Layer color coverage; a rock column) | disabled on 16 of 19: Enable Layer color coverage in Strata to use this setting. / Add a rock column in the Rock column panel to use this setting. | World › Cliffs & stones › Bands |
| Window to (height) | `knob-baseBandHigh` | slider; 1 to 16, step 0.5; Green: 6.5 |  | world (this browser) | only with "Show fine controls" (needs: Layer color coverage; a rock column) | disabled on 16 of 19: Enable Layer color coverage in Strata to use this setting. / Add a rock column in the Rock column panel to use this setting. | World › Cliffs & stones › Bands |
| Window drift (height) | `knob-baseBandWander` | slider; 0 to 4, step 0.25; Green: 1 |  | world (this browser) | only with "Show fine controls" (needs: Layer color coverage; a rock column) | disabled on 16 of 19: Enable Layer color coverage in Strata to use this setting. / Add a rock column in the Rock column panel to use this setting. | World › Cliffs & stones › Bands |
| Share missing | `knob-baseBandGaps` | slider; 0 to 0.9, step 0.05; Green: 0.45 |  | world (this browser) | only with "Show fine controls" (needs: Layer color coverage; a rock column) | disabled on 16 of 19: Enable Layer color coverage in Strata to use this setting. / Add a rock column in the Rock column panel to use this setting. | World › Cliffs & stones › Bands |
| Uniform cap color | `knob-desertCapFlat` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view (needs: Layer color coverage; a rock column) | disabled on 17 of 19: Enable Layer color coverage in Strata to use this setting. / Add a rock column in the Rock column panel to use this setting. / The rock column has no cap bed: a section of two beds where one fills over 88 percent of the cycle. Add or edit one in the Rock column panel to use this setting. | World › Cliffs & stones › Bands |
| Pillow crust strength | `knob-lavaCrust` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Special surfaces |
| Pillow size (px) | `knob-lavaPillow` | slider; 16 to 80, step 1; Green: 34 |  | world (this browser) | default view (needs: Pillow crust strength) | disabled on 18 of 19: Enable Pillow crust strength to use this setting. | World › Cliffs & stones › Special surfaces |
| Chip size (px) | `knob-lavaChip` | slider; 3 to 12, step 0.5; Green: 5.5 |  | world (this browser) | only with "Show fine controls" (needs: Pillow crust strength) | disabled on 18 of 19: Enable Pillow crust strength to use this setting. | World › Cliffs & stones › Special surfaces |
| Veins hanging down the slope | `knob-lavaVeins` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view (needs: Pillow crust strength) | disabled on 18 of 19: Enable Pillow crust strength to use this setting. | World › Cliffs & stones › Special surfaces |
| Replace fine relief with crust | `knob-lavaCalm` | slider; 0 to 1, step 0.05; Green: 0.6 |  | world (this browser) | only with "Show fine controls" (needs: Pillow crust strength) | disabled on 18 of 19: Enable Pillow crust strength to use this setting. | World › Cliffs & stones › Special surfaces |
| Shade away from light | `knob-lavaDusk` | slider; 0 to 2, step 0.05; Green: 0 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Cliffs & stones › Special surfaces |
| Dark pits on raised ground and slopes | `knob-pockmark` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Special surfaces |
| Pit spacing (px) | `knob-pockSize` | slider; 3 to 12, step 0.5; Green: 5 |  | world (this browser) | only with "Show fine controls" (needs: Surface pits) | disabled on 18 of 19: Enable Surface pits to use this setting. | World › Cliffs & stones › Special surfaces |
| Slope cups | `knob-moonCups` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Special surfaces |
| Cup spacing (px) | `knob-moonCupSize` | slider; 3 to 12, step 0.5; Green: 5.5 |  | world (this browser) | only with "Show fine controls" (needs: Slope cups) | disabled on 18 of 19: Enable Slope cups to use this setting. | World › Cliffs & stones › Special surfaces |
| Cup depth (wall steepness) | `knob-moonCupDepth` | slider; 0.4 to 3, step 0.1; Green: 1.4 |  | world (this browser) | only with "Show fine controls" (needs: Slope cups) | disabled on 18 of 19: Enable Slope cups to use this setting. | World › Cliffs & stones › Special surfaces |
| Cup stretch into strokes (1: pits) | `knob-cupStretch` | slider; 1 to 3, step 0.1; Green: 1 |  | world (this browser) | only with "Show fine controls" (needs: Slope cups) | disabled on 18 of 19: Enable Slope cups to use this setting. | World › Cliffs & stones › Special surfaces |
| Slope ribs | `knob-moonRibs` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Special surfaces |
| Stroke steepness | `knob-moonRibDepth` | slider; 0.2 to 3, step 0.1; Green: 1 |  | world (this browser) | only with "Show fine controls" (needs: Slope ribs) | disabled on 18 of 19: Enable Slope ribs to use this setting. | World › Cliffs & stones › Special surfaces |
| Darker where turned from the sun | `knob-moonRibDark` | slider; 0 to 0.9, step 0.05; Green: 0 |  | world (this browser) | only with "Show fine controls" (needs: Slope ribs) | disabled on 18 of 19: Enable Slope ribs to use this setting. | World › Cliffs & stones › Special surfaces |
| Contour folds | `knob-moonFolds` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Special surfaces |
| Fold spacing (height units) | `knob-moonFoldSpacing` | slider; 0.3 to 3, step 0.1; Green: 0.9 |  | world (this browser) | only with "Show fine controls" (needs: Contour folds) | disabled on 18 of 19: Enable Contour folds to use this setting. | World › Cliffs & stones › Special surfaces |
| Straight face fibres | `knob-iceCrystal` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Special surfaces |
| Gouges across crystal formations | `knob-gougeWeb` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Special surfaces |
| Cap lumps | `knob-iceCrest` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Special surfaces |
| Rounded lighting | `knob-iceSoft` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Special surfaces |
| Snow on level caps | `knob-iceSnow` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Special surfaces |
| Slope fibres | `knob-iceFall` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Special surfaces |
| Hatched foot apron | `knob-iceApron` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Cliffs & stones › Special surfaces |
| Cast shadow on level ground | `knob-flatShadow` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Light & shine › Sun & shade |
| Occlusion on level ground | `knob-flatOcclusion` | slider; 0 to 1, step 0.05; Green: 0.4 |  | world (this browser) | default view | active on all 19 | World › Light & shine › Sun & shade |
| Highlight cap | `knob-lightCap` | slider; 1 to 1.6, step 0.01; Green: 1.13 |  | world (this browser) | default view | active on all 19 | World › Light & shine › Sun & shade |
| Directional shading kept | `knob-shadeDepth` | slider; 0 to 1, step 0.05; Green: 1 |  | world (this browser) | default view | active on all 19 | World › Light & shine › Sun & shade |
| Light from the south | `knob-sunTilt` | slider; -1 to 1, step 0.05; Green: 1 |  | world (this browser) | default view | active on all 19 | World › Light & shine › Sun & shade |
| Sun height (degrees above the horizon) | `knob-sunHeight` | slider; 20 to 75, step 1; Green: 45 |  | world (this browser) | default view | active on all 19 | World › Light & shine › Sun & shade |
| Ambient light | `knob-ambient` | slider; 0 to 0.8, step 0.02; Green: 0.42 |  | world (this browser) | default view | active on all 19 | World › Light & shine › Sun & shade |
| Shade in creases (gully and valley floors, any facing) | `knob-creaseShade` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Light & shine › Sun & shade |
| Grain streak length (x its width) | `knob-shineStretch` | slider; 1 to 8, step 0.25; Green: 1 |  | world (this browser) | only with "Show fine controls" (needs: a Roughness) | disabled on 9 of 19: Set a Roughness above zero in one of the Shine groups to use this setting. | World › Light & shine › Shine |
| Highlight whiteness (0 material hue, 1 white) | `knob-shineWhite` | slider; 0 to 1, step 0.05; Green: 1 |  | world (this browser) | only with "Show fine controls" (needs: a Gloss) | disabled on 9 of 19: Set a Gloss above zero in one of the Shine groups to use this setting. | World › Light & shine › Shine |
| Gloss (highlight strength) | `knob-shineGround` | slider; 0 to 2, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Light & shine › Shine |
| Reflection sharpness (polish) | `knob-shineGroundSharp` | slider; 2 to 200, step 2; Green: 24 |  | world (this browser) | only with "Show fine controls" (needs: Gloss) | disabled on 18 of 19: Enable Gloss in Shine: ground to use this setting. | World › Light & shine › Shine |
| Micro roughness (grain slope) | `knob-shineGroundRough` | slider; 0 to 2, step 0.05; Green: 0 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Light & shine › Shine |
| Grain width (px) | `knob-shineGroundScale` | slider; 1 to 24, step 0.5; Green: 6 |  | world (this browser) | only with "Show fine controls" (needs: Roughness) | disabled on 16 of 19: Enable Roughness in Shine: ground to use this setting. | World › Light & shine › Shine |
| Gloss (highlight strength) | `knob-shineSlope` | slider; 0 to 2, step 0.05; Green: 0 |  | world (this browser) | default view | disabled on 3 of 19: The ground cover decides the slope cover while Vegetation cover is above 0, so the slope cover has no share to shine. / Sampled slope texture is 0, so the slope cover has no share to shine. Raise Sampled slope texture to use this setting. | World › Light & shine › Shine |
| Reflection sharpness (polish) | `knob-shineSlopeSharp` | slider; 2 to 200, step 2; Green: 24 |  | world (this browser) | only with "Show fine controls" (needs: Gloss) | disabled on 16 of 19: Enable Gloss in Shine: slope cover to use this setting. / The ground cover decides the slope cover while Vegetation cover is above 0, so the slope cover has no share to shine. / Sampled slope texture is 0, so the slope cover has no share to shine. Raise Sampled slope texture to use this setting. | World › Light & shine › Shine |
| Micro roughness (grain slope) | `knob-shineSlopeRough` | slider; 0 to 2, step 0.05; Green: 0 |  | world (this browser) | only with "Show fine controls" | disabled on 3 of 19: The ground cover decides the slope cover while Vegetation cover is above 0, so the slope cover has no share to shine. / Sampled slope texture is 0, so the slope cover has no share to shine. Raise Sampled slope texture to use this setting. | World › Light & shine › Shine |
| Grain width (px) | `knob-shineSlopeScale` | slider; 1 to 24, step 0.5; Green: 6 |  | world (this browser) | only with "Show fine controls" (needs: Roughness) | disabled on 16 of 19: Enable Roughness in Shine: slope cover to use this setting. / The ground cover decides the slope cover while Vegetation cover is above 0, so the slope cover has no share to shine. / Sampled slope texture is 0, so the slope cover has no share to shine. Raise Sampled slope texture to use this setting. | World › Light & shine › Shine |
| Gloss (highlight strength) | `knob-shineSand` | slider; 0 to 2, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Light & shine › Shine |
| Reflection sharpness (polish) | `knob-shineSandSharp` | slider; 2 to 200, step 2; Green: 24 |  | world (this browser) | only with "Show fine controls" (needs: Gloss) | disabled on 19 of 19: Enable Gloss in Shine: sand to use this setting. | World › Light & shine › Shine |
| Micro roughness (grain slope) | `knob-shineSandRough` | slider; 0 to 2, step 0.05; Green: 0 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Light & shine › Shine |
| Grain width (px) | `knob-shineSandScale` | slider; 1 to 24, step 0.5; Green: 6 |  | world (this browser) | only with "Show fine controls" (needs: Roughness) | disabled on 19 of 19: Enable Roughness in Shine: sand to use this setting. | World › Light & shine › Shine |
| Gloss (highlight strength) | `knob-shineCrystal` | slider; 0 to 2, step 0.05; Green: 0 |  | world (this browser) | default view | active on all 19 | World › Light & shine › Shine |
| Reflection sharpness (polish) | `knob-shineCrystalSharp` | slider; 2 to 200, step 2; Green: 24 |  | world (this browser) | only with "Show fine controls" (needs: Gloss) | disabled on 18 of 19: Enable Gloss in Shine: crystal to use this setting. | World › Light & shine › Shine |
| Micro roughness (grain slope) | `knob-shineCrystalRough` | slider; 0 to 2, step 0.05; Green: 0 |  | world (this browser) | only with "Show fine controls" | active on all 19 | World › Light & shine › Shine |
| Grain width (px) | `knob-shineCrystalScale` | slider; 1 to 24, step 0.5; Green: 6 |  | world (this browser) | only with "Show fine controls" (needs: Roughness) | disabled on 18 of 19: Enable Roughness in Shine: crystal to use this setting. | World › Light & shine › Shine |
| Roughness only on raised ground and slopes | `knob-shineGate` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | only with "Show fine controls" (needs: a Gloss) | disabled on 9 of 19: Set a Gloss or Roughness above zero in one of the Shine groups to use this setting. | World › Light & shine › Shine |
| Dim the body between glints (near-white surface) | `knob-shineHeadroom` | slider; 0 to 1, step 0.05; Green: 0 |  | world (this browser) | only with "Show fine controls" (needs: a Gloss) | disabled on 9 of 19: Set a Gloss above zero in one of the Shine groups to use this setting. | World › Light & shine › Shine |
| World | `biome-select` | choice; Green Planet / Red Planet / Archipelago / Moon / Zhon / Lava / Painted Desert / Crystal / …; Green: biome:green | Which world (biome) the map is drawn in. Reloads the page. | map file | default view |  | World › World › Top bar world picker |
| Variant | `variant-select` | choice; The world's own / Evad River: broken slopes / Modern: realistic look (in progress) | A named look for this world's family of retail maps; it loads over the world's own knobs. | map file | default view |  | World › World › Top bar world picker |
| Ground pattern | `ground-pattern` | choice; This world's own / Moon / Zhon / Lava / Painted Desert / Ice | Another world's ground grain, moved to this world's Ground color. Contrast is under Ground below. | world (this browser) | default view |  | World › Ground › Pattern |
| Beach | `beach-from` | choice; None / Zhon | Another world's beach sand along this world's shores. Beach width under Water sets its reach, and the Beach color below its color. | world (this browser) | default view |  | World › Water & shores › Shore & beach |
| Use a base color for Ground | `` | switch; Green: false |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Ground base color | `` | color; Green: #375d1b |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Use a base color for Slope cover | `` | switch; Green: false |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Slope cover base color | `` | color; Green: #375d1d |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Use a base color for Rock | `` | switch; Green: true |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Rock base color | `` | color; Green: #747474 |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Use a base color for Sand | `` | switch; Green: false |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Sand base color | `` | color; Green: #757773 |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Use a base color for Shallow water | `` | switch; Green: false |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Shallow water base color | `` | color; Green: #608afc |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Use a base color for Deep water | `` | switch; Green: false |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Deep water base color | `` | color; Green: #264ce2 |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Use a base color for Crystal | `` | switch; Green: false |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Crystal base color | `` | color; Green: #6e96e1 |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Use a base color for Vegetation | `` | switch; Green: false |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Vegetation base color | `` | color; Green: #375f1b |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Use a base color for Flower 1 | `` | switch; Green: false |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Flower 1 base color | `` | color; Green: #ece8d6 |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Use a base color for Flower 2 | `` | switch; Green: false |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Flower 2 base color | `` | color; Green: #ffd640 |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Use a base color for Flower 3 | `` | switch; Green: false |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Flower 3 base color | `` | color; Green: #aa78d7 |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Use a base color for Flower 4 | `` | switch; Green: false |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Flower 4 base color | `` | color; Green: #e1503c |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Use a base color for Sun color | `` | switch; Green: false |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Sun color base color | `` | color; Green: #ffffff |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Use a base color for Sky color | `` | switch; Green: false |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Sky color base color | `` | color; Green: #ffffff |  | world (this browser) | default view | all 19 | World › Colors › Colors |
| Reset colors | `world-reset` | button |  | world (this browser) | default view |  | World › Colors › Colors |
| Material weathering | `material-weathering` | slider; 0 to 100, step 1; Green: 0 | Broken material edges, buried pockets and deposits. Refines after painting. | map file | hidden |  | World › Ground › Legacy (stays hidden) |
| Deposit spread | `deposit-spread` | slider; 0 to 100, step 1; Green: 65 |  | map file | hidden |  | World › Ground › Legacy (stays hidden) |
| Find a setting | `world-search` | text | 246 settings · including fine controls | not saved | default view |  | World › World panel header |
| Show fine controls | `world-fine` | switch; Green: true | Shows the 70 rows marked fine. | not saved | default view |  | World › World panel header |
| Rock presets | `rock-presets` | choice; World rock (the world's rock) / Smooth soil; Green: 0 | The settings below and the Rock column edit the selected preset. A shape chooses its rock in its Rock option; the first preset is the world’s own rock. | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| Name | `rock-name` | text; Green: World rock | The settings below and the Rock column edit the selected preset. A shape chooses its rock in its Rock option; the first preset is the world’s own rock. | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| Rename | `rock-rename` | button | The settings below and the Rock column edit the selected preset. A shape chooses its rock in its Rock option; the first preset is the world’s own rock. | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| Add a preset | `rock-add` | choice; Add a preset from… / Layered sandstone / Thin shale / Rounded granite / Jointed basalt / P… | The settings below and the Rock column edit the selected preset. A shape chooses its rock in its Rock option; the first preset is the world’s own rock. | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| Duplicate | `rock-duplicate` | button | The settings below and the Rock column edit the selected preset. A shape chooses its rock in its Rock option; the first preset is the world’s own rock. | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| Delete | `rock-delete` | button | The settings below and the Rock column edit the selected preset. A shape chooses its rock in its Rock option; the first preset is the world’s own rock. | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| Copy recipe | `rock-copy` | button | The settings below and the Rock column edit the selected preset. A shape chooses its rock in its Rock option; the first preset is the world’s own rock. | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| Paste recipe | `rock-paste` | button | The settings below and the Rock column edit the selected preset. A shape chooses its rock in its Rock option; the first preset is the world’s own rock. | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| Rock | `rock-color` | color; Green: #747474 | The rock’s color is what its faces wear, lit and weathered by the settings below; the bed slots color its Rock column’s beds where Strata shows them. Absorption is the color thick translucent rock deepens toward and its cast shadow takes (Rock translucency); unless one is chosen, it is the rock’s own color. The square after each color is the palette entry the game draws it with (before dithering). | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| World’s colors | `rock-color-world` | switch; Green: true | The rock’s color is what its faces wear, lit and weathered by the settings below; the bed slots color its Rock column’s beds where Strata shows them. Absorption is the color thick translucent rock deepens toward and its cast shadow takes (Rock translucency); unless one is chosen, it is the rock’s own color. The square after each color is the palette entry the game draws it with (before dithering). | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| Bed slot 1 | `rock-bed-1` | color; Green: #30322d | The rock’s color is what its faces wear, lit and weathered by the settings below; the bed slots color its Rock column’s beds where Strata shows them. Absorption is the color thick translucent rock deepens toward and its cast shadow takes (Rock translucency); unless one is chosen, it is the rock’s own color. The square after each color is the palette entry the game draws it with (before dithering). | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| Bed slot 2 | `rock-bed-2` | color; Green: #43453f | The rock’s color is what its faces wear, lit and weathered by the settings below; the bed slots color its Rock column’s beds where Strata shows them. Absorption is the color thick translucent rock deepens toward and its cast shadow takes (Rock translucency); unless one is chosen, it is the rock’s own color. The square after each color is the palette entry the game draws it with (before dithering). | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| Bed slot 3 | `rock-bed-3` | color; Green: #262723 | The rock’s color is what its faces wear, lit and weathered by the settings below; the bed slots color its Rock column’s beds where Strata shows them. Absorption is the color thick translucent rock deepens toward and its cast shadow takes (Rock translucency); unless one is chosen, it is the rock’s own color. The square after each color is the palette entry the game draws it with (before dithering). | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| Bed slot 4 | `rock-bed-4` | color; Green: #4d5048 | The rock’s color is what its faces wear, lit and weathered by the settings below; the bed slots color its Rock column’s beds where Strata shows them. Absorption is the color thick translucent rock deepens toward and its cast shadow takes (Rock translucency); unless one is chosen, it is the rock’s own color. The square after each color is the palette entry the game draws it with (before dithering). | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| Bed slot 5 | `rock-bed-5` | color; Green: #373934 | The rock’s color is what its faces wear, lit and weathered by the settings below; the bed slots color its Rock column’s beds where Strata shows them. Absorption is the color thick translucent rock deepens toward and its cast shadow takes (Rock translucency); unless one is chosen, it is the rock’s own color. The square after each color is the palette entry the game draws it with (before dithering). | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| World’s colors | `rock-beds-world` | switch; Green: true | The rock’s color is what its faces wear, lit and weathered by the settings below; the bed slots color its Rock column’s beds where Strata shows them. Absorption is the color thick translucent rock deepens toward and its cast shadow takes (Rock translucency); unless one is chosen, it is the rock’s own color. The square after each color is the palette entry the game draws it with (before dithering). | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| Absorption | `rock-absorb` | color; Green: #ffffff | The rock’s color is what its faces wear, lit and weathered by the settings below; the bed slots color its Rock column’s beds where Strata shows them. Absorption is the color thick translucent rock deepens toward and its cast shadow takes (Rock translucency); unless one is chosen, it is the rock’s own color. The square after each color is the palette entry the game draws it with (before dithering). | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| World’s colors | `rock-absorb-world` | switch; Green: true | The rock’s color is what its faces wear, lit and weathered by the settings below; the bed slots color its Rock column’s beds where Strata shows them. Absorption is the color thick translucent rock deepens toward and its cast shadow takes (Rock translucency); unless one is chosen, it is the rock’s own color. The square after each color is the palette entry the game draws it with (before dithering). | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| Start from | `rock-preset` | choice; Custom / current settings / Layered sandstone / Thin shale / Rounded granite / Jointed bas… | Sets the selected preset’s relief, surface finish, its Rock column’s bed thickness and hardness, and its colors (the world’s rock keeps the world’s colors). Every setting remains editable. | rock type (map file) | default view |  | World › Rock types › Colors & recipe |
| Style | `crack-style` | choice; Choose a style… / Branching rock / Hairline / Polygonal plates / Deep fissures | How much each shape cracks is its own Cracks slider (Shape panel). | world (this browser) | default view |  | World › Cliffs & stones › Cracks |
| Surface relief | `relief` | slider; 0 to 160, step 5; Green: 100 | Small surface folds across the map. A landform's smooth route stays clear of them. | map file | default view |  | World › Ground › Bumps & relief |
| Transition detail | `transition-detail` | slider; 0 to 100, step 1; Green: 65 | Retain mineral grain and fine cracks through material blends. | map file | hidden |  | World › Water & shores › Mineral fringe |
| Mineral fringe | `mineral-ring` | slider; 0 to 100, step 1; Green: 0 |  | map file | hidden |  | World › Water & shores › Mineral fringe |
| Fringe spread | `ring-spread` | slider; 0 to 100, step 1; Green: 65 |  | map file | hidden |  | World › Water & shores › Mineral fringe |
| Fringe variation | `ring-variation` | slider; 0 to 100, step 1; Green: 70 | Vary the reach and coverage of the transition into surrounding ground. | map file | hidden |  | World › Water & shores › Mineral fringe |
| Remove | `` | button |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Starts at height | `sections.0.start` | number; number; Green: 0 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 1 thickness | `sections.0.beds.0.0` | number; 0.001 to ; Green: 4 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 1 hardness | `sections.0.beds.0.1` | number; 0 to 1; Green: 0.9 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 1 material | `sections.0.beds.0.2` | choice; Slot 1 / Slot 2 / Slot 3 / Slot 4 / Slot 5; Green: 0 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| × | `` | button |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 2 thickness | `sections.0.beds.1.0` | number; 0.001 to ; Green: 7 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 2 hardness | `sections.0.beds.1.1` | number; 0 to 1; Green: 0.2 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 2 material | `sections.0.beds.1.2` | choice; Slot 1 / Slot 2 / Slot 3 / Slot 4 / Slot 5; Green: 1 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| × | `` | button |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 3 thickness | `sections.0.beds.2.0` | number; 0.001 to ; Green: 3 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 3 hardness | `sections.0.beds.2.1` | number; 0 to 1; Green: 0.7 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 3 material | `sections.0.beds.2.2` | choice; Slot 1 / Slot 2 / Slot 3 / Slot 4 / Slot 5; Green: 0 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| × | `` | button |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 4 thickness | `sections.0.beds.3.0` | number; 0.001 to ; Green: 8 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 4 hardness | `sections.0.beds.3.1` | number; 0 to 1; Green: 0.15 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 4 material | `sections.0.beds.3.2` | choice; Slot 1 / Slot 2 / Slot 3 / Slot 4 / Slot 5; Green: 1 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| × | `` | button |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 5 thickness | `sections.0.beds.4.0` | number; 0.001 to ; Green: 5 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 5 hardness | `sections.0.beds.4.1` | number; 0 to 1; Green: 1 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 5 material | `sections.0.beds.4.2` | choice; Slot 1 / Slot 2 / Slot 3 / Slot 4 / Slot 5; Green: 0 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| × | `` | button |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 6 thickness | `sections.0.beds.5.0` | number; 0.001 to ; Green: 7 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 6 hardness | `sections.0.beds.5.1` | number; 0 to 1; Green: 0.3 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 6 material | `sections.0.beds.5.2` | choice; Slot 1 / Slot 2 / Slot 3 / Slot 4 / Slot 5; Green: 1 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| × | `` | button |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 7 thickness | `sections.0.beds.6.0` | number; 0.001 to ; Green: 4 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 7 hardness | `sections.0.beds.6.1` | number; 0 to 1; Green: 0.6 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 7 material | `sections.0.beds.6.2` | choice; Slot 1 / Slot 2 / Slot 3 / Slot 4 / Slot 5; Green: 0 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| × | `` | button |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 8 thickness | `sections.0.beds.7.0` | number; 0.001 to ; Green: 9 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 8 hardness | `sections.0.beds.7.1` | number; 0 to 1; Green: 0.2 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Section 1, bed 8 material | `sections.0.beds.7.2` | choice; Slot 1 / Slot 2 / Slot 3 / Slot 4 / Slot 5; Green: 1 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| × | `` | button |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Add bed | `` | button |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Add section | `` | button |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Height step | `bands.0` | number; 0.001 to ; Green: 3.7 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Line strength | `bands.1` | number; 0 to 1; Green: 0.84 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Bed wander | `wander.value` | number; number; Green: 5 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Slot 1 | `colors.0` | color; Green: #30322d |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Slot 2 | `colors.1` | color; Green: #43453f |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Slot 3 | `colors.2` | color; Green: #262723 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Slot 4 | `colors.3` | color; Green: #4d5048 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Slot 5 | `colors.4` | color; Green: #373934 |  | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Restore world column | `` | button | Beds repeat upward within each section. Their colors and hardness follow the same voxel layers, folds, and thickness variation. Enable Layer color coverage in Strata to show the slot colors. Changes belong to this map. \| Using the world column unchanged. | rock type (map file): the world's rock keeps it as the map's column, a map rock inside its own entry | default view |  | World › Rock types › Layers > Rock column |
| Reset strokes to world defaults | `reset-strokes` | button | Every stroke keeps its shape and tool; all of its settings, including ones you changed, return to this world's and variant's defaults. | map file | default view |  | World › World › Manage |
| New world name | `world-new-name` | text |  | world (this browser) / file | default view |  | World › World › Manage |
| New world | `world-new` | button |  | world (this browser) / file | default view |  | World › World › Manage |
| Export world | `world-export` | button |  | world (this browser) / file | default view |  | World › World › Manage |
| Import world | `world-import` | button |  | world (this browser) / file | default view |  | World › World › Manage |
| Restore built-in settings | `world-delete` | button |  | world (this browser) / file | default view |  | World › World › Manage |
| Use a base color for Beach | `` | switch; Green: false |  | world (this browser) | default view | only zhon, zhon-river | World › Colors › Colors |
| Beach base color | `` | color; Green: #c5a778 |  | world (this browser) | default view | only zhon, zhon-river | World › Colors › Colors |

## Map tab

| Control | Id or key | Kind, range, Green value | What it does | Saved in | Shown at the baseline | Worlds | Accepted destination |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Width (units) | `map-x` | number; 1 to 40; Green: 4 |  | map file | default view |  | Top bar › Map menu › Map |
| Height (units) | `map-y` | number; 1 to 40; Green: 4 |  | map file | default view |  | Top bar › Map menu › Map |
| Sea level (0–255) | `map-sea` | number; 0 to 255; Green: 75 |  | map file | default view |  | Top bar › Map menu › Map |
| New map canvas | `map-new` | button | 130 × 136 cells · 2080 × 2176 px · play 2048 × 2048 px \| New map starts blank. Yellow: play rectangle. Orange: height-dependent edge strips. Use the Features tool to place objects and player starts. | map file | default view |  | Top bar › Map menu › Map |
| Map name | `map-name` | text; Green: Sculpt map |  | map file | default view |  | Top bar › Map menu › Map |
| Description | `map-description` | text; Green: Terrain editor prototype |  | map file | default view |  | Top bar › Map menu › Map |
| Minimum wind | `map-minWind` | number; 0 to 2147483647; Green: 500 |  | map file | default view |  | Top bar › Map menu › Game settings (OTA) |
| Maximum wind | `map-maxWind` | number; 0 to 2147483647; Green: 4500 |  | map file | default view |  | Top bar › Map menu › Game settings (OTA) |
| Tidal strength | `map-tidal` | number; 0 to 2147483647; Green: 25 |  | map file | default view |  | Top bar › Map menu › Game settings (OTA) |
| Solar strength | `map-solar` | number; 0 to 2147483647; Green: 20 |  | map file | default view |  | Top bar › Map menu › Game settings (OTA) |
| Gravity | `map-gravity` | number; 0 to 2147483647; Green: 112 |  | map file | default view |  | Top bar › Map menu › Game settings (OTA) |
| Surface metal | `map-surfaceMetal` | number; 0 to 255; Green: 3 |  | map file | default view |  | Top bar › Map menu › Game settings (OTA) |
| Moho metal | `map-mohoMetal` | number; 0 to 2147483647; Green: 40 |  | map file | default view |  | Top bar › Map menu › Game settings (OTA) |
| Molten terrain | `map-lava` | switch; Green: false |  | map file | default view |  | Top bar › Map menu › Game settings (OTA) |
| Restore world defaults | `map-defaults` | button | Defaults are medians of the world's retail maps. Wind uses the OTA's stored integer units. | map file | default view |  | Top bar › Map menu › Game settings (OTA) |
| Clear terrain | `blank` | button |  | map file | default view |  | Top bar › Map menu › Clear terrain |
| Map size readout | `map-geometry` | display | Cells, pixels and the play rectangle of the current map. | not saved | default view |  | Top bar › Map menu › Map |

## Shapes tab

| Control | Id or key | Kind, range, Green value | What it does | Saved in | Shown at the baseline | Worlds | Accepted destination |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ↑ | `node-up` | button | Move shape up | map file | default view |  | Build › Shapes list |
| ↓ | `node-down` | button | Move shape down | map file | default view |  | Build › Shapes list |
| New seed | `node-seed` | button |  | map file | default view |  | Build › Shapes list › also on the card header |
| Hide | `node-hide` | button |  | map file | default view |  | Build › Shapes list |
| Delete | `node-delete` | button |  | map file | default view |  | Build › Shapes list |
| Shapes list (drag to reorder, eye to hide, click to select) | `layers` | list | Every shape, newest first. Order decides which shape wins where they overlap. | map file | default view |  | Build › Shapes list |

## Export pane

| Control | Id or key | Kind, range, Green value | What it does | Saved in | Shown at the baseline | Worlds | Accepted destination |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Export .ufo | `map-export` | button | OTA planet: Green planet. Climate: medians from its installed maps. | not saved | default view |  | Top bar › Export dialog › .ufo |
| Cancel export | `map-cancel` | button | OTA planet: Green planet. Climate: medians from its installed maps. | not saved | hidden until needed |  | Top bar › Export dialog › .ufo |
| Export view PNG | `export` | button | Save the currently visible terrain as an image. | not saved | default view |  | Top bar › Export dialog › View image |
| Export status line | `map-export-state` | display | The world's OTA planet and where its climate numbers come from; a note when the map has more than 65,536 tile slots; each export stage; warnings such as clamped heights; the result. | not saved | default view |  | Top bar › Export dialog › .ufo > status |
| Download .ufo (link) | `map-download` | link | The finished archive, kept until the next export. | not saved | after an export |  | Top bar › Export dialog › .ufo > downloads |
| Indexed terrain image (link) | `map-download` | link | The exported terrain as an indexed picture. | not saved | after an export |  | Top bar › Export dialog › .ufo > downloads |

## Settings pane

| Control | Id or key | Kind, range, Green value | What it does | Saved in | Shown at the baseline | Worlds | Accepted destination |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Mix palette pairs (0 nearest, 1 pairs) | `knob-paletteMix` | choice; Nearest color / Mix color pairs; Green: 0 | A World setting shown in the Settings pane today, beside the TA palette switch. | world (this browser) | default view (Settings pane) |  | World › Palette › Palette |
| Dither (water) | `knob-dither` | slider; 0 to 4, step 0.1; Green: 2 | A World setting shown in the Settings pane today, beside the TA palette switch. | world (this browser) | default view (Settings pane) |  | World › Palette › Palette |
| Land dither share | `knob-landDither` | slider; 0 to 1, step 0.05; Green: 0.25 | A World setting shown in the Settings pane today, beside the TA palette switch. | world (this browser) | default view (Settings pane) |  | World › Palette › Palette |
| Vary seed per new shape | `seed-vary` | switch; Green: true |  | map file / editor | default view |  | Top bar › Settings › Drawing |
| Simplify strokes | `simplify-strokes` | switch; Green: true |  | map file / editor | default view |  | Top bar › Settings › Drawing |
| Preview weathered detail | `weathered-view` | switch; Green: true | Show weathered terrain when zoomed in. Turn off for faster editing. Map export keeps the map’s weathering settings. | editor (this browser) | default view |  | Top bar › View menu › Preview weathered detail |
| Terrain GPU budget (MiB) | `` | number; 128 to 4096; Green: 512 |  | editor (this browser) | default view |  | Top bar › Settings › Memory |
| Page heap budget (MiB) | `` | number; 128 to 8192; Green: 1024 |  | editor (this browser) | default view |  | Top bar › Settings › Memory |
| TA palette | `` | switch; Green: true |  | editor (this browser) | default view |  | Top bar › View menu › TA palette preview |

## Dock

| Control | Id or key | Kind, range, Green value | What it does | Saved in | Shown at the baseline | Worlds | Accepted destination |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Minimap: drag to pan, or use arrow keys | `` | canvas |  | not saved | default view |  | Canvas › Navigator |
| curve-form | `curve-form` | choice; The shape's own / Plateau / Hill / Mountain / Terraced / Mesa / Cliff / Shore / Shelf / Ra…; Green: lfPlateau |  | shape (map file) | default view |  | Build › Profile strip › Cross-section |
| Drag points to shape the section. Click the line to add a point. Shift-click a point to remove it. Drag the diamond to lean. | `section-preview` | canvas | Drag points to shape the section. Click the line to add a point. Shift-click a point to remove it. Drag the diamond to lean. | shape (map file) | default view |  | Build › Profile strip › Cross-section |
| Sides linked | `curve-link` | button | Both sides share one curve | shape (map file) | default view |  | Build › Profile strip › Cross-section |
| Mirror | `curve-mirror` | button | Flip the section left to right | shape (map file) | default view |  | Build › Profile strip › Cross-section |
| Reset | `curve-reset` | button |  | shape (map file) | default view |  | Build › Profile strip › Cross-section |
| Click or drag away from points to move the section marker. Drag points to change height. Double-click to add a point. Shift-click to remove it. | `along-preview` | canvas | Click or drag away from points to move the section marker. Drag points to change height. Double-click to add a point. Shift-click to remove it. | shape (map file) | default view |  | Build › Profile strip › Height along the path |
| Reset | `along-reset` | button |  | shape (map file) | default view |  | Build › Profile strip › Height along the path |

## On and around the map

| Control | Id or key | Kind, range, Green value | What it does | Saved in | Shown at the baseline | Worlds | Accepted destination |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ◧ Tools | `toggle-tools` | button | Hide tools | editor (this browser) | default view |  | Top bar › Panels › Tool palette |
| ⛶ Focus ⇧F | `focus-canvas` | button | Focus canvas · Shift F | editor (this browser) | default view |  | Top bar › Panels › Hide panels (Tab) |
| Inspector ◨ | `toggle-inspector` | button | Hide inspector | editor (this browser) | default view |  | Top bar › Panels › Side panel |
| Edit paths | `canvas-path-mode` | button | Switch selection mode · P | editor (this browser) | hidden until needed |  | Build › Canvas bar › Selection |
| × | `canvas-deselect` | button | Deselect · Escape | editor (this browser) | hidden until needed |  | Build › Canvas bar › Selection |
| Movement | `passability-family` | choice; All classes / Vehicles / KBots / Hover / Amphibious / Ships; Green: overview |  | editor (this browser) | hidden until needed |  | Canvas › Passability bar › Movement class |
| Map canvas | `terrain/overlay` | display | Draw strokes; Space + drag pans; hover previews a shape; handles move, rotate and scale; path points drag. | not saved | default view |  | Canvas › Map |
| Levels readout | `levels` | display | Dry base, sea level and the height range. | not saved | default view |  | Status bar › Map facts |
| Passability legend and readout | `passability-legend` | display | Key, the hovered cell's movement classes and blocking reason. | not saved | default view |  | Canvas › Passability legend |
| Selection bar on the canvas | `selection-hud` | display | Mode, Edit path, Deselect. | not saved | default view |  | Build › Canvas bar › Selection |
| Hover help with a rendered example | `visual-help` | display | 14 tools and 17 shape rows have rendered examples (ui-previews/). | not saved | default view |  | Everywhere › Hover help |

## Footer

| Control | Id or key | Kind, range, Green value | What it does | Saved in | Shown at the baseline | Worlds | Accepted destination |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tool hint line | `tool-help` | display | What the active tool does and its shortcuts. | not saved | default view |  | Status bar › Hint |
| Render time and memory | `timing` | display |  | not saved | default view |  | Status bar › Progress |
| Status message (in a closed popover) | `status` | display |  | not saved | hidden |  | Status bar › Progress |
| Save state (in a closed popover) | `save-state` | display |  | not saved | hidden |  | Status bar › Saved state |
| Error line | `error` | display |  | not saved | default view |  | Status bar › Error |
| Weathering progress text (always hidden) | `weather-state` | display |  | not saved | hidden |  | Status bar › Progress |

## Hidden but alive

| Control | Id or key | Kind, range, Green value | What it does | Saved in | Shown at the baseline | Worlds | Accepted destination |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Light select (hidden; Original / Alternate) | `light` | display | Kept so saved values stay readable. | not saved | hidden |  | Hidden › stays hidden |

Also hidden today and kept: the "Legacy surface settings" panel of the World
tab (Material weathering, Deposit spread), the Clay checkbox behind the Clay
button, and the weathering progress text.

## Keyboard and pointer

| Keys or gesture | What it does | In the proposal |
| --- | --- | --- |
| V | Select tool; in Select, back to Transform | unchanged |
| P | Toggle Edit path for the selected shape | unchanged |
| Shift F | Focus canvas (hide both sidebars) | Tab also hides panels |
| Escape | Leave focus, path adding, add-path, path mode, selection, feature placement (in that order) | unchanged |
| Cmd/Ctrl Z, Shift Z | Undo, redo | unchanged |
| Delete / Backspace | Delete the selected path point, else the selected shape or feature | unchanged |
| Arrow keys (Shift: 10) | Nudge the selected shape or path point by 1 map px | unchanged |
| , and . | Rotate the selection 15° | unchanged |
| [ and ] | Scale the selection 10% | unchanged |
| Page Up / Down | Raise or lower the selection by 5 height units | unchanged |
| Space + drag | Pan the map | unchanged |
| Shift + drag (Select) | Change height; Shift also snaps rotate and scale | unchanged |
| Slider: drag, click, double-click or Enter to type, arrows, Page Up/Down, Home/End, Shift for fine | Every slider row | unchanged |
| Curve canvases: drag points, click line to add, Shift-click to remove, drag the diamond to lean, double-click to add (along) | Cross-section and Length vs. height | unchanged |

## Address parameters

| Parameter | What it does |
| --- | --- |
| `?biome= &world= &variant=` | Which world, saved world and look to open |
| `?mapX= &mapY= &sea=` | Map size in units and the sea level |
| `?map=<id>` | Open a shared map (save link) |
| `?scratch=<name>` | A throwaway session that does not touch the saved working map |
| `?<knob>=<value>` | Any World setting, written to the address as it changes |
| `?gpuMB= &gpuPages=` | Renderer memory switches (diagnostic) |

## Browser storage

| Key | Holds |
| --- | --- |
| `terraform-working-map-v1` | The working map (not used with `?scratch=`) |
| `terraform-previous-map-v1` | The visitor's own map, kept when a shared map replaces it |
| `nanolathe-map-editor-worlds` | World settings and saved worlds, for every map in this browser |
| `terraform-editor-panels` | Which sidebars are open |
| `terraform-weathered-view` | Preview weathered detail |
| `terraform-export` (origin private file system) | Export work files |

## Words that collide

| Thing | Words used at the baseline |
| --- | --- |
| A world | World (tab), biome (address), planet (export); the "Tool preset" list on every tool lists worlds |
| A world's named look | Variant, which also names a feature's sprites |
| Something drawn | Shape (toolbar, tab, buttons), "Landform #3" (its name, whatever tool drew it), stroke ("Reset strokes", "Simplify strokes"), brush ("Brush · new landform", "Brush diameter"), layer (list) |
| A tool's name | Hill on the button and "Rounded ridge" on the card; Mountain and "Peaked ridge" |
| Size | "Brush diameter" in "units" on the row and "px" in its hover example |
| Height | Elevation (height units), Rise, Height, height |
| Rock numbers | Rock presets, "Add a preset from…", "Start from", recipe ("Copy recipe") |
| Feature numbers | Recipe, preset ("Add a preset"), variants |
| Weathering | The top-bar switch (the erosion pass, exported), "Preview weathered detail" (a view), Material weathering (hidden), "Rock weathering & detail", "Weathering: rounded edges, open joints" |
| Cover | Ground cover (a vegetation brush), Slope cover (a material), Sand cover (a brush) |
| Fringe and bands | Mineral fringe, Contour fringe, Fringe spread; Contour bands; the rock column's Height step and Line strength |
| Back to defaults | Reset ground (a tool), Clear terrain, Reset strokes to world defaults, Restore built-in settings, Restore world column, Restore world defaults, Reset colors |
| Files | Save, Load, "map recipe", Share link, Export |
| Preferences | Settings (button), Graphics (tab id), Editor settings (heading) |

## Accepted destinations, by count

| Accepted destination | Rows |
| --- | --- |
| World › Rock types | 142 |
| Build › Shape card | 115 |
| Build › Features tool | 74 |
| World › Cliffs & stones | 54 |
| World › Water & shores | 42 |
| Build › Tool rail | 37 |
| World › Ground | 32 |
| World › Light & shine | 31 |
| World › Colors | 31 |
| Build › Canvas bar | 21 |
| Top bar › Map menu | 18 |
| Everywhere › Shortcuts | 14 |
| World › Sand | 10 |
| World › World | 8 |
| Top bar › Export dialog | 8 |
| Build › Profile strip | 7 |
| World › Vegetation | 6 |
| Build › Shapes list | 6 |
| Everywhere › Address | 6 |
| Top bar › Settings | 5 |
| Canvas › Zoom cluster | 5 |
| World › Rain & erosion | 4 |
| Top bar › View switch | 4 |
| World › Palette | 3 |
| Build › Feature card | 3 |
| Top bar › View menu | 3 |
| Top bar › Panels | 3 |
| Status bar › Progress | 3 |
| World › World panel header | 2 |
| Build › Starts tool | 2 |
| Top bar › File | 2 |
| Top bar › Undo / Redo | 2 |
| Top bar › Export button | 1 |
| Canvas › Navigator | 1 |
| Canvas › Passability bar | 1 |
| Canvas › Map | 1 |
| Status bar › Map facts | 1 |
| Canvas › Passability legend | 1 |
| Everywhere › Hover help | 1 |
| Status bar › Hint | 1 |
| Status bar › Saved state | 1 |
| Status bar › Error | 1 |
| Hidden › stays hidden | 1 |
