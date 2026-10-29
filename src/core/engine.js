// GameEngine: glue between physics (Sim) and rules (Match). Used by the
// browser controller and by the headless tests so both run identical logic.
import { Sim, ON_TABLE, POCKETED } from './physics.js';
import { Match, analyzeShot } from './rules.js';
import { rack8, rack9, mulberry32, spotPosition, validCuePlacement, nearestValid } from './rack.js';
import { HEAD_SPOT, HEAD_STRING_X } from './constants.js';

export class GameEngine {
  constructor(game, players, seed = Date.now() & 0xffff) {
    this.game = game;
    this.rng = mulberry32(seed);
    this.match = new Match(game, players);
    this.sim = new Sim();
    this.before = null;
    this.pushOut = false;
    this.rack();
  }

  rack() {
    const balls = this.game === '9ball' ? rack9(this.rng) : rack8(this.rng);
    this.sim.setBalls(balls);
  }

  layout() {
    return this.sim.balls.filter((b) => b.state === ON_TABLE).map((b) => ({ n: b.n, x: b.x, y: b.y }));
  }

  onTableNums() {
    return this.sim.balls.filter((b) => b.state === ON_TABLE).map((b) => b.n);
  }

  cueOnTable() {
    const c = this.sim.ball(0);
    return c && c.state === ON_TABLE;
  }

  ballStates() {
    return this.sim.balls.map((b) => ({ n: b.n, x: b.x, y: b.y, state: b.state }));
  }

  canPlaceCue(x, y) {
    return validCuePlacement(this.ballStates(), x, y, this.match.kitchen);
  }

  // Nearest legal cue placement to a requested point (for clamping AI/ball-in-hand).
  clampCuePlacement(x, y) {
    return nearestValid(this.ballStates(), x, y, this.match.kitchen);
  }

  placeCue(x, y) {
    const c = this.sim.ball(0);
    c.state = ON_TABLE;
    c.pocket = -1;
    c.x = x;
    c.y = y;
    c.z = 0;
    c.vx = c.vy = c.vz = c.wx = c.wy = c.wz = 0;
    c.moving = false;
  }

  // Make sure the cue ball is somewhere legal (used when ball in hand begins).
  ensureCue() {
    const c = this.sim.ball(0);
    if (c.state !== ON_TABLE) {
      const [x, y] = nearestValid(this.ballStates(), HEAD_SPOT[0], HEAD_SPOT[1], this.match.kitchen);
      this.placeCue(x, y);
    } else if (this.match.kitchen && c.x > HEAD_STRING_X) {
      const [x, y] = nearestValid(this.ballStates(), HEAD_SPOT[0], c.y, true);
      this.placeCue(x, y);
    }
  }

  startShot(shot, opts = {}) {
    this.before = this.onTableNums();
    this.pushOut = !!opts.pushOut;
    this.sim.events = [];
    this.sim.time = 0;
    this.sim.strike(0, shot);
  }

  finishShot() {
    const res = analyzeShot(this.sim.events);
    const out = this.match.applyShot(res, this.before, { pushOut: this.pushOut });
    for (const n of out.respot) {
      const b = this.sim.ball(n);
      const [x, y] = spotPosition(this.ballStates(), n);
      b.state = ON_TABLE;
      b.pocket = -1;
      b.x = x;
      b.y = y;
      b.z = 0;
      b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
      b.moving = false;
    }
    this.pushOut = false;
    return { res, out };
  }

  // headless helper: run the whole shot immediately
  playShot(shot, opts = {}) {
    this.startShot(shot, opts);
    this.sim.run(40);
    return this.finishShot();
  }
}

export { POCKETED };
