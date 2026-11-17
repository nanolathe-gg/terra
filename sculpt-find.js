// One search for everything with a name: the top bar's Find box (⌘ / Ctrl K, or / outside a text field). It finds World rows and
// colors, Surface layers and the layers Add a layer makes, the shape card's rows for the tool in hand or the selected shape, tools,
// feature kinds, the map's materials and the menu actions. The index is read from the live page each time the box opens (labels,
// notes, section, tab and group names), so a new row is found without touching this file. Going to a result opens its panel,
// section, tab and folded group, scrolls to it, focuses it and flashes it; a tool is picked, an action pressed.

// Everyday words: each word on the left also finds what the words on the right find, the first of them ranked highest. Short on
// purpose; edit freely.
export const SYNONYMS = [
  ['drain drainage flow',               'gully groove runoff rain erosion'],
  ['tree forest wood woods',            'tree shrub vegetation'],
  ['dark darker light lighter bright brightness', 'color tone shade light sun sky'],
  ['snow snowy',                        'snow ice frost paint'],
  ['cliff cliffs',                      'rock face wall'],
  ['beach shore coast',                 'beach shore coast sand'],
  ['zoom',                              'fit zoom'],
  ['colour',                            'color'],
  ['plant plants grass',                'vegetation grass moss shrub'],
  ['lake sea ocean',                    'water sea'],
];

// A word in plain form: lower case, no accents, "&" read as "and", camelCase split.
export const normalize = text => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/([a-z])([A-Z])/g, '$1 $2')
  .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
export const words = text => { const n = normalize(text); return n ? n.split(' ') : []; };
// Plural to singular, enough for the editor's words (gullies, beaches, colors).
export const stem = w => w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 4 && /(?:ch|sh|x|ss)es$/.test(w) ? w.slice(0, -2)
  : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;

const synonymTable = SYNONYMS.map(([from, to]) => [words(from).map(stem), words(to).map(stem)]);
// The editor's words an everyday word also looks for, strongest first (a word of four letters or more also expands while it is typed).
export function expand(term) {
  const s = stem(term), out = new Set();
  for (const [from, to] of synonymTable) if (from.some(f => f === s || (s.length >= 4 && f.startsWith(s)))) for (const t of to) if (t !== s) out.add(t);
  return [...out];
}

// How much each field counts: an exact word, then a word that starts with the term. A synonym counts half.
const WEIGHTS = {name: [10, 7], words: [5, 4], path: [4, 3], note: [2, 1]};
const prepared = new WeakMap();
function prepare(entry) {
  let p = prepared.get(entry);
  if (!p) {
    const list = text => words(text).map(raw => ({raw, stem: stem(raw)}));
    p = {name: list(entry.name), words: list(entry.words), path: list((entry.path || []).join(' ')), note: list(entry.note), plain: normalize(entry.name)};
    prepared.set(entry, p);
  }
  return p;
}
const wordMatch = (list, s) => { let best = 0; for (const w of list) { if (w.stem === s || w.raw === s) return 2; if (w.raw.startsWith(s) || w.stem.startsWith(s)) best = 1; } return best; };
// The best field a term matches; a path that agrees with a name or kind words adds a little (Blocks & joints › Block size).
// A synonym looks only at names and kind words: in paths and notes it finds more noise than help.
function fieldScore(p, s, short, synonym = false) {
  let best = 0, path = 0;
  for (const [field, [exact, prefix]] of Object.entries(WEIGHTS)) {
    if ((field === 'note' && short) || (synonym && (field === 'path' || field === 'note'))) continue;
    const m = wordMatch(p[field], s), value = m === 2 ? exact : m ? prefix : 0;
    if (field === 'path') path = value;
    best = Math.max(best, value);
  }
  return best + (path && best > path ? .5 : 0);
}
// An entry's score for a query: every word of the query must match somewhere (directly or through a synonym); 0 when one does not.
// A synonym counts half, less a little for each place it stands after the first.
export function score(entry, query) {
  const terms = words(query);
  if (!terms.length) return 0;
  const p = prepare(entry);
  let total = 0;
  for (const term of terms) {
    const s = stem(term), short = s.length < 3;
    let best = fieldScore(p, s, short);
    expand(term).forEach((other, i) => { best = Math.max(best, fieldScore(p, other, false, true) * Math.max(.3, .5 - .03 * i)); });
    if (!best) return 0;
    total += best;
  }
  const q = normalize(query);
  if (p.plain === q) total += 8; else if (p.plain.startsWith(q)) total += 4;
  if (entry.unavailable) total -= .5;
  return total + (entry.bias || 0);
}
// The best matches, at most `limit`, grouped by where they live: the group with the best match first, each group's best first.
export function search(entries, query, limit = 60) {
  const scored = [];
  entries.forEach((entry, i) => { const s = score(entry, query); if (s > 0) scored.push({entry, s, i}); });
  scored.sort((a, b) => b.s - a.s || a.entry.name.length - b.entry.name.length || a.i - b.i);
  const groups = new Map();
  for (const {entry} of scored.slice(0, limit)) { if (!groups.has(entry.group)) groups.set(entry.group, []); groups.get(entry.group).push(entry); }
  return [...groups].map(([group, items]) => ({group, items}));
}

