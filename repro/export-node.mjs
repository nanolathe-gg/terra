// The page's map exporter without a browser: sculpt-export-worker.js running export/ built for WebAssembly, in a Node context with an
// in-memory stand-in for the Origin Private File System's synchronous access handles. The export worker test and the headless export
// (repro/headless.mjs exportMap: measure/tilecount.mjs, repro/export-bytes.mjs) run the product's one exporter this way. Needs Go.
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
export const goRoot = () => execFileSync('go', ['env', 'GOROOT'], {cwd: root, encoding: 'utf8'}).trim();
// export/ for WebAssembly, as sculpt.py builds what the page loads (-trimpath -buildvcs=false -ldflags=-s -w), at `path`.
export function buildWasm(path) {
  execFileSync('go', ['build', '-trimpath', '-buildvcs=false', '-ldflags=-s -w', '-o', path, './export'], {cwd: root, env: {...process.env, GOOS: 'js', GOARCH: 'wasm'}});
  return path;
}

// The OPFS calls the worker makes, in memory: directories, files, one synchronous access handle per file at a time.
export function storage() {
  const file = name => ({name, data: new Uint8Array(0), size: 0, locked: false,
    async createSyncAccessHandle() {
      if (this.locked) throw Object.assign(new Error('locked'), {name: 'NoModificationAllowedError'});
      this.locked = true; const f = this;
      const grow = n => { if (n > f.data.length) { const d = new Uint8Array(Math.max(n, f.data.length * 2)); d.set(f.data.subarray(0, f.size)); f.data = d; } };
      return {read(view, {at = 0} = {}) { const n = Math.max(0, Math.min(view.length, f.size - at)); view.set(f.data.subarray(at, at + n)); return n; },
        write(view, {at = 0} = {}) { grow(at + view.length); f.data.set(view, at); f.size = Math.max(f.size, at + view.length); return view.length; },
        getSize: () => f.size, truncate(n) { grow(n); f.data.fill(0, Math.min(n, f.size), n); f.size = n; }, flush() {}, close() { f.locked = false; }};
    },
    async getFile() { return new File([this.data.slice(0, this.size)], this.name); }});
  const dir = () => ({entries: new Map(),
    async getDirectoryHandle(name, {create} = {}) { if (!this.entries.has(name) && create) this.entries.set(name, dir()); const d = this.entries.get(name); if (!d?.entries) throw Object.assign(new Error(name), {name: 'NotFoundError'}); return d; },
    async getFileHandle(name, {create} = {}) { if (!this.entries.has(name) && create) this.entries.set(name, file(name)); const f = this.entries.get(name); if (!f || f.entries) throw Object.assign(new Error(name), {name: 'NotFoundError'}); return f; },
    async removeEntry(name) { const e = this.entries.get(name); if (e?.locked) throw Object.assign(new Error(name), {name: 'NoModificationAllowedError'}); this.entries.delete(name); }});
  return dir();
}

// The worker, fed as sculpt-export.js feeds it: call(message) answers its one reply, and throws the worker's error reply.
export function exportWorker(wasm, top = storage(), go = goRoot()) {
  const replies = [], context = {navigator: {storage: {getDirectory: async () => top}}, FileSystemSyncAccessHandle: class {}, crypto: webcrypto, performance, TextEncoder, TextDecoder,
    console, setTimeout, clearTimeout, File,
    fetch: async () => ({ok: true, arrayBuffer: async () => wasm}), postMessage: message => replies.push(message)};
  context.self = context; vm.createContext(context);
  const support = ['lib', 'misc'].map(d => join(go, d, 'wasm')).find(d => existsSync(join(d, 'wasm_exec.js')));
  context.importScripts = name => vm.runInContext(readFileSync(join(support, name), 'utf8'), context);
  vm.runInContext(readFileSync(join(root, 'sculpt-export-worker.js'), 'utf8'), context);
  return async message => {
    const n = replies.length; await context.onmessage({data: message});
    if (replies.length !== n + 1) throw new Error(`the export worker answered ${replies.length - n} times to ${message.op}`);
    const reply = replies.at(-1); if (reply.type === 'error') throw new Error(reply.message);
    return reply;
  };
}
