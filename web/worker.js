// Browser platform bootstrap only. Scheduling and rendering live in Go.
importScripts('/web/wasm_exec.js');
const runtime = new Go();
WebAssembly.instantiateStreaming(fetch('/web/renderworker.wasm'), runtime.importObject)
  .then(({instance}) => runtime.run(instance))
  .catch(error => postMessage({kind:'error', error:error.message}));
