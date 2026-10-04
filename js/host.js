// The host runs the match: it decides who got splashed, owns the storm,
// the pickups and the bots, and sends everyone a snapshot 15 times a second.
// Each player moves their own character (so it feels instant) and tells the
// host where they are.

import * as S from './shared.js';

const TICK = 1 / 30;
const SNAP_EVERY = 1 / 15;
const QUICK_WAIT = 20;      // seconds a public island waits for players
const QUICK_MIN_WAIT = 8;
const OVER_WAIT = 9;
const TIMEOUT_MS = 10000;
const LATE_JOIN = 25;       // players arriving this early into a match still get to play   // a player we haven't heard from for this long has left

// Timers in hidden tabs get slowed to once a second; a worker's don't, so the
// match keeps running if the host switches tabs.
function makeTicker(fn) {
  try {
    const src = 'setInterval(function(){postMessage(0)},' + Math.round(TICK * 1000) + ')';
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = fn;
    return () => worker.terminate();
  } catch (e) {
    const id = setInterval(fn, TICK * 1000);
    return () => clearInterval(id);
  }
}

export class Host {
  // takeover: state from the old host's last snapshot, when a player inherits the room.
  constructor({ peer, quick, code, practice, profile, deliverLocal, localId, takeover }) {
    this.peer = peer;
    this.quick = quick;
    this.code = code;
    this.practice = !!practice;
    this.deliverLocal = deliverLocal;
    this.localId = localId || 'h';
    this.members = new Map();   // everyone in the room: id -> { id, name, color, conn, lastHeard, spectator }
    this.ents = new Map();      // everyone in the current match, bots included
    this.phase = 'lobby';
    this.bots = true;
    this.teamSize = 1;          // 1 solo, 2 duos, 4 squads
    this.nextId = 1;
    this.projId = 0;
    this.tm = 0;
    this.last = performance.now();
    this.snapT = 0;
    this.lobbyT = 0;
    this.countdownEnd = 0;
    this.nextSeed = this.newSeed();
    this.heirT = 0;
    this.expect = new Map();     // players of the old host we're waiting to reconnect: id -> deadline
    this.members.set(this.localId, { id: this.localId, name: profile.name, color: profile.color, hat: cleanHat(profile.hat), conn: null, lastHeard: Infinity });
    peer.on('connection', (c) => this.onConnection(c));
    this.stopTicker = makeTicker(() => this.tick());
    if (takeover) this.takeOver(takeover);
    else this.enterLobby();
  }

  // Carry on where the old host left off.
  takeOver(st) {
    const now = performance.now();
    let maxId = 0;
    const people = (st.roster || []).filter((r) => !r.bot).map((r) => r.id).concat(st.heirs || []);
    for (const id of people) {
      const n = /^p(\d+)$/.exec(id);
      if (n) maxId = Math.max(maxId, +n[1]);
      if (id !== this.localId && id !== st.oldHost) this.expect.set(id, now + 15000);
    }
    this.nextId = maxId + 1;
    this.teamSize = st.teams || 1;
    if (st.phase === 'lobby' || !st.seed || !st.roster) {
      this.enterLobby();
      return;
    }
    this.seed = st.seed;
    this.nextSeed = st.seed;
    this.world = S.buildWorld(st.seed);
    this.storm = S.buildStorm(st.seed);
    this.tm = st.tm;
    this.taken = new Set(st.taken || []);
    this.crates = (st.crates || []).map((c) => Object.assign({ taken: false }, c));
    this.cratesSent = S.CRATE_TIMES.filter((t) => t <= st.tm).length;
    this.projs = [];
    this.humanlessT = 0;
    this.roster = st.roster;
    const byId = new Map(st.ents.map((e) => [e.id, e]));
    for (const r of st.roster) {
      const s = byId.get(r.id) || { x: r.x, y: 0, z: r.z, hp: 0, alive: false, kills: 0 };
      const e = this.makeEnt(r, s.x, s.z);
      Object.assign(e, { y: s.y, yaw: s.yaw || 0, hp: s.hp, alive: s.alive, kills: s.kills || 0, umbrella: false, ground: true });
      if (r.id === this.localId) e.ammo = [0, st.myAmmo[0] | 0, st.myAmmo[1] | 0];
      if (r.bot) e.ammo = [0, 20, 0];
      if (!e.alive) e.place = 0;
      this.ents.set(r.id, e);
    }
    // The old host is gone for good.
    for (const e of this.ents.values()) {
      if (!e.bot && e.id !== this.localId && !this.expect.has(e.id) && e.alive) this.knockOut(e, null, true);
    }
    this.phase = st.phase === 'over' ? 'over' : 'match';
    this.overEnd = now + 3000;
    for (const e of this.ents.values()) if (!e.alive && !e.place) e.place = this.ents.size;
  }

