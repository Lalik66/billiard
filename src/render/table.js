// Procedural pool table: cloth bed with pocket holes, cushions extruded from the
// physics segments, wooden rails, sights, pocket liners, apron and legs.
import * as THREE from 'three';
import { R, HX, HY, CUSHION_W, RAIL_W, TABLE } from '../core/constants.js';
import { feltTexture, woodTexture } from './textures.js';

export const SLATE_Y = 0.8;
export const RAIL_TOP = SLATE_Y + 0.046;
const OUT_X = HX + CUSHION_W + RAIL_W;
const OUT_Y = HY + CUSHION_W + RAIL_W;

// physics (x, y) -> shape coordinates are identical; geometry is rotated so that
// shape +y maps to world -z.
function flat(geo) {
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function railHolePath() {
  // inner boundary of the rails: rectangle at the cushion backs, bulging around pockets
  const ix = HX + CUSHION_W;
  const iy = HY + CUSHION_W;
  const pts = [];
  const P = TABLE.pockets;
  const arc = (p, ex, ey, xx, xy) => {
    const pr = p.r + 0.004;
    let a0 = Math.atan2(ey - p.y, ex - p.x);
    let a1 = Math.atan2(xy - p.y, xx - p.x);
    while (a1 <= a0) a1 += Math.PI * 2;
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push(new THREE.Vector2(p.x + Math.cos(a) * pr, p.y + Math.sin(a) * pr));
    }
  };
  const hit = (p, axis, value, sign) => {
    // intersection of circle (radius r+0.004) with line axis=value; choose by sign along the other axis
    const pr = p.r + 0.004;
    if (axis === 'y') {
      const d = Math.sqrt(Math.max(0, pr * pr - (value - p.y) ** 2));
      return [p.x + sign * d, value];
    }
    const d = Math.sqrt(Math.max(0, pr * pr - (value - p.x) ** 2));
    return [value, p.y + sign * d];
  };
  // CCW: bottom edge (y=-iy) left->right
  let e, x;
  e = hit(P[0], 'x', -ix, -1); // on left edge, below centre
  x = hit(P[0], 'y', -iy, 1);
  arc(P[0], e[0], e[1], x[0], x[1]);
  e = hit(P[1], 'y', -iy, -1);
  x = hit(P[1], 'y', -iy, 1);
  arc(P[1], e[0], e[1], x[0], x[1]);
  e = hit(P[2], 'y', -iy, -1);
  x = hit(P[2], 'x', ix, 1);
  arc(P[2], e[0], e[1], x[0], x[1]);
  e = hit(P[3], 'x', ix, -1);
  x = hit(P[3], 'y', iy, -1);
  arc(P[3], e[0], e[1], x[0], x[1]);
  e = hit(P[4], 'y', iy, 1);
  x = hit(P[4], 'y', iy, -1);
  arc(P[4], e[0], e[1], x[0], x[1]);
  e = hit(P[5], 'y', iy, 1);
  x = hit(P[5], 'x', -ix, -1);
  arc(P[5], e[0], e[1], x[0], x[1]);
  return new THREE.Path(pts);
}

function cushionPolys() {
  const segs = TABLE.segments;
  const polys = [];
  for (const s of segs) {
    if (s.kind !== 'rail') continue;
    // outward normal (away from the table centre)
    let ox = s.nx;
    let oy = s.ny;
    const mx = (s.ax + s.bx) / 2;
    const my = (s.ay + s.by) / 2;
    if (ox * -mx + oy * -my > 0) {
      ox = -ox;
      oy = -oy;
    }
    const backOf = (px, py) => {
      const jaw = segs.find((j) => j.kind === 'jaw' && Math.abs(j.ax - px) < 1e-9 && Math.abs(j.ay - py) < 1e-9);
      const t = CUSHION_W / (jaw.dx * ox + jaw.dy * oy);
      return [px + jaw.dx * t, py + jaw.dy * t];
    };
    const A = [s.ax, s.ay];
    const B = [s.bx, s.by];
    const Ab = backOf(s.ax, s.ay);
    const Bb = backOf(s.bx, s.by);
    polys.push([A, B, Bb, Ab]);
  }
  return polys;
}

