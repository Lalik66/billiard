// Procedural canvas textures: balls, felt, wood grain, bricks, panels, etc.
import * as THREE from 'three';

export const BALL_COLORS = {
  1: '#f4c20d',
  2: '#1b4fb5',
  3: '#d32222',
  4: '#5a2d91',
  5: '#f2731c',
  6: '#13804a',
  7: '#8a1f1f',
  8: '#111111',
};
export function ballColor(n) {
  if (n === 0) return '#f7f3e6';
  if (n === 8) return BALL_COLORS[8];
  return BALL_COLORS[((n - 1) % 8) + 1] || '#fff';
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat = null, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.needsUpdate = true;
  return t;
}

// seeded noise helpers
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const ballCache = new Map();
export function ballTexture(n) {
  if (ballCache.has(n)) return ballCache.get(n);
  const W = 1024;
  const H = 512;
  const [c, g] = canvas(W, H);
  const ivory = '#f8f4e6';
  const col = ballColor(n);
  const stripe = n >= 9;
  g.fillStyle = stripe || n === 0 ? ivory : col;
  g.fillRect(0, 0, W, H);
  if (stripe) {
    g.fillStyle = col;
    g.fillRect(0, H * 0.27, W, H * 0.46);
  }
  if (n === 0) {
    // cue ball: small red dots so spin is visible
    g.fillStyle = '#c3122a';
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      g.beginPath();
      g.arc(u * W, H / 2, 9, 0, Math.PI * 2);
      g.fill();
    }
    g.fillRect(0, 0, W, 7);
    g.fillRect(0, H - 7, W, 7);
  } else {
    for (const u of [0.25, 0.75]) {
      const cx = u * W;
      const cy = H / 2;
      g.fillStyle = ivory;
      g.beginPath();
      g.ellipse(cx, cy, 62, 62, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#141414';
      g.font = `bold ${n >= 10 ? 66 : 76}px Arial, Helvetica, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(n), cx, cy + 4);
      if (n === 6 || n === 9) g.fillRect(cx - 18, cy + 38, 36, 6);
    }
  }
  const t = tex(c);
  ballCache.set(n, t);
  return t;
}

// Small 2D ball icon for the HUD (data URL)
const iconCache = new Map();
export function ballIcon(n, size = 44) {
  const key = n + ':' + size;
  if (iconCache.has(key)) return iconCache.get(key);
  const [c, g] = canvas(size, size);
  const r = size / 2 - 1;
  const col = ballColor(n);
  g.save();
  g.beginPath();
  g.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = n >= 9 || n === 0 ? '#f8f4e6' : col;
  g.fillRect(0, 0, size, size);
  if (n >= 9) {
    g.fillStyle = col;
    g.fillRect(0, size * 0.24, size, size * 0.52);
  }
  if (n > 0) {
    g.fillStyle = '#f8f4e6';
    g.beginPath();
    g.arc(size / 2, size / 2, r * 0.48, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111';
    g.font = `bold ${Math.round(size * 0.36)}px Arial`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), size / 2, size / 2 + 1);
  }
  const grd = g.createRadialGradient(size * 0.35, size * 0.3, 1, size / 2, size / 2, r);
  grd.addColorStop(0, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  g.restore();
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

export function feltTexture(seed = 3) {
  const S = 512;
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  const r = rng(seed);
  for (let i = 0; i < S * S; i++) {
    const v = 200 + r() * 55;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // soft fibres
  g.globalAlpha = 0.06;
  for (let i = 0; i < 2500; i++) {
    g.strokeStyle = r() > 0.5 ? '#fff' : '#000';
    g.lineWidth = 0.6;
    const x = r() * S;
    const y = r() * S;
    const a = r() * Math.PI;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6);
    g.stroke();
  }
  g.globalAlpha = 1;
  return tex(c, { repeat: [6, 3], srgb: false });
}

export function woodTexture(base = '#6b3a1f', dark = '#3a1d0d', seed = 5, w = 1024, h = 256) {
  const [c, g] = canvas(w, h);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const r = rng(seed);
  // long grain lines
  for (let i = 0; i < 140; i++) {
    const y0 = r() * h;
    const amp = 2 + r() * 8;
    const freq = 0.004 + r() * 0.01;
    const ph = r() * 10;
    g.strokeStyle = dark;
    g.globalAlpha = 0.08 + r() * 0.22;
    g.lineWidth = 0.6 + r() * 2.2;
    g.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph) * amp * 0.3;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // knots
  for (let k = 0; k < 3; k++) {
    const kx = r() * w;
    const ky = r() * h;
    for (let i = 0; i < 8; i++) {
      g.globalAlpha = 0.12;
      g.strokeStyle = dark;
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(kx, ky, 6 + i * 5, 2 + i * 2, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  // sheen variation
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(255,255,255,0.06)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.05)');
  grd.addColorStop(1, 'rgba(255,255,255,0.04)');
  g.globalAlpha = 1;
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  return tex(c, { repeat: [1, 1] });
}

export function plankTexture(base = '#5a3a22', dark = '#2a170a', seed = 9) {
  const W = 1024;
  const H = 1024;
  const [c, g] = canvas(W, H);
  const r = rng(seed);
  const rows = 8;
  for (let i = 0; i < rows; i++) {
    const y = (i * H) / rows;
    let x = -r() * 400;
    while (x < W) {
      const len = 300 + r() * 400;
      const shade = 0.75 + r() * 0.35;
      g.fillStyle = base;
      g.globalAlpha = 1;
      g.fillRect(x, y, len, H / rows);
      g.fillStyle = `rgba(0,0,0,${(1 - shade) * 0.8})`;
      if (shade < 1) g.fillRect(x, y, len, H / rows);
      else {
        g.fillStyle = `rgba(255,255,255,${(shade - 1) * 0.5})`;
        g.fillRect(x, y, len, H / rows);
      }
      for (let k = 0; k < 10; k++) {
        g.strokeStyle = dark;
        g.globalAlpha = 0.15;
        g.lineWidth = 1;
        const yy = y + r() * (H / rows);
        g.beginPath();
        g.moveTo(x, yy);
        g.bezierCurveTo(x + len * 0.3, yy + 4, x + len * 0.6, yy - 4, x + len, yy);
        g.stroke();
      }
      g.globalAlpha = 0.6;
      g.fillStyle = dark;
      g.fillRect(x, y, 3, H / rows);
      x += len;
    }
    g.globalAlpha = 0.7;
    g.fillStyle = dark;
    g.fillRect(0, y, W, 3);
  }
  g.globalAlpha = 1;
  return tex(c, { repeat: [4, 4] });
}

export function brickTexture() {
  const W = 512;
  const H = 512;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#4a2f26';
  g.fillRect(0, 0, W, H);
  const r = rng(11);
  const bh = 32;
  const bw = 96;
  for (let row = 0; row < H / bh; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -bw; x < W + bw; x += bw) {
      const v = 0.75 + r() * 0.35;
      const red = Math.floor(140 * v);
      const gr = Math.floor(66 * v);
      const bl = Math.floor(48 * v);
      g.fillStyle = `rgb(${red},${gr},${bl})`;
      g.fillRect(x + off + 3, row * bh + 3, bw - 6, bh - 6);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let k = 0; k < 6; k++) g.fillRect(x + off + 3 + r() * (bw - 10), row * bh + 3 + r() * (bh - 8), 3, 2);
    }
  }
  return tex(c, { repeat: [6, 2] });
}

export function panelTexture(base = '#2a2e36', line = '#14171c', light = '#7fd8ff') {
  const S = 512;
  const [c, g] = canvas(S, S);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  const grd = g.createLinearGradient(0, 0, S, S);
  grd.addColorStop(0, 'rgba(255,255,255,0.06)');
  grd.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = line;
  g.lineWidth = 6;
  g.strokeRect(4, 4, S - 8, S - 8);
  g.beginPath();
  g.moveTo(0, S / 2);
  g.lineTo(S, S / 2);
  g.stroke();
  g.fillStyle = '#9aa3ad';
  for (const [x, y] of [
    [20, 20],
    [S - 20, 20],
    [20, S - 20],
    [S - 20, S - 20],
    [20, S / 2 - 18],
    [S - 20, S / 2 + 18],
  ]) {
    g.beginPath();
    g.arc(x, y, 5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = light;
  g.globalAlpha = 0.5;
  g.fillRect(60, S / 2 + 40, S - 120, 6);
  g.globalAlpha = 1;
  return tex(c, { repeat: [1, 1] });
}

export function carpetTexture(base = '#3b1016', accent = '#6e2a1c') {
  const S = 512;
  const [c, g] = canvas(S, S);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  const r = rng(21);
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < S * S; i++) {
    const v = (r() - 0.5) * 22;
    img.data[i * 4] += v;
    img.data[i * 4 + 1] += v;
    img.data[i * 4 + 2] += v;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = accent;
  g.globalAlpha = 0.5;
  g.lineWidth = 4;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(S / 2, i * 40 + 20);
    g.lineTo(S - i * 40 - 20, S / 2);
    g.lineTo(S / 2, S - i * 40 - 20);
    g.lineTo(i * 40 + 20, S / 2);
    g.closePath();
    g.stroke();
  }
  return tex(c, { repeat: [5, 5] });
}

export function dartboardTexture() {
  const S = 512;
  const [c, g] = canvas(S, S);
  const cx = S / 2;
  g.fillStyle = '#111';
  g.beginPath();
  g.arc(cx, cx, cx, 0, Math.PI * 2);
  g.fill();
  const rings = [
    [0.8, 0.75, true],
    [0.75, 0.47, false],
    [0.47, 0.43, true],
    [0.43, 0.1, false],
  ];
  for (let i = 0; i < 20; i++) {
    const a0 = ((i - 0.5) / 20) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 0.5) / 20) * Math.PI * 2 - Math.PI / 2;
    for (const [ro, ri, ring] of rings) {
      g.fillStyle = ring ? (i % 2 ? '#1a7a2e' : '#c21f1f') : i % 2 ? '#efe2c0' : '#161616';
      g.beginPath();
      g.arc(cx, cx, ro * cx, a0, a1);
      g.arc(cx, cx, ri * cx, a1, a0, true);
      g.closePath();
      g.fill();
    }
  }
  g.fillStyle = '#1a7a2e';
  g.beginPath();
  g.arc(cx, cx, 0.1 * cx, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#c21f1f';
  g.beginPath();
  g.arc(cx, cx, 0.045 * cx, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ddd';
  g.font = 'bold 30px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const nums = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  nums.forEach((n, i) => {
    const a = (i / 20) * Math.PI * 2 - Math.PI / 2;
    g.fillText(String(n), cx + Math.cos(a) * cx * 0.9, cx + Math.sin(a) * cx * 0.9);
  });
  return tex(c);
}

export function neonTextTexture(text, color = '#ff3d7f', w = 1024, h = 256, font = 'bold 150px "Brush Script MT", "Segoe Script", cursive') {
  const [c, g] = canvas(w, h);
  g.clearRect(0, 0, w, h);
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  for (const blur of [40, 20, 8]) {
    g.shadowBlur = blur;
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2);
  }
  g.shadowBlur = 0;
  g.fillStyle = '#fff';
  g.globalAlpha = 0.8;
  g.fillText(text, w / 2, h / 2);
  return tex(c);
}

export function radialTexture(inner = 'rgba(0,0,0,0.55)', outer = 'rgba(0,0,0,0)', size = 128) {
  const [c, g] = canvas(size, size);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return tex(c, { srgb: false });
}

export function bookTexture() {
  const W = 512;
  const H = 256;
  const [c, g] = canvas(W, H);
  const r = rng(33);
  let x = 0;
  const cols = ['#5b1a1a', '#1d3a5b', '#2b4a2a', '#5b4a1a', '#3a2a4a', '#222', '#6b3a1a'];
  while (x < W) {
    const w = 10 + r() * 16;
    const h = H * (0.7 + r() * 0.3);
    g.fillStyle = cols[Math.floor(r() * cols.length)];
    g.fillRect(x, H - h, w - 1, h);
    g.fillStyle = 'rgba(230,200,120,0.6)';
    g.fillRect(x + 2, H - h + 12, w - 5, 2);
    g.fillRect(x + 2, H - 18, w - 5, 2);
    x += w;
  }
  return tex(c);
}

// Animated canvas screen for arcade cabinets
export class ArcadeScreen {
  constructor(seed) {
    [this.canvas, this.g] = canvas(128, 128);
    this.texture = tex(this.canvas);
    this.r = rng(seed);
    this.seed = seed;
    this.t = 0;
    this.kind = seed % 3;
    this.hue = (seed * 67) % 360;
  }
  update(dt) {
    this.t += dt;
    const g = this.g;
    g.fillStyle = '#05010d';
    g.fillRect(0, 0, 128, 128);
    const t = this.t;
    if (this.kind === 0) {
      // invaders
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 6; col++) {
          const x = 14 + col * 17 + Math.sin(t * 1.5) * 8;
          const y = 16 + row * 14 + ((t * 2) % 20);
          g.fillStyle = `hsl(${(this.hue + row * 40) % 360},90%,60%)`;
          const f = Math.floor(t * 3) % 2;
          g.fillRect(x, y, 10, 6);
          g.fillRect(x + (f ? 0 : 2), y + 6, 2, 3);
          g.fillRect(x + (f ? 8 : 6), y + 6, 2, 3);
        }
      g.fillStyle = '#4f4';
      g.fillRect(56 + Math.sin(t * 2.3) * 40, 112, 14, 6);
    } else if (this.kind === 1) {
      // racing stripes
      for (let i = 0; i < 12; i++) {
        const y = ((i * 12 + t * 80) % 140) - 10;
        const w = 20 + y * 0.8;
        g.fillStyle = i % 2 ? '#ff2e88' : '#22d3ee';
        g.fillRect(64 - w / 2, y, 3, 8);
        g.fillRect(64 + w / 2, y, 3, 8);
      }
      g.fillStyle = '#ffe14d';
      g.fillRect(58 + Math.sin(t * 1.7) * 20, 100, 12, 18);
    } else {
      // pong / snake-ish
      const bx = 64 + Math.sin(t * 2.1) * 52;
      const by = 64 + Math.sin(t * 3.3) * 52;
      g.fillStyle = '#fff';
      g.fillRect(bx, by, 5, 5);
      g.fillRect(6, by - 12, 4, 26);
      g.fillRect(118, 64 + Math.sin(t * 3.3 + 0.4) * 48 - 12, 4, 26);
      for (let y = 0; y < 128; y += 10) g.fillRect(63, y, 2, 5);
    }
    // blink "INSERT COIN"
    if (Math.floor(t * 2) % 2 === 0) {
      g.fillStyle = '#ffe14d';
      g.font = 'bold 11px monospace';
      g.textAlign = 'center';
      g.fillText('INSERT COIN', 64, 10);
    }
    // scanlines
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < 128; y += 3) g.fillRect(0, y, 128, 1);
    this.texture.needsUpdate = true;
  }
}
