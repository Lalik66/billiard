// AI shot planner. Pure logic: geometric candidate generation, then verification
// and position play by running the real physics engine on a copy of the table.
import { R, HX, HY, POCKETS, HEAD_STRING_X, FOOT_SPOT, MAX_SPEED } from './constants.js';
import { Sim, ON_TABLE } from './physics.js';
import { Match, analyzeShot } from './rules.js';
import { mulberry32, validCuePlacement } from './rack.js';

const DEG = Math.PI / 180;

export const DIFFICULTY = {
  easy: {
    k: 3,
    aimNoise: 1.5 * DEG,
    speedNoise: 0.12,
    position: 0,
    spins: [[0, 0]],
    speeds: [1.0, 1.5],
    safety: false,
    randomPick: 0.35,
    robust: 0,
    maxCut: 62 * DEG,
  },
  medium: {
    k: 6,
    aimNoise: 0.55 * DEG,
    speedNoise: 0.05,
    position: 0.5,
    spins: [
      [0, 0],
      [0, 0.45],
      [0, -0.6],
    ],
    speeds: [0.9, 1.3, 1.8],
    safety: true,
    randomPick: 0,
    robust: 0,
    maxCut: 72 * DEG,
  },
  hard: {
    k: 10,
    aimNoise: 0.12 * DEG,
    speedNoise: 0.02,
    position: 1,
    spins: [
      [0, 0],
      [0, 0.5],
      [0, -0.75],
      [0.45, 0.2],
      [-0.45, 0.2],
    ],
    speeds: [0.85, 1.2, 1.6, 2.2],
    safety: true,
    randomPick: 0,
    robust: 3,
  },
  pro: {
    k: 12,
    aimNoise: 0.05 * DEG,
    speedNoise: 0.01,
    position: 1,
    spins: [
      [0, 0],
      [0, 0.5],
      [0, -0.75],
      [0.45, 0.2],
      [-0.45, 0.2],
    ],
    speeds: [0.85, 1.2, 1.6, 2.2],
    safety: true,
    randomPick: 0,
    robust: 3,
  },
  // used by tests / level solvers: perfect execution
  perfect: {
    k: 12,
    aimNoise: 0,
    speedNoise: 0,
    position: 1,
    spins: [
      [0, 0],
      [0, 0.5],
      [0, -0.75],
      [0.45, 0.2],
      [-0.45, 0.2],
    ],
    speeds: [0.85, 1.2, 1.6, 2.2],
    safety: true,
    randomPick: 0,
    robust: 3,
  },
};

// ---------------------------------------------------------------------------
// geometry
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t - px;
  const qy = ay + dy * t - py;
  return qx * qx + qy * qy;
}

export function pathClear(ax, ay, bx, by, balls, exclude, clearance = 2 * R) {
  const c2 = clearance * clearance;
  for (const b of balls) {
    if (exclude.includes(b.n)) continue;
    if (segDist2(b.x, b.y, ax, ay, bx, by) < c2) return false;
  }
  return true;
}

function aimPoints(p) {
  const pts = [[p.ax, p.ay]];
  // offsets across the mouth
  const tx = -p.ny;
  const ty = p.nx;
  const o = p.type === 'corner' ? 0.016 : 0.014;
  pts.push([p.ax + tx * o, p.ay + ty * o]);
  pts.push([p.ax - tx * o, p.ay - ty * o]);
  return pts;
}

