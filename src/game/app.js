// Game controller: menus <-> modes (match / practice / trick), turn flow,
// human input actions, AI turns, camera, audio and HUD updates.
import * as THREE from 'three';
import { Stage } from '../render/stage.js';
import { Overlay } from '../render/overlay.js';
import { SLATE_Y } from '../render/table.js';
import { VENUES, venueById } from '../render/venues.js';
import { Sim, ON_TABLE, DT } from '../core/physics.js';
import { GameEngine } from '../core/engine.js';
import { analyzeShot } from '../core/rules.js';
import { rack8, rack9, mulberry32, isFree, inPlayArea, nearestValid } from '../core/rack.js';
import { LEVELS, evaluateLevelShot, starsFor } from '../core/levels.js';
import { planMatchShot, decidePush } from '../core/ai.js';
import { R, POCKETS, POCKET_NAMES, HEAD_SPOT, FOOT_SPOT, powerToSpeed, speedToPower } from '../core/constants.js';
import { Audio } from './audio.js';
import { Store } from './storage.js';
import { Input } from './input.js';
import { predictShot } from './predict.js';
import { UI } from '../ui/ui.js';

const DEG = Math.PI / 180;
const DIFF_NAMES = { easy: 'Easy', medium: 'Medium', hard: 'Hard', pro: 'Pro' };
const GUIDE_OPTS = {
  full: { aimLen: 3.2, bounces: 1, objLen: 0.9, cueLen: 0.6 },
  medium: { aimLen: 2.6, bounces: 0, objLen: 0.42, cueLen: 0.22 },
  short: { aimLen: 2.6, bounces: 0, objLen: 0.14, cueLen: 0 },
};
const SHOT_CLOCK = 45;

function angDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class App {
  constructor() {
    this.store = new Store();
    this.audio = new Audio();
    this.stage = new Stage(document.getElementById('stage'));
    this.overlay = new Overlay(this.stage.scene);
    this.ui = new UI(document.getElementById('ui'), this);
    this.input = new Input(this, this.stage.renderer.domElement);
    this.mode = 'menu';
    this.phase = 'idle';
    this.paused = false;
    this.sim = new Sim();
    this.aim = { angle: 0, spinX: 0, spinY: 0, elevationDeg: 0 };
    this.power = 0;
    this.pulling = false;
    this.lastPower = 0.35;
    this.guideDirty = true;
    this.pred = null;
    this.cueAnim = { pull: 0.03, visible: true, fade: 0 };
    this.reqId = 0;
    this.pending = new Map();
    this.fps = { t: 0, frames: 0, low: 0 };
    this.initWorker();
    this.applySettings();
    this.stage.setVenue(this.store.data.venue);
    this.quitToMenu();
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    document.getElementById('boot').classList.add('gone');
  }

  // ------------------------------------------------------------------ setup
  initWorker() {
    try {
      this.worker = new Worker(new URL('../core/ai.worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.error) {
          console.error(e.data.error);
          p.resolve(p.fallback());
        } else p.resolve(e.data.result);
      };
      this.worker.onerror = (e) => {
        console.warn('AI worker failed, using main thread', e.message);
        this.worker = null;
        for (const p of this.pending.values()) p.resolve(p.fallback());
        this.pending.clear();
      };
    } catch {
      this.worker = null;
    }
  }

  askAI(kind, input) {
    const fallback = () => (kind === 'push' ? decidePush(input) : planMatchShot(input));
    if (!this.worker) return new Promise((res) => setTimeout(() => res(fallback()), 30));
    const id = ++this.reqId;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, fallback });
      this.worker.postMessage({ id, kind, input });
    });
  }

  applySettings() {
    const s = this.store.settings;
    this.audio.apply({ master: s.master, sfx: s.sfx, music: s.music, muted: s.muted });
    let q = s.quality;
    if (q === 'auto') {
      const strong = !this.isMobile() && (navigator.hardwareConcurrency || 4) >= 6 && (window.devicePixelRatio || 1) <= 1.5;
      q = this.autoQuality || (strong ? 'high' : 'medium');
    }
    if (q !== this.stage.quality) this.stage.setQuality(q);
    this.guideDirty = true;
  }

  isMobile() {
    return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
  }

  setSetting(k, v) {
    this.store.setSetting(k, v);
    if (k === 'quality') this.autoQuality = null;
    this.applySettings();
  }

  toggleMute() {
    this.setSetting('muted', !this.store.settings.muted);
    this.ui.toast(this.store.settings.muted ? 'Sound muted' : 'Sound on');
  }

  selectVenue(id) {
    this.store.data.venue = id;
    this.store.save();
    this.stage.setVenue(id);
    if (this.audio.musicStyle || this.mode === 'menu') this.audio.startMusic(venueById(id).music);
  }

  unlockedVenues() {
    const w = this.store.data.stats.wins;
    return VENUES.filter((v) => w >= v.unlock);
  }

  // ------------------------------------------------------------------ menus / modes
  quitToMenu(showMain = true) {
    this.mode = 'menu';
    this.phase = 'idle';
    this.paused = false;
    this.aiTask = null;
    this.engine = null;
    this.ui.hideDialogs();
    this.ui.showHUD(false);
    this.overlay.showPockets(false);
    this.overlay.setBallInHand(false);
    this.overlay.setZone(null);
    this.overlay.showAllowed(null);
    this.stage.guide.update(null);
    this.stage.cue.show(false);
    this.sim = new Sim();
    this.sim.setBalls(rack8(mulberry32(7)));
    this.stage.rig.attract = true;
    if (showMain) this.ui.show('main');
    this.audio.startMusic(venueById(this.store.data.venue).music);
  }

  enterGame(kind) {
    this.ui.show(null);
    this.ui.hideDialogs();
    this.ui.showHUD(true, kind);
    this.stage.rig.attract = false;
    this.stage.rig.setMode('cue');
    this.stage.rig.snapNext = false;
    this.ui.setCameraLabel('cue');
    this.paused = false;
    this.aiTask = null;
    this.pulling = false;
    this.power = 0;
    this.overlay.showPockets(false);
    this.overlay.setZone(null);
    this.overlay.showAllowed(null);
    this.audio.startMusic(venueById(this.store.data.venue).music);
    // make sure the selected venue is unlocked
    const v = venueById(this.store.data.venue);
    if (this.store.data.stats.wins < v.unlock) this.selectVenue('pub');
  }

  startMatch(game, vsAI, difficulty) {
    this.matchCfg = { game, vsAI, difficulty };
    this.mode = 'match';
    this.game = game;
    this.vsAI = vsAI;
    this.difficulty = difficulty;
    this.players = vsAI
      ? [
          { name: 'You', isAI: false },
          { name: `CPU · ${DIFF_NAMES[difficulty]}`, isAI: true, difficulty },
        ]
      : [
          { name: this.store.data.names[0] || 'Player 1', isAI: false },
          { name: this.store.data.names[1] || 'Player 2', isAI: false },
        ];
    this.engine = new GameEngine(game, this.players, (Math.random() * 1e9) | 0);
    this.sim = this.engine.sim;
    this.enterGame('match');
    this.rackIntro();
    this.ui.toast(`${game === '8ball' ? '8-Ball' : '9-Ball'} · ${this.players[0].name} to break`, 'info');
    this.beginTurn();
  }

  startPractice() {
    this.mode = 'practice';
    this.practiceRack = this.practiceRack || '8ball';
    this.sim = new Sim();
    this.sim.setBalls(this.practiceRack === '9ball' ? rack9() : rack8());
    this.undoStack = [];
    this.moveBalls = false;
    this.enterGame('practice');
    this.rackIntro();
    this.bih = { kitchen: false };
    this.phase = 'aim';
    this.resetAimForTurn();
    this.ui.turnMessage('Practice &middot; free table');
    this.refreshActions();
  }

  startTrick(id) {
    const level = LEVELS.find((l) => l.id === id) || LEVELS[0];
    this.mode = 'trick';
    this.level = level;
    this.shotsUsed = 0;
    this.trickPotted = new Set();
    this.sim = new Sim();
    this.sim.setBalls(level.balls);
    this.enterGame('trick');
    this.rackIntro();
    const pockets = level.pockets ? [...new Set(Object.values(level.pockets).flat())] : null;
    this.overlay.showAllowed(pockets);
    this.overlay.setZone(level.cueZone || null);
    this.ui.setTrickPanel(level, 0);
    this.bih = null;
    this.phase = 'aim';
    this.resetAimForTurn();
    if (level.jump) this.ui.toast('Tip: raise the cue with the elevation slider (40°+)', 'info', 4);
    this.refreshActions();
  }

  rackIntro() {
    this.stage.balls.playRackIntro(this.sim);
    this.audio.rack();
  }

  nextLevel() {
    this.ui.hideDialogs();
    const next = LEVELS.find((l) => l.id === this.level.id + 1);
    if (next) this.startTrick(next.id);
    else {
      this.quitToMenu(false);
      this.ui.showLevels();
    }
  }

  restart() {
    this.ui.hideDialogs();
    this.paused = false;
    if (this.mode === 'match') this.startMatch(this.matchCfg.game, this.matchCfg.vsAI, this.matchCfg.difficulty);
    else if (this.mode === 'practice') this.startPractice();
    else if (this.mode === 'trick') this.startTrick(this.level.id);
  }

  pause() {
    if (this.mode === 'menu' || this.phase === 'over' || this.phase === 'levelEnd') return;
    this.paused = true;
    if (this.pulling) this.cancelPull();
    this.ui.showPause(true);
  }

  resume() {
    this.paused = false;
    this.ui.hideDialogs();
    this.ui.show(null);
    // hideDialogs() clears every dialog including a pending push-out decision;
    // restore it so the turn isn't stranded with no way to answer.
    if (this.mode === 'match' && this.phase === 'push' && this.engine) {
      const m = this.engine.match;
      const p = this.players[m.current];
      const pusher = this.players[m.pushBy];
      this.ui.showPush(true, `${pusher.name} pushed out. ${p.name}, do you want to shoot from here or pass it back?`);
    }
  }

  cycleCamera() {
    const m = this.stage.rig.cycleMode();
    this.ui.setCameraLabel(m);
    this.guideDirty = true;
  }

  setCamera(m) {
    this.stage.rig.setMode(m);
    this.ui.setCameraLabel(m);
  }

  // ------------------------------------------------------------------ actions bar
  refreshActions() {
    const acts = [];
    if (this.mode === 'practice') {
      acts.push({ label: 'Rack 8', onClick: () => this.practiceRackSet('8ball') });
      acts.push({ label: 'Rack 9', onClick: () => this.practiceRackSet('9ball') });
      acts.push({ label: 'Undo', onClick: () => this.undo() });
      acts.push({ label: this.moveBalls ? 'Moving balls ✓' : 'Move balls', on: this.moveBalls, onClick: () => this.toggleMove() });
      acts.push({ label: 'Cue in hand', onClick: () => this.practiceBIH() });
    } else if (this.mode === 'trick') {
      acts.push({ label: 'Reset', onClick: () => this.startTrick(this.level.id) });
      acts.push({ label: 'Hint', onClick: () => this.ui.toast(this.level.hint, 'info', 5) });
      acts.push({
        label: 'Levels',
        onClick: () => {
          this.quitToMenu(false);
          this.ui.showLevels();
        },
      });
    } else if (this.mode === 'match' && this.engine) {
      const m = this.engine.match;
      const human = !this.players[m.current].isAI;
      if (m.game === '9ball' && m.pushOutAvailable && human && this.phase === 'aim') {
        acts.push({ label: this.pushDeclared ? 'Push out: ON' : 'Push out', on: this.pushDeclared, onClick: () => this.togglePush() });
      }
      if (this.bih && human && this.phase === 'aim') acts.push({ label: 'Ball in hand: drag the cue ball', onClick: () => {} });
    }
    this.ui.setActions(acts);
  }

  togglePush() {
    if (this.mode !== 'match') return;
    const m = this.engine.match;
    if (!(m.game === '9ball' && m.pushOutAvailable)) return;
    this.pushDeclared = !this.pushDeclared;
    this.ui.toast(this.pushDeclared ? 'Push out declared - any legal-looking shot, no rail needed' : 'Push out cancelled');
    this.refreshActions();
    this.updateTurnMessage();
  }

  practiceRackSet(kind) {
    this.practiceRack = kind;
    this.startPractice();
  }

  toggleMove() {
    this.moveBalls = !this.moveBalls;
    if (this.moveBalls) this.stage.rig.setMode('top');
    else this.stage.rig.setMode('cue');
    this.ui.setCameraLabel(this.stage.rig.mode);
    this.ui.toast(this.moveBalls ? 'Drag any ball to place it' : 'Ball moving off');
    this.refreshActions();
  }

  practiceBIH() {
    this.bih = { kitchen: false };
    this.ensureCue(false);
    this.ui.toast('Cue ball in hand - drag it anywhere');
  }

  undo() {
    if (this.mode !== 'practice' || !this.undoStack.length || this.phase === 'roll') return;
    this.sim.setBalls(this.undoStack.pop());
    this.phase = 'aim';
    this.guideDirty = true;
    this.ui.toast('Shot undone');
  }

  // ------------------------------------------------------------------ turn flow
  cueBall() {
    return this.sim.ball(0);
  }

  ensureCue(kitchen) {
    const c = this.cueBall();
    if (c.state !== ON_TABLE) {
      const st = this.sim.balls.map((b) => ({ n: b.n, x: b.x, y: b.y, state: b.state }));
      const [x, y] = nearestValid(st, HEAD_SPOT[0], HEAD_SPOT[1], kitchen);
      c.state = ON_TABLE;
      c.x = x;
      c.y = y;
      c.z = 0;
      c.pocket = -1;
      c.vx = c.vy = c.vz = c.wx = c.wy = c.wz = 0;
      c.moving = false;
    }
  }

  beginTurn() {
    const m = this.engine.match;
    this.pushDeclared = false;
    this.calledPocket = null;
    this.callLocked = false;
    this.clock = this.store.settings.shotClock ? SHOT_CLOCK : null;
    if (m.winner !== null) return this.endMatch();
    this.updateHUD();
    const p = this.players[m.current];
    if (m.pushPending) {
      const pusher = this.players[m.pushBy];
      if (p.isAI) {
        this.phase = 'ai';
        this.ui.thinking(m.current, true);
        this.ui.turnMessage(`${p.name} is deciding&hellip;`);
        this.askAI('push', { layout: this.engine.layout(), match: m.toJSON() }).then((take) => {
          setTimeout(() => {
            if (this.mode !== 'match' || this.engine.match !== m) return;
            this.ui.thinking(m.current, false);
            m.resolvePush(take);
            this.ui.toast(take ? `${p.name} takes the shot` : `${p.name} passes it back to ${pusher.name}`, 'info');
            this.beginTurn();
          }, 900);
        });
      } else {
        this.phase = 'push';
        this.ui.turnMessage(`${p.name}: take the shot or pass?`);
        this.ui.showPush(true, `${pusher.name} pushed out. ${p.name}, do you want to shoot from here or pass it back?`);
      }
      return;
    }
    if (m.ballInHand || !this.engine.cueOnTable()) this.engine.ensureCue();
    this.bih = m.ballInHand ? { kitchen: m.kitchen } : null;
    if (p.isAI) {
      this.startAITurn();
    } else {
      this.phase = 'aim';
      this.resetAimForTurn();
      if (this.bih) this.ui.toast(m.isBreak ? 'Place the cue ball behind the head string and break!' : 'Ball in hand - drag the cue ball anywhere', 'info');
    }
    this.updateTurnMessage();
    this.refreshActions();
  }

  answerPush(take) {
    const m = this.engine.match;
    this.ui.showPush(false);
    m.resolvePush(take);
    this.beginTurn();
  }

  updateTurnMessage() {
    if (this.mode !== 'match') return;
    const m = this.engine.match;
    const p = this.players[m.current];
    const on = this.engine.onTableNums();
    let msg = p.isAI ? `${p.name}` : this.vsAI ? 'Your shot' : `${p.name} to shoot`;
    if (m.isBreak) msg += ' &middot; Break';
    else if (m.game === '9ball') msg += ` &middot; Hit the ${m.lowest(on)}-ball`;
    else if (m.openTable) msg += ' &middot; Open table';
    else if (m.needsCalledPocket(on)) {
      msg += this.calledPocket !== null ? ` &middot; 8 called: ${POCKET_NAMES[this.calledPocket]}` : ' &middot; On the 8 - click a pocket to call it';
    }
    if (this.bih && !p.isAI) msg += ' &middot; Ball in hand';
    if (this.pushDeclared) msg += ' &middot; PUSH OUT';
    if (m.game === '9ball' && m.consecutiveFouls[m.current] === 2) msg += ' &middot; <span style="color:#ff8a8a">2 fouls!</span>';
    this.ui.turnMessage(msg);
  }

  updateHUD() {
    if (this.mode !== 'match') return;
    const m = this.engine.match;
    this.ui.setPlayers(this.players, m.current, m.groups, m.potted, m.game, this.engine.onTableNums());
  }

  resetAimForTurn() {
    this.aim.spinX = 0;
    this.aim.spinY = 0;
    this.aim.elevationDeg = 0;
    this.ui.setSpin(0, 0);
    this.ui.setElevation(0);
    this.power = 0;
    this.pulling = false;
    this.ui.setPower(0);
    const cue = this.cueBall();
    if (!cue || cue.state !== ON_TABLE) return;
    // point at a sensible target
    let targets = this.sim.balls.filter((b) => b.n !== 0 && b.state === ON_TABLE);
    if (this.mode === 'match') {
      const legal = this.engine.match.legalTargets(this.engine.onTableNums());
      const lt = targets.filter((b) => legal.includes(b.n));
      if (lt.length) targets = lt;
    } else if (this.mode === 'trick') {
      const lt = targets.filter((b) => this.level.targets.includes(b.n));
      if (lt.length) targets = lt;
    }
    if (this.mode === 'match' && this.engine.match.isBreak) {
      const apex = targets.reduce((a, b) => (Math.hypot(b.x - FOOT_SPOT[0], b.y) < Math.hypot(a.x - FOOT_SPOT[0], a.y) ? b : a), targets[0]);
      targets = [apex];
    }
    let best = null;
    let bd = Infinity;
    for (const t of targets) {
      const d = Math.hypot(t.x - cue.x, t.y - cue.y);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    if (best) this.aim.angle = Math.atan2(best.y - cue.y, best.x - cue.x);
    this.guideDirty = true;
    this.stage.rig.speed = 3;
  }

  // ------------------------------------------------------------------ human aiming actions
  canShoot() {
    if (this.mode === 'menu' || this.paused || this.phase !== 'aim' || this.dragging) return false;
    if (this.mode === 'match' && this.players[this.engine.match.current].isAI) return false;
    const c = this.cueBall();
    return c && c.state === ON_TABLE;
  }

  rotateAim(d) {
    if (this.phase !== 'aim' || this.pulling) return;
    this.aim.angle += d;
    this.guideDirty = true;
  }

  fineAim(d) {
    this.rotateAim(d);
  }

  aimAt(pt) {
    if (this.phase !== 'aim' || this.pulling) return;
    const c = this.cueBall();
    if (!c || c.state !== ON_TABLE) return;
    const dx = pt[0] - c.x;
    const dy = pt[1] - c.y;
    if (Math.hypot(dx, dy) < R * 1.5) return;
    this.aim.angle = Math.atan2(dy, dx);
    this.guideDirty = true;
  }

  setSpin(x, y) {
    // Only adjustable while aiming (human) or during the AI's own aim animation;
    // ignore stray widget/key input during the roll or the opponent's turn.
    if (this.phase !== 'aim' && this.phase !== 'ai') return;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    this.aim.spinX = x;
    this.aim.spinY = y;
    this.ui.setSpin(x, y);
    this.guideDirty = true;
  }

  setElevation(deg) {
    if (this.phase !== 'aim' && this.phase !== 'ai') return;
    this.aim.elevationDeg = Math.max(0, Math.min(60, deg));
    this.ui.setElevation(this.aim.elevationDeg);
    this.guideDirty = true;
  }

  beginPull() {
    if (!this.canShoot()) return;
    this.pulling = true;
    this.power = 0;
    this.ui.setPower(0);
  }

  setPull(p) {
    if (!this.pulling) return;
    this.power = Math.max(0, Math.min(1, p));
    this.ui.setPower(this.power);
    this.guideDirty = true;
  }

  cancelPull() {
    this.pulling = false;
    this.power = 0;
    this.ui.setPower(0);
  }

  releasePull() {
    if (!this.pulling) return;
    this.pulling = false;
    if (this.power < 0.02) {
      this.power = 0;
      this.ui.setPower(0);
      return;
    }
    this.shoot(this.power);
  }

  currentShot(power) {
    return {
      angle: this.aim.angle,
      speed: powerToSpeed(power),
      spinX: this.aim.spinX,
      spinY: this.aim.spinY,
      elevation: this.aim.elevationDeg * DEG,
    };
  }

  shoot(power) {
    if (this.mode === 'match') {
      const m = this.engine.match;
      if (m.needsCalledPocket(this.engine.onTableNums())) {
        if (this.calledPocket === null) {
          this.ui.toast('Call a pocket for the 8-ball first: click a pocket', 'foul');
          this.power = 0;
          this.ui.setPower(0);
          return;
        }
        m.calledPocket = this.calledPocket;
      }
    }
    this.startStroke(this.currentShot(power), power);
  }

  onTableClick(pt) {
    if (this.mode !== 'match' || this.phase !== 'aim') return;
    const m = this.engine.match;
    if (!m.needsCalledPocket(this.engine.onTableNums())) return;
    let best = null;
    let bd = 0.22;
    for (const p of POCKETS) {
      const d = Math.hypot(pt[0] - p.x, pt[1] - p.y);
      if (d < bd) {
        bd = d;
        best = p.id;
      }
    }
    if (best !== null) {
      this.calledPocket = best;
      this.callLocked = true;
      this.audio.ui();
      this.ui.toast(`8-ball called: ${POCKET_NAMES[best]}`, 'good');
      this.updateTurnMessage();
    }
  }

  // ball in hand / practice placement
  tryStartDrag(pt) {
    if (this.phase !== 'aim' || this.paused) return false;
    if (this.mode === 'match' && this.players[this.engine.match.current].isAI) return false;
    const candidates = [];
    if (this.bih) candidates.push(this.cueBall());
    if (this.mode === 'practice' && this.moveBalls) candidates.push(...this.sim.balls.filter((b) => b.state === ON_TABLE));
    let best = null;
    let bd = R * 2.2;
    for (const b of candidates) {
      if (!b || b.state !== ON_TABLE) continue;
      const d = Math.hypot(pt[0] - b.x, pt[1] - b.y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (!best) return false;
    this.dragging = { ball: best, off: [best.x - pt[0], best.y - pt[1]] };
    return true;
  }

  dragTo(pt) {
    const d = this.dragging;
    if (!d) return;
    const x = pt[0] + d.off[0];
    const y = pt[1] + d.off[1];
    const kitchen = d.ball.n === 0 && this.bih && this.bih.kitchen;
    const st = this.sim.balls.map((b) => ({ n: b.n, x: b.x, y: b.y, state: b.state }));
    const ok = inPlayArea(x, y, kitchen) && isFree(st, x, y, d.ball.n);
    if (ok) {
      d.ball.x = x;
      d.ball.y = y;
      d.ghost = null;
    } else d.ghost = [x, y];
    d.valid = ok;
    this.guideDirty = true;
  }

  endDrag() {
    this.dragging = null;
    this.guideDirty = true;
  }

  // ------------------------------------------------------------------ shooting
  startStroke(shot, power) {
    this.phase = 'stroke';
    this.stroke = { t: 0, dur: 0.16 - power * 0.08, pull0: 0.03 + power * 0.26, shot, power, struck: false };
    this.stage.guide.update(null);
    this.overlay.setBallInHand(false);
  }

  executeShot(shot, power) {
    this.preShot = this.sim.snapshot();
    if (this.mode === 'practice') {
      this.undoStack.push(this.preShot);
      if (this.undoStack.length > 30) this.undoStack.shift();
    }
    if (this.mode === 'match') this.engine.startShot(shot, { pushOut: this.pushDeclared });
    else {
      this.sim.events = [];
      this.sim.time = 0;
      this.sim.strike(0, shot);
    }
    this.evIdx = 0;
    this.audio.cueStrike(power);
    this.lastPower = power;
    this.phase = 'roll';
    this.settle = 0;
    this.rollTime = 0;
    this.physAcc = 0;
    this.bih = null;
    this.ui.setPower(0);
    this.ui.setClock(null);
    this.refreshActions();
  }

  processEvents() {
    const ev = this.sim.events;
    for (; this.evIdx < ev.length; this.evIdx++) {
      const e = ev[this.evIdx];
      if (e.type === 'hit') this.audio.ballClick(e.speed);
      else if (e.type === 'cushion') this.audio.cushion(e.speed);
      else if (e.type === 'pocket') {
        this.audio.pocket(e.speed);
        if (this.mode === 'match') this.updateHUDSoon = true;
      } else if (e.type === 'rattle') this.audio.rattle();
      else if (e.type === 'land') this.audio.cushion(e.speed * 0.6);
    }
  }

  onShotComplete() {
    this.audio.roll(0);
    if (this.mode === 'match') this.matchShotDone();
    else if (this.mode === 'practice') this.practiceShotDone();
    else if (this.mode === 'trick') this.trickShotDone();
  }

  matchShotDone() {
    const { res, out } = this.engine.finishShot();
    const m = this.engine.match;
    const shooter = this.players[out.player];
    if (out.foul) {
      this.ui.toast(out.reason, 'foul', 3);
      this.audio.foul();
    }
    for (const msg of out.messages) this.ui.toast(msg, 'info', 3);
    if (out.assigned) this.ui.toast(`${shooter.name}: ${out.assigned}`, 'good', 3);
    if (out.pushOut && !out.foul) this.ui.toast(`${shooter.name} pushed out`, 'info');
    // celebrations
    if (!out.foul && out.winner === null) {
      const legal = out.legalPots;
      if (out.wasBreak && legal.length >= 2) this.celebrate('Monster Break!', `${legal.length} balls down`);
      else if (!out.wasBreak && legal.some((n) => res.banked.has(n))) this.celebrate('Bank Shot!', shooter.name);
      else if (!out.wasBreak && legal.some((n) => n !== res.firstHit)) this.celebrate('Combo!', shooter.name);
      else if (!out.wasBreak && legal.length >= 2) this.celebrate('Double!', `${legal.length} in one shot`);
    }
    this.updateHUD();
    if (m.winner !== null) return this.endMatch(res, out);
    this.beginTurn();
  }

  celebrate(big, small, confetti = false) {
    this.ui.banner(big, small, confetti);
    this.audio.celebrate(confetti);
  }

  endMatch() {
    const m = this.engine.match;
    const w = m.winner;
    this.phase = 'over';
    this.overlay.showPockets(false);
    this.stage.guide.update(null);
    const breakAndRun = w === m.breaker && m.turns === 0;
    const winsBefore = this.store.data.stats.wins;
    this.store.recordGame({
      mode: `${m.game === '8ball' ? '8-Ball' : '9-Ball'} ${this.vsAI ? 'vs ' + DIFF_NAMES[this.difficulty] : '2P'}`,
      won: this.vsAI ? w === 0 : false,
      vsAI: this.vsAI,
      stats: this.vsAI ? m.stats[0] : null,
      breakAndRun: breakAndRun && (!this.vsAI || w === 0),
    });
    const humanWon = !this.vsAI || w === 0;
    const name = this.players[w].name;
    if (breakAndRun) this.celebrate('Break and Run!', `${name} cleared the table`, true);
    else if (humanWon) this.celebrate(this.vsAI ? 'You Win!' : `${name} Wins!`, m.winReason, true);
    else {
      this.ui.banner(`${name} Wins`, m.winReason);
      this.audio.foul();
    }
    const newly = VENUES.filter((v) => v.unlock > winsBefore && v.unlock <= this.store.data.stats.wins);
    let extra = '';
    if (newly.length) {
      extra = `New venue unlocked: ${newly.map((v) => v.name).join(', ')}!`;
      setTimeout(() => this.ui.toast(extra, 'good', 4), 1200);
    }
    setTimeout(() => {
      if (this.mode !== 'match' || this.phase !== 'over') return;
      this.ui.showGameOver({
        title: this.vsAI ? (w === 0 ? 'Victory!' : 'Defeat') : `${name} Wins!`,
        sub: m.winReason,
        players: this.players,
        stats: m.stats,
        extra,
      });
    }, 2600);
  }

  practiceShotDone() {
    const res = analyzeShot(this.sim.events);
    const pots = res.pocketedNums.filter((n) => n !== 0);
    if (res.cueScratch) {
      this.ui.toast('Scratch - cue ball in hand', 'foul');
      this.audio.foul();
      this.ensureCue(false);
      this.bih = { kitchen: false };
    } else if (pots.length >= 2) this.celebrate('Double!', pots.join(' + '));
    else if (pots.length && res.banked.has(pots[0])) this.celebrate('Bank Shot!', '');
    const left = this.sim.balls.filter((b) => b.n !== 0 && b.state === ON_TABLE).length;
    if (!left) {
      this.celebrate('Table Cleared!', 'Re-racking', true);
      setTimeout(() => this.mode === 'practice' && this.startPractice(), 2500);
    }
    this.phase = 'aim';
    this.guideDirty = true;
    this.refreshActions();
  }

  trickShotDone() {
    const L = this.level;
    this.shotsUsed++;
    const res = analyzeShot(this.sim.events);
    const cue = this.cueBall();
    const r = evaluateLevelShot(L, res, this.trickPotted, cue.state === ON_TABLE ? cue : null);
    this.ui.setTrickPanel(L, this.shotsUsed);
    const resetLayout = () => {
      this.sim.setBalls(L.balls);
      this.trickPotted = new Set();
      this.rackIntro();
    };
    if (r.status === 'success') {
      const stars = starsFor(L, this.shotsUsed);
      this.store.recordTrick(L.id, stars, this.shotsUsed);
      this.phase = 'levelEnd';
      const bank = res.pocketedNums.some((n) => res.banked.has(n));
      this.celebrate(stars === 3 ? 'Perfect!' : bank ? 'Bank Shot!' : 'Nailed It!', `${'★'.repeat(stars)}`, true);
      setTimeout(() => {
        if (this.mode === 'trick' && this.phase === 'levelEnd') this.ui.showLevelEnd(true, stars, `Completed in ${this.shotsUsed} shot${this.shotsUsed > 1 ? 's' : ''}.`, L.id < LEVELS.length);
      }, 1800);
      return;
    }
    if (this.shotsUsed >= L.max) {
      this.phase = 'levelEnd';
      this.audio.foul();
      this.ui.toast(r.message, r.status === 'fail' ? 'foul' : 'info');
      setTimeout(() => this.mode === 'trick' && this.ui.showLevelEnd(false, 0, `You used all ${L.max} shots. Give it another go!`, false), 1200);
      return;
    }
    if (r.status === 'fail') {
      this.ui.toast(r.message, 'foul', 2.6);
      this.audio.foul();
      this.phase = 'resetWait';
      setTimeout(() => {
        if (this.mode !== 'trick' || this.level !== L) return;
        resetLayout();
        this.phase = 'aim';
        this.resetAimForTurn();
      }, 1100);
      return;
    }
    if (r.status === 'miss') {
      if (L.resetOnMiss) {
        this.ui.toast('Missed - try again', 'info');
        this.phase = 'resetWait';
        setTimeout(() => {
          if (this.mode !== 'trick' || this.level !== L) return;
          resetLayout();
          this.phase = 'aim';
          this.resetAimForTurn();
        }, 900);
        return;
      }
      this.ui.toast('No pot', 'info', 1.5);
    } else {
      r.targetsNow.forEach((n) => this.trickPotted.add(n));
      const left = L.targets.filter((n) => !this.trickPotted.has(n)).length;
      this.ui.toast(`Nice pot! ${left} to go`, 'good', 1.6);
    }
    this.phase = 'aim';
    this.guideDirty = true;
  }

  // ------------------------------------------------------------------ AI
  startAITurn() {
    const m = this.engine.match;
    const idx = m.current;
    const p = this.players[idx];
    this.phase = 'ai';
    this.ui.thinking(idx, true);
    const token = {};
    this.aiTask = { token, stage: 'think', t: 0, plan: null, minThink: 0.8 + Math.random() * 0.7 };
    const input = { layout: this.engine.layout(), match: m.toJSON(), difficulty: p.difficulty, seed: (Math.random() * 1e9) | 0 };
    this.askAI('plan', input).then((plan) => {
      if (this.aiTask && this.aiTask.token === token) this.aiTask.plan = plan;
    });
    this.aim.spinX = this.aim.spinY = 0;
    this.aim.elevationDeg = 0;
  }

  updateAI(dt) {
    const T = this.aiTask;
    if (!T) return;
    T.t += dt;
    const m = this.engine.match;
    const cue = this.cueBall();
    if (T.stage === 'think') {
      // idle look-around while thinking
      if (T.t > T.minThink && T.plan) {
        this.ui.thinking(m.current, false);
        const plan = T.plan;
        if (plan.cuePos) {
          // clamp to a legal spot so the AI can never place an overlapping cue
          plan.cuePos = this.engine.clampCuePlacement(plan.cuePos[0], plan.cuePos[1]);
          T.stage = 'place';
          T.t = 0;
          T.from = [cue.x, cue.y];
          this.overlay.setBallInHand(true, cue.x, cue.y, true, m.kitchen);
        } else this.aiBeginAim(T);
      }
    } else if (T.stage === 'place') {
      const k = Math.min(1, T.t / 0.7);
      const e = k * k * (3 - 2 * k);
      const to = T.plan.cuePos;
      cue.x = T.from[0] + (to[0] - T.from[0]) * e;
      cue.y = T.from[1] + (to[1] - T.from[1]) * e;
      this.overlay.setBallInHand(true, cue.x, cue.y, true, m.kitchen);
      if (k >= 1) {
        this.engine.placeCue(to[0], to[1]);
        this.overlay.setBallInHand(false);
        this.aiBeginAim(T);
      }
    } else if (T.stage === 'aim') {
      const k = Math.min(1, T.t / T.dur);
      const e = k * k * (3 - 2 * k);
      this.aim.angle = T.a0 + T.da * e;
      this.setSpin(T.plan.shot.spinX * e, T.plan.shot.spinY * e);
      this.setElevation(((T.plan.shot.elevation || 0) / DEG) * e);
      if (k >= 1) {
        T.stage = 'pull';
        T.t = 0;
      }
    } else if (T.stage === 'pull') {
      const target = speedToPower(T.plan.shot.speed);
      const k = Math.min(1, T.t / 0.6);
      this.power = target * k;
      this.ui.setPower(this.power);
      if (T.t > 0.85) {
        const shot = T.plan.shot;
        this.aim.angle = shot.angle;
        this.aiTask = null;
        this.startStroke(shot, target);
      }
    }
  }

  aiBeginAim(T) {
    const m = this.engine.match;
    T.stage = 'aim';
    T.t = 0;
    T.a0 = this.aim.angle;
    T.da = angDiff(this.aim.angle, T.plan.shot.angle);
    T.dur = 0.5 + Math.min(1, Math.abs(T.da) / Math.PI) * 0.7;
    if (m.needsCalledPocket(this.engine.onTableNums())) {
      m.calledPocket = T.plan.calledPocket;
      this.calledPocket = T.plan.calledPocket;
      this.updateTurnMessage();
    }
    if (T.plan.kind === 'safety') this.ui.turnMessage(`${this.players[m.current].name} &middot; playing safe`);
  }

  // ------------------------------------------------------------------ guide
  guideMode() {
    const s = this.store.settings.guide;
    if (s !== 'auto') return s;
    if (this.mode === 'match' && this.vsAI) return { easy: 'full', medium: 'medium', hard: 'short', pro: 'off' }[this.difficulty];
    return 'full';
  }

  updateGuide() {
    if (!this.guideDirty) return;
    this.guideDirty = false;
    const show = this.phase === 'aim' && (this.mode !== 'match' || !this.players[this.engine.match.current].isAI);
    const gm = this.guideMode();
    const needsCall = this.mode === 'match' && this.engine.match.needsCalledPocket(this.engine.onTableNums());
    if (!show || (gm === 'off' && !needsCall)) {
      this.stage.guide.update(null);
      this.pred = null;
      return;
    }
    const power = this.pulling && this.power > 0.02 ? this.power : this.lastPower;
    const opts = GUIDE_OPTS[gm] || GUIDE_OPTS.short;
    const pred = predictShot(this.sim.snapshot().map((b) => ({ ...b })), this.currentShot(power), opts);
    this.pred = pred;
    if (gm === 'off') this.stage.guide.update(null);
    else this.stage.guide.update(pred);
    if (needsCall && !this.callLocked && gm !== 'off') {
      const pc = pred && pred.firstObj === 8 && pred.objPocket !== null ? pred.objPocket : null;
      if (pc !== this.calledPocket) {
        this.calledPocket = pc;
        this.updateTurnMessage();
      }
    }
  }

  // ------------------------------------------------------------------ main loop
  loop(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    try {
      this.update(dt);
      this.stage.render();
      this.trackFps(dt);
    } catch (err) {
      // A throw here (e.g. WebGL context loss) must not kill the loop: always
      // reschedule so the game can recover on the next frame.
      console.error(err);
    } finally {
      requestAnimationFrame((tt) => this.loop(tt));
    }
  }

  trackFps(dt) {
    if (this.store.settings.quality !== 'auto' || this.mode === 'menu') return;
    const f = this.fps;
    f.t += dt;
    f.frames++;
    if (f.t > 4) {
      const fps = f.frames / f.t;
      f.t = 0;
      f.frames = 0;
      if (fps < 38) {
        const order = ['high', 'medium', 'low'];
        const i = order.indexOf(this.stage.quality);
        if (i < 2) {
          this.autoQuality = order[i + 1];
          this.stage.setQuality(this.autoQuality);
          this.ui.toast(`Graphics set to ${this.autoQuality} for smoother play`, 'info');
        }
      }
    }
  }

  update(dt) {
    const stage = this.stage;
    if (!this.paused) {
      this.input.update(dt);
      if (this.mode !== 'menu') this.updateGame(dt);
    }
    stage.update(dt);
    this.overlay.update(dt);
    // balls
    stage.balls.sync(this.sim, this.paused ? 0 : dt);
    // cue stick
    this.updateCue(dt);
    // camera
    const cue = this.cueBall();
    const cuePos = cue && cue.state === ON_TABLE ? new THREE.Vector3(cue.x, SLATE_Y + R + cue.z, -cue.y) : null;
    let centroid = null;
    let spread = 0;
    if (this.phase === 'roll') {
      const mv = this.sim.balls.filter((b) => b.state !== ON_TABLE ? false : b.moving);
      if (mv.length) {
        centroid = new THREE.Vector3();
        for (const b of mv) centroid.add(new THREE.Vector3(b.x, SLATE_Y, -b.y));
        centroid.multiplyScalar(1 / mv.length);
        for (const b of mv) spread = Math.max(spread, Math.hypot(b.x - centroid.x, -b.y - centroid.z));
        spread = Math.min(1.2, spread);
        this.lastCentroid = centroid;
        this.lastSpread = spread;
      } else {
        centroid = this.lastCentroid || null;
        spread = this.lastSpread || 0;
      }
    }
    const phase = this.dragging ? 'place' : this.phase;
    if (!this.dragging) stage.rig.update(dt, { phase, cue: cuePos, aim: this.aim.angle, centroid, spread });
  }

  updateGame(dt) {
    if (this.phase === 'aim') {
      this.updateGuide();
      // ball in hand indicator
      const c = this.cueBall();
      if (this.bih && c.state === ON_TABLE) {
        const d = this.dragging;
        this.overlay.setBallInHand(true, c.x, c.y, !d || d.valid !== false, this.bih.kitchen, d && d.ghost ? d.ghost : null);
      } else if (this.dragging) {
        const d = this.dragging;
        this.overlay.setBallInHand(true, d.ball.x, d.ball.y, d.valid !== false, false, d.ghost);
      } else this.overlay.setBallInHand(false);
      // pocket call markers
      if (this.mode === 'match') {
        const needs = this.engine.match.needsCalledPocket(this.engine.onTableNums());
        this.overlay.showPockets(needs, this.calledPocket);
      }
      // shot clock
      if (this.clock !== null && this.clock !== undefined && this.mode === 'match' && !this.players[this.engine.match.current].isAI) {
        this.clock -= dt;
        this.ui.setClock(Math.max(0, this.clock));
        if (this.clock <= 0) {
          this.clock = null;
          this.ui.setClock(null);
          this.ui.toast('Shot clock expired - foul!', 'foul');
          this.audio.foul();
          this.cancelPull();
          this.engine.match.timeFoul();
          this.updateHUD();
          if (this.engine.match.winner !== null) this.endMatch();
          else this.beginTurn();
        }
      }
    } else if (this.phase === 'ai') {
      this.updateAI(dt);
      if (this.mode === 'match') {
        const needs = this.engine.match.needsCalledPocket(this.engine.onTableNums());
        this.overlay.showPockets(needs && this.calledPocket !== null, this.calledPocket);
      }
    } else if (this.phase === 'stroke') {
      const S = this.stroke;
      S.t += dt;
      if (!S.struck && S.t >= S.dur) {
        S.struck = true;
        this.executeShot(S.shot, S.power);
        this.cueAnim.follow = 0;
      }
    } else if (this.phase === 'roll') {
      const speed = this.input.fast ? 3 : 1;
      this.physAcc += dt * speed;
      let n = 0;
      while (this.physAcc >= DT && n < 60 * speed) {
        this.sim.step();
        this.physAcc -= DT;
        n++;
      }
      if (n >= 60 * speed) this.physAcc = 0;
      this.processEvents();
      if (this.updateHUDSoon) {
        this.updateHUDSoon = false;
        this.updateHUD();
      }
      let rolling = 0;
      for (const b of this.sim.balls) if (b.state === ON_TABLE && b.moving && b.z <= 0) rolling += Math.hypot(b.vx, b.vy);
      this.audio.roll(rolling);
      this.rollTime += dt;
      if (!this.sim.isMoving()) {
        this.settle += dt;
        if (this.settle > 0.35) {
          this.phase = 'done';
          this.onShotComplete();
        }
      }
    }
  }

  updateCue(dt) {
    const cue = this.stage.cue;
    const c = this.cueBall();
    if (this.mode === 'menu' || !c || c.state !== ON_TABLE) {
      cue.show(false);
      return;
    }
    const ballPos = new THREE.Vector3(c.x, SLATE_Y + R + c.z, -c.y);
    const el = this.aim.elevationDeg * DEG;
    if (this.phase === 'aim' || this.phase === 'ai') {
      const showCue = !(this.phase === 'ai' && this.aiTask && (this.aiTask.stage === 'think' || this.aiTask.stage === 'place'));
      cue.show(showCue && !this.dragging);
      const idle = 0.035 + Math.sin(performance.now() / 600) * 0.004;
      const pull = this.pulling || (this.phase === 'ai' && this.power > 0) ? 0.03 + this.power * 0.26 : idle;
      this.cueAnim.pull += (pull - this.cueAnim.pull) * Math.min(1, dt * 25);
      cue.setPose(ballPos, this.aim.angle, el, this.aim.spinX, this.aim.spinY, this.cueAnim.pull);
    } else if (this.phase === 'stroke') {
      const S = this.stroke;
      const k = Math.min(1, S.t / S.dur);
      const pull = S.pull0 * (1 - k * k);
      cue.show(true);
      cue.setPose(ballPos, this.aim.angle, el, this.aim.spinX, this.aim.spinY, pull);
    } else if (this.phase === 'roll' && this.rollTime < 0.45 && this.stroke) {
      // follow through then fade away
      const ft = Math.min(0.05, this.rollTime * 0.5);
      const sp = this.preShot ? this.preShot.find((b) => b.n === 0) : null;
      const origin = sp ? new THREE.Vector3(sp.x, SLATE_Y + R, -sp.y) : ballPos;
      cue.show(true);
      cue.setMarkerVisible(false);
      cue.setPose(origin, this.aim.angle, el, this.aim.spinX, this.aim.spinY, -ft);
    } else cue.show(false);
  }
}
