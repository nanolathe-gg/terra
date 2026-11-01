// The rock column's table as the shaders read it (H16). A world's `column` block (materials/<world>.json) lists sections from low to
// high, each a start coordinate and beds [thickness, hardness 0..1, material slot] that repeat upward from coordinate 0; a variant is a
// row of the block (its id under `variants`), which replaces the sections. A world with no block has no column.
export const COLUMN_BEDS = 24, COLUMN_SECTIONS = 6, SECTION_BEDS = 8;

// The sections of a row, as the uniforms hold them: beds [thickness, hardness, slot, 0] and starts [start, first bed, count, 0].
export function columnRows(column, variant) {
  const sections = (column?.variants?.[variant]?.sections || column?.sections || []).slice(0, COLUMN_SECTIONS);
  const beds = [], starts = [];
  for (const s of sections) {
    if (s.beds.length > SECTION_BEDS) throw new Error(`nanolathe: a column section holds at most ${SECTION_BEDS} beds`);
    starts.push([s.start, beds.length, s.beds.length, 0]);
    for (const b of s.beds) beds.push([b[0], Math.min(1, Math.max(0, b[1])), b[2], 0]);
  }
  if (beds.length > COLUMN_BEDS) throw new Error(`nanolathe: a rock column holds at most ${COLUMN_BEDS} beds`);
  return {beds, starts};
}

// The bed at coordinate c in a table of rows, as columnAt's choice before any wander or share variation: the last section whose start c
// has passed (the first below them all), and in it the bed at c's place in the repeating cycle. Returns {index, slot, hardness}.
export function columnBedAt({beds, starts}, c) {
  let s = 0;
  for (let i = 1; i < starts.length; i++) if (c >= starts[i][0]) s = i;
  const [, first, count] = starts[s];
  let period = 0;
  for (let i = 0; i < count; i++) period += beds[first + i][0];
  const cycle = Math.floor(c / period), r = c - cycle * period;
  let lo = 0;
  for (let i = 0; i < count; i++) {
    if (r < lo + beds[first + i][0] || i === count - 1) return {index: cycle * count + i, slot: beds[first + i][2], hardness: beds[first + i][1]};
    lo += beds[first + i][0];
  }
}
