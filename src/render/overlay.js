// In-world helper markers: called-pocket rings, ball-in-hand ring, kitchen
// area, trick-shot zones and allowed pockets.
import * as THREE from 'three';
import { R, HX, HY, POCKETS, HEAD_STRING_X } from '../core/constants.js';
import { SLATE_Y } from './table.js';

const flatRing = (r0, r1, color, opacity = 0.9) =>
  new THREE.Mesh(
    new THREE.RingGeometry(r0, r1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false })
  );

export class Overlay {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    // pocket call markers
    this.pockets = POCKETS.map((p) => {
      const g = new THREE.Group();
      const ring = flatRing(0.045, 0.058, '#ffd447', 0.85);
      g.add(ring);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.02, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd447', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
      g.add(dot);
      g.position.set(p.ax + p.nx * 0.02, SLATE_Y + 0.003, -(p.ay + p.ny * 0.02));
      g.visible = false;
      g.userData = { ring, dot };
      this.group.add(g);
      return g;
    });
    // allowed pocket glow (trick shots)
    this.allowed = POCKETS.map((p) => {
      const r = flatRing(p.r * 0.75, p.r * 1.05, '#4dff9a', 0.5);
      r.position.set(p.x, SLATE_Y + 0.002, -p.y);
      r.visible = false;
      this.group.add(r);
      return r;
    });
    // ball in hand
    this.bih = flatRing(R * 1.25, R * 1.6, '#45ff8a', 0.9);
    this.bih.visible = false;
    this.group.add(this.bih);
    this.bihGhost = flatRing(R * 0.9, R * 1.15, '#ff4545', 0.9);
    this.bihGhost.visible = false;
    this.group.add(this.bihGhost);
    // kitchen
    this.kitchen = new THREE.Mesh(
      new THREE.PlaneGeometry(HX + HEAD_STRING_X, 2 * HY).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.06, depthWrite: false })
    );
    this.kitchen.position.set((-HX + HEAD_STRING_X) / 2, SLATE_Y + 0.001, 0);
    this.kitchen.visible = false;
    this.group.add(this.kitchen);
    this.headLine = new THREE.Mesh(new THREE.PlaneGeometry(0.003, 2 * HY).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }));
    this.headLine.position.set(HEAD_STRING_X, SLATE_Y + 0.0012, 0);
    this.headLine.visible = false;
    this.group.add(this.headLine);
    // trick zone
    this.zone = new THREE.Group();
    const zr = flatRing(0.97, 1.0, '#4dff9a', 0.9);
    const zd = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#4dff9a', transparent: true, opacity: 0.14, depthWrite: false }));
    this.zone.add(zr, zd);
    this.zone.visible = false;
    this.group.add(this.zone);
    this.time = 0;
    this.selected = null;
  }

  showPockets(v, selected = null) {
    this.selected = selected;
    this.pockets.forEach((g, i) => {
      g.visible = v;
      const sel = i === selected;
      g.userData.ring.material.color.set(sel ? '#4dff9a' : '#ffd447');
      g.userData.dot.material.color.set(sel ? '#4dff9a' : '#ffd447');
      g.userData.dot.visible = sel;
    });
  }

  showAllowed(list) {
    this.allowed.forEach((r, i) => (r.visible = !!list && list.includes(i)));
  }

  setZone(z) {
    if (!z) {
      this.zone.visible = false;
      return;
    }
    this.zone.visible = true;
    this.zone.position.set(z.x, SLATE_Y + 0.0015, -z.y);
    this.zone.scale.set(z.r, 1, z.r);
  }

  setBallInHand(on, x = 0, y = 0, valid = true, kitchen = false, ghost = null) {
    this.bih.visible = on;
    this.kitchen.visible = on && kitchen;
    this.headLine.visible = on && kitchen;
    if (on) this.bih.position.set(x, SLATE_Y + 0.002, -y);
    this.bih.material.color.set(valid ? '#45ff8a' : '#ff4545');
    if (ghost) {
      this.bihGhost.visible = true;
      this.bihGhost.position.set(ghost[0], SLATE_Y + 0.0025, -ghost[1]);
    } else this.bihGhost.visible = false;
  }

  update(dt) {
    this.time += dt;
    const s = 1 + Math.sin(this.time * 5) * 0.08;
    this.pockets.forEach((g, i) => {
      const k = i === this.selected ? 1.15 * s : s;
      g.scale.set(k, 1, k);
    });
    this.bih.rotation.y += dt;
    const a = 0.35 + 0.15 * Math.sin(this.time * 3);
    this.allowed.forEach((r) => (r.material.opacity = a));
  }
}
