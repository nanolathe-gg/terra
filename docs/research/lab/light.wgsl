// Terrain lab: the shared passes. The host pastes lib.wgsl, the bindings, the experiment's WGSL, then this file.
// heightMain evaluates the experiment over the window; lightMain lights it with a modern model (sun with a soft cast
// shadow, horizon-based occlusion, sky light) and, when lab.look.x is 1, quantises to the TA palette with dithering
// between the two nearest palette colours in Oklab. Everything reads world units, so a window renders the same scene
// at any lab.size.z (world px per output pixel).

fn labW() -> i32 { return i32(lab.size.x); }
fn labH() -> i32 { return i32(lab.size.y); }
fn labPx() -> f32 { return lab.size.z; }
fn labIter() -> u32 { return u32(lab.size.w); }
fn labSeed() -> u32 { return u32(lab.org.z); }
fn seaLevel() -> f32 { return lab.extra.x; }
fn worldOf(x: i32, y: i32) -> vec2f { return lab.org.xy + (vec2f(f32(x), f32(y)) + 0.5) * labPx(); }
fn idx(x: i32, y: i32) -> u32 { return u32(clamp(y, 0, labH() - 1) * labW() + clamp(x, 0, labW() - 1)); }
fn Hc(x: i32, y: i32) -> f32 { return H[idx(x, y)]; }
// Bilinear height at a world point (clamped to the window).
fn Hw(p: vec2f) -> f32 {
  let q = (p - lab.org.xy) / labPx() - 0.5;
  let i = vec2i(floor(q)); let f = fract(q);
  return mix(mix(Hc(i.x, i.y), Hc(i.x + 1, i.y), f.x), mix(Hc(i.x, i.y + 1), Hc(i.x + 1, i.y + 1), f.x), f.y);
}

@compute @workgroup_size(8, 8)
fn heightMain(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  let p = worldOf(x, y);
  let h = heightAt(p);
  H[idx(x, y)] = h;
  M[idx(x, y)] = matAt(p, h);
}

fn srgbToLin(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
fn linToSrgb(c: vec3f) -> vec3f { return pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2)); }
fn oklab(c: vec3f) -> vec3f {   // linear sRGB in, Oklab out
  let l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  let m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  let s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  let l_ = pow(max(l, 0.0), 1.0 / 3.0); let m_ = pow(max(m, 0.0), 1.0 / 3.0); let s_ = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3f(0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
               1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
               0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_);
}

// Default materials when the experiment has no albedoAt: plain, grass slope, rock by slope or by m.x, loose debris by
// m.y, sand by m.z; a little per-pixel grain so flat colour reads as ground. Water below the sea level.
fn albedoDefault(p: vec2f, h: f32, n: vec3f, m: vec4f) -> vec3f {
  let slope = length(n.xy) / max(n.z, 1e-3);
  var c = lab.cGround.rgb;
  c = mix(c, lab.cGrass.rgb, sstep(0.12, 0.35, slope));
  c = mix(c, lab.cRock.rgb, max(sstep(0.55, 1.1, slope), m.x));
  c = mix(c, lab.cLoose.rgb, m.y);
  c = mix(c, lab.cSand.rgb, m.z);
  let grit = 0.06 * hs(i32(floor(p.x)), i32(floor(p.y)), 0x51edu) + 0.05 * vnoise(p / 6.0, 0x77u);
  return c * (1.0 + grit);
}

// Soft cast shadow toward the sun, marched in world px over the height buffer (k sets the penumbra).
fn sunShadow(p: vec2f, h: f32, sdir: vec3f) -> f32 {
  if (lab.sun.w < 0.5) { return 1.0; }
  let d2 = normalize(sdir.xy); let tanE = sdir.z / length(sdir.xy);
  let zk = lab.org.w;
  var res = 1.0; var t = 1.0 * max(labPx(), 0.75);
  for (var i = 0; i < 64; i++) {
    let q = p + d2 * t;
    let ray = h * zk + t * tanE;
    let terr = Hw(q) * zk;
    res = min(res, 6.0 * (ray - terr) / t + 0.5);
    if (res <= 0.0) { break; }
    t += max(labPx(), 0.6 + t * 0.06);
    if (t > 260.0) { break; }
  }
  return clamp(res, 0.0, 1.0);
}

// Horizon-based occlusion: 8 directions, 5 radii from 2 to 40 world px; the share of the sky the horizon hides.
fn occlusion(p: vec2f, h: f32) -> f32 {
  if (lab.look.w < 0.5) { return 1.0; }
  let zk = lab.org.w;
  var occ = 0.0;
  for (var k = 0; k < 8; k++) {
    let a = f32(k) * 0.7853982 + 0.39;
    let d = vec2f(cos(a), sin(a));
    var mt = 0.0;
    var r = 2.0;
    for (var j = 0; j < 5; j++) {
      mt = max(mt, (Hw(p + d * r) - h) * zk / r);
      r *= 2.2;
    }
    occ += mt / sqrt(1.0 + mt * mt);    // sin of the horizon angle
  }
  return clamp(1.0 - occ / 8.0, 0.0, 1.0);
}

// Interleaved gradient noise (Jimenez): a cheap blue-ish threshold for ordered dithering, deterministic.
fn ign(x: i32, y: i32) -> f32 { return fract(52.9829189 * fract(0.06711056 * f32(x) + 0.00583715 * f32(y))); }


