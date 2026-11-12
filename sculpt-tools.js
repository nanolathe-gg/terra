// The toolbar's shape tools. A world defines its own (config.tools, its table's world.tools), in order: each {id, label, icon, color, group, shape,
// rock?} draws its shape (sculpt-scene.js LANDFORM_SHAPES) as the world makes it (toolDefaults, config.worldShapes). sculpt.html holds the fixed
// buttons (Select, the generic Landform, Fissure and the paint tools) and the icon set (Save as tool's icon choices); the page builds only the shape buttons, from this list, into
// #shape-tools and #water-tools. A stroke names the tool it was drawn with (node.tool), and shows as the generic landform when the toolbar lacks
// it (another world's tool). No DOM here: the page and the tests share it.
import {LANDFORM_DEFAULTS,LANDFORM_SHAPES,SHAPE_FIELDS,shapeFrom} from './sculpt-scene.js';
import {landformTool} from './sculpt-shape-presets.js';
import {rockByKey} from './sculpt-rock-presets.js';

// The icon set: Save as tool's icon choices in sculpt.html (#tool-save-icons, one button with its svg each), which the shape buttons copy: a tool picks one by name.
export const TOOL_ICONS=['landform','plateau','hill','mountain','ramp','valleyV','valleyU','valleyT','crater','crystal','deep','shallow','river','braided','cone','pillars','island'];
// The palette groups a shape tool joins (sculpt.html's Shape and Water groups).
export const TOOL_GROUPS=['shape','water'];
// The generic landform tool: every toolbar has it (sculpt.html's fixed Landform button), and it reaches every landform feature, so a world without
// a matching shape still draws anything another world's tool drew.
export const LANDFORM_TOOL={id:'landform',label:'Landform',icon:'landform',color:'#d6c8a6',group:'shape',shape:'landform'};
// The palette's other fixed buttons: each id is the stroke kind it draws (move is Select).
export const FIXED_TOOLS=['move','fissure','smooth','erase','paint','sand','grass'];
export const toolShape=t => t?.shape??t?.id;
const ID=/^[A-Za-z][A-Za-z0-9_-]{0,39}$/,COLOR=/^#[0-9a-f]{6}$/i,LABEL_MAX=40,HELP_MAX=300;
const label=v => typeof v==='string' && v.trim() && v.trim().length<=LABEL_MAX;
// A tool's presentation and shape, checked (`what` starts the error): an id no fixed button has, a label, an icon of the set, a color, a group,
// and a shape of the library (`base`: the library shape a world's own shape draws, sculpt-scene.js shapeFrom).
function checkTool(t,what,base=s => s) {
  if (!t || typeof t!=='object' || Array.isArray(t)) throw Error(`${what} is not a tool.`);
  if (typeof t.id!=='string' || !ID.test(t.id) || FIXED_TOOLS.includes(t.id) || t.id===LANDFORM_TOOL.id) throw Error(`${what} needs an id of its own (letters, digits, - and _).`);
  if (!label(t.label)) throw Error(`${what} needs a name of 1 to ${LABEL_MAX} characters.`);
  if (!TOOL_ICONS.includes(t.icon)) throw Error(`${what}: no icon ${JSON.stringify(t.icon)} (the set: ${TOOL_ICONS.join(', ')}).`);
  if (typeof t.color!=='string' || !COLOR.test(t.color)) throw Error(`${what} needs a color #rrggbb.`);
  if (!TOOL_GROUPS.includes(t.group)) throw Error(`${what} needs a group: ${TOOL_GROUPS.join(' or ')}.`);
  if (!Object.hasOwn(LANDFORM_SHAPES,base(toolShape(t)))) throw Error(`${what}: no shape ${JSON.stringify(toolShape(t))}.`);
  if (t.rock!==undefined && (typeof t.rock!=='string' || !t.rock)) throw Error(`${what}: its rock is a preset's key.`);
}
// A world's toolbar (config.tools), checked: its shape tools in order, each id once, each on a shape of the library or one of the world's own shapes
// (`from`), with an optional help line of its own (the footer and the hover say it in place of its shape's).
export function worldTools(config) {
  const tools=config?.tools??[],seen=new Set();
  if (!Array.isArray(tools)) throw Error('A world\'s tools are a list.');
  return tools.map((t,i) => {
    checkTool(t,`The world's tool ${i+1}`,shape => shapeFrom(config,shape));
    if (t.help!==undefined && (typeof t.help!=='string' || !t.help.trim() || t.help.length>HELP_MAX)) throw Error(`The world's tool ${t.id}: its help is a line of at most ${HELP_MAX} characters.`);
    if (/^map-\d/.test(t.id)) throw Error(`The world's tool ${t.id}: map-1, map-2, ... are a map's own tools' ids.`);
    if (seen.has(t.id)) throw Error(`The world's tool ${t.id} is listed twice.`);
    seen.add(t.id); return {...t,label:t.label.trim()};
  });
}
// A tool may name its rock by a preset's key (sculpt-rock-presets.js rockByKey): the slot of the map's preset with that key when the tool's card is made,
// 0 where it is the world's own rock's (`worldKey`, config.rock.recipe), Rock beneath (-1) in a map without it, and undefined for a tool that names none.
export const toolRockSlot=(tool,rocks=[],worldKey='') => tool?.rock===undefined?undefined:rockByKey(rocks,tool.rock,worldKey);
// The tool a stroke shows and carries as: its own, if the toolbar (`ids`) has it, else the generic landform. A stroke of another kind is its kind.
export const strokeTool=(n,ids) => n?.kind!=='landform'?n?.kind:ids.has(n.tool)?n.tool:LANDFORM_TOOL.id;
// A stroke that falls back to the generic landform keeps its shape for good: only its tool is lost. It is marked `kept` (every setting counts as set by
// hand, so no later world switch gives it that world's defaults); a stroke drawn with the Landform button is not, and its unedited settings follow the world.
const fallBack=n => ({...n,tool:LANDFORM_TOOL.id,kept:true});
// Strokes whose tool the toolbar lacks fall back to the generic landform at load, their numbers as they are (a stroke from another world, or of a map tool
// deleted before the map was saved).
export const keepStrokeTools=(nodes,ids) => nodes.map(n => n?.kind==='landform' && !ids.has(n.tool)?fallBack(n):n);
// A working copy's marks (sculpt.js workingCopy): per stroke the settings that differ from its tool's defaults in its world (`defaultsOf`), which are
// the ones the artist set by hand.
export const markEdited=(nodes,defaultsOf) => nodes.map(n => { const base=n.kind==='ground'?null:defaultsOf(n); return base?{...n,edited:Object.keys(n.params).filter(k => k!=='seed' && JSON.stringify(n.params[k])!==JSON.stringify(base[k]))}:n; });
// A working copy's strokes carried into another world (sculpt.js carryNodes; the ground node is the page's): where the toolbar (`ids`) has a stroke's tool,
// each setting the artist changed by hand (`edited`, the working copy's marks) stays and every other takes `defaultsOf(stroke)`, the new world's for that
// tool. A stroke whose tool it lacks falls back to the generic landform, and one that fell back before stays so: every number as it was, for good.
export function carryStrokes(list,ids,defaultsOf) {
  return list.filter(n => n.kind!=='ground').map(n => {
    const {edited,...rest}=n;
    if (n.kind==='landform' && (n.kept || !ids.has(n.tool))) return fallBack(rest);
    const base=n.params && Array.isArray(edited)?defaultsOf(n):null;
    if (!base) return rest;
    const keep=new Set(edited),params={};
    for (const k of new Set([...Object.keys(base),...Object.keys(n.params)])) params[k]=keep.has(k) || !(k in base)?n.params[k]:base[k];
    return {...rest,params};
  });
}
// A landform stroke saved before strokes named their tool takes, once, the tool its section form belongs to (landformTool) if the toolbar has it,
// else the generic landform. Nothing else infers a tool.
export const inferStrokeTools=(nodes,ids) => nodes.map(n => n?.kind==='landform' && typeof n.tool!=='string'?(ids.has(landformTool(n.params))?{...n,tool:landformTool(n.params)}:fallBack(n)):n);

