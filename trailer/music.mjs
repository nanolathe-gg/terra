// The trailer's music (docs/TRAILER.md, "Music"): an original upbeat electro-pop score synthesized here from plain oscillators, plucked
// strings (Karplus-Strong), filtered noise, a sidechain pump, a ping-pong delay and a small reverb, so it needs no samples and no
// dependencies and comes out the same every time. It follows the cut: assemble-combined.sh passes each segment's style and length, and
// every section starts its pattern on its own cut.
//   node trailer/music.mjs <out.wav> --sections cartoon:11.8,take:24.5,worlds:4.54,game:10,game:8.8,end:6
// Styles: title, compare (sections vs Terra), slate, cartoon, take, worlds, game, end. Writes 48 kHz 16-bit stereo and prints its levels.
import {writeFileSync} from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const sections = opt('--sections', '').split(',').filter(Boolean).map(s => { const [style, d] = s.split(':'); return {style, dur: Number(d)}; });
const out = args[0];
if (!out || !sections.length || sections.some(s => !(s.dur > 0))) { console.error('usage: node trailer/music.mjs <out.wav> --sections style:seconds,...'); process.exit(2); }

const SR = 48000, TAU = Math.PI * 2, total = sections.reduce((a, s) => a + s.dur, 0), N = Math.ceil((total + 0.05) * SR);
// Buses: dry, pumped (ducked under every kick), and the reverb and delay sends.
const buf = () => new Float32Array(N);
const BUS = {dry: [buf(), buf()], pump: [buf(), buf()]}, REV = [buf(), buf()], DLY = buf();
const kicks = [];
let state = 0x9e3779b9;
const rnd = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 2147483648 - 1; };
const hz = m => 440 * 2 ** ((m - 69) / 12);
const lp = fc => 1 - Math.exp(-TAU * Math.min(fc, SR * 0.45) / SR);   // one-pole low-pass coefficient
const pans = p => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];
// Write a mono voice into a bus: fn(tt) returns the sample at tt seconds into the voice.
function voice(t, len, pan, fn, {bus = 'dry', rev = 0, dly = 0} = {}) {
  const [gl, gr] = pans(pan), [bl, br] = BUS[bus], i0 = Math.max(0, Math.round(t * SR)), n = Math.min(N - i0, Math.round(len * SR));
  for (let i = 0; i < n; i++) { const x = fn(i / SR), j = i0 + i; bl[j] += x * gl; br[j] += x * gr; if (rev) { REV[0][j] += x * gl * rev; REV[1][j] += x * gr * rev; } if (dly) DLY[j] += x * dly; }
}
const env = (tt, dur, a, r) => Math.min(1, tt / a) * (tt > dur ? Math.max(0, 1 - (tt - dur) / r) : 1);