// ---- The page ----

const $ = id => document.getElementById(id);
const clean = text => String(text ?? '').replace(/[▾▸▴▶…]/g, '').replace(/\s+/g, ' ').trim();
// Where generic rows are read from, and the name each starts its path with.
const SCOPES = [['pane-world', 'World'], ['brush-panel', 'Shape card'], ['pane-map', 'Map'], ['pane-graphics', 'View']];
const FIELDS = 'input, select, textarea, .scrub';
// Not rows of their own: the World panel's own search, a part's switch (its row is found), a slider's typed entry and native range,
// the Surface list's heads and Add a layer (found by name below), file pickers.
const SKIP = '#world-control-search, summary, .scrub-entry, .scrub-native, .surface-head, #surface-add, [type=file], [type=hidden], [type=button], [type=submit]';
const MARK = '.control, .color-row, .surface-layer, label';
const KIND_WORDS = {color: 'color', choice: 'choice', switch: 'switch', slider: '', field: '', tool: 'tool', layer: 'layer', feature: 'feature', material: 'material', action: ''};
// The menu actions: [button id, how, name]. "run" presses the button (a file dialog or New opens just as it would); "go" opens its panel and
// puts the focus on it, or on the element named after the colon. The name defaults to the button's own words.
export const ACTIONS = [
  ['new-map', 'run'], ['tab-map', 'run', 'Map'], ['load', 'run'], ['save', 'run'], ['open-export', 'run'], ['map-export', 'go'], ['export', 'go'],
  ['share-link', 'go'], ['open-graphics', 'run', 'View'], ['view-rendered', 'run'], ['view-clay', 'run'], ['view-passability', 'run'], ['focus-canvas', 'run', 'Focus'], ['fit', 'run'],
  ['zoom-in', 'run', 'Zoom in'], ['zoom-out', 'run', 'Zoom out'], ['materials-toolbar', 'run'], ['tab-objects', 'run', 'Shapes'],
  ['world-new', 'go:world-new-name'], ['world-export', 'run'], ['world-import', 'run'],
];

