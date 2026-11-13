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

Still unfinished: preview block planning, retained level working sets,
composition, refinement timing/focus, the generic pipeline measurement and
set, memory adjustment, and remaining preset-color handling. Safari remote
automation is disabled; a temporary API-probe permission is pending. Budget
and browser-dependent changes have not been built from unverified facts.
The 200/400 ms, 10% final-cost and pixel gates remain unchanged. Broader
correctness runs stay deferred at the owner's request.