// ---------- instruments
// Supersaw chords: seven detuned saws a note, spread across the stereo field, low-passed (cutoff may sweep), mud cut below 180 Hz.
function supersaw(t, dur, notes, amp, {cutoff = 2400, cutoffTo = cutoff, attack = 0.01, release = 0.18, bus = 'pump', rev = 0.25} = {}) {
  const det = [-21, -13, -6, 0, 6, 13, 21];
  for (const m of notes) det.forEach((c, v) => {
    const f = hz(m) * 2 ** (c / 1200); let ph = (rnd() + 1) / 2, y = 0, y2 = 0, h = 0;
    voice(t, dur + release, (v - 3) / 3.5, tt => {
      ph += f / SR; ph -= Math.floor(ph); const a = lp(cutoff + (cutoffTo - cutoff) * Math.min(1, tt / Math.max(dur, 0.01)));
      y += a * ((2 * ph - 1) - y); y2 += a * (y - y2); h += lp(180) * (y2 - h);
      return (y2 - h) * env(tt, dur, attack, release) * amp / (notes.length * 2.6);
    }, {bus, rev});
  });
}
// The pumping bass: saw and sub, low-passed, short.
function bass(t, dur, m, amp, {bus = 'pump'} = {}) {
  const f = hz(m); let ph = 0, y = 0;
  voice(t, dur + 0.04, 0, tt => { ph += f / SR; ph -= Math.floor(ph); y += lp(300 + 1400 * Math.exp(-tt * 14)) * ((2 * ph - 1) - y);
    return (Math.sin(TAU * ph) * 0.7 + y * 0.55) * env(tt, dur, 0.004, 0.04) * amp; }, {bus});
}
// The lead: two detuned saws and a square, a fast filter pluck, into the delay.
function lead(t, dur, m, amp, {pan = 0, dly = 0.32, rev = 0.18, bright = 1} = {}) {
  const f = hz(m); let a = 0, b = 0, c = 0, y = 0, y2 = 0;
  voice(t, dur + 0.25, pan, tt => { a += f * 1.004 / SR; b += f * 0.996 / SR; c += f / SR; a -= Math.floor(a); b -= Math.floor(b); c -= Math.floor(c);
    const x = (2 * a - 1) + (2 * b - 1) + (c < 0.5 ? 0.6 : -0.6), k = lp((2400 + 6000 * Math.exp(-tt * 9)) * bright);
    y += k * (x - y); y2 += k * (y - y2); return y2 * env(tt, dur, 0.003, 0.25) * (0.55 + 0.45 * Math.exp(-tt * 3)) * amp * 0.3; }, {rev, dly});
}
// A plucked string (Karplus-Strong): the cartoon's pizzicato and sparkle.
function pluck(t, m, amp, pan = 0, {decay = 0.996, bright = 0.6, rev = 0.3, len = 1.4} = {}) {
  const P = Math.max(2, Math.round(SR / hz(m))), b = new Float32Array(P); let prev = 0;
  for (let k = 0; k < P; k++) { prev += bright * (rnd() - prev); b[k] = prev; }
  let k = 0;
  voice(t, len, pan, tt => { const x = b[k], nx = b[(k + 1) % P]; b[k] = decay * 0.5 * (x + nx); k = (k + 1) % P; return x * amp * Math.min(1, (len - tt) / 0.05); }, {rev});
}
// A glassy bell for sparkle: sine partials with fast and slow decays.
function bell(t, m, amp, pan = 0) { const f = hz(m); voice(t, 1.8, pan, tt => (Math.sin(TAU * f * tt) + 0.4 * Math.sin(TAU * f * 2.76 * tt) * Math.exp(-tt * 6) + 0.2 * Math.sin(TAU * f * 5.4 * tt) * Math.exp(-tt * 12)) * Math.exp(-tt * 2.6) * amp * Math.min(1, tt / 0.002), {rev: 0.4, dly: 0.25}); }
function kick(t, amp, {duck = true} = {}) {
  if (duck) kicks.push(t);
  let ph = 0, p = 0; voice(t, 0.45, 0, tt => { ph += (48 + 130 * Math.exp(-tt * 38)) / SR; const n = rnd(), h = n - p; p = n;
    return (Math.tanh(Math.sin(TAU * ph) * 1.6) * Math.exp(-tt * 9) + h * 0.35 * Math.exp(-tt * 400)) * amp; });
}
// A clap: three noise bursts and a tail, band-passed round 1-2.5 kHz, over a short 190 Hz body.
function clap(t, amp) {
  let lo = 0, hi = 0, ph = 0;
  voice(t, 0.35, 0.05, tt => { const n = rnd(); hi += lp(2500) * (n - hi); lo += lp(1000) * (n - lo); ph += 190 / SR;
    const bursts = [0, 0.011, 0.022].reduce((s, o) => s + (tt >= o ? Math.exp(-(tt - o) * 130) : 0), 0) + 0.6 * Math.exp(-tt * 13) * (tt > 0.022 ? 1 : 0);
    return ((hi - lo) * bursts * 3 + Math.sin(TAU * ph) * 0.4 * Math.exp(-tt * 35)) * amp; }, {rev: 0.35});
}
// Hats: noise once differenced, then band-passed between 6 and 10 kHz (no fizz up at 20 kHz).
function hat(t, amp, {open = false, pan = 0.25} = {}) { let p = 0, a = 0, b = 0; voice(t, open ? 0.3 : 0.06, pan, tt => { const n = rnd(), h = n - p; p = n; a += lp(10000) * (h - a); b += lp(6000) * (h - b); return (a - b) * 2 * Math.exp(-tt * (open ? 11 : 75)) * amp; }, {rev: 0.08}); }
function crash(t, amp) { let p = 0; voice(t, 2.4, -0.15, tt => { const n = rnd(), h = n - p; p = n; return h * Math.exp(-tt * 1.9) * amp; }, {rev: 0.4}); }
function subDrop(t, amp) { let ph = 0; voice(t, 1.4, 0, tt => { ph += (30 + 60 * Math.exp(-tt * 2.5)) / SR; return Math.sin(TAU * ph) * Math.exp(-tt * 1.8) * Math.min(1, tt / 0.01) * amp; }); }
// A rising noise sweep into a drop, with a pitch rising under it.
function riser(t, dur, amp) { let y = 0, ph = 0; voice(t, dur, 0, tt => { const k = tt / dur; y += lp(300 + 9000 * k * k) * (rnd() - y); ph += (300 + 1500 * k * k) / SR; return (y * 1.5 + Math.sin(TAU * ph) * 0.1) * amp * k * k; }, {rev: 0.5}); }
// A snare roll speeding up from eighths to thirty-seconds, getting louder: the classic build.
function roll(t0, dur, amp) {
  for (let t = 0; t < dur - 0.02;) { const k = t / dur, step = k < 0.5 ? 0.25 : k < 0.75 ? 0.125 : 0.0625; clap(t0 + t, amp * (0.3 + 0.7 * k)); t += step; }
}
// A rubber stamp on paper: a short woody thump.
function thud(t, amp) { let ph = 0, y = 0, a = 0, b = 0; voice(t, 0.25, 0, tt => { ph += (95 * Math.exp(-tt * 6)) / SR; const n = rnd(); y += lp(900) * (n - y); a += lp(3000) * (n - a); b += lp(2000) * (n - b);
  return (Math.sin(TAU * ph) * Math.exp(-tt * 22) + y * 1.4 * Math.exp(-tt * 45) + (a - b) * 4 * Math.exp(-tt * 300)) * amp; }, {rev: 0.15}); }   // with a short paper click, heard on small speakers
