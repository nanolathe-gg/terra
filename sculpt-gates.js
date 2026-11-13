// P6: gates. The draw and the bake test many uniforms against a constant (`u.layered != 0`, `u.rillDepth <= 0.0`, `u.columnTerrain.x != 0.0`). A
// world fixes most of them, so each test becomes a WGSL `override` bool and the pipeline is built with the values it has now, cached by the
// string of those bools. Every other read of a uniform stays a uniform read: the continuous values do not make a new pipeline.
// The uniforms the chunk renderer sets for each chunk, or the GPU writes (the seven painted flags), are never gates.
export const PER_CHUNK_UNIFORMS = new Set(['grid', 'looseGrid', 'paintOn', 'scatterOn', 'styleOn', 'waterOn', 'lumpOn', 'overrideOn', 'rockIdOn']);
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

// The earliest shader stage that can read each uniform. Walk the actual
// preprocessed WGSL call graph; a static read stays a dependency behind a gate.
// Modules supply their entry stage, with explicit roots for fragment geometry.
export function uniformStages(modules) {
  const result=new Map(),order='ABCDEF';
  const uncomment=source=>{
    let out='',depth=0,line=false;
    for(let i=0;i<source.length;i++){
      const a=source[i],b=source[i+1];
      if(line){if(a==='\n'){line=false;out+='\n';}continue;}
      if(depth){if(a==='/'&&b==='*'){depth++;i++;}else if(a==='*'&&b==='/'){depth--;i++;}else if(a==='\n')out+='\n';continue;}
      if(a==='/'&&b==='*'){depth=1;out+=' ';i++;}else if(a==='/'&&b==='/'){line=true;out+=' ';i++;}else out+=a;
    }
    if(depth)throw Error('Unclosed WGSL comment in stage scan');
    return out;
  };
  for(const {source,stage,roots} of modules){
    if(!order.includes(stage)||stage.length!==1)throw Error('Unknown shader stage '+stage);
    const text=uncomment(source),functions=new Map(),pattern=/\bfn\s+(\w+)\s*\(/g;
    let previous=0,match;
    while((match=pattern.exec(text))){
      const name=match[1],start=text.indexOf('{',pattern.lastIndex);
      if(start<0)throw Error('Missing WGSL function body: '+name);
      let end=start+1,depth=1;
      for(;end<text.length&&depth;end++){if(text[end]==='{')depth++;else if(text[end]==='}')depth--;}
      if(depth||functions.has(name))throw Error('Invalid WGSL function in stage scan: '+name);
      const header=text.slice(previous,match.index),body=text.slice(start+1,end-1);
      const fields=new Set(),references=/\bu\s*\.\s*(\w+)/g;let reference;
      while((reference=references.exec(body))){
        let field=reference[1];
        if(field==='rock'){
          let at=references.lastIndex;while(/\s/.test(body[at]??'')&&at<body.length)at++;
          if(body[at]==='['){let depth=1;at++;while(at<body.length&&depth){if(body[at]==='[')depth++;else if(body[at]===']')depth--;at++;}
            const member=/^\s*\.\s*(\w+)/.exec(body.slice(at));if(member)field=member[1];}
        }
        fields.add(field);
      }
      const calls=new Set([...body.matchAll(/\b(\w+)\s*\(/g)].map(m=>m[1]));
      functions.set(name,{fields,calls,entry:/@(compute|fragment)\b/.test(header)});
      previous=end;pattern.lastIndex=end;
    }
    const entryPoints=roots??[...functions].filter(([,fn])=>fn.entry).map(([name])=>name);
    for(const root of entryPoints){
      if(!functions.has(root))throw Error('Missing stage root '+root);
      const seen=new Set(),visit=name=>{
        if(seen.has(name)||!functions.has(name))return;seen.add(name);
        const fn=functions.get(name);
        for(const field of fn.fields){
          const prior=result.get(field)??{stage,entries:[]};
          if(order.indexOf(stage)<order.indexOf(prior.stage))prior.stage=stage;
          if(!prior.entries.includes(root))prior.entries.push(root);
          result.set(field,prior);
        }
        for(const callee of fn.calls)visit(callee);
      };
      visit(root);
    }
  }
  return result;
}

// Compare only CPU-owned world fields. GPU-written flags and per-chunk
// coordinates are absent, including the aliases of slot 0 in the Rock table.
export function worldUniformDelta(before,after,layout,stages) {
  const previous=before??new Uint32Array(after.byteLength/4),next=new Uint32Array(after),table=layout.fields.get('rock'),fields=[],slots=new Set();let stage=null;
  const perChunk=new Set([...PER_CHUNK_UNIFORMS,'weatherMaps','materialReady','transitionBody','rockWeatherGrid']);
  const differs=(f,offset=f.offset)=>{
    for(let i=0;i<f.count;i++)for(let j=0;j<f.width;j++){const k=(offset+i*f.stride)/4+j;if(previous[k]!==next[k])return true;}return false;
  };
  const add=(name,key,slot)=>{const s=(stages.get(key)??(slot!==undefined?stages.get('rock'):null))?.stage??null;fields.push({name,stage:s});if(slot!==undefined)slots.add(slot);if(s&&(!stage||s<stage))stage=s;};
  for(const [name,f]of layout.fields){
    if(name==='rock'){
      for(let slot=0;slot<f.count;slot++)for(const [member,m]of f.members)if(differs(m,f.offset+slot*f.stride+m.offset))add(`rock[${slot}].${member}`,member,slot);
    }else if(!(table&&f.offset>=table.offset&&f.offset<table.offset+table.count*table.stride)&&!perChunk.has(name)&&!name.startsWith('chunk')&&differs(f))add(name,name);
  }
  return {fields,stage,rockSlots:[...slots]};
}
