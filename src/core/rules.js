// Game rules for 8-ball and 9-ball (pure logic, serialisable state).
import { isSolid, isStripe, POCKET_NAMES } from './constants.js';

// Summarise the physics events of one shot.
export function analyzeShot(events) {
  let firstHit = null;
  let firstHitT = Infinity;
  let firstHitIdx = -1;
  const pocketed = [];
  const railBalls = new Set();
  let cushionAfterContact = false;
  let cueCushionsBeforeHit = 0;
  const lastBallContact = new Map(); // ball -> event index of last ball contact
  const banked = new Set();
  const cushionedAfterContact = new Map();
  const touched = new Set(); // balls touched by the cue ball
  const anyContact = new Set();
  events.forEach((e, i) => {
    if (e.type === 'hit') {
      if (firstHit === null && (e.a === 0 || e.b === 0)) {
        firstHit = e.a === 0 ? e.b : e.a;
        firstHitT = e.t;
        firstHitIdx = i;
      }
      if (e.a === 0) touched.add(e.b);
      if (e.b === 0) touched.add(e.a);
      anyContact.add(e.a);
      anyContact.add(e.b);
      lastBallContact.set(e.a, i);
      lastBallContact.set(e.b, i);
      cushionedAfterContact.set(e.a, false);
      cushionedAfterContact.set(e.b, false);
    } else if (e.type === 'cushion') {
      if (e.a !== 0) railBalls.add(e.a);
      if (firstHitIdx >= 0) cushionAfterContact = true;
      else if (e.a === 0) cueCushionsBeforeHit++;
      if (lastBallContact.has(e.a)) cushionedAfterContact.set(e.a, true);
    } else if (e.type === 'pocket') {
      pocketed.push({ n: e.a, pocket: e.pocket });
      if (e.a !== 0 && cushionedAfterContact.get(e.a)) banked.add(e.a);
    }
  });
  const pocketedNums = pocketed.map((p) => p.n);
  return {
    firstHit,
    firstHitT,
    pocketed,
    pocketedNums,
    cueScratch: pocketedNums.includes(0),
    cushionAfterContact,
    railBalls,
    cueCushionsBeforeHit,
    banked,
    touched,
    anyContact,
  };
}

const groupOf = (n) => (isSolid(n) ? 'solids' : isStripe(n) ? 'stripes' : null);

export function newStats() {
  return { shots: 0, potShots: 0, pots: 0, fouls: 0, run: 0, longestRun: 0, safeties: 0 };
}

export class Match {
  constructor(game = '8ball', players = [{ name: 'Player 1' }, { name: 'Player 2' }]) {
    this.game = game;
    this.players = players;
    this.current = 0;
    this.breaker = 0;
    this.groups = [null, null];
    this.isBreak = true;
    this.openTable = true;
    this.ballInHand = true;
    this.kitchen = true;
    this.pushOutAvailable = false;
    this.pushPending = false; // opponent must choose to take or pass after a push-out
    this.pushBy = -1;
    this.consecutiveFouls = [0, 0];
    this.winner = null;
    this.winReason = '';
    this.calledPocket = null;
    this.turns = 0; // number of turn changes
    this.stats = [newStats(), newStats()];
    this.potted = [[], []]; // balls potted per player (for the HUD)
    this.shotNumber = 0;
  }

  toJSON() {
    return { ...this, players: this.players.map((p) => ({ ...p })), stats: this.stats.map((s) => ({ ...s })) };
  }
  static fromJSON(o) {
    const m = new Match(o.game, o.players);
    Object.assign(m, JSON.parse(JSON.stringify(o)));
    return m;
  }
  clone() {
    return Match.fromJSON(this.toJSON());
  }

  opponent(p = this.current) {
    return 1 - p;
  }

  // balls: list of {n, state} currently on the table (state 0 = on table)
  onEight(p, onTable) {
    const g = this.groups[p];
    if (!g) return false;
    return !onTable.some((n) => groupOf(n) === g);
  }

  lowest(onTable) {
    let m = Infinity;
    for (const n of onTable) if (n > 0 && n < m) m = n;
    return m === Infinity ? null : m;
  }

  // Balls the current player may legally hit first.
  legalTargets(onTable, p = this.current) {
    const objs = onTable.filter((n) => n !== 0);
    if (this.game === '9ball') {
      const l = this.lowest(onTable);
      return l === null ? [] : [l];
    }
    if (this.isBreak) return objs;
    if (this.openTable) return objs.filter((n) => n !== 8);
    if (this.onEight(p, onTable)) return objs.filter((n) => n === 8);
    return objs.filter((n) => groupOf(n) === this.groups[p]);
  }

