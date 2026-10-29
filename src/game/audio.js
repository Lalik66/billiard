// All sounds are synthesised with the Web Audio API - no audio files.
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfx = null;
    this.musicGain = null;
    this.settings = { master: 0.8, sfx: 0.9, music: 0.35, muted: false };
    this.lastClick = 0;
    this.clicksThisFrame = 0;
    this.musicStyle = null;
    this.musicTimer = null;
    this.nextNote = 0;
    this.step = 0;
  }

  // must be called from a user gesture
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(this.master);
    this.sfx = this.ctx.createGain();
    this.sfx.connect(comp);
    this.musicGain = this.ctx.createGain();
    this.musicGain.connect(this.master);
    // reverb-ish send for music
    this.verb = this.ctx.createConvolver();
    this.verb.buffer = this._impulse(2.2);
    this.verbGain = this.ctx.createGain();
    this.verbGain.gain.value = 0.35;
    this.verb.connect(this.verbGain);
    this.verbGain.connect(this.musicGain);
    this.noise = this._noiseBuffer(2);
    // continuous rolling noise
    this.rollSrc = this.ctx.createBufferSource();
    this.rollSrc.buffer = this.noise;
    this.rollSrc.loop = true;
    this.rollFilter = this.ctx.createBiquadFilter();
    this.rollFilter.type = 'lowpass';
    this.rollFilter.frequency.value = 220;
    this.rollFilter.Q.value = 0.7;
    this.rollGain = this.ctx.createGain();
    this.rollGain.gain.value = 0;
    this.rollSrc.connect(this.rollFilter);
    this.rollFilter.connect(this.rollGain);
    this.rollGain.connect(this.sfx);
    this.rollSrc.start();
    this.apply(this.settings);
    if (this.musicStyle) this.startMusic(this.musicStyle);
  }

  apply(s) {
    this.settings = { ...this.settings, ...s };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
    this.musicGain.gain.setTargetAtTime(this.settings.music * 0.5, t, 0.2);
  }

  _noiseBuffer(sec) {
    const len = Math.floor(this.ctx.sampleRate * sec);
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _impulse(sec) {
    const len = Math.floor(this.ctx.sampleRate * sec);
    const b = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return b;
  }

  _env(gainNode, t, peak, attack, decay) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  _noiseBurst(t, { freq = 2000, q = 1, type = 'bandpass', peak = 0.5, attack = 0.001, decay = 0.05, dest = null }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    this._env(g, t, peak, attack, decay);
    src.connect(f);
    f.connect(g);
    g.connect(dest || this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + decay + 0.05);
  }

  _tone(t, { freq = 440, type = 'sine', peak = 0.3, attack = 0.002, decay = 0.1, dest = null, slide = 0, detune = 0 }) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + attack + decay);
    o.detune.value = detune;
    const g = this.ctx.createGain();
    this._env(g, t, peak, attack, decay);
    o.connect(g);
    g.connect(dest || this.sfx);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  cueStrike(power) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const p = Math.min(1, Math.max(0.05, power));
    this._noiseBurst(t, { freq: 2500 + p * 1500, q: 1.2, peak: 0.25 + p * 0.6, decay: 0.03 + p * 0.03 });
    this._tone(t, { freq: 180 + p * 60, type: 'triangle', peak: 0.2 + p * 0.4, decay: 0.07, slide: 0.6 });
    this._tone(t, { freq: 1150, type: 'sine', peak: 0.1 + p * 0.15, decay: 0.03 });
  }

  ballClick(speed) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (t - this.lastClick < 0.008) {
      this.clicksThisFrame++;
      if (this.clicksThisFrame > 4) return;
    } else this.clicksThisFrame = 0;
    this.lastClick = t;
    const v = Math.min(1, speed / 4);
    if (v < 0.01) return;
    const pk = Math.pow(v, 0.8) * 0.75;
    const f = 2800 + Math.random() * 900;
    this._tone(t, { freq: f, type: 'sine', peak: pk, decay: 0.035 + v * 0.02 });
    this._tone(t, { freq: f * 1.52, type: 'sine', peak: pk * 0.4, decay: 0.02 });
    this._noiseBurst(t, { freq: 5000, q: 0.8, peak: pk * 0.5, decay: 0.012 });
  }

  cushion(speed) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const v = Math.min(1, speed / 4);
    if (v < 0.02) return;
    this._tone(t, { freq: 95 + v * 30, type: 'sine', peak: 0.2 + v * 0.5, decay: 0.09, slide: 0.7 });
    this._noiseBurst(t, { freq: 400, type: 'lowpass', q: 0.7, peak: 0.15 + v * 0.35, decay: 0.06 });
  }

  pocket(speed = 1) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const v = Math.min(1, 0.4 + speed / 4);
    this._tone(t, { freq: 140, type: 'sine', peak: 0.5 * v, decay: 0.14, slide: 0.6 });
    this._noiseBurst(t, { freq: 600, type: 'lowpass', peak: 0.3 * v, decay: 0.1 });
    // rattle into the pocket
    for (let i = 0; i < 4; i++) {
      const tt = t + 0.08 + i * 0.05 + Math.random() * 0.03;
      this._tone(tt, { freq: 900 + Math.random() * 500, type: 'triangle', peak: 0.12 * v * (1 - i * 0.2), decay: 0.03 });
    }
    this._tone(t + 0.32, { freq: 110, type: 'sine', peak: 0.25 * v, decay: 0.12 });
  }

  rattle() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this._tone(t + i * 0.035, { freq: 700 + i * 120, type: 'triangle', peak: 0.25, decay: 0.03 });
    this._noiseBurst(t, { freq: 350, type: 'lowpass', peak: 0.3, decay: 0.08 });
  }

  rack() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 14; i++) {
      const tt = t + i * 0.035 + Math.random() * 0.02;
      this._tone(tt, { freq: 2600 + Math.random() * 1000, type: 'sine', peak: 0.18, decay: 0.03 });
    }
    this._noiseBurst(t + 0.5, { freq: 300, type: 'lowpass', peak: 0.3, decay: 0.2 });
  }

  roll(totalSpeed) {
    if (!this.ctx) return;
    const g = Math.min(0.35, totalSpeed * 0.09);
    this.rollGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
    this.rollFilter.frequency.setTargetAtTime(160 + Math.min(400, totalSpeed * 90), this.ctx.currentTime, 0.05);
  }

  foul() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._tone(t, { freq: 220, type: 'square', peak: 0.12, decay: 0.18 });
    this._tone(t + 0.2, { freq: 165, type: 'square', peak: 0.12, decay: 0.3 });
  }

  ui() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._tone(t, { freq: 880, type: 'triangle', peak: 0.08, decay: 0.05 });
  }

  celebrate(big = false) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const notes = big ? [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568] : [659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this._tone(t + i * 0.09, { freq: f, type: 'triangle', peak: 0.18, attack: 0.01, decay: 0.4 });
      this._tone(t + i * 0.09, { freq: f * 2, type: 'sine', peak: 0.05, attack: 0.01, decay: 0.3 });
    });
    if (big) {
      for (let i = 0; i < 12; i++) this._tone(t + 0.6 + i * 0.05, { freq: 2000 + Math.random() * 2500, type: 'sine', peak: 0.05, decay: 0.15 });
    }
  }

  // -------------------------------------------------------------------------
  // Procedural background music (quiet, per venue)
  startMusic(style) {
    this.musicStyle = style;
    if (!this.ctx) return;
    this.stopMusic(false);
    this.musicStyle = style;
    this.step = 0;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this._schedule(), 100);
  }

  stopMusic(clear = true) {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (clear) this.musicStyle = null;
  }

  _schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const styles = {
      pub: { bpm: 84, prog: [[57, 60, 64, 67], [62, 65, 69, 72], [55, 59, 62, 65], [60, 64, 67, 71]], wave: 'triangle', bass: true, swing: 0.12, lead: 'sine' },
      arcade: { bpm: 108, prog: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], wave: 'sawtooth', bass: true, arp: true, lead: 'square' },
      lounge: { bpm: 72, prog: [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [57, 60, 64, 67]], wave: 'sine', bass: true, swing: 0.15, lead: 'sine' },
      space: { bpm: 56, prog: [[45, 52, 57, 64], [43, 50, 55, 62], [41, 48, 53, 60], [43, 50, 55, 59]], wave: 'sine', pad: true, lead: 'sine' },
    };
    const s = styles[this.musicStyle];
    if (!s) return;
    const spb = 60 / s.bpm / 2; // eighth notes
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    while (this.nextNote < this.ctx.currentTime + 0.4) {
      const t = this.nextNote;
      const bar = Math.floor(this.step / 8) % s.prog.length;
      const chord = s.prog[bar];
      const pos = this.step % 8;
      const dest = this.musicGain;
      if (pos === 0) {
        // pad chord
        for (const m of chord) {
          this._tone(t, { freq: mtof(m), type: s.wave === 'sawtooth' ? 'triangle' : s.wave, peak: s.pad ? 0.05 : 0.035, attack: s.pad ? 0.8 : 0.05, decay: spb * 8 * (s.pad ? 1.2 : 0.9), dest, detune: (Math.random() - 0.5) * 8 });
          this._tone(t, { freq: mtof(m), type: 'sine', peak: 0.02, attack: 0.3, decay: spb * 8, dest: this.verb });
        }
      }
      if (s.bass && (pos === 0 || pos === 4 || (pos === 6 && Math.random() < 0.5))) {
        this._tone(t, { freq: mtof(chord[0] - 12), type: 'sine', peak: 0.09, attack: 0.01, decay: spb * 1.6, dest });
      }
      if (s.arp) {
        const m = chord[pos % chord.length] + (pos >= 4 ? 12 : 0);
        this._tone(t, { freq: mtof(m), type: 'square', peak: 0.018, attack: 0.005, decay: spb * 0.8, dest });
        this._tone(t, { freq: mtof(m), type: 'sine', peak: 0.015, attack: 0.005, decay: spb, dest: this.verb });
      }
      if (!s.arp && Math.random() < (s.pad ? 0.12 : 0.28)) {
        const m = chord[Math.floor(Math.random() * chord.length)] + 12;
        this._tone(t, { freq: mtof(m), type: s.lead, peak: 0.03, attack: 0.02, decay: spb * 2.5, dest });
        this._tone(t, { freq: mtof(m), type: 'sine', peak: 0.02, attack: 0.02, decay: spb * 3, dest: this.verb });
      }
      if (this.musicStyle === 'pub' && pos % 2 === 0) this._noiseBurst(t, { freq: 8000, q: 1, peak: 0.012, decay: 0.03, dest });
      const swing = s.swing && pos % 2 === 0 ? spb * s.swing : s.swing ? -spb * s.swing : 0;
      this.nextNote += spb + swing;
      this.step++;
    }
  }
}
