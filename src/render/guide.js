// Aiming guide: flat ribbons on the cloth for the cue path to first contact,
// a ghost ball, and short predicted paths for the object ball and cue ball.
import * as THREE from 'three';
import { R } from '../core/constants.js';
import { SLATE_Y } from './table.js';

class Ribbon {
  constructor(color, width, maxPts = 256, opacity = 0.85, dashed = false) {
    this.max = maxPts;
    this.width = width;
    this.pos = new Float32Array(maxPts * 2 * 3);
    this.alpha = new Float32Array(maxPts * 2);
    const idx = [];
    for (let i = 0; i < maxPts - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: opacity }, dashed: { value: dashed ? 1 : 0 } },
      vertexShader: `attribute float alpha; varying float vA;
        void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `uniform vec3 color; uniform float opacity; varying float vA;
        void main(){ gl_FragColor = vec4(color, opacity * vA); }`,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }
  // pts: array of [x, y] physics coords; fade: fade out towards the end
  set(pts, fade = true, y = SLATE_Y + 0.0015) {
    const n = Math.min(pts.length, this.max);
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    let total = 0;
    const lens = [0];
    for (let i = 1; i < n; i++) {
      total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      lens.push(total);
    }
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[Math.min(n - 1, i + 1)];
      const o = pts[Math.max(0, i - 1)];
      let tx = q[0] - o[0];
      let ty = q[1] - o[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const nx = -ty * this.width * 0.5;
      const ny = tx * this.width * 0.5;
      const k = i * 6;
      this.pos[k] = p[0] + nx;
      this.pos[k + 1] = y;
      this.pos[k + 2] = -(p[1] + ny);
      this.pos[k + 3] = p[0] - nx;
      this.pos[k + 4] = y;
      this.pos[k + 5] = -(p[1] - ny);
      const a = fade && total > 0 ? 1 - Math.pow(lens[i] / total, 1.5) : 1;
      this.alpha[i * 2] = a;
      this.alpha[i * 2 + 1] = a;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
  }
  clear() {
    this.geo.setDrawRange(0, 0);
  }
}

export class Guide {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.aim = new Ribbon('#ffffff', 0.0035, 8, 0.7, false);
    this.obj = new Ribbon('#ffd75a', 0.004, 256, 0.9);
    this.cue = new Ribbon('#7fd3ff', 0.0035, 256, 0.75);
    this.group.add(this.aim.mesh, this.obj.mesh, this.cue.mesh);
    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(R, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false })
    );
    const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.96, R * 1.04, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
    ring.position.y = -R + 0.0018;
    this.ghost.add(ring);
    this.group.add(this.ghost);
    this.visible = true;
  }
  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }
  // pred: { aimPts, ghost: [x,y]|null, objPts, cuePts }
  update(pred) {
    if (!pred) {
      this.aim.clear();
      this.obj.clear();
      this.cue.clear();
      this.ghost.visible = false;
      return;
    }
    this.aim.set(pred.aimPts, false);
    if (pred.ghost) {
      this.ghost.visible = true;
      this.ghost.position.set(pred.ghost[0], SLATE_Y + R + (pred.ghostZ || 0), -pred.ghost[1]);
    } else this.ghost.visible = false;
    if (pred.objPts && pred.objPts.length > 1) this.obj.set(pred.objPts);
    else this.obj.clear();
    if (pred.cuePts && pred.cuePts.length > 1) this.cue.set(pred.cuePts);
    else this.cue.clear();
  }
}
