// Physics stress tests: full-power breaks must never let a ball escape the
// table, tunnel through a cushion, or overlap/tunnel through another ball.
import { Sim, ON_TABLE, DT } from '../src/core/physics.js';
import { rack8, rack9, mulberry32 } from '../src/core/rack.js';
import { R, HX, HY, MAX_SPEED, POCKETS, TABLE } from '../src/core/constants.js';

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log('  FAIL', msg);
};

// distance from a point to the closest cushion segment / nose point
function cushionClearance(x, y) {
  let best = Infinity;
  for (const s of TABLE.segments) {
    const t = Math.max(0, Math.min(s.len, (x - s.ax) * s.dx + (y - s.ay) * s.dy));
    const px = s.ax + s.dx * t;
    const py = s.ay + s.dy * t;
    best = Math.min(best, Math.hypot(x - px, y - py));
  }
  return best;
}

function insideBoundary(b) {
  // centre must be inside the cushion-nose rectangle (shrunk by R) unless the ball is in a pocket mouth
  if (Math.abs(b.x) <= HX - R + 1e-6 && Math.abs(b.y) <= HY - R + 1e-6) return true;
  for (const p of POCKETS) if (Math.hypot(b.x - p.x, b.y - p.y) < 0.2) return true;
  return false;
}

function stressBreak(seed, nine) {
  const rng = mulberry32(seed);
  const sim = new Sim();
  sim.setBalls(nine ? rack9(rng) : rack8(rng));
  const cue = sim.ball(0);
  cue.x = -HX / 2 - rng() * 0.3;
  cue.y = (rng() - 0.5) * 0.9;
  const apex = sim.balls.find((b) => b.n !== 0 && Math.abs(b.x - HX / 2) < 0.01);
  if (!apex) { fail(`seed ${seed}: no apex ball near the foot spot`); return { minPair: Infinity, minCushion: Infinity, pocketed: 0, time: 0 }; }
  const ang = Math.atan2(apex.y - cue.y, apex.x - cue.x) + (rng() - 0.5) * 0.02;
  sim.strike(0, {
    angle: ang,
    speed: MAX_SPEED,
    spinX: (rng() - 0.5) * 1.6,
    spinY: (rng() - 0.5) * 1.6,
    elevation: rng() < 0.2 ? rng() * 0.3 : 0,
  });
  let minPair = Infinity;
  let minCushion = Infinity;
  let steps = 0;
  while (sim.isMoving() && steps < 60 / DT) {
    sim.step();
    steps++;
    const on = sim.balls.filter((b) => b.state === ON_TABLE);
    for (let i = 0; i < on.length; i++) {
      const a = on[i];
      if (!insideBoundary(a)) fail(`seed ${seed}: ball ${a.n} outside the table at ${a.x.toFixed(3)},${a.y.toFixed(3)}`);
      minCushion = Math.min(minCushion, cushionClearance(a.x, a.y));
      for (let j = i + 1; j < on.length; j++) {
        const b = on[j];
        minPair = Math.min(minPair, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
      }
    }
  }
  if (sim.failsafe) fail(`seed ${seed}: failsafe triggered ${sim.failsafe} times`);
  if (sim.isMoving()) fail(`seed ${seed}: balls still moving after 60 s`);
  return { minPair, minCushion, pocketed: sim.balls.filter((b) => b.state !== ON_TABLE).length, time: sim.time };
}

const N = Number(process.argv[2] || 120);
const t0 = performance.now();
let worstPair = Infinity;
let worstCushion = Infinity;
let pots = 0;
for (let s = 1; s <= N; s++) {
  const r = stressBreak(s, s % 3 === 0);
  worstPair = Math.min(worstPair, r.minPair);
  worstCushion = Math.min(worstCushion, r.minCushion);
  pots += r.pocketed;
}
console.log(`full-power breaks: ${N}, avg balls pocketed ${(pots / N).toFixed(2)}`);
console.log(`closest ball-ball centre distance ${(worstPair * 1000).toFixed(3)} mm (2R = ${(2 * R * 1000).toFixed(3)} mm)`);
console.log(`closest ball-cushion distance ${(worstCushion * 1000).toFixed(3)} mm (R = ${(R * 1000).toFixed(3)} mm)`);
if (worstPair < 2 * R - 1e-5) fail('balls interpenetrated (tunnelling)');
if (worstCushion < R - 1e-5) fail('ball penetrated a cushion');

// --- extreme single-ball tests: point-blank power shots into cushions and jaws
for (let k = 0; k < 360; k += 3) {
  const sim = new Sim();
  sim.setBalls([{ n: 0, x: 0.3 * Math.cos(k), y: 0.2 * Math.sin(k) }]);
  sim.strike(0, { angle: (k * Math.PI) / 180, speed: MAX_SPEED * 1.5, spinX: 0.8, spinY: -0.8 });
  let steps = 0;
  while (sim.isMoving() && steps++ < 30 / DT) {
    sim.step();
    const b = sim.ball(0);
    if (b.state === ON_TABLE && !insideBoundary(b)) {
      fail(`angle ${k}: cue ball escaped`);
      break;
    }
    if (b.state === ON_TABLE && cushionClearance(b.x, b.y) < R - 1e-5) {
      fail(`angle ${k}: cue ball penetrated a cushion`);
      break;
    }
  }
  if (sim.failsafe) fail(`angle ${k}: failsafe triggered`);
}

// --- behaviour checks
function straight(spinY, speed = 2.5) {
  const sim = new Sim();
  sim.setBalls([
    { n: 0, x: -0.3, y: 0 },
    { n: 1, x: 0, y: 0 },
  ]);
  sim.strike(0, { angle: 0, speed, spinY });
  // stop as soon as the object ball touches a cushion so rebounds do not interfere
  while (sim.isMoving() && !sim.events.some((e) => e.type === 'cushion')) sim.step();
  return sim.ball(0).x;
}
const draw = straight(-1);
const stun = straight(-0.3);
const follow = straight(0.8);
console.log(`cue ball x after contact: draw ${draw.toFixed(3)}, stun ${stun.toFixed(3)}, follow ${follow.toFixed(3)} (object ball at 0)`);
if (!(draw < -0.35)) fail('draw shot should pull the cue ball back');
if (!(follow > 0.3)) fail('follow shot should push the cue ball through');
if (!(draw < stun && stun < follow)) fail('spin ordering wrong');

// ends only when every ball has stopped
{
  const sim = new Sim();
  sim.setBalls(rack8(mulberry32(3)));
  sim.strike(0, { angle: 0, speed: 8 });
  sim.run(60);
  const moving = sim.balls.filter((b) => b.state === ON_TABLE && (b.vx || b.vy || b.wx || b.wy || b.wz));
  if (moving.length) fail('balls left with residual motion after the shot ended');
}

console.log(`physics tests done in ${((performance.now() - t0) / 1000).toFixed(1)}s: ${failures ? failures + ' FAILURES' : 'ALL PASSED'}`);
if (failures) process.exitCode = 1;
