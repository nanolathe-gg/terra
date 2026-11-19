// Pick: the rail's Pick tool (key I), and Alt-click from any tool. One click on the map answers what is at that pixel in a card beside it, and
// every line of the card is a door: the shape under it (the hit test Select uses), the rock type the draw read there and how much of its rock
// shows (sculpt-renderer.js readProbe rock), that rock's material, the layers that drew (World › Surface keeps the detail), the ground and, on
// water, the water. A swatch is the Color of what its line names, changed through the same path as that thing's own control, one undo step a
// change; the line under it says what the change reaches. index.html holds the card (#pick); this fills it and keeps it beside its pixel.
import {layersAt, FACT_LABELS} from './sculpt-surface-panel.js';
import {ruleHere, ruleToShow, ruleToHide, layerKey as layerKeyOf} from './sculpt-material-model.js';
import {controlRow} from './sculpt-workspace.js';

const $ = id => document.getElementById(id);
const percent = v => Math.round(v * 100) + '%';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Rock shows at a pixel once its share passes this (the exposure view's gray, 0-1): a speck of rock at a face's foot is not the rock's pixel.
const ROCK_SHOWN = .02;

const html = text => String(text).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const NO_BOUND = 1e8, num = v => Number(v).toFixed(2), fact = (name, v) => `${FACT_LABELS[name]?.[0] ?? name} ${num(v)}`;
// Why a layer of the world's list did not draw at the pixel: what World › Surface says of it (hidden while designing, cannot draw yet, only
// where painted), else what its rule says there (ruleHere: the window that is 0, or the score short of its threshold), else its edge noise
// or Coverage pattern. `state`: the layer as World › Surface places it (summary()).
export function absentReason(layer, state, facts) {
  if (state?.hidden) return 'Hidden while you design.';
  if (state?.section === 'idle') return state.reasons?.join(' ') || 'It cannot draw with the world as it is.';
  if (state?.section === 'painted') return 'It draws only where Surface paint has painted.';
  const rule = ruleHere(layer, facts), late = t => t.late ? ' (the final share: this layer may have seen less)' : '';
  if (rule.kind === 'none') return 'Its World settings place it, and they leave this pixel out.';
  const needs = t => t.from <= -NO_BOUND ? `below ${num(t.to)}` : t.to >= NO_BOUND ? `above ${num(t.from)}` : `${num(t.from)} to ${num(t.to)}`;
  if (rule.kind === 'where') {
    const out = rule.terms.filter(t => t.share === 0).map(t => `${fact(t.fact, t.value)} here${late(t)}; the rule needs ${needs(t)}`);
    if (out.length) return out.join('. ') + '.';
    // In a window's soft edge (its fade) the rule shows the layer at part strength, and the edge noise or Coverage leaves this pixel out.
    const soft = rule.terms.filter(t => t.share < .995);
    if (soft.length) return `${soft.map(t => `${fact(t.fact, t.value)} here${late(t)} is in the soft edge of the rule (it needs ${needs(t)})`).join('. ')}: the layer shows at about ${percent(rule.share)} strength here, and its edge noise or Coverage leaves this pixel out.`;
  } else if (rule.share === 0) return `Its score here is ${num(rule.score)}; it needs about ${num(rule.from)} (${rule.terms.map(t => `${t.weight} × ${fact(t.fact, t.value)}${late(t)}`).join(' + ')}).`;
  else if (rule.share < .995) return `Its score here is ${num(rule.score)}, at the soft edge of the ${num(rule.from)} it needs: the layer shows at about ${percent(rule.share)} strength here, and its edge noise or Coverage leaves this pixel out.`;
  return 'Its rule matches here; its edge noise or Coverage leaves this pixel out.';
}

// `host`: offMap(at); inspect(at) → the probe's read, or {unread: true} when the draw recorded nothing; shapeAt(world) → a shape's index or -1;
// shape(i) → {name, values} or null; selectShape(i); shapeSettings(i); rock(slot) → {name, color, tag, scope, values, material: {slot, name},
// reach} or null; recolorRock(slot, hex, commit); openRock(slot); ground(slot) and water() → {slot, name, color, tag, scope, reach} (water also
// shallow, its tint) or null; recolor(slot, hex, commit); editMaterial(slot, button); openSurface(at, read); read(at, read) on each new read;
// openColors(); surface() → the world's layers; setSurface(list) → stores the world's layers, one undo step; client(at) → where the art pixel is
// on the page {x, y}; focusMap().
export function mountPick(host) {
  const layer = $('pick'), card = $('pick-card'), marker = $('pick-marker'), view = $('viewport');
  // The picked pixel (art space, as the probe reads it), the ground point under it (as Select hit-tests), and what the last read said.
  let at = null, world = null, read = null, shape = -1, ticket = 0, state = 'reading', failure = '';
  // What each swatch and door acts on, as the card shows it now.
  let rockSlot = null, rockMaterial = null, groundSlot = null, waterSlot = null;
  // The rows the artist moved at this pixel: they stay in the card at 0 (no longer acting), so a row dragged to 0 does not vanish on release.
  const used = new Set();

  async function readHere() {
    const mine = ++ticket;
    if (host.offMap(at)) { state = 'off'; read = null; shape = -1; show(); return; }
    shape = world ? host.shapeAt(world) : -1; state = 'reading'; show();
    let result; try { result = await host.inspect(at, () => mine === ticket && !layer.hidden); } catch (error) { result = {error}; }
    if (mine !== ticket || layer.hidden) return;
    if (result?.error) { state = 'failed'; failure = result.error.message; }
    else if (!result || result.unread) state = 'unread';
    else { state = 'read'; read = result; host.read(at, read); }
    show();
  }
  function pick(art, ground) {
    at = {x: Math.floor(art.x), y: Math.floor(art.y)}; world = ground; read = null; $('pick-layers-moved').hidden = true; used.clear();
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
  const tag = (id, info) => { const e = $(id); e.textContent = info.tag ?? ''; e.className = 'scope-tag scope-' + info.scope; e.hidden = !info.tag; };
  // Settings rows (host.settings): sliders that edit through the World row's own range (host.setSetting), one undo step a release. A list
  // with the same rows keeps its elements and takes new values, except in the row being used, so a read after a release never replaces it.
  function fillRows(box, rows, slot) {
    const keys = rows.map(r => r.key).join(' ') + '|' + slot;
    if (box.dataset.keys === keys) {
      for (const r of rows) {
        const range = box.querySelector(`input[data-pick-key="${CSS.escape(r.key)}"]`), row = range?.closest('.control');
        if (!range || row.contains(document.activeElement)) continue;
        range.value = String(r.value); row.querySelector('output').textContent = range.value;
      }
      return;
    }
    box.dataset.keys = keys;
    // Rows from more than one World tab go under that tab's name (Cracks & bands › Width), as the World panel shows them.
    const tab = r => r.home.split('/')[1] || r.home.split('/')[0], grouped = new Set(rows.map(tab)).size > 1;
    let last = '';
    box.replaceChildren(...rows.flatMap(r => {
      const head = grouped && tab(r) !== last ? [Object.assign(document.createElement('p'), {className: 'pick-group', textContent: (last = tab(r))})] : [];
      const row = controlRow({id: 'pick-k-' + r.key, label: `${html(r.label)} <output>${html(r.value)}</output>`, range: `min="${r.min}" max="${r.max}" step="${r.step}" value="${r.value}"`});
      const range = row.querySelector('input[type=range]'); range.dataset.pickKey = r.key;
      range.addEventListener('input', () => { used.add(r.key); row.querySelector('output').textContent = range.value; host.setSetting(r.key, range.value, false, slot); });
      range.addEventListener('change', () => host.setSetting(r.key, range.value, true, slot));
      return [...head, row];
    }));
  }
  // A folded group of rows: hidden when it has none, its summary saying how many and of what.
  function group(id, rows, slot, label) {
    $(id).hidden = !rows.length; if (!rows.length) return;
    $(id + '-label').textContent = label(rows.length); fillRows($(id + '-rows'), rows, slot);
  }
  const acting = rows => rows.filter(r => r.active || used.has(r.key));
  const count = (n, what) => `${n} ${what}${n === 1 ? '' : 's'}`;
  function show() {
    if (layer.hidden) return;
    $('pick-where').textContent = `Pixel ${at.x}, ${at.y}`;
    const note = state === 'off' ? 'That point is off the map.' : state === 'failed' ? `The pixel could not be read: ${failure}`
      : state === 'unread' ? 'The pixel could not be read yet: the renderer may still be preparing its pipelines.' : state === 'reading' && !read ? 'Reading the pixel…' : '';
    $('pick-note').hidden = !note; $('pick-note-text').textContent = note; $('pick-again').hidden = state !== 'failed' && state !== 'unread';
    // The shape is known at once (the hit test); the rest waits for the draw's record of the pixel. Its rock settings (Cracks, Gullies) show
    // once the read says rock shows here: on water or grass they would describe nothing at the pixel.
    const r = state === 'off' ? null : read, wet = Boolean(r && r.aboveSea < 0);
    const s = state === 'off' || shape < 0 ? null : host.shape(shape);
    $('pick-shape').hidden = !s;
    if (s) { $('pick-shape-name').textContent = s.name; $('pick-shape-values').textContent = r && r.rock.share >= ROCK_SHOWN ? s.values : ''; }
    const water = wet ? host.water() : null;
    $('pick-water').hidden = !water; waterSlot = water?.slot ?? null;
    if (water) {
      swatch('pick-water-color', water.color); $('pick-water-name').textContent = water.name; tag('pick-water-tag', water);
      $('pick-water-depth').textContent = `${(-r.aboveSea).toFixed(1)} below the sea ·`; $('pick-shallow-chip').style.background = water.shallow;
      $('pick-water-reach').textContent = water.reach;
      group('pick-water-more', acting(host.settings(['Water & shores'])), null, n => `${count(n, 'water setting')} acting here`);
    }
    const rock = r && r.rock.share >= ROCK_SHOWN ? host.rock(r.rock.slot) : null;
    $('pick-rock').hidden = !rock; rockSlot = rock ? r.rock.slot : null; rockMaterial = rock?.material?.slot ?? null;
    if (rock) {
      swatch('pick-rock-color', rock.color); $('pick-rock-name').textContent = rock.name; tag('pick-rock-tag', rock);
      $('pick-rock-kind').textContent = 'rock type' + (wet ? ' on the bed' : '') + (r.rock.share < .95 ? ` · shows ${percent(r.rock.share)}` : '');
      // This rock type's own settings that act (its headlines in view, the rest folded), then the world's settings for every rock type.
      const own = acting(host.settings(['Rock types'], r.rock.slot)).filter(row => !row.home.endsWith('/Colors & recipe'));
      fillRows($('pick-rock-rows'), own.filter(row => row.headline), r.rock.slot);
      group('pick-rock-more', own.filter(row => !row.headline), r.rock.slot, n => `${count(n, 'more setting')} of ${rock.name}`);
      group('pick-cliffs', acting(host.settings(['Cliffs & stones'])), null, n => `${count(n, 'setting')} for every rock type`);
      $('pick-cliffs-tag').textContent = 'World';
      $('pick-rock-material').textContent = rock.material?.name ?? 'No material: a plain gray'; $('pick-rock-edit').disabled = !rock.material;
      $('pick-rock-reach').textContent = rock.reach;
    }
    $('pick-layers').hidden = !r;
    if (r) {
      // The layers that drew here, top first, with what of each shows; then why each other layer of the world did not draw.
      const layers = host.surface(), here = layersAt(r, layers), drew = new Set(here.map(e => e.key)), states = new Map(host.layerStates().map(l => [l.key, l]));
      $('pick-layers-text').textContent = here.length ? 'Surface layers here, top first' : 'No surface layer drew here: the ground shows.';
      const door = (key, name) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'link'; b.textContent = name; b.title = 'Open this layer in World › Surface'; b.onclick = () => host.openLayer(key); return b; };
      const item = (key, name, text, act) => { const li = document.createElement('li'), span = document.createElement('span'); span.textContent = text; li.append(door(key, name), span); if (act) li.append(' ', act); return li; };
      const byKey = new Map(layers.map(l => [layerKeyOf(l), l])), ruled = l => Boolean(l?.where?.length || l?.score?.terms?.length);
      // A layer with a rule may be moved here: Not here on one that shows, Show here on one its rule keeps out (not one hidden, painted only
      // or unable to draw, which no limit changes).
      const move = (key, show) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'pick-door pick-move'; b.textContent = show ? 'Show here' : 'Not here';
        b.title = show ? 'Move this layer’s rule limits so it holds at this pixel (one undo step)' : 'Move one of this layer’s rule limits so it no longer holds at this pixel (one undo step)';
        b.onclick = () => moveLayer(key, show); return b; };
      $('pick-layers-list').replaceChildren(...here.map(e => item(e.key, e.name, e.seen >= .995 ? 'shows' : e.seen < .005 ? 'covered by a later layer' : `${percent(e.seen)} shows`,
        ruled(byKey.get(e.key)) && !states.get(e.key)?.hidden ? move(e.key, false) : null)));
      const absent = layers.filter(l => !drew.has(layerKeyOf(l)));
      $('pick-layers-absent').hidden = !absent.length;
      $('pick-layers-absent-label').textContent = `Why ${count(absent.length, 'other layer')} ${absent.length === 1 ? 'is' : 'are'} not here`;
      $('pick-layers-absent-list').replaceChildren(...absent.map(l => { const key = layerKeyOf(l), st = states.get(key);
        const open = ruled(l) && st?.section === 'drawing' && !st.hidden && ruleHere(l, r.facts).share < .995;
        return item(key, st?.name ?? key, absentReason(l, st, r.facts), open ? move(key, true) : null); }));
    }
    const ground = r ? host.ground(r.slot) : null;
    $('pick-ground').hidden = !ground; groundSlot = ground?.slot ?? null;
    if (ground) {
      swatch('pick-ground-color', ground.color); $('pick-ground-name').textContent = ground.name; tag('pick-ground-tag', ground);
      $('pick-ground-kind').textContent = wet ? 'ground under the water' : 'ground'; $('pick-ground-reach').textContent = ground.reach;
      // The world's ground settings, where ground shows: not under water, nor on a pixel that is all rock.
      group('pick-ground-more', wet || r.rock.share >= .95 ? [] : acting(host.settings(['Ground'])), null, n => `${count(n, 'setting')} of the world’s ground acting here`);
    }
    place();
  }
  // Show here / Not here (sculpt-material-model.js ruleToShow, ruleToHide): the layer's rule limits moved from the facts the draw recorded at
  // the pixel, stored as one undo step; the card says what moved (or why nothing could) and reads the pixel again once the map has redrawn.
  const limitName = (fact, end) => fact ? `${(FACT_LABELS[fact]?.[0] ?? fact).replace(/\s*\([^)]*\)/g, '')} ${end}:` : 'the score’s threshold:';
  const limitValue = v => v == null ? 'none' : String(+Number(v).toFixed(3));
  function moveLayer(key, show) {
    if (!read) return;
    const layers = host.surface(), i = layers.findIndex(l => layerKeyOf(l) === key), name = host.layerStates().find(l => l.key === key)?.name ?? key;
    const note = $('pick-layers-moved'), result = i < 0 ? {reason: 'That layer is gone from the world.'} : (show ? ruleToShow : ruleToHide)(layers[i], read.facts);
    if (result.reason) { note.hidden = false; note.textContent = `${name}: ${result.reason}`; return; }
    // The note is shown after the change's own undo step (setSurface refreshes the card): the next change, Undo or Redo hides it (refresh).
    if (!host.setSurface(layers.map((l, k) => k === i ? result.layer : l))) { note.hidden = false; note.textContent = `${name} could not be changed.`; return; }
    note.hidden = false;
    note.textContent = `${name}: its rule now ${show ? 'holds here' : 'leaves this pixel out'}: ${result.moved.map(m => `${limitName(m.fact, m.end)} ${limitValue(m.was)} → ${limitValue(m.now)}`).join(', ')}. Undo puts it back.`;
    readHere();
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
  return {pick, close, place, refresh: () => { $('pick-layers-moved').hidden = true; if (!layer.hidden && at) readHere(); }, colors: () => { if (!layer.hidden && read) show(); }, get open() { return !layer.hidden; }};
}