// Direct pot candidates for the cue ball at (cx,cy).
export function directCandidates(balls, cx, cy, targets) {
  const out = [];
  for (const n of targets) {
    const t = balls.find((b) => b.n === n);
    if (!t) continue;
    for (const p of POCKETS) {
      let best = null;
      for (const [px, py] of aimPoints(p)) {
        const ox = px - t.x;
        const oy = py - t.y;
        const d2 = Math.hypot(ox, oy);
        if (d2 < 1e-6) continue;
        const ux = ox / d2;
        const uy = oy / d2;
        // approach angle into the pocket
        const appr = -(ux * p.nx + uy * p.ny);
        if (p.type === 'side' && appr < Math.cos(58 * DEG)) continue;
        if (p.type === 'corner' && appr < Math.cos(62 * DEG)) continue;
        const gx = t.x - ux * 2 * R;
        const gy = t.y - uy * 2 * R;
        const ax = gx - cx;
        const ay = gy - cy;
        const d1 = Math.hypot(ax, ay);
        if (d1 < 1e-6) continue;
        const cosCut = (ax * ux + ay * uy) / d1;
        if (cosCut < Math.cos(80 * DEG)) continue;
        if (!pathClear(cx, cy, gx, gy, balls, [0, n])) continue;
        if (!pathClear(t.x, t.y, px, py, balls, [0, n])) continue;
        // ghost ball must be on the table
        if (Math.abs(gx) > HX - R * 0.9 || Math.abs(gy) > HY - R * 0.9) continue;
        const q = Math.pow(cosCut, 1.6) / (1 + 0.55 * d1 + 0.9 * d2) * (p.type === 'side' ? 0.85 + 0.15 * appr : 1);
        if (!best || q > best.quality) {
          best = { kind: 'direct', target: n, potBall: n, pocket: p.id, angle: Math.atan2(ay, ax), cosCut, d1, d2, quality: q, gx, gy };
        }
      }
      if (best) out.push(best);
    }
  }
  return out;
}

// Combination candidates: cue -> first (legal) -> potBall -> pocket
export function comboCandidates(balls, cx, cy, firsts, potBalls) {
  const out = [];
  for (const fN of firsts) {
    const f = balls.find((b) => b.n === fN);
    if (!f) continue;
    for (const pN of potBalls) {
      if (pN === fN) continue;
      const pb = balls.find((b) => b.n === pN);
      if (!pb) continue;
      if (Math.hypot(pb.x - f.x, pb.y - f.y) > 0.9) continue;
      for (const p of POCKETS) {
        const ox = p.ax - pb.x;
        const oy = p.ay - pb.y;
        const d3 = Math.hypot(ox, oy);
        if (d3 < 1e-6) continue;
        const ux = ox / d3;
        const uy = oy / d3;
        const appr = -(ux * p.nx + uy * p.ny);
        if (appr < Math.cos((p.type === 'side' ? 50 : 55) * DEG)) continue;
        const g2x = pb.x - ux * 2 * R;
        const g2y = pb.y - uy * 2 * R;
        const bx = g2x - f.x;
        const by = g2y - f.y;
        const d2 = Math.hypot(bx, by);
        if (d2 < 1e-6) continue;
        const vx = bx / d2;
        const vy = by / d2;
        const cos2 = vx * ux + vy * uy;
        if (cos2 < Math.cos(35 * DEG)) continue;
        const g1x = f.x - vx * 2 * R;
        const g1y = f.y - vy * 2 * R;
        const ax = g1x - cx;
        const ay = g1y - cy;
        const d1 = Math.hypot(ax, ay);
        if (d1 < 1e-6) continue;
        const cos1 = (ax * vx + ay * vy) / d1;
        if (cos1 < Math.cos(50 * DEG)) continue;
        if (!pathClear(cx, cy, g1x, g1y, balls, [0, fN])) continue;
        if (!pathClear(f.x, f.y, g2x, g2y, balls, [0, fN, pN])) continue;
        if (!pathClear(pb.x, pb.y, p.ax, p.ay, balls, [0, fN, pN])) continue;
        const q = (Math.pow(cos1, 1.6) * Math.pow(cos2, 3)) / (1 + 0.55 * d1 + 1.2 * d2 + 0.9 * d3) * 0.7;
        out.push({ kind: 'combo', target: fN, potBall: pN, pocket: p.id, angle: Math.atan2(ay, ax), cosCut: cos1 * cos2, d1, d2: d2 + d3, quality: q });
      }
    }
  }
  return out;
}

function speedFor(c) {
  const d2 = c.d2;
  const vObj = Math.sqrt(0.36 + 2 * 0.16 * d2);
  const vImp = vObj / Math.max(0.25, c.cosCut * 0.95);
  const v0 = Math.sqrt(vImp * vImp + 2 * 0.3 * c.d1);
  return Math.min(MAX_SPEED * 0.9, v0 * 1.05);
}

