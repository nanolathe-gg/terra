// The rock column's table as the shaders read it (H16). A world's `column` block (materials/<world>.json) has two lists of sections, each from
// low to high, a start coordinate and beds [thickness, hardness 0..1, material slot] that repeat upward from coordinate 0: `sections`, the
// geology (a world with none has no geology column) and `bands`, the contour bands' row (a thickness and a line strength per bed; a world
// without one takes the default row). A variant is a row of the block (its id under `variants`), which replaces either list.
export const COLUMN_BEDS = 32, COLUMN_SECTIONS = 8, SECTION_BEDS = 8;
export const DEFAULT_BANDS = [{start: 0, beds: [[3.7, 0.5, 0]]}];

// The sections of a row, as the uniforms hold them: beds [thickness, hardness, slot, 0] and starts [start, first bed, count, 0], the
// geology sections first, then the band row's. `sections` counts the first, `bands` the second.
export function columnRows(column, variant) {
  const row = column?.variants?.[variant] || {};
  const geology = row.sections || column?.sections || [], bands = row.bands || column?.bands || DEFAULT_BANDS;
  const beds = [], starts = [];
  for (const s of [...geology, ...bands]) {
    if (s.beds.length > SECTION_BEDS) throw new Error(`nanolathe: a column section holds at most ${SECTION_BEDS} beds`);
    starts.push([s.start, beds.length, s.beds.length, 0]);
    for (const b of s.beds) beds.push([b[0], Math.min(1, Math.max(0, b[1])), b[2], 0]);
  }
  if (beds.length > COLUMN_BEDS || starts.length > COLUMN_SECTIONS) throw new Error('nanolathe: a rock column is too large for its uniforms');
  return {beds, starts, sections: geology.length, bands: bands.length, bandThickness: bands[0].beds[0][0]};
}

// The bed at coordinate c in a table of rows, as columnAt's choice before any wander or share variation: the last geology section whose
// start c has passed (the first below them all), and in it the bed at c's place in the repeating cycle. Returns {index, slot, hardness}.
export function columnBedAt({beds, starts, sections}, c) {
  let s = 0;
  for (let i = 1; i < sections; i++) if (c >= starts[i][0]) s = i;
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
