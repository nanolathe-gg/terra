// A Chrome left running keeps its CDP port on 127.0.0.1 and a new one binds only ::1, so a tool would drive the old browser unnoticed. Refuse.
import {connect} from 'node:net';
const held = port => new Promise(done => { const s = connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); done(true); }); s.once('error', () => done(false)); });
export async function cdpPortFree(port) {
  for (let i = 0; i < 50; i++) { if (!await held(port)) return; await new Promise(r => setTimeout(r, 100)); }   // the last run's Chrome may still be exiting
  console.error(`repro: CDP port ${port} is held by another process; stop it or pick another --port`);
  process.exit(1);
}
