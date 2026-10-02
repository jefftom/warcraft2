// Tiny synthesized sound effects using the Web Audio API.

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.last = {};
    try {
      this.muted = localStorage.getItem('ironvale.muted') === '1';
    } catch {
      // Storage may be unavailable (private mode); sound stays on.
    }
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.35;
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
    const d = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.35;
    try {
      localStorage.setItem('ironvale.muted', m ? '1' : '0');
    } catch {
      // Ignore storage failures.
    }
  }

  tone(freq, dur, { type = 'square', vol = 0.3, slide = 0, delay = 0 } = {}) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, { vol = 0.3, freq = 1200, q = 1, delay = 0, type = 'bandpass' } = {}) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuffer;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  play(name, volume = 1) {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    const gap = { chop: 90, hit: 60, bow: 70, hitBuilding: 90, death: 80 }[name] ?? 40;
    if (this.last[name] && now - this.last[name] < gap) return;
    this.last[name] = now;
    const v = volume;
    switch (name) {
      case 'select':
        this.tone(660, 0.05, { type: 'triangle', vol: 0.15 * v });
        break;
      case 'ack':
        this.tone(520, 0.06, { type: 'triangle', vol: 0.15 * v });
        this.tone(780, 0.06, { type: 'triangle', vol: 0.12 * v, delay: 0.05 });
        break;
      case 'chop':
        this.noise(0.08, { vol: 0.35 * v, freq: 900, q: 3 });
        this.tone(180, 0.06, { type: 'square', vol: 0.08 * v });
        break;
      case 'treefall':
        this.noise(0.5, { vol: 0.3 * v, freq: 300, q: 0.8, type: 'lowpass' });
        break;
      case 'hit':
        this.noise(0.07, { vol: 0.3 * v, freq: 2500, q: 2 });
        this.tone(1400, 0.04, { type: 'square', vol: 0.05 * v, slide: -600 });
        break;
      case 'hitBuilding':
        this.noise(0.1, { vol: 0.3 * v, freq: 600, q: 1.5 });
        break;
      case 'bow':
        this.tone(900, 0.08, { type: 'triangle', vol: 0.1 * v, slide: -500 });
        break;
      case 'bolt':
        this.noise(0.12, { vol: 0.2 * v, freq: 1600, q: 1 });
        break;
      case 'death':
        this.tone(320, 0.35, { type: 'sawtooth', vol: 0.1 * v, slide: -220 });
        break;
      case 'collapse':
        this.noise(0.9, { vol: 0.5 * v, freq: 200, q: 0.7, type: 'lowpass' });
        this.tone(90, 0.6, { type: 'sine', vol: 0.3 * v, slide: -40 });
        break;
      case 'build':
        this.noise(0.05, { vol: 0.3 * v, freq: 1800, q: 4 });
        this.noise(0.05, { vol: 0.3 * v, freq: 1800, q: 4, delay: 0.18 });
        break;
      case 'complete':
        this.tone(523, 0.12, { type: 'triangle', vol: 0.2 * v });
        this.tone(659, 0.12, { type: 'triangle', vol: 0.2 * v, delay: 0.1 });
        this.tone(784, 0.2, { type: 'triangle', vol: 0.2 * v, delay: 0.2 });
        break;
      case 'ready':
        this.tone(440, 0.08, { type: 'square', vol: 0.08 * v });
        this.tone(660, 0.12, { type: 'square', vol: 0.08 * v, delay: 0.08 });
        break;
      case 'alert':
        this.tone(220, 0.35, { type: 'sawtooth', vol: 0.18 * v });
        this.tone(165, 0.5, { type: 'sawtooth', vol: 0.18 * v, delay: 0.3 });
        break;
      case 'error':
        this.tone(140, 0.15, { type: 'square', vol: 0.12 * v });
        break;
      case 'victory':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.25, delay: i * 0.18 }));
        break;
      case 'defeat':
        [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.4, { type: 'sawtooth', vol: 0.12, delay: i * 0.25 }));
        break;
      default:
        break;
    }
  }
}