// The built-in light: sun with a soft cast shadow, sky light with horizon occlusion, a little bounce; water below the
// sea. Returns linear RGB before exposure. An experiment may define its own lightAt (same signature) and call this.
fn lightDefault(p: vec2f, h: f32, n: vec3f, m: vec4f, x: i32, y: i32) -> vec3f {
  let sdir = lab.sun.xyz;
  if (h < seaLevel()) {
    let depth = seaLevel() - h;
    let w = srgbToLin(mix(lab.cWater.rgb * 1.25, lab.cWater.rgb * 0.7, sstep(0.0, 40.0, depth)));
    return w * (0.9 + 0.1 * max(dot(n, sdir), 0.0));
  }
  let alb = srgbToLin(albedoAt(p, h, n, m));
  let sh = sunShadow(p, h, sdir);
  let ao = occlusion(p, h);
  let sun = srgbToLin(lab.cSun.rgb) * 2.2 * max(dot(n, sdir), 0.0) * sh;
  let sky = srgbToLin(lab.cSky.rgb) * 1.1 * (0.6 + 0.4 * n.z) * ao;
  let bounce = alb * 0.12 * (1.0 - n.z) * ao;
  return alb * (sun + sky) + bounce;
}

fn nearestPal(goal: vec3f) -> u32 {
  var b = 0u; var bd = 1e9;
  let np = u32(lab.extra.y);
  for (var i = 0u; i < np; i++) { let d = distance(PAL[i * 2u].xyz, goal); if (d < bd) { bd = d; b = i; } }
  return b;
}
// Quantise an sRGB colour to the TA palette. lab.look.y picks the dither: 0 nearest colour; 1 between the two nearest
// (cheap, but it cannot reach a colour the palette only makes as a mixture); 2 Knoll pattern dithering (8 candidates
// chosen by error accumulation in Oklab, sorted by lightness, one picked by the pixel's threshold), whose average over
// a few pixels matches the colour asked for. Every pixel is independent, so it parallelises and is deterministic.
fn paletteDither(c: vec3f, x: i32, y: i32) -> vec3f {
  let goal = oklab(srgbToLin(c));
  let mode = lab.look.y;
  if (mode < 0.5) { return PAL[nearestPal(goal) * 2u + 1u].xyz; }
  if (mode < 1.5) {
    var b1 = 0u; var b2 = 0u; var d1 = 1e9; var d2 = 1e9;
    let np = u32(lab.extra.y);
    for (var i = 0u; i < np; i++) {
      let d = distance(PAL[i * 2u].xyz, goal);
      if (d < d1) { d2 = d1; b2 = b1; d1 = d; b1 = i; } else if (d < d2) { d2 = d; b2 = i; }
    }
    let a = PAL[b1 * 2u].xyz; let b = PAL[b2 * 2u].xyz;
    let t = clamp(dot(goal - a, b - a) / max(dot(b - a, b - a), 1e-9), 0.0, 1.0);
    return PAL[select(b1, b2, ign(x, y) < t) * 2u + 1u].xyz;
  }
  var cand: array<u32, 8>;
  var err = vec3f(0.0);
  for (var k = 0; k < 8; k++) {
    let c = nearestPal(goal + err * 0.85);
    cand[k] = c;
    err += goal - PAL[c * 2u].xyz;
  }
  for (var i = 1; i < 8; i++) {           // insertion sort by Oklab lightness
    let v = cand[i]; var j = i - 1;
    loop { if (j < 0) { break; } if (PAL[cand[j] * 2u].x <= PAL[v * 2u].x) { break; } cand[j + 1] = cand[j]; j--; }
    cand[j + 1] = v;
  }
  // A 4 x 4 Bayer threshold: an even, ordered mixture that reads as grain at 1x (IGN would also do).
  let bayer = array<u32, 16>(0u, 8u, 2u, 10u, 12u, 4u, 14u, 6u, 3u, 11u, 1u, 9u, 15u, 7u, 13u, 5u);
  let t = bayer[u32(y & 3) * 4u + u32(x & 3)];
  return PAL[cand[t / 2u] * 2u + 1u].xyz;
}

@compute @workgroup_size(8, 8)
fn lightMain(@builtin(global_invocation_id) g: vec3u) {
  let x = i32(g.x); let y = i32(g.y);
  if (x >= labW() || y >= labH()) { return; }
  let p = worldOf(x, y);
  let h = Hc(x, y);
  let m = M[idx(x, y)];
  let px = labPx(); let zk = lab.org.w;
  let gx = (Hc(x + 1, y) - Hc(x - 1, y)) / (2.0 * px);
  let gy = (Hc(x, y + 1) - Hc(x, y - 1)) / (2.0 * px);
  let n = normalize(vec3f(-gx * zk, -gy * zk, 1.0));
  var col = lightAt(p, h, n, m, x, y);
  col *= lab.look.z;
  col = col / (1.0 + col * 0.25);                       // a gentle shoulder
  var outc = linToSrgb(col);
  if (lab.look.x > 0.5) { outc = paletteDither(outc, x, y); }
  let r = u32(clamp(outc.r, 0.0, 1.0) * 255.0 + 0.5); let gg = u32(clamp(outc.g, 0.0, 1.0) * 255.0 + 0.5); let bb = u32(clamp(outc.b, 0.0, 1.0) * 255.0 + 0.5);
  OUT[idx(x, y)] = r | (gg << 8u) | (bb << 16u) | (255u << 24u);
}
