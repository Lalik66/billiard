// Rule tests: every foul and win/loss condition for 8-ball and 9-ball.
// Most scenarios are played with the real physics engine through GameEngine.
import { GameEngine } from '../src/core/engine.js';
import { Match, analyzeShot } from '../src/core/rules.js';
import { R, HX, HY, POCKETS } from '../src/core/constants.js';

let pass = 0;
let failCount = 0;
function check(name, cond, info = '') {
  if (cond) pass++;
  else {
    failCount++;
    console.log('  FAIL', name, info);
  }
}

const aimAt = (from, to) => Math.atan2(to[1] - from[1], to[0] - from[0]);
// angle for the cue to pot ball at `b` into pocket `pid`
function potAngle(cue, b, pid) {
  const p = POCKETS[pid];
  const u = Math.atan2(p.ay - b[1], p.ax - b[0]);
  const g = [b[0] - Math.cos(u) * 2 * R, b[1] - Math.sin(u) * 2 * R];
  return aimAt(cue, g);
}

function engineWith(game, balls, setup = {}) {
  const e = new GameEngine(game, [{ name: 'A' }, { name: 'B' }], 1);
  e.sim.setBalls(balls);
  const m = e.match;
  m.isBreak = false;
  m.ballInHand = false;
  m.kitchen = false;
  Object.assign(m, setup);
  return e;
}

