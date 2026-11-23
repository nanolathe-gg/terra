// The trailer's music (docs/TRAILER.md, "Music"): an original score synthesized here from plain oscillators, plucked strings (Karplus-Strong),
// filtered noise and a small reverb, so it needs no samples and no dependencies and comes out the same every time. It follows the cut:
// assemble-combined.sh passes each segment's style and length, and every section starts its pattern on its own cut.
//   node trailer/music.mjs <out.wav> --sections cartoon:11.8,take:24.5,worlds:4.54,game:10,game:8.8,end:6
// Styles: title, compare (sections vs Terra), slate, cartoon, take, worlds, game, end. Writes 48 kHz 16-bit stereo and prints its levels.
import {writeFileSync} from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const sections = opt('--sections', '').split(',').filter(Boolean).map(s => { const [style, d] = s.split(':'); return {style, dur: Number(d)}; });
const out = args[0];
if (!out || !sections.length || sections.some(s => !(s.dur > 0))) { console.error('usage: node trailer/music.mjs <out.wav> --sections style:seconds,...'); process.exit(2); }

const SR = 48000, TAU = Math.PI * 2, total = sections.reduce((a, s) => a + s.dur, 0), N = Math.ceil((total + 0.05) * SR);
const L = new Float32Array(N), R = new Float32Array(N), VL = new Float32Array(N), VR = new Float32Array(N);   // dry, and the reverb send
let state = 0x9e3779b9;
const rnd = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 2147483648 - 1; };
const hz = m => 440 * 2 ** ((m - 69) / 12);
const lp = fc => 1 - Math.exp(-TAU * fc / SR);   // one-pole low-pass coefficient
const pans = p => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];
// Write a mono voice into the mix: fn(tt, i) returns the sample at tt seconds into the voice.
function voice(t, len, pan, send, fn) {
  const [gl, gr] = pans(pan), i0 = Math.max(0, Math.round(t * SR)), n = Math.min(N - i0, Math.round(len * SR));
  for (let i = 0; i < n; i++) { const x = fn(i / SR, i); L[i0 + i] += x * gl; R[i0 + i] += x * gr; VL[i0 + i] += x * gl * send; VR[i0 + i] += x * gr * send; }
}

