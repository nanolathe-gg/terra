// The tan problem at 1x: the same hills in Archipelago's measured body tan and rock, against the colours
// docs/research/tx-tan.py finds near short palette segments (Knoll x0.4 over each colour's whole shading line):
// free within 0.02 OKLab, and within 0.035 with the hue held to 6 degrees and the chroma to 80%. A Green panel shows a
// colour the search helps a lot (grain 3.42 to 1.13 in the script). Materials by the lab's default albedo; the lab's
// own Knoll quantiser. Measure the renders with `python3 -I docs/research/tx-tan.py --png OUT/tx-tan--*.png`.

const WGSL = /* wgsl */`
fn heightAt(p: vec2f) -> f32 {
  let base = fbmBL(p, 140.0, 5, 0.5, labPx(), 0x1234u) * 46.0;
  let ridge = (1.0 - abs(fbmBL(p + vec2f(300.0, 80.0), 90.0, 3, 0.5, labPx(), 0x77u))) * 22.0;
  return base + ridge;
}
`;

const ARCH = {ground: [150, 128, 108], grass: [150, 128, 108], rock: [84, 74, 60]};
export default {
  title: 'tx: tans placed near short palette segments',
  about: 'Archipelago body tan and rock as measured, moved freely within 0.02 OKLab, and moved within 0.035 with the hue held; Green ground before and after.',
  world: 'archipelago',
  size: [256, 192],
  params: {},
  variants: [
    {label: 'measured', note: 'body [150,128,108], rock [84,74,60]', colours: ARCH},
    {label: 'free02', note: 'within 0.02: [138,132,117], [81,76,49]', colours: {ground: [138, 132, 117], grass: [138, 132, 117], rock: [81, 76, 49]}},
    {label: 'locked', note: 'hue held, within 0.035: [142,124,108], [84,72,52]', colours: {ground: [142, 124, 108], grass: [142, 124, 108], rock: [84, 72, 52]}},
    {label: 'green', note: 'Green ground [55,93,27]', colours: {ground: [55, 93, 27], grass: [55, 93, 27], rock: [85, 84, 79]}, lab: {world: 'green'}},
    {label: 'green-fit', note: 'Green ground [35,92,15], rock [79,80,80]', colours: {ground: [35, 92, 15], grass: [35, 92, 15], rock: [79, 80, 80]}, lab: {world: 'green'}},
  ],
  wgsl: WGSL,
};
