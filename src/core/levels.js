// Trick Shot Challenge levels + evaluator (pure logic).
import { R, HX, HY, POCKETS } from './constants.js';

const DEG = Math.PI / 180;

// Cue position for a shot on `ball` into pocket `pid` with a cut angle (deg) and distance.
function lineUp(pid, ball, dist, cutDeg = 0) {
  const p = POCKETS[pid];
  let ux = ball[0] - p.ax;
  let uy = ball[1] - p.ay;
  const l = Math.hypot(ux, uy);
  ux /= l;
  uy /= l;
  const gx = ball[0] + ux * 2 * R;
  const gy = ball[1] + uy * 2 * R;
  const c = Math.cos(cutDeg * DEG);
  const s = Math.sin(cutDeg * DEG);
  const dx = ux * c - uy * s;
  const dy = ux * s + uy * c;
  return [gx + dx * dist, gy + dy * dist];
}

function behind(pid, ball, gap) {
  // a point further from the pocket along the pocket->ball line
  const p = POCKETS[pid];
  let ux = ball[0] - p.ax;
  let uy = ball[1] - p.ay;
  const l = Math.hypot(ux, uy);
  return [ball[0] + (ux / l) * gap, ball[1] + (uy / l) * gap];
}

const b = (n, p) => ({ n, x: p[0], y: p[1] });

