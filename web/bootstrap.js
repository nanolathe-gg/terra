// The only application JavaScript: start the Go WebAssembly program.
import '/web/wasm_exec.js';
const runtime = new Go();
try {
  const response = await fetch('/web/terraform.wasm');
  if (!response.ok) throw new Error(`Could not load the Go editor (${response.status}). Run ./run.sh first.`);
  const {instance} = await WebAssembly.instantiateStreaming(response, runtime.importObject);
  await runtime.run(instance);
} catch (error) {
  document.getElementById('error').hidden = false;
  document.getElementById('error').textContent = error.message;
  document.getElementById('status').textContent = 'The editor could not start.';
}