  needsCalledPocket(onTable) {
    return this.game === '8ball' && !this.isBreak && !this.openTable && this.onEight(this.current, onTable);
  }

  // Apply the result of a shot. onTableBefore: numbers on the table before the shot.
  // Returns an outcome describing what happened.
  applyShot(shot, onTableBefore, opts = {}) {
    const p = this.current;
    const o = this.opponent(p);
    const st = this.stats[p];
    const out = {
      player: p,
      foul: false,
      reason: '',
      messages: [],
      respot: [],
      continueTurn: false,
      winner: null,
      ballInHand: false,
      assigned: null,
      pushOut: false,
      legalPots: [],
      wasBreak: this.isBreak,
    };
    this.shotNumber++;
    st.shots++;
    const objPotted = shot.pocketedNums.filter((n) => n !== 0);
    const res = this.game === '8ball' ? this._apply8(shot, onTableBefore, out, objPotted) : this._apply9(shot, onTableBefore, out, objPotted, opts);

    // bookkeeping
    if (out.foul) {
      st.fouls++;
      this.consecutiveFouls[p]++;
    } else {
      this.consecutiveFouls[p] = 0;
    }
    const counted = out.foul ? [] : objPotted.filter((n) => !out.respot.includes(n));
    out.legalPots = counted;
    if (counted.length) {
      st.potShots++;
      st.pots += counted.length;
      st.run += counted.length;
      st.longestRun = Math.max(st.longestRun, st.run);
    }
    for (const n of objPotted) {
      if (out.respot.includes(n)) continue;
      // attribute potted balls to the owner of the group (8-ball) or shooter (9-ball)
      let owner = p;
      if (this.game === '8ball') {
        const g = groupOf(n);
        if (g && this.groups[0] === g) owner = 0;
        else if (g && this.groups[1] === g) owner = 1;
      }
      this.potted[owner].push(n);
    }
    if (out.winner !== null) {
      this.winner = out.winner;
      this.winReason = out.reason || out.messages[out.messages.length - 1] || '';
      return out;
    }
    if (out.continueTurn) {
      // same player again
    } else {
      st.run = 0;
      this.current = o;
      this.turns++;
    }
    this.ballInHand = out.foul;
    out.ballInHand = out.foul;
    this.kitchen = false;
    this.calledPocket = null;
    void res;
    return out;
  }

  _foul(out, reason) {
    if (!out.foul) {
      out.foul = true;
      out.reason = reason;
    }
  }

  _apply8(shot, before, out, objPotted) {
    const p = this.current;
    const o = this.opponent(p);
    const wasBreak = this.isBreak;
    const onEight = !wasBreak && !this.openTable && this.onEight(p, before);
    const legal = this.legalTargets(before, p);
    const eightPotted = objPotted.includes(8);
    const eightPocket = shot.pocketed.find((x) => x.n === 8)?.pocket;

    if (shot.cueScratch) this._foul(out, 'Scratch! Cue ball pocketed');
    if (shot.firstHit === null) this._foul(out, 'Foul: no ball hit');
    else if (!wasBreak && !legal.includes(shot.firstHit)) {
      this._foul(out, shot.firstHit === 8 ? 'Foul: hit the 8-ball first' : `Foul: wrong ball first (${shot.firstHit})`);
    }
    if (!out.foul && !wasBreak && objPotted.length === 0 && !shot.cushionAfterContact) this._foul(out, 'Foul: no rail after contact');
    if (wasBreak) {
      const legalBreak = objPotted.length > 0 || shot.railBalls.size >= 4;
      if (!legalBreak && !out.foul) this._foul(out, 'Illegal break: fewer than 4 balls reached a rail');
    }

    if (eightPotted) {
      if (wasBreak) {
        out.respot.push(8);
        out.messages.push('8-ball on the break - re-spotted');
      } else if (!onEight) {
        out.winner = o;
        out.reason = `${this.players[p].name} pocketed the 8-ball early`;
        return;
      } else if (out.foul) {
        out.winner = o;
        out.reason = `${this.players[p].name} fouled on the 8-ball (${out.reason})`;
        return;
      } else if (this.calledPocket === null || this.calledPocket === undefined) {
        // On the 8 you must call a pocket; potting it uncalled is a loss.
        out.winner = o;
        out.reason = `${this.players[p].name} pocketed the 8-ball without calling a pocket`;
        return;
      } else if (eightPocket !== this.calledPocket) {
        out.winner = o;
        out.reason = `8-ball went in the ${POCKET_NAMES[eightPocket]}, not the called pocket`;
        return;
      } else {
        out.winner = p;
        out.reason = `${this.players[p].name} pocketed the 8-ball`;
        return;
      }
    }

    this.isBreak = false;
    const nonEight = objPotted.filter((n) => n !== 8);
    if (wasBreak) {
      out.continueTurn = !out.foul && nonEight.length > 0;
      if (out.foul && !out.reason.startsWith('Illegal')) out.messages.push(out.reason);
      return;
    }
    if (this.openTable && !out.foul && nonEight.length > 0) {
      const hasSolid = nonEight.some((n) => groupOf(n) === 'solids');
      const hasStripe = nonEight.some((n) => groupOf(n) === 'stripes');
      // Only assign a group when exactly one group was pocketed; if the shooter
      // legally pots both a solid and a stripe the table stays open.
      if (hasSolid !== hasStripe) {
        const g = hasSolid ? 'solids' : 'stripes';
        this.groups[p] = g;
        this.groups[o] = g === 'solids' ? 'stripes' : 'solids';
        this.openTable = false;
        out.assigned = g;
        out.messages.push(`${this.players[p].name} is ${g}`);
      }
    }
    if (!out.foul) {
      const mine = this.groups[p];
      out.continueTurn = mine ? nonEight.some((n) => groupOf(n) === mine) : false;
    }
  }

