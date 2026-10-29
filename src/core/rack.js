// Racking, spotting and ball placement helpers (pure, no rendering).
import { R, HX, HY, FOOT_SPOT, HEAD_SPOT, HEAD_STRING_X, isSolid, isStripe } from './constants.js';
import { ON_TABLE } from './physics.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const GAP = 0.00005;

function rackPositions(rowSizes, rng) {
  const sp = 2 * R + GAP;
  const dx = (sp * Math.sqrt(3)) / 2;
  const out = [];
  rowSizes.forEach((size, k) => {
    const row = [];
    for (let j = 0; j < size; j++) {
      const jit = () => (rng() - 0.5) * 0.00002;
      row.push([FOOT_SPOT[0] + k * dx + jit(), (j - (size - 1) / 2) * sp + jit()]);
    }
    out.push(row);
  });
  return out;
}

export function rack8(rng = Math.random) {
  const pos = rackPositions([1, 2, 3, 4, 5], rng);
  const solids = shuffle([1, 2, 3, 4, 5, 6, 7], rng);
  const stripes = shuffle([9, 10, 11, 12, 13, 14, 15], rng);
  // back corners: one solid, one stripe
  const cornerA = solids.pop();
  const cornerB = stripes.pop();
  const swap = rng() < 0.5;
  const rest = shuffle([...solids, ...stripes], rng);
  const balls = [{ n: 0, x: HEAD_SPOT[0], y: HEAD_SPOT[1] }];
  pos.forEach((row, k) => {
    row.forEach((p, j) => {
      let n;
      if (k === 2 && j === 1) n = 8;
      else if (k === 4 && j === 0) n = swap ? cornerA : cornerB;
      else if (k === 4 && j === 4) n = swap ? cornerB : cornerA;
      else n = rest.pop();
      balls.push({ n, x: p[0], y: p[1] });
    });
  });
  return balls;
}

export function rack9(rng = Math.random) {
  const pos = rackPositions([1, 2, 3, 2, 1], rng);
  const others = shuffle([2, 3, 4, 5, 6, 7, 8], rng);
  const balls = [{ n: 0, x: HEAD_SPOT[0], y: HEAD_SPOT[1] }];
  pos.forEach((row, k) => {
    row.forEach((p, j) => {
      let n;
      if (k === 0) n = 1;
      else if (k === 2 && j === 1) n = 9;
      else n = others.pop();
      balls.push({ n, x: p[0], y: p[1] });
    });
  });
  return balls;
}

// Is (x,y) a legal resting spot for ball n given the others?
export function isFree(balls, x, y, ignoreN = -1, margin = 0.0005) {
  for (const b of balls) {
    if (b.n === ignoreN || b.state !== ON_TABLE) continue;
    if (Math.hypot(b.x - x, b.y - y) < 2 * R + margin) return false;
  }
  return true;
}

export function inPlayArea(x, y, kitchen = false) {
  const lim = 0.0005;
  if (Math.abs(x) > HX - R - lim || Math.abs(y) > HY - R - lim) return false;
  if (kitchen && x > HEAD_STRING_X) return false;
  return true;
}

export function validCuePlacement(balls, x, y, kitchen = false) {
  return inPlayArea(x, y, kitchen) && isFree(balls, x, y, 0);
}

// Spot a ball on the foot spot, or the closest free point behind it on the long axis.
export function spotPosition(balls, n) {
  const [fx, fy] = FOOT_SPOT;
  for (let d = 0; d < HX; d += 0.002) {
    const x = fx + d;
    if (x > HX - R) break;
    if (isFree(balls, x, fy, n)) return [x, fy];
  }
  for (let d = 0; d < 2 * HX; d += 0.002) {
    const x = fx - d;
    if (x < -HX + R) break;
    if (isFree(balls, x, fy, n)) return [x, fy];
  }
  return [0, 0];
}

// Nearest valid placement to a requested point (used for ball-in-hand clamping).
export function nearestValid(balls, x, y, kitchen = false, n = 0) {
  const cx = Math.max(-HX + R + 0.001, Math.min((kitchen ? HEAD_STRING_X : HX - R - 0.001), x));
  const cy = Math.max(-HY + R + 0.001, Math.min(HY - R - 0.001, y));
  if (isFree(balls, cx, cy, n)) return [cx, cy];
  for (let r = 0.005; r < 0.6; r += 0.005) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (inPlayArea(px, py, kitchen) && isFree(balls, px, py, n)) return [px, py];
    }
  }
  return [cx, cy];
}

export { isSolid, isStripe };