// ---- A map's own tools (Save as tool) ----
// {id, label, icon, color, group, shape, card}: made from a selected shape, they join the toolbar after the world's tools in their group and live in
// the map (its save, undo, share links, a scene's `tools`). The card is the numbers, curves and rock slot the tool draws with, in card units as
// toolDefaults gives them, so a map's tool draws the same in any world; `shape` is the shape it was saved from (its hover picture, its Tool preset).
export const MAP_TOOLS_MAX=24;
const MAP_ID=/^map-[1-9][0-9]{0,5}$/,MAP_FIELDS=['id','label','icon','color','group','shape','card'];
// The settings a card may hold: a brush card's (the shape options and the five basics), the model's defaults and the library's shapes.
export const CARD_KEYS=new Set([...SHAPE_FIELDS.map(([key]) => key),...Object.keys(LANDFORM_DEFAULTS),...Object.values(LANDFORM_SHAPES).flatMap(Object.keys),'cracks','diameter','amount','roughness','softness','preset','curve','along']);
const knotList=v => Array.isArray(v) && v.length>=1 && v.length<=128 && v.every(k => Array.isArray(k) && k.length===2 && k.every(Number.isFinite));
// A card checked as a map's tool holds it: the settings a brush card has, finite numbers, and curves of knots.
function checkCard(card,what) {
  if (!card || typeof card!=='object' || Array.isArray(card)) throw Error(`${what} needs its settings.`);
  for (const [key,v] of Object.entries(card)) {
    if (!CARD_KEYS.has(key)) throw Error(`${what}: no setting ${JSON.stringify(key)}.`);
    if (key==='preset') { if (typeof v!=='string') throw Error(`${what}: its preset is a name.`); continue; }
    if (key==='curve') { if (v!=null && (typeof v!=='object' || typeof v.form!=='string' || (v.knots!==undefined && !knotList(v.knots)) || (v.back!==undefined && !knotList(v.back)) || Object.keys(v).some(k => !['form','knots','back'].includes(k)))) throw Error(`${what}: its section curve is not one.`); continue; }
    if (key==='along') { if (v!=null && !knotList(v)) throw Error(`${what}: its length vs. height curve is not one.`); continue; }
    if (typeof v!=='number' || !Number.isFinite(v)) throw Error(`${what}: ${key} is not a number.`);
  }
  return structuredClone(card);
}
// A map's tools checked before they touch the open map (a save, a share link, a scene): ids map-1, map-2, ... each once, the presentation a world's
// tool has, and a card. No list is null (a map without its own tools).
export function copyMapTools(value) {
  if (value==null) return null;
  if (!Array.isArray(value) || value.length>MAP_TOOLS_MAX) throw Error(`A map holds at most ${MAP_TOOLS_MAX} tools of its own.`);
  const seen=new Set();
  return value.map((t,i) => {
    const what=`The map's tool ${i+1}`;
    if (!t || typeof t!=='object' || Object.keys(t).some(k => !MAP_FIELDS.includes(k))) throw Error(`${what} is not a tool.`);
    if (typeof t.id!=='string' || !MAP_ID.test(t.id) || seen.has(t.id)) throw Error(`${what} needs an id of its own, map-1 to map-999999.`);
    checkTool(t,what); seen.add(t.id);
    return {id:t.id,label:t.label.trim(),icon:t.icon,color:t.color.toLowerCase(),group:t.group,shape:t.shape,card:checkCard(t.card,what)};
  });
}
// The next map tool's id: one no tool and no stroke of the map has used, so a stroke of a deleted tool never shows as a later one.
export function nextMapToolId(tools,nodes=[]) {
  const n=[...tools.map(t => t.id),...nodes.map(s => s?.tool)].map(id => MAP_ID.test(id??'')?Number(id.slice(4)):0);
  return `map-${Math.max(0,...n)+1}`;
}
// A tool made from a shape's card (Save as tool): a new list, the tool last; and a list without a tool (Delete). The strokes drawn with a deleted tool keep
// their numbers and their tool's id, which no toolbar has any more, so they show as the generic landform (strokeTool) and show as the tool again when an
// undo brings it back. Saved and loaded, or carried to another world, without it, they fall back to the generic landform for good (keepStrokeTools, carryStrokes).
export function addMapTool(tools,nodes,{label,icon,color,group,shape,card}) {
  if (tools.length>=MAP_TOOLS_MAX) throw Error(`A map holds at most ${MAP_TOOLS_MAX} tools of its own.`);
  const id=nextMapToolId(tools,nodes),[tool]=copyMapTools([{id,label,icon,color,group,shape,card:{...card,preset:'custom'}}]);
  return {id,tools:[...tools,tool]};
}
export function deleteMapTool(tools,id) {
  if (!tools.some(t => t.id===id)) throw Error(`No tool ${id} in this map.`);
  return tools.filter(t => t.id!==id);
}