function ownText(el) {
  if (!el) return '';
  const copy = el.cloneNode(true);
  copy.querySelectorAll('output, select, input, textarea, button, .small, svg').forEach(n => n.remove());
  return clean(copy.textContent);
}
// A heading's or summary's own words, without the note beside them ("Details" of "Details optional parts of the shape").
const headText = el => clean([...el?.childNodes ?? []].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(' ')) || ownText(el);
// The buttons that control each hidden part by id (aria-controls), read once per index and per going (the page redraws some).
let controllers = null;
function controlOf(target) {
  if (!target.id) return null;
  if (!controllers) {
    controllers = new Map();
    for (const b of document.querySelectorAll('[aria-controls]')) if (b.id !== 'find-input') for (const id of b.getAttribute('aria-controls').split(/\s+/)) if (!controllers.has(id)) controllers.set(id, b);
  }
  const b = controllers.get(target.id);
  return b?.isConnected ? b : null;
}
// How a hidden container is shown: the button that controls it (a tab, a menu, a side panel, "Show N unavailable settings"), or a World row.
function opener(el) { return controlOf(el) || (el.matches('[data-knob], .world-subsection') ? 'row' : null); }
const reachable = el => { for (let a = el; a && a !== document.body; a = a.parentElement) if (a.hidden && !opener(a)) return false; return true; };
const shown = el => {
  if (!el?.isConnected || !el.getClientRects().length) return false;
  for (let d = el.parentElement?.closest('details'); d; d = d.parentElement?.closest('details')) if (!d.open && !d.querySelector(':scope > summary')?.contains(el)) return false;
  return true;
};
// The names of the sections, tabs, folded groups and headed blocks between a row and its scope.
function pathOf(el, root, first) {
  const parts = [];
  for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
    let part = '';
    if (a.matches('[role=tabpanel][aria-labelledby]')) part = ownText($(a.getAttribute('aria-labelledby')));
    else if (a.tagName === 'DETAILS') part = headText(a.querySelector(':scope > summary'));
    else if (a.classList.contains('surface-layer')) part = layerName(a);
    else if (a.classList.contains('material-control-colors')) part = headText(a.firstElementChild);   // a material's published colors
    else {
      // The last heading among its own children that comes before the element (children, not a selector: these blocks are large).
      let head = null;
      for (const h of a.children) { if (h.contains(el) || h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) break; if (/^H[234]$/.test(h.tagName) && !h.matches('.world-where, .sr-only')) head = h; }
      part = head ? headText(head) : '';
    }
    if (part) parts.unshift(part);
  }
  parts.unshift(first);
  return parts.filter((p, i) => i === 0 || normalize(p) !== normalize(parts[i - 1]));
}
function fieldName(el) {
  const row = el.closest('.control');
  const label = el.matches('.scrub') ? el.querySelector(':scope > label') : el.labels?.[0] || (row && row.querySelectorAll('input, select, textarea, .scrub').length === 1 ? row.querySelector(':scope > label') : null);
  return ownText(label) || clean(el.closest('.color-row')?.querySelector(':scope > span')?.textContent) || clean(el.getAttribute('aria-label') || el.title);
}
// Where an element outside the scopes lives: its scope's path, else the button that opens its panel ("Export").
function whereOf(el) {
  for (const [id, first] of SCOPES) { const root = $(id); if (root?.contains(el)) return pathOf(el, root, first); }
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const b = controlOf(a); if (b) return [clean(b.getAttribute('aria-label') || ownText(b))]; }
  return [];
}
const kindOf = el => el.type === 'color' ? 'color' : el.tagName === 'SELECT' ? 'choice' : el.type === 'checkbox' || el.type === 'radio' ? 'switch' : el.matches('.scrub, [type=range]') ? 'slider' : 'field';
const layerName = li => { const n = li.querySelector('.surface-name'); return clean(n?.value ?? n?.textContent); };
// What editing an element changes, as the page's own scope tag says it (sculpt-workspace.css .scope-tag): the tag of the nearest block that
// holds the element, sitting directly in it (a map-saved row, the switch or button it follows), in its heading or head row (a group of
// map-saved rows, the Map menu, the shape and Features cards, the World panel), or in the rock type picker's head (the rock type rows).
// Null where the page says nothing (Settings, tools, actions, materials).
const SCOPE_HEADS = ':scope > .scope-tag, :scope > :is(h2, h3, h4, .card-head, .control-search) > .scope-tag, :scope > .rock-picker .scope-tag';
function scopeOf(el) {
  for (let a = el?.parentElement; a && a !== document.body; a = a.parentElement) {
    const tag = a.querySelector(SCOPE_HEADS), text = clean(tag?.textContent);
    if (text) return {text, variant: [...tag.classList].find(c => c !== 'scope-tag' && c.startsWith('scope-')) || ''};
  }
  return null;
}

