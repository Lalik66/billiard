// Custom billiards physics engine.
//
// - Fixed timestep (DT) integration of friction / spin per ball.
// - Inside every step, motion is advanced with continuous collision detection:
//   the earliest time of impact among all ball pairs and all cushion segments /
//   cushion nose points is found analytically, every ball is advanced to that
//   moment, the collision is resolved, and the search repeats for the rest of
//   the step. Balls therefore never tunnel through each other or the cushions.
// - Ball-ball collisions use impulses with restitution plus surface friction
//   (cut-induced and spin-induced throw). Cushion collisions use an elevated
//   contact point with friction so english changes the rebound angle.
// - Pockets are holes in the slate: a ball whose centre passes over the hole
//   falls (visible drop) unless it arrives too fast / too thin, in which case it
//   rattles back out.

import {
  R,
  G,
  HX,
  HY,
  MU_SLIDE,
  MU_ROLL,
  MU_SPIN,
  E_BALL,
  E_SLATE,
  MU_CUSHION,
  CUSHION_H,
  TABLE,
  MAX_TIP_OFFSET,
} from './constants.js';

export const ON_TABLE = 0;
export const FALLING = 1;
export const POCKETED = 2;

export const DT = 1 / 480;
const MAX_JUMP_VZ = 1.7; // ~15 cm hop at most, like a real jump cue

const R2 = R * R;
const D2 = 4 * R * R;
const INV_I = 5 / (2 * R * R); // 1/(I/m) for a solid sphere
const SPIN_DECEL = (5 * MU_SPIN * G) / (2 * R);
const SIN_PHI = (CUSHION_H - R) / R; // cushion contact above the ball centre
const COS_PHI = Math.sqrt(1 - SIN_PHI * SIN_PHI);
const SEGS = TABLE.segments;
const PTS = TABLE.points;
const POCKETS = TABLE.pockets;

export class Ball {
  constructor(n, x = 0, y = 0) {
    this.n = n;
    this.x = x;
    this.y = y;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.wx = 0;
    this.wy = 0;
    this.wz = 0;
    this.state = ON_TABLE;
    this.pocket = -1;
    this.moving = false;
    this.px = x;
    this.py = y;
  }
  speed() {
    return Math.hypot(this.vx, this.vy, this.vz);
  }
}

export class Sim {
  constructor() {
    this.balls = [];
    this.byNum = new Map();
    this.events = [];
    this.time = 0;
    this.failsafe = 0; // counts emergency corrections (should stay 0)
    this.maxIter = 0;
    this.ccdCapHits = 0; // counts steps where the CCD iteration cap tripped (should stay 0)
  }

  setBalls(list) {
    this.balls = [];
    this.byNum.clear();
    for (const b of list) {
      const ball = new Ball(b.n, b.x, b.y);
      if (b.state !== undefined && b.state !== ON_TABLE) {
        ball.state = POCKETED;
        ball.pocket = b.pocket ?? -1;
      }
      this.balls.push(ball);
      this.byNum.set(b.n, ball);
    }
    this.events = [];
    this.time = 0;
  }

  ball(n) {
    return this.byNum.get(n);
  }

  snapshot() {
    return this.balls.map((b) => ({ n: b.n, x: b.x, y: b.y, state: b.state === ON_TABLE ? ON_TABLE : POCKETED, pocket: b.pocket }));
  }

  restore(snap) {
    this.setBalls(snap);
  }

  onTable() {
    return this.balls.filter((b) => b.state === ON_TABLE);
  }

