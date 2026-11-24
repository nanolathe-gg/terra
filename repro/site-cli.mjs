// Shared entry point for the Go site/config tool. No build runs merely by importing this module.
import {execFileSync} from 'node:child_process';
const root = new URL('..', import.meta.url).pathname;
export function runSite(args, options = {}) {
  return execFileSync('go', ['run', './cmd/terra', ...args], {cwd: root, encoding: 'utf8', ...options});
}
