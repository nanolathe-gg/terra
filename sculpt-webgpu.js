// What the editor needs of the browser, checked before anything loads so a missing piece is said plainly.
// The device is requested with WebGPU's default limits, which every conforming adapter offers; the draw reads 16 sampled textures a stage,
// the mask planes need array layers, and the chunk renderer sizes its tiles by the largest 2D texture.
export const WEBGPU_NEEDS = 'This terrain editor needs WebGPU: current Chrome or Edge, Safari 26, or Firefox with WebGPU.';
const LIMITS = {maxSampledTexturesPerShaderStage: 16, maxTextureArrayLayers: 256, maxTextureDimension2D: 8192, maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728};

// The adapter, or an Error saying what is missing.
export async function requestAdapter() {
  if (!navigator.gpu) throw new Error(WEBGPU_NEEDS + ' This browser does not offer it' + (window.isSecureContext ? '.' : ' on an insecure page; open it from localhost or https.'));
  // A freshly started Chrome on Linux answers null while its GPU process starts (measured: null at 0 and 50 ms after the page began, the
  // hardware adapter from 200 ms on), so a null is asked again for two seconds before it is reported.
  let adapter = await navigator.gpu.requestAdapter();
  for (let i = 0; !adapter && i < 10; i++) { await new Promise(r => setTimeout(r, 200)); adapter = await navigator.gpu.requestAdapter(); }
  if (!adapter) throw new Error(WEBGPU_NEEDS + ' No WebGPU adapter is available (is hardware acceleration off?).');
  // A software adapter (Chrome's SwiftShader) runs the engine on the CPU: the page never finishes loading. Chrome also falls back to it after its
  // GPU process crashes, while WebGL elsewhere still uses the graphics card, so say how to get the hardware adapter back.
  if (adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter) {
    const name = adapter.info?.architecture || adapter.info?.vendor;
    throw new Error(`Software rendering detected: WebGPU is running on the CPU${name ? ` (${name})` : ''} instead of your graphics card, ` +
      'so the editor would be far too slow to use.\nTo fix it, turn on hardware acceleration in your browser settings. If it is already on, the ' +
      'browser probably switched to software after a graphics crash: quit the browser completely and open it again.');
  }
  const short = Object.entries(LIMITS).filter(([name, need]) => !(adapter.limits[name] >= need)).map(([name, need]) => `${name} ${adapter.limits[name] ?? 'unknown'} (needs ${need})`);
  if (short.length) throw new Error(WEBGPU_NEEDS + ' This graphics adapter is below what the editor requests: ' + short.join(', ') + '.');
  return adapter;
}