  makeEnt(p, x, z) {
    return {
      id: p.id, name: p.name, color: p.color, hat: p.hat || 0, bot: p.bot, team: p.team === undefined ? p.id : p.team,
      x, z, y: S.DROP_Y, vy: 0, yaw: Math.atan2(-x, -z), ground: false, umbrella: true,
      dashT: 0, dashCd: 0, ddx: 0, ddz: 0,
      hp: S.MAX_HP, shield: 0, alive: true, ammo: [0, 0, 0], lastFire: -9, kills: 0, place: 0, f: 0,
      px: x, pz: z, vx: 0, vz: 0,
      ai: p.bot ? newBrain() : null
    };
  }

  newSeed() { return (Math.random() * 2147483647) | 0; }

  fillTo() { return this.teamSize === 4 ? 12 : S.FILL_TO; }

  destroy() {
    this.dead = true;
    this.stopTicker();
    for (const m of this.members.values()) {
      if (m.conn) { try { m.conn.send({ t: 'bye' }); } catch (e) { /* ignore */ } }
    }
    setTimeout(() => { try { this.peer.destroy(); } catch (e) { /* ignore */ } }, 300);
  }

  /* ---------- Talking to players ---------- */

  sendTo(m, msg) {
    if (!m) return;
    if (m.id === this.localId) { this.deliverLocal(msg); return; }
    if (m.conn && m.conn.open) { try { m.conn.send(msg); } catch (e) { /* ignore */ } }
  }

  broadcast(msg) {
    for (const m of this.members.values()) this.sendTo(m, msg);
  }

  onConnection(c) {
    // Closing down: don't take anyone in, or they'd reconnect to a host that's about to vanish.
    if (this.dead) { setTimeout(() => { try { c.close(); } catch (e) { /* ignore */ } }, 50); return; }
    let id = null;
    c.on('data', (msg) => {
      if (!msg || typeof msg !== 'object' || this.dead) return;
      if (!id) {
        if (msg.t !== 'hi') return;
        const humans = this.members.size;
        // Quick Play looks for a match to play, not one to watch: send them to another island.
        const busy = this.phase === 'over' || (this.phase === 'match' && (this.tm >= LATE_JOIN || this.practice));
        if (msg.avoidBusy && busy && !msg.rejoin) {
          try { c.send({ t: 'full', busy: true }); } catch (e) { /* ignore */ }
          setTimeout(() => { try { c.close(); } catch (e) { /* ignore */ } }, 500);
          return;
        }
        if (humans >= S.MAX_HUMANS) {
          try { c.send({ t: 'full' }); } catch (e) { /* ignore */ }
          setTimeout(() => { try { c.close(); } catch (e) { /* ignore */ } }, 500);
          return;
        }
        // Someone from before the old host left: give them their old place back.
        const back = msg.rejoin && this.expect.has(msg.rejoin) && !this.members.has(msg.rejoin) ? msg.rejoin : null;
        id = back || 'p' + this.nextId++;
        const m = {
          id, conn: c, lastHeard: performance.now(),
          name: cleanName(msg.name), color: cleanColor(msg.color), hat: cleanHat(msg.hat),
          spectator: this.phase !== 'lobby' && !(back && this.ents.has(back))
        };
        this.members.set(id, m);
        c.send({ t: 'welcome', id, quick: this.quick, code: this.code, resume: !!back });
        if (back) {
          this.expect.delete(back);
          const e = this.ents.get(back);
          if (e && Array.isArray(msg.ammo)) {
            e.ammo[1] = Math.min(S.WEAPONS[1].max, Math.max(0, msg.ammo[0] | 0));
            e.ammo[2] = Math.min(S.WEAPONS[2].max, Math.max(0, msg.ammo[1] | 0));
          }
          this.sendHeirs();
          if (this.phase === 'lobby') this.sendLobby();
          return;
        }
        this.joined(m);
        return;
      }
      this.receive(id, msg);
    });
    c.on('close', () => { if (id) this.leave(id); });
    c.on('error', () => { if (id) this.leave(id); });
  }