// ---------------------------------------------------------------------------
function layoutFromSim(sim) {
  return sim.balls.filter((b) => b.state === ON_TABLE).map((b) => ({ n: b.n, x: b.x, y: b.y }));
}

export function simulate(layout, cuePos, shot) {
  const sim = new Sim();
  sim.setBalls(layout.map((b) => (b.n === 0 && cuePos ? { n: 0, x: cuePos[0], y: cuePos[1] } : { n: b.n, x: b.x, y: b.y })));
  sim.strike(0, shot);
  sim.run(25);
  return sim;
}

// Context describing the decision problem. Two flavours: match (uses the rules
// engine) and free (trick-shot clearance).
function matchContext(match) {
  return {
    legalTargets: (onTable, p) => match.legalTargets(onTable, p),
    potBalls: (onTable, p) => {
      if (match.game === '9ball') return onTable.filter((n) => n !== 0);
      return match.legalTargets(onTable, p);
    },
    evaluate: (sim, layoutBefore, shot, posWeight, cand) => {
      const m = match.clone();
      const before = layoutBefore.map((b) => b.n);
      if (cand && m.needsCalledPocket(before)) m.calledPocket = cand.pocket;
      const res = analyzeShot(sim.events);
      const me = m.current;
      const out = m.applyShot(res, before, { pushOut: false });
      if (out.winner === me) return { score: 1e5, out };
      if (out.winner !== null) return { score: -1e5, out };
      const after = layoutFromSim(sim);
      // respotted balls are approximately back on the table for evaluation
      for (const n of out.respot) after.push({ n, x: FOOT_SPOT[0], y: FOOT_SPOT[1] });
      if (out.foul) {
        return { score: -3000 + 0 * posWeight, out };
      }
      if (out.continueTurn) {
        const q = bestQuality(after, m, me, false);
        return { score: 1000 + 50 * out.legalPots.length + posWeight * 700 * q + (q > 0 ? 100 : -150) * posWeight, out };
      }
      const oq = bestQuality(after, m, 1 - me, false);
      return { score: -200 - 600 * oq, out };
    },
  };
}

export function bestQuality(layout, match, player, ballInHand) {
  const cue = layout.find((b) => b.n === 0);
  if (!cue) return ballInHand ? 0.5 : 0;
  const onTable = layout.map((b) => b.n);
  const targets = match.legalTargets(onTable, player);
  let q = 0;
  for (const c of directCandidates(layout, cue.x, cue.y, targets)) q = Math.max(q, c.quality);
  return q;
}

function applyNoise(shot, diff, rng) {
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return {
    ...shot,
    angle: shot.angle + gauss() * diff.aimNoise,
    speed: Math.max(0.3, Math.min(MAX_SPEED, shot.speed * (1 + gauss() * diff.speedNoise))),
  };
}

// Search shots for a given cue position. Returns best {shot, score, cand}.
function searchShots(ctx, layout, cuePos, me, diff, rng, budget) {
  const balls = layout.map((b) => (b.n === 0 ? { n: 0, x: cuePos[0], y: cuePos[1] } : b));
  const onTable = balls.map((b) => b.n);
  const legal = ctx.legalTargets(onTable, me);
  const pots = ctx.potBalls(onTable, me);
  let cands = directCandidates(balls, cuePos[0], cuePos[1], legal.filter((n) => pots.includes(n)));
  cands = cands.concat(comboCandidates(balls, cuePos[0], cuePos[1], legal, pots));
  // weaker players avoid razor-thin cuts they would likely miss entirely
  if (diff.maxCut) cands = cands.filter((c) => c.cosCut >= Math.cos(diff.maxCut));
  cands.sort((a, b) => b.quality - a.quality);
  cands = cands.slice(0, diff.k);
  let best = null;
  const tried = [];
  for (const c of cands) {
    const base = speedFor(c);
    for (const sp of diff.speeds) {
      for (const [sx, sy] of diff.spins) {
        if (budget.n <= 0) break;
        budget.n--;
        const shot = { angle: c.angle, speed: Math.min(MAX_SPEED, base * sp), spinX: sx, spinY: sy, elevation: 0 };
        const sim = simulate(balls, null, shot);
        const ev = ctx.evaluate(sim, balls, shot, diff.position, c);
        let score = ev.score + c.quality * 50;
        // easy AI ignores position
        if (diff.position === 0 && ev.out && ev.out.continueTurn) score = 1000 + c.quality * 100;
        tried.push({ shot, score, cand: c });
        if (!best || score > best.score) best = { shot, score, cand: c };
      }
    }
  }
  // robustness check for the top shots (hard): perturb aim slightly
  if (diff.robust && tried.length) {
    tried.sort((a, b) => b.score - a.score);
    const top = tried.slice(0, diff.robust);
    let bestR = null;
    for (const t of top) {
      let sum = t.score;
      for (const da of [-0.3 * DEG, 0.3 * DEG]) {
        const s2 = { ...t.shot, angle: t.shot.angle + da };
        const sim = simulate(balls, null, s2);
        sum += ctx.evaluate(sim, balls, s2, diff.position, t.cand).score;
      }
      const avg = sum / 3;
      if (!bestR || avg > bestR.score) bestR = { ...t, score: avg };
    }
    best = bestR;
  }
  if (diff.randomPick && tried.length > 1 && rng() < diff.randomPick) {
    const good = tried.filter((t) => t.score > 500);
    if (good.length) best = good[Math.floor(rng() * good.length)];
  }
  return best;
}

