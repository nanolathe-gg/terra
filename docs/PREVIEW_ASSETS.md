# Preview assets

The editor's authored preview PNGs are generated on a GPU machine and published
as `ui-previews.tar.gz` in a GitHub Release. They do not live in Git history.
The runtime manifest remains a small tracked JSON file; `preview-assets.json`
pins the release, archive SHA-256, input fingerprint and every file checksum.
The archive includes a rendering receipt binding those pixels to their inputs.

## Cloning and building

```sh
go run ./cmd/previews install-hook
go run ./cmd/terraform --port <yours> --assets-root /tmp/terraform-agent
```

The Go development/build commands fetch missing previews. Once cached, ordinary
development works offline. To explicitly fetch the pinned set:

```sh
go run ./cmd/previews fetch
```

A private repository requires GitHub authentication (`gh auth login`, `GH_TOKEN`
or `GITHUB_TOKEN`). Public release assets need no token. Downloaded archives
are cached by checksum in the OS user cache under `terraform/previews/`.
Local modified pictures are not silently overwritten: finish publishing the
render or explicitly run `fetch --replace` to restore the pinned set.
The static build copies the downloaded PNGs into its versioned asset directory;
the browser never downloads a GitHub release itself.

## Updating previews

Start your own Go editor server. The generator uses Chrome for the original
tool and New map examples and the approved Dawn Node binding for the expanded
control examples. The binding can be found through `TERRAFORM_WEBGPU` as
described in `repro/headless.mjs`.

```sh
node repro/ui-previews.mjs --server http://127.0.0.1:<yours> --port <cdp>
go run ./cmd/previews publish
```

World examples hold a fixed crop, seed and stroke list while changing one
setting. Each fixture enables the materials and parent settings the setting
needs. Shape examples use the same authored path or a fixture specific to that
feature, such as a shoreline or crystal cluster. The generator rejects a new
example with identical frames.

The renderer verifies the server's source files match the checkout and records
a receipt only after the complete render succeeds. If a rendering input changes
mid-render, stamping fails. `--worlds-only` is allowed only when the previous
complete receipt already matches the current inputs and pictures.

Publishing first compares the render with the pinned bundle's pixels, frame
by frame. A pixel has moved when any channel differs by more than 8 of 255
levels; a frame has changed visibly when more than 0.05% of its pixels moved
(about 25 of a 260x190 frame). A render of unchanged inputs matches exactly on
the same machine; the smallest real change seen in past bundles, a wrong
crystal tool picture, moved 0.117% of its frame.
When the manifest and file set are unchanged and no frame changed visibly,
publish makes no release: it keeps the pinned bundle, records the current
inputs as accepted in the lock (`inputsSHA256`, with the bundle's own
`renderedInputsSHA256` and the largest accepted change in `acceptedChange`)
and restores the pinned pictures locally. The comparison is always against
the pinned pixels, so accepted changes cannot add up unnoticed; once they do,
publish uploads a new bundle. `go run ./cmd/previews compare` prints the same
report without changing anything; `publish --force` uploads regardless, and
`--pixel-delta`/`--max-changed` (percent) adjust the tolerance. Every input
change still needs a full render: the comparison only saves the release.

Otherwise publishing validates PNG dimensions, the file set, receipt and input
fingerprint, then creates a deterministic archive. It creates/reuses a prerelease named by
its archive checksum, verifies the uploaded asset, and updates the lock. Release
tags point to a tiny parentless metadata commit; they pin no application history
or PNG blobs. Commit the lock and runtime manifest together with the source
change. Only authored procedural fixtures belong in this bundle.

`preview-inputs.json` lists rendering dependencies. Its fingerprint deliberately
covers complete render/orchestration files, world data and the generator; a
change in one of those files requires a new render even when visually subtle.
Docs, tests, CSS and asset-download code are outside that input set. Keep the
input list complete when adding rendering modules; do not narrow it to bypass
a failed freshness check.

## Before pushing

The installer records the hook directory as an absolute local path so other
worktrees cannot silently skip the gate. Install from your main checkout;
reinstall after moving the checkout. The installed `.githooks/pre-push` runs `go run ./cmd/previews check-push`.
It reads Git's outgoing ref/commit list and checks those snapshots, not merely
the current working tree. It fails if:

- Rendering inputs differ from the inputs the lock accepts.
- The runtime manifest differs from the bundle.
- The bundle is missing, still a draft, or has the wrong checksum/receipt.
- Preview PNGs or `smoke-out/` occur anywhere in the pushed branch history.

The check does not render or start a browser. Publication metadata is checked
on each push; the verified archive is cached. Tags and branch deletions do not
run the application check. CI repeats the freshness/publication check for main
and pull requests, so a missing local hook cannot silently ship stale previews.

```sh
go run ./cmd/previews check --published
repro/check.sh assets
```

`assets` adds PNG/manifest checks; the regular fast tests do not need PNGs.
The static build also rejects stale rendering inputs. The development server
allows work in progress with the last pinned pictures while rendering changes.

## History cleanup

The one-time cleanup removes preview PNGs and accidental `smoke-out/` files from
published branch history. Old local work branches and the recovery bundle remain
available; do not merge their old ancestry back into cleaned main. Start from
cleaned main and cherry-pick the source changes you need instead.
The existing private `dev-assets-20261028` prerelease and tag are left untouched
at the owner's request; that internal bundle is separate from authored previews.

The removed preview versions are preserved in `ui-previews-history.tar.gz` on
[the cleanup release](https://github.com/nanolathe-gg/terraform/releases/tag/previews-164451b6c5727037).
Its `index.json` maps original commit IDs and file names to content-addressed PNGs.
This archive is for historical lookup; normal builds download only `ui-previews.tar.gz`.
