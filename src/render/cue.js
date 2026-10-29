// Procedural cue stick (lathe) with a stroke animation.
import * as THREE from 'three';
import { R, MAX_TIP_OFFSET } from '../core/constants.js';
import { SLATE_Y } from './table.js';

const LEN = 1.47;

function cueTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 2048;
  const g = c.getContext('2d');
  const H = c.height;
  // v=0 at the tip (canvas bottom maps to v=0 with flipY)
  const band = (v0, v1, color) => {
    g.fillStyle = color;
    g.fillRect(0, H - v1 * H, 64, (v1 - v0) * H);
  };
  band(0, 0.006, '#3a6fd8'); // chalked tip
  band(0.006, 0.02, '#f2efe6'); // ferrule
  // maple shaft with subtle grain
  band(0.02, 0.55, '#e7cf9f');
  g.globalAlpha = 0.12;
  for (let i = 0; i < 60; i++) {
    g.fillStyle = i % 2 ? '#b9955a' : '#fff4d8';
    const v = 0.02 + Math.random() * 0.53;
    g.fillRect(Math.random() * 64, H - v * H, 2, 30 + Math.random() * 60);
  }
  g.globalAlpha = 1;
  band(0.55, 0.56, '#c9c9c9'); // joint
  band(0.56, 0.75, '#3b1c10'); // forearm
  // points / inlays
  g.fillStyle = '#d9b46a';
  for (let k = 0; k < 4; k++) {
    const x = k * 16 + 8;
    g.beginPath();
    g.moveTo(x - 6, H - 0.6 * H);
    g.lineTo(x, H - 0.73 * H);
    g.lineTo(x + 6, H - 0.6 * H);
    g.closePath();
    g.fill();
  }
  band(0.75, 0.755, '#d9b46a');
  band(0.755, 0.92, '#151515'); // wrap
  g.globalAlpha = 0.25;
  for (let y = 0.755; y < 0.92; y += 0.004) band(y, y + 0.0015, '#444');
  g.globalAlpha = 1;
  band(0.92, 0.925, '#d9b46a');
  band(0.925, 0.99, '#4a2414'); // butt sleeve
  band(0.99, 1.0, '#0a0a0a'); // bumper
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Cue {
  constructor(scene) {
    const pts = [];
    const N = 160;
    for (let i = 0; i <= N; i++) {
      const v = i / N;
      let r;
      if (v < 0.004) r = 0.0058 + v * 0.1;
      else if (v < 0.55) r = 0.0062 + (v / 0.55) * 0.0028;
      else r = 0.009 + ((v - 0.55) / 0.45) * 0.0062;
      pts.push(new THREE.Vector2(r, v * LEN));
    }
    // close the butt
    pts.push(new THREE.Vector2(0.0001, LEN));
    pts.unshift(new THREE.Vector2(0.0001, 0));
    const geo = new THREE.LatheGeometry(pts, 24);
    const mat = new THREE.MeshPhysicalMaterial({ map: cueTexture(), roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.root = new THREE.Group();
    this.root.add(this.mesh);
    scene.add(this.root);
    // tip contact marker on the cue ball
    this.marker = new THREE.Mesh(new THREE.CircleGeometry(R * 0.11, 16), new THREE.MeshBasicMaterial({ color: 0x3a8bff, transparent: true, opacity: 0.85, depthTest: true }));
    scene.add(this.marker);
    this.opacity = 1;
    this.visible = true;
  }

  // ballPos: THREE.Vector3 centre of the cue ball (world)
  // pull: distance the tip is drawn back from the ball (m)
  setPose(ballPos, angle, elevation, spinX, spinY, pull) {
    const el = Math.max(elevation, 0.07);
    const dx = Math.cos(angle);
    const dz = -Math.sin(angle);
    // forward (direction of the stroke) in world space
    const f = new THREE.Vector3(Math.cos(el) * dx, -Math.sin(el), Math.cos(el) * dz);
    const right = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)); // physics right = (dy, -dx)
    const up = new THREE.Vector3().crossVectors(right, f).normalize();
    const a = spinX * MAX_TIP_OFFSET;
    const c = spinY * MAX_TIP_OFFSET;
    const k = Math.sqrt(Math.max(0, 1 - a * a - c * c));
    const contact = ballPos
      .clone()
      .addScaledVector(right, a * R)
      .addScaledVector(up, c * R)
      .addScaledVector(f, -k * R);
    const tip = contact.clone().addScaledVector(f, -pull - 0.002);
    // the cue's +Y axis points from tip to butt = -f
    this.root.position.copy(tip);
    this.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), f.clone().negate());
    // marker on the ball surface
    this.marker.position.copy(contact).addScaledVector(f, -0.0008);
    this.marker.lookAt(contact.clone().addScaledVector(f, -1));
  }

  show(v) {
    this.visible = v;
    this.root.visible = v;
    this.marker.visible = v;
  }

  setMarkerVisible(v) {
    this.marker.visible = v && this.visible;
  }
}

export { SLATE_Y };