  joined(m) {
    if (this.phase === 'lobby') {
      if (this.quick && this.countdownEnd) {
        this.countdownEnd = Math.max(this.countdownEnd, performance.now() + QUICK_MIN_WAIT * 1000);
      }
      this.sendLobby();
    } else if (this.phase === 'match' && this.tm < LATE_JOIN && !this.practice) {
      // Just started: drop them in too.
      const p = { id: m.id, name: m.name, color: m.color, hat: m.hat, bot: false, team: 1000 + this.nextId };
      const [x, z] = pointNear(this.world, 0, 0, S.ISLAND_R * 0.6);
      p.x = S.r2(x); p.z = S.r2(z);
      this.roster.push(p);
      this.ents.set(m.id, this.makeEnt(p, x, z));
      m.spectator = false;
      this.sendTo(m, this.startMsg());
      for (const i of this.taken) this.sendTo(m, { t: 'pk', i, by: null });
      this.broadcast({ t: 'add', r: p });
    } else {
      // Arrived mid-match: watch until the next round.
      this.sendTo(m, this.startMsg());
      this.sendTo(m, { t: 'note', text: 'A match is on. You\'ll join the next round.' });
      for (const i of this.taken) this.sendTo(m, { t: 'pk', i, by: null });
    }
    this.broadcast({ t: 'feed', text: m.name + ' joined' });
    this.sendHeirs();
  }

  // Everyone learns who takes over if this host leaves: the longest-staying player first.
  sendHeirs() {
    const l = [...this.members.keys()].filter((id) => id !== this.localId);
    this.broadcast({ t: 'heirs', l, h: this.localId });
  }

  leave(id) {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    const e = this.ents.get(id);
    if (e && e.alive && this.phase === 'match') {
      e.left = true;
      this.knockOut(e, null, true);
    } else if (e) {
      e.left = true;
    }
    if (this.dead) return;
    this.broadcast({ t: 'feed', text: m.name + ' left' });
    this.sendHeirs();
    if (this.phase === 'lobby') this.sendLobby();
  }

  // Messages from a player (the host's own player arrives here too).
  receive(id, msg) {
    const m = this.members.get(id);
    if (!m) return;
    m.lastHeard = performance.now();
    const e = this.ents.get(id);
    switch (msg.t) {
      case 'st':
        if (e && e.alive && this.phase === 'match') this.playerMoved(e, msg);
        break;
      case 'fire':
        if (e && this.phase === 'match') this.fire(e, msg);
        break;
      case 'ping':
        this.sendTo(m, { t: 'pong', c: msg.c });
        break;
      case 'chat': {
        const text = String(msg.text || '').slice(0, 60);
        if (text) this.broadcast({ t: 'emote', id, e: text });
        break;
      }
      case 'start':
        if (id === this.localId && this.phase === 'lobby') this.startMatch();
        break;
      case 'bots':
        if (id === this.localId) { this.bots = !!msg.on; this.sendLobby(); }
        break;
      case 'teams':
        if (id === this.localId && !this.quick && [1, 2, 4].includes(msg.size)) { this.teamSize = msg.size; this.sendLobby(); }
        break;
      default:
    }
  }

  /* ---------- Lobby ---------- */

  enterLobby() {
    this.phase = 'lobby';
    this.ents.clear();
    for (const m of this.members.values()) m.spectator = false;
    this.nextSeed = this.newSeed();
    this.countdownEnd = this.quick ? performance.now() + QUICK_WAIT * 1000 : 0;
    this.sendLobby();
  }

  sendLobby() {
    const players = [...this.members.values()].map((m) => ({ id: m.id, name: m.name, color: m.color, hat: m.hat }));
    const cd = this.countdownEnd ? Math.max(0, Math.ceil((this.countdownEnd - performance.now()) / 1000)) : null;
    this.broadcast({ t: 'lobby', players, quick: this.quick, code: this.code, cd, bots: this.bots, seed: this.nextSeed, fill: this.fillTo(), host: this.localId, practice: this.practice, teams: this.teamSize });
  }

  /* ---------- Match ---------- */

