// The rock column's table as the shaders read it (H16). A world's `column` block (materials/<world>.json) has `sections`, from low to high,
// each a start coordinate and beds [thickness, hardness 0..1, material slot] that repeat upward from coordinate 0 (a world with none has no
// column), and `bands`, the contour bands' [height between two risers, darkness of the line along each]. A variant is a row of the block
// (its id under `variants`), which replaces either.
export const COLUMN_BEDS = 32, COLUMN_SECTIONS = 8;
export const DEFAULT_BANDS = [3.7, 0.5];

// The sections of a row as the uniforms hold them: beds [thickness, hardness, slot, 0] and starts [start, first bed, count, period].
export function columnRows(column, variant) {
  const row = column?.variants?.[variant] || {};
  const sections = row.sections || column?.sections || [], bands = row.bands || column?.bands || DEFAULT_BANDS;
  const beds = [], starts = [];
  for (const s of sections) {
    starts.push([s.start, beds.length, s.beds.length, s.beds.reduce((sum, b) => sum + b[0], 0)]);
    for (const b of s.beds) beds.push([b[0], Math.min(1, Math.max(0, b[1])), b[2], 0]);
  }
  if (beds.length > COLUMN_BEDS || starts.length > COLUMN_SECTIONS) throw new Error('nanolathe: a rock column is too large for its uniforms');
  return {beds, starts, bands};
}
