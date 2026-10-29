import { GameEngine } from '../src/core/engine.js';
import { planMatchShot, decidePush } from '../src/core/ai.js';

export function playGame(game, diffs, seed, log = false) {
  const eng = new GameEngine(game, [{ name: 'A' }, { name: 'B' }], seed);
  const reasons = {};
  let shots = 0, failsafe = 0;
  while (eng.match.winner === null && shots < 300) {
    const m = eng.match;
    if (m.pushPending) {
      const take = decidePush({ layout: eng.layout(), match: m.toJSON() });
      m.resolvePush(take);
      continue;
    }
    if (m.ballInHand || !eng.cueOnTable()) eng.ensureCue();
    const plan = planMatchShot({ layout: eng.layout(), match: m.toJSON(), difficulty: diffs[m.current], seed: seed * 1000 + shots });
    if (plan.cuePos) {
      if (m.ballInHand || m.isBreak) {
        if (eng.canPlaceCue(plan.cuePos[0], plan.cuePos[1])) eng.placeCue(...plan.cuePos);
        else throw new Error('AI chose illegal cue placement ' + plan.cuePos);
      }
    }
    if (m.needsCalledPocket(eng.onTableNums())) m.calledPocket = plan.calledPocket;
    const p = m.current;
    const { out } = eng.playShot(plan.shot);
    shots++;
    failsafe = eng.sim.failsafe;
    if (out.foul) reasons[out.reason.replace(/\(.*\)|\d+-ball/g, '').trim()] = (reasons[out.reason.replace(/\(.*\)|\d+-ball/g, '').trim()] || 0) + 1;
    if (log) console.log(shots, 'P' + p, plan.kind, out.foul ? 'FOUL ' + out.reason : '', 'pots', out.legalPots.join(','), out.continueTurn ? 'cont' : '', out.messages.join('; '));
  }
  return { winner: eng.match.winner, reason: eng.match.winReason, shots, reasons, failsafe, stats: eng.match.stats };
}

const t0 = performance.now();
const cfgs = [['8ball', ['hard', 'hard']], ['8ball', ['easy', 'medium']], ['9ball', ['hard', 'hard']], ['9ball', ['easy', 'medium']]];
const N = Number(process.argv[2] || 2);
let ok = true;
if (cfgs.length !== 4 || N < 1) {
  console.log(`bad test config: ${cfgs.length} configs, N=${N}`);
  ok = false;
}
for (const [game, diffs] of cfgs) {
  for (let s = 1; s <= N; s++) {
    const t = performance.now();
    const r = playGame(game, diffs, s, process.argv[3] === 'log');
    console.log(game, diffs.join('/'), 'seed', s, 'winner', r.winner, '|', r.reason, '| shots', r.shots, 'failsafe', r.failsafe, JSON.stringify(r.reasons), ((performance.now() - t) / 1000).toFixed(1) + 's');
    if (r.winner === null || r.failsafe) ok = false;
  }
}
console.log('total', ((performance.now() - t0) / 1000).toFixed(1), 's', ok ? 'OK' : 'FAIL');
if (!ok) process.exitCode = 1;