  startMatch() {
    const seed = this.nextSeed;
    this.seed = seed;
    this.world = S.buildWorld(seed);
    this.storm = S.buildStorm(seed);
    this.ents.clear();
    this.projs = [];
    this.taken = new Set();
    this.crates = [];
    this.cratesSent = 0;
    this.tm = 0;
    this.snapT = 0;
    this.humanlessT = 0;

    const roster = [...this.members.values()].map((m) => ({ id: m.id, name: m.name, color: m.color, hat: m.hat, bot: false }));
    if (this.bots || roster.length < 2) {
      const names = shuffle(S.BOT_NAMES.slice());
      let n = 1;
      while (roster.length < Math.max(this.bots ? this.fillTo() : 2, this.teamSize + 1) && roster.length < S.MAX_HUMANS + 4) {
        roster.push({
          id: 'b' + n, name: names[(n - 1) % names.length], color: S.COLORS[Math.floor(Math.random() * S.COLORS.length)],
          hat: Math.random() < 0.6 ? 1 + Math.floor(Math.random() * (S.HATS.length - 1)) : 0, bot: true
        });
        n++;
      }
    }

    // Spread everyone around the island.
    // Teams: players in join order, then bots. Teammates land next to each other.
    roster.forEach((p, i) => { p.team = Math.floor(i / this.teamSize); });
    const nTeams = roster[roster.length - 1].team + 1;
    const R = S.rng(seed + 99);
    const a0 = R() * Math.PI * 2;
    roster.forEach((p, i) => {
      let x = 0, z = 0;
      const member = i % this.teamSize;
      for (let k = 0; k < 30; k++) {
        const a = a0 + (p.team / nTeams) * Math.PI * 2 + (this.teamSize > 1 ? member * 0.06 : (R() - 0.5) * 0.3) + k * 0.05;
        const r = S.ISLAND_R * (0.35 + R() * 0.35);
        x = Math.cos(a) * r; z = Math.sin(a) * r;
        if (S.onLand(this.world, x, z) && !S.hitsObstacle(this.world, x, z, 1, 1)) break;
      }
      p.x = S.r2(x); p.z = S.r2(z);
      this.ents.set(p.id, this.makeEnt(p, x, z));
    });
    this.roster = roster;
    this.phase = 'match';
    this.broadcast(this.startMsg());
  }

  startMsg() {
    return { t: 'start', seed: this.seed, roster: this.roster, tm: S.r2(this.tm), quick: this.quick, code: this.code, host: this.localId };
  }

  playerMoved(e, msg) {
    let x = +msg.x, z = +msg.z, y = +msg.y;
    if (!isFinite(x) || !isFinite(z) || !isFinite(y)) return;
    if (!S.onLand(this.world, x, z)) return;
    e.x = x; e.z = z; e.y = y;
    e.yaw = +msg.yaw || 0;
    e.f = msg.f | 0;
    e.umbrella = !!(e.f & 8);
  }

  fire(e, msg) {
    if (!e.alive) return;
    const wp = S.WEAPONS[msg.w | 0];
    if (!wp) return;
    if (e.y - S.groundHeight(this.world, e.x, e.z) > 2.5 && this.tm < S.DROP_TIME + 6) return; // still floating down
    if (this.tm - e.lastFire < wp.cd * 0.75) return;
    if (wp.id !== S.W_BALLOON) {
      if (e.ammo[wp.id] <= 0) return;
      e.ammo[wp.id]--;
    }
    e.lastFire = this.tm;
    let sx = +msg.x, sz = +msg.z;
    if (!isFinite(sx) || !isFinite(sz) || Math.hypot(sx - e.x, sz - e.z) > 3) { sx = e.x; sz = e.z; }
    const p = { id: ++this.projId, o: e.id, w: wp.id, sx, sy: e.y + S.HAND_Y, sz, t0: this.tm, age: 0 };
    if (wp.arc) {
      let tx = +msg.tx, tz = +msg.tz;
      if (!isFinite(tx) || !isFinite(tz)) return;
      const d = Math.hypot(tx - sx, tz - sz);
      if (d > wp.range) { tx = sx + (tx - sx) * wp.range / d; tz = sz + (tz - sz) * wp.range / d; }
      p.tx = tx; p.tz = tz;
    } else {
      let dx = +msg.dx, dz = +msg.dz;
      const d = Math.hypot(dx, dz);
      if (!(d > 0)) return;
      p.dx = dx / d; p.dz = dz / d;
    }
    S.shotPath(this.world, p);
    this.projs.push(p);
    const out = { t: 'pj', id: p.id, o: p.o, w: p.w, sx: S.r2(p.sx), sy: S.r2(p.sy), sz: S.r2(p.sz), t0: S.r2(p.t0) };
    if (p.arc) { out.tx = S.r2(p.tx); out.tz = S.r2(p.tz); } else { out.dx = Math.round(p.dx * 1000) / 1000; out.dz = Math.round(p.dz * 1000) / 1000; }
    if (msg.lid) out.lid = msg.lid;
    // Use the rounded numbers ourselves too, so every browser draws the same path.
    Object.assign(p, { sx: out.sx, sy: out.sy, sz: out.sz });
    if (p.arc) { p.tx = out.tx; p.tz = out.tz; } else { p.dx = out.dx; p.dz = out.dz; }
    S.shotPath(this.world, p);
    this.broadcast(out);
  }

