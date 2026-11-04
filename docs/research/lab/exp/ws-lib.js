// ws-lib: the water model the ws- experiments share (a helper module; it cannot run on its own).
//
// One function draws water anywhere: wsWater() takes the depth, the bed's albedo and normal, and three looks (clarity,
// murk, wind) and returns linear radiance. It is physically shaped but cheap, and every term is a pure function of
// world position, so a region replays to the same bytes:
//   1. Under the surface: the bed lit by sun and sky through the water column, Beer-Lambert per channel (red goes first,
//      so shallow water over sand turns green-teal before it turns blue), plus single-scattered body colour that rises
//      as 1 - T. Murk shortens the column and moves the body colour toward suspended silt (olive brown).
//   2. Caustics: a Voronoi edge network on the bed, displaced by the wave field, bright where it focuses; it fades with
//      depth and with murk.
//   3. The surface: wind waves whose crests run across the wind (band-limited gradient noise in a wind frame), and
//      slicks, long thin calm streaks along the wind (Langmuir streaks), where the waves die. Schlick Fresnel on the
//      wave normal reflects a sky that brightens toward the horizon and the sun (exaggerated a little so it reads at 1x).
//   4. Glint: discrete sparkles. Each art pixel holds one hashed facet that lights if its hash falls under a Beckmann
//      lobe evaluated at the wave normal and the half vector between the sun and the overhead eye. The density follows
//      the waves, so glint gathers on wave flanks that face the sun and is absent on slicks (stochastic-glitter idea of
//      Jakob et al. 2014, our own code).
// Own code from the published ideas (Beer-Lambert, Schlick 1994, Beckmann 1963, Langmuir 1938 streaks).

export const WS_WATER_PARAMS = {clarity: 14, murk: 0.15, wind: 0.5, glint: 1, caustic: 0.6, windAng: 0.35};

