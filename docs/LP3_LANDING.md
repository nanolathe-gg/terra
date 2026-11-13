# LP3 landing on cleaned main, November 13

The owner approved landing the reviewed LP3 work and moving on to LP6.
The accepted limits remain explicit: paused Rain p95 is 100.3 ms in the clean
focused pair, the temporary 8-pixel view has a 31.5-pixel contour outlier,
and strict load-memory containment remains open. The earlier budget-error
run is excluded from acceptance. See [the Rain report](LP3_RAIN_RESPONSE.md)
and [current status](LIVE_PREVIEW_REVIEW.md).

Main's history was rewritten to remove generated images and obsolete files.
The 17 post-foundation commits from the old review branch were cherry-picked
onto cleaned main at `40097130`, preserving the old branch for reference.
The old ancestry was not merged. The later main changes through `d24ce044`
were then merged normally. The Go server, root editor, complete saves, feature
recipe fixes, UI changes, preview-release workflow, and retired Python/tests
remain as current main defines them.

The renderer retry unit now tests the bake pipeline, which still specializes,
instead of the shared fragment pipeline. The initial quick run passed 183 of
184 tests and the world-name gate; its one obsolete expectation was corrected,
and both affected renderer tests pass. The nine feature-set tests also pass
after the later main integration. Unchanged checks were not repeated.

The preview bundle is regenerated from the combined source and published through
the new receipt/fingerprint workflow before pushing. An initial completed render
was invalidated by main's subsequent input changes and discarded. No preview PNG
or old-history commit is brought back into Git.

The one-world Green browser smoke passes brush/undo behavior at `/` with an
empty error log in 42.3 seconds, without export or a large-map sweep. The
delayed-count and forced-overflow preview proof returns the same SHA-256
`d8de0c23e54ba97b07849a30abefd03492c3ae196423fe3df8511b8a905af835`
for all three images, with zero validation errors.

The complete bundle contains nine world thumbnails, 15 tools and 175 control
frames. It is published as [previews-86fe9039b7f1e7a2](https://github.com/nanolathe-gg/terraform/releases/tag/previews-86fe9039b7f1e7a2),
and `preview-assets.json` pins its verified receipt and checksum.
The existing performance numbers retain their original builds and scope; this
integration does not claim a new speed measurement. Broader scene, export,
control and realism sweeps remain on demand.

LP6 continues from the resulting latest main on `live-preview/lp6`, in the same
worktree. Its first investigation is final-tile allocation and count delivery;
new LP6 work is reviewed separately from this LP3 landing.
