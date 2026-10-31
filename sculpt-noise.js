// H14e: the draw's noise texture, made at startup from numbers: 512 x 512 RGBA8, periodic in both axes, the same four channels the image
// file held (the engine reads them by name: r broad lobes, g mid grain, b ridged creases, a fine grain).
//   r  Gaussian-smoothed white noise, sigma 24 px      g  the same, sigma 7 px
//   b  minus the absolute value of two smoothed fields (sigma 3 weight .65, sigma 9 weight .35), so it is all creases
//   a  Gaussian-smoothed white noise, sigma 1 px
// Each channel is centred and scaled so its 99.5th percentile of |value| sits at .49 either side of .5 (clipped), as the image was.
// A different realisation of the same statistics: nothing reads it as a picture. Everything here is integer hashing and IEEE
// arithmetic (only the one-pixel kernel calls Math.exp, which the language does not pin bit for bit across engines), so it is the same
// bytes on one engine and machine, which is all the determinism rule asks. Large sigmas are three box passes (a close Gaussian); small ones are exact.
export const NOISE_SIZE = 512;

function white(size, seed, sum = 1) {
  // xorshift32 uniforms; one is enough under a wide smoothing, two (a triangle) under the narrowest.
  let s = Math.imul(seed, 2654435761) | 0 || 1;
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (let k = 0; k < sum; k++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; v += (s >>> 0) * (1 / 4294967296); }
    out[i] = v - sum * 0.5;
  }
  return out;
}

// One periodic pass over every line along x or y. A line is copied into `buf` with `pad` wrapped samples at each end, so the kernel
// runs on contiguous memory with no wrap arithmetic; `kernel(buf, out, pad, size)` writes the filtered line into out.
function pass(src, dst, size, vertical, pad, kernel) {
  const buf = new Float32Array(size + 2 * pad), out = new Float32Array(size);
  const lineStep = vertical ? 1 : size, along = vertical ? size : 1;
  for (let line = 0; line < size; line++) {
    const base = line * lineStep;
    for (let i = 0; i < size; i++) buf[pad + i] = src[base + i * along];
    for (let k = 0; k < pad; k++) { buf[k] = buf[k + size]; buf[pad + size + k] = buf[pad + k]; }
    kernel(buf, out, pad, size);
    for (let i = 0; i < size; i++) dst[base + i * along] = out[i];
  }
}

// A box of radius r by a running sum.
const boxKernel = r => (buf, out, pad, size) => {
  const norm = 1 / (2 * r + 1);
  let sum = 0;
  for (let k = -r; k <= r; k++) sum += buf[pad + k];
  for (let i = 0; i < size; i++) { out[i] = sum * norm; sum += buf[pad + i + r + 1] - buf[pad + i - r]; }
};
// Symmetric taps, centre first.
const tapKernel = taps => (buf, out, pad, size) => {
  const r = taps.length - 1;
  for (let i = 0; i < size; i++) {
    let sum = taps[0] * buf[pad + i];
    for (let k = 1; k <= r; k++) sum += taps[k] * (buf[pad + i - k] + buf[pad + i + k]);
    out[i] = sum;
  }
};

// Box radii whose three passes have the variance of a Gaussian of this sigma (the usual three-box recipe).
function boxRadii(sigma) {
  const ideal = Math.sqrt(12 * sigma * sigma / 3 + 1);
  let low = Math.floor(ideal); if (low % 2 === 0) low--;
  const m = Math.round((12 * sigma * sigma - 3 * low * low - 12 * low - 9) / (-4 * low - 4));
  return [0, 1, 2].map(i => ((i < m ? low : low + 2) - 1) / 2);
}

function smooth(field, size, sigma) {
  const a = field, b = new Float32Array(field.length);
  if (sigma < 2) {
    const r = Math.ceil(3 * sigma), taps = new Float64Array(r + 1);
    let total = 0;
    for (let k = 0; k <= r; k++) { taps[k] = Math.exp(-k * k / (2 * sigma * sigma)); total += k ? 2 * taps[k] : taps[k]; }
    for (let k = 0; k <= r; k++) taps[k] /= total;
    pass(a, b, size, false, r, tapKernel(taps)); pass(b, a, size, true, r, tapKernel(taps));
    return a;
  }
  for (const r of boxRadii(sigma)) { pass(a, b, size, false, r + 1, boxKernel(r)); pass(b, a, size, true, r + 1, boxKernel(r)); }
  return a;
}

// The channel as bytes: centred on its mean, scaled by the 99.5th percentile of |value| (a histogram, not a sort), 0.5 +- .49, rounded.
function normalise(field) {
  let mean = 0, low = Infinity, high = -Infinity;
  for (let i = 0; i < field.length; i++) { const v = field[i]; mean += v; if (v < low) low = v; if (v > high) high = v; }
  mean /= field.length;
  const top = Math.max(high - mean, mean - low), bins = 4096, hist = new Uint32Array(bins + 1);
  for (let i = 0; i < field.length; i++) hist[Math.min(bins, Math.floor(Math.abs(field[i] - mean) / top * bins))]++;
  let count = 0, edge = 0;
  const want = field.length * 0.995;
  for (; edge <= bins && (count += hist[edge]) < want; edge++);
  const k = 0.49 / Math.max((edge + 1) / bins * top, 1e-8), out = new Uint8Array(field.length);
  for (let i = 0; i < field.length; i++) { const v = 0.5 + (field[i] - mean) * k; out[i] = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255); }
  return out;
}

export function makeNoise(size = NOISE_SIZE) {
  const unit = field => { // scaled to a standard deviation of 1
    let s = 0;
    for (let i = 0; i < field.length; i++) s += field[i] * field[i];
    const k = 1 / Math.sqrt(s / field.length);
    for (let i = 0; i < field.length; i++) field[i] *= k;
    return field;
  };
  const broad = smooth(white(size, 11), size, 24);
  const mid = smooth(white(size, 12), size, 7);
  const fine = smooth(white(size, 14, 2), size, 1);
  const a = unit(smooth(white(size, 13), size, 3)), b = unit(smooth(white(size, 15), size, 9));
  const ridged = new Float32Array(size * size);
  for (let i = 0; i < ridged.length; i++) ridged[i] = -(0.65 * Math.abs(a[i]) + 0.35 * Math.abs(b[i]));
  const channels = [normalise(broad), normalise(mid), normalise(ridged), normalise(fine)];
  const rgba = new Uint8Array(size * size * 4);
  for (let c = 0; c < 4; c++) for (let i = 0; i < size * size; i++) rgba[i * 4 + c] = channels[c][i];
  return rgba;
}
