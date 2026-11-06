// The map layouts measure/tilecount.mjs and repro/export-bytes.mjs export, as a scripted scene's strokes in map pixels (sculpt-scene.js
// sceneNodes; the page plays them with sculptDebug.scene, the headless host with openScene), so both hosts export the same map:
//   bare       the world's own flat ground;
//   landforms  a hill, a mountain, a plateau, deep water, a river and a V valley spread over the map;
//   dense      strokes of the widest brush (800 px) on a grid over the whole map, cycling through the tools.
// Each stroke is a gentle five-point curve, as the tools once drew it with the mouse across the map's overview.
import {mapGeometry} from '../sculpt-map.js';

const PLAN = [['hill', .22, .25], ['mountain', .55, .22], ['plateau', .2, .6], ['deep', .6, .62], ['river', .38, .45], ['valleyV', .7, .8]];
const CURVE = [[0, 0], [.25, .08], [.5, .12], [.75, .04], [1, 0]];
export const LAYOUTS = ['bare', 'landforms', 'dense'];

export function layoutStrokes(layout, unitsX, unitsY = unitsX) {
  if (!LAYOUTS.includes(layout)) throw new Error(`unknown layout ${layout}: one of ${LAYOUTS.join(', ')}`);
  const {width, height} = mapGeometry(unitsX, unitsY);
  // A stroke from (fx, fy) of the map, `len` of its width long.
  const stroke = (tool, fx, fy, len = .18, diameter = 0) => [tool, CURVE.map(([dx, dy]) => [Math.round(width * (fx + dx * len)), Math.round(height * fy + width * dy * len)]), diameter ? {card: {diameter}} : {}];
  if (layout === 'landforms') return PLAN.map(([tool, fx, fy]) => stroke(tool, fx, fy));
  if (layout === 'dense') {
    const cells = Math.max(2, Math.round(unitsX * .32)), tools = ['hill', 'mountain', 'plateau', 'valleyV', 'deep', 'river', 'hill', 'crater'], out = [];
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) out.push(stroke(tools[out.length % tools.length], .06 + .88 * i / cells, .06 + .88 * (j + .5) / cells, .88 / cells * .8, 800));
    return out;
  }
  return [];
}