// ---------- instruments
// A warm pad: per note two detuned saws a side, low-passed, with a slow swell and release.
function pad(t, dur, notes, amp, {cutoff = 1200, cutoffTo = cutoff, attack = 0.8, release = 1.4, send = 0.5} = {}) {
  for (const m of notes) for (const [side, cents] of [[-0.6, -7], [0.6, 7], [-0.2, 3], [0.2, -3]]) {
    const f = hz(m) * 2 ** (cents / 1200); let ph = (rnd() + 1) / 2, y = 0, y2 = 0;
    voice(t, dur + release, side, send, tt => {
      ph += f / SR; ph -= Math.floor(ph);
      const a = lp(cutoff + (cutoffTo - cutoff) * Math.min(1, tt / Math.max(dur, 0.01)));
      y += a * ((2 * ph - 1) - y); y2 += a * (y - y2);
      const env = Math.min(1, tt / attack) * (tt > dur ? Math.max(0, 1 - (tt - dur) / release) : 1);
      return y2 * env * amp / notes.length;
    });
  }
}
// A plucked string (Karplus-Strong): pizzicato bass, arpeggios, sparkle.
function pluck(t, m, amp, pan = 0, {decay = 0.996, bright = 0.6, send = 0.3, len = 1.6} = {}) {
  const P = Math.max(2, Math.round(SR / hz(m))), buf = new Float32Array(P); let prev = 0;
  for (let k = 0; k < P; k++) { prev += bright * (rnd() - prev); buf[k] = prev; }
  let k = 0;
  voice(t, len, pan, send, tt => { const x = buf[k], nx = buf[(k + 1) % P]; buf[k] = decay * 0.5 * (x + nx); k = (k + 1) % P; return x * amp * Math.min(1, (len - tt) / 0.05); });
}
function bass(t, dur, m, amp) {
  const f = hz(m); let ph = 0, y = 0;
  voice(t, dur + 0.12, 0, 0.05, tt => { ph += f / SR; ph -= Math.floor(ph); y += lp(380) * ((2 * ph - 1) - y);
    const env = Math.min(1, tt / 0.008) * (0.7 + 0.3 * Math.exp(-tt * 9)) * (tt > dur ? Math.max(0, 1 - (tt - dur) / 0.12) : 1);
    return (Math.sin(TAU * ph) * 0.8 + y * 0.6) * env * amp; });
}
function kick(t, amp) { let ph = 0; voice(t, 0.5, 0, 0.05, tt => { ph += (44 + 80 * Math.exp(-tt * 28)) / SR; return Math.sin(TAU * ph) * Math.exp(-tt * 7) * amp; }); }
function snare(t, amp) { let p = 0, ph = 0; voice(t, 0.3, 0.05, 0.35, tt => { const n = rnd(), hpf = n - p; p = n; ph += 185 / SR; return (hpf * 0.7 * Math.exp(-tt * 16) + Math.sin(TAU * ph) * 0.5 * Math.exp(-tt * 30)) * amp; }); }
function hat(t, amp, pan = 0.3) { let p = 0; voice(t, 0.07, pan, 0.1, tt => { const n = rnd(), h = n - p; p = n; return h * Math.exp(-tt * 70) * amp; }); }
function crash(t, amp) { let p = 0; voice(t, 2.2, -0.1, 0.5, tt => { const n = rnd(), h = n - p; p = n; return h * Math.exp(-tt * 2.2) * amp; }); }
// A deep cinematic hit: a falling sine with a soft noise thump, sent to the reverb.
function boom(t, amp) { let ph = 0, y = 0; voice(t, 3, 0, 0.6, tt => { ph += (34 + 46 * Math.exp(-tt * 7)) / SR; y += lp(220) * (rnd() - y); return (Math.sin(TAU * ph) * Math.exp(-tt * 1.6) + y * 2.2 * Math.exp(-tt * 9)) * amp; }); }
// A rubber stamp on paper: a short woody thump.
function thud(t, amp) { let ph = 0, y = 0; voice(t, 0.25, 0, 0.15, tt => { ph += (95 * Math.exp(-tt * 6)) / SR; y += lp(900) * (rnd() - y); return (Math.sin(TAU * ph) * Math.exp(-tt * 22) + y * 1.4 * Math.exp(-tt * 45)) * amp; }); }
// A rising noise sweep into a cut.
function riser(t, dur, amp) { let y = 0, ph = 0; voice(t, dur, 0, 0.6, tt => { const k = tt / dur; y += lp(200 + 5800 * k * k) * (rnd() - y); ph += (220 + 660 * k * k) / SR; return (y * 1.6 + Math.sin(TAU * ph) * 0.08) * amp * k * k; }); }
// A slide trombone: a saw with vibrato under a low-pass (the deflated "it's all the same" moment).
function trombone(t, dur, m, amp, wobble = 0) {
  const f = hz(m); let ph = 0, y = 0;
  voice(t, dur + 0.1, -0.2, 0.3, tt => { const vib = 1 + (0.004 + wobble * Math.min(1, tt / dur)) * Math.sin(TAU * 5.5 * tt), bend = tt > dur * 0.6 && wobble ? 1 - 0.03 * (tt - dur * 0.6) / dur : 1;
    ph += f * vib * bend / SR; ph -= Math.floor(ph); y += lp(1100) * ((2 * ph - 1) - y);
    return y * Math.min(1, tt / 0.04) * (tt > dur ? Math.max(0, 1 - (tt - dur) / 0.1) : 1) * amp; });
}

