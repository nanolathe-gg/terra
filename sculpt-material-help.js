const HELP = {
  warp: {
    amount: 'Sets how far the coordinates move before the next pattern samples them.',
    direction: 'Turns the direction of the push.',
    size: 'Sets the size of each bend or snap cell in the coordinate pattern.',
    layers: 'Adds larger bends on top of the detail-sized warp.',
    axis: 'Favors horizontal motion at one end and vertical motion at the other.',
  },
  noise: {
    size: 'Sets the typical width or spacing of the pattern in art pixels.',
    detail: 'Adds smaller features to the main noise pattern.',
    layers: 'Adds coarser patterns at progressively larger scales.',
    length: 'Sets the length of each wave streak.',
    direction: 'Turns the axis that the wave streaks follow.',
    crests: 'Concentrates wave highlights into sharper crests.',
    roughness: 'Sets how strongly the smaller ridge layers show.',
    sharpness: 'Makes the ridges narrower and more sharply defined.',
  },
  scatter: {
    spacing: 'Sets the distance between potential positions for scattered shapes.',
    radius: 'Sets the size of an individual shape before variation.',
    coverage: 'Sets how many of the potential positions receive a shape.',
    jitter: 'Moves the shapes farther from their regular positions.',
    hardness: 'Keeps more of each dot solid before it fades at the edge.',
    profile: 'Changes how quickly the shape falls away from its center.',
    sizeVariation: 'Makes individual shapes vary more in size.',
    toneVariation: 'Makes individual shapes vary more in brightness.',
    elongation: 'Narrows each shape into a streak.',
    direction: 'Turns the common axis of the streaks.',
    directionVariation: 'Lets each streak turn farther from the common direction.',
    rim: 'Hollows the middle of each shape into a bowl with a raised rim.',
    follow: 'Sets how strongly the connected Density pattern thins the scatter in dark areas.',
  },
  levels: {
    low: 'Maps this input value to black. Lower inputs also become black.',
    high: 'Maps this input value to white. Higher inputs also become white.',
    gamma: 'Changes the brightness of midtones while keeping the black and white endpoints.',
    bands: 'Folds the input range back and forth into repeated bands. One keeps a single progression.',
    steps: 'Sets how many flat levels Terracing creates.',
    terracing: 'Shapes the range into flat shelves with sharper changes between them.',
    invert: 'Blends the output toward its inverse, exchanging dark and light.',
  },
  combine: {
    amount: 'Sets the strength of the layer in the selected operation.',
    offset: 'Subtracts this value from the layer before combining it with the base.',
  },
  heightblend: {
    softness: 'Sets the width of the transition where the two heights are close.',
    bias: 'Moves the comparison in favor of the layer or the base.',
  },
  gradient: {ease: 'Softens the transition between adjacent color stops.'},
  adjust: {
    hue: 'Rotates the input colors around the hue wheel.',
    saturation: 'Increases or decreases the intensity of the input colors.',
    value: 'Makes the input colors darker or brighter.',
  },
  blur: {radius: 'Sets how many art pixels the smoothing or smear extends.', direction: 'Turns the axis of the directional smear.'},
  slopeblur: {distance: 'Sets the smear distance in art pixels. Positive follows the slope downhill and negative smears uphill.'},
  light: {direction: 'Turns the direction the simulated light comes from.', strength: 'Makes faces aimed toward or away from the light differ more in brightness.'},
  cavity: {radius: 'Sets the distance over which the node looks for a hollow or a crest.', strength: 'Deepens the contrast between the hollows and crests it finds.'},
  constant: {value: 'Sets the gray value returned at every point.'},
  output: {
    relief: 'Scales the connected Height pattern in art pixels so it catches light. Gameplay heights stay the same.',
    wornFrom: 'Sets the erosion level where the Worn color begins to appear.',
    wornAmount: 'Sets how much the Worn color replaces the base color in eroded areas.',
    depositFrom: 'Sets the sediment level where the Deposit color begins to appear.',
    depositAmount: 'Sets how much the Deposit color replaces the base color where sediment collects.',
  },
};
const COMMON = {
  seed: 'Changes the random arrangement while keeping the pattern’s other settings.',
  jitter: 'Moves each cell’s sample point farther from the center of its regular grid cell.',
  hex: 'Offsets every other row by half a cell to make a hexagonal arrangement.',
};