// A slide trombone (the deflated "it's all the same" moment).
function trombone(t, dur, m, amp, wobble = 0) {
  const f = hz(m); let ph = 0, y = 0;
  voice(t, dur + 0.1, -0.2, tt => { const vib = 1 + (0.004 + wobble * Math.min(1, tt / dur)) * Math.sin(TAU * 5.5 * tt), bend = tt > dur * 0.6 && wobble ? 1 - 0.03 * (tt - dur * 0.6) / dur : 1;
    ph += f * vib * bend / SR; ph -= Math.floor(ph); y += lp(2200) * ((2 * ph - 1) - y);
    return y * env(tt, dur, 0.04, 0.1) * amp; }, {rev: 0.3});
}

// ---------- the score: A major, 120 beats a minute (15 video frames a beat), I-V-vi-IV
const BEAT = 0.5, BAR = 4 * BEAT, S16 = BEAT / 4;
const PROG = [{chord: [57, 61, 64, 69], root: 45}, {chord: [56, 59, 64, 68], root: 40}, {chord: [57, 61, 66, 69], root: 42}, {chord: [57, 62, 66, 69], root: 38}];   // A E F#m D
// The drops' open voicings, spread over two octaves.
const WIDE = [[57, 64, 69, 73, 76, 81], [52, 59, 64, 68, 71, 76], [54, 61, 66, 69, 73, 78], [50, 57, 62, 66, 69, 74]];
// The hook, a bar per chord: [sixteenth, note, length in sixteenths].
const HOOK = [
  [[0, 76, 2], [3, 73, 1], [4, 76, 2], [6, 78, 2], [8, 76, 3], [11, 73, 1], [12, 71, 2], [14, 69, 2]],
  [[0, 71, 2], [3, 68, 1], [4, 71, 2], [6, 73, 2], [8, 71, 3], [11, 68, 1], [12, 76, 4]],
  [[0, 73, 2], [3, 69, 1], [4, 73, 2], [6, 76, 2], [8, 78, 3], [11, 76, 1], [12, 73, 2], [14, 71, 2]],
  [[0, 69, 2], [2, 71, 2], [4, 73, 2], [6, 74, 2], [8, 76, 6], [14, 78, 2]]];