// ---------- the score
const BEAT = 0.6, BAR = 4 * BEAT;   // 100 beats a minute, D minor
const PROG = [{pad: [50, 53, 57, 62], root: 38}, {pad: [46, 53, 58, 62], root: 34}, {pad: [45, 53, 57, 60], root: 41}, {pad: [48, 52, 55, 60], root: 36}];   // Dm Bb F C
// The main groove from t0 for dur seconds, its energy going from i0 to i1: pad, bass, arpeggio, then drums as it builds.
function groove(t0, dur, i0, i1) {
  const end = t0 + dur, at = t => i0 + (i1 - i0) * (t - t0) / dur;
  for (let b = 0; t0 + b * BAR < end - 0.05; b++) {
    const tb = t0 + b * BAR, c = PROG[b % 4], e = at(tb);
    pad(tb, Math.min(BAR, end - tb), c.pad, 0.11 * (0.7 + 0.3 * e), {cutoff: 500 + 1800 * e, attack: b ? 0.15 : 0.6, release: 0.5});
    for (let s = 0; s < 16; s++) {
      const t = tb + s * BEAT / 4; if (t >= end - 0.02) break;
      const k = at(t), beat = s % 4 === 0, eighth = s % 2 === 0;
      if (eighth && (k > 0.75 || beat)) bass(t, BEAT / 2 * 0.8, c.root, 0.16 + 0.06 * k);
      if (eighth && k > 0.15) pluck(t, c.pad[[1, 2, 3, 2, 1, 2, 3, 0][(s / 2) % 8]] + 12, 0.09 + 0.07 * k, ((s / 2) % 2 ? 0.4 : -0.4), {decay: 0.994, bright: 0.5 + 0.3 * k});
      if (beat && (s === 0 || s === 8 || k > 0.65) && k > 0.3) kick(t, 0.55 + 0.25 * k);
      if ((s === 4 || s === 12) && k > 0.6) snare(t, 0.22 + 0.12 * k);
      if ((eighth && k > 0.45) || (k > 0.88)) hat(t, (eighth ? 0.08 : 0.05) * k, s % 4 === 2 ? 0.35 : 0.2);
    }
  }
}
// A hit on every world cut of the quick "any world" montage (cuts.html sections cut: Green, Red 0.8 s, the other seven 0.42 s).
function worldHits(t0, limit) {
  const lengths = [0.8, 0.8, ...Array(7).fill(0.42)]; let t = t0;
  lengths.forEach((d, i) => { if (t < limit) { kick(t, 0.7); pluck(t, [62, 65, 69, 67, 65, 64, 62, 60, 62][i] + 12, 0.22, i % 2 ? 0.3 : -0.3, {decay: 0.995}); hat(t, 0.08); } t += d; });
}
const STYLES = {
  title(t0, dur) { pad(t0, dur, [38, 50, 57, 62], 0.12, {cutoff: 450, cutoffTo: 900, attack: 1.2}); boom(t0 + 0.15, 0.55); },
  slate(t0, dur) { pad(t0, dur, [50, 57, 62], 0.07, {cutoff: 700, attack: 0.3, release: 0.4}); riser(t0, dur, 0.22); },
  compare(t0, dur) {   // sections pasted, then Terra draws: quiet, then building; the any-world montage starts 18.3 s in
    groove(t0, Math.min(dur, 18.3), 0.25, 0.75);
    if (dur > 18.3) { groove(t0 + 18.3, dur - 18.3, 0.9, 0.95); worldHits(t0 + 18.3, t0 + dur); }
    riser(t0 + dur - 1.1, 1.1, 0.18);
  },
  cartoon(t0) {   // matched to cuts.html cartoonCut: stamps, the reveal, the sigh, the match cut, the render, the variants
    const stamps = [1.0, 1.75, 2.4, 2.95, 3.4, 3.8, 4.15], up = [65, 67, 69, 70, 72, 74, 77];
    for (let t = 0.2, n = 0; t < 4.7; t += 0.5, n++) { pluck(t0 + t, n % 2 ? 48 : 41, 0.32, -0.1, {decay: 0.99, bright: 0.45, len: 0.5}); pluck(t0 + t + 0.25, [65, 69, 72][n % 3], 0.12, 0.3, {decay: 0.985, len: 0.3}); }
    stamps.forEach((s, i) => { thud(t0 + s, 0.7); pluck(t0 + s + 0.02, up[i], 0.16, 0.2, {decay: 0.993}); });
    [[4.95, 55, 0.42], [5.45, 54, 0.42], [5.95, 53, 0.42], [6.45, 52, 0.9]].forEach(([t, m, d], i) => trombone(t0 + t, d, m, 0.16, i === 3 ? 0.012 : 0));
    riser(t0 + 7.0, 0.6, 0.22);
    boom(t0 + 7.6, 0.6); pad(t0 + 7.6, 4.0, [50, 57, 62, 64, 65], 0.12, {cutoff: 500, cutoffTo: 2200, attack: 0.5, release: 0.5});
    for (let t = 8.1, k = 0; t < 9.3; t += 0.15, k++) pluck(t0 + t, [62, 65, 69, 72, 74, 77, 81][k % 7], 0.08 + 0.01 * k, k % 2 ? 0.35 : -0.35);
    for (let t = 9.6, k = 0; t < 11.8; t += 4 / 30, k++) { pluck(t0 + t, [74, 77, 79, 81, 84, 86][Math.floor((rnd() + 1) * 3) % 6], 0.1, k % 2 ? 0.5 : -0.5, {decay: 0.992}); if (k % 4 === 0) kick(t0 + t, 0.35); }
    riser(t0 + 11.0, 0.8, 0.2);
  },
  take(t0, dur) { boom(t0, 0.35); groove(t0, dur, 0.35, 0.8); riser(t0 + dur - 1.2, 1.2, 0.18); },
  worlds(t0, dur) { groove(t0, dur, 0.9, 0.95); worldHits(t0, t0 + dur); },
  game(t0, dur, i) { boom(t0, 0.7); crash(t0, 0.12); groove(t0, dur, 1, 1); if (sections[i + 1]?.style !== 'game') riser(t0 + dur - 0.9, 0.9, 0.16); },
  end(t0, dur) {   // the TERRA card: a big hit, then Bb opening into D major, held to the end
    boom(t0, 0.8); crash(t0, 0.14);
    pad(t0, 1.3, [46, 53, 58, 62], 0.12, {cutoff: 1400, attack: 0.05, release: 0.6});
    pad(t0 + 1.2, dur - 1.2, [38, 50, 54, 57, 62, 66], 0.14, {cutoff: 900, cutoffTo: 2400, attack: 0.9, release: 1.5});
    bass(t0, 1.2, 34, 0.18); bass(t0 + 1.2, dur - 1.6, 38, 0.18);
    [62, 66, 69, 74, 78, 81].forEach((m, k) => pluck(t0 + 1.3 + k * 0.35, m, 0.1, k % 2 ? 0.4 : -0.4, {decay: 0.997, len: 2.5}));
  },
};
let t = 0;
sections.forEach((s, i) => { if (!STYLES[s.style]) throw new Error(`music: no style "${s.style}"`); STYLES[s.style](t, s.dur, i); t += s.dur; });