// ---------------------------------------------------------------- 8-ball
console.log('8-ball');
{
  // legal pot on open table assigns the group and continues the turn
  const e = engineWith('8ball', [
    { n: 0, x: 0.5, y: 0.2 },
    { n: 3, x: 0.9, y: 0.4 },
    { n: 11, x: -0.5, y: -0.3 },
    { n: 8, x: -0.2, y: 0.1 },
  ]);
  const { out } = e.playShot({ angle: potAngle([0.5, 0.2], [0.9, 0.4], 3), speed: 1.5, spinY: -0.3 });
  check('open table pot: no foul', !out.foul, out.reason);
  check('open table pot: assigns solids', e.match.groups[0] === 'solids' && e.match.groups[1] === 'stripes');
  check('open table pot: turn continues', out.continueTurn && e.match.current === 0);
}
{
  // scratch: cue ball driven straight into a corner pocket after hitting a ball
  const e = engineWith('8ball', [
    { n: 0, x: 0.75, y: 0.15 },
    { n: 3, x: 1.0, y: 0.4 },
    { n: 11, x: -0.5, y: -0.3 },
    { n: 8, x: -0.2, y: 0.1 },
  ], { openTable: false, groups: ['solids', 'stripes'] });
  const ang = aimAt([0.75, 0.15], [1.0, 0.4]);
  const { out } = e.playShot({ angle: ang, speed: 3, spinY: 0.8 });
  check('scratch is a foul', out.foul && /Scratch/.test(out.reason), out.reason);
  check('scratch gives ball in hand to opponent', e.match.ballInHand && e.match.current === 1);
}
{
  // no ball hit
  const e = engineWith('8ball', [
    { n: 0, x: -0.6, y: 0 },
    { n: 3, x: 0.9, y: 0.4 },
    { n: 8, x: 0.2, y: -0.3 },
  ], { openTable: false, groups: ['solids', 'stripes'] });
  const { out } = e.playShot({ angle: Math.PI, speed: 1.0 });
  check('no ball hit is a foul', out.foul && /no ball hit/.test(out.reason), out.reason);
  check('foul passes turn with ball in hand', e.match.current === 1 && e.match.ballInHand);
}
{
  // wrong ball first (stripe when solids)
  const e = engineWith('8ball', [
    { n: 0, x: -0.6, y: 0 },
    { n: 12, x: -0.2, y: 0 },
    { n: 3, x: 0.9, y: 0.4 },
    { n: 8, x: 0.2, y: -0.4 },
  ], { openTable: false, groups: ['solids', 'stripes'] });
  const { out } = e.playShot({ angle: 0, speed: 2 });
  check('wrong ball first is a foul', out.foul && /wrong ball/.test(out.reason), out.reason);
}
{
  // 8-ball first on an open table
  const e = engineWith('8ball', [
    { n: 0, x: -0.6, y: 0 },
    { n: 8, x: -0.2, y: 0 },
    { n: 3, x: 0.9, y: 0.4 },
    { n: 12, x: 0.2, y: -0.4 },
  ]);
  const { out } = e.playShot({ angle: 0, speed: 2 });
  check('hitting the 8 first on open table is a foul', out.foul && /8-ball first/.test(out.reason), out.reason);
  check('8 hit early does not lose the game', e.match.winner === null);
}
{
  // no rail after contact: very soft touch
  const e = engineWith('8ball', [
    { n: 0, x: -0.2, y: 0 },
    { n: 3, x: 0.0, y: 0 },
    { n: 12, x: 0.6, y: -0.4 },
    { n: 8, x: 0.6, y: 0.4 },
  ], { openTable: false, groups: ['solids', 'stripes'] });
  const { out } = e.playShot({ angle: 0, speed: 0.45 });
  check('no rail after contact is a foul', out.foul && /no rail/.test(out.reason), out.reason);
}
{
  // contact then a rail (no pot) is legal, turn passes
  const e = engineWith('8ball', [
    { n: 0, x: -0.2, y: 0.3 },
    { n: 3, x: 0.0, y: 0.45 },
    { n: 12, x: 0.6, y: -0.4 },
    { n: 8, x: 0.6, y: 0.0 },
  ], { openTable: false, groups: ['solids', 'stripes'] });
  const { out } = e.playShot({ angle: aimAt([-0.2, 0.3], [0.0, 0.45]), speed: 1.5 });
  check('contact + rail is legal', !out.foul, out.reason);
  check('miss without foul passes the turn', e.match.current === 1 && !e.match.ballInHand);
}
{
  // 8 pocketed early loses
  const e = engineWith('8ball', [
    { n: 0, x: 0.5, y: 0.2 },
    { n: 8, x: 0.9, y: 0.4 },
    { n: 3, x: -0.5, y: -0.3 },
    { n: 12, x: -0.6, y: 0.3 },
  ], { openTable: false, groups: ['solids', 'stripes'] });
  e.playShot({ angle: potAngle([0.5, 0.2], [0.9, 0.4], 3), speed: 1.5, spinY: -0.3 });
  check('8 pocketed early loses', e.match.winner === 1, e.match.winReason);
}
{
  // on the 8: wrong pocket loses, called pocket wins, scratch loses
  const mk = () =>
    engineWith('8ball', [
      { n: 0, x: 0.5, y: 0.2 },
      { n: 8, x: 0.9, y: 0.4 },
      { n: 12, x: -0.6, y: 0.3 },
    ], { openTable: false, groups: ['solids', 'stripes'] });
  let e = mk();
  check('needs called pocket when on the 8', e.match.needsCalledPocket(e.onTableNums()));
  e.match.calledPocket = 3;
  e.playShot({ angle: potAngle([0.5, 0.2], [0.9, 0.4], 3), speed: 1.5, spinY: -0.3 });
  check('8 in the called pocket wins', e.match.winner === 0, e.match.winReason);
  e = mk();
  e.match.calledPocket = 2;
  e.playShot({ angle: potAngle([0.5, 0.2], [0.9, 0.4], 3), speed: 1.5, spinY: -0.3 });
  check('8 in an uncalled pocket loses', e.match.winner === 1, e.match.winReason);
  // scratch on the 8 (synthetic result: 8 then cue pocketed)
  const m = new Match('8ball', [{ name: 'A' }, { name: 'B' }]);
  Object.assign(m, { isBreak: false, openTable: false, groups: ['solids', 'stripes'], calledPocket: 3 });
  const res = analyzeShot([
    { t: 0, type: 'strike', a: 0 },
    { t: 0.2, type: 'hit', a: 0, b: 8, speed: 2 },
    { t: 0.5, type: 'pocket', a: 8, pocket: 3, speed: 1 },
    { t: 0.9, type: 'pocket', a: 0, pocket: 2, speed: 1 },
  ]);
  m.applyShot(res, [0, 8, 12]);
  check('scratching while potting the 8 loses', m.winner === 1, m.winReason);
}
{
  // break: illegal soft break, 8 on the break re-spotted
  const e = new GameEngine('8ball', [{ name: 'A' }, { name: 'B' }], 4);
  const { out } = e.playShot({ angle: 0, speed: 0.9 });
  check('soft break is illegal', out.foul && /Illegal break/.test(out.reason), out.reason);
  const m = new Match('8ball', [{ name: 'A' }, { name: 'B' }]);
  const res = analyzeShot([
    { t: 0, type: 'strike', a: 0 },
    { t: 0.1, type: 'hit', a: 0, b: 1, speed: 9 },
    { t: 0.6, type: 'pocket', a: 8, pocket: 2, speed: 2 },
    { t: 0.7, type: 'cushion', a: 3 },
    { t: 0.7, type: 'cushion', a: 4 },
    { t: 0.7, type: 'cushion', a: 5 },
    { t: 0.7, type: 'cushion', a: 6 },
  ]);
  const o = m.applyShot(res, Array.from({ length: 16 }, (_, i) => i));
  check('8 on the break is re-spotted, game continues', m.winner === null && o.respot.includes(8));
  check('table stays open after the break', m.openTable);
}

