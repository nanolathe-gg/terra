// P6: gates. The draw and the bake test many uniforms against a constant (`u.layered != 0`, `u.rillDepth <= 0.0`, `u.columnTerrain.x != 0.0`). A
// world fixes most of them, so each test becomes a WGSL `override` bool and the pipeline is built with the values it has now, cached by the
// string of those bools. Every other read of a uniform stays a uniform read: the continuous values do not make a new pipeline.
// The uniforms the chunk renderer sets for each chunk, or the GPU writes (the six painted flags), are never gates.
export const PER_CHUNK_UNIFORMS = new Set(['looseGrid', 'paintOn', 'scatterOn', 'styleOn', 'waterOn', 'lumpOn', 'overrideOn']);
const isPerChunk = name => PER_CHUNK_UNIFORMS.has(name) || name.startsWith('chunk');

const COMPARE = {'>': (a, b) => a > b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '==': (a, b) => a === b, '!=': (a, b) => a !== b};
const SUFFIX = {'>': 'gt', '<': 'lt', '>=': 'ge', '<=': 'le', '==': 'eq', '!=': 'ne'};
// `u.name` or `u.name.x`, a comparison operator, a number, and then the end of the condition (so `u.a > 0.0 * b` is left alone).
const GATE = /\bu\.(\w+)((?:\.[xyzw])?)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d*)?)(?=\s*(?:\)|&&|\|\||\?|;|,|\{))/g;

// Rewrites each gate in `source` to an override bool. `fields` is the renderer's uniform layout (name -> {offset, kind, count, width}).
// Returns the new source (the declarations are appended, so a compiler message's line number stays valid) and the gates by id.
export function extractGates(source, fields) {
  const gates = new Map();
  const text = source.replace(GATE, (match, name, swizzle, op, literal) => {
    const field = fields.get(name);
    if (!field || field.count !== 1 || isPerChunk(name)) return match;
    const component = swizzle ? 'xyzw'.indexOf(swizzle[1]) : 0;
    if (component >= field.width) return match;
    const constant = field.kind === 'i' ? Number.parseInt(literal, 10) : Math.fround(Number(literal));
    if (field.kind === 'i' && literal.includes('.')) return match;
    const id = `gate_${name}${swizzle ? swizzle[1] : ''}_${SUFFIX[op]}_${literal.replace('-', 'm').replace('.', 'p')}`;
    if (!gates.has(id)) gates.set(id, {id, name, offset: field.offset + component * 4, kind: field.kind, op, constant});
    return id;
  });
  return {source: text + '\n' + [...gates.keys()].map(id => `override ${id}: bool;`).join('\n') + '\n', gates};
}

// The gates' values for the uniform data now: the constants a pipeline is built with.
export function gateValues(gates, view) {
  const out = {};
  for (const g of gates.values()) {
    const value = g.kind === 'i' ? view.getInt32(g.offset, true) : view.getFloat32(g.offset, true);
    out[g.id] = COMPARE[g.op](value, g.constant);
  }
  return out;
}
export const gateKey = (values, order) => { let key = ''; for (const id of order) key += values[id] ? '1' : '0'; return key; };