function safetySearch(ctx, layout, cuePos, me, diff, rng, budget) {
  const balls = layout.map((b) => (b.n === 0 ? { n: 0, x: cuePos[0], y: cuePos[1] } : b));
  const onTable = balls.map((b) => b.n);
  const legal = ctx.legalTargets(onTable, me);
  let best = null;
  const consider = (shot) => {
    if (budget.n <= 0) return;
    budget.n--;
    const sim = simulate(balls, null, shot);
    const ev = ctx.evaluate(sim, balls, shot, diff.position);
    if (!best || ev.score > best.score) best = { shot, score: ev.score };
  };
  // direct hits on legal balls with different thicknesses
  for (const n of legal) {
    const t = balls.find((b) => b.n === n);
    if (!t) continue;
    const dx = t.x - cuePos[0];
    const dy = t.y - cuePos[1];
    const d = Math.hypot(dx, dy);
    const base = Math.atan2(dy, dx);
    for (const f of [-0.75, -0.4, 0, 0.4, 0.75]) {
      const off = Math.asin(Math.max(-1, Math.min(1, (f * 2 * R) / Math.max(d, 2 * R))));
      if (!pathClear(cuePos[0], cuePos[1], t.x - Math.cos(base + off) * 2 * R, t.y - Math.sin(base + off) * 2 * R, balls, [0, n], 2 * R * 0.98)) continue;
      for (const sp of [1.2, 2.0, 3.2]) consider({ angle: base + off, speed: sp, spinX: 0, spinY: -0.2, elevation: 0 });
    }
  }
  // kicks / anything legal if nothing found
  if (!best || best.score < -2000) {
    for (let k = 0; k < 90; k++) {
      const ang = (k / 90) * Math.PI * 2 + rng() * 0.02;
      for (const sp of [2.5, 4.5]) consider({ angle: ang, speed: sp, spinX: 0, spinY: 0, elevation: 0 });
    }
  }
  return best;
}

