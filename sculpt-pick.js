// Pick: the rail's Pick tool (key I), and Alt-click from any tool. One click on the map answers what is at that pixel in a card beside it, and
// every line of the card is a door: the shape under it (the hit test Select uses), the rock type the draw read there and how much of its rock
// shows (sculpt-renderer.js readProbe rock), that rock's material, the layers that drew (World › Surface keeps the detail), the ground and, on
// water, the water. A swatch is the Color of what its line names, changed through the same path as that thing's own control, one undo step a
// change; the line under it says what the change reaches. index.html holds the card (#pick); this fills it and keeps it beside its pixel.
import {layersAt} from './sculpt-surface-panel.js';

const $ = id => document.getElementById(id);
const percent = v => Math.round(v * 100) + '%';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Rock shows at a pixel once its share passes this (the exposure view's gray, 0-1): a speck of rock at a face's foot is not the rock's pixel.
const ROCK_SHOWN = .02;

// `host`: offMap(at); inspect(at) → the probe's read, or {unread: true} when the draw recorded nothing; shapeAt(world) → a shape's index or -1;
// shape(i) → {name, values} or null; selectShape(i); shapeSettings(i); rock(slot) → {name, color, tag, scope, values, material: {slot, name},
// reach} or null; recolorRock(slot, hex, commit); openRock(slot); ground(slot) and water() → {slot, name, color, tag, scope, reach} (water also
// shallow, its tint) or null; recolor(slot, hex, commit); editMaterial(slot, button); openSurface(at, read); read(at, read) on each new read;
// openColors(); surface() → the world's layers; client(at) → where the art pixel is on the page {x, y}; focusMap().
export function mountPick(host) {
  const layer = $('pick'), card = $('pick-card'), marker = $('pick-marker'), view = $('viewport');
  // The picked pixel (art space, as the probe reads it), the ground point under it (as Select hit-tests), and what the last read said.
  let at = null, world = null, read = null, shape = -1, ticket = 0, state = 'reading', failure = '';
  // What each swatch and door acts on, as the card shows it now.
  let rockSlot = null, rockMaterial = null, groundSlot = null, waterSlot = null;

  async function readHere() {
    const mine = ++ticket;
    if (host.offMap(at)) { state = 'off'; read = null; shape = -1; show(); return; }
    shape = world ? host.shapeAt(world) : -1; state = 'reading'; show();
    let result; try { result = await host.inspect(at); } catch (error) { result = {error}; }
    if (mine !== ticket || layer.hidden) return;
    if (result?.error) { state = 'failed'; failure = result.error.message; }
    else if (!result || result.unread) state = 'unread';
    else { state = 'read'; read = result; host.read(at, read); }
    show();
  }
  function pick(art, ground) {
    at = {x: Math.floor(art.x), y: Math.floor(art.y)}; world = ground; read = null;
    layer.hidden = false; readHere();
  }
  function close() {
    if (layer.hidden) return false;
    const inside = card.contains(document.activeElement);
    layer.hidden = true; ticket++; at = world = read = null;
    if (inside) host.focusMap();
    return true;
  }
  // A swatch shows its thing's color unless the artist is choosing one in it (a rebuilt value would close the picker).
  const swatch = (id, color) => { const input = $(id); input.disabled = !color; if (color && document.activeElement !== input) input.value = color; };
  const tag = (id, info) => { const e = $(id); e.textContent = info.tag; e.className = 'scope-tag scope-' + info.scope; };
  function show() {
    if (layer.hidden) return;
    $('pick-where').textContent = `Pixel ${at.x}, ${at.y}`;
    const note = state === 'off' ? 'That point is off the map.' : state === 'failed' ? `The pixel could not be read: ${failure}`
      : state === 'unread' ? 'The pixel could not be read yet: the renderer may still be preparing its pipelines.' : state === 'reading' && !read ? 'Reading the pixel…' : '';
    $('pick-note').hidden = !note; $('pick-note-text').textContent = note; $('pick-again').hidden = state !== 'failed' && state !== 'unread';
    // The shape is known at once (the hit test); the rest waits for the draw's record of the pixel.
    const s = state === 'off' || shape < 0 ? null : host.shape(shape);
    $('pick-shape').hidden = !s;
    if (s) { $('pick-shape-name').textContent = s.name; $('pick-shape-values').textContent = s.values; }
    const r = state === 'off' ? null : read, wet = Boolean(r && r.aboveSea < 0);
    const water = wet ? host.water() : null;
    $('pick-water').hidden = !water; waterSlot = water?.slot ?? null;
    if (water) {
      swatch('pick-water-color', water.color); $('pick-water-name').textContent = water.name; tag('pick-water-tag', water);
      $('pick-water-depth').textContent = `${(-r.aboveSea).toFixed(1)} below the sea ·`; $('pick-shallow-chip').style.background = water.shallow;
      $('pick-water-reach').textContent = water.reach;
    }
    const rock = r && r.rock.share >= ROCK_SHOWN ? host.rock(r.rock.slot) : null;
    $('pick-rock').hidden = !rock; rockSlot = rock ? r.rock.slot : null; rockMaterial = rock?.material?.slot ?? null;
    if (rock) {
      swatch('pick-rock-color', rock.color); $('pick-rock-name').textContent = rock.name; tag('pick-rock-tag', rock);
      $('pick-rock-kind').textContent = 'rock type' + (wet ? ' on the bed' : '') + (r.rock.share < .95 ? ` · shows ${percent(r.rock.share)}` : '');
      $('pick-rock-values').textContent = rock.values;
      $('pick-rock-material').textContent = rock.material?.name ?? 'No material: a plain gray'; $('pick-rock-edit').disabled = !rock.material;
      $('pick-rock-reach').textContent = rock.reach;
    }
    $('pick-layers').hidden = !r;
    if (r) {
      const here = layersAt(r, host.surface());
      $('pick-layers-text').textContent = here.length ? 'Layers here: ' + here.map(e => `${e.name} ${e.seen >= .995 ? 'shows' : e.seen < .005 ? 'covered' : percent(e.seen) + ' shows'}`).join(' · ')
        : 'No layer drew here: the ground shows.';
    }
    const ground = r ? host.ground(r.slot) : null;
    $('pick-ground').hidden = !ground; groundSlot = ground?.slot ?? null;
    if (ground) {
      swatch('pick-ground-color', ground.color); $('pick-ground-name').textContent = ground.name; tag('pick-ground-tag', ground);
      $('pick-ground-kind').textContent = wet ? 'ground under the water' : 'ground'; $('pick-ground-reach').textContent = ground.reach;
    }
    place();
  }
  // The ring on the pixel and the card beside it, inside the map view: right of the pixel, or left where the view ends, and held on screen.
  // Placed now, and again on the next frame, once a zoom has settled the view's scroll bars.
  let again = 0;
  function place() {
    if (layer.hidden || !at) return;
    if (!again) again = requestAnimationFrame(() => { again = 0; placeNow(); });
    placeNow();
  }
  function placeNow() {
    if (layer.hidden || !at) return;
    const box = layer.getBoundingClientRect(), v = view.getBoundingClientRect(), p = host.client(at);
    const left = v.left - box.left, top = v.top - box.top, right = left + view.clientWidth, bottom = top + view.clientHeight;
    const x = p.x - box.left, y = p.y - box.top;
    marker.hidden = x < left || x > right || y < top || y > bottom;
    marker.style.left = x + 'px'; marker.style.top = y + 'px';
    card.style.maxHeight = Math.max(120, bottom - top - 16) + 'px';
    const w = card.offsetWidth, h = card.offsetHeight;
    const cx = x + 18 + w <= right - 8 ? x + 18 : x - 18 - w;
    card.style.left = clamp(cx, left + 8, right - 8 - w) + 'px'; card.style.top = clamp(y - 22, top + 8, bottom - 8 - h) + 'px';
  }
  // The swatches: a drag recolors live, its release is one undo step (host.recolorRock, host.recolor); the card then says what it reaches now.
  const color = (id, apply) => { const input = $(id); input.oninput = () => apply(input.value, false); input.onchange = () => { apply(input.value, true); show(); }; };
  color('pick-rock-color', (hex, commit) => { if (rockSlot !== null) host.recolorRock(rockSlot, hex, commit); });
  color('pick-water-color', (hex, commit) => { if (waterSlot !== null) host.recolor(waterSlot, hex, commit); });
  color('pick-ground-color', (hex, commit) => { if (groundSlot !== null) host.recolor(groundSlot, hex, commit); });
  $('pick-close').onclick = close;
  $('pick-again').onclick = () => { if (at) readHere(); };
  $('pick-select').onclick = () => { if (shape >= 0) host.selectShape(shape); };
  $('pick-shape-open').onclick = () => { if (shape >= 0) host.shapeSettings(shape); };
  $('pick-rock-open').onclick = () => { if (rockSlot !== null) host.openRock(rockSlot); };
  $('pick-rock-edit').onclick = () => { if (rockMaterial !== null) host.editMaterial(rockMaterial, $('pick-rock-edit')); };
  $('pick-water-edit').onclick = () => { if (waterSlot !== null) host.editMaterial(waterSlot, $('pick-water-edit')); };
  $('pick-ground-edit').onclick = () => { if (groundSlot !== null) host.editMaterial(groundSlot, $('pick-ground-edit')); };
  $('pick-shallow-open').onclick = () => host.openColors();
  $('pick-layers-open').onclick = () => { if (read) host.openSurface(at, read); };
  // pick(art, ground) answers a click; close() says whether a card was open (the editor's Escape chain); refresh() reads the pixel again
  // after an undo or redo; colors() shows the swatches again once the renderer has measured the materials; place() follows the view.
  return {pick, close, place, refresh: () => { if (!layer.hidden && at) readHere(); }, colors: () => { if (!layer.hidden && read) show(); }, get open() { return !layer.hidden; }};
}
