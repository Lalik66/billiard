// Runs every test suite in sequence: node tests/run-all.mjs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const suites = [
  ['physics.test.mjs', ['120']],
  ['rules.test.mjs', []],
  ['levels.test.mjs', []],
  ['games.test.mjs', ['3']],
];
// Per-suite wall-clock cap so a hung simulation/AI can't block CI forever.
const SUITE_TIMEOUT_MS = Number(process.env.SUITE_TIMEOUT_MS) || 15 * 60 * 1000;
let failed = 0;
for (const [file, args] of suites) {
  console.log(`\n=== ${file} ===`);
  const r = spawnSync(process.execPath, [path.join(dir, file), ...args], { stdio: 'inherit', timeout: SUITE_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (r.error && r.error.code === 'ETIMEDOUT') {
    console.log(`\n${file} TIMED OUT after ${SUITE_TIMEOUT_MS} ms`);
    failed++;
  } else if (r.status !== 0 || r.signal) {
    failed++;
  }
}
console.log(failed ? `\n${failed} suite(s) FAILED` : '\nALL SUITES PASSED');
process.exit(failed ? 1 : 0);