  // Strike the cue ball.
  // shot: { angle (rad), speed (m/s), spinX (-1..1 right english), spinY (-1..1 top), elevation (rad) }
  strike(n, shot) {
    const b = this.ball(n);
    const ang = shot.angle;
    const V = shot.speed;
    const el = Math.max(0, Math.min(1.2, shot.elevation || 0));
    let a = (shot.spinX || 0) * MAX_TIP_OFFSET;
    let c = (shot.spinY || 0) * MAX_TIP_OFFSET;
    const m = Math.hypot(a, c);
    if (m > MAX_TIP_OFFSET) {
      a *= MAX_TIP_OFFSET / m;
      c *= MAX_TIP_OFFSET / m;
    }
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    // cue direction (forward, tilted down by the elevation)
    const fx = Math.cos(el) * dx;
    const fy = Math.cos(el) * dy;
    const fz = -Math.sin(el);
    // right vector (horizontal)
    const rx = dy;
    const ry = -dx;
    const rz = 0;
    // up vector in the cue frame = right x forward
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;
    const k = Math.sqrt(Math.max(0, 1 - a * a - c * c));
    // contact point relative to the ball centre
    const cx = R * (a * rx + c * ux - k * fx);
    const cy = R * (a * ry + c * uy - k * fy);
    const cz = R * (a * rz + c * uz - k * fz);
    // linear velocity
    b.vx = V * fx;
    b.vy = V * fy;
    // the downward part of the impulse is reflected by the slate
    const vzIn = V * fz;
    b.vz = vzIn < 0 ? Math.min(MAX_JUMP_VZ, -vzIn * E_SLATE * 1.15) : 0;
    if (b.vz < 0.15) b.vz = 0;
    // angular velocity  w = (5V / 2R^2) (c x f)
    const s = (INV_I * V);
    b.wx = s * (cy * fz - cz * fy);
    b.wy = s * (cz * fx - cx * fz);
    b.wz = s * (cx * fy - cy * fx);
    b.moving = true;
    this.events.push({ t: this.time, type: 'strike', a: n, speed: V });
  }