function placementCandidates(layout, ctx, me, kitchen) {
  const onTable = layout.map((b) => b.n);
  const legal = ctx.legalTargets(onTable, me);
  const pots = ctx.potBalls(onTable, me);
  const others = layout.filter((b) => b.n !== 0);
  const out = [];
  for (const n of legal.filter((x) => pots.includes(x))) {
    const t = others.find((b) => b.n === n);
    if (!t) continue;
    for (const p of POCKETS) {
      const ox = p.ax - t.x;
      const oy = p.ay - t.y;
      const d2 = Math.hypot(ox, oy);
      const ux = ox / d2;
      const uy = oy / d2;
      const appr = -(ux * p.nx + uy * p.ny);
      if (appr < Math.cos((p.type === 'side' ? 45 : 55) * DEG)) continue;
      if (!pathClear(t.x, t.y, p.ax, p.ay, others, [n])) continue;
      for (const back of [0.16, 0.3, 0.5]) {
        for (const rot of [0, 18 * DEG, -18 * DEG, 32 * DEG, -32 * DEG]) {
          const c = Math.cos(rot);
          const s = Math.sin(rot);
          const dx = -(ux * c - uy * s);
          const dy = -(ux * s + uy * c);
          const x = t.x - ux * 2 * R + dx * back;
          const y = t.y - uy * 2 * R + dy * back;
          const lay = others.map((b) => ({ ...b, state: ON_TABLE }));
          if (!validCuePlacement(lay, x, y, kitchen)) continue;
          const bl = [{ n: 0, x, y }, ...others];
          const cands = directCandidates(bl, x, y, [n]).filter((cc) => cc.pocket === p.id);
          if (!cands.length) continue;
          out.push({ pos: [x, y], q: cands[0].quality * (rot === 0 ? 1 : 0.97) });
        }
      }
    }
  }
  out.sort((a, b) => b.q - a.q);
  return out;
}

function breakShot(layout, match, diff, rng) {
  const objs = layout.filter((b) => b.n !== 0);
  // head ball: the one nearest the foot spot
  let head = objs[0];
  for (const b of objs) if (Math.hypot(b.x - FOOT_SPOT[0], b.y - FOOT_SPOT[1]) < Math.hypot(head.x - FOOT_SPOT[0], head.y - FOOT_SPOT[1])) head = b;
  const y = match.game === '9ball' ? (rng() < 0.5 ? -1 : 1) * 0.25 : (rng() - 0.5) * 0.2;
  const cuePos = [HEAD_STRING_X - 0.02, y];
  const angle = Math.atan2(head.y - y, head.x - cuePos[0]);
  const speed = diff === DIFFICULTY.easy ? 9.2 : diff === DIFFICULTY.medium ? 9.8 : 10.6;
  return { cuePos, shot: applyNoise({ angle, speed, spinX: 0, spinY: -0.15, elevation: 0 }, { ...diff, aimNoise: diff.aimNoise * 0.5 }, rng) };
}

// Main entry for match play.
// input: { layout: [{n,x,y}], match: Match json, difficulty: 'easy'|'medium'|'hard', seed }
// output: { shot, cuePos|null, calledPocket|null, kind }
export function planMatchShot(input) {
  const match = input.match instanceof Match ? input.match : Match.fromJSON(input.match);
  const diff = DIFFICULTY[input.difficulty] || DIFFICULTY.medium;
  const rng = mulberry32(input.seed ?? 1);
  const layout = input.layout.map((b) => ({ n: b.n, x: b.x, y: b.y }));
  const me = match.current;
  if (match.isBreak) {
    const b = breakShot(layout, match, diff, rng);
    return { ...b, calledPocket: null, kind: 'break' };
  }
  const ctx = matchContext(match);
  const budget = { n: input.budget ?? (diff === DIFFICULTY.easy ? 40 : diff === DIFFICULTY.medium ? 160 : diff === DIFFICULTY.hard ? 320 : 420) };
  let cuePos = null;
  let best = null;
  if (match.ballInHand) {
    const places = placementCandidates(layout, ctx, me, match.kitchen).slice(0, diff === DIFFICULTY.easy ? 2 : 5);
    for (const pl of places) {
      const b = searchShots(ctx, layout, pl.pos, me, { ...diff, k: Math.max(2, Math.floor(diff.k / 2)) }, rng, budget);
      if (b && (!best || b.score > best.score)) {
        best = b;
        cuePos = pl.pos;
      }
    }
    if (!best || best.score < 500) {
      // nothing good: place the ball for a safety from somewhere sensible
      const lay = layout.filter((b) => b.n !== 0).map((b) => ({ ...b, state: ON_TABLE }));
      const tries = [
        [HEAD_STRING_X - 0.1, 0],
        [-0.3, 0.2],
        [0.3, -0.2],
        [0, 0],
      ];
      for (const t of tries) {
        if (match.kitchen && t[0] > HEAD_STRING_X) continue;
        if (validCuePlacement(lay, t[0], t[1], match.kitchen)) {
          if (!cuePos) cuePos = t;
          break;
        }
      }
      if (!cuePos) cuePos = [HEAD_STRING_X - 0.2, 0.3];
    }
  } else {
    const cue = layout.find((b) => b.n === 0);
    cuePos = null;
    if (cue) best = searchShots(ctx, layout, [cue.x, cue.y], me, diff, rng, budget);
  }
  const cueBall = layout.find((b) => b.n === 0);
  const startPos = cuePos || (cueBall ? [cueBall.x, cueBall.y] : [HEAD_STRING_X, 0]);
  let kind = 'pot';
  if (!best || best.score < 500) {
    const s = diff.safety || !best ? safetySearch(ctx, layout, startPos, me, diff, rng, { n: 260 }) : null;
    if (s && (!best || s.score > best.score)) {
      best = { shot: s.shot, score: s.score, cand: null };
      kind = 'safety';
    }
  }
  if (!best) {
    // last resort: hit the first legal ball (or any object ball)
    const onTable = layout.map((b) => b.n);
    const t = layout.find((b) => b.n === match.legalTargets(onTable, me)[0]) || layout.find((b) => b.n !== 0);
    const angle = t ? Math.atan2(t.y - startPos[1], t.x - startPos[0]) : 0;
    best = { shot: { angle, speed: 2.5, spinX: 0, spinY: 0, elevation: 0 }, score: 0, cand: null };
    kind = 'safety';
  }
  const shot = applyNoise(best.shot, diff, rng);
  let calledPocket = best.cand ? best.cand.pocket : null;
  if (calledPocket === null) {
    // call the pocket nearest to the 8's line if we are on it
    calledPocket = 3;
  }
  return { shot, cuePos, calledPocket, kind, score: best.score };
}

