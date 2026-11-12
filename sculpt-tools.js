// The toolbar's shape tools. A world defines its own (config.tools, its table's world.tools), in order: each {id, label, icon, color, group, shape,
// rock?} draws its shape (sculpt-scene.js LANDFORM_SHAPES) as the world makes it (toolDefaults, config.worldShapes). sculpt.html holds the fixed
// buttons (Select, the generic Landform, Fissure and the paint tools) and the icon set; the page builds only the shape buttons, from this list, into
// #shape-tools and #water-tools. A stroke names the tool it was drawn with (node.tool), and shows as the generic landform when the toolbar lacks
// it (another world's tool). No DOM here: the page and the tests share it.
import {LANDFORM_SHAPES} from './sculpt-scene.js';
import {landformTool} from './sculpt-shape-presets.js';

// The icons sculpt.html's #tool-icons template holds, one <svg data-icon> each: a tool picks one by name.
export const TOOL_ICONS=['landform','plateau','hill','mountain','ramp','valleyV','valleyU','valleyT','crater','crystal','deep','shallow','river','braided'];
// The palette groups a shape tool joins (sculpt.html's Shape and Water groups).
export const TOOL_GROUPS=['shape','water'];
// The generic landform tool: every toolbar has it (sculpt.html's fixed Landform button), and it reaches every landform feature, so a world without
// a matching shape still draws anything another world's tool drew.
export const LANDFORM_TOOL={id:'landform',label:'Landform',icon:'landform',color:'#d6c8a6',group:'shape',shape:'landform'};
// The palette's other fixed buttons: each id is the stroke kind it draws (move is Select).
export const FIXED_TOOLS=['move','fissure','smooth','erase','paint','sand','grass'];
export const toolShape=t => t?.shape??t?.id;
const ID=/^[A-Za-z][A-Za-z0-9_-]{0,39}$/,COLOR=/^#[0-9a-f]{6}$/i,LABEL_MAX=40;
const label=v => typeof v==='string' && v.trim() && v.trim().length<=LABEL_MAX;
// A tool's presentation and shape, checked (`what` starts the error): an id no fixed button has, a label, an icon of the set, a color, a group,
// and a shape of the library.
function checkTool(t,what) {
  if (!t || typeof t!=='object' || Array.isArray(t)) throw Error(`${what} is not a tool.`);
  if (typeof t.id!=='string' || !ID.test(t.id) || FIXED_TOOLS.includes(t.id) || t.id===LANDFORM_TOOL.id) throw Error(`${what} needs an id of its own (letters, digits, - and _).`);
  if (!label(t.label)) throw Error(`${what} needs a name of 1 to ${LABEL_MAX} characters.`);
  if (!TOOL_ICONS.includes(t.icon)) throw Error(`${what}: no icon ${JSON.stringify(t.icon)} (the set: ${TOOL_ICONS.join(', ')}).`);
  if (typeof t.color!=='string' || !COLOR.test(t.color)) throw Error(`${what} needs a color #rrggbb.`);
  if (!TOOL_GROUPS.includes(t.group)) throw Error(`${what} needs a group: ${TOOL_GROUPS.join(' or ')}.`);
  if (!Object.hasOwn(LANDFORM_SHAPES,toolShape(t))) throw Error(`${what}: no shape ${JSON.stringify(toolShape(t))}.`);
  if (t.rock!==undefined && (typeof t.rock!=='string' || !t.rock)) throw Error(`${what}: its rock is a preset's key.`);
}
// A world's toolbar (config.tools), checked: its shape tools in order, each id once.
export function worldTools(config) {
  const tools=config?.tools??[],seen=new Set();
  if (!Array.isArray(tools)) throw Error('A world\'s tools are a list.');
  return tools.map((t,i) => {
    checkTool(t,`The world's tool ${i+1}`);
    if (seen.has(t.id)) throw Error(`The world's tool ${t.id} is listed twice.`);
    seen.add(t.id); return {...t,label:t.label.trim()};
  });
}
// A tool may name its rock by a preset's key (the starting recipe a map's preset came from, sculpt-rock-presets.js): the slot of the map's
// preset with that key when the tool's card is made, Rock beneath (-1) in a map without one, and undefined for a tool that names none.
export const toolRockSlot=(tool,rocks=[]) => tool?.rock===undefined?undefined:rocks.find(r => r.key===tool.rock)?.slot??-1;
// The tool a stroke shows and carries as: its own, if the toolbar (`ids`) has it, else the generic landform. A stroke of another kind is its kind.
export const strokeTool=(n,ids) => n?.kind!=='landform'?n?.kind:ids.has(n.tool)?n.tool:LANDFORM_TOOL.id;
// Strokes whose tool the toolbar lacks go to the generic landform, their numbers as they are (a stroke from another world, or a map tool deleted).
export const keepStrokeTools=(nodes,ids) => nodes.map(n => n?.kind==='landform' && n.tool!==strokeTool(n,ids)?{...n,tool:strokeTool(n,ids)}:n);
// A landform stroke saved before strokes named their tool takes, once, the tool its section form belongs to (landformTool) if the toolbar has it,
// else the generic landform. Nothing else infers a tool.
export const inferStrokeTools=(nodes,ids) => nodes.map(n => n?.kind==='landform' && typeof n.tool!=='string'?{...n,tool:ids.has(landformTool(n.params))?landformTool(n.params):LANDFORM_TOOL.id}:n);