  isMoving() {
    for (const b of this.balls) {
      if (b.state === FALLING) return true;
      if (b.state === ON_TABLE && b.moving) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------
  step() {
    const dt = DT;
    const balls = this.balls;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.state === ON_TABLE) {
        b.px = b.x;
        b.py = b.y;
        if (b.moving) this._forces(b, dt);
      }
    }
    this._advance(dt);
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.state === ON_TABLE) {
        if (b.z < 0) {
          b.z = 0;
          if (b.vz < 0) {
            const impact = -b.vz;
            b.vz = impact * E_SLATE;
            if (b.vz < 0.15) b.vz = 0;
            if (impact > 0.3) this.events.push({ t: this.time, type: 'land', a: b.n, speed: impact });
          }
        }
        if (b.moving && b.z < 0.004) this._pocketCheck(b);
      } else if (b.state === FALLING) {
        this._fall(b, dt);
      }
    }
    this._safety();
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (b.state === ON_TABLE && b.moving) this._stopCheck(b);
    }
    this.time += dt;
  }

  // run until everything stops (or the time limit)
  run(maxTime = 40) {
    const end = this.time + maxTime;
    while (this.isMoving() && this.time < end) this.step();
    // force stop
    if (this.isMoving()) {
      for (const b of this.balls) {
        if (b.state === FALLING) {
          b.state = POCKETED;
        }
        this._zero(b);
      }
    }
  }

  // ---------------------------------------------------------------------
  _zero(b) {
    b.vx = b.vy = b.vz = 0;
    b.wx = b.wy = b.wz = 0;
    b.moving = false;
  }

  _forces(b, dt) {
    if (b.z > 0 || b.vz > 0) {
      // airborne: only gravity
      b.vz -= G * dt;
      return;
    }
    // contact point slip velocity u = v + w x (-R z)
    const ux = b.vx - R * b.wy;
    const uy = b.vy + R * b.wx;
    const us = Math.hypot(ux, uy);
    if (us > 1e-4) {
      const dec = MU_SLIDE * G * dt;
      if (3.5 * dec >= us) {
        b.vx -= ux / 3.5;
        b.vy -= uy / 3.5;
        b.wx = -b.vy / R;
        b.wy = b.vx / R;
      } else {
        const ex = ux / us;
        const ey = uy / us;
        b.vx -= dec * ex;
        b.vy -= dec * ey;
        const k = (2.5 * dec) / R;
        b.wx -= k * ey;
        b.wy += k * ex;
      }
    } else {
      const v = Math.hypot(b.vx, b.vy);
      if (v > 0) {
        const dv = MU_ROLL * G * dt;
        if (dv >= v) {
          b.vx = b.vy = 0;
        } else {
          const f = (v - dv) / v;
          b.vx *= f;
          b.vy *= f;
        }
      }
      b.wx = -b.vy / R;
      b.wy = b.vx / R;
    }
    // spin around the vertical axis
    if (b.wz !== 0) {
      const d = SPIN_DECEL * dt;
      if (Math.abs(b.wz) <= d) b.wz = 0;
      else b.wz -= Math.sign(b.wz) * d;
    }
  }

  _stopCheck(b) {
    if (b.z > 0 || b.vz !== 0) return;
    const v = Math.hypot(b.vx, b.vy);
    if (v > 0.003) return;
    const ux = b.vx - R * b.wy;
    const uy = b.vy + R * b.wx;
    if (Math.hypot(ux, uy) > 0.003) return;
    if (Math.abs(b.wz) > 0.5) {
      b.vx = b.vy = 0;
      b.wx = b.wy = 0;
      return;
    }
    this._zero(b);
  }

  // Advance all on-table balls by dt with continuous collision detection.
  _advance(dt) {
    const balls = this.balls;
    const n = balls.length;
    let rem = dt;
    let iter = 0;
    while (rem > 1e-12) {
      let tMin = rem;
      let kind = 0; // 1 ball-ball, 2 segment, 3 point
      let A = null;
      let B = null;
      let S = null;
      let side = 1;
      for (let i = 0; i < n; i++) {
        const a = balls[i];
        if (a.state !== ON_TABLE) continue;
        if (a.moving) {
          // cushion broadphase: can the ball reach the boundary this step?
          const reachX = Math.abs(a.x) + Math.abs(a.vx) * tMin + R;
          const reachY = Math.abs(a.y) + Math.abs(a.vy) * tMin + R;
          if (reachX > HX - 1e-4 || reachY > HY - 1e-4) {
            for (let k = 0; k < SEGS.length; k++) {
              const sg = SEGS[k];
              let rx = a.x - sg.ax;
              let ry = a.y - sg.ay;
              let s0 = rx * sg.nx + ry * sg.ny;
              let vn = a.vx * sg.nx + a.vy * sg.ny;
              let sd = 1;
              if (s0 < 0) {
                s0 = -s0;
                vn = -vn;
                sd = -1;
              }
              if (vn >= 0) continue;
              let t = (s0 - R) / -vn;
              if (t < 0) t = 0;
              if (t >= tMin) continue;
              const q = (rx + a.vx * t) * sg.dx + (ry + a.vy * t) * sg.dy;
              if (q < 0 || q > sg.len) continue;
              tMin = t;
              kind = 2;
              A = a;
              S = sg;
              side = sd;
            }
            for (let k = 0; k < PTS.length; k++) {
              const p = PTS[k];
              const rx = a.x - p[0];
              const ry = a.y - p[1];
              const bb = rx * a.vx + ry * a.vy;
              if (bb >= 0) continue;
              const cc = rx * rx + ry * ry - R2;
              let t;
              if (cc <= 0) t = 0;
              else {
                const aa = a.vx * a.vx + a.vy * a.vy;
                const disc = bb * bb - aa * cc;
                if (disc < 0) continue;
                t = (-bb - Math.sqrt(disc)) / aa;
              }
              if (t < tMin) {
                tMin = t;
                kind = 3;
                A = a;
                S = p;
              }
            }
          }
        }
        for (let j = i + 1; j < n; j++) {
          const b = balls[j];
          if (b.state !== ON_TABLE) continue;
          if (!a.moving && !b.moving) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dz = b.z - a.z;
          const dvx = b.vx - a.vx;
          const dvy = b.vy - a.vy;
          const dvz = b.vz - a.vz;
          const bb = dx * dvx + dy * dvy + dz * dvz;
          if (bb >= 0) continue;
          // quick reject: too far apart to meet within tMin
          const cc = dx * dx + dy * dy + dz * dz - D2;
          let t;
          if (cc <= 0) t = 0;
          else {
            const aa = dvx * dvx + dvy * dvy + dvz * dvz;
            const disc = bb * bb - aa * cc;
            if (disc < 0) continue;
            t = (-bb - Math.sqrt(disc)) / aa;
          }
          if (t < tMin) {
            tMin = t;
            kind = 1;
            A = a;
            B = b;
          }
        }
      }
      // advance everything to tMin
      if (tMin > 0) {
        for (let i = 0; i < n; i++) {
          const b = balls[i];
          if (b.state !== ON_TABLE || !b.moving) continue;
          b.x += b.vx * tMin;
          b.y += b.vy * tMin;
          b.z += b.vz * tMin;
        }
      }
      rem -= tMin;
      if (kind === 0) break;
      if (kind === 1) {
        if (!this._collideCluster(A, B)) this._collideBalls(A, B);
      }
      else if (kind === 2) this._collideCushion(A, S.nx * side, S.ny * side, S.kind);
      else {
        const dx = A.x - S[0];
        const dy = A.y - S[1];
        const d = Math.hypot(dx, dy) || 1;
        this._collideCushion(A, dx / d, dy / d, 'jaw');
      }
      iter++;
      if (iter > 1500) {
        // pathological cluster: move on, the safety pass separates overlaps
        this.ccdCapHits++;
        this.events.push({ t: this.time, type: 'ccdcap' });
        for (let i = 0; i < n; i++) {
          const b = balls[i];
          if (b.state !== ON_TABLE || !b.moving) continue;
          b.x += b.vx * rem;
          b.y += b.vy * rem;
          b.z += b.vz * rem;
        }
        break;
      }
    }
    if (iter > this.maxIter) this.maxIter = iter;
  }

  // Large clusters of touching balls (a rack being broken) are resolved with a
  // short Hertzian contact micro-simulation. Pairwise event resolution would
  // send almost all of the energy down the rows like a Newton's cradle; the
  // compliant contacts let the impulse wave spread through the rack the way a
  // real break does. Small clusters (frozen combos) keep the exact pairwise model.
  _collideCluster(a, b) {
    const EPS = 0.0009;
    const lim2 = (2 * R + EPS) ** 2;
    const members = [a, b];
    const inSet = new Set(members);
    for (let k = 0; k < members.length; k++) {
      const m = members[k];
      for (const o of this.balls) {
        if (o.state !== ON_TABLE || inSet.has(o)) continue;
        const dx = o.x - m.x;
        const dy = o.y - m.y;
        const dz = o.z - m.z;
        if (dx * dx + dy * dy + dz * dz <= lim2) {
          inSet.add(o);
          members.push(o);
        }
      }
    }
    if (members.length < 4) return false;
    // keep clear of cushions (the micro-simulation has no walls)
    for (const m of members) {
      if (Math.abs(m.x) > HX - R - 0.05 || Math.abs(m.y) > HY - R - 0.05 || m.z > 0.001) return false;
    }
    const n = members.length;
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    const vx = new Float64Array(n);
    const vy = new Float64Array(n);
    const peak = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      px[i] = members[i].x;
      py[i] = members[i].y;
      vx[i] = members[i].vx;
      vy[i] = members[i].vy;
    }
    const K = 2.67e9; // Hertz stiffness per unit mass (phenolic resin balls)
    const h = 2e-6;
    const e2 = E_BALL * E_BALL;
    const D = 2 * R;
    for (let step = 0; step < 4000; step++) {
      let active = false;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = px[j] - px[i];
          const dy = py[j] - py[i];
          const d2 = dx * dx + dy * dy;
          if (d2 >= D * D) continue;
          const d = Math.sqrt(d2);
          const delta = D - d;
          const nx = dx / d;
          const ny = dy / d;
          const vrel = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny; // >0 compressing
          let f = K * delta * Math.sqrt(delta);
          if (vrel < 0) f *= e2; // unloading: hysteresis gives restitution ~e
          const imp = f * h;
          vx[i] -= imp * nx;
          vy[i] -= imp * ny;
          vx[j] += imp * nx;
          vy[j] += imp * ny;
          const k = i * n + j;
          if (vrel > peak[k]) peak[k] = vrel;
          active = true;
        }
      }
      for (let i = 0; i < n; i++) {
        px[i] += vx[i] * h;
        py[i] += vy[i] * h;
      }
      // the impulse exchange is over once nothing is compressed any more;
      // any pair still closing in is handled by the regular collision search
      if (!active && step > 0) break;
    }
    // treat the exchange as instantaneous: keep the (non-overlapping) start
    // positions and take only the new velocities
    for (let i = 0; i < n; i++) {
      const m = members[i];
      m.vx = vx[i];
      m.vy = vy[i];
      m.moving = true;
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const sp = peak[i * n + j];
        if (sp > 0.02) this.events.push({ t: this.time, type: 'hit', a: members[i].n, b: members[j].n, speed: sp });
      }
    }
    return true;
  }

  _collideBalls(a, b) {
    let nx = b.x - a.x;
    let ny = b.y - a.y;
    let nz = b.z - a.z;
    const d = Math.hypot(nx, ny, nz) || 1;
    nx /= d;
    ny /= d;
    nz /= d;
    const vrel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny + (a.vz - b.vz) * nz;
    if (vrel <= 0) return;
    let jn = ((1 + E_BALL) * vrel) / 2;
    // a ball landing on top of another must not settle into endless micro
    // collisions: enforce a small separation speed when height is involved
    if (Math.abs(nz) > 0.05) jn = Math.max(jn, (vrel + 0.05) / 2);
    a.vx -= jn * nx;
    a.vy -= jn * ny;
    a.vz -= jn * nz;
    b.vx += jn * nx;
    b.vy += jn * ny;
    b.vz += jn * nz;
    // surface friction (throw): contact velocities
    // ra = R n, rb = -R n ; v_c = v + w x r
    const cax = a.vx + (a.wy * nz - a.wz * ny) * R;
    const cay = a.vy + (a.wz * nx - a.wx * nz) * R;
    const caz = a.vz + (a.wx * ny - a.wy * nx) * R;
    const cbx = b.vx - (b.wy * nz - b.wz * ny) * R;
    const cby = b.vy - (b.wz * nx - b.wx * nz) * R;
    const cbz = b.vz - (b.wx * ny - b.wy * nx) * R;
    let tx = cax - cbx;
    let ty = cay - cby;
    let tz = caz - cbz;
    const tn = tx * nx + ty * ny + tz * nz;
    tx -= tn * nx;
    ty -= tn * ny;
    tz -= tn * nz;
    const vt = Math.hypot(tx, ty, tz);
    if (vt > 1e-6) {
      const mu = 0.00995 + 0.108 * Math.exp(-1.088 * vt);
      const jt = Math.min(mu * jn, vt / 7);
      tx /= vt;
      ty /= vt;
      tz /= vt;
      a.vx -= jt * tx;
      a.vy -= jt * ty;
      a.vz -= jt * tz;
      b.vx += jt * tx;
      b.vy += jt * ty;
      b.vz += jt * tz;
      // dw = INV_I * (R n x (-jt t))  (same for both balls)
      const k = -INV_I * R * jt;
      const qx = (ny * tz - nz * ty) * k;
      const qy = (nz * tx - nx * tz) * k;
      const qz = (nx * ty - ny * tx) * k;
      a.wx += qx;
      a.wy += qy;
      a.wz += qz;
      b.wx += qx;
      b.wy += qy;
      b.wz += qz;
    }
    // the slate absorbs any downward push on balls resting on it
    if (a.z <= 1e-6 && a.vz < 0) a.vz = 0;
    if (b.z <= 1e-6 && b.vz < 0) b.vz = 0;
    if (a.vz > 0 && a.vz < 0.05) a.vz = 0;
    if (b.vz > 0 && b.vz < 0.05) b.vz = 0;
    if (a.vz > MAX_JUMP_VZ) a.vz = MAX_JUMP_VZ;
    if (b.vz > MAX_JUMP_VZ) b.vz = MAX_JUMP_VZ;
    a.moving = true;
    b.moving = true;
    this.events.push({ t: this.time, type: 'hit', a: a.n, b: b.n, speed: vrel });
  }

  // (nx, ny): horizontal unit normal pointing from the cushion towards the ball centre
  _collideCushion(b, nx, ny, kind) {
    const vin = b.vx * nx + b.vy * ny;
    if (vin >= 0) return;
    const speedN = -vin;
    // contact point relative to the centre: above the equator for a ball on
    // the slate; an airborne ball meets the cushion face at its equator
    const airborne = b.z > 0.002;
    const sinP = airborne ? 0 : SIN_PHI;
    const cosP = airborne ? 1 : COS_PHI;
    const rcx = -nx * cosP * R;
    const rcy = -ny * cosP * R;
    const rcz = sinP * R;
    // impulse direction: from contact point to the centre
    const Nx = nx * cosP;
    const Ny = ny * cosP;
    const Nz = -sinP;
    const vN = airborne ? vin * 1 : b.vx * Nx + b.vy * Ny + Math.min(0, b.vz) * Nz;
    const e = Math.max(0.68, Math.min(0.9, 0.92 - 0.035 * speedN));
    const jn = -(1 + e) * Math.min(vN, -1e-4);
    b.vx += jn * Nx;
    b.vy += jn * Ny;
    if (!airborne) b.vz += jn * Nz;
    // friction at the contact point, along the cushion (horizontal tangent);
    // the vertical slip is taken by the slate.
    const cx = b.vx + (b.wy * rcz - b.wz * rcy);
    const cy = b.vy + (b.wz * rcx - b.wx * rcz);
    const thx = -ny;
    const thy = nx;
    const vts = cx * thx + cy * thy;
    const vt = Math.abs(vts);
    if (vt > 1e-6) {
      const jt = Math.min(MU_CUSHION * jn, vt / 3.5);
      const tx = Math.sign(vts) * thx;
      const ty = Math.sign(vts) * thy;
      const tz = 0;
      b.vx -= jt * tx;
      b.vy -= jt * ty;
      b.vz -= jt * tz;
      // dw = INV_I * (rc x (-jt t))
      const k = -INV_I * jt;
      b.wx += (rcy * tz - rcz * ty) * k;
      b.wy += (rcz * tx - rcx * tz) * k;
      b.wz += (rcx * ty - rcy * tx) * k;
    }
    // the ball must always leave the cushion
    const vout = b.vx * nx + b.vy * ny;
    const minOut = Math.max(1e-4, speedN * 0.3);
    if (vout < minOut) {
      b.vx += (minOut - vout) * nx;
      b.vy += (minOut - vout) * ny;
    }
    if (b.z <= 1e-6 && b.vz < 0) b.vz = 0;
    if (b.vz > 0 && b.vz < 0.2 && b.z <= 1e-6) b.vz = 0;
    b.moving = true;
    this.events.push({ t: this.time, type: 'cushion', a: b.n, speed: speedN, kind });
  }

  _pocketCheck(b) {
    for (let i = 0; i < POCKETS.length; i++) {
      const p = POCKETS[i];
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      if (dx * dx + dy * dy >= p.r * p.r) continue;
      // entering the hole: too fast or too thin rattles out
      const sp = Math.hypot(b.vx, b.vy);
      const ox = -p.nx; // direction into the pocket
      const oy = -p.ny;
      const cosA = sp > 1e-6 ? (b.vx * ox + b.vy * oy) / sp : 1;
      const c = Math.max(0, cosA);
      const vmax = p.type === 'corner' ? 2.4 + 3.6 * c * c * c * c : 1.6 + 3.6 * Math.pow(c, 6);
      if (sp > vmax && b.z <= 0) {
        // rattle: bounce back off the far jaw
        const vo = b.vx * ox + b.vy * oy;
        const lx = b.vx - vo * ox;
        const ly = b.vy - vo * oy;
        b.vx = (-Math.abs(vo) * ox + lx * 0.5) * 0.42;
        b.vy = (-Math.abs(vo) * oy + ly * 0.5) * 0.42;
        b.wx = b.wy = 0;
        b.wz *= 0.5;
        // put the ball back to where it was at the start of the step, just outside the hole
        b.x = b.px;
        b.y = b.py;
        let ddx = b.x - p.x;
        let ddy = b.y - p.y;
        let dd = Math.hypot(ddx, ddy) || 1;
        if (dd < p.r + 0.001) {
          b.x = p.x + (ddx / dd) * (p.r + 0.001);
          b.y = p.y + (ddy / dd) * (p.r + 0.001);
        }
        this.events.push({ t: this.time, type: 'rattle', a: b.n, pocket: i, speed: sp });
        return;
      }
      b.state = FALLING;
      b.pocket = i;
      b.moving = true;
      this.events.push({ t: this.time, type: 'pocket', a: b.n, pocket: i, speed: sp });
      return;
    }
  }

  _fall(b, dt) {
    const p = POCKETS[b.pocket];
    b.vz -= G * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    b.vx *= 0.985;
    b.vy *= 0.985;
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    const d = Math.hypot(dx, dy);
    const sink = Math.min(1, Math.max(0, -b.z / R));
    const lim = p.r - R * (0.15 + 0.85 * sink);
    if (d > lim && d > 1e-9) {
      const ex = dx / d;
      const ey = dy / d;
      b.x = p.x + ex * lim;
      b.y = p.y + ey * lim;
      const vr = b.vx * ex + b.vy * ey;
      if (vr > 0) {
        b.vx -= 1.3 * vr * ex;
        b.vy -= 1.3 * vr * ey;
      }
    }
    // keep a little roll for the visuals
    b.wx = -b.vy / R;
    b.wy = b.vx / R;
    if (b.z < -0.12) {
      b.state = POCKETED;
      this._zero(b);
    }
  }

  // Emergency separation / containment. With CCD this should never trigger;
  // it is a last line of defence and is counted in this.failsafe.
  _safety() {
    const balls = this.balls;
    const n = balls.length;
    // 1) Contain or recover any ball that escaped the playing area / went non-finite.
    for (let i = 0; i < n; i++) {
      const a = balls[i];
      if (a.state !== ON_TABLE) continue;
      if (Math.abs(a.x) > HX + 0.09 || Math.abs(a.y) > HY + 0.09 || !Number.isFinite(a.x) || !Number.isFinite(a.y)) {
        this.failsafe++;
        let best = 0;
        let bd = Infinity;
        for (let k = 0; k < POCKETS.length; k++) {
          const d = Math.hypot(a.x - POCKETS[k].x, a.y - POCKETS[k].y);
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
        if (!Number.isFinite(a.x)) a.x = 0;
        if (!Number.isFinite(a.y)) a.y = 0;
        a.state = FALLING;
        a.pocket = best;
        a.x = POCKETS[best].x;
        a.y = POCKETS[best].y;
        a.vx = a.vy = 0;
        this.events.push({ t: this.time, type: 'pocket', a: a.n, pocket: best, speed: 0 });
      }
    }
    // 2) Separate overlapping pairs. A single i<j pass can leave residual overlap
    //    in a chain of 3+ balls (fixing (i,j) can re-overlap (i,k)), so relax over
    //    several passes until no significant overlap remains. failsafe is counted
    //    once per genuinely-overlapping pair, on the first pass only.
    for (let pass = 0; pass < 8; pass++) {
      let worst = 0;
      for (let i = 0; i < n; i++) {
        const a = balls[i];
        if (a.state !== ON_TABLE) continue;
        for (let j = i + 1; j < n; j++) {
          const b = balls[j];
          if (b.state !== ON_TABLE) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dz = b.z - a.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < D2 * 0.9999) {
            const d = Math.sqrt(d2) || 1e-6;
            const overlap = 2 * R - d;
            const push = overlap / 2 + 1e-7;
            const ex = d > 1e-6 ? dx / d : 1;
            const ey = d > 1e-6 ? dy / d : 0;
            if (pass === 0 && overlap > 2e-4) this.failsafe++;
            if (overlap > worst) worst = overlap;
            a.x -= ex * push;
            a.y -= ey * push;
            b.x += ex * push;
            b.y += ey * push;
          }
        }
      }
      if (worst <= 2e-4) break;
    }
  }
}

// Utility: deterministic clone of a sim from a snapshot list
export function makeSim(list) {
  const s = new Sim();
  s.setBalls(list);
  return s;
}