function makeLevels() {
  const L = [];

  // 1 ---------------------------------------------------------------
  {
    const one = [0.78, 0.33];
    L.push({
      id: 1,
      name: 'First Pot',
      desc: 'Pot the 1-ball in the top-right corner pocket. Aim with the mouse, hold and pull back to set power, release to shoot.',
      hint: 'Line up the ghost ball with the pocket and use medium power.',
      balls: [b(0, lineUp(3, one, 0.6, 12)), b(1, one)],
      targets: [1],
      pockets: { 1: [3] },
      par: 1,
      stars: [1, 2],
      max: 6,
      resetOnMiss: true,
    });
  }
  // 2 ---------------------------------------------------------------
  {
    const one = [0.9, -0.38];
    L.push({
      id: 2,
      name: 'The Thin Cut',
      desc: 'Cut the 1-ball into the bottom-right corner. Hit the edge of the ball - a thin cut sends it sideways.',
      hint: 'Put the ghost ball exactly where the 1 must be struck. Soft speed helps.',
      balls: [b(0, lineUp(2, one, 0.65, 52)), b(1, one)],
      targets: [1],
      pockets: { 1: [2] },
      par: 1,
      stars: [1, 3],
      max: 8,
      resetOnMiss: true,
    });
  }
  // 3 ---------------------------------------------------------------
  {
    const one = [-0.82, 0.36];
    const cue = lineUp(5, one, 0.45);
    const zone = behind(5, one, 0.92);
    L.push({
      id: 3,
      name: 'Draw Back',
      desc: 'Pot the 1-ball in the top-left corner and draw the cue ball back into the green zone.',
      hint: 'Set the cue tip low on the spin widget (back spin) and hit firmly.',
      balls: [b(0, cue), b(1, one)],
      targets: [1],
      pockets: { 1: [5] },
      cueZone: { x: zone[0], y: zone[1], r: 0.25 },
      par: 1,
      stars: [1, 3],
      max: 8,
      resetOnMiss: true,
    });
  }
  // 4 ---------------------------------------------------------------
  L.push({
    id: 4,
    name: 'Follow Through',
    desc: 'Pot the 1-ball in the top-right corner and let the cue ball follow on into the green zone by the end rail.',
    hint: 'Set the cue tip high on the spin widget (top spin). Medium-firm power.',
    balls: [b(0, [0.459, -0.219]), b(1, [0.8, 0.22])],
    targets: [1],
    pockets: { 1: [3] },
    cueZone: { x: 1.0, y: 0.2, r: 0.16 },
    par: 1,
    stars: [1, 3],
    max: 8,
    resetOnMiss: true,
  });
  // 5 ---------------------------------------------------------------
  L.push({
    id: 5,
    name: 'Cross-Side Bank',
    desc: 'Bank the 1-ball off the top cushion into the bottom side pocket.',
    hint: 'Hit the 1 almost straight up the table. Angle in equals angle out.',
    balls: [b(0, [0.36, -0.42]), b(1, [0.1, -0.2])],
    targets: [1],
    pockets: { 1: [1] },
    require: { bank: true },
    par: 1,
    stars: [1, 3],
    max: 10,
    resetOnMiss: true,
  });
  // 6 ---------------------------------------------------------------
  {
    const two = [1.02, 0.4];
    const one = behind(3, two, 0.32);
    L.push({
      id: 6,
      name: 'Combination',
      desc: 'Strike the 1-ball first and drive it into the 2-ball to pot the 2 in the top-right corner.',
      hint: 'Aim the 1 at the 2 as if the 1 were the cue ball.',
      balls: [b(0, lineUp(3, one, 0.55, 18)), b(1, one), b(2, two)],
      targets: [2],
      pockets: { 2: [3] },
      require: { first: 1 },
      par: 1,
      stars: [1, 3],
      max: 10,
      resetOnMiss: true,
    });
  }
  // 7 ---------------------------------------------------------------
  {
    const one = [-1.0, 0.36];
    const cue = [0.15, 0.32];
    // blockers across the direct line
    const mx = (one[0] + cue[0]) / 2;
    const my = (one[1] + cue[1]) / 2;
    L.push({
      id: 7,
      name: 'Kick Shot',
      desc: 'The direct path is blocked. Kick the cue ball off a cushion first, then pot the 1-ball. Do not touch the blockers.',
      hint: 'Use the bottom cushion: aim at the mirror image of the 1-ball.',
      balls: [b(0, cue), b(1, one), b(9, [mx, my + 0.03]), b(10, [mx, my - 0.03]), b(11, [mx + 0.03, my + 0.088])],
      targets: [1],
      avoid: [9, 10, 11],
      require: { kick: true },
      par: 1,
      stars: [1, 3],
      max: 10,
      resetOnMiss: true,
    });
  }
  // 8 ---------------------------------------------------------------
  L.push({
    id: 8,
    name: 'Split Decision',
    desc: 'Pot BOTH the 1-ball and the 2-ball with a single shot. They are frozen together - hit them dead centre.',
    hint: 'Aim exactly between the two balls (use fine aim). They split at 30 degrees into the two far corners.',
    balls: [b(0, [-0.55, 0]), b(1, [0.24, R + 0.0002]), b(2, [0.24, -R - 0.0002])],
    targets: [1, 2],
    require: { together: true },
    par: 1,
    stars: [1, 3],
    max: 10,
    resetOnMiss: true,
  });
  // 9 ---------------------------------------------------------------
  L.push({
    id: 9,
    name: 'Jump The Blocker',
    desc: 'A blocker sits right in your line. Jump the cue ball over it and pot the 1-ball. Touching the blocker fails.',
    hint: 'Raise the cue with the elevation slider (40 degrees or more) and hit firmly.',
    balls: [b(0, [-0.55, -0.1]), b(9, [-0.3, -0.1]), b(10, [-0.3, -0.042]), b(11, [-0.3, -0.158]), b(1, [0.6, -0.1])],
    targets: [1],
    avoid: [9, 10, 11],
    par: 1,
    stars: [1, 3],
    max: 10,
    resetOnMiss: true,
    jump: true,
  });
  // 10 --------------------------------------------------------------
  L.push({
    id: 10,
    name: 'Rail Runner',
    desc: 'The 1-ball is frozen to the top cushion. Run it down the rail into the top-right corner.',
    hint: 'Hit the ball and the cushion at the same time. A touch of running english helps.',
    balls: [b(0, [-0.05, 0.3]), b(1, [0.45, HY - R - 0.0006])],
    targets: [1],
    pockets: { 1: [3] },
    par: 1,
    stars: [1, 3],
    max: 10,
    resetOnMiss: true,
  });
  // 11 --------------------------------------------------------------
  L.push({
    id: 11,
    name: 'Five In Seven',
    desc: 'Clear all five balls in seven shots or fewer. Scratching resets the layout.',
    hint: 'Think one ball ahead - leave the cue ball where the next shot is easy.',
    balls: [b(0, [-0.7, 0.0]), b(1, [-0.3, 0.32]), b(2, [0.2, -0.3]), b(3, [0.75, 0.42]), b(4, [0.95, -0.15]), b(5, [-0.9, -0.45])],
    targets: [1, 2, 3, 4, 5],
    par: 5,
    stars: [5, 6],
    max: 7,
    resetOnMiss: false,
  });
  // 12 --------------------------------------------------------------
  L.push({
    id: 12,
    name: 'Run The Rack',
    desc: 'Pot the 1 to 7 in any order, then the 8-ball last - within twelve shots.',
    hint: 'Save the 8 for last. Potting it early resets the layout.',
    balls: [
      b(0, [-0.75, 0.05]),
      b(1, [-0.2, 0.4]),
      b(2, [0.3, 0.25]),
      b(3, [0.85, -0.4]),
      b(4, [-0.95, -0.35]),
      b(5, [0.55, -0.1]),
      b(6, [1.05, 0.3]),
      b(7, [-0.45, -0.3]),
      b(8, [0.1, -0.15]),
    ],
    targets: [1, 2, 3, 4, 5, 6, 7, 8],
    lastBall: 8,
    par: 8,
    stars: [8, 10],
    max: 12,
    resetOnMiss: false,
  });
  return L;
}

