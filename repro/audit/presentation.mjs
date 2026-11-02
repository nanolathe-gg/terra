import fs from 'node:fs';
import {controlLabel,WORLD_GROUP_NAMES,WORLD_PRIMARY_CONTROLS} from '../../sculpt-control-schema.js';
const i=JSON.parse(fs.readFileSync(process.argv[2]||'/private/tmp/terraform-tool-audit/inventory.json'));
const rows=[...i.shapes.map(f=>({key:f[0],label:controlLabel(f[0],f[2])})),...i.knobs.flatMap(([g,l])=>l.map(f=>({key:f[0],label:controlLabel(f[0],f[1]),group:WORLD_GROUP_NAMES[g]||g,primary:WORLD_PRIMARY_CONTROLS.has(f[0])})))];
fs.writeFileSync(process.argv[3]||'/private/tmp/terraform-tool-audit/presentation.json',JSON.stringify(rows,null,2));
