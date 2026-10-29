// DOM user interface: menus, HUD, dialogs and touch widgets.
import { VENUES } from '../render/venues.js';
import { LEVELS } from '../core/levels.js';
import { ballIcon } from '../render/textures.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const DIFFS = [
  { id: 'easy', name: 'Easy', desc: 'Relaxed opponent who misses often. Full aiming guide.' },
  { id: 'medium', name: 'Medium', desc: 'Solid club player. Medium aiming guide.' },
  { id: 'hard', name: 'Hard', desc: 'Rarely misses and plays position. Short guide.' },
  { id: 'pro', name: 'Pro', desc: 'Near-perfect cueing and safeties. No aiming guide.' },
];

function starsHtml(n) {
  return `<span class="stars">${[1, 2, 3].map((i) => `<span class="${i <= n ? 'on' : ''}">&#9733;</span>`).join('')}</span>`;
}

export class UI {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.sel = { game: '8ball', vsAI: true, difficulty: 'medium', practice: false };
    root.innerHTML = this.template();
    this.bind();
    this.confetti = new Confetti($('#confetti', root));
  }

  template() {
    return `
    <div class="screen" id="scr-main"><div class="panel">
      <div class="title"><div class="logo">Cue Club<small>3D BILLIARDS</small></div></div>
      <div class="menu-list">
        <button class="btn primary" data-go="vsai">Play vs Computer <span class="hint">8-Ball &middot; 9-Ball</span></button>
        <button class="btn" data-go="hotseat">Two Players <span class="hint">hot seat</span></button>
        <button class="btn" data-go="trick">Trick Shot Challenge <span class="hint" id="trick-progress"></span></button>
        <button class="btn" data-go="practice">Practice <span class="hint">free table</span></button>
        <div class="row" style="margin-top:4px">
          <button class="btn small ghost" data-go="venues">Venues</button>
          <button class="btn small ghost" data-go="settings">Settings</button>
          <button class="btn small ghost" data-go="help">How to Play</button>
          <button class="btn small ghost" data-go="stats">Stats</button>
        </div>
      </div>
    </div></div>

    <div class="screen" id="scr-mode"><div class="panel">
      <h2 id="mode-title">Choose a game</h2><p class="sub" id="mode-sub"></p>
      <div class="cards" style="min-width:min(520px,86vw)">
        <div class="card" data-game="8ball"><div class="swatch" style="background:radial-gradient(circle at 30% 40%,#222 0 22%,transparent 23%),radial-gradient(circle at 62% 55%,#f4c20d 0 16%,transparent 17%),radial-gradient(circle at 75% 30%,#fff 0 12%,#d32222 13% 16%,transparent 17%),linear-gradient(135deg,#1d6b3c,#0f3d22)"></div>
          <h3>8-Ball</h3><p>Solids vs stripes. Clear your group, then call and sink the 8.</p></div>
        <div class="card" data-game="9ball"><div class="swatch" style="background:radial-gradient(circle at 40% 50%,#fff 0 9%,#f4c20d 10% 18%,#fff 19% 21%,transparent 22%),radial-gradient(circle at 66% 45%,#f4c20d 0 16%,transparent 17%),linear-gradient(135deg,#2a2b9a,#141550)"></div>
          <h3>9-Ball</h3><p>Hit the lowest ball first. Whoever pockets the 9 wins.</p></div>
      </div>
      <div class="row"><button class="btn small" data-back="main">&larr; Back</button></div>
    </div></div>

    <div class="screen" id="scr-diff"><div class="panel">
      <h2>Opponent</h2><p class="sub">How tough should the computer be?</p>
      <div class="cards" id="diff-cards" style="min-width:min(680px,86vw)">
        ${DIFFS.map((d) => `<div class="card" data-diff="${d.id}"><h3>${d.name}</h3><p>${d.desc}</p></div>`).join('')}
      </div>
      <div class="row"><button class="btn small" data-back="mode">&larr; Back</button></div>
    </div></div>

    <div class="screen" id="scr-venue"><div class="panel">
      <h2>Choose a venue</h2><p class="sub">Win games against the computer to unlock new rooms.</p>
      <div class="cards" id="venue-cards"></div>
      <div class="row"><button class="btn small" id="venue-back">&larr; Back</button><button class="btn small primary" id="venue-start">Start</button></div>
    </div></div>

    <div class="screen" id="scr-trick"><div class="panel">
      <h2>Trick Shot Challenge</h2><p class="sub">Twelve handcrafted shots. Fewer shots = more stars.</p>
      <div class="levels" id="level-grid"></div>
      <div class="row"><button class="btn small" data-back="main">&larr; Back</button></div>
    </div></div>

    <div class="screen" id="scr-settings"><div class="panel">
      <h2>Settings</h2><p class="sub">Saved on this device.</p>
      <div class="settings">
        <label>Master volume</label><input type="range" min="0" max="1" step="0.01" data-set="master">
        <label>Sound effects</label><input type="range" min="0" max="1" step="0.01" data-set="sfx">
        <label>Music</label><input type="range" min="0" max="1" step="0.01" data-set="music">
        <label>Mute all</label><div class="seg" data-seg="muted"><button data-v="false">Sound on</button><button data-v="true">Muted</button></div>
        <label>Graphics quality</label><div class="seg" data-seg="quality"><button data-v="auto">Auto</button><button data-v="low">Low</button><button data-v="medium">Medium</button><button data-v="high">High</button></div>
        <label>Aiming guide</label><div class="seg" data-seg="guide"><button data-v="auto">By difficulty</button><button data-v="full">Full</button><button data-v="short">Short</button><button data-v="off">Off</button></div>
        <label>Camera sensitivity</label><input type="range" min="0.3" max="2.5" step="0.05" data-set="sensitivity">
        <label>Shot clock</label><div class="seg" data-seg="shotClock"><button data-v="false">Off</button><button data-v="true">45 s</button></div>
        <label>Power drag</label><div class="seg" data-seg="invertPull"><button data-v="false">Pull down</button><button data-v="true">Push up</button></div>
      </div>
      <div class="row"><button class="btn small" id="settings-back">&larr; Back</button><button class="btn small ghost" id="reset-progress">Reset progress</button></div>
    </div></div>

    <div class="screen" id="scr-help"><div class="panel help">
      <h2>How to Play</h2>
      <h3>Aiming &amp; shooting</h3>
      <ul>
        <li><b>Mouse:</b> move the mouse to rotate the aim around the cue ball (in overhead view the cue follows the pointer). Hold <kbd>Shift</kbd> for fine aim.</li>
        <li><b>Shoot:</b> press and hold the left button, <b>pull back</b> (drag down) to set power, release to strike. Drag back up to cancel.</li>
        <li><b>Touch:</b> drag on the table to aim, drag the <b>power bar</b> on the right down and let go to shoot. Use the strip at the bottom for fine aim.</li>
        <li><b>Keyboard:</b> <kbd>&larr;</kbd> <kbd>&rarr;</kbd> aim, hold <kbd>Space</kbd> to charge and release to shoot, <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> spin, <kbd>X</kbd> reset spin, <kbd>Q</kbd>/<kbd>E</kbd> cue elevation, <kbd>C</kbd> camera, <kbd>Esc</kbd> pause.</li>
        <li><b>Spin:</b> click on the cue-ball widget (bottom left) to choose where the tip strikes: low = draw/back spin, high = follow, left/right = english, which changes the angle off cushions. Raise the cue with the slider next to it for jump shots.</li>
        <li><b>Camera:</b> the camera button cycles cue view, overhead and free orbit (right-drag / two fingers to orbit, wheel / pinch to zoom). Right-drag in cue view tilts the camera.</li>
        <li><b>Ball in hand:</b> after a foul, drag the cue ball to any spot. The ring turns red where placement is illegal.</li>
      </ul>
      <h3>8-Ball</h3>
      <ul>
        <li>Break from behind the head string. The table is open until someone legally pockets a ball - that player takes that group (solids 1-7 or stripes 9-15).</li>
        <li>Hit one of your own balls first and then pocket a ball or drive any ball to a cushion. Otherwise it is a foul and your opponent gets ball in hand.</li>
        <li>Once your group is cleared, call a pocket (click a pocket marker) and sink the 8. Potting the 8 early, in the wrong pocket, or scratching on it loses the game.</li>
      </ul>
      <h3>9-Ball</h3>
      <ul>
        <li>Always hit the lowest-numbered ball first. Any ball pocketed on a legal shot lets you continue; pocket the 9 legally - even on the break or in a combination - to win.</li>
        <li>On the shot after the break you may play a <b>push out</b>: the opponent then chooses whether to shoot or hand the table back.</li>
        <li>Three fouls in a row lose the game.</li>
      </ul>
      <h3>Fouls</h3>
      <ul><li>Scratch (cue ball pocketed), no ball hit, wrong ball first, no cushion after contact, illegal break.</li></ul>
      <div class="row"><button class="btn small" data-back="main">&larr; Back</button></div>
    </div></div>

    <div class="screen" id="scr-stats"><div class="panel" style="min-width:min(460px,86vw)">
      <h2>Statistics</h2><p class="sub">Your career at the Cue Club.</p>
      <div id="stats-body"></div>
      <div class="row"><button class="btn small" data-back="main">&larr; Back</button></div>
    </div></div>

    <div id="hud">
      <div class="hud-top" id="hud-players">
        <div class="pcard" id="p0"><div class="nm"><span class="name"></span><span class="thinking">thinking&hellip;</span><span class="grp"></span></div><div class="balls"></div></div>
        <div class="center-info"><div class="turn-msg" id="turn-msg">&nbsp;</div><div class="clock" id="clock"></div></div>
        <div class="pcard right" id="p1"><div class="nm"><span class="name"></span><span class="thinking">thinking&hellip;</span><span class="grp"></span></div><div class="balls"></div></div>
      </div>
      <div class="trick-panel" id="trick-panel">
        <div class="t1"><span class="lvl" id="tp-name"></span><span class="shots" id="tp-shots"></span></div>
        <div class="desc" id="tp-desc"></div>
      </div>
      <div class="hud-buttons">
        <button class="icon-btn" id="btn-pause" title="Pause (Esc)">&#10074;&#10074;</button>
        <button class="icon-btn" id="btn-cam" title="Camera (C)"><div>&#9673;<small id="cam-lbl">CUE</small></div></button>
      </div>
      <div class="power" id="power"><div class="lbl">POWER</div><div class="track"><div class="fill" id="power-fill"></div></div><div class="handle" id="power-handle"></div><div class="pct" id="power-pct">0%</div></div>
      <div class="spin-wrap">
        <div class="spin" id="spin" title="Cue tip position (double-click to reset)"><div class="ring"></div><div class="dot" id="spin-dot"></div><div class="spin-label">spin</div></div>
        <div class="elev" id="elev" title="Cue elevation (jump shots)"><div class="val" id="elev-val">0&deg;</div><div class="bar"></div><div class="knob" id="elev-knob"></div></div>
      </div>
      <div class="actions" id="actions"></div>
      <div class="fine" id="fine"><div class="ticks" id="fine-ticks"></div><span>fine aim</span></div>
      <div class="toast-wrap" id="toasts"></div>
      <div class="banner" id="banner"><div class="big" id="banner-big"></div><div class="small" id="banner-small"></div></div>
    </div>

    <div class="dialog" id="dlg-pause"><div class="panel"><h2>Paused</h2><div class="menu-list" style="margin-top:14px">
      <button class="btn primary" id="pause-resume">Resume</button>
      <button class="btn" id="pause-restart">Restart</button>
      <button class="btn" id="pause-settings">Settings</button>
      <button class="btn" id="pause-help">How to Play</button>
      <button class="btn" id="pause-quit">Quit to Menu</button>
    </div></div></div>

    <div class="dialog" id="dlg-over"><div class="panel" style="min-width:min(520px,90vw)">
      <h2 id="over-title"></h2><p class="sub" id="over-sub"></p>
      <div id="over-stats"></div>
      <div class="row"><button class="btn primary" id="over-again">Play Again</button><button class="btn" id="over-menu">Main Menu</button></div>
    </div></div>

    <div class="dialog" id="dlg-push"><div class="panel"><h2>Push Out</h2><p class="sub" id="push-sub">Your opponent pushed out. Do you want to shoot from here?</p>
      <div class="row"><button class="btn primary" id="push-take">I'll shoot</button><button class="btn" id="push-pass">Pass it back</button></div>
    </div></div>

    <div class="dialog" id="dlg-level"><div class="panel" style="text-align:center;min-width:min(420px,90vw)">
      <h2 id="lv-title"></h2><div id="lv-stars" style="font-size:42px;margin:6px 0 4px"></div><p class="sub" id="lv-sub"></p>
      <div class="row"><button class="btn primary" id="lv-next">Next Level</button><button class="btn" id="lv-retry">Retry</button><button class="btn" id="lv-menu">Levels</button></div>
    </div></div>

    <canvas id="confetti"></canvas>
    <div class="rotate-hint"><div class="phone"></div><div>Rotate your device to landscape to play</div></div>
    `;
  }

  bind() {
    const r = this.root;
    const app = this.app;
    const click = (el, fn) =>
      el.addEventListener('click', (e) => {
        app.audio.init();
        app.audio.ui();
        fn(e);
      });
    r.querySelectorAll('[data-go]').forEach((b) =>
      click(b, () => {
        const g = b.dataset.go;
        if (g === 'vsai') {
          this.sel = { ...this.sel, vsAI: true, practice: false };
          $('#mode-title').textContent = 'Play vs Computer';
          $('#mode-sub').textContent = 'Pick your game.';
          this.show('mode');
        } else if (g === 'hotseat') {
          this.sel = { ...this.sel, vsAI: false, practice: false };
          $('#mode-title').textContent = 'Two Players';
          $('#mode-sub').textContent = 'Pass the cue - both players share this device.';
          this.show('mode');
        } else if (g === 'practice') {
          this.sel = { ...this.sel, practice: true };
          this.showVenues('practice');
        } else if (g === 'venues') this.showVenues('browse');
        else if (g === 'trick') this.showLevels();
        else if (g === 'settings') this.showSettings('main');
        else if (g === 'help') {
          this.helpBack = 'main';
          this.show('help');
        } else if (g === 'stats') this.showStats();
      })
    );
    r.querySelectorAll('[data-back]').forEach((b) =>
      click(b, () => {
        const t = b.dataset.back;
        if (t === 'main' && this.helpBack === 'pause' && b.closest('#scr-help')) {
          this.helpBack = null;
          this.show(null);
          $('#dlg-pause').classList.add('show');
          return;
        }
        this.show(t);
      })
    );
    r.querySelectorAll('[data-game]').forEach((c) =>
      click(c, () => {
        this.sel.game = c.dataset.game;
        if (this.sel.vsAI) this.show('diff');
        else this.showVenues('play');
      })
    );
    r.querySelectorAll('[data-diff]').forEach((c) =>
      click(c, () => {
        this.sel.difficulty = c.dataset.diff;
        this.showVenues('play');
      })
    );
    click($('#venue-back'), () => {
      if (this.venueMode === 'play') this.show(this.sel.vsAI ? 'diff' : 'mode');
      else this.show('main');
    });
    click($('#venue-start'), () => this.startFromVenue());
    // settings
    r.querySelectorAll('[data-set]').forEach((inp) => {
      inp.addEventListener('input', () => app.setSetting(inp.dataset.set, Number(inp.value)));
    });
    r.querySelectorAll('[data-seg]').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) =>
        click(b, () => {
          let v = b.dataset.v;
          if (v === 'true') v = true;
          else if (v === 'false') v = false;
          app.setSetting(seg.dataset.seg, v);
          this.refreshSettings();
        })
      );
    });
    click($('#settings-back'), () => {
      if (this.settingsBack === 'pause') {
        this.show(null);
        $('#dlg-pause').classList.add('show');
      } else this.show('main');
    });
    click($('#reset-progress'), () => {
      if (confirm('Reset all stats, unlocked venues and trick-shot stars?')) {
        app.store.resetAll();
        app.applySettings();
        this.refreshSettings();
      }
    });
    // HUD
    click($('#btn-pause'), () => app.pause());
    click($('#btn-cam'), () => app.cycleCamera());
    click($('#pause-resume'), () => app.resume());
    click($('#pause-restart'), () => app.restart());
    click($('#pause-settings'), () => {
      $('#dlg-pause').classList.remove('show');
      this.showSettings('pause');
    });
    click($('#pause-help'), () => {
      $('#dlg-pause').classList.remove('show');
      this.helpBack = 'pause';
      this.show('help');
    });
    click($('#pause-quit'), () => app.quitToMenu());
    click($('#over-again'), () => app.restart());
    click($('#over-menu'), () => app.quitToMenu());
    click($('#push-take'), () => app.answerPush(true));
    click($('#push-pass'), () => app.answerPush(false));
    click($('#lv-next'), () => app.nextLevel());
    click($('#lv-retry'), () => app.restart());
    click($('#lv-menu'), () => {
      this.hideDialogs();
      app.quitToMenu(false);
      this.showLevels();
    });
    this.bindSpin();
    this.bindElevation();
    this.bindPower();
    this.bindFine();
  }

  // ------------------------------------------------------------------ screens
  show(id) {
    this.root.querySelectorAll('.screen').forEach((s) => s.classList.toggle('show', s.id === 'scr-' + id));
    if (id === 'main') this.refreshMain();
  }
  hideDialogs() {
    this.root.querySelectorAll('.dialog').forEach((d) => d.classList.remove('show'));
  }
  refreshMain() {
    const total = LEVELS.reduce((a, l) => a + this.app.store.trickStars(l.id), 0);
    $('#trick-progress').textContent = `${total}/${LEVELS.length * 3} ★`;
  }

  showVenues(mode) {
    this.venueMode = mode;
    const wins = this.app.store.data.stats.wins;
    const cur = this.app.store.data.venue;
    const box = $('#venue-cards');
    const swatch = {
      pub: 'linear-gradient(135deg,#1d6b3c 0 45%,#8a4a22 46% 60%,#2a1a10 61%), radial-gradient(circle at 80% 20%,#ffd29a,transparent 40%)',
      arcade: 'linear-gradient(135deg,#2a2b9a 0 45%,#ff2e9a 46% 50%,#120b22 51%)',
      lounge: 'linear-gradient(135deg,#6e1222 0 45%,#d4a64a 46% 50%,#3a1d10 51%)',
      space: 'radial-gradient(circle at 75% 75%,#3d6bff 0 18%,transparent 19%), linear-gradient(135deg,#0f5c6e 0 45%,#35e0ff 46% 49%,#05070c 50%)',
    };
    box.innerHTML = VENUES.map((v) => {
      const locked = wins < v.unlock;
      return `<div class="card ${locked ? 'locked' : ''} ${v.id === cur ? 'selected' : ''}" data-venue="${v.id}">
        <div class="swatch" style="background:${swatch[v.id]}"></div>
        ${locked ? `<span class="tag">&#128274; ${v.unlock} win${v.unlock > 1 ? 's' : ''}</span>` : ''}
        <h3>${esc(v.name)}</h3><p><b>${esc(v.theme)}.</b> ${esc(v.blurb)}</p></div>`;
    }).join('');
    box.querySelectorAll('[data-venue]').forEach((c) =>
      c.addEventListener('click', () => {
        this.app.audio.init();
        if (c.classList.contains('locked')) {
          this.toast('Win more games vs the computer to unlock', 'info');
          return;
        }
        this.app.audio.ui();
        this.app.selectVenue(c.dataset.venue);
        box.querySelectorAll('.card').forEach((x) => x.classList.toggle('selected', x === c));
        if (mode !== 'browse') this.startFromVenue();
      })
    );
    $('#venue-start').style.display = mode === 'browse' ? 'none' : '';
    $('#venue-back').innerHTML = '&larr; Back';
    this.show('venue');
  }

  startFromVenue() {
    if (this.venueMode === 'practice') this.app.startPractice();
    else if (this.venueMode === 'play') this.app.startMatch(this.sel.game, this.sel.vsAI, this.sel.difficulty);
    else this.show('main');
  }

  showLevels() {
    const grid = $('#level-grid');
    let prevDone = true;
    grid.innerHTML = LEVELS.map((l) => {
      const st = this.app.store.trickStars(l.id);
      const locked = !prevDone;
      prevDone = st > 0;
      return `<button class="level ${locked ? 'locked' : ''}" data-level="${l.id}"><div class="num">${l.id}</div><div class="name">${esc(l.name)}</div>${starsHtml(st)}</button>`;
    }).join('');
    grid.querySelectorAll('[data-level]').forEach((b) =>
      b.addEventListener('click', () => {
        this.app.audio.init();
        this.app.audio.ui();
        this.app.startTrick(Number(b.dataset.level));
      })
    );
    this.show('trick');
  }

  showSettings(back) {
    this.settingsBack = back;
    this.refreshSettings();
    this.show('settings');
  }
  refreshSettings() {
    const s = this.app.store.settings;
    this.root.querySelectorAll('[data-set]').forEach((inp) => (inp.value = s[inp.dataset.set]));
    this.root.querySelectorAll('[data-seg]').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(s[seg.dataset.seg]) === b.dataset.v));
    });
  }

  showStats() {
    const s = this.app.store.data.stats;
    const pct = s.shots ? Math.round((100 * s.pots) / s.shots) : 0;
    const modes = Object.entries(s.byMode)
      .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.played}</td><td>${v.won}</td></tr>`)
      .join('');
    const stars = LEVELS.reduce((a, l) => a + this.app.store.trickStars(l.id), 0);
    $('#stats-body').innerHTML = `<table class="stats">
      <tr><td>Games played</td><td>${s.games}</td></tr>
      <tr><td>Wins vs computer</td><td>${s.wins}</td></tr>
      <tr><td>Losses vs computer</td><td>${s.losses}</td></tr>
      <tr><td>Balls potted</td><td>${s.pots}</td></tr>
      <tr><td>Balls per shot</td><td>${pct}%</td></tr>
      <tr><td>Fouls</td><td>${s.fouls}</td></tr>
      <tr><td>Best run</td><td>${s.bestRun}</td></tr>
      <tr><td>Break and runs</td><td>${s.breakAndRuns}</td></tr>
      <tr><td>Trick shot stars</td><td>${stars} / ${LEVELS.length * 3}</td></tr>
    </table>
    ${modes ? `<table class="stats" style="margin-top:12px"><tr><th>Mode</th><th>Played</th><th>Won</th></tr>${modes}</table>` : ''}`;
    this.show('stats');
  }

  // ------------------------------------------------------------------ HUD
  showHUD(v, kind = 'match') {
    $('#hud').classList.toggle('show', v);
    $('#hud-players').style.display = kind === 'match' ? '' : 'none';
    $('#trick-panel').classList.toggle('show', kind === 'trick');
    if (kind === 'practice') {
      $('#hud-players').style.display = '';
      $('#p0').style.visibility = 'hidden';
      $('#p1').style.visibility = 'hidden';
    } else {
      $('#p0').style.visibility = '';
      $('#p1').style.visibility = '';
    }
  }

  setPlayers(players, current, groups, potted, game, onTable) {
    for (let i = 0; i < 2; i++) {
      const c = $('#p' + i);
      c.classList.toggle('active', i === current);
      $('.name', c).textContent = players[i].name;
      let grp = '';
      let icons = [];
      if (game === '8ball') {
        const g = groups ? groups[i] : null;
        grp = g ? g : 'open';
        if (g) {
          const set = g === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
          icons = set.map((n) => ({ n, dim: onTable.includes(n) }));
          const cleared = set.every((n) => !onTable.includes(n));
          if (cleared) icons.push({ n: 8, dim: onTable.includes(8) });
        } else icons = potted[i].map((n) => ({ n, dim: false }));
      } else {
        grp = '';
        icons = potted[i].map((n) => ({ n, dim: false }));
      }
      $('.grp', c).textContent = grp;
      $('.balls', c).innerHTML = icons.map((b) => `<img src="${ballIcon(b.n, 40)}" class="${b.dim ? 'dim' : ''}" alt="${b.n}">`).join('');
    }
  }

  setNineBallInfo(lowest) {
    // nothing extra for now; the turn message carries the info
    void lowest;
  }

  thinking(i, on) {
    for (let k = 0; k < 2; k++) $('#p' + k + ' .thinking').classList.toggle('on', on && k === i);
  }

  turnMessage(html) {
    $('#turn-msg').innerHTML = html || '&nbsp;';
  }

  setClock(sec) {
    const c = $('#clock');
    if (sec === null || sec === undefined) {
      c.textContent = '';
      return;
    }
    c.textContent = `shot clock ${Math.ceil(sec)}s`;
    c.classList.toggle('warn', sec < 10);
  }

  setCameraLabel(m) {
    $('#cam-lbl').textContent = { cue: 'CUE', top: 'TOP', orbit: 'FREE' }[m] || m;
  }

  setPower(p) {
    const pct = Math.round(p * 100);
    $('#power-fill').style.height = pct + '%';
    const track = $('#power .track');
    const h = track.clientHeight;
    $('#power-handle').style.top = 8 + p * (h - 2) + 'px';
    $('#power-pct').textContent = pct + '%';
  }

  setSpin(x, y) {
    $('#spin-dot').style.left = 50 + x * 40 + '%';
    $('#spin-dot').style.top = 50 - y * 40 + '%';
  }

  setElevation(deg) {
    const el = $('#elev');
    const h = el.clientHeight - 26;
    $('#elev-knob').style.bottom = 8 + (deg / 60) * h + 'px';
    $('#elev-val').textContent = Math.round(deg) + '°';
  }

  setActions(list) {
    // list: [{label, id, primary, onClick}]
    const box = $('#actions');
    box.innerHTML = '';
    for (const a of list) {
      const b = document.createElement('button');
      b.className = 'btn small' + (a.primary ? ' primary' : '') + (a.on ? ' primary' : '');
      b.textContent = a.label;
      b.addEventListener('click', () => {
        this.app.audio.ui();
        a.onClick();
      });
      box.appendChild(b);
    }
  }

  setTrickPanel(level, shots) {
    $('#tp-name').textContent = `${level.id}. ${level.name}`;
    $('#tp-shots').innerHTML = `Shots ${shots} / ${level.max} &nbsp; <span style="color:var(--muted)">&#9733;&#9733;&#9733; &le;${level.stars[0]} &middot; &#9733;&#9733; &le;${level.stars[1]}</span>`;
    $('#tp-desc').textContent = level.desc;
  }

  toast(text, kind = 'info', life = 2.4) {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.style.setProperty('--life', life + 's');
    t.textContent = text;
    const box = $('#toasts');
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.remove(), (life + 0.5) * 1000);
  }

  banner(big, small = '', confetti = false) {
    const b = $('#banner');
    b.classList.remove('show');
    void b.offsetWidth;
    $('#banner-big').textContent = big;
    $('#banner-small').textContent = small;
    b.classList.add('show');
    if (confetti) this.confetti.burst();
  }

  showPause(v) {
    $('#dlg-pause').classList.toggle('show', v);
  }

  showPush(v, text) {
    if (text) $('#push-sub').textContent = text;
    $('#dlg-push').classList.toggle('show', v);
  }

  showGameOver(d) {
    $('#over-title').textContent = d.title;
    $('#over-sub').textContent = d.sub;
    const rows = [
      ['Shots', (s) => s.shots],
      ['Balls potted', (s) => s.pots],
      ['Pot success', (s) => (s.shots ? Math.round((100 * s.potShots) / s.shots) : 0) + '%'],
      ['Fouls', (s) => s.fouls],
      ['Longest run', (s) => s.longestRun],
    ];
    $('#over-stats').innerHTML = `<table class="stats"><tr><th></th><th>${esc(d.players[0].name)}</th><th>${esc(d.players[1].name)}</th></tr>
      ${rows.map(([k, f]) => `<tr><td>${k}</td><td>${f(d.stats[0])}</td><td>${f(d.stats[1])}</td></tr>`).join('')}</table>
      ${d.extra ? `<p class="sub" style="margin-top:12px">${esc(d.extra)}</p>` : ''}`;
    $('#dlg-over').classList.add('show');
  }

  showLevelEnd(success, stars, text, hasNext) {
    $('#lv-title').textContent = success ? 'Level Complete!' : 'Out of Shots';
    $('#lv-stars').innerHTML = success ? starsHtml(stars) : '';
    $('#lv-sub').textContent = text;
    $('#lv-next').style.display = success && hasNext ? '' : 'none';
    $('#dlg-level').classList.add('show');
  }

  // ------------------------------------------------------------------ widgets
  bindSpin() {
    const el = $('#spin');
    let active = false;
    const set = (e) => {
      const r = el.getBoundingClientRect();
      let x = ((e.clientX - r.left) / r.width - 0.5) / 0.4;
      let y = -((e.clientY - r.top) / r.height - 0.5) / 0.4;
      const m = Math.hypot(x, y);
      if (m > 1) {
        x /= m;
        y /= m;
      }
      this.app.setSpin(x, y);
    };
    el.addEventListener('pointerdown', (e) => {
      active = true;
      el.setPointerCapture(e.pointerId);
      set(e);
      e.stopPropagation();
    });
    el.addEventListener('pointermove', (e) => active && set(e));
    el.addEventListener('pointerup', () => (active = false));
    el.addEventListener('dblclick', () => this.app.setSpin(0, 0));
  }

  bindElevation() {
    const el = $('#elev');
    let active = false;
    const set = (e) => {
      const r = el.getBoundingClientRect();
      const t = 1 - (e.clientY - r.top - 8) / (r.height - 16);
      this.app.setElevation(Math.max(0, Math.min(1, t)) * 60);
    };
    el.addEventListener('pointerdown', (e) => {
      active = true;
      el.setPointerCapture(e.pointerId);
      set(e);
    });
    el.addEventListener('pointermove', (e) => active && set(e));
    el.addEventListener('pointerup', () => (active = false));
    el.addEventListener('dblclick', () => this.app.setElevation(0));
  }

  bindPower() {
    const el = $('#power');
    let start = null;
    el.addEventListener('pointerdown', (e) => {
      this.app.audio.init();
      if (!this.app.canShoot()) return;
      start = e.clientY;
      el.setPointerCapture(e.pointerId);
      this.app.beginPull();
    });
    el.addEventListener('pointermove', (e) => {
      if (start === null) return;
      const h = el.clientHeight * 0.9;
      this.app.setPull((e.clientY - start) / h);
    });
    const end = () => {
      if (start === null) return;
      start = null;
      this.app.releasePull();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => {
      start = null;
      this.app.cancelPull();
    });
  }

  bindFine() {
    const el = $('#fine');
    let last = null;
    let off = 0;
    el.addEventListener('pointerdown', (e) => {
      last = e.clientX;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (last === null) return;
      const dx = e.clientX - last;
      last = e.clientX;
      off += dx;
      $('#fine-ticks').style.backgroundPosition = off + 'px 0';
      this.app.fineAim(-dx * 0.00035);
    });
    el.addEventListener('pointerup', () => (last = null));
  }
}

