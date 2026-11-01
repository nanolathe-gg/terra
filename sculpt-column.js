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

// A map edits the world's existing table, never its shape or uniform capacity. Validate before touching the open map.
export function copyColumn(value, template) {
  if (value == null) return null;
  const fail = () => { throw new Error('Invalid rock column: keep the existing rows, finite values, positive thicknesses and ordered starts.'); };
  function shape(v, t) {
    if (typeof t === 'number') { if (typeof v !== 'number' || !Number.isFinite(Math.fround(v))) fail(); }
    else if (typeof t === 'string') { if (!['plain', 'sea'].includes(v)) fail(); }
    else if (Array.isArray(t)) { if (!Array.isArray(v) || v.length !== t.length) fail(); return t.map((x, i) => shape(v[i], x)); }
    else { if (!t || !v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== Object.keys(t).length) fail(); return Object.fromEntries(Object.keys(t).map(k=>{if(!Object.hasOwn(v,k))fail();return [k,shape(v[k],t[k])];})); }
    return v;
  }
  value=shape(value, template);
  const slots = value.colors?.length || 5;
  for (const row of [value, ...Object.values(value.variants || {})]) {
    if (row.bands && (!(Math.fround(row.bands[0]) > 0) || row.bands[1] < 0 || row.bands[1] > 1)) fail();
    for (const [i, s] of (row.sections || []).entries()) {
      if (i && Math.fround(s.start) <= Math.fround(row.sections[i - 1].start)) fail();
      for (const [thickness, hardness, slot] of s.beds) if (!(Math.fround(thickness) > 0) || hardness < 0 || hardness > 1 || !Number.isInteger(slot) || slot < 0 || slot >= slots) fail();
    }
    const rows=columnRows(value, Object.entries(value.variants || {}).find(([, v]) => v === row)?.[0]);
    if(rows.starts.some(s=>!Number.isFinite(Math.fround(s[3])) || !(Math.fround(s[3])>0)))fail();
  }
  if (value.colors?.some(c => c.some(v => v < 0 || v > 255))) fail();
  return value;
}