// Bars from t0 for dur seconds: fn(bar start, bar length, bar number), cut at the section's end.
function bars(t0, dur, fn) { for (let b = 0; t0 + b * BAR < t0 + dur - 0.05; b++) { const tb = t0 + b * BAR; fn(tb, Math.min(BAR, t0 + dur - tb), b); } }
// One bar of the groove; each part is switched on its own:
//   kick, clap, open (offbeat open hats), hats16, bass, bassDrive (octave sixteenths), arp, stabs (offbeat chords), pad (filtered
//   held chord), wide (the drop's pumping chord, with its cutoff), hook ('lead', 'pluck' or 'bell'), hookUp, hookAmp, lift (0..1),
//   rest (the bar's last beat without a kick: the breath before a new stage).
function grooveBar(tb, len, b, p) {
  const end = tb + len, c = PROG[b % 4];
  for (let s = 0; s < 16; s++) {
    const t = tb + s * S16; if (t >= end - 0.01) break;
    const beat = s % 4 === 0, off = s % 4 === 2;
    if (beat && p.kick && !(p.rest && s === 12)) kick(t, p.kick);
    if ((s === 4 || s === 12) && p.clap) clap(t, p.clap);
    if (off && p.open) hat(t, p.open, {open: true});
    if (p.hats16 && !beat) hat(t, p.hats16, {pan: s % 2 ? 0.35 : -0.35});
    if (off && p.bass) bass(t, S16 * 1.7, c.root + (s === 14 && b % 2 ? 12 : 0), p.bass);
    if (p.bassDrive && s % 2 === 1) bass(t, S16 * 0.8, c.root + 12, p.bassDrive);
    if (off && p.stabs) supersaw(t, S16 * 1.4, c.chord, p.stabs, {cutoff: 1600 + 2000 * (p.lift || 0), bus: 'dry', rev: 0.3});
    if (p.arp && s % 2 === 0) lead(t, S16 * 1.2, c.chord[[0, 1, 2, 3, 2, 1, 3, 2][(s / 2) % 8]] + 12, p.arp, {pan: (s / 2) % 2 ? 0.45 : -0.45, dly: 0.2, bright: 0.6});
  }
  if (p.pad) supersaw(tb, len, c.chord, p.pad, {cutoff: 500 + 600 * (p.lift || 0), cutoffTo: 900 + 1100 * (p.lift || 0), attack: 0.3, release: 0.3, bus: 'dry', rev: 0.5});
  if (p.wide) supersaw(tb, len - 0.02, WIDE[b % 4], 0.95, {cutoff: p.wide, attack: 0.005, release: 0.12});
  if (p.hook) for (const [s, m, l] of HOOK[b % 4]) {
    const t = tb + s * S16, n = m + (p.hookUp || 0); if (t >= end - 0.01) continue;
    if (p.hook === 'lead') { lead(t, l * S16 * 0.9, n, p.hookAmp); if (p.hookOctave) lead(t, l * S16 * 0.9, n + 12, p.hookAmp * 0.55, {pan: 0.2}); bell(t, n + 24, p.hookAmp * 0.12, -0.2); }
    else if (p.hook === 'pluck') pluck(t, n, p.hookAmp, 0.15, {decay: 0.994, bright: 0.8});
    else bell(t, n, p.hookAmp, 0.15);
  }
}
// A hit on every world cut of the "any world" montage (cuts.html sections cut): Green and Red two beats, then a beat a world, all on the grid.
function worldHits(t0, limit) {
  const lengths = [1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1]; let t = t0;
  lengths.forEach((d, i) => { if (t < limit - 0.05) { const c = PROG[i % 4]; kick(t, 0.6); supersaw(t, Math.min(d, 0.3), c.chord, 0.5, {cutoff: 2600, bus: 'dry'}); bell(t, c.chord[3] + 12, 0.16, i % 2 ? 0.4 : -0.4); hat(t + 0.25, 0.09, {open: true}); } t += d; });
}
// The take's whole bars, and what is left over after them (a breath before the drop).
const wholeBars = dur => Math.floor(dur / BAR + 1e-6);
const STYLES = {
  title(t0, dur) { bars(t0, dur, (tb, len, b) => grooveBar(tb, len, b, {pad: 0.55, lift: (tb - t0) / dur, kick: b % 2 ? 0 : 0.4})); riser(t0 + dur - 1, 1, 0.2); },
  slate(t0, dur) { roll(t0, dur, 0.3); riser(t0, dur, 0.25); },
  compare(t0, dur) {   // sections pasted (quiet), Terra draws (building), then the any-world montage from 18.3 s
    const a = Math.min(dur, 11.3), w = Math.min(dur, 18.3);
    bars(t0, a, (tb, len, b) => grooveBar(tb, len, b, {pad: 0.55, lift: (tb - t0) / a, kick: b % 2 ? 0 : 0.45}));
    if (dur > a) bars(t0 + a, w - a, (tb, len, b) => grooveBar(tb, len, b, {kick: 0.7, open: 0.11, bass: 0.2, arp: 0.3, clap: b >= 2 ? 0.3 : 0, stabs: 0.5, lift: (tb - t0 - a) / (w - a)}));
    if (dur > w) { worldHits(t0 + w, t0 + dur); supersaw(t0 + w, dur - w, PROG[3].chord, 0.4, {cutoff: 600, cutoffTo: 4500, attack: 0.2, release: 0.05, bus: 'dry', rev: 0.4}); }
  },
  cartoon(t0, dur) {   // matched to cuts.html cartoonCut: stamps, the reveal, the sigh, the match cut at 7.6 s, then eight beats to the cut
    const stamps = [1.0, 1.75, 2.4, 2.95, 3.4, 3.8, 4.15], up = [69, 71, 73, 74, 76, 78, 81];
    for (let t = 0.2, n = 0; t < 4.7; t += 0.5, n++) { pluck(t0 + t, n % 2 ? 64 : 57, 0.5, -0.1, {decay: 0.99, bright: 0.65, len: 0.5}); pluck(t0 + t + 0.25, [69, 73, 76][n % 3], 0.26, 0.3, {decay: 0.985, bright: 0.8, len: 0.3}); hat(t0 + t + 0.25, 0.07); }
    stamps.forEach((s, i) => { thud(t0 + s, 1.15); pluck(t0 + s + 0.02, up[i], 0.3, 0.2, {decay: 0.993, bright: 0.8}); });
    [[4.95, 55, 0.42], [5.45, 54, 0.42], [5.95, 53, 0.42], [6.45, 52, 0.9]].forEach(([t, m, d], i) => trombone(t0 + t, d, m, 0.26, i === 3 ? 0.012 : 0));
    riser(t0 + 6.9, 0.7, 0.25);
    crash(t0 + 7.6, 0.12); subDrop(t0 + 7.6, 0.5);
    supersaw(t0 + 7.6, dur - 7.6, PROG[0].chord, 0.55, {cutoff: 500, cutoffTo: 2600, attack: 0.4, release: 0.2, bus: 'dry', rev: 0.5});
    for (const [s, m, l] of HOOK[0]) if (s < 12) bell(t0 + 8.1 + s * S16, m, 0.2, s % 2 ? 0.3 : -0.3);   // a first taste of the hook as the render lands
    for (let t = 9.6, k = 0; t < dur - 0.05; t += S16, k++) if (k % 2 === 0 || k > 8) bell(t0 + t, [76, 78, 81, 83, 85, 88][Math.floor((rnd() + 1) * 3) % 6], 0.11, k % 2 ? 0.5 : -0.5);
    for (let t = 9.6; t < dur - 0.05; t += BEAT) { kick(t0 + t, 0.6, {duck: false}); hat(t0 + t + BEAT / 2, 0.08, {open: true}); }
    roll(t0 + dur - 1, 1, 0.25); riser(t0 + dur - 1, 1, 0.22);
  },
  take(t0, dur) {   // three four-bar stages from the first bar, a roll over the last whole bar, then a breath before the drop
    const n = wholeBars(dur), groove = n - 1;
    for (let b = 0; b < groove; b++) {
      const tb = t0 + b * BAR, stage = Math.min(2, Math.floor(b / 4)), lift = b / groove, rest = b % 4 === 3 && b < groove - 1;
      grooveBar(tb, BAR, b, [
        {kick: 0.7, bass: 0.2, arp: 0.28, lift, rest},
        {kick: 0.72, bass: 0.22, arp: 0.3, clap: 0.3, open: 0.11, stabs: 0.5, lift, rest},
        {kick: 0.75, bass: 0.24, arp: 0.25, clap: 0.32, open: 0.11, hats16: 0.04, stabs: 0.55, hook: 'pluck', hookAmp: 0.3, lift, rest},
      ][stage]);
    }
    const tr = t0 + groove * BAR;
    roll(tr, BAR, 0.32); riser(tr, dur - groove * BAR, 0.24);
    supersaw(tr, BAR, PROG[3].chord, 0.5, {cutoff: 800, cutoffTo: 4000, attack: 0.1, release: 0.3, bus: 'dry'});
  },
  worlds(t0, dur) { worldHits(t0, t0 + dur); supersaw(t0, dur, PROG[0].chord, 0.4, {cutoff: 700, cutoffTo: 2400, attack: 0.2, release: 0.1, bus: 'dry', rev: 0.4}); },
  game(t0, dur, i) {   // the first drop under the commander's arrival, lighter; the battle gets everything
    const battle = sections[i - 1]?.style === 'game';
    crash(t0, battle ? 0.2 : 0.14); subDrop(t0, battle ? 0.7 : 0.5);
    bars(t0, dur, (tb, len, b) => {
      if (battle) { grooveBar(tb, len, b, {kick: 0.85, clap: 0.34, open: 0.12, hats16: 0.05, bass: 0.3, bassDrive: 0.12, wide: 6500, hook: 'lead', hookAmp: 0.75, hookOctave: true}); if (b % 2 === 0 && b) crash(tb, 0.1); }
      else grooveBar(tb, len, b, {kick: 0.8, clap: 0.3, open: 0.11, bass: 0.28, wide: 3600, hook: 'bell', hookUp: 12, hookAmp: 0.3});
    });
    if (sections[i + 1]?.style !== 'game') riser(t0 + dur - 1, 1, 0.2);
  },
  end(t0, dur) {   // the TERRA card: one big A major hit ringing out, the hook's last bar on bells, a last A at 4 s
    crash(t0, 0.18); subDrop(t0, 0.7); kick(t0, 1, {duck: false});
    supersaw(t0, 0.6, WIDE[0], 1, {cutoff: 4000, cutoffTo: 1200, release: 5, bus: 'dry', rev: 0.6});
    bass(t0, 1.2, 33, 0.35, {bus: 'dry'});
    for (const [s, m] of HOOK[3]) bell(t0 + BEAT + s * S16, m + 12, 0.15, s % 4 ? 0.35 : -0.35);
    if (dur > 4.2) { bell(t0 + 4, 81, 0.18); bell(t0 + 4, 69, 0.12, -0.3); supersaw(t0 + 4, 0.4, [57, 64, 69], 0.4, {cutoff: 1800, release: 2, bus: 'dry', rev: 0.6}); }
  },
};
let t = 0;
sections.forEach((s, i) => { if (!STYLES[s.style]) throw new Error(`music: no style "${s.style}"`); STYLES[s.style](t, s.dur, i); t += s.dur; });