export const LEVELS = makeLevels();

export function starsFor(level, shots) {
  if (shots <= level.stars[0]) return 3;
  if (shots <= level.stars[1]) return 2;
  return 1;
}

// Evaluate one shot of a level.
// res: analyzeShot() result, potted: Set of targets already potted before this shot,
// cueAfter: {x,y} or null if scratched
export function evaluateLevelShot(level, res, potted, cueAfter) {
  const req = level.require || {};
  const nowPotted = res.pocketedNums.filter((n) => n !== 0);
  const targetsNow = nowPotted.filter((n) => level.targets.includes(n));
  const fail = (msg) => ({ status: 'fail', message: msg, targetsNow });
  if (res.cueScratch) return fail('Scratch! The cue ball went in.');
  if (res.firstHit === null) return fail('Missed everything.');
  for (const n of level.avoid || []) if (res.anyContact.has(n)) return fail('You touched a blocker ball.');
  for (const n of nowPotted) if (!level.targets.includes(n)) return fail('Wrong ball potted.');
  for (const pk of res.pocketed) {
    const allowed = level.pockets?.[pk.n];
    if (allowed && !allowed.includes(pk.pocket)) return fail('Right ball, wrong pocket.');
  }
  if (targetsNow.length) {
    if (req.bank && targetsNow.some((n) => !res.banked.has(n))) return fail('It has to be a bank shot - hit a cushion first.');
    if (req.kick && res.cueCushionsBeforeHit < 1) return fail('Kick shot required: the cue ball must hit a cushion first.');
    if (req.first !== undefined && res.firstHit !== req.first) return fail(`Hit the ${req.first}-ball first.`);
    if (level.lastBall !== undefined && targetsNow.includes(level.lastBall)) {
      const remaining = level.targets.filter((n) => n !== level.lastBall && !potted.has(n) && !targetsNow.includes(n));
      if (remaining.length) return fail(`The ${level.lastBall}-ball must be potted last.`);
    }
  }
  const all = new Set([...potted, ...targetsNow]);
  const done = level.targets.every((n) => all.has(n));
  if (req.together && targetsNow.length > 0 && !done) return fail('All target balls must drop on the same shot.');
  if (done) {
    if (level.cueZone && cueAfter) {
      const d = Math.hypot(cueAfter.x - level.cueZone.x, cueAfter.y - level.cueZone.y);
      if (d > level.cueZone.r) return fail('Potted - but the cue ball missed the zone.');
    }
    return { status: 'success', message: 'Level complete!', targetsNow };
  }
  if (!targetsNow.length) return { status: 'miss', message: 'Missed.', targetsNow };
  return { status: 'continue', message: 'Nice pot!', targetsNow };
}

export { HX, HY };
