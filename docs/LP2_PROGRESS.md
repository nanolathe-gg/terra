# LP2 progress: input batching

Implementation is on `live-preview/review`; main is untouched. This is a
partial card, not LP2 acceptance.

World/preset knob rows and World color choices now store their latest
values and update their numbers on input. One animation-frame batch applies
the combined uniform change. The address, World store, control sync and
checkpoint wait for release or 250 ms without input. Recipe handoffs flush
pending values first. Surface sliders and clay/light use the same queue;
applied render options stay stable until that frame, so a canvas frame
cannot consume an unapplied DOM value. Column/color synchronization now uses
one complete writer call.

Measured basic checks: 13 targeted CPU checks in about 50 ms; 130 exact
world-uniform comparisons; a 42-event World/color burst and then a 43-event
burst including surface detail each produce one renderer update. No address
or storage write happens in those input handlers or before the batch;
one of each happens after the pause. Release applies before commit. Pending
surface detail stays at its prior model value, then becomes exactly 0.7
(up to float storage) with the batch. The paged preset check keeps its local
1176×1394 dirty region and unchanged Time key; repeating its value does no
render work. Console errors: zero.

A mouse-driven rock row and cold gate plus the owner-authorized scripted
Colors workload accounted for 180/180 inputs, all bound to the native cache
serial. The custom page scrubs emit untrusted DOM `input` events from real
mouse gestures; Colors is the explicitly scripted workload. The GPU failed
the 20% quiet-start guard for a timing attempt, so that attempt aborted.
The subsequent run was correctness only and all its timings were discarded.
No new latency acceptance or speedup in milliseconds is claimed yet.

The pure block planner now has four CPU checks for one/four blocks, global
alignment, clipping and coverage. Working textures now share exact lattice
sets and retain three levels in the focused page check. A nonflat 256×256
window returns to the same RGBA hash after level switches and rendering a
different window; input and final-field textures retain identity. Final
accounting is 282.7 MiB of 512, with zero console errors. The small ownership
check protects active sets and destroys each cached resource once.

Still unfinished: connecting block composition, refinement timing/focus,
the generic pipeline measurement/set, memory adjustment and remaining
preset-color handling. The owner deferred the Safari probe after its
protected-setting authentication prompt. Remote automation remains off;
developer-feature visibility was restored to off and Settings was closed.
No Safari runtime memory facts are claimed.
The 200/400 ms, 10% final-cost and pixel gates remain unchanged. Broader
correctness runs stay deferred at the owner's request.