function rows(entries) {
  for (const [id, first] of SCOPES) {
    const root = $(id);
    if (!root || !reachable(root)) continue;
    for (const el of root.querySelectorAll(FIELDS)) {
      if (el.closest(SKIP) || !reachable(el)) continue;
      if (el.type === 'checkbox' && el.parentElement.querySelector('input[type=color]')) continue;   // a color's on/off: the color is found
      const name = fieldName(el);
      if (!name) continue;
      const row = el.closest('.control'), kind = kindOf(el), source = el.matches('.scrub') ? row?.querySelector('input[type=range]') : el;
      const label = el.matches('.scrub') ? el.querySelector(':scope > label') : el.labels?.[0];
      const inactive = row?.classList.contains('control-inactive'), reason = inactive ? clean(row.querySelector('.control-requirement')?.textContent) : '';
      entries.push({group: first, name, path: pathOf(el, root, first), kind, unavailable: Boolean(inactive || source?.disabled), reason: reason || (source?.disabled ? clean(source.title) : ''),
        words: [KIND_WORDS[kind], label?.title, row?.dataset.searchGroup, row?.dataset.knob, row?.dataset.note, el.getAttribute('aria-label'), el.title].filter(Boolean).join(' '),
        // A choice's options count as its note, so "snow" finds the Paint row that offers Snow.
        note: [clean(row?.querySelector(':scope > p.small:not(.control-requirement)')?.textContent), ...(el.tagName === 'SELECT' ? [...el.options].map(o => o.text) : [])].join(' '),
        swatch: kind === 'color' ? el.value : '', scope: scopeOf(el), go: () => goTo(el)});
    }
  }
}
function surface(entries) {
  const list = $('surface-layers');
  if (list && reachable(list)) {
    let stage = '';
    for (const li of list.children) {
      if (li.classList.contains('surface-group')) { stage = clean(li.textContent); continue; }
      if (!li.classList.contains('surface-layer')) continue;
      const name = layerName(li), key = li.dataset.key, drawn = clean(li.querySelector('.surface-drawn')?.textContent), chip = li.querySelector('.material-chip');
      if (!name) continue;
      entries.push({group: 'Surface layers', name, path: ['Surface layer', stage], kind: 'layer', words: `layer ${drawn}`, note: drawn, scope: scopeOf(li), go: () => openLayer(key)});
      // A layer's Color is in its open row; an open row's own controls are found as rows.
      if (chip && !chip.classList.contains('own') && !li.classList.contains('open'))
        entries.push({group: 'Surface layers', name: `${name} color`, path: ['Surface layer', name], kind: 'color', words: `color ${drawn}`, swatch: chip.style.backgroundColor, bias: -1, scope: scopeOf(li), go: () => openLayer(key, 'input[type=color]')});
    }
  }
  const add = $('surface-add');
  if (add && reachable(add)) for (const o of add.options) if (o.value)
    // Going adds the layer (one undo step), so a preset ranks under what the world already has.
    entries.push({group: 'Surface layers', name: clean(o.text), path: ['Add a layer'], kind: 'action', words: 'add layer new', unavailable: add.disabled, bias: -4, scope: scopeOf(add), go: () => addLayer(o.value)});
}
function tools(entries) {
  // Features and Starts edit the map: their card says so (its head's tag).
  const features = scopeOf(document.querySelector('.feature-kinds'));
  for (const b of document.querySelectorAll('.tool-palette [data-tool], #feature-tool, #starts-tool')) {
    const rail = b.closest('.tool-group')?.querySelector('.rail-button'), name = clean(b.getAttribute('aria-label') || b.textContent);
    entries.push({group: 'Tools', name, path: ['Tool', ownText(rail), b.closest('.tool-family')?.getAttribute('aria-label')].filter(Boolean), kind: 'tool', words: ['tool', b.title, b.dataset.shape].filter(Boolean).join(' '), unavailable: b.disabled,
      scope: b.matches('#feature-tool, #starts-tool') ? features : null, go: () => { if (b.disabled) return; b.click(); land(null, shown(b) ? b : rail || b); }});
  }
  for (const b of document.querySelectorAll('.feature-kinds [data-feature-kind]'))
    entries.push({group: 'Features', name: clean(b.textContent), path: ['Tool', 'Features'], kind: 'feature', words: `feature ${b.title}`, unavailable: $('feature-tool')?.disabled, scope: scopeOf(b), go: () => pickFeature(b)});
}
function materials(entries) {
  // The map's materials, as the World panel's ground and water choices list them (each leaves out the other's).
  const seen = new Map();
  for (const id of ['ground-world-default', 'water-material']) for (const o of $(id)?.options ?? []) if (o.value && !seen.has(o.value)) seen.set(o.value, clean(o.text));
  for (const [slot, name] of seen) entries.push({group: 'Materials', name, path: ['Material editor'], kind: 'material', words: 'material', unavailable: $('materials-toolbar')?.disabled, go: () => openMaterial(slot)});
}
function actions(entries) {
  for (const [id, how, named] of ACTIONS) {
    const b = $(id);
    if (!b || !reachable(b)) continue;
    const name = named || clean(b.getAttribute('aria-label') || ownText(b) || b.textContent);
    entries.push({group: 'Actions', name, path: how === 'run' ? ['Action'] : ['Action', ...whereOf(b)], kind: 'action', words: clean(b.title), unavailable: b.disabled,
      // A menu that is already open stays open: its button toggles.
      reason: b.disabled ? clean(b.title) : '', go: () => { if (how !== 'run') goTo(how.startsWith('go:') ? $(how.slice(3)) : b, b); else if (!b.disabled) { if (b.getAttribute('aria-expanded') !== 'true') b.click(); flash(b); } }});
  }
}
// The index, read from the page as it is now.
export function collect() {
  const entries = [];
  controllers = null;
  actions(entries); tools(entries); rows(entries); surface(entries); materials(entries);
  return entries;
}

