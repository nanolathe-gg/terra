# Documentation

Start with [DESIGN.md](DESIGN.md). It is the one source of truth for the
project's goal, principles, owner decisions and architecture. The working
rules are in [AGENTS.md](../AGENTS.md).

| Doc | What it covers |
| --- | --- |
| [DESIGN.md](DESIGN.md) | Goal, principles, decisions in force, architecture, roadmap |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Setup, development server, checks, static site, deployment |
| [MATERIALS.md](MATERIALS.md) | Material node graphs, slots, the material editor and its cache |
| [SURFACE_LAYERS.md](SURFACE_LAYERS.md) | Surface layers: rules over facts, coverage, edges, plants |
| [FEATURE_RECIPES.md](FEATURE_RECIPES.md) | Generated feature recipes (trees, rocks) and how maps keep them |
| [PASSABILITY.md](PASSABILITY.md) | The passability view's movement classes and fords |
| [PREVIEW_ASSETS.md](PREVIEW_ASSETS.md) | How preview PNGs are rendered, published and checked |
| [IMPACT_RETAIL.md](IMPACT_RETAIL.md) | Crater measurements behind impact Buckling and Secondaries |

Elsewhere in the repository:

- [export/README.md](../export/README.md): the `.ufo` exporter's format contract
- [deploy/worker/README.md](../deploy/worker/README.md): the share-link Worker
- [repro/README.md](../repro/README.md): checks and reproduction tools
- [measure/README.md](../measure/README.md): analysis scripts

## Parked: matching the original game

Retail matching is parked while realism comes first (AGENTS.md rule 10).
These docs and their tools are kept for when it returns:

- [retail-match/](retail-match/README.md): the match harness, playbook,
  atlas, world dossiers, biome catalog and the private assets bundle
- [RETAIL_ROUND.md](RETAIL_ROUND.md): the older retail-round brief, which
  `repro/retail.sh` still follows

Plans, cards, reviews and reports from before 2026-11-21 were folded into
DESIGN.md. Their full text is in Git history at commit `3ee2584d`.
