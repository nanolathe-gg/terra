// Extract the actual editor registries; no hand-maintained shadow list.
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(process.argv[2]||'sculpt.js','utf8');
const get=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
const context={};vm.createContext(context);
vm.runInContext(get('const SECTION_KINDS=','const E7_KEYS=')+'\nthis.shapes=SHAPE_FIELDS;',context);
vm.runInContext(get('const KNOBS =','// Worlds.')+'\nthis.knobs=KNOBS;',context);
vm.runInContext(get('const TOOL_PRESETS=','// Shape options:')+'\nthis.tools=TOOL_FIELDS;this.presets=TOOL_PRESETS;',context);
fs.writeFileSync(process.argv[3]||'/private/tmp/terraform-tool-audit/inventory.json',JSON.stringify({shapes:context.shapes,knobs:context.knobs,tools:context.tools,presets:context.presets},null,2));
console.log(JSON.stringify({shapeControls:context.shapes.length,worldControls:context.knobs.flatMap(x=>x[1]).length,worldGroups:context.knobs.length}));