// ---- Going ----

const flashes = new WeakMap();
function flash(el) {
  if (!el) return;
  el.classList.remove('find-flash'); void el.offsetWidth; el.classList.add('find-flash');
  clearTimeout(flashes.get(el)); flashes.set(el, setTimeout(() => el.classList.remove('find-flash'), 1600));
}
// Scroll only the scrolling panels that hold an element (scrollIntoView would also move the page's overflow-hidden frames).
export function bringIntoView(el, center = true) {
  for (let a = el?.parentElement; a && a !== document.body; a = a.parentElement) {
    if (a.scrollHeight <= a.clientHeight || !/auto|scroll/.test(getComputedStyle(a).overflowY)) continue;
    const r = el.getBoundingClientRect(), box = a.getBoundingClientRect(), top = r.top - box.top - a.clientTop, bottom = top + r.height;
    const by = center ? top - (a.clientHeight - r.height) / 2 : top < 0 ? top : bottom > a.clientHeight ? bottom - a.clientHeight : 0;
    if (by) a.scrollTop += by;
  }
}
function land(target, mark = target) {
  if (target) { bringIntoView(target); target.focus({preventScroll: true}); }
  else if (mark) bringIntoView(mark, false);
  flash(mark);
}
// A World row the panel hides: by its search, by "All" (a fine setting), by the Shine tab's material, or in "Show N unavailable settings".
// A control of a World group that is not a row of its own (Cracks' Style) shows when its group does, with "All".
function showWorldRow(el) {
  const row = el.closest('[data-knob]'), group = el.closest('.world-subsection'), search = $('world-search'), fine = $('world-fine');
  const hidden = () => row ? row.hidden : Boolean(group?.hidden), eligible = () => row ? row.dataset.eligible === 'true' : !group?.hidden;
  if (!hidden()) return;
  if (search?.value) { search.value = ''; search.dispatchEvent(new Event('input', {bubbles: true})); }
  if (hidden() && !eligible() && fine && !fine.checked) { fine.checked = true; fine.dispatchEvent(new Event('change', {bubbles: true})); }
  if (!row) return;
  if (row.hidden && !eligible()) for (const b of row.closest('.world-tab')?.querySelectorAll('[data-shine-material]') ?? []) { b.click(); if (eligible()) break; }
  if (row.hidden) { controllers = null; const b = controlOf(row); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); }
}
// Open everything between the page and an element, outermost first: side panel, tab, section, tab of the section, row group, folded group.
function reveal(el) {
  const chain = [];
  controllers = null;
  for (let a = el; a && a !== document.body; a = a.parentElement) chain.unshift(a);
  for (const a of chain) {
    if (a.hidden) { const how = opener(a); if (how === 'row') showWorldRow(el); else if (how && !how.disabled) how.click(); }
    if (a.tagName === 'DETAILS' && !a.open && !a.querySelector(':scope > summary')?.contains(el)) a.open = true;
  }
}
function goTo(el, mark) {
  if (!el) return;
  reveal(el);
  const search = $('world-search');
  if (!shown(el) && el.closest('#pane-world') && search?.value) { search.value = ''; search.dispatchEvent(new Event('input', {bubbles: true})); reveal(el); }
  land(el, mark || el.closest(MARK) || el);
}
const layerRow = key => $('surface-layers')?.querySelector(`.surface-layer[data-key="${CSS.escape(key)}"]`);
// Land on an open layer row: its own control (inner) or its toggle. The Surface list draws itself again after an edit (when the world
// has rendered), so for a moment the landing follows the row's new copy, unless the focus has gone somewhere else meanwhile.
function landLayer(key, inner) {
  const at = () => { const li = layerRow(key), target = (inner && li?.querySelector(inner)) || li?.querySelector('.surface-toggle'); return [li, target, inner && target?.matches(inner) ? target.closest('label') || target : li]; };
  const [, target, mark] = at();
  land(target, mark);
  const list = $('surface-layers'), follow = new MutationObserver(() => {
    const [li, again, mark] = at(), lost = !document.activeElement || document.activeElement === document.body;
    if (!li || !lost) return;
    again?.focus({preventScroll: true}); if (!mark.classList.contains('find-flash')) flash(mark);
  });
  follow.observe(list, {childList: true}); setTimeout(() => follow.disconnect(), 1500);
}
function openLayer(key, inner) {
  const li = layerRow(key);
  if (!li) return;
  reveal(li);
  if (!li.classList.contains('open')) li.querySelector('.surface-toggle')?.click();
  landLayer(key, inner);
}
function addLayer(value) {
  const add = $('surface-add'), list = $('surface-layers');
  if (!add || add.disabled) return;
  const before = new Set([...list.querySelectorAll('.surface-layer')].map(li => li.dataset.key));
  reveal(add);
  add.value = value; add.dispatchEvent(new Event('change', {bubbles: true}));
  // The new layer opens on top of its group.
  const li = [...list.querySelectorAll('.surface-layer')].find(li => !before.has(li.dataset.key));
  if (li) landLayer(li.dataset.key); else land(add);
}
function pickFeature(button) {
  const tool = $('feature-tool');
  if (!tool || tool.disabled) return;
  if (tool.getAttribute('aria-pressed') !== 'true') tool.click();
  if (!shown(button)) [...document.querySelectorAll('.feature-modes button')].find(b => /place/i.test(b.textContent))?.click();
  button.click(); land(button);
}
function openMaterial(slot) {
  const open = $('materials-toolbar'), select = $('material-select');
  if (!open || open.disabled) return;
  open.click();
  if (select && select.value !== slot && [...select.options].some(o => o.value === slot)) { select.value = slot; select.dispatchEvent(new Event('change', {bubbles: true})); }
}