// lightweight confetti
class Confetti {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.parts = [];
    this.running = false;
  }
  burst() {
    const W = (this.c.width = window.innerWidth);
    const H = (this.c.height = window.innerHeight);
    const cols = ['#f5c451', '#ff5a7a', '#43e0c7', '#7a8cff', '#ffffff', '#4dff9a'];
    for (let i = 0; i < 160; i++) {
      this.parts.push({
        x: W / 2 + (Math.random() - 0.5) * W * 0.3,
        y: H * 0.38,
        vx: (Math.random() - 0.5) * 900,
        vy: -Math.random() * 900 - 200,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 12,
        s: 5 + Math.random() * 7,
        c: cols[i % cols.length],
        life: 2.5 + Math.random(),
      });
    }
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame((t) => this.tick(t));
    }
  }
  tick(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const g = this.g;
    g.clearRect(0, 0, this.c.width, this.c.height);
    this.parts = this.parts.filter((p) => (p.life -= dt) > 0);
    for (const p of this.parts) {
      p.vy += 1400 * dt;
      p.vx *= 0.99;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      g.save();
      g.globalAlpha = Math.min(1, p.life);
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.fillStyle = p.c;
      g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      g.restore();
    }
    if (this.parts.length) requestAnimationFrame((tt) => this.tick(tt));
    else this.running = false;
  }
}
