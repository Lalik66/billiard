// Persistent settings, stats, unlocks and best challenge scores (localStorage only).
const KEY = 'cueclub3d.v1';

const DEFAULTS = {
  settings: {
    master: 0.8,
    sfx: 0.9,
    music: 0.35,
    muted: false,
    quality: 'auto',
    guide: 'auto', // auto | full | short | off
    sensitivity: 1,
    shotClock: false,
    invertPull: false,
  },
  stats: {
    games: 0,
    wins: 0,
    losses: 0,
    shots: 0,
    pots: 0,
    fouls: 0,
    bestRun: 0,
    breakAndRuns: 0,
    byMode: {},
  },
  venue: 'pub',
  trick: {}, // levelId -> { stars, best }
  names: ['Player 1', 'Player 2'],
};

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

// Player names come straight from localStorage and are later interpolated into
// HTML (turn messages, dialogs), so strip markup characters and clamp length.
// Also guarantees exactly two non-empty strings so callers can index safely.
function sanitizeNames(v) {
  const clean = (s, dflt) => {
    if (typeof s !== 'string') return dflt;
    const out = s.replace(/[<>&"']/g, '').trim().slice(0, 24);
    return out || dflt;
  };
  const arr = Array.isArray(v) ? v : [];
  return [clean(arr[0], 'Player 1'), clean(arr[1], 'Player 2')];
}

export class Store {
  constructor() {
    this.data = clone(DEFAULTS);
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        this.data = {
          ...clone(DEFAULTS),
          ...d,
          settings: { ...DEFAULTS.settings, ...(d.settings || {}) },
          stats: { ...DEFAULTS.stats, ...(d.stats || {}) },
          trick: d.trick && typeof d.trick === 'object' ? d.trick : {},
          names: sanitizeNames(d.names),
          venue: typeof d.venue === 'string' ? d.venue : DEFAULTS.venue,
        };
      }
    } catch {
      /* storage unavailable - keep defaults */
    }
  }
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }
  get settings() {
    return this.data.settings;
  }
  setSetting(k, v) {
    this.data.settings[k] = v;
    this.save();
  }
  recordGame({ mode, won, vsAI, stats, breakAndRun }) {
    const s = this.data.stats;
    s.games++;
    if (vsAI) {
      if (won) s.wins++;
      else s.losses++;
    }
    if (stats) {
      s.shots += stats.shots;
      s.pots += stats.pots;
      s.fouls += stats.fouls;
      s.bestRun = Math.max(s.bestRun, stats.longestRun);
    }
    if (breakAndRun) s.breakAndRuns++;
    const m = (s.byMode[mode] = s.byMode[mode] || { played: 0, won: 0 });
    m.played++;
    if (won) m.won++;
    this.save();
  }
  recordTrick(id, stars, shots) {
    const cur = this.data.trick[id] || { stars: 0, best: Infinity };
    cur.stars = Math.max(cur.stars, stars);
    cur.best = Math.min(cur.best ?? Infinity, shots);
    this.data.trick[id] = cur;
    this.save();
  }
  trickStars(id) {
    return this.data.trick[id]?.stars || 0;
  }
  resetAll() {
    this.data = clone(DEFAULTS);
    this.save();
  }
}
