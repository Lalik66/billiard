import { LEVELS, evaluateLevelShot } from '../src/core/levels.js';
import { Sim, ON_TABLE } from '../src/core/physics.js';
import { analyzeShot } from '../src/core/rules.js';
import { planFreeShot } from '../src/core/ai.js';
import { inPlayArea, isFree } from '../src/core/rack.js';

const DEG = Math.PI / 180;
function trySingle(level, shot) {
  const sim = new Sim(); sim.setBalls(level.balls);
  sim.strike(0, shot); sim.run(30);
  const res = analyzeShot(sim.events);
  const cue = sim.ball(0);
  return evaluateLevelShot(level, res, new Set(), cue.state === ON_TABLE ? cue : null);
}

export function solveSingle(level, { full = false } = {}) {
  const speeds = level.jump ? [3, 4, 5, 6] : [1.2, 2, 2.6, 3, 3.4, 4.5, 6.5];
  const spins = level.jump ? [[0, 0]] : [[0, 0], [0, 0.8], [0, -1], [0, -0.6], [0, -0.8], [0.7, 0.3], [-0.7, 0.3]];
  const elevs = level.jump ? [40 * DEG, 50 * DEG] : [0];
  let found = null, count = 0, total = 0;
  for (let a = 0; a < 360; a += 0.25) {
    for (const sp of speeds) for (const [sx, sy] of spins) for (const el of elevs) {
      const shot = { angle: a * DEG, speed: sp, spinX: sx, spinY: sy, elevation: el };
      total++;
      const r = trySingle(level, shot);
      if (r.status === 'success') { count++; if (!found) found = shot; if (!full) return { found, count, total }; }
    }
  }
  return { found, count, total };
}

function validLayout(level) {
  const st = level.balls.map((b) => ({ ...b, state: ON_TABLE }));
  for (const b of st) {
    if (!inPlayArea(b.x, b.y)) return `ball ${b.n} outside play area`;
    if (!isFree(st, b.x, b.y, b.n, 0.0001)) return `ball ${b.n} overlaps`;
  }
  return null;
}

function solveClearance(level) {
  let layout = level.balls.map((b) => ({ ...b }));
  const potted = new Set();
  for (let shot = 1; shot <= level.max; shot++) {
    const plan = planFreeShot(layout, level.targets.filter((n) => !potted.has(n)), { lastBall: level.lastBall, seed: shot, budget: 500 });
    if (!plan) return { ok: false, shots: shot, why: 'no plan' };
    const sim = new Sim(); sim.setBalls(layout); sim.strike(0, plan.shot); sim.run(30);
    const res = analyzeShot(sim.events);
    const cue = sim.ball(0);
    const r = evaluateLevelShot(level, res, potted, cue.state === ON_TABLE ? cue : null);
    if (r.status === 'fail') return { ok: false, shots: shot, why: r.message };
    r.targetsNow.forEach((n) => potted.add(n));
    if (r.status === 'success') return { ok: true, shots: shot };
    layout = sim.balls.filter((b) => b.state === ON_TABLE).map((b) => ({ n: b.n, x: b.x, y: b.y }));
  }
  return { ok: false, shots: level.max, why: 'out of shots' };
}

const only = process.argv[2] != null ? Number(process.argv[2]) : null;
const full = process.argv[3] === 'full';
const EXPECTED_LEVELS = 12;
let allOk = true;
if (only === null && LEVELS.length !== EXPECTED_LEVELS) {
  console.log(`Expected ${EXPECTED_LEVELS} levels, found ${LEVELS.length}`);
  allOk = false;
}
for (const level of LEVELS) {
  if (only !== null && level.id !== only) continue;
  const t = performance.now();
  const bad = validLayout(level);
  if (bad) { console.log(level.id, level.name, 'INVALID LAYOUT', bad); allOk = false; continue; }
  if (level.resetOnMiss) {
    const r = solveSingle(level, { full });
    console.log(level.id, level.name, r.found ? 'SOLVED' : 'UNSOLVED', r.found ? JSON.stringify({ a: (r.found.angle / DEG).toFixed(2), v: r.found.speed, sx: r.found.spinX, sy: r.found.spinY, el: (r.found.elevation / DEG).toFixed(0) }) : '', full ? `${r.count}/${r.total}` : '', ((performance.now() - t) / 1000).toFixed(1) + 's');
    if (!r.found) allOk = false;
  } else {
    const r = solveClearance(level);
    console.log(level.id, level.name, r.ok ? 'SOLVED' : 'UNSOLVED', 'shots', r.shots, r.why || '', ((performance.now() - t) / 1000).toFixed(1) + 's');
    if (!r.ok) allOk = false;
  }
}
console.log(allOk ? 'ALL LEVELS OK' : 'SOME LEVELS FAILED');
if (!allOk) process.exitCode = 1;
