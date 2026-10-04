// Menu, connecting, and the animation loop.

import * as S from './shared.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { createGame, loadStats } from './game.js';
import { Host, cleanName, cleanColor } from './host.js';
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
function loop(t) {
  const dt = Math.min(0.25, (t - last) / 1000);
  last = t;
  if (session) session.game.frame(dt, t / 1000);
  else R.render(dt, t / 1000, false);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---------- Profile ---------- */
let profile = {
  name: cleanName(store.get('name', '')),
  color: cleanColor(store.get('color', S.COLORS[Math.floor(Math.random() * S.COLORS.length)]))
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
    colorsBox.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s === b));
  });
  colorsBox.append(b);
});

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

function startHost(res) {
  let game = null;
  const host = new Host({
    peer: res.peer, quick: res.quick, code: res.code, profile,
    deliverLocal: (m) => { Promise.resolve().then(() => { if (game) game.onMessage(m); }); }
  });
  game = createGame({ render: R, input, send: (m) => host.receive('h', m), myId: 'h', isHost: true, mobile, onLeave: leave });
  session = { game, host, peer: res.peer, quick: res.quick };
  res.peer.on('error', (e) => console.warn('peer error', e && e.type, e));
  if (!res.quick) history.replaceState(null, '', '?room=' + res.code);
}

function startGuest(res) {
  const { peer, conn, welcome } = res;
  let lastHeard = performance.now();
  const game = createGame({
    render: R, input, myId: welcome.id, isHost: false, mobile, onLeave: leave,
    send: (m) => { if (conn.open) { try { conn.send(m); } catch (e) { /* ignore */ } } }
  });
  const s = { game, peer, conn, quick: welcome.quick, code: welcome.code };
  session = s;
  conn.on('data', (m) => {
    lastHeard = performance.now();
    if (m && m.t === 'bye') { lost('The host closed the room.'); return; }
    game.onMessage(m);
  });
  conn.on('close', () => lost('The host left, so the match ended.'));
  peer.on('error', (e) => console.warn('peer error', e && e.type, e));
  s.watch = setInterval(() => {
    if (performance.now() - lastHeard > 12000) lost('Lost the connection to the host.');
  }, 1000);
  if (!welcome.quick) history.replaceState(null, '', '?room=' + welcome.code);

  function lost(text) {
    if (session !== s) return;
    const quick = s.quick;
    endSession();
    showError('Match ended', text + (quick ? ' Find another match?' : ''), quick);
  }
}

function endSession() {
  const s = session;
  if (!s) return;
  session = null;
  clearInterval(s.watch);
  s.game.destroy();
  if (s.host) s.host.destroy();
  else {
    try { s.conn.close(); } catch (e) { /* ignore */ }
    setTimeout(() => { try { s.peer.destroy(); } catch (e) { /* ignore */ } }, 200);
  }
}

function leave() {
  endSession();
  history.replaceState(null, '', location.pathname);
  screen('menu');
}

/* ---------- Buttons ---------- */
$('quick').addEventListener('click', () => go('quick'));
$('create').addEventListener('click', () => go('create'));
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
  else { try { session.conn.close(); } catch (e) { /* ignore */ } }
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