  stepShots() {
    const pos = { x: 0, y: 0, z: 0 };
    const keep = [];
    for (const p of this.projs) {
      const wp = S.WEAPONS[p.w];
      const team = this.ents.get(p.o).team;
      const a0 = p.age, a1 = this.tm - p.t0;
      p.age = a1;
      let done = false;
      for (let a = a0; a < a1 && !done;) {
        a = Math.min(a + 0.02, a1);
        S.shotPos(p, a, pos);
        // Hit a player?
        for (const e of this.ents.values()) {
          if (!e.alive || e.id === p.o || e.team === team) continue;
          if (Math.hypot(e.x - pos.x, e.z - pos.z) < S.PLAYER_R + wp.size && pos.y > e.y - 0.2 && pos.y < e.y + S.PLAYER_H) {
            this.splash(p, pos, e);
            done = true;
            break;
          }
        }
        if (done) break;
        if (pos.y <= S.groundHeight(this.world, pos.x, pos.z) + 0.05 || S.hitsObstacle(this.world, pos.x, pos.z, pos.y, wp.size * 0.5)) {
          if (p.arc) this.splash(p, pos, null);
          done = true;
        } else if (!p.arc && a >= p.life) {
          done = true;
        }
      }
      if (!done) keep.push(p);
    }
    this.projs = keep;
  }

  splash(p, pos, direct) {
    const wp = S.WEAPONS[p.w];
    const owner = this.ents.get(p.o);
    const hits = [];
    const hurt = (e, dmg) => {
      dmg = Math.round(dmg);
      if (dmg <= 0) return;
      const soak = Math.min(e.shield, dmg);
      e.shield -= soak;
      e.hp -= dmg - soak;
      hits.push([e.id, dmg]);
      if (e.hp <= 0) this.knockOut(e, owner, false, p.w);
    };
    if (wp.arc) {
      for (const e of this.ents.values()) {
        if (!e.alive || e.id === p.o || (owner && e.team === owner.team)) continue;
        const d = Math.hypot(e.x - pos.x, e.z - pos.z);
        if (d > wp.splash || Math.abs(e.y + 1 - pos.y) > 3.5) continue;
        hurt(e, e === direct ? wp.dmg : S.lerp(wp.dmg, wp.minDmg, d / wp.splash));
      }
    } else if (direct) {
      hurt(direct, wp.dmg);
    }
    this.broadcast({ t: 'sp', id: p.id, w: p.w, o: p.o, x: S.r2(pos.x), y: S.r2(pos.y), z: S.r2(pos.z), h: hits });
  }

  knockOut(e, by, quiet, w) {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    // A team's place is decided when its last member is out.
    const teams = new Set();
    for (const o of this.ents.values()) if (o.alive) teams.add(o.team);
    if (!teams.has(e.team)) {
      for (const o of this.ents.values()) if (o.team === e.team) o.place = teams.size + 1;
    } else e.place = 0;
    if (by && by !== e) by.kills++;
    this.broadcast({ t: 'ko', v: e.id, by: by && by !== e ? by.id : null, place: e.place, left: !!quiet, w: w === undefined ? null : w });
  }

  // Supply drops: a crate floats down into the safe zone with the best loot.
  stepCrates() {
    for (let i = 0; i < S.CRATE_TIMES.length; i++) {
      if (this.cratesSent > i || this.tm < S.CRATE_TIMES[i]) continue;
      this.cratesSent = i + 1;
      const st = S.stormAt(this.storm, this.tm + S.CRATE_FALL);
      const [x, z] = pointNear(this.world, st.nx, st.nz, Math.max(3, st.nr * 0.6));
      const c = { id: i + 1, x: S.r2(x), z: S.r2(z), land: S.r2(this.tm + S.CRATE_FALL), taken: false };
      this.crates.push(c);
      this.broadcast(Object.assign({ t: 'crate' }, c));
    }
    for (const c of this.crates) {
      if (c.taken || this.tm < c.land) continue;
      for (const e of this.ents.values()) {
        if (!e.alive || Math.hypot(e.x - c.x, e.z - c.z) > 2.2) continue;
        c.taken = true;
        e.hp = S.MAX_HP;
        e.shield = S.SHIELD_MAX;
        e.ammo[S.W_SOAKER] = Math.min(S.WEAPONS[1].max, e.ammo[S.W_SOAKER] + 80);
        e.ammo[S.W_MEGA] = S.WEAPONS[2].max;
        this.broadcast({ t: 'crateTaken', id: c.id, by: e.id });
        break;
      }
    }
  }