// ---------- reverb (Schroeder: four combs into two all-passes a side), master, fade, write
function reverb(input, offset) {
  const out = new Float32Array(N), combs = [1557, 1617, 1491, 1422].map(n => ({d: new Float32Array(n + offset), k: 0, y: 0})), alls = [556, 441].map(n => ({d: new Float32Array(n + offset), k: 0}));
  for (let i = 0; i < N; i++) {
    let s = 0; for (const c of combs) { const x = c.d[c.k]; c.y += 0.25 * (x - c.y); c.d[c.k] = input[i] + c.y * 0.86; c.k = (c.k + 1) % c.d.length; s += x; }
    for (const a of alls) { const x = a.d[a.k], y = -s + x; a.d[a.k] = s + x * 0.5; a.k = (a.k + 1) % a.d.length; s = y; }
    out[i] = s * 0.25;
  }
  return out;
}
const WL = reverb(VL, 0), WR = reverb(VR, 23);
let peak = 0;
const mix = new Float32Array(N * 2);
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, i / (SR * 0.05), (N - i) / (SR * 1.2));
  for (let c = 0; c < 2; c++) { const x = Math.tanh(((c ? R : L)[i] + (c ? WR : WL)[i] * 0.9) * 1.2) * fade; mix[i * 2 + c] = x; peak = Math.max(peak, Math.abs(x)); }
}
const gain = 0.89 / peak, pcm = Buffer.alloc(44 + N * 4);   // peak at -1 dBFS
let sum = 0;
for (let i = 0; i < N * 2; i++) { const x = mix[i] * gain; sum += x * x; pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x * 32767))), 44 + i * 2); }
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(N * 4, 40);
writeFileSync(out, pcm);
console.log(`music: ${out} (${(N / SR).toFixed(2)} s, ${sections.map(s => `${s.style} ${s.dur}`).join(' · ')}; rms ${(20 * Math.log10(Math.sqrt(sum / (N * 2)))).toFixed(1)} dBFS, peak -1 dBFS)`);
