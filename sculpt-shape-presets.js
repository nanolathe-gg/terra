// H15: each kind's classic curve as numbers of the shared cross-section (engine-shape.wgsl crossSection), fitted by measure/section_fit.mjs.
// ph: face share of the reach; k: face curve (- concave); P: its exponent; cr: crown; al, ah: apron share and height; dph, dcr: change per unit of softness.
export const SECTION_PRESETS = {
  shoulder: {ph: .44, dph: .6, k: 0, P: 2.4, cr: 0},      // plateau, offset, erase, paint, sand, grass
  smooth: {ph: 1, k: 0, P: 2.4, cr: 0},                    // lower, smooth
  water: {ph: .9, k: 0, P: 2.4, cr: 0},                    // deep, shallow: one descent from the ground to the bed
  mountain: {ph: .709, dph: -.331, k: -1, P: 2.393, cr: .485, dcr: .565},
  hillPlain: {ph: .666, k: -.251, P: 3.956, cr: .469},     // a hill with ridge options: symmetric
  hillFront: {ph: .864, k: -1, P: 3.35, cr: .416},         // a shouldered hill's face side; the back is a smoothstep (sBack)
};
const FAMILY = {paint: 'shoulder', erase: 'shoulder', plateau: 'shoulder', offset: 'shoulder', sand: 'shoulder', grass: 'shoulder', lower: 'smooth', smooth: 'smooth', deep: 'water', shallow: 'water', mountain: 'mountain'};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// The section uniforms of a kind's preset (the shape of sectionUniforms), or null for a kind with no cross-section. `shouldered` and `plain` come from prepareNode.
export function presetUniforms(kind, q, {radius, bankScale, shouldered, sea}) {
  const fam = kind === 'hill' ? (shouldered ? 'hillFront' : 'hillPlain') : FAMILY[kind];
  const p = SECTION_PRESETS[fam]; if (!p) return null;
  const ds = q.softness - .5, ph = clamp(p.ph + (p.dph || 0) * ds, .1, 1), cr = clamp(p.cr + (p.dcr || 0) * ds, 0, 1);
  const faceWidth = .66 + ds * .9, backWidth = q.softness === .5 ? 1.34 : 2 - faceWidth;
  return {sOn: 1, sWater: 0, sDome: 0, sBed: sea + (kind === 'deep' ? -55 : -7), sApron: 0, sApronH: 0, sFace: 0, sShare: ph, sCurve: p.k, sP: p.P, sSteps: 0, sFlat: 0, sJit: 0, sLip: 0,
    sCapW: 0, sCapRise: .45 * cr, sCapExp: 1 + 2 * cr, sBank: 0, sShelf: 0, sShelfD: 0, sShelfSteps: 0, sVary: fam === 'shoulder' ? Math.min(.9, 1.2 * q.rough) : 0,
    sBack: fam === 'hillFront' ? backWidth / faceWidth : 0};
}