// ---------- effects and master
// The sidechain pump: the pumped bus dips under every kick and swells back over a quarter second.
const duck = new Float32Array(N).fill(1);
for (const k of kicks) { const i0 = Math.round(k * SR), n = Math.round(0.3 * SR); for (let i = 0; i < n && i0 + i < N; i++) { const g = 0.25 + 0.75 * Math.min(1, (i / SR / 0.26)) ** 1.6; duck[i0 + i] = Math.min(duck[i0 + i], g); } }
// Ping-pong delay, a dotted eighth, its repeats darkening.
const DL = buf(), DR = buf(), D = Math.round(BEAT * 0.75 * SR);
for (let i = D, yl = 0, yr = 0; i < N; i++) { yl += 0.5 * (DLY[i - D] + 0.42 * DR[i - D] - yl); DL[i] = yl; yr += 0.5 * (0.42 * DL[i - D] - yr); DR[i] = yr; }
// Reverb (Schroeder-Moorer: eight damped combs into two all-passes a side, after a 20 ms predelay).
function reverb(input, offset) {
  const o = buf(), pre = Math.round(0.02 * SR), combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(n => ({d: new Float32Array(Math.round(n * 1.088) + offset), k: 0, y: 0}));
  const alls = [556, 441].map(n => ({d: new Float32Array(Math.round(n * 1.088) + offset), k: 0}));
  for (let i = 0; i < N; i++) {
    const x0 = i >= pre ? input[i - pre] : 0;
    let s = 0; for (const c of combs) { const x = c.d[c.k]; c.y += 0.3 * (x - c.y); c.d[c.k] = x0 + c.y * 0.82; c.k = (c.k + 1) % c.d.length; s += x; }
    for (const a of alls) { const x = a.d[a.k], y = -s + x; a.d[a.k] = s + x * 0.5; a.k = (a.k + 1) % a.d.length; s = y; }
    o[i] = s * 0.125;
  }
  return o;
}
const WL = reverb(REV[0], 0), WR = reverb(REV[1], 23);
let peak = 0;
const mix = new Float32Array(N * 2);
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, i / (SR * 0.03), (N - i) / (SR * 1.0));
  for (let c = 0; c < 2; c++) {
    const x = BUS.dry[c][i] + (BUS.pump[c][i] + (c ? WR : WL)[i] * 0.8 + (c ? DR : DL)[i] * 0.7) * duck[i];   // the returns pump too
    const y = Math.tanh(x * 1.1) * fade; mix[i * 2 + c] = y; peak = Math.max(peak, Math.abs(y));
  }
}
const gain = 0.8 / peak, pcm = Buffer.alloc(44 + N * 4);   // sample peak at -1.9 dBFS, so the AAC's true peak stays under -1
let sum = 0;
for (let i = 0; i < N * 2; i++) { const x = mix[i] * gain; sum += x * x; pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x * 32767))), 44 + i * 2); }
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(N * 4, 40);
writeFileSync(out, pcm);
console.log(`music: ${out} (${(N / SR).toFixed(2)} s, ${sections.map(s => `${s.style} ${s.dur}`).join(' · ')}; rms ${(20 * Math.log10(Math.sqrt(sum / (N * 2)))).toFixed(1)} dBFS, peak -1.9 dBFS)`);