// ---------------------------------------------------------------- 9-ball
console.log('9-ball');
{
  // must hit the lowest ball first
  const e = engineWith('9ball', [
    { n: 0, x: -0.6, y: 0 },
    { n: 5, x: -0.2, y: 0 },
    { n: 2, x: 0.9, y: 0.4 },
    { n: 9, x: 0.2, y: -0.4 },
  ]);
  const { out } = e.playShot({ angle: 0, speed: 2 });
  check('9-ball: wrong ball first is a foul', out.foul && /2-ball/.test(out.reason), out.reason);
}
{
  // combination on the 9 wins: hit the lowest (1) into the 9
  const nine = [0.95, 0.42];
  const p = POCKETS[3];
  const u = Math.atan2(p.ay - nine[1], p.ax - nine[0]);
  const one = [nine[0] - Math.cos(u) * 0.2, nine[1] - Math.sin(u) * 0.2];
  const cue = [one[0] - Math.cos(u) * 0.4, one[1] - Math.sin(u) * 0.4];
  const e = engineWith('9ball', [
    { n: 0, x: cue[0], y: cue[1] },
    { n: 1, x: one[0], y: one[1] },
    { n: 9, x: nine[0], y: nine[1] },
    { n: 4, x: -0.6, y: -0.4 },
  ]);
  e.playShot({ angle: aimAt(cue, one), speed: 2.5, spinY: -0.5 });
  check('9-ball: legal combination on the 9 wins', e.match.winner === 0, e.match.winReason);
}
{
  // 9 on the break wins; 9 pocketed on a foul is re-spotted
  const m = new Match('9ball', [{ name: 'A' }, { name: 'B' }]);
  const res = analyzeShot([
    { t: 0, type: 'strike', a: 0 },
    { t: 0.1, type: 'hit', a: 0, b: 1, speed: 9 },
    { t: 0.6, type: 'pocket', a: 9, pocket: 1, speed: 2 },
  ]);
  m.applyShot(res, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  check('9 on the break wins', m.winner === 0, m.winReason);
  const m2 = new Match('9ball', [{ name: 'A' }, { name: 'B' }]);
  m2.isBreak = false;
  const res2 = analyzeShot([
    { t: 0, type: 'strike', a: 0 },
    { t: 0.1, type: 'hit', a: 0, b: 4, speed: 3 },
    { t: 0.6, type: 'pocket', a: 9, pocket: 1, speed: 2 },
  ]);
  const o2 = m2.applyShot(res2, [0, 2, 4, 9]);
  check('9 pocketed on a foul is re-spotted', m2.winner === null && o2.foul && o2.respot.includes(9));
}
{
  // push out after the break
  const m = new Match('9ball', [{ name: 'A' }, { name: 'B' }]);
  const brk = analyzeShot([
    { t: 0, type: 'strike', a: 0 },
    { t: 0.1, type: 'hit', a: 0, b: 1, speed: 9 },
    { t: 0.3, type: 'cushion', a: 2 },
    { t: 0.3, type: 'cushion', a: 3 },
    { t: 0.3, type: 'cushion', a: 4 },
    { t: 0.3, type: 'cushion', a: 5 },
  ]);
  m.applyShot(brk, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  check('push-out available after the break', m.pushOutAvailable && m.current === 1);
  // player B pushes out without hitting anything: not a foul
  const push = analyzeShot([{ t: 0, type: 'strike', a: 0 }]);
  const o = m.applyShot(push, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], { pushOut: true });
  check('push-out is not a foul', !o.foul && o.pushOut, o.reason);
  check('opponent must decide after a push-out', m.pushPending && m.current === 0);
  m.resolvePush(false);
  check('passing back gives the table to the pusher', m.current === 1 && !m.pushPending);
  check('push-out no longer available', !m.pushOutAvailable);
}
{
  // three consecutive fouls lose
  const m = new Match('9ball', [{ name: 'A' }, { name: 'B' }]);
  m.isBreak = false;
  const foul = analyzeShot([{ t: 0, type: 'strike', a: 0 }]);
  const legalMiss = analyzeShot([
    { t: 0, type: 'strike', a: 0 },
    { t: 0.1, type: 'hit', a: 0, b: 1, speed: 2 },
    { t: 0.3, type: 'cushion', a: 1 },
  ]);
  const onTable = [0, 1, 2, 9];
  m.applyShot(foul, onTable); // A foul 1
  m.applyShot(legalMiss, onTable); // B legal miss
  m.applyShot(foul, onTable); // A foul 2
  check('two fouls warning tracked', m.consecutiveFouls[0] === 2);
  m.applyShot(legalMiss, onTable); // B
  m.applyShot(foul, onTable); // A foul 3
  check('three consecutive fouls lose', m.winner === 1, m.winReason);
  // a legal shot in between resets the count
  const m2 = new Match('9ball', [{ name: 'A' }, { name: 'B' }]);
  m2.isBreak = false;
  m2.applyShot(foul, onTable);
  m2.applyShot(legalMiss, onTable);
  m2.applyShot(foul, onTable);
  m2.applyShot(legalMiss, onTable);
  m2.applyShot(legalMiss, onTable); // A legal
  m2.applyShot(legalMiss, onTable);
  m2.applyShot(foul, onTable);
  check('legal shot resets consecutive fouls', m2.winner === null && m2.consecutiveFouls[0] === 1);
}
{
  // shot clock expiry is a foul with ball in hand
  const m = new Match('8ball', [{ name: 'A' }, { name: 'B' }]);
  m.isBreak = false;
  m.timeFoul();
  check('shot clock foul passes ball in hand', m.current === 1 && m.ballInHand);
}

console.log(`rules: ${pass} passed, ${failCount} failed`);
if (failCount) process.exitCode = 1;
