// One player's view of a room: the lobby, the match, the HUD.
// Messages from the host come in through onMessage(); frame() runs every
// animation frame.

import * as S from './shared.js';
import { sfx, setRain } from './audio.js';

const $ = (id) => document.getElementById(id);
const INTERP = 0.1;           // draw other players this many seconds in the past
const SEND_EVERY = 1 / 20;
const MODE_NAMES = { 1: 'Solo', 2: 'Duos', 4: 'Squads' };
const EMOTES = ['💦', '😂', '😎', '👋', '😭', '🏆'];

export function createGame({ render: R, input, send, myId, isHost, mobile, onLeave }) {
  let phase = 'none';
  let world = null, worldSeed = null, storm = null;
  const ents = new Map();
  const shots = new Map();
  const hostShot = new Map(); // host shot id -> our key
  let lid = 0;
  let clockOff = 0, clockSet = false;
  let sendT = 0, hudT = 0, mapT = 0;
  let aliveCount = 0;
  let spectate = null;
  let roster = [];
  const me = {
    playing: false, alive: false, hp: S.MAX_HP, shield: 0, ammo: [0, 0, 0], weapon: 0, kills: 0, lastFire: -9, place: 0,
    x: 0, y: 0, z: 0, vy: 0, yaw: 0, ground: false, umbrella: false, dashT: 0, dashCd: 0, ddx: 0, ddz: 0
  };
  let lastAim = null;
  let stormNow = {};
  let wasOutside = false;
  let lastAlive = 0;
  let lastStormPhase = -1;
  let lastShrinking = false;
  let destroyed = false;
  let heirs = [];           // who takes over hosting if the host leaves, in order
  let hostId = 'h';
  let roomInfo = { quick: false, code: '' };
  const taken = new Set();
  const crates = new Map();
  let meHidden = false;
  let streak = 0, lastKoT = -99;
  let hinted = false;
  let warm = false;          // running around the island while waiting in the lobby
  let myColor = '#ffffff';
  let myTeam = null;
  let winnerId = null;
  const isMate = (e) => !!e && e.id !== myId && myTeam !== null && myTeam !== undefined && e.team === myTeam;

  const now = () => performance.now() / 1000;
  const matchTime = () => now() + clockOff;

  /* ---------- Map ---------- */
  let mapImg = null;
  function ensureWorld(seed) {
    if (seed === worldSeed) return;
    worldSeed = seed;
    world = S.buildWorld(seed);
    storm = S.buildStorm(seed);
    R.setWorld(world);
    mapImg = drawIslandMap(world);
  }

  /* ---------- Messages from the host ---------- */
  function onMessage(m) {
    if (destroyed || !m) return;
    switch (m.t) {
      case 'lobby': showLobby(m); break;
      case 'start': startMatch(m); break;
      case 'snap': onSnap(m); break;
      case 'pj': onShot(m); break;
      case 'sp': onSplash(m); break;
      case 'ko': onKO(m); break;
      case 'pk': onPickup(m); break;
      case 'crate': onCrate(m); break;
      case 'add': onAdd(m); break;
      case 'crateTaken': onCrateTaken(m); break;
      case 'over': onOver(m); break;
      case 'feed': feed(m.text); break;
      case 'note': centerMsg(m.text, 3); break;
      case 'emote': showEmote(m.id, m.e); break;
      case 'pong': if (!isHost) showPing(Date.now() - m.c); break;
      case 'heirs': heirs = m.l || []; hostId = m.h || hostId; break;
      default:
    }
  }

  /* ---------- Lobby ---------- */
  function showLobby(m) {
    if (phase !== 'lobby') {
      phase = 'lobby';
      clearMatch();
      input.setEnabled(false);
      show('lobby');
      R.setOrbit();
      R.setStorm(null);
      setRain(0);
    }
    ensureWorld(m.seed);
    if (!warm) {
      const mine = m.players.find((p) => p.id === myId);
      if (mine) startWarmup(mine);
    }
    if (m.host) hostId = m.host;
    roomInfo = { quick: m.quick, code: m.code, practice: m.practice, teams: m.teams || 1 };
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('on', +b.dataset.size === roomInfo.teams));
    $('mode-row').hidden = !isHost || m.quick;
    $('mode-label').hidden = m.quick || isHost;
    $('mode-label').textContent = 'Mode: ' + MODE_NAMES[roomInfo.teams];
    $('lobby-title').textContent = m.practice ? 'Practice' : m.quick ? 'Quick Play' : 'Your room';
    $('room-share').hidden = m.quick || m.practice;
    if (!m.quick) $('room-code').textContent = m.code.toUpperCase();
    const list = $('lobby-players');
    list.textContent = '';
    for (const p of m.players) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      li.append(dot, document.createTextNode((p.hat ? S.HATS[p.hat].icon + ' ' : '') + p.name + (p.id === myId ? ' (you)' : '') + (p.id === hostId ? ' ⭐' : '')));
      list.append(li);
    }
    const bots = m.bots ? Math.max(0, m.fill - m.players.length) : (m.players.length < 2 ? 1 : 0);
    if (bots > 0) {
      const li = document.createElement('li');
      li.className = 'bots';
      li.textContent = '+ ' + bots + ' bot' + (bots > 1 ? 's' : '');
      list.append(li);
    }
    let status;
    if (m.cd !== null && m.cd !== undefined) {
      status = 'Match starts in ' + m.cd + 's';
      if (m.cd <= 3 && m.cd > 0) sfx.beep(false);
    } else status = isHost ? (m.practice ? 'Ready when you are!' : 'Press Start when everyone is here.') : 'Waiting for the host to start…';
    $('lobby-status').textContent = status;
    // Quick Play hosts can start early instead of waiting for the countdown.
    $('host-controls').hidden = !isHost;
    $('bots-row').hidden = m.quick || m.practice;
    $('start').textContent = m.quick ? 'Start now' : 'Start match';
    $('bots-toggle').checked = !!m.bots;
  }

  // While waiting: walk, jump, bounce and throw balloons on the next island (just for you).
  function startWarmup(mine) {
    warm = true;
    myColor = mine.color;
    R.addAvatar(myId, mine.color, mine.hat);
    let x = 0, z = 0;
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 30;
      x = Math.cos(a) * r; z = Math.sin(a) * r;
      if (S.onLand(world, x, z) && !S.hitsObstacle(world, x, z, 1, 1.2)) break;
    }
    Object.assign(me, {
      playing: true, alive: true, hp: S.MAX_HP, shield: 0, ammo: [0, 0, 0], weapon: 0, lastFire: -9,
      x, z, y: S.groundHeight(world, x, z), vy: 0, ground: true, umbrella: false, dashT: 0, dashCd: 0
    });
    R.follow(me.x, me.y, me.z, true);
    input.setEnabled(true);
    updateSlots();
  }

  /* ---------- Match ---------- */
  function clearMatch() {
    R.clearAvatars();
    R.clearShots();
    warm = false;
    R.clearCrates();
    crates.clear();
    R.setInBush(false);
    meHidden = false;
    R.setAim(null);
    shots.clear();
    hostShot.clear();
    for (const e of ents.values()) e.label.remove();
    ents.clear();
    me.playing = me.alive = false;
    spectate = null;
    $('feed').textContent = '';
    $('center-msg').textContent = '';
    $('spectating').hidden = true;
    document.body.classList.remove('outside');
  }

  function addEnt(r, tm) {
    const label = document.createElement('div');
    label.className = 'label' + (r.id === myId ? ' me' : '');
    label.innerHTML = '<span class="nm"></span><span class="bar"><i></i></span><span class="emote"></span>';
    label.querySelector('.nm').textContent = r.name;
    $('labels').append(label);
    ents.set(r.id, {
      id: r.id, name: r.name, color: r.color, bot: r.bot, label, buf: [{ t: tm, x: r.x, y: S.DROP_Y, z: r.z, yaw: 0 }],
      x: r.x, y: S.DROP_Y, z: r.z, yaw: 0, hp: S.MAX_HP, alive: true, f: 9, lastHp: S.MAX_HP, emoteT: 0, kills: 0, team: r.team
    });
    if (r.id === myId) myTeam = r.team;
    else if (isMate(ents.get(r.id))) label.classList.add('mate');
    R.addAvatar(r.id, r.color, r.hat);
  }

  // Someone dropped in late (the first seconds of a match).
  function onAdd(m) {
    if (phase !== 'match' || ents.has(m.r.id)) return;
    roster.push(m.r);
    addEnt(m.r, matchTime());
    feed(m.r.name + ' dropped in late ☂️');
  }

  function startMatch(m) {
    clearMatch();
    ensureWorld(m.seed);
    for (const p of world.pickups) R.setPickupTaken(p.i, false);
    taken.clear();
    roster = m.roster.slice();
    const mineR = m.roster.find((r) => r.id === myId);
    myTeam = mineR ? mineR.team : null;
    if (m.quick !== undefined) roomInfo = Object.assign({}, roomInfo, { quick: m.quick, code: m.code });
    if (m.host) hostId = m.host;
    for (const r of m.roster) addEnt(r, m.tm || 0);
    const mine = m.roster.find((r) => r.id === myId);
    if (mine) myColor = mine.color;
    me.playing = !!mine;
    me.alive = me.playing;
    Object.assign(me, { hp: S.MAX_HP, shield: 0, ammo: [0, 0, 0], weapon: 0, kills: 0, lastFire: -9, place: 0, vy: 0, dashT: 0, dashCd: 0, ground: false, umbrella: true });
    if (mine) {
      me.x = mine.x; me.z = mine.z; me.y = S.DROP_Y; me.yaw = Math.atan2(-mine.x, -mine.z);
      R.follow(me.x, me.y, me.z, true);
    }
    lastAlive = m.roster.length;
    lastStormPhase = -1;
    lastShrinking = false;
    clockOff = (m.tm || 0) - now();
    clockSet = true;
    phase = 'match';
    show('hud');
    document.body.classList.toggle('touch', mobile);
    input.setEnabled(me.playing);
    if (me.playing) {
      centerMsg('Float down and grab some water! 🎈', 3);
    } else {
      spectate = null;
      $('spectating').hidden = false;
    }
    updateSlots();
  }

  function onSnap(m) {
    if (phase !== 'match' && phase !== 'over') return;
    const target = m.tm - now();
    if (!clockSet || Math.abs(target - clockOff) > 0.5) { clockOff = target; clockSet = true; } else clockOff += (target - clockOff) * 0.05;
    aliveCount = m.n;
    if (aliveCount !== lastAlive) {
      if (phase === 'match' && me.alive && lastAlive > aliveCount && (aliveCount === 5 || aliveCount === 3 || aliveCount === 2)) {
        centerMsg(aliveCount === 2 ? 'Final two! Splash them! 🔥' : 'Only ' + aliveCount + ' players left!', 2.5);
      }
      lastAlive = aliveCount;
    }
    for (const [id, x, y, z, yaw, hp, f] of m.p) {
      const e = ents.get(id);
      if (!e) continue;
      e.hp = hp;
      e.f = f;
      if (id === myId) {
        me.hp = hp;
        continue;
      }
      e.buf.push({ t: m.tm, x, y, z, yaw });
      if (e.buf.length > 30) e.buf.shift();
      if (!(f & 1)) e.alive = false;
    }
    if (m.me) {
      if (now() - me.lastFire > 0.4) { me.ammo[1] = m.me.a[0]; me.ammo[2] = m.me.a[1]; }
      me.kills = m.me.k;
      me.shield = m.me.s || 0;
      if (me.weapon > 0 && me.ammo[me.weapon] <= 0) me.weapon = 0;
    }
  }

  function onShot(m) {
    if (!world) return;
    if (m.o === myId && m.lid && shots.has('l' + m.lid)) {
      hostShot.set(m.id, 'l' + m.lid);
      return;
    }
    const p = { w: m.w, sx: m.sx, sy: m.sy, sz: m.sz };
    if (m.tx !== undefined) { p.tx = m.tx; p.tz = m.tz; } else { p.dx = m.dx; p.dz = m.dz; }
    S.shotPath(world, p);
    const key = 'h' + m.id;
    const owner = ents.get(m.o);
    shots.set(key, { key, p, t0: m.t0, age: 0, owner: m.o });
    hostShot.set(m.id, key);
    R.addShot(key, m.w, owner ? owner.color : '#ffffff');
    R.avatarThrow(m.o);
    const v = volumeAt(m.sx, m.sz);
    if (m.w === S.W_SOAKER) sfx.squirt(v * 0.6); else sfx.throw(v);
  }

  function endShotVisual(s, x, y, z) {
    const wp = S.WEAPONS[s.p.w];
    const gh = S.groundHeight(world, x, z);
    if (wp.arc) {
      R.splash(x, y, z, wp.splash, gh);
      sfx.splash(volumeAt(x, z), s.p.w === S.W_MEGA);
      if (s.p.w === S.W_MEGA && volumeAt(x, z) > 0.6) R.addShake(0.4);
    } else {
      R.smallSplash(x, y, z);
    }
    R.removeShot(s.key);
    s.splashed = true;
  }

  function onSplash(m) {
    const key = hostShot.get(m.id);
    hostShot.delete(m.id);
    const s = key && shots.get(key);
    if (s && !s.splashed) {
      endShotVisual(s, m.x, m.y, m.z);
    } else if (!s && S.WEAPONS[m.w].arc) {
      R.splash(m.x, m.y, m.z, S.WEAPONS[m.w].splash, S.groundHeight(world, m.x, m.z));
    } else if (s && s.splashed && Math.hypot(s.ex - m.x, s.ez - m.z) > 3 && m.h.length) {
      R.smallSplash(m.x, m.y, m.z);
    }
    if (key) shots.delete(key);
    for (const [id, dmg] of m.h) {
      R.avatarHit(id);
      const e = ents.get(id);
      if (!e) continue;
      if (id === myId) {
        const src = ents.get(m.o);
        if (src && src.id !== myId) hitFrom(src.x - me.x, src.z - me.z);
        vibrate(50);
        sfx.hurt();
        R.addShake(0.35);
        flash();
        floatText(myPos(), '-' + dmg, 'hurt');
      } else if (m.o === myId) {
        sfx.hit();
        floatText(e, '-' + dmg, 'dealt');
      }
    }
  }

  function onKO(m) {
    const e = ents.get(m.v);
    if (!e) return;
    e.alive = false;
    const by = m.by && ents.get(m.by);
    if (by) by.kills++;
    if (m.left) feed(e.name + ' left the match');
    else if (by) feed(by.name + ' 💦 ' + e.name, m.by === myId || m.v === myId);
    else feed(e.name + ' got soaked by the storm ⛈️', m.v === myId);
    const pos = m.v === myId ? myPos() : e;
    if (!m.left) {
      R.splash(pos.x, pos.y + 1, pos.z, 3, S.groundHeight(world, pos.x, pos.z));
    }
    if (m.v === myId) {
      me.alive = false;
      me.place = m.place;
      input.setEnabled(false);
      R.setAim(null);
      sfx.ko();
      vibrate([80, 60, 160]);
      const mate = [...ents.values()].find((o) => isMate(o) && o.alive);
      if (mate) centerMsg('Soaked' + (by ? ' by ' + by.name : '') + '! Your team is still in — cheer them on 📣', 4);
      else centerMsg('Soaked! You placed #' + m.place + (by ? ' — by ' + by.name : ''), 4);
      spectate = mate ? mate.id : by && by.alive ? by.id : null;
      setTimeout(() => { if (phase === 'match') $('spectating').hidden = false; }, 1500);
    } else {
      if (m.by === myId) {
        sfx.koOther();
        const t = now();
        streak = t - lastKoT < 8 ? streak + 1 : 1;
        lastKoT = t;
        const names = ['', '', 'Double splash! 💦💦', 'Triple splash! 💦💦💦', 'Splash-tacular! 🌊', 'Unstoppable tsunami! 🌊🌊'];
        centerMsg(streak > 1 ? names[Math.min(streak, 5)] : 'You soaked ' + e.name + '! 💦', 2.2);
      }
      if (spectate === m.v) spectate = by && by.alive ? by.id : null;
    }
  }

  function onPickup(m) {
    R.setPickupTaken(m.i, true);
    taken.add(m.i);
    if (m.by !== myId || !world) return;
    const p = world.pickups[m.i];
    sfx.pickup();
    if (p.type === S.PICK_TOWEL) floatText(myPos(), '+' + S.TOWEL_HEAL + ' dry', 'heal');
    else if (p.type === S.PICK_SHIELD) floatText(myPos(), '+Bubble shield 🫧', 'heal');
    else {
      const w = p.type === S.PICK_SOAKER ? S.W_SOAKER : S.W_MEGA;
      me.ammo[w] = Math.min(S.WEAPONS[w].max, me.ammo[w] + S.WEAPONS[w].pick);
      me.lastFire = Math.min(me.lastFire, now() - 0.5);
      floatText(myPos(), w === S.W_SOAKER ? '+Soaker' : '+Mega balloon', 'pick');
      if (me.weapon === S.W_BALLOON) me.weapon = w;
    }
    updateSlots();
  }

  function onOver(m) {
    phase = 'over';
    winnerId = m.winner;
    input.setEnabled(false);
    R.setAim(null);
    setRain(0);
    const winner = m.winner && ents.get(m.winner);
    const mine = m.stats.find((s) => s[0] === myId);
    const won = m.winner === myId || (m.team !== null && m.team !== undefined && m.team === myTeam && (roomInfo.teams || 1) > 1);
    const winners = [...ents.values()].filter((e) => m.team !== null && e.team === m.team);
    if (won) sfx.win(); else if (me.playing) sfx.lose();
    if (winner) {
      const wp = winner.id === myId ? me : winner;
      for (let i = 0; i < 4; i++) {
        setTimeout(() => {
          if (destroyed || !world) return;
          const x = wp.x + (Math.random() - 0.5) * 6, z = wp.z + (Math.random() - 0.5) * 6;
          R.splash(x, S.groundHeight(world, x, z) + 3, z, 2.5, S.groundHeight(world, x, z));
        }, i * 280);
      }
      if (winner.id !== myId) spectate = winner.id;
    }
    if (me.playing && mine) saveStats(won, mine[2], mine[1]);
    const winNames = winners.length > 1 ? winners.map((e) => e.name).join(' & ') + ' win' : winner ? winner.name + ' wins' : '';
    $('result-title').textContent = won ? 'Winner winner, splash dinner! 🏆' : winNames ? winNames + '! 🏆' : 'Everyone got soaked!';
    $('result-place').textContent = mine ? (won ? 'Last one dry! ' : 'You placed #' + mine[2] + '. ') + 'Soaked ' + mine[1] + ' player' + (mine[1] === 1 ? '' : 's') + '.' : 'You watched this round.';
    // Everyone, best place first (players still dry when the round was called share the top spots).
    const rows = m.stats.slice().sort((a, b) => (a[2] || 1.5) - (b[2] || 1.5) || b[1] - a[1]);
    const table = $('result-table');
    table.textContent = '';
    rows.forEach((s) => {
      const e = ents.get(s[0]) || { name: '?', color: '#ccc' };
      const tr = document.createElement('tr');
      if (s[0] === myId) tr.className = 'me';
      const place = document.createElement('td');
      place.textContent = s[2] === 1 ? '🏆' : s[2] ? '#' + s[2] : '—';
      const name = document.createElement('td');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = e.color;
      name.append(dot, document.createTextNode(' ' + e.name + (e.bot ? ' 🤖' : '')));
      const k = document.createElement('td');
      k.textContent = s[1] + ' 💦';
      tr.append(place, name, k);
      table.append(tr);
    });
    $('result-stats').textContent = '';
    $('results-new').hidden = !roomInfo.quick;
    setTimeout(() => { if (phase === 'over') show('results'); }, 1800);
  }

  /* ---------- Playing ---------- */
  function tryFire(aim) {
    if (!me.alive || !aim || !(phase === 'match' || (phase === 'lobby' && warm))) return;
    const wp = S.WEAPONS[me.weapon];
    const t = now();
    if (t - me.lastFire < wp.cd) return;
    if (me.weapon > 0 && me.ammo[me.weapon] <= 0) { me.weapon = 0; updateSlots(); return; }
    if (me.umbrella || me.y - S.groundHeight(world, me.x, me.z) > 2.5) return;
    me.lastFire = t;
    if (me.weapon > 0) me.ammo[me.weapon]--;
    const p = shotFrom(aim, me.weapon);
    S.shotPath(world, p);
    const key = 'l' + (++lid);
    shots.set(key, { key, p, t0: matchTime(), age: 0, owner: myId });
    R.addShot(key, p.w, myColor);
    R.avatarThrow(myId);
    if (p.w === S.W_SOAKER) sfx.squirt(); else sfx.throw();
    const msg = { t: 'fire', w: p.w, x: p.sx, z: p.sz, lid };
    if (p.arc) { msg.tx = p.tx; msg.tz = p.tz; } else { msg.dx = p.dx; msg.dz = p.dz; }
    if (phase === 'match') send(msg);
    me.yaw = Math.atan2(aim.x - me.x, aim.z - me.z);
    if (me.weapon > 0 && me.ammo[me.weapon] <= 0) me.weapon = 0;
    updateSlots();
  }

  function shotFrom(aim, w) {
    const wp = S.WEAPONS[w];
    const p = { w, sx: S.r2(me.x), sy: S.r2(me.y + S.HAND_Y), sz: S.r2(me.z) };
    let dx = aim.x - me.x, dz = aim.z - me.z;
    let d = Math.hypot(dx, dz);
    if (d < 0.01) { dx = Math.sin(me.yaw); dz = Math.cos(me.yaw); d = 1; }
    if (wp.arc) {
      const dist = Math.min(wp.range, Math.max(2, d));
      p.tx = S.r2(me.x + dx / d * dist);
      p.tz = S.r2(me.z + dz / d * dist);
    } else {
      p.dx = Math.round(dx / d * 1000) / 1000;
      p.dz = Math.round(dz / d * 1000) / 1000;
    }
    return p;
  }

  // Others in bushes vanish unless they just threw something or you're right next to them.
  // Spectators see everyone.
  function isHidden(e) {
    if (!e.alive || !(me.playing && me.alive) || (e.f & 128) || isMate(e)) return false;
    if (Math.hypot(e.x - me.x, e.z - me.z) < S.SEE_HIDDEN) return false;
    return !!S.inBush(world, e.x, e.z);
  }

  function onCrate(m) {
    if (!world) return;
    crates.set(m.id, m);
    R.addCrate(m.id, m.x, m.z, S.groundHeight(world, m.x, m.z));
    centerMsg('📦 A supply drop is falling! Check the map', 3);
    feed('📦 Supply drop incoming!');
    sfx.beep(true);
  }

  function onCrateTaken(m) {
    crates.delete(m.id);
    R.removeCrate(m.id);
    const e = ents.get(m.by);
    if (m.by === myId) {
      sfx.win();
      floatText(myPos(), '🌟 Golden loot!', 'pick');
      me.lastFire = Math.min(me.lastFire, now() - 0.5);
      updateSlots();
    } else if (e) feed(e.name + ' grabbed the supply drop 📦');
  }

  function nearestEnemy(range) {
    let best = null, bd = range;
    for (const e of ents.values()) {
      if (e.id === myId || !e.alive || e.hidden || isMate(e)) continue;
      const d = Math.hypot(e.x - me.x, e.z - me.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function setWeapon(w) {
    if (w > 0 && me.ammo[w] <= 0) return;
    if (me.weapon !== w) sfx.click();
    me.weapon = w;
    updateSlots();
  }

  function cycleWeapon(dir) {
    for (let i = 1; i <= 3; i++) {
      const w = (me.weapon + (dir || 1) * i + 3) % 3;
      if (w === 0 || me.ammo[w] > 0) { setWeapon(w); return; }
    }
  }

  function stepMe(dt) {
    let jump = false, dash = false;
    for (const ev of input.take()) {
      if (ev.type === 'jump') jump = true;
      else if (ev.type === 'dash') dash = true;
      else if (ev.type === 'weapon') setWeapon(ev.w);
      else if (ev.type === 'cycle') cycleWeapon(ev.dir);
      else if (ev.type === 'emote') emote(EMOTES[0]);
      else if (ev.type === 'release') {
        if (ev.tap) {
          const e = nearestEnemy(S.WEAPONS[me.weapon].range + 2);
          if (e) tryFire({ x: e.x, z: e.z });
          else tryFire({ x: me.x + Math.sin(me.yaw) * 10, z: me.z + Math.cos(me.yaw) * 10 });
        } else if (lastAim && S.WEAPONS[me.weapon].arc) {
          tryFire(lastAim);
        }
      }
    }
    if (jump && me.ground) sfx.jump();
    if (dash && me.dashCd <= 0 && !me.umbrella) sfx.dash();
    const mv = input.move();
    // Small steps, so slow phones move at the same speed as fast computers.
    const steps = Math.ceil(dt / 0.034);
    for (let i = 0; i < steps; i++) {
      S.movePlayer(world, me, { mx: mv.x, mz: mv.z, jump: jump && i === 0, dash: dash && i === 0 }, dt / steps);
    }
    const moving = Math.hypot(mv.x, mv.z) > 0.1;
    if (me.bounced) { me.bounced = false; sfx.boing(); }

    // Aim: the mouse on computers, the right stick on phones.
    let aim = null;
    const stick = input.aimStick();
    if (stick) {
      if (stick.len > 0.15) {
        const range = S.WEAPONS[me.weapon].range;
        const dist = S.WEAPONS[me.weapon].arc ? Math.max(3, range * stick.len) : range;
        aim = { x: me.x + stick.x / stick.len * dist, z: me.z + stick.y / stick.len * dist };
      }
    } else if (!mobile && input.mouse.seen) {
      aim = R.groundAt(input.mouse.x, input.mouse.y, me.y);
    }
    lastAim = aim;
    if (aim) me.yaw = Math.atan2(aim.x - me.x, aim.z - me.z);
    else if (moving) me.yaw = Math.atan2(mv.x, mv.z);

    if (!mobile && input.mouse.down) tryFire(aim);
    if (stick && stick.len > 0.35 && me.weapon === S.W_SOAKER) tryFire(aim);

    const canAim = aim && !me.umbrella && (stick ? stick.len > 0.15 : true);
    R.setAim(canAim ? { p: S.shotPath(world, shotFrom(aim, me.weapon)) } : null, world);

    me.moving = moving;
    sendT += dt;
    if (sendT >= SEND_EVERY) {
      sendT = 0;
      const f = (me.dashT > 0 ? 2 : 0) | (moving ? 4 : 0) | (me.umbrella ? 8 : 0) | (me.weapon << 4);
      if (phase === 'match') send({ t: 'st', x: S.r2(me.x), y: S.r2(me.y), z: S.r2(me.z), yaw: S.r2(me.yaw), f });
    }
  }

  function interp(e, t) {
    const b = e.buf;
    if (!b.length) return;
    if (t <= b[0].t) { Object.assign(e, { x: b[0].x, y: b[0].y, z: b[0].z, yaw: b[0].yaw }); return; }
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i].t <= t) {
        const a = b[i], c = b[i + 1];
        if (!c) { Object.assign(e, { x: a.x, y: a.y, z: a.z, yaw: a.yaw }); return; }
        const f = (t - a.t) / Math.max(1e-6, c.t - a.t);
        e.x = S.lerp(a.x, c.x, f); e.y = S.lerp(a.y, c.y, f); e.z = S.lerp(a.z, c.z, f);
        let dy = c.yaw - a.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        e.yaw = a.yaw + dy * f;
        return;
      }
    }
  }

  const tmpPos = { x: 0, y: 0, z: 0 };
  function stepShots(t, dt) {
    for (const s of shots.values()) {
      if (s.splashed) { if (t - s.t0 > 3) shots.delete(s.key); continue; }
      const age = Math.max(0, t - s.t0);
      const hit = S.shotHitsWorld(world, s.p, s.age, age, tmpPos);
      s.age = age;
      if (hit >= 0 || hit === -2) {
        s.ex = tmpPos.x; s.ez = tmpPos.z;
        if (hit === -2) { R.removeShot(s.key); s.splashed = true; } else endShotVisual(s, tmpPos.x, tmpPos.y, tmpPos.z);
        continue;
      }
      S.shotPos(s.p, age, tmpPos);
      // Droplets stop when they reach someone (the host decides the damage).
      if (!s.p.arc) {
        for (const e of ents.values()) {
          if (!e.alive || e.id === s.owner) continue;
          const ex = e.id === myId ? me.x : e.x, ez = e.id === myId ? me.z : e.z, ey = e.id === myId ? me.y : e.y;
          if (Math.hypot(ex - tmpPos.x, ez - tmpPos.z) < S.PLAYER_R + 0.2 && tmpPos.y > ey && tmpPos.y < ey + S.PLAYER_H) {
            s.ex = tmpPos.x; s.ez = tmpPos.z;
            endShotVisual(s, tmpPos.x, tmpPos.y, tmpPos.z);
            break;
          }
        }
        if (s.splashed) continue;
      }
      R.moveShot(s.key, tmpPos.x, tmpPos.y, tmpPos.z, S.groundHeight(world, tmpPos.x, tmpPos.z), dt);
      if (age > (s.p.arc ? s.p.T : s.p.life) + 1.5) { R.removeShot(s.key); shots.delete(s.key); }
    }
  }

  function myPos() { return { x: me.x, y: me.y, z: me.z }; }

  function frame(dt, time) {
    if (destroyed) return;
    if (phase === 'lobby' && warm) {
      stepMe(dt);
      R.updateAvatar(myId, {
        x: me.x, y: me.y, z: me.z, yaw: me.yaw, moving: me.moving, dash: me.dashT > 0, alive: true,
        hp: S.MAX_HP, umbrella: false, weapon: me.weapon
      }, dt, S.groundHeight(world, me.x, me.z));
      stepShots(matchTime(), dt);
      R.follow(me.x, me.y, me.z);
      R.render(dt, time, false);
      return;
    }
    if (phase !== 'match' && phase !== 'over') { R.render(dt, time, false); return; }

    const t = matchTime();
    if (me.playing && me.alive && phase === 'match') stepMe(dt);
    else input.take();

    // Draw everyone.
    const rt = t - INTERP;
    for (const e of ents.values()) {
      if (e.id === myId && me.playing) {
        e.x = me.x; e.y = me.y; e.z = me.z; e.yaw = me.yaw;
        if (!me.alive) e.alive = false;
        R.updateAvatar(e.id, {
          x: me.x, y: me.y + (phase === 'over' && winnerId === myId ? Math.abs(Math.sin(time * 5)) * 1.2 : 0), z: me.z, yaw: me.yaw, moving: me.moving, dash: me.dashT > 0, alive: me.alive,
          hp: me.hp, umbrella: me.umbrella, weapon: me.weapon, shield: me.shield > 0
        }, dt, S.groundHeight(world, me.x, me.z));
      } else {
        const px = e.x, pz = e.z;
        interp(e, rt);
        // The winner does a little victory hop.
        if (phase === 'over' && e.id === winnerId && e.alive) e.y += Math.abs(Math.sin(time * 5)) * 1.2;
        const moving = Math.hypot(e.x - px, e.z - pz) > dt * 1.5;
        e.hidden = isHidden(e);
        R.updateAvatar(e.id, {
          x: e.x, y: e.y, z: e.z, yaw: e.yaw, moving, dash: !!(e.f & 2), alive: e.alive, hp: e.hp,
          umbrella: !!(e.f & 8), weapon: (e.f >> 4) & 3, shield: !!(e.f & 64), hidden: e.hidden
        }, dt, S.groundHeight(world, e.x, e.z));
      }
    }
    stepShots(t, dt);

    // Hiding in a bush.
    const hiddenNow = me.playing && me.alive && !!S.inBush(world, me.x, me.z) && now() - me.lastFire > S.HIDE_AFTER;
    if (hiddenNow !== meHidden) {
      meHidden = hiddenNow;
      R.setInBush(hiddenNow);
      $('hidden-pill').hidden = !hiddenNow;
    }

    // First match on this device: a quick reminder of the controls once you land.
    if (!hinted && me.alive && t > S.DROP_TIME + 1 && !me.umbrella) {
      hinted = true;
      let seen = false;
      try { seen = localStorage.getItem('sr-hinted') === '1'; localStorage.setItem('sr-hinted', '1'); } catch (e) { /* ignore */ }
      if (!seen) {
        centerMsg(mobile ? 'Left thumb: walk · Right thumb: aim, let go to throw · Tap right: quick throw'
          : 'WASD: walk · Mouse: aim · Click: throw · Space: jump · Shift: dash', 6);
      }
    }

    // Supply drops falling.
    for (const c of crates.values()) R.updateCrate(c.id, 1 - (c.land - t) / S.CRATE_FALL, time);

    // Storm.
    S.stormAt(storm, Math.max(0, t), stormNow);
    R.setStorm(stormNow);
    if (t > S.DROP_TIME && stormNow.shrinking !== lastShrinking) {
      lastShrinking = stormNow.shrinking;
      if (stormNow.shrinking && phase === 'match') { centerMsg('The storm is closing in! ⛈️', 2.5); sfx.beep(true); }
    }
    if (t > S.DROP_TIME && stormNow.phase !== lastStormPhase && !stormNow.shrinking) {
      if (lastStormPhase >= 0 && phase === 'match' && stormNow.phase < storm.phases.length) feed('New safe zone on the map ⭕');
      lastStormPhase = stormNow.phase;
    }
    let outside = false;
    if (me.playing && me.alive) outside = Math.hypot(me.x - stormNow.x, me.z - stormNow.z) > stormNow.r;
    if (outside !== wasOutside) {
      wasOutside = outside;
      document.body.classList.toggle('outside', outside);
      setRain(outside ? 1 : 0);
      if (outside) centerMsg('You\'re in the storm! Get inside the circle ⛈️', 2);
    }

    // Camera.
    if (me.playing && me.alive) R.follow(me.x, me.y, me.z);
    else {
      let target = spectate && ents.get(spectate);
      if (!target || !target.alive) {
        target = [...ents.values()].find((e) => e.alive && e.id !== myId) || null;
        spectate = target ? target.id : null;
      }
      if (target) {
        R.follow(target.x, target.y, target.z);
        $('spectating-name').textContent = target.name;
      } else if (me.playing) R.follow(me.x, me.y, me.z);
    }

    R.render(dt, time, outside);
    updateLabels(dt);
    hudT += dt;
    if (hudT > 0.1) { hudT = 0; updateHud(t); }
    mapT += dt;
    if (mapT > 0.1) { mapT = 0; drawMinimap(); }
  }

  /* ---------- HUD ---------- */
  function show(which) {
    $('lobby').hidden = which !== 'lobby';
    $('hud').hidden = which !== 'hud' && which !== 'results' && which !== 'lobby';
    $('results').hidden = which !== 'results';
    document.body.classList.toggle('warmup', which === 'lobby');
    $('touch-layer').hidden = !(mobile && (which === 'hud' || which === 'lobby'));
  }

  function updateHud(t) {
    $('alive').textContent = '👥 ' + aliveCount;
    $('kills').textContent = '💦 ' + me.kills;
    const hp = Math.max(0, Math.round(me.hp));
    $('hp-fill').style.width = hp + '%';
    $('hp-shield').style.width = Math.min(100, (me.shield / S.SHIELD_MAX) * 100) + '%';
    $('hp-fill').classList.toggle('low', hp < 35);
    $('hp-text').textContent = me.playing ? 'Dryness ' + hp + (me.shield > 0 ? ' + 🫧' + Math.ceil(me.shield) : '') : 'Spectating';
    let txt;
    if (t < S.DROP_TIME) txt = '☂️ Floating down…';
    else if (stormNow.phase >= storm.phases.length) txt = '⛈️ Final storm!';
    else if (stormNow.shrinking) txt = '⛈️ Storm closing in ' + clock(stormNow.until);
    else txt = '⛈️ Storm moves in ' + clock(stormNow.until);
    $('storm-timer').textContent = txt;
    $('storm-timer').classList.toggle('urgent', stormNow.shrinking);
    updateSlots();
  }

  function updateSlots() {
    document.querySelectorAll('.slot').forEach((el) => {
      const w = +el.dataset.w;
      el.classList.toggle('active', me.weapon === w);
      el.classList.toggle('empty', w > 0 && me.ammo[w] <= 0);
      el.querySelector('.ammo').textContent = w === 0 ? '∞' : me.ammo[w];
    });
  }

  function updateLabels(dt) {
    for (const e of ents.values()) {
      const el = e.label;
      const alive = e.id === myId ? me.alive : e.alive;
      const pos = e.id === myId ? me : e;
      const p = alive && !e.hidden ? R.toScreen(pos.x, pos.y + 2.9, pos.z) : null;
      if (e.emoteT > 0) e.emoteT -= dt;
      if (!p || p.x < -50 || p.y < -50 || p.x > innerWidth + 50 || p.y > innerHeight + 50) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      const hp = e.id === myId ? me.hp : e.hp;
      if (hp !== e.lastHp) {
        e.lastHp = hp;
        el.querySelector('i').style.width = Math.max(0, hp) + '%';
      }
      el.classList.toggle('talking', e.emoteT > 0);
    }
  }

  function showEmote(id, text) {
    const e = ents.get(id);
    if (!e || EMOTES.indexOf(text) === -1) return;
    e.label.querySelector('.emote').textContent = text;
    e.emoteT = 2.2;
  }

  let lastEmote = 0;
  function emote(text) {
    if (now() - lastEmote < 1) return;
    lastEmote = now();
    send({ t: 'chat', text });
  }

  function feed(text, mine) {
    const el = document.createElement('div');
    el.className = 'feed-item' + (mine ? ' mine' : '');
    el.textContent = text;
    const box = $('feed');
    box.prepend(el);
    while (box.children.length > 5) box.lastChild.remove();
    setTimeout(() => el.classList.add('fade'), 5000);
    setTimeout(() => el.remove(), 6000);
  }

  let msgTimer = null;
  function centerMsg(text, secs) {
    const el = $('center-msg');
    el.textContent = text;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { el.textContent = ''; }, (secs || 2.5) * 1000);
  }

  function floatText(pos, text, kind) {
    const p = R.toScreen(pos.x, pos.y + 2.4, pos.z);
    if (!p) return;
    const el = document.createElement('div');
    el.className = 'float ' + kind;
    el.textContent = text;
    el.style.left = (p.x + (Math.random() - 0.5) * 30) + 'px';
    el.style.top = p.y + 'px';
    $('labels').append(el);
    setTimeout(() => el.remove(), 1000);
  }

  // A red wedge at the edge of the screen pointing to whoever splashed you.
  function hitFrom(dx, dz) {
    const el = document.createElement('div');
    el.className = 'hit-dir';
    el.style.transform = 'rotate(' + Math.atan2(dx, -dz) + 'rad)';
    $('hit-dirs').append(el);
    setTimeout(() => el.remove(), 900);
  }

  function showPing(ms) {
    const el = $('ping');
    el.hidden = false;
    el.textContent = '📶 ' + ms + 'ms';
    el.classList.toggle('bad', ms > 200);
  }

  function vibrate(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ }
  }

  function flash() {
    const el = $('hit-vignette');
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  function volumeAt(x, z) {
    const c = me.playing && me.alive ? me : (spectate && ents.get(spectate)) || me;
    const d = Math.hypot(x - c.x, z - c.z);
    return Math.max(0, Math.min(1, 1.1 - d / 45));
  }

  /* ---------- Minimap ---------- */
  const mapCanvas = $('minimap');
  const mctx = mapCanvas.getContext('2d');
  const MAP_SPAN = 260;
  const toMap = (v) => (v / MAP_SPAN + 0.5) * mapCanvas.width;

  function drawMinimap() {
    if (!mapImg) return;
    const W = mapCanvas.width;
    mctx.clearRect(0, 0, W, W);
    mctx.drawImage(mapImg, 0, 0, W, W);
    const st = stormNow;
    mctx.save();
    mctx.beginPath();
    mctx.rect(0, 0, W, W);
    mctx.arc(toMap(st.x), toMap(st.z), Math.max(0, st.r / MAP_SPAN * W), 0, Math.PI * 2, true);
    mctx.fillStyle = 'rgba(90,70,190,0.5)';
    mctx.fill('evenodd');
    mctx.restore();
    if (st.nr < st.r - 0.5) {
      mctx.beginPath();
      mctx.arc(toMap(st.nx), toMap(st.nz), Math.max(1, st.nr / MAP_SPAN * W), 0, Math.PI * 2);
      mctx.strokeStyle = '#ffffff';
      mctx.lineWidth = 1.5;
      mctx.stroke();
    }
    for (const e of ents.values()) {
      if (!isMate(e) || !e.alive) continue;
      mctx.beginPath();
      mctx.arc(toMap(e.x), toMap(e.z), 4, 0, Math.PI * 2);
      mctx.fillStyle = e.color;
      mctx.strokeStyle = '#ffffff';
      mctx.lineWidth = 1.5;
      mctx.fill(); mctx.stroke();
    }
    for (const cr of crates.values()) {
      const x = toMap(cr.x), y = toMap(cr.z);
      mctx.fillStyle = '#ffd84d';
      mctx.strokeStyle = '#2b2340';
      mctx.lineWidth = 1.5;
      mctx.fillRect(x - 4, y - 4, 8, 8);
      mctx.strokeRect(x - 4, y - 4, 8, 8);
    }
    const c = me.playing && me.alive ? me : (spectate && ents.get(spectate));
    if (c) {
      const x = toMap(c.x), y = toMap(c.z);
      mctx.save();
      mctx.translate(x, y);
      mctx.rotate(-(c.yaw || 0) + Math.PI);
      mctx.beginPath();
      mctx.moveTo(0, -6); mctx.lineTo(4.5, 4.5); mctx.lineTo(0, 2.5); mctx.lineTo(-4.5, 4.5); mctx.closePath();
      mctx.fillStyle = '#ffffff';
      mctx.strokeStyle = '#2b2340';
      mctx.lineWidth = 1.5;
      mctx.fill(); mctx.stroke();
      mctx.restore();
    }
  }

  // "Still here" for the host. A timer rather than the animation loop, which
  // browsers pause in background tabs (so switching apps doesn't get you kicked).
  const pinger = setInterval(() => { if (!destroyed) send({ t: 'ping', c: Date.now() }); }, 2000);

  /* ---------- Buttons ---------- */
  const handlers = [];
  const on = (el, ev, fn) => { el.addEventListener(ev, fn); handlers.push([el, ev, fn]); };
  document.querySelectorAll('.slot').forEach((el) => {
    on(el, 'click', () => { if (me.alive) setWeapon(+el.dataset.w); });
  });
  document.querySelectorAll('#emotes button').forEach((el) => on(el, 'click', () => emote(el.textContent)));
  on($('t-jump'), 'touchstart', (e) => { e.preventDefault(); input.push({ type: 'jump' }); });
  on($('t-dash'), 'touchstart', (e) => { e.preventDefault(); input.push({ type: 'dash' }); });
  on($('t-swap'), 'touchstart', (e) => { e.preventDefault(); input.push({ type: 'cycle' }); });
  on($('spectate-next'), 'click', () => {
    const alive = [...ents.values()].filter((e) => e.alive && e.id !== myId);
    if (!alive.length) return;
    const i = alive.findIndex((e) => e.id === spectate);
    spectate = alive[(i + 1) % alive.length].id;
  });
  on($('start'), 'click', () => { sfx.click(); send({ t: 'start' }); });
  on($('bots-toggle'), 'change', (e) => send({ t: 'bots', on: e.target.checked }));
  document.querySelectorAll('.mode-btn').forEach((b) => on(b, 'click', () => { sfx.click(); send({ t: 'teams', size: +b.dataset.size }); }));
  on($('leave-lobby'), 'click', () => onLeave());
  on($('leave-match'), 'click', () => { if (!me.alive || phase !== 'match' || confirm('Leave this match?')) onLeave(); });
  on($('results-leave'), 'click', () => onLeave());
  on($('results-new'), 'click', () => onLeave(true));

  function destroy() {
    destroyed = true;
    clearInterval(pinger);
    clearMatch();
    input.setEnabled(false);
    setRain(0);
    for (const [el, ev, fn] of handlers) el.removeEventListener(ev, fn);
    $('lobby').hidden = $('hud').hidden = $('results').hidden = true;
    $('touch-layer').hidden = true;
    R.setStorm(null);
    R.setOrbit();
  }

  // Everything a new host needs to carry on the match if the old one leaves.
  function exportState() {
    const list = [...ents.values()].map((e) => {
      const last = e.buf[e.buf.length - 1] || e;
      const s = e.id === myId && me.playing ? me : last;
      return { id: e.id, x: s.x, y: s.y, z: s.z, yaw: s.yaw || 0, hp: e.id === myId ? me.hp : e.hp, alive: e.id === myId ? me.alive : e.alive, kills: e.kills || 0 };
    });
    return {
      phase: phase === 'none' ? 'lobby' : phase, seed: worldSeed, tm: matchTime(), roster, ents: list,
      taken: [...taken], myAmmo: [me.ammo[1], me.ammo[2]], quick: roomInfo.quick, code: roomInfo.code, oldHost: hostId, heirs: heirs.slice(), teams: roomInfo.teams || 1
    };
  }

  return {
    onMessage, frame, destroy, exportState,
    heirs: () => heirs.slice(),
    hostId: () => hostId,
    myId: () => myId,
    rejoinInfo: () => ({ rejoin: myId, ammo: [me.ammo[1], me.ammo[2]] }),
    // Point messages at a new host (or at our own host after taking over).
    relink(sendFn, nowHost) { send = sendFn; if (nowHost) { isHost = true; hostId = myId; } },
    // The new host didn't know us: start over as a newcomer with a new id.
    reset(newId) { myId = newId; phase = 'none'; clearMatch(); },
    notice(text) { centerMsg(text, 3); }
  };
}

