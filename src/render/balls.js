// Ball meshes: glossy clear-coated spheres with canvas textures, rolling
// orientation integrated from the physics angular velocity, and soft contact shadows.
import * as THREE from 'three';
import { R } from '../core/constants.js';
import { ON_TABLE, FALLING } from '../core/physics.js';
import { ballTexture, radialTexture } from './textures.js';
import { SLATE_Y } from './table.js';

const sphereGeo = new THREE.SphereGeometry(R, 48, 32);
const shadowGeo = new THREE.PlaneGeometry(R * 3.2, R * 3.2).rotateX(-Math.PI / 2);
let shadowTex = null;

const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();

export class BallSet {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'balls';
    scene.add(this.group);
    this.meshes = new Map();
    this.shadows = new Map();
    this.quats = new Map();
    if (!shadowTex) shadowTex = radialTexture('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)');
    this.shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.85 });
    this.envIntensity = 1;
    this.intro = null; // racking animation state
  }

  // Balls drop and slide into the rack one by one (visual only).
  playRackIntro(sim) {
    const objs = sim.balls.filter((b) => b.n !== 0).sort((a, b) => a.x - b.x || a.y - b.y);
    this.intro = { t: 0, delays: new Map(objs.map((b, i) => [b.n, 0.05 + i * 0.045])) };
  }

  ensure(n) {
    if (this.meshes.has(n)) return this.meshes.get(n);
    const mat = new THREE.MeshPhysicalMaterial({
      map: ballTexture(n),
      roughness: 0.14,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMapIntensity: this.envIntensity,
    });
    const m = new THREE.Mesh(sphereGeo, mat);
    m.castShadow = true;
    m.receiveShadow = false;
    // random initial orientation so the numbers face different ways
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    if (n !== 0) {
      // keep the number roughly visible from above
      q.setFromEuler(new THREE.Euler(-Math.PI / 2 + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, Math.random() * Math.PI * 2, 'YXZ'));
    }
    this.quats.set(n, q);
    m.quaternion.copy(q);
    this.group.add(m);
    this.meshes.set(n, m);
    const sh = new THREE.Mesh(shadowGeo, this.shadowMat);
    sh.renderOrder = 1;
    this.group.add(sh);
    this.shadows.set(n, sh);
    return m;
  }

  setEnvIntensity(v) {
    this.envIntensity = v;
    for (const m of this.meshes.values()) m.material.envMapIntensity = v;
  }

  setShadowOpacity(v) {
    this.shadowMat.opacity = v;
  }

  // Sync with the simulation. dt is the frame time (for orientation integration).
  sync(sim, dt, hidden = null) {
    const seen = new Set();
    if (this.intro) {
      this.intro.t += dt;
      if (this.intro.t > 1.4) this.intro = null;
    }
    for (const b of sim.balls) {
      const m = this.ensure(b.n);
      seen.add(b.n);
      const sh = this.shadows.get(b.n);
      const visible = b.state === ON_TABLE || b.state === FALLING;
      m.visible = visible && !(hidden && hidden.has(b.n));
      sh.visible = m.visible && b.z > -R * 0.5;
      if (!visible) continue;
      m.position.set(b.x, SLATE_Y + R + b.z, -b.y);
      if (this.intro && this.intro.delays.has(b.n)) {
        const k = Math.max(0, Math.min(1, (this.intro.t - this.intro.delays.get(b.n)) / 0.35));
        const e = 1 - Math.pow(1 - k, 3);
        m.position.y += (1 - e) * 0.25 + Math.sin(k * Math.PI) * 0.02;
        m.position.x += (1 - e) * 0.18;
        m.visible = m.visible && k > 0;
      }
      // integrate rotation: world angular velocity (three axes)
      const wx = b.wx;
      const wy = b.wz;
      const wz = -b.wy;
      const w = Math.hypot(wx, wy, wz);
      if (w > 1e-6 && dt > 0) {
        tmpV.set(wx / w, wy / w, wz / w);
        tmpQ.setFromAxisAngle(tmpV, w * dt);
        const q = this.quats.get(b.n);
        q.premultiply(tmpQ).normalize();
        m.quaternion.copy(q);
      }
      sh.position.set(b.x + 0.004, SLATE_Y + 0.0006, -b.y + 0.003);
      const s = 1 + Math.max(0, b.z) * 12;
      sh.scale.set(s, 1, s);
    }
    for (const [n, m] of this.meshes) {
      if (!seen.has(n)) {
        m.visible = false;
        this.shadows.get(n).visible = false;
      }
    }
  }

  mesh(n) {
    return this.meshes.get(n);
  }
}
