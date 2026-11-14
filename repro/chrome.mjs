// The Chrome binary and GPU flags every browser check launches, on macOS and Linux. CHROME overrides the binary.
// Linux's headless Chrome finds no hardware WebGPU adapter without Vulkan and ANGLE on Vulkan: it falls back to SwiftShader,
// which the editor refuses. macOS keeps Metal.
import {existsSync} from 'node:fs';

const candidates = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  linux: ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
}[process.platform] ?? [];

export const chromePath = process.env.CHROME || candidates.find(existsSync) || candidates[0] || 'chrome';
export const chromeGpuFlags = process.platform === 'darwin' ? ['--enable-gpu', '--use-angle=metal']
  : ['--enable-gpu', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan'];
