// Menu, connecting, and the animation loop.

import * as S from './shared.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { createGame, loadStats } from './game.js';
import { Host, cleanName, cleanColor, cleanHat } from './host.js';
import * as net from './net.js';
import { unlock, sfx, isMuted, setMuted } from './audio.js';

const $ = (id) => document.getElementById(id);
const mobile = window.matchMedia('(pointer: coarse)').matches;

const store = {
  get(k, d) { try { const v = localStorage.getItem('sr-' + k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('sr-' + k, v); } catch (e) { /* ignore */ } }
};

/* ---------- 3D view ---------- */
let R;
try {
  R = createRenderer($('view'), { mobile });
} catch (e) {
  console.error(e);
  showError('Your browser can\'t show 3D', 'Splash Royale needs WebGL. Try a recent Chrome, Safari, Edge or Firefox, or turn on hardware acceleration.', false);
  throw e;
}
R.setWorld(S.buildWorld(20261004));
R.setOrbit();

const input = createInput({
  canvas: $('view'),
  touchLayer: $('touch-layer'),
  sticks: {
    left: { base: $('stick-l-base'), knob: $('stick-l-knob') },
    right: { base: $('stick-r-base'), knob: $('stick-r-knob') }
  }
});

let session = null; // { game, host?, peer, conn? }
let last = performance.now();
// Watch the frame rate during matches and lower the quality if it's choppy.
let fpsT = 0, fpsN = 0, fpsSkip = 2;
function loop(t) {
  const dt = Math.min(0.25, (t - last) / 1000);
  last = t;
  if (session && !document.hidden && dt < 0.25) {
    fpsT += dt; fpsN++;
    if (fpsT > 4) {
      const fps = fpsN / fpsT;
      if (fpsSkip > 0) fpsSkip--; // ignore the first seconds while things load
      else if (fps < 34) R.lowerQuality();
      fpsT = 0; fpsN = 0;
    }
  }
  if (session) session.game.frame(dt, t / 1000);
  else R.render(dt, t / 1000, false);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---------- Profile ---------- */
let profile = {
  name: cleanName(store.get('name', '')),
  color: cleanColor(store.get('color', S.COLORS[Math.floor(Math.random() * S.COLORS.length)])),
  hat: cleanHat(store.get('hat', 1 + Math.floor(Math.random() * (S.HATS.length - 1))))
};
if (profile.name === 'Player') profile.name = '';
$('name').value = profile.name;

const colorsBox = $('colors');
S.COLORS.forEach((c) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.style.background = c;
  b.setAttribute('aria-label', 'Colour ' + c);
  if (c === profile.color) b.classList.add('on');
  b.addEventListener('click', () => {
    profile.color = c;
    store.set('color', c);
    drawPreview();
    colorsBox.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s === b));
  });
  colorsBox.append(b);
});

const hatsBox = $('hats');
S.HATS.forEach((h, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hat-btn';
  b.textContent = h.icon;
  b.title = h.label;
  b.setAttribute('aria-label', h.label);
  if (i === profile.hat) b.classList.add('on');
  b.addEventListener('click', () => {
    profile.hat = i;
    store.set('hat', i);
    drawPreview();
    hatsBox.querySelectorAll('.hat-btn').forEach((x) => x.classList.toggle('on', x === b));
  });
  hatsBox.append(b);
});

// A little drawing of your splasher with the colour and hat you picked.
function drawPreview() {
  const c = $('preview');
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  const cx = W / 2, top = 46, bw = 62, bh = 78;
  g.fillStyle = 'rgba(43,35,64,0.15)';
  g.beginPath(); g.ellipse(cx, top + bh + 6, 34, 7, 0, 0, Math.PI * 2); g.fill();
  // Rounded rectangle drawn by hand (older iPhones lack ctx.roundRect).
  const body = (x, y, w, h, r) => {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
    g.fill();
  };
  g.fillStyle = shade(profile.color, -0.25);
  body(cx - 26, top + bh - 10, 22, 14, 7);
  body(cx + 4, top + bh - 10, 22, 14, 7);
  g.fillStyle = profile.color;
  body(cx - bw / 2, top, bw, bh, 31);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath(); g.ellipse(cx, top + 52, 20, 18, 0, 0, Math.PI * 2); g.fill();
  for (const sx of [-1, 1]) {
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(cx + sx * 12, top + 24, 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2b2340';
    g.beginPath(); g.arc(cx + sx * 12, top + 25, 4.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff9cb5';
    g.beginPath(); g.ellipse(cx + sx * 21, top + 36, 5, 3, 0, 0, Math.PI * 2); g.fill();
  }
  if (profile.hat) {
    g.font = '34px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(S.HATS[profile.hat].icon, cx, top - 6);
  }
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + k))));
  return 'rgb(' + f(n >> 16) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')';
}
drawPreview();