  stepPickups() {
    const pk = this.world.pickups;
    for (const e of this.ents.values()) {
      if (!e.alive) continue;
      for (const p of pk) {
        if (this.taken.has(p.i)) continue;
        if (Math.abs(p.x - e.x) > S.PICKUP_R || Math.abs(p.z - e.z) > S.PICKUP_R) continue;
        if (Math.hypot(p.x - e.x, p.z - e.z) > S.PICKUP_R || Math.abs(e.y - p.y) > 2.5) continue;
        if (p.type === S.PICK_TOWEL) {
          if (e.hp >= S.MAX_HP) continue;
          e.hp = Math.min(S.MAX_HP, e.hp + S.TOWEL_HEAL);
        } else if (p.type === S.PICK_SHIELD) {
          if (e.shield >= S.SHIELD_MAX) continue;
          e.shield = Math.min(S.SHIELD_MAX, e.shield + S.SHIELD_PICK);
        } else {
          const w = p.type === S.PICK_SOAKER ? S.W_SOAKER : S.W_MEGA;
          const wp = S.WEAPONS[w];
          if (e.ammo[w] >= wp.max) continue;
          e.ammo[w] = Math.min(wp.max, e.ammo[w] + wp.pick);
        }
        this.taken.add(p.i);
        this.broadcast({ t: 'pk', i: p.i, by: e.id });
      }
    }
  }

  stepStorm(dt) {
    const st = S.stormAt(this.storm, this.tm);
    for (const e of this.ents.values()) {
      if (!e.alive) continue;
      if (Math.hypot(e.x - st.x, e.z - st.z) > st.r) {
        e.hp -= st.dmg * dt;
        if (e.hp <= 0) this.knockOut(e, null, false);
      }
    }
  }

  checkEnd(dt) {
    let humans = 0, last = null;
    const teams = new Set();
    for (const e of this.ents.values()) {
      if (!e.alive) continue;
      teams.add(e.team);
      last = e;
      if (!e.bot) humans++;
    }
    let winner = null, over = false;
    if (teams.size <= 1) { over = true; winner = last; }
    // Everyone real is out: wrap up after a few seconds instead of watching bots for minutes.
    this.humanlessT = humans === 0 ? this.humanlessT + dt : 0;
    if (!over && this.humanlessT > 6) {
      over = true;
      for (const e of this.ents.values()) if (e.alive && (!winner || e.hp > winner.hp)) winner = e;
    }
    if (!over) return;
    if (winner) for (const e of this.ents.values()) if (e.team === winner.team) e.place = 1;
    this.phase = 'over';
    this.overEnd = performance.now() + OVER_WAIT * 1000;
    const stats = [...this.ents.values()].map((e) => [e.id, e.kills, e.place]);
    this.broadcast({ t: 'over', winner: winner ? winner.id : null, team: winner ? winner.team : null, stats });
  }

  sendSnap() {
    const p = [];
    let alive = 0;
    for (const e of this.ents.values()) {
      if (e.alive) alive++;
      // f: 1 alive, 2 dashing, 4 moving, 8 umbrella, 16-48 weapon in hand, 64 bubble shield, 128 just threw
      const f = (e.alive ? 1 : 0) | (e.f & 62) | (e.shield > 0 ? 64 : 0) | (this.tm - e.lastFire < S.HIDE_AFTER ? 128 : 0);
      p.push([e.id, S.r2(e.x), S.r2(e.y), S.r2(e.z), S.r2(e.yaw), Math.max(0, Math.ceil(e.hp)), f]);
    }
    const base = { t: 'snap', tm: Math.round(this.tm * 1000) / 1000, p, n: alive };
    for (const m of this.members.values()) {
      const e = this.ents.get(m.id);
      this.sendTo(m, e ? Object.assign({ me: { a: [e.ammo[1], e.ammo[2]], k: e.kills, s: Math.ceil(e.shield) } }, base) : base);
    }
  }

  tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;

    this.heirT += dt;
    if (this.heirT > 3) { this.heirT = 0; this.sendHeirs(); }
    for (const [id, until] of this.expect) {
      if (now < until) continue;
      this.expect.delete(id);
      const e = this.ents.get(id);
      if (e && e.alive && this.phase === 'match') { e.left = true; this.knockOut(e, null, true); }
    }
    for (const m of this.members.values()) {
      if (m.id !== this.localId && now - m.lastHeard > TIMEOUT_MS) {
        try { m.conn.close(); } catch (e) { /* ignore */ }
        this.leave(m.id);
      }
    }

    if (this.phase === 'lobby') {
      this.lobbyT += dt;
      if (this.countdownEnd && now >= this.countdownEnd) { this.startMatch(); return; }
      if (this.lobbyT >= 1) { this.lobbyT = 0; this.sendLobby(); }
      return;
    }

    if (this.phase === 'over') {
      if (now >= this.overEnd) { this.enterLobby(); return; }
      this.lobbyT += dt;
      if (this.lobbyT >= 1) { this.lobbyT = 0; this.broadcast({ t: 'hb' }); }
      return;
    }

