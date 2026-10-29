// Mouse, touch and keyboard input -> game actions.
import * as THREE from 'three';
import { R } from '../core/constants.js';
import { SLATE_Y } from '../render/table.js';

export class Input {
  constructor(app, canvas) {
    this.app = app;
    this.canvas = canvas;
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(SLATE_Y + R));
    this.pointers = new Map();
    this.mode = null; // pull | drag | aimdrag | cam | pinch
    this.keys = new Set();
    this.shift = false;
    this.startY = 0;
    this.startX = 0;
    this.moved = 0;
    this.pinchDist = 0;
    this.fast = false;

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e, true));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.app.stage.rig.zoom(Math.sign(e.deltaY) * 0.08);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.shift = false;
      if (this.mode === 'pull') this.app.cancelPull();
      else if (this.mode === 'drag') this.app.endDrag();
      this.pointers.clear();
      this.mode = null;
    });
  }

  tablePoint(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.app.stage.camera);
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.plane, p)) return null;
    return [p.x, -p.z];
  }

  down(e) {
    const app = this.app;
    app.audio.init();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (app.mode === 'menu') return;
    if (app.phase === 'roll') {
      this.fast = true;
      return;
    }
    if (this.pointers.size === 2) {
      // second finger: camera gesture
      if (this.mode === 'pull') app.cancelPull();
      if (this.mode === 'drag') app.endDrag();
      this.mode = 'pinch';
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchMid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      return;
    }
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.moved = 0;
    if (e.pointerType === 'mouse' && e.button === 2) {
      this.mode = 'cam';
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const pt = this.tablePoint(e.clientX, e.clientY);
    if (pt && app.tryStartDrag(pt)) {
      this.mode = 'drag';
      return;
    }
    if (e.pointerType !== 'mouse') {
      this.mode = 'aimdrag';
      this.lastX = e.clientX;
      if (pt && app.stage.rig.mode !== 'cue') app.aimAt(pt);
      return;
    }
    if (app.canShoot()) {
      this.mode = 'pull';
      app.beginPull();
    } else this.mode = 'click';
  }

  move(e) {
    const app = this.app;
    const prev = this.pointers.get(e.pointerId);
    if (prev) {
      prev.x = e.clientX;
      prev.y = e.clientY;
    }
    if (app.mode === 'menu') return;
    this.shift = e.shiftKey;
    const sens = app.store.settings.sensitivity;
    if (this.mode === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      if (this.pinchDist > 0) app.stage.rig.zoom((this.pinchDist - d) / 300);
      const dx = mid[0] - this.pinchMid[0];
      const dy = mid[1] - this.pinchMid[1];
      if (app.stage.rig.mode === 'orbit') app.stage.rig.rotateOrbit(dx * 0.006, dy * 0.004);
      else if (app.stage.rig.mode === 'cue') app.stage.rig.pitch(dy * 0.002);
      this.pinchDist = d;
      this.pinchMid = mid;
      return;
    }
    if (!prev && e.pointerType !== 'mouse') return;
    const dx = e.movementX ?? 0;
    const dy = e.movementY ?? 0;
    this.moved += Math.abs(dx) + Math.abs(dy);
    if (this.mode === 'cam') {
      if (app.stage.rig.mode === 'orbit') app.stage.rig.rotateOrbit(dx * 0.006, dy * 0.004);
      else app.stage.rig.pitch(dy * 0.002);
      return;
    }
    if (this.mode === 'drag') {
      const pt = this.tablePoint(e.clientX, e.clientY);
      if (pt) app.dragTo(pt);
      return;
    }
    if (this.mode === 'pull') {
      const h = window.innerHeight * 0.3;
      let p = (e.clientY - this.startY) / h;
      if (app.store.settings.invertPull) p = -p;
      app.setPull(p);
      return;
    }
    if (this.mode === 'aimdrag') {
      const ddx = e.clientX - (this.lastX ?? e.clientX);
      this.lastX = e.clientX;
      if (app.stage.rig.mode === 'cue') app.rotateAim(-ddx * 0.004 * sens);
      else {
        const pt = this.tablePoint(e.clientX, e.clientY);
        if (pt) app.aimAt(pt);
      }
      return;
    }
    // mouse hover aiming (ignore when the pointer is over a HUD widget)
    if (e.pointerType === 'mouse' && !this.mode && app.phase === 'aim' && !app.pulling) {
      if (e.target && e.target.closest && e.target.closest('#ui')) return;
      if (app.stage.rig.mode === 'cue' || e.shiftKey) {
        app.rotateAim(-dx * 0.0032 * sens * (e.shiftKey ? 0.1 : 1));
      } else {
        const pt = this.tablePoint(e.clientX, e.clientY);
        if (pt) app.aimAt(pt);
      }
    }
  }

  up(e, cancel = false) {
    const app = this.app;
    this.pointers.delete(e.pointerId);
    this.fast = false;
    if (this.mode === 'pinch') {
      if (this.pointers.size === 0) this.mode = null;
      return;
    }
    const mode = this.mode;
    this.mode = null;
    if (app.mode === 'menu') return;
    const pt = this.tablePoint(e.clientX, e.clientY);
    if (mode === 'pull') {
      if (cancel) app.cancelPull();
      else {
        const clicked = this.moved < 6;
        app.releasePull();
        if (clicked && pt) app.onTableClick(pt);
      }
    } else if (mode === 'drag') app.endDrag();
    else if ((mode === 'aimdrag' || mode === 'click') && this.moved < 8 && pt) app.onTableClick(pt);
  }

  key(e, down) {
    const app = this.app;
    this.shift = e.shiftKey;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const k = e.code;
    if (down) {
      if (this.keys.has(k)) return;
      this.keys.add(k);
      app.audio.init();
      if (k === 'Escape') {
        if (app.mode !== 'menu') app.paused ? app.resume() : app.pause();
      } else if (app.mode === 'menu' || app.paused) return;
      else if (k === 'KeyC') app.cycleCamera();
      else if (k === 'Digit1') app.setCamera('cue');
      else if (k === 'Digit2') app.setCamera('top');
      else if (k === 'Digit3') app.setCamera('orbit');
      else if (k === 'KeyX') app.setSpin(0, 0);
      else if (k === 'KeyM') app.toggleMute();
      else if (k === 'KeyP') app.togglePush?.();
      else if (k === 'Space') {
        e.preventDefault();
        if (app.phase === 'roll') this.fast = true;
        else if (app.canShoot()) {
          app.beginPull();
          this.spaceCharge = 0;
        }
      } else if (k === 'Enter') {
        if (app.phase === 'push') app.answerPush(true);
      }
    } else {
      this.keys.delete(k);
      if (k === 'Space') {
        this.fast = false;
        if (this.spaceCharge !== undefined && app.pulling) app.releasePull();
        this.spaceCharge = undefined;
      }
    }
    if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) e.preventDefault();
  }

  // continuous keyboard actions (called every frame)
  update(dt) {
    const app = this.app;
    if (app.mode === 'menu' || app.paused) return;
    const fine = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const rate = (fine ? 0.04 : 0.55) * app.store.settings.sensitivity;
    if (app.phase === 'aim') {
      if (this.keys.has('ArrowLeft')) app.rotateAim(rate * dt);
      if (this.keys.has('ArrowRight')) app.rotateAim(-rate * dt);
      const sp = dt * 1.2;
      let { spinX, spinY } = app.aim;
      if (this.keys.has('KeyW')) spinY += sp;
      if (this.keys.has('KeyS')) spinY -= sp;
      if (this.keys.has('KeyA')) spinX -= sp;
      if (this.keys.has('KeyD')) spinX += sp;
      if (spinX !== app.aim.spinX || spinY !== app.aim.spinY) app.setSpin(spinX, spinY);
      if (this.keys.has('KeyE')) app.setElevation(app.aim.elevationDeg + dt * 30);
      if (this.keys.has('KeyQ')) app.setElevation(app.aim.elevationDeg - dt * 30);
      if (this.keys.has('ArrowUp')) app.stage.rig.pitch(dt * 0.3);
      if (this.keys.has('ArrowDown')) app.stage.rig.pitch(-dt * 0.3);
    }
    if (this.spaceCharge !== undefined && app.pulling) {
      this.spaceCharge += dt;
      // ping-pong 0..1 over 1.6 s
      const c = (this.spaceCharge / 1.6) % 2;
      app.setPull(c <= 1 ? c : 2 - c);
    }
  }
}