// Your own record, kept on this device.
export function loadStats() {
  try { return Object.assign({ games: 0, wins: 0, best: 0, splashes: 0 }, JSON.parse(localStorage.getItem('sr-stats') || '{}')); } catch (e) { return { games: 0, wins: 0, best: 0, splashes: 0 }; }
}

function saveStats(won, place, kills) {
  const s = loadStats();
  s.games++;
  if (won) s.wins++;
  if (place > 0 && (!s.best || place < s.best)) s.best = place;
  s.splashes += kills;
  try { localStorage.setItem('sr-stats', JSON.stringify(s)); } catch (e) { /* ignore */ }
}

function clock(s) {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function drawIslandMap(w) {
  const N = 130;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const pal = {
    sunny: [[246, 223, 160], [124, 204, 92], [94, 165, 72]],
    autumn: [[240, 210, 154], [198, 194, 90], [168, 160, 67]],
    snowy: [[238, 243, 250], [247, 251, 255], [221, 232, 245]],
    candy: [[255, 227, 240], [201, 179, 255], [255, 156, 207]]
  }[w.theme] || [[246, 223, 160], [124, 204, 92], [94, 165, 72]];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i / N - 0.5) * 260, z = (j / N - 0.5) * 260;
      const h = S.groundHeight(w, x, z);
      const col = h < -0.3 ? [63, 178, 222] : h < 0.15 ? [120, 210, 230] : h < 0.6 ? pal[0] : h > 3 ? pal[2] : pal[1];
      const o = (j * N + i) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = 'rgba(40,110,50,0.8)';
  for (const b of w.bushes) {
    g.beginPath();
    g.arc(b.x / 260 * N + N / 2, b.z / 260 * N + N / 2, Math.max(1, b.r / 260 * N), 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(110,90,80,0.9)';
  for (const o of w.obstacles) {
    if (o.k !== 'house') continue;
    g.fillRect((o.x - o.hw) / 260 * N + N / 2, (o.z - o.hd) / 260 * N + N / 2, o.hw * 2 / 260 * N, o.hd * 2 / 260 * N);
  }
  return c;
}
