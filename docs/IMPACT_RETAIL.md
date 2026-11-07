# Retail craters: what stands outside the rim

Card lfimpact (November 6): the numbers behind Ejecta's buckling (`lfImpactBuckle` in
`engine-shape.wgsl`). Measured with `measure/crater_rings.py` on the 16-px heights of the
twelve retail Moon maps; only these numbers are kept, no retail pixels or heights.

How: each round, rimmed bowl is found in the heights, and retail maps reuse crater art, so a
crater with the same rim diameter, rim and depth counts once (copies in brackets). R is the
rim crest's radius. The residual is the ground with the radial median profile removed: what
the outer flank carries besides its smooth fall. Blocks are connected cells 3 or more units
over that median, 1.05 to 2.2 R out. A secondary crest is a sector's local maximum past
1.15 R, 2 or more units over the troughs each side. The plain's own residual (3 to 4 R) is
the noise floor. The art's apron is the luma contrast of 8-px blocks over the plain's.

| Rim diameter (px) | Craters (copies) | Rim over the plain, depth under it (units) | Flank down by (R) | Residual s.d., units: 1-1.25 / 1.25-1.5 / 1.5-2 / 2-2.5 R (floor) | Blocks: count, centre (R), width (deg), height (units, and of the depth) | Secondary crests, share of the ring: 1.15-1.5 / 1.5-2 R | Art apron: contrast over the plain, 1-1.25 / 1.25-1.5 / 1.5-1.75 R |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 712 | 1 (6) | 50, 43 | 1.36 | 17.5 / 7.6 / 1.0 / 0.1 (3.4) | 6, 1.20, 37, 23 (.54) | .18 / .01 | 1.24 / 1.15 / 1.01 |
| 696 | 1 (2) | 28, 43 | 1.22 | 10.1 / 4.2 / 1.5 / 0.4 (1.5) | 7, 1.41, 22, 8 (.19) | .11 / .10 | 1.41 / 1.29 / 1.01 |
| 172-248 | 10 (48) | 3-26, 7-38 | 1.16-1.79 (median 1.56) | median 5.8 / 4.9 / 3.0 / 1.1 (1.0) | median 4.5, 1.41, 20, 9 (.46) | median .15 / .06 | 1.0-2.0 / 1.0-1.4 / 0.95-1.2 |
| 120-160 | 16 (56) | 2-26, 6-37 | 1.30-1.88 (median 1.61) | median 4.6 / 3.4 / 2.8 / 2.3 (1.9) | median 2, 1.53, 33, 10 (.87) | median .10 / .01 | 0.9-1.7 / 0.9-1.4 / 1.0-1.1 |

Medium and small rows leave out craters whose plain ring holds other features (residual over
3 units at 3 to 4 R).

What it says:

- **Big craters buckle in blocks, not clean rings.** The outer flank of the two big designs is
  broken into 6 or 7 raised blocks, each 22 to 37 degrees of the ring, centred 1.2 to 1.4 rim
  radii out and standing .19 to .54 of the depth over the smooth flank. A second crest runs
  round only 11 to 18% of the ring. The residual falls to a third by 1.25-1.5 R and to the
  floor by 1.5-2 R: nothing in the heights past 2 rim radii. The art's wrinkled apron reaches
  1.5 R (its contrast back to the plain's by 1.5-1.75 R).
- **Smaller craters carry the same lumps at their own scale.** Relative to the depth the
  residual by the rim is alike (about .25 to .4), so in units and pixels it grows with the
  crater: 10 to 17 units by a 700-px rim, about 6 by a 200-px one, about 4.6 by a 140-px one,
  whose lumps beyond 1.5 R sit at the noise floor.
- **Red and Crystal.** Red's three craters of 250 to 290 px have rims of 3 to 6 units, and
  their residual by the rim (6.5 to 9.7 units) is within about 1.4 times the plain ring's own
  where that ring is clean (4.7 to 8.7): no ring stands out. Crystal's craters sit in crystal ridges
  whose residual (25 to 50 units at 3 to 4 R) swamps anything at the rim. Neither shows a
  ring to build to.

As built: rings of raised blocks 0.3 R apart from just outside the rim, wandering along the
ring and broken into sections, highest by the rim and gone by 1.72 R, at 3 times Ejecta's own
height, following the impact's spread, and scaled by the rim radius from none under 48 px to
all of it from 280 px. On a flat Moon fixture with Diameter 900 (a 560-px rim) it gives 6
blocks at 1.39 R, 25 degrees wide, .39 of the depth.

## Where small craters fall round a big one (card lfimpact2)

Measured with `measure/crater_secondaries.py` on the same heights: the big craters are the
ones above (rim diameter 150 px or more, 73 of them on the twelve maps), the small ones are
bowls (a cell lower than its neighbours and 6 or more units under the cells 2 to 3 cells
away) outside every rim. Each small crater counts once, round the big crater it is nearest
to in rim radii, and the density of each annulus is set against the density 3 to 5 R out.

| Distance from the centre (R) | 1.0-1.5 | 1.5-2.0 | 2.0-2.5 | 2.5-3.0 | 3.0-4.0 | 4.0-5.0 |
| --- | --- | --- | --- | --- | --- | --- |
| Small craters (6+ units deep) | 73 | 62 | 13 | 24 | 68 | 72 |
| Density, x the density 3-5 R out | 4.14 | 2.52 | 0.43 | 0.68 | 0.93 | 1.07 |
| Same, small craters 4+ units deep | 2.12 | 1.45 | 0.65 | 0.87 | 0.93 | 1.07 |

Small craters gather 1 to 2 rim radii out (within 2 R: median 1.46 R, p25 1.21, p75 1.64);
2 to 3 R holds fewer than the plain beyond. The repro windows agree: moon-1's three small
craters beside its 1152 px crater sit 1.11, 1.22 and 1.44 R out.

As built: the Secondaries' distance row sets where the band starts; the secondaries fall from
there to twice as far (median 1.62 times it) and a third of them start a chain farther out.
Its default is 1 (median 1.62 R; 1.6 before the row, median 2.59 R, in the band retail leaves
nearly empty).
