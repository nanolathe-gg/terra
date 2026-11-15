// The rock column's table as the shaders read it (H16). A world's `column` block (materials/<world>.json) has `sections`, from low to high,
// each a start coordinate and beds [thickness, hardness 0..1, material slot] that repeat upward from coordinate 0 (a world with none has no
// column), and `bands`, the contour bands' [height between two risers, darkness of the line along each]. A map may carry its own column (the Rock column panel): on any world, with any number of
// sections and beds up to the uniforms' capacity.
export const COLUMN_BEDS = 32, COLUMN_SECTIONS = 8, COLUMN_SLOTS = 5;
export const DEFAULT_BANDS = [3.7, 0.5];
// The column the Rock column panel adds to a world without one: one section from coordinate 0 of a hard bed and a soft one in two slots,
// so Strata draws two colors and Ledges a step the moment it is on.
export const FIRST_SECTION = {start: 0, beds: [[5, 0.8, 0], [7, 0.3, 1]]};

// The sections as the uniforms hold them: beds [thickness, hardness, slot, 0] and starts [start, first bed, count, period].
export function columnRows(column) {
  const sections = column?.sections || [], bands = column?.bands || DEFAULT_BANDS;
  const beds = [], starts = [];
  for (const s of sections) {
    starts.push([s.start, beds.length, s.beds.length, s.beds.reduce((sum, b) => sum + b[0], 0)]);
    for (const b of s.beds) beds.push([b[0], Math.min(1, Math.max(0, b[1])), b[2], 0]);
  }
  if (beds.length > COLUMN_BEDS || starts.length > COLUMN_SECTIONS) throw new Error('nanolathe: a rock column is too large for its uniforms');
  return {beds, starts, bands};
}

// Whether any section is a cap bed: two beds, one filling over .88 of the cycle (the shader's widest share, engine-common.wgsl columnBedIn, which
// reads it only for a two-bed section). Only there does Cap color hold level ground to one bed's colour.
export function columnHasCapBed(column) {
  const {beds, starts} = columnRows(column);
  return starts.some(([, first, count, period]) => count === 2 && Math.max(beds[first + 1][0] / period, 1 - beds[first + 1][0] / period) > 0.88);
}

// A map's column, checked before it touches the open map: the types, ranges and counts the uniforms hold, never the world's own shape, so a
// map may add a column, sections and beds to any world. The copy has one key order, and sameColumn compares tables whatever their order.
const COLUMN_KEYS = ['colors', 'origin', 'bands', 'wander', 'sections'];
export function copyColumn(value) {
  if (value == null) return null;
  const fail = () => { throw new Error(`Invalid rock column: keep finite values, positive thicknesses, hardness from 0 to 1, ordered starts, and at most ${COLUMN_SECTIONS} sections and ${COLUMN_BEDS} beds.`); };
  const object = (v, keys) => { if (!v || typeof v !== 'object' || Array.isArray(v) || (keys && Object.keys(v).some(k => !keys.includes(k)))) fail(); return v; };
  const number = v => { if (typeof v !== 'number' || !Number.isFinite(Math.fround(v))) fail(); return v; };
  const list = (v, length) => { if (!Array.isArray(v) || (length !== undefined && v.length !== length)) fail(); return v; };
  if (value && typeof value === 'object' && 'variants' in value) { value = {...value}; delete value.variants; }   // a map saved with the removed variant rows opens without them
  object(value, COLUMN_KEYS);
  const slots = Array.isArray(value.colors) ? value.colors.length : COLUMN_SLOTS;
  // Its bands and sections.
  function row(v) {
    const out = {};
    if ('bands' in v) { const [height, line] = list(v.bands, 2).map(number); if (!(Math.fround(height) > 0) || line < 0 || line > 1) fail(); out.bands = [height, line]; }
    if ('sections' in v) {
      out.sections = list(v.sections).map((s, i) => {
        object(s, ['start', 'beds']); number(s.start);
        if (i && !(Math.fround(s.start) > Math.fround(v.sections[i - 1].start))) fail();
        const beds = list(s.beds).map(b => list(b, 3).map(number));
        if (!beds.length) fail();
        for (const [thickness, hardness, slot] of beds) if (!(Math.fround(thickness) > 0) || hardness < 0 || hardness > 1 || !Number.isInteger(slot) || slot < 0 || slot >= slots) fail();
        if (!Number.isFinite(Math.fround(beds.reduce((sum, b) => sum + b[0], 0)))) fail();   // the cycle's period
        return {start: s.start, beds};
      });
      if (out.sections.length > COLUMN_SECTIONS || out.sections.reduce((n, s) => n + s.beds.length, 0) > COLUMN_BEDS) fail();
    }
    return out;
  }
  const own = row(value), out = {};
  for (const key of COLUMN_KEYS) {
    if (!(key in value)) continue;
    if (key === 'colors') { out.colors = list(value.colors, COLUMN_SLOTS).map(c => list(c, 3).map(number)); if (out.colors.some(c => c.some(v => v < 0 || v > 255))) fail(); }
    else if (key === 'origin') { if (!['plain', 'sea'].includes(value.origin)) fail(); out.origin = value.origin; }
    else if (key === 'wander') {
      const w = object(value.wander, ['value', 'terrain']); out.wander = {};
      if ('value' in w) out.wander.value = number(w.value);
      if ('terrain' in w) out.wander.terrain = list(w.terrain, 3).map(number);
    }
    else out[key] = own[key];
  }
  return out;
}

// Whether two columns are the same table, whatever the order of their keys (a map's copy against the world's own; no column is null).
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
export const sameColumn = (a, b) => JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));

// Worlds without an authored layer palette start from their own rock, not
// another biome's colors. The existing slot editors remain the authority.
export function columnColors(column,rock=[.5,.5,.5]) {
 return column?.colors || [.82,1.15,.65,1.32,.95].map(gain=>rock.map(v=>Math.round(Math.min(255,Math.max(0,v*255*gain)))));
}