function saveProfile() {
  const typed = $('name').value.trim();
  profile.name = cleanName(typed || S.BOT_NAMES[Math.floor(Math.random() * 6)] + ' ' + (10 + Math.floor(Math.random() * 90)));
  store.set('name', typed ? profile.name : '');
  return profile;
}

/* ---------- Screens ---------- */
function screen(id) {
  for (const s of ['menu', 'connecting', 'error']) $(s).hidden = s !== id;
  if (id === 'menu') showStats();
}

function showStats() {
  const s = loadStats();
  const el = $('stats');
  el.hidden = !s.games;
  el.textContent = '🏆 ' + s.wins + ' win' + (s.wins === 1 ? '' : 's') + ' · 🎮 ' + s.games + ' played · 💦 ' + s.splashes + ' soaked' + (s.best && !s.wins ? ' · best #' + s.best : '');
}
showStats();

function showError(title, text, canRetry) {
  $('error-title').textContent = title;
  $('error-text').textContent = text;
  $('error-retry').hidden = !canRetry;
  $('menu').hidden = $('connecting').hidden = true;
  $('error').hidden = false;
}

function menuError(text) {
  screen('menu');
  $('menu-error').textContent = text;
  $('menu-error').hidden = !text;
}

/* ---------- Joining ---------- */
let cancelled = false;

async function go(kind, code) {
  unlock();
  sfx.click();
  saveProfile();
  cancelled = false;
  $('menu-error').hidden = true;
  $('connecting-text').textContent = kind === 'quick' ? 'Looking for a match…' : kind === 'create' ? 'Making your room…' : 'Joining room…';
  screen('connecting');
  try {
    let res;
    if (kind === 'quick') res = await net.quickPlay(profile, (t) => { $('connecting-text').textContent = t; }, () => cancelled);
    else if (kind === 'create') res = await net.createRoom();
    else res = await net.joinRoom(code, profile);
    if (cancelled) {
      try { res.peer.destroy(); } catch (e) { /* ignore */ }
      return;
    }
    $('connecting').hidden = true;
    if (res.role === 'host') startHost(res); else startGuest(res);
  } catch (e) {
    if (cancelled || e.type === 'cancelled') return;
    console.warn(e);
    menuError(net.errorText(e));
  }
}

function startHost(res, takeover, game) {
  const localId = game ? game.myId() : 'h';
  const host = new Host({
    peer: res.peer, quick: res.quick, code: res.code, practice: res.practice, profile, localId, takeover,
    deliverLocal: (m) => { Promise.resolve().then(() => { if (session && session.host === host) session.game.onMessage(m); }); }
  });
  if (game) game.relink((m) => host.receive(localId, m), true);
  else game = createGame({ render: R, input, send: (m) => host.receive(localId, m), myId: localId, isHost: true, mobile, onLeave: leave });
  session = { game, host, peer: res.peer, quick: res.quick, code: res.code };
  res.peer.on('error', (e) => { if (e.type !== 'peer-unavailable') console.warn('peer error', e && e.type, e); });
  if (!res.quick && !res.practice) history.replaceState(null, '', '?room=' + res.code);
  if (res.practice) setTimeout(() => host.receive(localId, { t: 'start' }), 50);
  if (takeover) {
    host.broadcast({ t: 'feed', text: profile.name + ' is hosting now' });
    game.notice('The host left — you\'re hosting now! 👑');
  }
}

// Practice: we host a match for ourselves and bots, no internet needed.
function startPractice() {
  unlock();
  sfx.click();
  saveProfile();
  screen('none');
  const fakePeer = { on() {}, destroy() {} };
  startHost({ role: 'host', peer: fakePeer, quick: false, practice: true, code: 'practice' });
}

function startGuest(res, game) {
  const { peer, welcome } = res;
  if (game) {
    if (welcome.resume) game.relink(sendVia(res.conn), false);
    else { game.relink(sendVia(res.conn), false); game.reset(welcome.id); }
  } else {
    game = createGame({ render: R, input, myId: welcome.id, isHost: false, mobile, onLeave: leave, send: sendVia(res.conn) });
  }
  const s = { game, peer, conn: res.conn, quick: welcome.quick, code: welcome.code, lastHeard: performance.now() };
  session = s;
  wireConn(s, res.conn);
  peer.on('error', (e) => { if (e.type !== 'peer-unavailable') console.warn('peer error', e && e.type, e); });
  s.watch = setInterval(() => {
    if (performance.now() - s.lastHeard > 12000) hostGone(s);
  }, 1000);
  if (!welcome.quick) history.replaceState(null, '', '?room=' + welcome.code);
}

function sendVia(conn) {
  return (m) => { if (conn.open) { try { conn.send(m); } catch (e) { /* ignore */ } } };
}

function wireConn(s, conn) {
  conn.on('data', (m) => {
    if (s.conn !== conn) return;
    s.lastHeard = performance.now();
    if (m && m.t === 'bye') { hostGone(s); return; }
    s.game.onMessage(m);
  });
  conn.on('close', () => { if (s.conn === conn) hostGone(s); });
}

