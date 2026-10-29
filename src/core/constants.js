// Table geometry and physical constants. All units are SI (metres, seconds, kg).
// Physics coordinates: x along the table length (head at -x, foot at +x),
// y across the table, z up (z = 0 means the ball rests on the cloth).

export const R = 0.028575; // ball radius (2 1/4" ball)
// The physics engine is mass-normalised (all impulses are per-unit-mass and every
// ball has the same mass), so BALL_MASS is not used in the simulation. It is kept
// only as a reference value; do not multiply it into impulses.
export const BALL_MASS = 0.17;
export const HX = 1.27; // half playing length (9ft table, cushion nose to nose)
export const HY = 0.635; // half playing width
export const G = 9.81;

export const CUSHION_W = 0.05; // cushion rubber width (nose to rail)
export const RAIL_W = 0.12; // wooden rail width
export const CUSHION_H = 0.0365; // nose height above slate

export const MU_SLIDE = 0.2; // ball-cloth sliding friction
export const MU_ROLL = 0.0105; // rolling resistance
export const MU_SPIN = 0.044; // spin (z axis) friction
export const E_BALL = 0.94; // ball-ball restitution
export const E_SLATE = 0.5; // bounce restitution on the slate (jump shots)
export const MU_CUSHION = 0.3; // ball-cushion friction

export const HEAD_STRING_X = -HX / 2;
export const FOOT_SPOT = [HX / 2, 0];
export const HEAD_SPOT = [-HX / 2, 0];

export const MAX_SPEED = 11.0; // cue ball speed at full power (m/s)
export const MIN_SPEED = 0.2;
export const MAX_TIP_OFFSET = 0.5; // max cue tip offset as a fraction of R

export function powerToSpeed(p) {
  p = Math.max(0, Math.min(1, p));
  return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.pow(p, 1.6);
}
export function speedToPower(v) {
  const t = (v - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
  return Math.max(0, Math.min(1, Math.pow(Math.max(0, t), 1 / 1.6)));
}

// ---------------------------------------------------------------------------
// Pockets and cushion segments
// ---------------------------------------------------------------------------
const CORNER_MOUTH = 0.086; // distance of corner jaw nose points from the corner
const CORNER_JAW_ANGLE = (38 * Math.PI) / 180;
const CORNER_JAW_LEN = 0.06;
const SIDE_MOUTH = 0.068; // half mouth width of side pockets
const SIDE_JAW_ANGLE = (76 * Math.PI) / 180; // from the rail line
const SIDE_JAW_LEN = 0.05;

function buildTable() {
  const pockets = [];
  // index: 0 (-x,-y) corner, 1 (0,-y) side, 2 (+x,-y) corner, 3 (+x,+y) corner, 4 (0,+y) side, 5 (-x,+y) corner
  const defs = [
    { type: 'corner', sx: -1, sy: -1 },
    { type: 'side', sx: 0, sy: -1 },
    { type: 'corner', sx: 1, sy: -1 },
    { type: 'corner', sx: 1, sy: 1 },
    { type: 'side', sx: 0, sy: 1 },
    { type: 'corner', sx: -1, sy: 1 },
  ];
  defs.forEach((d, i) => {
    if (d.type === 'corner') {
      const c = 0.022;
      const inv = Math.SQRT1_2;
      pockets.push({
        id: i,
        type: 'corner',
        x: d.sx * (HX + c),
        y: d.sy * (HY + c),
        r: 0.064,
        // aim point the AI / guide uses (just inside the mouth)
        ax: d.sx * (HX - 0.008),
        ay: d.sy * (HY - 0.008),
        // unit vector pointing from the pocket into the table
        nx: -d.sx * inv,
        ny: -d.sy * inv,
        sx: d.sx,
        sy: d.sy,
      });
    } else {
      pockets.push({
        id: i,
        type: 'side',
        x: 0,
        y: d.sy * (HY + 0.04),
        r: 0.064,
        ax: 0,
        ay: d.sy * (HY + 0.006),
        nx: 0,
        ny: -d.sy,
        sx: 0,
        sy: d.sy,
      });
    }
  });

  const segments = [];
  const addSeg = (ax, ay, bx, by, kind) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    segments.push({ ax, ay, bx, by, dx: dx / len, dy: dy / len, len, nx: -dy / len, ny: dx / len, kind });
  };
  const a = CORNER_MOUTH;
  const cj = Math.cos(CORNER_JAW_ANGLE) * CORNER_JAW_LEN;
  const sj = Math.sin(CORNER_JAW_ANGLE) * CORNER_JAW_LEN;
  const sideDx = Math.cos(SIDE_JAW_ANGLE) * SIDE_JAW_LEN;
  const sideDy = Math.sin(SIDE_JAW_ANGLE) * SIDE_JAW_LEN;
  const s = SIDE_MOUTH;
  const cushions = []; // polygons for rendering: [ [x,y], ... ] in order

  for (const sy of [-1, 1]) {
    // two long-rail cushions per side
    for (const sx of [-1, 1]) {
      // from the corner (sx*HX) to the side pocket (0)
      const nCorner = [sx * (HX - a), sy * HY];
      const nSide = [sx * s, sy * HY];
      const jCorner = [nCorner[0] + sx * cj, nCorner[1] + sy * sj];
      const jSide = [nSide[0] - sx * sideDx, nSide[1] + sy * sideDy];
      addSeg(nCorner[0], nCorner[1], nSide[0], nSide[1], 'rail');
      addSeg(nCorner[0], nCorner[1], jCorner[0], jCorner[1], 'jaw');
      addSeg(nSide[0], nSide[1], jSide[0], jSide[1], 'jaw');
      const back = sy * (HY + CUSHION_W);
      cushions.push([
        nCorner,
        nSide,
        [jSide[0] - sx * sideDx * 0.03, back],
        [jCorner[0] + sx * cj * 0.05, back],
      ]);
    }
  }
  for (const sx of [-1, 1]) {
    // short rail cushion
    const n1 = [sx * HX, -(HY - a)];
    const n2 = [sx * HX, HY - a];
    const j1 = [n1[0] + sx * sj, n1[1] - cj];
    const j2 = [n2[0] + sx * sj, n2[1] + cj];
    addSeg(n1[0], n1[1], n2[0], n2[1], 'rail');
    addSeg(n1[0], n1[1], j1[0], j1[1], 'jaw');
    addSeg(n2[0], n2[1], j2[0], j2[1], 'jaw');
    const back = sx * (HX + CUSHION_W);
    cushions.push([n1, n2, [back, j2[1] + cj * 0.05], [back, j1[1] - cj * 0.05]]);
  }

  // unique endpoints (rounded cushion noses / jaw tips)
  const points = [];
  const seen = new Set();
  for (const sg of segments) {
    for (const p of [
      [sg.ax, sg.ay],
      [sg.bx, sg.by],
    ]) {
      const key = p[0].toFixed(5) + ',' + p[1].toFixed(5);
      if (!seen.has(key)) {
        seen.add(key);
        points.push(p);
      }
    }
  }
  return { pockets, segments, points, cushions };
}

export const TABLE = buildTable();
export const POCKETS = TABLE.pockets;

export const POCKET_NAMES = [
  'bottom-left corner',
  'bottom side',
  'bottom-right corner',
  'top-right corner',
  'top side',
  'top-left corner',
];

export function isSolid(n) {
  return n >= 1 && n <= 7;
}
export function isStripe(n) {
  return n >= 9 && n <= 15;
}