export const WS_WATER = /* wgsl */`
// Wind waves: crests across the wind. Returns (height, d/dx, d/dy) in px with slopes about +-1 at wind 1.
fn wsWaves(p: vec2f, wdir: vec2f, lam0: f32, s: u32) -> vec3f {
  let perp = vec2f(-wdir.y, wdir.x);
  var sum = vec3f(0.0); var lam = lam0; var a = 0.16;
  for (var o = 0; o < 3; o++) {
    let keep = 1.0 - sstep(0.25, 0.5, labPx() / lam);
    if (keep <= 0.0) { break; }
    let q = vec2f(dot(p, wdir) / lam, dot(p, perp) / (lam * 1.7));
    let n = gnoised(q + vec2f(f32(o) * 7.3, 0.0), s + u32(o) * 977u);
    let g = n.y * wdir / lam + n.z * perp / (lam * 1.7);
    sum += keep * a * vec3f(n.x * lam, g * lam);
    lam *= 0.5; a *= 0.85;
  }
  return sum;
}
// Slicks: thin calm streaks along the wind, 0 rough water .. 1 calm.
fn wsSlick(p: vec2f, wdir: vec2f) -> f32 {
  let perp = vec2f(-wdir.y, wdir.x);
  let q = vec2f(dot(p, wdir) / 260.0, dot(p, perp) / 21.0);
  let r = 1.0 - abs(gnoised(q, 0x51c4u).x + 0.35 * gnoised(q * 2.3 + 4.1, 0x51c5u).x);
  return sstep(0.80, 0.93, r);
}
fn wsSunLin() -> vec3f { return srgbToLin(lab.cSun.rgb); }
fn wsSkyLin() -> vec3f { return srgbToLin(lab.cSky.rgb); }
// The light a flat white-ish thing (foam, a reed tip) gets at p: sun with the cast shadow, sky with occlusion.
fn wsFlatLight(p: vec2f, h: f32) -> vec3f {
  let sdir = lab.sun.xyz;
  return wsSunLin() * 2.2 * max(sdir.z, 0.0) * sunShadow(p, h, sdir) + wsSkyLin() * 1.1;
}
// Caustic brightness on the bed (1 = none).
fn wsCaustic(p: vec2f, depth: f32, disp: vec2f, amount: f32, clarity: f32) -> f32 {
  if (amount <= 0.0 || labPx() > 2.0) { return 1.0; }
  let e = voronoiEdge(p + disp * 3.0, 9.0, 0.95, 0xca05u);
  let line = 1.0 - sstep(0.0, 1.3 * max(labPx(), 0.7), e);
  return 1.0 + amount * line * sstep(0.4, 2.0, depth) * exp(-depth / max(0.9 * clarity, 0.5));
}
// The water at p. depth in height units (> 0), bedAlb sRGB 0..1, bedN the bed normal, bedSh the bed's sun shadow.
// clarity: attenuation length of the clearest channel (height units); murk 0..1; wind 0..1; glint, caustic 0..1.
// Returns (linear radiance, and in .w the glint coverage, so a caller can keep it out of foam).
fn wsWater(p: vec2f, depth: f32, bedAlb: vec3f, bedN: vec3f, bedSh: f32, clarity: f32, murk: f32, wind: f32, glint: f32, caustic: f32, windAng: f32) -> vec4f {
  let sdir = lab.sun.xyz;
  let wdir = vec2f(cos(windAng), sin(windAng));
  // Surface.
  let calm = wsSlick(p, wdir) * sstep(0.05, 0.3, wind);
  let wv = wsWaves(p, wdir, 9.0, 0x3a7u);
  let steep = wind * (1.0 - 0.85 * calm) * sstep(0.0, 1.5, depth);   // the film at the very edge is calm
  let n = normalize(vec3f(-wv.yz * steep, 1.0));
  // Under the surface.
  let L = max(clarity * mix(1.0, 0.18, murk), 0.3) * mix(vec3f(0.30, 0.80, 1.0), vec3f(0.55, 0.75, 0.50), murk);
  let T1 = exp(-vec3f(depth) / L);
  let T2 = T1 * T1;
  let sunE = wsSunLin() * 2.2;
  let skyE = wsSkyLin() * 1.1;
  let caus = wsCaustic(p, depth, wv.yz * steep, caustic * (1.0 - murk), clarity);
  let bed = srgbToLin(bedAlb) * (sunE * max(dot(bedN, sdir), 0.0) * bedSh * caus + skyE) * T2;
  let bodyS = mix(lab.cWater.rgb, vec3f(0.22, 0.31, 0.12), murk);
  let body = srgbToLin(bodyS) * (sunE * max(sdir.z, 0.0) + skyE) * 0.5 * (vec3f(1.0) - T1);
  // Reflection of the sky (Schlick, exaggerated 3x so ripples read as grain at 1x).
  let F = min(2.0 * (0.02 + 0.98 * pow(1.0 - n.z, 5.0)), 0.5);
  let r = reflect(vec3f(0.0, 0.0, -1.0), n);
  let sky = skyE * (0.75 + 1.2 * (1.0 - r.z)) + sunE * 0.6 * pow(max(dot(r, sdir), 0.0), 8.0);
  var col = (bed + body) * (1.0 - F) + F * sky;
  // Glint.
  var gl = 0.0;
  if (glint > 0.0 && depth > 0.3) {
    let hv = normalize(sdir + vec3f(0.0, 0.0, 1.0));
    let c = max(dot(n, hv), 1e-3);
    let t2 = (1.0 - c * c) / (c * c);
    let rough = 0.16;
    let D = exp(-t2 / (rough * rough));
    let cell = vec2i(floor(p / max(labPx(), 1.0)));
    gl = select(0.0, 1.0, h01(cell.x, cell.y, 0x6c1du) < D * glint * 0.4) * (1.0 - calm);
    col = mix(col, sunE * 0.55, gl);
  }
  return vec4f(col, gl);
}
`;
