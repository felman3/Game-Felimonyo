// Sound effects made in the browser, so there are no sound files to load.

let ctx = null;
let master = null;
let noiseBuf = null;
let rainGain = null;
let muted = false;

try { muted = localStorage.getItem('sr-muted') === '1'; } catch (e) { /* ignore */ }

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('sr-muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
  if (master) master.gain.value = m ? 0 : 0.5;
}

function tone(freq, dur, type, vol, slideTo, delay) {
  if (!ctx) return;
  const t = ctx.currentTime + (delay || 0);
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur, freq, q, vol, slideTo) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(freq, t);
  if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  f.Q.value = q || 1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol || 0.4, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.05);
}

// vol scales with distance from the listener (1 = right here).
export const sfx = {
  throw(v = 1) { noise(0.18, 900, 1.2, 0.25 * v, 2400); },
  squirt(v = 1) { noise(0.08, 2600, 2, 0.12 * v, 1800); },
  splash(v = 1, big) {
    noise(big ? 0.6 : 0.35, big ? 700 : 1100, 0.8, 0.5 * v, 300);
    tone(big ? 300 : 520, 0.12, 'sine', 0.15 * v, big ? 120 : 200);
  },
  hit() { tone(880, 0.08, 'square', 0.12, 1320); },
  hurt() { tone(260, 0.18, 'triangle', 0.25, 140); noise(0.2, 600, 1, 0.3); },
  pickup() { tone(660, 0.1, 'sine', 0.25); tone(990, 0.14, 'sine', 0.25, null, 0.08); },
  ko() { tone(600, 0.5, 'triangle', 0.3, 120); noise(0.6, 500, 0.7, 0.35, 200); },
  koOther() { tone(1046, 0.1, 'sine', 0.2); tone(1318, 0.16, 'sine', 0.2, null, 0.09); },
  beep(high) { tone(high ? 1046 : 660, 0.14, 'sine', 0.25); },
  boing() { tone(220, 0.35, 'sine', 0.3, 880); tone(330, 0.2, 'triangle', 0.12, 990, 0.05); },
  jump() { tone(420, 0.14, 'sine', 0.15, 760); },
  dash() { noise(0.15, 1500, 1, 0.2, 500); },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'triangle', 0.25, null, i * 0.13)); },
  lose() { [523, 440, 349].forEach((f, i) => tone(f, 0.35, 'triangle', 0.22, null, i * 0.18)); },
  click() { tone(800, 0.05, 'sine', 0.15); }
};

// Steady rain while you stand in the storm.
export function setRain(level) {
  if (!ctx) return;
  if (!rainGain) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    s.connect(f).connect(rainGain).connect(master);
    s.start();
  }
  rainGain.gain.setTargetAtTime(level * 0.35, ctx.currentTime, 0.3);
}