// The host left. The next player in line takes over the room and everyone
// else reconnects to them, so the match carries on.
async function hostGone(s) {
  if (session !== s || s.migrating) return;
  s.migrating = true;
  clearInterval(s.watch);
  const oldConn = s.conn;
  s.conn = null;
  try { oldConn.close(); } catch (e) { /* ignore */ }
  const game = s.game;
  const myId = game.myId();
  const heirs = game.heirs().filter((id) => id !== game.hostId());
  const rank = Math.max(0, heirs.indexOf(myId));
  const roomPeer = net.peerIdFor(s.code);
  game.notice('The host left — reconnecting…');
  const started = performance.now();
  while (session === s && performance.now() - started < 25000) {
    const waited = performance.now() - started;
    // The first heir tries right away; the next ones give them a few seconds' head start.
    if (heirs.indexOf(myId) !== -1 && waited >= rank * 4000) {
      try {
        const peer = await net.openPeer(roomPeer);
        if (session !== s) { peer.destroy(); return; }
        const state = game.exportState();
        try { s.peer.destroy(); } catch (e) { /* ignore */ }
        startHost({ role: 'host', peer, quick: s.quick, code: s.code }, state, game);
        return;
      } catch (e) {
        if (e.type !== 'unavailable-id') console.warn('take over failed', e);
      }
    }
    try {
      if (s.peer.destroyed) s.peer = await net.openPeer();
      const { conn, welcome } = await net.joinId(s.peer, roomPeer, profile, game.rejoinInfo());
      if (session !== s) { try { conn.close(); } catch (e) { /* ignore */ } return; }
      startGuest({ peer: s.peer, conn, welcome }, game);
      game.notice('Back in! 🎈');
      return;
    } catch (e) {
      if (e.type !== 'missing' && e.type !== 'timeout') console.warn('rejoin failed', e);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  if (session !== s) return;
  const quick = s.quick;
  endSession();
  showError('Match ended', 'The host left and nobody could take over.' + (quick ? ' Find another match?' : ''), quick);
}

function endSession() {
  const s = session;
  if (!s) return;
  session = null;
  clearInterval(s.watch);
  s.game.destroy();
  if (s.host) s.host.destroy();
  else {
    try { if (s.conn) s.conn.close(); } catch (e) { /* ignore */ }
    setTimeout(() => { try { s.peer.destroy(); } catch (e) { /* ignore */ } }, 200);
  }
}

function leave(findNew) {
  endSession();
  history.replaceState(null, '', location.pathname);
  screen('menu');
  if (findNew === true) go('quick');
}

/* ---------- Buttons ---------- */
$('quick').addEventListener('click', () => go('quick'));
$('create').addEventListener('click', () => go('create'));
$('practice').addEventListener('click', startPractice);
$('join-open').addEventListener('click', () => {
  $('join-form').hidden = !$('join-form').hidden;
  if (!$('join-form').hidden) $('join-code').focus();
});
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('join-code').value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (code.length < 4) { menuError('Type the room code your friend sent you.'); return; }
  go('join', code);
});
$('cancel').addEventListener('click', () => { cancelled = true; screen('menu'); });
$('error-retry').addEventListener('click', () => go('quick'));
$('error-menu').addEventListener('click', () => screen('menu'));
$('copy-link').addEventListener('click', async () => {
  const link = location.origin + location.pathname + location.search;
  try {
    if (navigator.share && mobile) await navigator.share({ title: 'Splash Royale', text: 'Join my Splash Royale room!', url: link });
    else { await navigator.clipboard.writeText(link); $('copy-link').textContent = 'Link copied!'; }
  } catch (e) {
    window.prompt('Copy this link:', link);
  }
  setTimeout(() => { $('copy-link').textContent = 'Copy invite link'; }, 2000);
});
$('mute').textContent = isMuted() ? '🔇' : '🔊';
$('mute').addEventListener('click', () => {
  unlock();
  setMuted(!isMuted());
  $('mute').textContent = isMuted() ? '🔇' : '🔊';
});
document.addEventListener('pointerdown', unlock, { once: true });
// Closing the tab: tell the others right away instead of letting them wait for a timeout.
window.addEventListener('pagehide', () => {
  if (!session) return;
  if (session.host) session.host.destroy();
  else { try { if (session.conn) session.conn.close(); } catch (e) { /* ignore */ } }
});

// Opened from an invite link: get the join box ready.
const params = new URLSearchParams(location.search);
const invite = (params.get('room') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
if (invite) {
  $('join-form').hidden = false;
  $('join-code').value = invite.toUpperCase();
  $('invite-note').hidden = false;
}
if (mobile) document.body.classList.add('touch');

// Keep a copy on the device for instant loading and offline practice.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
