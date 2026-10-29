// Themed rooms. Each venue defines the table style, an environment-map recipe
// for reflections, and a builder that adds props, lights and ambient animation.
import * as THREE from 'three';
import { SLATE_Y } from './table.js';
import {
  plankTexture,
  brickTexture,
  dartboardTexture,
  neonTextTexture,
  woodTexture,
  panelTexture,
  carpetTexture,
  bookTexture,
  ArcadeScreen,
  radialTexture,
} from './textures.js';

const NOISE_GLSL = `
float hash3(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash3(i+vec3(0,0,0)),hash3(i+vec3(1,0,0)),f.x),mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x),mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5;} return s; }
`;

// ---------------------------------------------------------------------------
// helpers
function room(w, h, d, mats) {
  const g = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), mats.floor);
  floor.receiveShadow = true;
  g.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2), mats.ceil);
  ceil.position.y = h;
  g.add(ceil);
  const walls = [
    [w, 0, -d / 2, 0],
    [w, 0, d / 2, Math.PI],
    [d, -w / 2, 0, Math.PI / 2],
    [d, w / 2, 0, -Math.PI / 2],
  ];
  const wallMeshes = [];
  walls.forEach(([len, x, z, ry], i) => {
    if (mats.skipWall === i) return;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), mats.wall);
    m.position.set(x, h / 2, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    g.add(m);
    wallMeshes.push(m);
    if (mats.wainscot) {
      const ws = new THREE.Mesh(new THREE.PlaneGeometry(len, mats.wainscotH || 1.1), mats.wainscot);
      ws.position.set(x, (mats.wainscotH || 1.1) / 2, z);
      ws.rotation.y = ry;
      ws.translateZ(0.01);
      g.add(ws);
    }
  });
  return g;
}