    this.tm += dt;
    for (const e of this.ents.values()) if (e.ai && e.alive) this.stepBot(e, dt);
    for (const e of this.ents.values()) {
      e.vx = S.lerp(e.vx, (e.x - e.px) / dt, 0.3);
      e.vz = S.lerp(e.vz, (e.z - e.pz) / dt, 0.3);
      e.px = e.x; e.pz = e.z;
    }
    this.stepShots();
    this.stepPickups();
    this.stepCrates();
    this.stepStorm(dt);
    this.checkEnd(dt);
    this.snapT += dt;
    if (this.snapT >= SNAP_EVERY || this.phase === 'over') {
      this.snapT = 0;
      this.sendSnap();
    }
  }

  /* ---------- Bots ---------- */

  stepBot(e, dt) {
    const ai = e.ai;
    const w = this.world;
    ai.think -= dt;
    ai.fireWait -= dt;
    ai.strafeT -= dt;
    if (ai.strafeT <= 0) { ai.strafe = Math.random() < 0.5 ? -1 : 1; ai.strafeT = 1 + Math.random() * 1.5; }

    if (ai.think <= 0) {
      ai.think = 0.25 + Math.random() * 0.1;
      const st = S.stormAt(this.storm, this.tm);
      const useNext = st.shrinking || st.until < 15;
      const cx = useNext ? st.nx : st.x, cz = useNext ? st.nz : st.z, cr = Math.max(4, useNext ? st.nr : st.r);
      const toSafe = Math.hypot(e.x - cx, e.z - cz);
      ai.target = null;
      if (e.y - S.groundHeight(w, e.x, e.z) < 2) {
        let best = 26;
        for (const o of this.ents.values()) {
          if (!o.alive || o === e || o.team === e.team) continue;
          const d = Math.hypot(o.x - e.x, o.z - e.z);
          if (d > S.SEE_HIDDEN && this.tm - o.lastFire > S.HIDE_AFTER && S.inBush(w, o.x, o.z)) continue;
          if (d < best && !S.lineBlocked(w, e.x, e.z, o.x, o.z, e.y + 2.6)) { best = d; ai.target = o; }
        }
      }
      if (ai.target && toSafe < cr) {
        ai.mode = 'fight';
        if (ai.react <= 0) ai.react = 0.35 + Math.random() * 0.5;
      } else if (toSafe > cr * 0.8) {
        ai.mode = 'storm';
        if (!ai.goal || Math.hypot(ai.goal[0] - cx, ai.goal[1] - cz) > cr * 0.6) ai.goal = pointNear(w, cx, cz, cr * 0.5);
      } else {
        let best = 35, goal = null;
        for (const c of this.crates) {
          if (c.taken || c.land - this.tm > 4 || Math.hypot(c.x - cx, c.z - cz) > cr) continue;
          const d = Math.hypot(c.x - e.x, c.z - e.z);
          if (d < 55) { best = d; goal = [c.x, c.z]; }
        }
        for (const p of w.pickups) {
          if (this.taken.has(p.i)) continue;
          if (p.type === S.PICK_TOWEL && e.hp > 80) continue;
          if (p.type === S.PICK_SHIELD && e.shield >= S.SHIELD_MAX) continue;
          if (Math.hypot(p.x - cx, p.z - cz) > cr) continue;
          const d = Math.hypot(p.x - e.x, p.z - e.z);
          if (d < best) { best = d; goal = [p.x, p.z]; }
        }
        // Nothing to grab: go looking for someone to splash.
        if (!goal && e.hp > 45) {
          let bestE = 60;
          for (const o of this.ents.values()) {
            if (!o.alive || o === e || o.team === e.team) continue;
            const d = Math.hypot(o.x - e.x, o.z - e.z);
            if (d < bestE && Math.hypot(o.x - cx, o.z - cz) < cr) { bestE = d; goal = [o.x, o.z]; }
          }
        }
        if (goal) { ai.mode = 'loot'; ai.goal = goal; } else {
          ai.mode = 'wander';
          if (!ai.goal || Math.hypot(ai.goal[0] - e.x, ai.goal[1] - e.z) < 2) ai.goal = pointNear(w, cx, cz, cr * 0.7);
        }
        if (ai.target) ai.mode = 'fight';
      }
    }

    let mx = 0, mz = 0;
    if (ai.mode === 'fight' && ai.target && ai.target.alive) {
      const t = ai.target;
      const dx = t.x - e.x, dz = t.z - e.z, d = Math.hypot(dx, dz) || 1;
      const ux = dx / d, uz = dz / d;
      const want = ai.range;
      const fwd = d > want + 3 ? 1 : d < want - 4 ? -1 : 0;
      mx = ux * fwd - uz * ai.strafe * 0.8;
      mz = uz * fwd + ux * ai.strafe * 0.8;
      e.yaw = Math.atan2(ux, uz);
      ai.react -= dt;
      if (ai.react <= 0 && ai.fireWait <= 0) this.botShoot(e, t, d);
    } else if (ai.goal) {
      const dx = ai.goal[0] - e.x, dz = ai.goal[1] - e.z, d = Math.hypot(dx, dz);
      if (d > 0.5) { mx = dx / d; mz = dz / d; }
      if (mx || mz) e.yaw = Math.atan2(mx, mz);
    }

    // Step out of the way of balloons about to land nearby.
    let dodge = false;
    for (const p of this.projs) {
      if (!p.arc || p.o === e.id || p.T - p.age > 0.8 || this.ents.get(p.o).team === e.team) continue;
      const dx = e.x - p.tx, dz = e.z - p.tz, d = Math.hypot(dx, dz);
      const r = S.WEAPONS[p.w].splash + 1;
      if (d < r && Math.random() < ai.dodge) { mx = dx / (d || 1); mz = dz / (d || 1); dodge = true; break; }
    }

    if (ai.unstickT > 0) {
      ai.unstickT -= dt;
      mx = ai.ux; mz = ai.uz;
    }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const input = { mx, mz, jump: Math.random() < 0.004, dash: dodge && Math.random() < 0.1 };
    S.movePlayer(w, e, input, dt);
    e.f = (e.dashT > 0 ? 2 : 0) | (len > 0.1 ? 4 : 0) | (e.umbrella ? 8 : 0) | ((ai.w || 0) << 4);

    // Stuck on a wall? Walk sideways for a moment.
    ai.stuckT += dt;
    if (ai.stuckT > 1) {
      if (len > 0.1 && Math.hypot(e.x - ai.sx, e.z - ai.sz) < 1.5 && ai.unstickT <= 0) {
        const a = Math.random() * Math.PI * 2;
        ai.ux = Math.cos(a); ai.uz = Math.sin(a); ai.unstickT = 0.8;
        ai.goal = null;
      }
      ai.stuckT = 0; ai.sx = e.x; ai.sz = e.z;
    }
  }

  botShoot(e, t, d) {
    const ai = e.ai;
    let w = S.W_BALLOON;
    if (e.ammo[S.W_SOAKER] > 0 && d < 14 && Math.random() < 0.7) w = S.W_SOAKER;
    else if (e.ammo[S.W_MEGA] > 0 && d < 19 && Math.random() < 0.35) w = S.W_MEGA;
    const wp = S.WEAPONS[w];
    ai.w = w;
    const flight = wp.arc ? Math.max(0.3, d / wp.speed) : d / wp.speed;
    const err = ai.aim * (0.6 + d * 0.07);
    const tx = t.x + t.vx * flight * ai.lead + gauss() * err;
    const tz = t.z + t.vz * flight * ai.lead + gauss() * err;
    this.fire(e, { w, x: e.x, z: e.z, tx, tz, dx: tx - e.x, dz: tz - e.z });
    ai.fireWait = w === S.W_SOAKER ? wp.cd * (1.2 + Math.random()) : wp.cd * (1.4 + Math.random() * 1.2);
    if (w === S.W_SOAKER && Math.random() < 0.08) ai.fireWait = 0.6;
  }
}

function newBrain() {
  return {
    think: Math.random() * 0.3, mode: 'wander', goal: null, target: null,
    react: 0, fireWait: 0, strafe: 1, strafeT: 0, stuckT: 0, unstickT: 0, sx: 0, sz: 0, ux: 0, uz: 0,
    range: 10 + Math.random() * 6, aim: 0.7 + Math.random() * 0.8, lead: 0.4 + Math.random() * 0.6, dodge: 0.03 + Math.random() * 0.05
  };
}

function pointNear(w, cx, cz, r) {
  for (let k = 0; k < 20; k++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (S.onLand(w, x, z) && !S.hitsObstacle(w, x, z, 1, 1)) return [x, z];
  }
  return [cx, cz];
}

function gauss() {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cleanName(s) {
  const n = String(s || '').replace(/[<>]/g, '').trim().slice(0, 16);
  return n || 'Player';
}

export function cleanHat(h) {
  h = h | 0;
  return h >= 0 && h < S.HATS.length ? h : 0;
}

export function cleanColor(c) {
  return /^#[0-9a-f]{6}$/i.test(String(c)) ? c : S.COLORS[0];
}
