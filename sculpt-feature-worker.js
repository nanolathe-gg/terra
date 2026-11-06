// The map's feature pixels, made off the page's thread for sculpt-features.js: a variant's body and shadow for the view (no burn
// frames), every frame the export packs ('full'), and a deposit or vent painted onto a patch of ground.
import {generateFeature, paintDeposit, paintVent, toRGBA} from './sculpt-feature-gen.js';

const palette = fetch(new URL('materials/palette.json', import.meta.url)).then(r => r.json()).then(d => d.indexed);
const sprite = (s, colors) => s && {w: s.w, h: s.h, ax: s.ax, ay: s.ay, rgba: toRGBA(s, colors)};

self.onmessage = async ({data}) => {
  const {id, type} = data;
  try {
    const colors = await palette;
    if (type === 'sprite') {
      const f = generateFeature(data.kind, data.params, data.seed, {light: data.light, tint: data.light?.tint, palette: colors, bodyOnly: true});
      const body = sprite(f.body, colors), shadow = sprite(f.shadow, colors);
      self.postMessage({id, body, shadow, bodyBlend: f.bodyBlend, shadowBlend: f.shadowBlend, gameplay: f.gameplay}, [body.rgba.buffer, ...(shadow ? [shadow.rgba.buffer] : [])]);
    } else if (type === 'full') {
      // Everything the export packs: body, shadow, the burn frames and the burnt successor's body and shadow, as palette indices.
      const f = generateFeature(data.kind, data.params, data.seed, {light: data.light, tint: data.light?.tint, palette: colors});
      const plain = s => s && {w: s.w, h: s.h, ax: s.ax, ay: s.ay, idx: s.idx, a: s.a};
      const out = {id, body: plain(f.body), shadow: plain(f.shadow), burn: f.burn?.map(plain) ?? null, bodyBlend: f.bodyBlend, gameplay: f.gameplay,
        burnt: f.burnt && {body: plain(f.burnt.body), shadow: plain(f.burnt.shadow), gameplay: f.burnt.gameplay}};
      const buffers = [out.body, out.shadow, ...(out.burn || []), out.burnt?.body, out.burnt?.shadow].filter(Boolean).flatMap(s => [s.idx.buffer, s.a.buffer]);
      self.postMessage(out, [...new Set(buffers)]);
    } else if (type === 'paint') {
      // The patch arrives with alpha 0; the painter sets alpha on every pixel it writes, so the patch comes back as the stamp itself.
      const ground = {w: data.w, h: data.h, rgba: new Uint8ClampedArray(data.rgba)};
      (data.kind === 'deposit' ? paintDeposit : paintVent)(ground, data.cx, data.cy, data.params, data.seed, {palette: colors, light: data.light, tint: data.light?.tint});
      self.postMessage({id, rgba: ground.rgba}, [ground.rgba.buffer]);
    } else throw new Error('Unknown feature job ' + type);
  } catch (error) { self.postMessage({id, error: String(error?.message || error)}); }
};