export function buildTable(style) {
  const group = new THREE.Group();
  group.name = 'table';

  // ---------------- cloth bed
  const feltTex = feltTexture(4);
  feltTex.repeat.set(5, 5);
  const feltMat = new THREE.MeshPhysicalMaterial({
    color: style.felt,
    map: feltTex,
    roughness: 0.95,
    metalness: 0,
    sheen: 0.35,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color(style.felt).lerp(new THREE.Color('#ffffff'), 0.2),
  });
  feltMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFeltPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFeltPos = position.xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFeltPos;\nfloat feltHash(vec2 p){return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453);}')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          // large-scale nap variation + a soft darkening towards the cushions
          vec2 q = vFeltPos * 3.0;
          float n = feltHash(floor(q)) * 0.5 + feltHash(floor(q * 2.3 + 7.0)) * 0.5;
          float edge = smoothstep(0.55, 1.15, length(vFeltPos / vec2(${(HX + 0.05).toFixed(3)}, ${(HY + 0.05).toFixed(3)})));
          diffuseColor.rgb *= (0.97 + n * 0.05) * (1.0 - edge * 0.22);
        }`
      );
  };
  // onBeforeCompile is not part of three's program cache key, so without a custom
  // key the felt and the (cloned) cushion material resolve to the same program and
  // one silently reuses the other's shader. Give each a distinct key.
  feltMat.customProgramCacheKey = () => 'felt-nap';
  const bedShape = new THREE.Shape();
  bedShape.moveTo(-OUT_X + 0.01, -OUT_Y + 0.01);
  bedShape.lineTo(OUT_X - 0.01, -OUT_Y + 0.01);
  bedShape.lineTo(OUT_X - 0.01, OUT_Y - 0.01);
  bedShape.lineTo(-OUT_X + 0.01, OUT_Y - 0.01);
  bedShape.closePath();
  for (const p of TABLE.pockets) {
    const h = new THREE.Path();
    h.absarc(p.x, p.y, p.r, 0, Math.PI * 2, false);
    bedShape.holes.push(h);
  }
  const bed = new THREE.Mesh(flat(new THREE.ShapeGeometry(bedShape, 24)), feltMat);
  bed.position.y = SLATE_Y;
  bed.receiveShadow = true;
  group.add(bed);

  // ---------------- pocket liners
  const linerMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9, side: THREE.DoubleSide });
  const netMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 1 });
  for (const p of TABLE.pockets) {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 0.85, 0.16, 32, 1, true), linerMat);
    cyl.position.set(p.x, SLATE_Y - 0.08, -p.y);
    group.add(cyl);
    const bottom = new THREE.Mesh(flat(new THREE.CircleGeometry(p.r * 0.86, 24)), netMat);
    bottom.position.set(p.x, SLATE_Y - 0.155, -p.y);
    group.add(bottom);
  }

  // ---------------- cushions
  const cushionMat = feltMat.clone();
  cushionMat.color = new THREE.Color(style.felt).multiplyScalar(0.88);
  cushionMat.onBeforeCompile = () => {};
  cushionMat.customProgramCacheKey = () => 'cushion-plain';
  for (const poly of cushionPolys()) {
    const sh = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], p[1])));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.0025, bevelSegments: 2 });
    flat(geo);
    const m = new THREE.Mesh(geo, cushionMat);
    m.position.y = SLATE_Y - 0.001;
    m.castShadow = false;
    m.receiveShadow = true;
    group.add(m);
  }

  // ---------------- rails
  const railTex = woodTexture(style.wood.base, style.wood.dark, 7);
  railTex.repeat.set(0.45, 1.6);
  const railMat = new THREE.MeshPhysicalMaterial({
    map: railTex,
    color: style.wood.tint || 0xffffff,
    roughness: style.wood.roughness ?? 0.35,
    metalness: style.wood.metalness ?? 0,
    clearcoat: style.wood.clearcoat ?? 0.8,
    clearcoatRoughness: 0.25,
  });
  const railShape = new THREE.Shape();
  railShape.moveTo(-OUT_X, -OUT_Y);
  railShape.lineTo(OUT_X, -OUT_Y);
  railShape.lineTo(OUT_X, OUT_Y);
  railShape.lineTo(-OUT_X, OUT_Y);
  railShape.closePath();
  railShape.holes.push(railHolePath());
  const railGeo = new THREE.ExtrudeGeometry(railShape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 24 });
  flat(railGeo);
  const rails = new THREE.Mesh(railGeo, railMat);
  rails.position.y = SLATE_Y;
  rails.castShadow = true;
  rails.receiveShadow = true;
  group.add(rails);

  // ---------------- trims & pocket caps
  const trimMat = new THREE.MeshStandardMaterial({
    color: style.trim || 0x111111,
    metalness: style.trim ? 1 : 0.2,
    roughness: style.trim ? 0.25 : 0.6,
    emissive: style.trimEmissive || 0x000000,
    emissiveIntensity: style.trimEmissive ? 1.5 : 0,
  });
  for (const p of TABLE.pockets) {
    const out = Math.atan2(p.y, p.x === 0 ? 0 : p.x);
    const span = p.type === 'corner' ? 3.6 : 3.3;
    const ring = new THREE.Mesh(flat(new THREE.RingGeometry(p.r + 0.002, p.r + 0.03, 32, 1, out - span / 2, span)), trimMat);
    ring.position.set(p.x, RAIL_TOP + 0.0015, -p.y);
    group.add(ring);
  }
  if (style.trim) {
    const t = 0.012;
    const mk = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), trimMat);
      m.position.set(x, RAIL_TOP - 0.004, z);
      group.add(m);
    };
    mk(2 * OUT_X + 0.012, t, 0, OUT_Y + 0.001);
    mk(2 * OUT_X + 0.012, t, 0, -OUT_Y - 0.001);
    mk(t, 2 * OUT_Y + 0.012, OUT_X + 0.001, 0);
    mk(t, 2 * OUT_Y + 0.012, -OUT_X - 0.001, 0);
  }

  // ---------------- sights (diamonds)
  const sightMat = new THREE.MeshStandardMaterial({ color: style.sight || 0xf3efe0, roughness: 0.25, metalness: style.sightMetal ? 1 : 0.1, emissive: style.sightEmissive || 0x000000, emissiveIntensity: 1 });
  const dGeo = flat(new THREE.CircleGeometry(0.009, 4));
  const railMid = CUSHION_W + RAIL_W * 0.55;
  for (let k = 1; k < 8; k++) {
    if (k === 4) continue;
    const x = -HX + (k * 2 * HX) / 8;
    for (const sy of [-1, 1]) {
      const d = new THREE.Mesh(dGeo, sightMat);
      d.position.set(x, RAIL_TOP + 0.0012, -sy * (HY + railMid));
      d.scale.set(0.8, 1, 1.4);
      group.add(d);
    }
  }
  for (let k = 1; k < 4; k++) {
    const y = -HY + (k * 2 * HY) / 4;
    for (const sx of [-1, 1]) {
      const d = new THREE.Mesh(dGeo, sightMat);
      d.position.set(sx * (HX + railMid), RAIL_TOP + 0.0012, -y);
      d.scale.set(1.4, 1, 0.8);
      group.add(d);
    }
  }

  // ---------------- apron / body
  const bodyTex = woodTexture(style.wood.body || style.wood.dark, '#000000', 13);
  bodyTex.repeat.set(1, 1);
  const bodyMat = new THREE.MeshPhysicalMaterial({
    map: bodyTex,
    color: style.wood.bodyTint || 0xffffff,
    roughness: 0.45,
    metalness: style.wood.metalness ?? 0,
    clearcoat: 0.5,
  });
  // apron: a hollow frame so the pocket holes look into darkness, plus a bottom plate
  const apronT = 0.05;
  const bw = 2 * OUT_X - 0.03;
  const bd = 2 * OUT_Y - 0.03;
  const apron = [
    [bw, apronT, 0, bd / 2 - apronT / 2],
    [bw, apronT, 0, -bd / 2 + apronT / 2],
    [apronT, bd, bw / 2 - apronT / 2, 0],
    [apronT, bd, -bw / 2 + apronT / 2, 0],
  ];
  for (const [w, d, x, z] of apron) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), bodyMat);
    m.position.set(x, SLATE_Y - 0.115, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  const plate = new THREE.Mesh(new THREE.BoxGeometry(bw - 0.02, 0.02, bd - 0.02), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 }));
  plate.position.y = SLATE_Y - 0.205;
  group.add(plate);
  // slate edge visible inside pockets is hidden by the body top; add a dark top
  const legMat = bodyMat;
  const legPos = [
    [-HX + 0.08, -HY + 0.02],
    [HX - 0.08, -HY + 0.02],
    [-HX + 0.08, HY - 0.02],
    [HX - 0.08, HY - 0.02],
    [0, -HY + 0.02],
    [0, HY - 0.02],
  ];
  const legH = SLATE_Y - 0.215;
  let legGeo;
  if (style.legs === 'turned') {
    const pts = [];
    const prof = [
      [0.0, 0.1],
      [0.03, 0.1],
      [0.05, 0.09],
      [0.15, 0.065],
      [0.2, 0.08],
      [0.28, 0.09],
      [0.36, 0.07],
      [0.45, 0.055],
      [0.5, 0.075],
      [0.56, 0.09],
      [legH, 0.09],
    ];
    for (const [y, r] of prof) pts.push(new THREE.Vector2(r, y));
    legGeo = new THREE.LatheGeometry(pts, 24);
  } else {
    legGeo = new THREE.BoxGeometry(0.14, legH, 0.14);
    legGeo.translate(0, legH / 2, 0);
  }
  for (const [x, y] of legPos) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, 0, -y);
    leg.castShadow = true;
    group.add(leg);
  }

  // ---------------- glow strips (arcade / space)
  const glowMats = [];
  if (style.glow) {
    const gm = new THREE.MeshBasicMaterial({ color: style.glow, toneMapped: false });
    glowMats.push(gm);
    const th = 0.012;
    const y = SLATE_Y - 0.02;
    const mk = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, th, d), gm);
      m.position.set(x, y, z);
      group.add(m);
    };
    mk(2 * OUT_X - 0.02, th, 0, OUT_Y - 0.012);
    mk(2 * OUT_X - 0.02, th, 0, -OUT_Y + 0.012);
    mk(th, 2 * OUT_Y - 0.02, OUT_X - 0.012, 0);
    mk(th, 2 * OUT_Y - 0.02, -OUT_X + 0.012, 0);
    const y2 = SLATE_Y - 0.212;
    const mk2 = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, th, d), gm);
      m.position.set(x, y2, z);
      group.add(m);
    };
    mk2(2 * OUT_X - 0.04, th, 0, OUT_Y - 0.022);
    mk2(2 * OUT_X - 0.04, th, 0, -OUT_Y + 0.022);
    mk2(th, 2 * OUT_Y - 0.04, OUT_X - 0.022, 0);
    mk2(th, 2 * OUT_Y - 0.04, -OUT_X + 0.022, 0);
  }

  return { group, feltMat, glowMats, dispose: () => disposeGroup(group) };
}

export function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        for (const k of ['map', 'emissiveMap', 'roughnessMap', 'normalMap', 'alphaMap']) if (m[k] && m[k].dispose && !m[k].userData?.shared) m[k].dispose();
        m.dispose();
      }
    }
    // Shadow-casting lights own a depth render target that is not freed by
    // removing the light from the scene; release it explicitly.
    if (o.isLight && o.shadow) {
      if (o.shadow.map) {
        o.shadow.map.dispose();
        o.shadow.map = null;
      }
      o.shadow.dispose?.();
    }
  });
}

export { R, OUT_X, OUT_Y };
