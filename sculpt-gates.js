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
// A rock recipe's number (`u.rock[rs].name`, struct Rock in engine-common.wgsl) tested the same way is a gate on the slots in use (gateValues'
// `slots`): where they all answer alike the test is that constant, as any other gate's; where they differ (its `_mixed` gate is on) it is the
// pixel's own test, read from its slot.
const ROCK_GATE = /\bu\.rock\[rs & rockMask\]\.(\w+)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d*)?)(?=\s*(?:\)|&&|\|\||\?|;|,|\{))/g;

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
  }).replace(ROCK_GATE, (match, name, op, literal) => {
    const table = fields.get('rock'), member = table?.members.get(name);
    if (!member || member.width !== 1 || (member.kind === 'i' && literal.includes('.'))) return match;
    const constant = member.kind === 'i' ? Number.parseInt(literal, 10) : Math.fround(Number(literal));
    const id = `gate_rock_${name}_${SUFFIX[op]}_${literal.replace('-', 'm').replace('.', 'p')}`;
    if (!gates.has(id)) {
      gates.set(id, {id, name, offset: table.offset + member.offset, kind: member.kind, op, constant, stride: table.stride});
      gates.set(id + '_mixed', {id: id + '_mixed', mixed: id});
    }
    return `(${id} || (${id}_mixed && ${match}))`;
  });
  const out = text + '\n' + [...gates.keys()].map(id => `override ${id}: bool;`).join('\n') + '\n';
  if (/\brockMask\b/.test(text)) gates.set('rockMask', {id: 'rockMask', mask: true});
  return {source: out, gates};
}

// The gates' values for the uniform data now: the constants a pipeline is built with. They are 1 and 0, not true and false: a pipeline's
// `constants` are numbers (GPUPipelineConstantValue is a double); Chrome converts a boolean, Dawn's Node binding refuses one.
// `slots`: the rock slots in use (the renderer's rockSlots), which a rock gate tests.
export function gateValues(gates, view, slots = [0]) {
  const out = {};
  for (const g of gates.values()) {
    if (g.mixed) continue;
    if (g.mask) { out[g.id] = slots.some(k => k !== 0) ? 15 : 0; continue; }
    const test = offset => COMPARE[g.op](g.kind === 'i' ? view.getInt32(offset, true) : view.getFloat32(offset, true), g.constant);
    if (!g.stride) { out[g.id] = test(g.offset) ? 1 : 0; continue; }
    const answers = slots.map(k => test(g.offset + k * g.stride));
    out[g.id] = answers.every(Boolean) ? 1 : 0;
    out[g.id + '_mixed'] = answers.some(Boolean) && !answers.every(Boolean) ? 1 : 0;
  }
  return out;
}
export const gateKey = (values, order) => { let key = ''; for (const id of order) key += values[id] ? '1' : '0'; return key; };
