// Camera rig: cue view (behind the cue ball), overhead, free orbit, and a smooth
// "follow the action" mode while balls are rolling.
import * as THREE from 'three';
import { HX, HY } from '../core/constants.js';
import { SLATE_Y } from './table.js';

const damp = (k, dt) => 1 - Math.exp(-k * dt);

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'cue'; // cue | top | orbit
    this.pos = new THREE.Vector3(-3, 1.8, 0);
    this.look = new THREE.Vector3(0, SLATE_Y, 0);
    this.goalPos = this.pos.clone();
    this.goalLook = this.look.clone();
    this.cueDist = 0.95;
    this.cuePitch = 0.13; // camera height above the ball (m)
    this.orbit = { theta: -0.6, phi: 0.75, radius: 3.6 };
    this.speed = 4;
    this.following = false;
    this.followDir = new THREE.Vector3(1, 0, 0);
    this.attract = false;
    this.attractT = 0;
    this.snapNext = false;
  }

  setMode(m) {
    if (m !== this.mode) {
      this.mode = m;
      this.speed = 4;
    }
  }

  cycleMode() {
    const order = ['cue', 'top', 'orbit'];
    this.setMode(order[(order.indexOf(this.mode) + 1) % order.length]);
    return this.mode;
  }

  zoom(delta) {
    if (this.mode === 'cue') this.cueDist = THREE.MathUtils.clamp(this.cueDist * (1 + delta), 0.45, 2.2);
    else if (this.mode === 'orbit') this.orbit.radius = THREE.MathUtils.clamp(this.orbit.radius * (1 + delta), 1.2, 7);
  }

  rotateOrbit(dx, dy) {
    this.orbit.theta -= dx;
    this.orbit.phi = THREE.MathUtils.clamp(this.orbit.phi + dy, 0.12, 1.5);
  }

  pitch(dy) {
    this.cuePitch = THREE.MathUtils.clamp(this.cuePitch + dy, 0.06, 0.9);
  }

  topHeight() {
    const aspect = this.camera.aspect;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const needH = (2 * HY + 0.45) / (2 * Math.tan(fov / 2));
    const needW = (2 * HX + 0.5) / (2 * Math.tan(fov / 2) * aspect);
    return Math.max(needH, needW);
  }

  // ctx: { phase, cue: Vector3 (cue ball world pos), aim (rad), centroid: Vector3|null, spread }
  update(dt, ctx) {
    const P = this.goalPos;
    const L = this.goalLook;
    let k = this.speed;
    this.speed = Math.min(this.speed + dt * 18, 26);
    if (this.debugView) {
      P.copy(this.debugView.pos);
      L.copy(this.debugView.look);
      k = 50;
    } else if (this.attract) {
      this.attractT += dt * 0.08;
      const r = 2.9;
      P.set(Math.cos(this.attractT) * r, SLATE_Y + 0.72, Math.sin(this.attractT) * r * 0.62);
      L.set(0, SLATE_Y, 0);
      k = 2;
    } else if (ctx.phase === 'roll' && this.mode === 'cue' && ctx.centroid) {
      // pull up and follow the action
      const c = ctx.centroid;
      const back = this.followDir.clone().multiplyScalar(-1.25 - ctx.spread * 0.6);
      P.set(c.x + back.x, SLATE_Y + 1.15 + ctx.spread * 0.7, c.z + back.z);
      L.set(c.x, SLATE_Y, c.z);
      k = 2.2;
    } else if (this.mode === 'top' || (ctx.phase === 'place' && this.mode === 'cue')) {
      P.set(0, SLATE_Y + this.topHeight(), 0.02);
      L.set(0, SLATE_Y, 0);
      k = Math.min(k, 5);
    } else if (this.mode === 'orbit') {
      const o = this.orbit;
      const t = ctx.cue && ctx.phase !== 'roll' ? ctx.cue : new THREE.Vector3(0, SLATE_Y, 0);
      L.lerp(new THREE.Vector3(t.x * 0.4, SLATE_Y, t.z * 0.4), 0.5);
      P.set(L.x + Math.cos(o.theta) * Math.cos(o.phi) * o.radius, SLATE_Y + Math.sin(o.phi) * o.radius, L.z + Math.sin(o.theta) * Math.cos(o.phi) * o.radius);
      k = Math.min(k, 8);
    } else if (ctx.cue) {
      // cue view: behind the cue ball looking along the aim
      const dx = Math.cos(ctx.aim);
      const dz = -Math.sin(ctx.aim);
      this.followDir.set(dx, 0, dz);
      const d = this.cueDist;
      P.set(ctx.cue.x - dx * d, ctx.cue.y + this.cuePitch + d * 0.12, ctx.cue.z - dz * d);
      L.set(ctx.cue.x + dx * 0.55, ctx.cue.y - 0.02, ctx.cue.z + dz * 0.55);
    }
    if (this.snapNext) {
      this.pos.copy(P);
      this.look.copy(L);
      this.snapNext = false;
    } else {
      const a = damp(k, dt);
      this.pos.lerp(P, a);
      this.look.lerp(L, a);
    }
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
