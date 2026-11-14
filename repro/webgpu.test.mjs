// The browser check before the editor loads (sculpt-webgpu.js): a software adapter is refused with a plain message, a hardware one passes.
import assert from 'node:assert/strict';
import test from 'node:test';

const {requestAdapter} = await import('../sculpt-webgpu.js');
const limits = {maxSampledTexturesPerShaderStage: 16, maxTextureArrayLayers: 256, maxTextureDimension2D: 8192, maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728};

function offer(adapter) {
  Object.defineProperty(globalThis, 'navigator', {value: {gpu: {requestAdapter: async () => adapter}}, configurable: true});
  globalThis.window = {isSecureContext: true};
}

test('a hardware adapter passes', async () => {
  const adapter = {limits, info: {isFallbackAdapter: false, architecture: 'ada'}};
  offer(adapter);
  assert.equal(await requestAdapter(), adapter);
});

test('a software adapter is refused with a message', async () => {
  offer({limits, info: {isFallbackAdapter: true, architecture: 'swiftshader'}});
  await assert.rejects(requestAdapter(), /only software WebGPU rendering/);
});

test('an adapter without info passes on its limits', async () => {
  const adapter = {limits};
  offer(adapter);
  assert.equal(await requestAdapter(), adapter);
});