export const nodeParameterHelp = (type, key) => HELP[type]?.[key] ?? COMMON[key];

const INPUTS = {
  by: 'Connect a pattern to scale the warp. White moves the coordinates fully and black leaves them in place.',
  density: 'Connect a pattern that keeps scattered shapes in light areas and thins them in dark areas.',
  a: 'Connect the lower or base pattern.',
  b: 'Connect the upper pattern to lay over the base.',
  mask: 'Connect a pattern to apply the operation in light areas and fade it out in dark areas.',
  ha: 'Connect the height of the base. The higher surface wins the blend.',
  hb: 'Connect the height of the layer. The higher surface wins the blend.',
  slope: 'Connect a height pattern that sets the direction of the smear at each pixel.',
  color: 'Connect the ordinary color pattern for the material.',
  height: 'Connect the small-scale height pattern that catches terrain light.',
  shine: 'Connect a pattern that gives more shine to light areas and less to dark areas.',
  worn: 'Connect the color the ground shows where weathering removes its surface.',
  deposit: 'Connect the color the ground shows where weathering lays down sediment.',
};
export function nodeInputHelp(type, key, kind) {
  if (kind === 'coords') return 'Connect a Warp to move where this pattern samples. Plain coordinates read the material’s regular repeat.';
  if (key !== 'in') return INPUTS[key];
  return {
    levels: 'Connect the pattern whose dark and light values you want to remap.',
    gradient: 'Connect a gray pattern to look up a color between the gradient stops.',
    adjust: 'Connect the pattern whose colors you want to change.',
    blur: 'Connect the pattern you want to soften.',
    slopeblur: 'Connect the pattern you want to smear along the slope.',
    light: 'Connect a height pattern to shade its slopes from the chosen direction.',
    cavity: 'Connect a height pattern to find its hollows and crests.',
  }[type];
}
export const DITHER_HELP = {
  amount: 'Controls how strongly palette reduction spreads color error into neighboring pixels to preserve the original tone.',
  spread: 'Changes how far the error diffusion shares color error with nearby pixels.',
  tone: 'Changes how dark and light values are weighted when choosing the nearest palette entry.',
  red: 'Changes how much the red channel counts when comparing colors to the palette.',
  green: 'Changes how much the green channel counts when comparing colors to the palette.',
  blue: 'Changes how much the blue channel counts when comparing colors to the palette.',
};

const KINDS = {
  warp: {
    turbulence: 'Displaces coordinates with uneven bends in both directions.',
    flow: 'Swirls coordinates around local centers to make flowing, curved patterns.',
    push: 'Shifts coordinates along a single chosen direction.',
    snap: 'Samples the same point throughout each cell, so the pattern is flat within that cell.',
  },
  noise: {
    smooth: 'Interpolates random values into smooth patches.',
    gradient: 'Uses a Perlin gradient field for a smooth, irregular pattern.',
    billow: 'Folds the noise into rounded billows.',
    cells: 'Makes a cell pattern with light centers and dark edges.',
    cracks: 'Traces the borders of irregular cells as a dark fracture network.',
    facets: 'Gives each irregular cell its own flat brightness.',
    waves: 'Draws directional streaks and ripples.',
    ridged: 'Draws narrow connected ridges with layered detail.',
    pixel: 'Picks a separate random value at each art pixel.',
  },
  combine: {
    mix: 'Blends from the base to the layer.',
    add: 'Adds the layer to the base to make higher values or lighter colors.',
    multiply: 'Multiplies the base by the layer. Values below 1 darken and values above 1 lighten.',
    subtract: 'Subtracts the layer from the base to lower its values.',
    min: 'Keeps the darker of the base and layer values.',
    max: 'Keeps the lighter of the base and layer values.',
    screen: 'Lightens the base while preserving more headroom in bright areas than Add.',
  },
  blur: {gaussian: 'Softens the pattern in all directions.', directional: 'Smears the pattern along one chosen axis.'},
  constant: {gray: 'Outputs one gray value everywhere.', color: 'Outputs one color everywhere.'},
};
export const nodeKindHelp = (type, kind) => KINDS[type]?.[kind];