// AI decision after an opponent push-out: take the shot or pass it back.
export function decidePush(input) {
  const match = input.match instanceof Match ? input.match : Match.fromJSON(input.match);
  const q = bestQuality(input.layout, match, match.current, false);
  return q > 0.18;
}

// ---------------------------------------------------------------------------
// Free planning for trick-shot clearance levels (also used by the tests).
// targets: balls that must be potted; lastBall: ball that must go last (optional)
export function planFreeShot(layout, targets, opts = {}) {
  const diff = DIFFICULTY[opts.difficulty || 'perfect'];
  const rng = mulberry32(opts.seed ?? 7);
  const remaining = (onTable) => targets.filter((n) => onTable.includes(n));
  const legalFor = (onTable) => {
    const rem = remaining(onTable);
    if (opts.lastBall !== undefined && rem.length > 1) return rem.filter((n) => n !== opts.lastBall);
    return rem;
  };
  const freeMatch = {
    legalTargets: (onTable) => legalFor(onTable),
    clone() {
      return this;
    },
  };
  const ctx = {
    legalTargets: (onTable) => legalFor(onTable),
    potBalls: (onTable) => legalFor(onTable),
    evaluate: (sim, before) => {
      const res = analyzeShot(sim.events);
      const beforeN = before.map((b) => b.n);
      const legal = legalFor(beforeN);
      if (res.cueScratch) return { score: -3000, out: null };
      const potted = res.pocketedNums;
      if (opts.lastBall !== undefined && potted.includes(opts.lastBall) && legal.length > 1 && legalFor(beforeN).some((n) => n !== opts.lastBall && !potted.includes(n))) return { score: -3000, out: null };
      const good = potted.filter((n) => targets.includes(n)).length;
      if (!good) return { score: -100, out: null };
      const after = layoutFromSim(sim);
      const cue = after.find((b) => b.n === 0);
      const rem = legalFor(after.map((b) => b.n));
      let q = rem.length ? 0 : 1;
      if (cue) for (const c of directCandidates(after, cue.x, cue.y, rem)) q = Math.max(q, c.quality);
      return { score: 1000 + 100 * good + 700 * q + (q > 0 ? 100 : -150), out: { continueTurn: true } };
    },
  };
  void freeMatch;
  const cue = layout.find((b) => b.n === 0);
  const best = searchShots(ctx, layout, [cue.x, cue.y], 0, diff, rng, { n: opts.budget ?? 400 });
  if (!best) return null;
  return { shot: best.shot, score: best.score };
}
