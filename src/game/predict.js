// Shot prediction for the aiming guide. Runs the real physics on a copy of the
// table for a short time and extracts the paths to draw.
import { Sim, ON_TABLE } from '../core/physics.js';

function trim(pts, maxLen) {
  if (pts.length < 2) return pts;
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + d >= maxLen) {
      const t = (maxLen - acc) / d;
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
      return out;
    }
    acc += d;
    out.push(pts[i]);
  }
  return out;
}

// snapshot: [{n,x,y,state}], shot: strike params
// opts: { aimLen, objLen, cueLen, bounces }
export function predictShot(snapshot, shot, opts) {
  const sim = new Sim();
  sim.setBalls(snapshot);
  const cue = sim.ball(0);
  if (!cue || cue.state !== ON_TABLE) return null;
  sim.strike(0, shot);
  const aimPts = [[cue.x, cue.y]];
  let ghost = null;
  let ghostZ = 0;
  let obj = null;
  let objPocket = null;
  let cueScratch = false;
  const cuePts = [];
  const objPts = [];
  let ev = 1; // skip the strike event
  let bounces = 0;
  let steps = 0;
  let after = 0;
  while (steps < 1400 && sim.isMoving()) {
    sim.step();
    steps++;
    for (; ev < sim.events.length; ev++) {
      const e = sim.events[ev];
      if (!ghost && e.type === 'hit' && (e.a === 0 || e.b === 0)) {
        ghost = [cue.x, cue.y];
        ghostZ = cue.z;
        aimPts.push([cue.x, cue.y]);
        obj = sim.ball(e.a === 0 ? e.b : e.a);
        cuePts.push([cue.x, cue.y]);
        objPts.push([obj.x, obj.y]);
      } else if (!ghost && e.type === 'cushion' && e.a === 0) {
        aimPts.push([cue.x, cue.y]);
        bounces++;
      } else if (e.type === 'pocket') {
        if (obj && e.a === obj.n && objPocket === null) objPocket = e.pocket;
        if (e.a === 0) cueScratch = true;
      }
    }
    if (!ghost) {
      if (bounces > opts.bounces) break;
      if (steps % 6 === 0 && cue.z > 0.002) aimPts.push([cue.x, cue.y]);
    } else {
      after++;
      if (after % 3 === 0) {
        if (cue.state === ON_TABLE) cuePts.push([cue.x, cue.y]);
        if (obj.state === ON_TABLE) objPts.push([obj.x, obj.y]);
        else if (objPts.length && obj.state !== ON_TABLE) {
          const last = objPts[objPts.length - 1];
          if (last[0] !== obj.x) objPts.push([obj.x, obj.y]);
        }
      }
      if (after > 900) break;
    }
  }
  if (!ghost) aimPts.push([cue.x, cue.y]);
  return {
    aimPts: trim(aimPts, opts.aimLen),
    ghost: ghost && opts.ghost !== false ? ghost : null,
    ghostZ,
    objPts: trim(objPts, opts.objLen),
    cuePts: trim(cuePts, opts.cueLen),
    firstObj: obj ? obj.n : null,
    objPocket,
    cueScratch,
  };
}