  _apply9(shot, before, out, objPotted, opts) {
    const p = this.current;
    const o = this.opponent(p);
    const wasBreak = this.isBreak;
    const pushOut = !!opts.pushOut && this.pushOutAvailable;
    const lowest = this.lowest(before);
    const ninePotted = objPotted.includes(9);

    if (shot.cueScratch) this._foul(out, 'Scratch! Cue ball pocketed');
    if (!pushOut) {
      if (shot.firstHit === null) this._foul(out, 'Foul: no ball hit');
      else if (shot.firstHit !== lowest) this._foul(out, `Foul: must hit the ${lowest}-ball first`);
      if (!out.foul && !wasBreak && objPotted.length === 0 && !shot.cushionAfterContact) this._foul(out, 'Foul: no rail after contact');
      if (wasBreak && !out.foul) {
        const legalBreak = objPotted.length > 0 || shot.railBalls.size >= 4;
        if (!legalBreak) this._foul(out, 'Illegal break: fewer than 4 balls reached a rail');
      }
    }
    this.isBreak = false;

    if (ninePotted) {
      if (out.foul || pushOut) {
        out.respot.push(9);
        out.messages.push('9-ball re-spotted');
      } else {
        out.winner = p;
        out.reason = wasBreak ? `${this.players[p].name} made the 9 on the break!` : `${this.players[p].name} pocketed the 9-ball`;
        return;
      }
    }
    // three consecutive fouls
    if (out.foul && this.consecutiveFouls[p] + 1 >= 3) {
      out.winner = o;
      out.reason = `${this.players[p].name} committed three consecutive fouls`;
      return;
    }
    if (out.foul && this.consecutiveFouls[p] + 1 === 2) out.messages.push(`${this.players[p].name} is on two fouls!`);

    if (pushOut) {
      out.pushOut = true;
      this.pushOutAvailable = false;
      if (!out.foul) {
        this.pushPending = true;
        this.pushBy = p;
      }
      out.continueTurn = false;
      return;
    }
    if (wasBreak && !out.foul) {
      // the next shot may be a push-out (only after a legal break)
      this.pushOutAvailable = true;
    } else {
      this.pushOutAvailable = false;
    }
    out.continueTurn = !out.foul && objPotted.filter((n) => !out.respot.includes(n)).length > 0;
  }

  // after a push-out the incoming player decides: take = shoot now, else hand it back
  resolvePush(take) {
    if (!this.pushPending) return;
    this.pushPending = false;
    if (!take) {
      this.current = this.pushBy;
      this.turns++;
    }
    this.ballInHand = false;
  }

  // Shot clock expiry is treated as a standard foul.
  timeFoul() {
    const p = this.current;
    this.stats[p].fouls++;
    this.consecutiveFouls[p]++;
    this.stats[p].run = 0;
    if (this.game === '9ball' && this.consecutiveFouls[p] >= 3) {
      this.winner = this.opponent(p);
      this.winReason = `${this.players[p].name} committed three consecutive fouls`;
      return;
    }
    this.current = this.opponent(p);
    this.turns++;
    this.ballInHand = true;
    this.kitchen = false;
    this.pushOutAvailable = false;
  }
}

export { groupOf };