function box(w, h, d, mat, x, y, z, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function tableSpot(color, intensity, quality, y = SLATE_Y + 1.7) {
  const s = new THREE.SpotLight(color, intensity, 6, 0.95, 0.75, 1.6);
  s.position.set(0, y, 0);
  s.target.position.set(0, SLATE_Y, 0);
  s.castShadow = quality !== 'low';
  const sz = quality === 'high' ? 2048 : 1024;
  s.shadow.mapSize.set(sz, sz);
  s.shadow.bias = -0.0002;
  s.shadow.normalBias = 0.01;
  s.shadow.radius = quality === 'high' ? 4 : 2;
  s.shadow.camera.near = 0.5;
  s.shadow.camera.far = 4;
  return s;
}

function dust(count, color, box3, size = 0.012) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = box3.min.x + Math.random() * (box3.max.x - box3.min.x);
    pos[i * 3 + 1] = box3.min.y + Math.random() * (box3.max.y - box3.min.y);
    pos[i * 3 + 2] = box3.min.z + Math.random() * (box3.max.z - box3.min.z);
    seed[i] = Math.random() * 100;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, color: { value: new THREE.Color(color) }, size: { value: size }, boxMin: { value: box3.min }, boxMax: { value: box3.max } },
    vertexShader: `attribute float seed; uniform float time; uniform float size; uniform vec3 boxMin; uniform vec3 boxMax; varying float vA;
      void main(){ vec3 p = position;
        p.x += sin(time*0.13 + seed)*0.3; p.z += cos(time*0.11 + seed*1.3)*0.3;
        p.y = boxMin.y + mod(p.y - boxMin.y + time*0.02*(0.5+fract(seed)), boxMax.y - boxMin.y);
        vec4 mv = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = size * 900.0 / -mv.z; vA = 0.4 + 0.6*abs(sin(time*0.7+seed)); }`,
    fragmentShader: `uniform vec3 color; varying float vA; void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c); if(d>0.5) discard; gl_FragColor = vec4(color, (1.0-d*2.0)*vA*0.6); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return { pts, mat };
}

function neonSign(text, color, w, h, font) {
  const t = neonTextTexture(text, color, 1024, 256, font);
  const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  return { mesh: m, mat };
}

function lampShade(color, glassColor) {
  const pts = [];
  const prof = [
    [0.02, 0.17],
    [0.05, 0.16],
    [0.12, 0.12],
    [0.22, 0.04],
    [0.26, 0.0],
  ];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, 32);
  // lathe faces point inwards: the outside of the shade is the back side
  const outer = new THREE.MeshStandardMaterial({ color: glassColor, roughness: 0.3, metalness: 0.3, side: THREE.BackSide, transparent: true });
  const inner = new THREE.MeshBasicMaterial({ color, side: THREE.FrontSide, toneMapped: false, transparent: true });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, outer));
  g.add(new THREE.Mesh(geo, inner));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), toneMapped: false, transparent: true }));
  bulb.position.y = 0.05;
  g.add(bulb);
  return g;
}

// ---------------------------------------------------------------------------
// shaders
function fireMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `${NOISE_GLSL} uniform float time; varying vec2 vUv;
      void main(){
        vec2 uv = vUv;
        float n = fbm(vec3(uv.x*4.0, uv.y*3.0 - time*2.2, time*0.4));
        float n2 = fbm(vec3(uv.x*9.0+3.0, uv.y*6.0 - time*3.5, time*0.7));
        float shape = 1.0 - smoothstep(0.0, 1.0, abs(uv.x-0.5)*2.2 + uv.y*0.95);
        float f = clamp(shape*1.6 + (n*0.9 + n2*0.4) - 0.95 - uv.y*0.5, 0.0, 1.0);
        vec3 col = mix(vec3(0.6,0.05,0.0), vec3(1.0,0.45,0.05), smoothstep(0.0,0.5,f));
        col = mix(col, vec3(1.0,0.9,0.55), smoothstep(0.5,1.0,f));
        gl_FragColor = vec4(col*2.2, f);
      }`,
  });
}

function rainMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, flash: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `uniform float time; uniform float flash; varying vec2 vUv;
      float h(float n){ return fract(sin(n)*43758.5453); }
      void main(){
        vec2 uv = vUv;
        vec3 sky = mix(vec3(0.02,0.03,0.07), vec3(0.08,0.1,0.18), uv.y);
        // distant city lights (bokeh)
        vec3 col = sky;
        for(int i=0;i<14;i++){
          float fi = float(i);
          vec2 c = vec2(h(fi*3.1), 0.08 + h(fi*7.7)*0.3);
          float d = length((uv - c)*vec2(1.0,1.4));
          col += vec3(1.0,0.75,0.4) * 0.05 * smoothstep(0.05, 0.0, d) * (0.6 + 0.4*sin(time*0.5+fi));
        }
        // streaks
        float cols = 70.0;
        float x = floor(uv.x*cols);
        float sp = 0.6 + h(x)*0.8;
        float y = fract(uv.y*1.5 + time*sp + h(x*1.7));
        float streak = smoothstep(0.0, 0.03, y) * smoothstep(0.12, 0.03, y);
        float lane = smoothstep(0.5, 0.0, abs(fract(uv.x*cols)-0.5)) ;
        col += vec3(0.5,0.6,0.75) * streak * lane * 0.35 * step(0.55, h(x*3.3));
        // droplets on glass
        vec2 g = uv*vec2(26.0, 16.0);
        vec2 id = floor(g); vec2 f = fract(g)-0.5;
        float r = h(id.x*13.0+id.y*7.0);
        float drop = smoothstep(0.12, 0.05, length(f + vec2(0.0, sin(time*0.3+r*6.0)*0.2))) * step(0.7, r);
        col += vec3(0.6,0.7,0.85)*drop*0.25;
        col += vec3(0.7,0.75,1.0) * flash;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

function planetMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, lightDir: { value: new THREE.Vector3(-0.6, 0.3, 0.75).normalize() } },
    vertexShader: `varying vec3 vN; varying vec3 vP; varying vec3 vView;
      void main(){ vN = normalize(normalMatrix*normal); vP = position; vec4 mv = modelViewMatrix*vec4(position,1.0); vView = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `${NOISE_GLSL} uniform float time; uniform vec3 lightDir; varying vec3 vN; varying vec3 vP; varying vec3 vView;
      void main(){
        vec3 p = normalize(vP);
        float c = cos(time*0.02), s = sin(time*0.02);
        vec3 q = vec3(c*p.x - s*p.z, p.y, s*p.x + c*p.z);
        float land = fbm(q*2.2);
        vec3 ocean = mix(vec3(0.02,0.08,0.25), vec3(0.05,0.2,0.45), fbm(q*6.0));
        vec3 ground = mix(vec3(0.15,0.35,0.12), vec3(0.55,0.45,0.28), fbm(q*5.0+4.0));
        ground = mix(ground, vec3(0.95), smoothstep(0.75, 0.9, abs(p.y)));
        vec3 col = land > 0.52 ? ground : ocean;
        float cs = cos(time*0.035), sn = sin(time*0.035);
        vec3 qc = vec3(cs*p.x - sn*p.z, p.y, sn*p.x + cs*p.z);
        float cloud = smoothstep(0.5, 0.75, fbm(qc*3.5 + vec3(0.0, time*0.01, 0.0)));
        col = mix(col, vec3(1.0), cloud*0.85);
        // vN and vView are in view space, so bring lightDir into view space too,
        // otherwise the lit hemisphere rotates with the camera instead of the sun.
        vec3 L = normalize((viewMatrix * vec4(lightDir, 0.0)).xyz);
        float diff = clamp(dot(normalize(vN), L), 0.0, 1.0);
        vec3 lit = col * (0.03 + diff*1.1);
        // night-side city lights
        lit += vec3(1.0,0.7,0.3) * step(0.62, fbm(q*14.0)) * step(0.52, land) * (1.0 - smoothstep(0.0,0.15,diff)) * 0.6;
        float rim = pow(1.0 - max(dot(normalize(vN), vView), 0.0), 3.0);
        lit += vec3(0.3,0.6,1.0) * rim * (0.25 + diff) * 1.2;
        gl_FragColor = vec4(lit, 1.0);
      }`,
  });
}

function gridFloorMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float time; varying vec3 vW;
      void main(){
        vec2 g = vW.xz*1.25;
        vec2 f = abs(fract(g)-0.5);
        float line = smoothstep(0.47, 0.5, max(f.x, f.y));
        float pulse = 0.5 + 0.5*sin(length(vW.xz)*2.0 - time*2.0);
        vec3 a = vec3(1.0,0.15,0.6), b = vec3(0.1,0.8,1.0);
        vec3 col = mix(a, b, 0.5+0.5*sin(time*0.3 + vW.x*0.3));
        float fade = smoothstep(7.0, 1.5, length(vW.xz));
        gl_FragColor = vec4(vec3(0.015,0.01,0.03) + col*line*(0.35+0.65*pulse)*fade*1.4, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------
// Venue definitions
export const VENUES = [
  {
    id: 'pub',
    name: 'The Crooked Cue',
    theme: 'Classic pub',
    unlock: 0,
    blurb: 'Warm lamps, a battered dartboard and a neon sign that never quite works.',
    table: { felt: '#1d6b3c', wood: { base: '#8a4a22', dark: '#3a1a08', body: '#5a2c12' }, legs: 'turned', sight: '#f1ead2' },
    env: { bg: '#2a1a10', lamps: ['#ffd29a'], accents: ['#ff4d7a', '#6b3a1f'], intensity: 0.55 },
    exposure: 1.05,
    music: 'pub',
    build: buildPub,
  },
  {
    id: 'arcade',
    name: 'Pixel Palace',
    theme: 'Neon arcade',
    unlock: 1,
    blurb: 'Glowing rails, colour-shifting lights and cabinets blinking in the dark.',
    table: { felt: '#1a1c62', wood: { base: '#1a1a24', dark: '#050508', body: '#121218', roughness: 0.25, clearcoat: 1 }, legs: 'box', glow: '#ff2e9a', sight: '#7ff6ff', sightEmissive: '#29e3ff' },
    env: { bg: '#07040f', lamps: ['#e8f0ff'], accents: ['#ff2e9a', '#22d3ee', '#8a5cff'], intensity: 0.6 },
    exposure: 1.0,
    music: 'arcade',
    build: buildArcade,
  },
  {
    id: 'lounge',
    name: 'The Velvet Room',
    theme: 'Luxury lounge',
    unlock: 2,
    blurb: 'Dark walnut, gold trim, a crackling fire and rain on the window.',
    table: { felt: '#6e1222', wood: { base: '#5a2e16', dark: '#1a0804', body: '#2e140a' }, legs: 'turned', trim: '#d4a64a', sight: '#e8c068', sightMetal: true },
    env: { bg: '#140a06', lamps: ['#ffcf8a'], accents: ['#ff7a2a', '#d4a64a'], intensity: 0.5 },
    exposure: 1.0,
    music: 'lounge',
    build: buildLounge,
  },
  {
    id: 'space',
    name: 'Orbital Station Kepler',
    theme: 'Space station',
    unlock: 4,
    blurb: 'Zero-g dust, humming panels and a planet turning slowly outside the glass.',
    table: { felt: '#0a4452', wood: { base: '#3c444f', dark: '#14181d', body: '#22272e', metalness: 0.75, roughness: 0.35, clearcoat: 0.6 }, legs: 'box', glow: '#35e0ff', sight: '#9ff3ff', sightEmissive: '#35e0ff' },
    env: { bg: '#05070c', lamps: ['#dff6ff'], accents: ['#35e0ff', '#3d6bff'], intensity: 0.65 },
    exposure: 1.05,
    music: 'space',
    build: buildSpace,
  },
];

export function venueById(id) {
  return VENUES.find((v) => v.id === id) || VENUES[0];
}

// Environment scene for PMREM reflections
export function envScene(v) {
  const s = new THREE.Scene();
  const roomMat = new THREE.MeshBasicMaterial({ color: v.env.bg, side: THREE.BackSide });
  s.add(new THREE.Mesh(new THREE.BoxGeometry(12, 6, 10), roomMat));
  v.env.lamps.forEach((c, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.8), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(6), side: THREE.DoubleSide }));
    m.rotation.x = Math.PI / 2;
    m.position.set(0, 2.4, i * 0.5);
    s.add(m);
  });
  v.env.accents.forEach((c, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.5), side: THREE.DoubleSide }));
    const a = (i / v.env.accents.length) * Math.PI * 2;
    m.position.set(Math.cos(a) * 5.5, 0.6, Math.sin(a) * 4.5);
    m.lookAt(0, 0.6, 0);
    s.add(m);
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(v.env.bg).multiplyScalar(0.6) }));
  floor.position.y = -2.9;
  s.add(floor);
  return s;
}

// ---------------------------------------------------------------------------
function buildPub(ctx) {
  const g = new THREE.Group();
  const updaters = [];
  const W = 11;
  const D = 9;
  const H = 3.3;
  const floorTex = plankTexture('#6b4226', '#2a1608', 4);
  floorTex.repeat.set(3, 3);
  const brick = brickTexture();
  brick.repeat.set(5, 1.6);
  const wainTex = woodTexture('#4a2412', '#1f0c04', 3);
  wainTex.repeat.set(4, 1);
  g.add(
    room(W, H, D, {
      floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.6 }),
      ceil: new THREE.MeshStandardMaterial({ color: '#1c130d', roughness: 1 }),
      wall: new THREE.MeshStandardMaterial({ map: brick, roughness: 0.9 }),
      wainscot: new THREE.MeshStandardMaterial({ map: wainTex, roughness: 0.5 }),
      wainscotH: 1.15,
    })
  );
  // lights
  const amb = new THREE.HemisphereLight('#ffd9b0', '#2a1a10', 0.35);
  g.add(amb);
  const spot = tableSpot('#ffe2b8', 15, ctx.quality);
  g.add(spot, spot.target);
  // hanging lamps
  const lamps = new THREE.Group();
  const lampLights = [];
  [-0.85, 0, 0.85].forEach((x, i) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, H, 0);
    const len = H - (SLATE_Y + 1.0);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, len, 6), new THREE.MeshStandardMaterial({ color: '#111' }));
    cord.position.y = -len / 2;
    pivot.add(cord);
    const shade = lampShade('#ffd9a0', '#14532d');
    shade.position.y = -len - 0.17;
    pivot.add(shade);
    if (i === 1) {
      // one warm glow light is enough; the table spot does the real work
      const pl = new THREE.PointLight('#ffcc88', 2.4, 4, 2);
      pl.position.y = -len - 0.05;
      pivot.add(pl);
      lampLights.push(pl);
    }
    lamps.add(pivot);
    pivot.userData.phase = i * 1.3;
  });
  g.add(lamps);
  updaters.push((t) => {
    lamps.children.forEach((p) => {
      p.rotation.z = Math.sin(t * 0.6 + p.userData.phase) * 0.012;
      p.rotation.x = Math.cos(t * 0.45 + p.userData.phase) * 0.008;
    });
  });
  // dartboard
  const dart = new THREE.Mesh(new THREE.CircleGeometry(0.23, 48), new THREE.MeshStandardMaterial({ map: dartboardTexture(), roughness: 0.8 }));
  dart.position.set(-2.2, 1.65, -D / 2 + 0.03);
  g.add(dart);
  const cab = box(0.75, 0.75, 0.04, new THREE.MeshStandardMaterial({ color: '#3a1d0c', roughness: 0.6 }), -2.2, 1.65, -D / 2 + 0.01);
  g.add(cab);
  // darts stuck in the board
  for (let i = 0; i < 3; i++) {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.1, 6), new THREE.MeshStandardMaterial({ color: i === 1 ? '#c22' : '#2a6' }));
    d.rotation.x = Math.PI / 2;
    d.position.set(-2.2 + (i - 1) * 0.05, 1.68 + (i % 2) * 0.04, -D / 2 + 0.08);
    g.add(d);
  }
  // neon signs
  const sign = neonSign('Cue Club', '#ff3d7f', 1.9, 0.48);
  sign.mesh.position.set(1.2, 2.25, -D / 2 + 0.05);
  g.add(sign.mesh);
  const sign2 = neonSign('OPEN', '#3dd6ff', 0.9, 0.24, 'bold 160px Arial');
  sign2.mesh.position.set(W / 2 - 0.05, 2.0, 1.5);
  sign2.mesh.rotation.y = -Math.PI / 2;
  g.add(sign2.mesh);
  const neonLight = new THREE.PointLight('#ff3d7f', 1.2, 4, 2);
  neonLight.position.set(1.2, 2.2, -D / 2 + 0.5);
  g.add(neonLight);
  let flick = 1;
  updaters.push((t, dt) => {
    // irregular flicker
    if (Math.random() < dt * 1.5) flick = Math.random() < 0.5 ? 0.15 : 0.6;
    flick += (1 - flick) * Math.min(1, dt * 8);
    const buzz = 0.92 + Math.sin(t * 60) * 0.04;
    sign.mat.opacity = flick * buzz;
    neonLight.intensity = 1.2 * flick;
    sign2.mat.opacity = 0.85 + Math.sin(t * 3) * 0.1;
  });
  // bar counter with bottles
  const barMat = new THREE.MeshStandardMaterial({ map: woodTexture('#5a2c12', '#1a0a03', 8), roughness: 0.4 });
  const bar = box(4, 1.05, 0.6, barMat, 1.5, 0.525, D / 2 - 0.6);
  g.add(bar);
  const shelf = box(4, 0.04, 0.25, barMat, 1.5, 1.6, D / 2 - 0.15);
  const shelf2 = box(4, 0.04, 0.25, barMat, 1.5, 2.05, D / 2 - 0.15);
  g.add(shelf, shelf2);
  const bottleCols = ['#2f6b2a', '#6b3a12', '#bcd8e6', '#7a1a2a', '#c9a227'];
  for (let i = 0; i < 22; i++) {
    const col = bottleCols[i % bottleCols.length];
    const mat = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.1, transmission: 0, transparent: true, opacity: 0.85, clearcoat: 1 });
    const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), mat);
    const nk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.09, 8), mat);
    const row = i < 11 ? 0 : 1;
    const x = -0.3 + (i % 11) * 0.34 + (row ? 0.15 : 0);
    bt.position.set(x, (row ? 2.07 : 1.62) + 0.11, D / 2 - 0.15);
    nk.position.set(x, (row ? 2.07 : 1.62) + 0.265, D / 2 - 0.15);
    g.add(bt, nk);
  }
  // stools
  const stoolMat = new THREE.MeshStandardMaterial({ color: '#7a1f1f', roughness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: '#888', metalness: 1, roughness: 0.3 });
  for (let i = 0; i < 4; i++) {
    const x = 0.2 + i * 0.85;
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.08, 20), stoolMat);
    seat.position.set(x, 0.78, D / 2 - 1.25);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.74, 8), metal);
    leg.position.set(x, 0.37, D / 2 - 1.25);
    seat.castShadow = true;
    g.add(seat, leg);
  }
  // cue rack on the wall
  const rack = box(1.2, 0.08, 0.08, barMat, -W / 2 + 0.06, 0.9, -1.5);
  rack.rotation.y = Math.PI / 2;
  g.add(rack);
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 1.45, 8), new THREE.MeshStandardMaterial({ color: i % 2 ? '#d9b07a' : '#4a2412', roughness: 0.4 }));
    c.position.set(-W / 2 + 0.08, 1.45, -2 + i * 0.2);
    g.add(c);
  }
  // framed pictures
  for (let i = 0; i < 3; i++) {
    const fr = box(0.7, 0.5, 0.04, new THREE.MeshStandardMaterial({ color: '#2a1608' }), -W / 2 + 0.03, 2.1, 0.6 + i * 1.1);
    fr.rotation.y = Math.PI / 2;
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), new THREE.MeshStandardMaterial({ color: ['#6a5a3a', '#3a4a5a', '#5a3a3a'][i], roughness: 0.9 }));
    pic.position.set(-W / 2 + 0.06, 2.1, 0.6 + i * 1.1);
    pic.rotation.y = Math.PI / 2;
    g.add(fr, pic);
  }
  // dust in the lamp light
  const d = dust(140, '#ffe2b0', new THREE.Box3(new THREE.Vector3(-1.6, SLATE_Y + 0.1, -0.9), new THREE.Vector3(1.6, H - 0.4, 0.9)), 0.006);
  g.add(d.pts);
  updaters.push((t) => (d.mat.uniforms.time.value = t));
  return { group: g, update: (t, dt) => updaters.forEach((u) => u(t, dt)), lights: [spot, ...lampLights], occluders: lamps.children };
}

function buildArcade(ctx) {
  const g = new THREE.Group();
  const updaters = [];
  const W = 12;
  const D = 9;
  const H = 3.4;
  const floorMat = gridFloorMaterial();
  const wallMat = new THREE.MeshStandardMaterial({ color: '#120b22', roughness: 0.8 });
  g.add(room(W, H, D, { floor: floorMat, ceil: new THREE.MeshStandardMaterial({ color: '#06040c' }), wall: wallMat }));
  updaters.push((t) => (floorMat.uniforms.time.value = t));
  g.add(new THREE.HemisphereLight('#7a6cff', '#100820', 0.6));
  const gameOn = neonSign('GAME ON', '#22d3ee', 2.4, 0.6, 'bold 150px Arial');
  gameOn.mesh.position.set(W / 2 - 0.05, 2.45, 0);
  gameOn.mesh.rotation.y = -Math.PI / 2;
  g.add(gameOn.mesh);
  const hi = neonSign('HI-SCORE', '#ff2e9a', 1.6, 0.4, 'bold 140px Arial');
  hi.mesh.position.set(-1.5, 2.6, -D / 2 + 0.05);
  g.add(hi.mesh);
  updaters.push((t) => {
    gameOn.mat.opacity = 0.75 + 0.25 * Math.sin(t * 2.2);
    hi.mat.opacity = Math.sin(t * 5) > -0.6 ? 1 : 0.2;
  });
  const spot = tableSpot('#eef3ff', 14, ctx.quality);
  g.add(spot, spot.target);
  // a slim light bar above the table
  const barGroup = new THREE.Group();
  const barLight = box(2.4, 0.05, 0.25, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(2.2), toneMapped: false, transparent: true }), 0, SLATE_Y + 1.25, 0, false);
  const barFrame = box(2.5, 0.06, 0.3, new THREE.MeshStandardMaterial({ color: '#111', metalness: 0.8, roughness: 0.3, transparent: true }), 0, SLATE_Y + 1.29, 0, false);
  barGroup.add(barLight, barFrame);
  g.add(barGroup);
  // colour-shifting room lights
  const colorLights = [];
  for (let i = 0; i < 2; i++) {
    const pl = new THREE.PointLight('#ff2e9a', 6, 8, 2);
    const a = i * Math.PI + 0.6;
    pl.position.set(Math.cos(a) * 4, 2.5, Math.sin(a) * 3.2);
    g.add(pl);
    colorLights.push(pl);
  }
  updaters.push((t) => {
    colorLights.forEach((pl, i) => pl.color.setHSL((t * 0.04 + i * 0.5) % 1, 0.9, 0.55));
  });
  // neon tubes on walls
  const tubes = [];
  for (let i = 0; i < 6; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: '#22d3ee', toneMapped: false });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, i % 2 ? 3.2 : 2.4, 8), mat);
    tube.rotation.z = Math.PI / 2;
    const wall = i % 3;
    if (wall === 0) tube.position.set(-3 + (i % 2) * 6 - 1.5, 2.6 - (i > 2 ? 0.25 : 0), -D / 2 + 0.06);
    else if (wall === 1) {
      tube.position.set(W / 2 - 0.06, 2.6 - (i > 2 ? 0.25 : 0), -1 + (i % 2) * 2);
      tube.rotation.set(0, 0, Math.PI / 2);
      tube.rotation.y = Math.PI / 2;
    } else tube.position.set(-1 + (i % 2) * 2.5, 2.9 - (i > 2 ? 0.25 : 0), D / 2 - 0.06);
    g.add(tube);
    tubes.push(mat);
  }
  updaters.push((t) => tubes.forEach((m, i) => m.color.setHSL((t * 0.06 + i * 0.17) % 1, 1, 0.6).multiplyScalar(2)));
  // arcade cabinets
  const screens = [];
  const cabMat = new THREE.MeshStandardMaterial({ color: '#1a1030', roughness: 0.5, metalness: 0.2 });
  const cabSpots = [
    [-4.5, -D / 2 + 0.55, 0],
    [-3.6, -D / 2 + 0.55, 0],
    [-2.7, -D / 2 + 0.55, 0],
    [3.0, -D / 2 + 0.55, 0],
    [3.9, -D / 2 + 0.55, 0],
    [-W / 2 + 0.55, 2.4, Math.PI / 2],
    [-W / 2 + 0.55, 1.5, Math.PI / 2],
    [-W / 2 + 0.55, -2.2, Math.PI / 2],
    [2.0, D / 2 - 0.55, Math.PI],
    [3.0, D / 2 - 0.55, Math.PI],
    [W / 2 - 0.55, -2.6, -Math.PI / 2],
    [W / 2 - 0.55, -1.7, -Math.PI / 2],
    [W / 2 - 0.55, 1.7, -Math.PI / 2],
    [W / 2 - 0.55, 2.6, -Math.PI / 2],
  ];
  cabSpots.forEach(([x, z, ry], i) => {
    const c = new THREE.Group();
    const body = box(0.75, 1.75, 0.8, cabMat, 0, 0.875, 0);
    c.add(body);
    const scr = new ArcadeScreen(i * 13 + 5);
    screens.push(scr);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.48), new THREE.MeshBasicMaterial({ map: scr.texture, toneMapped: false, color: new THREE.Color(1.4, 1.4, 1.4) }));
    screen.position.set(0, 1.3, 0.41);
    screen.rotation.x = -0.15;
    c.add(screen);
    const marquee = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.16), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL((i * 0.13) % 1, 1, 0.55).multiplyScalar(2), toneMapped: false }));
    marquee.position.set(0, 1.66, 0.405);
    c.add(marquee);
    const panel = box(0.72, 0.06, 0.3, new THREE.MeshStandardMaterial({ color: '#222' }), 0, 0.98, 0.5);
    c.add(panel);
    for (let k = 0; k < 3; k++) {
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 10), new THREE.MeshBasicMaterial({ color: ['#f33', '#3f3', '#ff3'][k], toneMapped: false }));
      btn.position.set(0.05 + k * 0.08, 1.02, 0.5);
      c.add(btn);
    }
    c.position.set(x, 0, z);
    c.rotation.y = ry;
    c.userData.marquee = marquee;
    g.add(c);
  });
  let acc = 0;
  updaters.push((t, dt) => {
    acc += dt;
    if (acc > 0.08) {
      screens.forEach((s) => s.update(acc));
      acc = 0;
    }
  });
  // floating dust lit by neon
  const d = dust(120, '#b28cff', new THREE.Box3(new THREE.Vector3(-4, 0.3, -3.5), new THREE.Vector3(4, 3, 3.5)), 0.008);
  g.add(d.pts);
  updaters.push((t) => (d.mat.uniforms.time.value = t));
  return {
    group: g,
    update: (t, dt) => updaters.forEach((u) => u(t, dt)),
    lights: [spot, ...colorLights],
    occluders: [barGroup],
    glowUpdate: (mats, t) => mats.forEach((m) => m.color.setHSL((t * 0.05) % 1, 1, 0.55).multiplyScalar(2.2)),
  };
}

function buildLounge(ctx) {
  const g = new THREE.Group();
  const updaters = [];
  const W = 11;
  const D = 9;
  const H = 3.4;
  const panelTex = woodTexture('#3a1d10', '#0d0502', 17, 512, 1024);
  panelTex.repeat.set(6, 1);
  const carpet = carpetTexture('#2a0b10', '#6e4a1c');
  g.add(
    room(W, H, D, {
      floor: new THREE.MeshStandardMaterial({ map: carpet, roughness: 0.95 }),
      ceil: new THREE.MeshStandardMaterial({ color: '#120804', roughness: 1 }),
      wall: new THREE.MeshStandardMaterial({ color: '#2a1410', roughness: 0.85 }),
      wainscot: new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.4 }),
      wainscotH: 1.3,
    })
  );
  g.add(new THREE.HemisphereLight('#ffcf9a', '#2a140a', 0.6));
  const spot = tableSpot('#ffd8a8', 14, ctx.quality);
  g.add(spot, spot.target);
  // long brass pendant over the table
  const brass = new THREE.MeshStandardMaterial({ color: '#c99a44', metalness: 1, roughness: 0.25 });
  const pend = new THREE.Group();
  const shade = box(2.0, 0.12, 0.34, brass, 0, 0, 0, false);
  pend.add(shade);
  const glow = box(1.92, 0.01, 0.28, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd8a0').multiplyScalar(2.5), toneMapped: false }), 0, -0.065, 0, false);
  pend.add(glow);
  for (const x of [-0.9, 0.9]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, H - SLATE_Y - 1.1, 6), brass);
    rod.position.set(x, (H - SLATE_Y - 1.1) / 2, 0);
    pend.add(rod);
  }
  pend.position.set(0, SLATE_Y + 1.1, 0);
  g.add(pend);
  // gold wall trim
  const goldStrip = new THREE.MeshStandardMaterial({ color: '#d4a64a', metalness: 1, roughness: 0.3 });
  for (const [w, x, z, ry] of [
    [W, 0, -D / 2 + 0.02, 0],
    [W, 0, D / 2 - 0.02, Math.PI],
    [D, -W / 2 + 0.02, 0, Math.PI / 2],
    [D, W / 2 - 0.02, 0, -Math.PI / 2],
  ]) {
    const s = box(w, 0.04, 0.02, goldStrip, x, 1.31, z, false);
    s.rotation.y = ry;
    g.add(s);
  }
  // fireplace on the +x wall
  const stone = new THREE.MeshStandardMaterial({ color: '#4a4440', roughness: 0.9 });
  const fx = W / 2 - 0.3;
  const fireGroup = new THREE.Group();
  fireGroup.add(box(0.5, 1.3, 1.8, stone, 0, 0.65, 0));
  fireGroup.add(box(0.55, 0.1, 2.0, new THREE.MeshStandardMaterial({ color: '#2a1a12', roughness: 0.5 }), -0.02, 1.35, 0));
  const opening = box(0.1, 0.75, 1.1, new THREE.MeshStandardMaterial({ color: '#080404', roughness: 1 }), -0.21, 0.5, 0, false);
  fireGroup.add(opening);
  const fireMat = fireMaterial();
  const fire = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.65), fireMat);
  fire.position.set(-0.27, 0.45, 0);
  fire.rotation.y = -Math.PI / 2;
  fireGroup.add(fire);
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8), new THREE.MeshStandardMaterial({ color: '#2a160a', roughness: 1 }));
    log.rotation.x = Math.PI / 2;
    log.rotation.y = (i - 1) * 0.3;
    log.position.set(-0.22, 0.17, (i - 1) * 0.12);
    fireGroup.add(log);
  }
  fireGroup.position.set(fx, 0, -1.6);
  g.add(fireGroup);
  const fireLight = new THREE.PointLight('#ff8a3a', 3, 6, 2);
  fireLight.position.set(fx - 0.7, 0.6, -1.6);
  g.add(fireLight);
  updaters.push((t) => {
    fireMat.uniforms.time.value = t;
    fireLight.intensity = 2.6 + Math.sin(t * 7.3) * 0.35 + Math.sin(t * 13.1) * 0.25 + Math.random() * 0.3;
  });
  // rainy window on the -z wall
  const rainMat = rainMaterial();
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), rainMat);
  win.position.set(1.4, 1.95, -D / 2 + 0.03);
  g.add(win);
  const frameMat = new THREE.MeshStandardMaterial({ color: '#1e0f08', roughness: 0.4 });
  g.add(box(2.4, 0.1, 0.1, frameMat, 1.4, 2.8, -D / 2 + 0.05));
  g.add(box(2.4, 0.1, 0.1, frameMat, 1.4, 1.1, -D / 2 + 0.05));
  g.add(box(0.1, 1.8, 0.1, frameMat, 0.25, 1.95, -D / 2 + 0.05));
  g.add(box(0.1, 1.8, 0.1, frameMat, 2.55, 1.95, -D / 2 + 0.05));
  g.add(box(0.06, 1.7, 0.06, frameMat, 1.4, 1.95, -D / 2 + 0.06));
  const flashLight = new THREE.PointLight('#aabbff', 0, 6, 2);
  flashLight.position.set(1.4, 2, -D / 2 + 0.8);
  g.add(flashLight);
  let flash = 0;
  let nextFlash = 6;
  updaters.push((t, dt) => {
    rainMat.uniforms.time.value = t;
    nextFlash -= dt;
    if (nextFlash < 0) {
      flash = 1;
      nextFlash = 8 + Math.random() * 14;
    }
    flash = Math.max(0, flash - dt * 2.5);
    const f = flash > 0.6 ? flash : flash * (Math.sin(t * 40) > 0 ? 1 : 0.2);
    rainMat.uniforms.flash.value = f * 0.6;
    flashLight.intensity = f * 6;
  });
  // armchairs
  const leather = new THREE.MeshPhysicalMaterial({ color: '#3a120c', roughness: 0.45, clearcoat: 0.4 });
  for (const [x, z, ry] of [
    [-4.0, 2.6, 2.4],
    [-3.0, 3.3, 3.0],
  ]) {
    const ch = new THREE.Group();
    ch.add(box(0.85, 0.4, 0.85, leather, 0, 0.3, 0));
    ch.add(box(0.85, 0.65, 0.18, leather, 0, 0.75, -0.34));
    ch.add(box(0.16, 0.35, 0.85, leather, -0.36, 0.6, 0));
    ch.add(box(0.16, 0.35, 0.85, leather, 0.36, 0.6, 0));
    ch.position.set(x, 0, z);
    ch.rotation.y = ry;
    g.add(ch);
  }
  // bookshelf
  const shelfMat = new THREE.MeshStandardMaterial({ map: woodTexture('#2a140a', '#0a0402', 23), roughness: 0.5 });
  const bs = new THREE.Group();
  bs.add(box(2.2, 2.4, 0.4, shelfMat, 0, 1.2, 0));
  const books = new THREE.MeshStandardMaterial({ map: bookTexture(), roughness: 0.8 });
  for (let i = 0; i < 4; i++) {
    const row = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.42), books);
    row.position.set(0, 0.45 + i * 0.55, 0.205);
    bs.add(row);
  }
  bs.position.set(-W / 2 + 0.25, 0, -1.8);
  bs.rotation.y = Math.PI / 2;
  g.add(bs);
  // wall sconces
  for (const z of [-2.8, 2.8]) {
    const sc = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffcf8a').multiplyScalar(2), toneMapped: false }));
    sc.position.set(-W / 2 + 0.12, 2.1, z);
    g.add(sc);
    const l = new THREE.PointLight('#ffb870', 2.2, 4, 2);
    l.position.set(-W / 2 + 0.4, 2.1, z);
    g.add(l);
  }
  const d = dust(60, '#8a6a40', new THREE.Box3(new THREE.Vector3(-1.5, SLATE_Y + 0.1, -0.7), new THREE.Vector3(1.5, SLATE_Y + 1.0, 0.7)), 0.005);
  g.add(d.pts);
  updaters.push((t) => (d.mat.uniforms.time.value = t));
  pend.traverse((o) => o.material && (o.material = o.material.clone(), (o.material.transparent = true)));
  return { group: g, update: (t, dt) => updaters.forEach((u) => u(t, dt)), lights: [spot, fireLight], occluders: [pend] };
}

function buildSpace(ctx) {
  const g = new THREE.Group();
  const updaters = [];
  const W = 12;
  const D = 9;
  const H = 3.4;
  const pTex = panelTexture('#2b313a', '#11151a', '#35e0ff');
  pTex.wrapS = pTex.wrapT = THREE.RepeatWrapping;
  pTex.repeat.set(8, 2);
  const fTex = panelTexture('#1d2228', '#0b0e12', '#35e0ff');
  fTex.wrapS = fTex.wrapT = THREE.RepeatWrapping;
  fTex.repeat.set(8, 6);
  const wallMat = new THREE.MeshStandardMaterial({ map: pTex, roughness: 0.55, metalness: 0.6 });
  g.add(
    room(W, H, D, {
      floor: new THREE.MeshStandardMaterial({ map: fTex, roughness: 0.5, metalness: 0.6 }),
      ceil: new THREE.MeshStandardMaterial({ color: '#0d1014', roughness: 0.8, metalness: 0.4 }),
      wall: wallMat,
      skipWall: 0,
    })
  );
  // the -z wall has a big window: build it from pieces
  const z0 = -D / 2;
  const winW = 6;
  const winH = 2.0;
  const winY = 0.7;
  const pieces = [
    [W, winY, 0, winY / 2],
    [W, H - winY - winH, 0, winY + winH + (H - winY - winH) / 2],
    [(W - winW) / 2, winH, -W / 4 - winW / 4, winY + winH / 2],
    [(W - winW) / 2, winH, W / 4 + winW / 4, winY + winH / 2],
  ];
  for (const [w, h, x, y] of pieces) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    m.position.set(x, y, z0);
    g.add(m);
  }
  const frame = new THREE.MeshStandardMaterial({ color: '#8a96a6', metalness: 1, roughness: 0.3 });
  g.add(box(winW + 0.2, 0.12, 0.2, frame, 0, winY, z0 + 0.05));
  g.add(box(winW + 0.2, 0.12, 0.2, frame, 0, winY + winH, z0 + 0.05));
  for (const x of [-winW / 2, -winW / 6, winW / 6, winW / 2]) g.add(box(0.1, winH, 0.18, frame, x, winY + winH / 2, z0 + 0.05));
  // outside: stars and planet
  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  for (let i = 0; i < 2500; i++) {
    const v = new THREE.Vector3().randomDirection();
    if (v.z > -0.1) v.z = -Math.abs(v.z) - 0.1;
    v.multiplyScalar(60);
    sp.push(v.x, v.y, v.z);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.12, sizeAttenuation: true, toneMapped: false }));
  g.add(stars);
  const planetMat = planetMaterial();
  const planet = new THREE.Mesh(new THREE.SphereGeometry(9, 64, 48), planetMat);
  planet.position.set(-6, -4, -30);
  g.add(planet);
  const atmo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(90,160,255,0.55)', 'rgba(90,160,255,0)'), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  atmo.scale.set(24, 24, 1);
  atmo.position.copy(planet.position).add(new THREE.Vector3(0, 0, -1));
  g.add(atmo);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(1.2, 32, 24), new THREE.MeshStandardMaterial({ color: '#8d8a86', roughness: 1 }));
  g.add(moon);
  updaters.push((t) => {
    planetMat.uniforms.time.value = t;
    planet.rotation.y = t * 0.01;
    moon.position.set(planet.position.x + Math.cos(t * 0.03) * 16, planet.position.y + 5 + Math.sin(t * 0.03) * 2, planet.position.z + Math.sin(t * 0.03) * 8);
    stars.rotation.z = t * 0.002;
  });
  const sun = new THREE.DirectionalLight('#ffffff', 0.6);
  sun.position.set(-3, 2, -6);
  g.add(sun);
  // lights
  g.add(new THREE.HemisphereLight('#9fd8ff', '#0a0d12', 0.4));
  const spot = tableSpot('#e8f6ff', 15, ctx.quality);
  g.add(spot, spot.target);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.03, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color('#35e0ff').multiplyScalar(2), toneMapped: false, transparent: true }));
  ring.rotation.x = Math.PI / 2;
  ring.scale.set(1.3, 0.75, 1);
  ring.position.y = SLATE_Y + 1.4;
  g.add(ring);
  // pulsing light strips + blinking panel lights
  const strips = [];
  for (let i = 0; i < 8; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: '#35e0ff', toneMapped: false });
    const s = box(0.04, 1.6, 0.02, mat, 0, 1.7, 0, false);
    const side = i < 4 ? -1 : 1;
    s.position.set(side * (W / 2 - 0.03), 1.7, -3 + (i % 4) * 2);
    s.rotation.y = Math.PI / 2;
    g.add(s);
    strips.push(mat);
  }
  const blinkers = [];
  for (let i = 0; i < 24; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: i % 3 ? '#35ff8a' : '#ff5a35', toneMapped: false });
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.025, 8), mat);
    const side = i % 2 ? 1 : -1;
    b.position.set(side * (W / 2 - 0.02), 0.9 + (i % 4) * 0.12, -3.5 + Math.floor(i / 4) * 1.3);
    b.rotation.y = -side * Math.PI / 2;
    g.add(b);
    blinkers.push({ mat, phase: Math.random() * 10, rate: 0.5 + Math.random() * 2 });
  }
  updaters.push((t) => {
    strips.forEach((m, i) => {
      const k = 0.6 + 0.4 * Math.sin(t * 1.5 + i * 0.7);
      m.color.setRGB(0.2 * k * 2, 0.88 * k * 2, 1.0 * k * 2);
    });
    blinkers.forEach((b) => (b.mat.visible = Math.sin(t * b.rate + b.phase) > 0.2));
  });
  // consoles
  const consoleMat = new THREE.MeshStandardMaterial({ color: '#2a3038', metalness: 0.7, roughness: 0.4 });
  for (const x of [-3.8, 3.8]) {
    const c = new THREE.Group();
    c.add(box(1.4, 0.9, 0.6, consoleMat, 0, 0.45, 0));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.35), new THREE.MeshBasicMaterial({ color: new THREE.Color('#0a3a4a').multiplyScalar(2), toneMapped: false }));
    scr.position.set(0, 0.95, 0.1);
    scr.rotation.x = -0.6;
    c.add(scr);
    c.position.set(x, 0, D / 2 - 0.5);
    c.rotation.y = Math.PI;
    g.add(c);
  }
  // floating dust motes
  const d = dust(260, '#9fe8ff', new THREE.Box3(new THREE.Vector3(-4.5, 0.2, -3.8), new THREE.Vector3(4.5, 3.1, 3.8)), 0.01);
  g.add(d.pts);
  updaters.push((t) => (d.mat.uniforms.time.value = t));
  return {
    group: g,
    update: (t, dt) => updaters.forEach((u) => u(t, dt)),
    lights: [spot],
    occluders: [ring],
    glowUpdate: (mats, t) => mats.forEach((m) => {
      const k = 0.75 + 0.25 * Math.sin(t * 1.2);
      m.color.setRGB(0.2 * k * 2.2, 0.85 * k * 2.2, 1 * k * 2.2);
    }),
  };
}