// ---- The box ----

const textField = el => el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
  (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'file'].includes(el.type)));
const LIMIT = 60;
// Returns close(): true when the box was open (the editor's Escape chain, sculpt-ui.js closeTop), and open().
export function mountFind() {
  const input = $('find-input'), list = $('find-results');
  if (!input || !list) return {close: () => false, open() {}};
  let entries = [], results = [], active = -1, back = null;
  const element = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };
  function setActive(i) {
    active = i;
    for (const o of list.querySelectorAll('[role=option]')) o.setAttribute('aria-selected', String(Number(o.dataset.index) === i));
    const current = list.querySelector(`[data-index="${i}"]`);
    if (current) { input.setAttribute('aria-activedescendant', current.id); bringIntoView(current, false); } else input.removeAttribute('aria-activedescendant');
  }
  function option(entry, i) {
    const o = element('div', 'find-option' + (entry.unavailable ? ' unavailable' : ''));
    o.id = 'find-option-' + i; o.dataset.index = String(i); o.setAttribute('role', 'option'); o.setAttribute('aria-selected', 'false');
    const name = element('span', 'find-name');
    if (entry.swatch) { const chip = element('span', 'find-swatch'); chip.style.background = entry.swatch; name.append(chip); }
    name.append(entry.name);
    o.append(name);
    if (entry.scope) o.append(element('span', `scope-tag ${entry.scope.variant}`, entry.scope.text));
    o.append(element('span', 'find-path', entry.path.join(' › ')));
    if (entry.unavailable) o.append(element('span', 'find-why', entry.reason || 'Unavailable now'));
    return o;
  }
  function render() {
    const query = input.value.trim();
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
    results = [];
    if (!query) { list.replaceChildren(element('p', 'find-hint', 'Settings, colors, layers, tools, materials and actions')); setActive(-1); return; }
    const groups = search(entries, query, LIMIT), out = [];
    for (const {group, items} of groups) {
      const g = element('div', 'find-group'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', group);
      const head = element('div', 'find-group-name', group); head.setAttribute('aria-hidden', 'true'); g.append(head);
      for (const entry of items) { g.append(option(entry, results.length)); results.push(entry); }
      out.push(g);
    }
    list.replaceChildren(...(out.length ? out : [element('p', 'find-hint', `Nothing found for “${query}”.`)]));
    setActive(results.length ? 0 : -1);
  }
  function hide() { list.hidden = true; list.replaceChildren(); input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); results = []; active = -1; }
  function go(entry) {
    back = null; hide(); input.value = ''; input.blur();
    try { entry.go(); } catch (err) { console.error(err); }
  }
  input.addEventListener('focus', () => { entries = collect(); render(); });
  input.addEventListener('input', render);
  input.addEventListener('blur', () => { if (!list.hidden) { hide(); input.value = ''; } });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (results.length) setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) go(results[active]); }
  });
  list.addEventListener('pointerdown', e => e.preventDefault());   // the focus stays in the box
  list.addEventListener('pointermove', e => { const o = e.target.closest('[role=option]'); if (o && Number(o.dataset.index) !== active) setActive(Number(o.dataset.index)); });
  list.addEventListener('click', e => { const o = e.target.closest('[role=option]'); if (o) go(results[Number(o.dataset.index)]); });
  function open() {
    if (document.activeElement !== input) { back = document.activeElement; input.focus(); }
    input.select();
  }
  // ⌘ / Ctrl K anywhere, and / outside a text field. A modal dialog (the material editor) keeps its keys.
  window.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.isComposing || document.querySelector('dialog:modal')) return;
    const command = e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
    const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !textField(e.target);
    if (!command && !slash) return;
    e.preventDefault(); open();
  });
  function close() {
    if (list.hidden && document.activeElement !== input) return false;
    const to = back; back = null; hide(); input.value = '';
    if (document.activeElement === input) { if (to?.isConnected && to !== document.body && !to.closest('[hidden]')) to.focus({preventScroll: true}); else input.blur(); }
    return true;
  }
  return {close, open};
}
