// Rules, map and physics shared by every browser in a match.
//
// The map is generated from a seed, so the host only has to send one number
// and every player builds the exact same island, trees, houses and pickups.

export const ISLAND_R = 112;      // rough radius of the coastline
export const WORLD = 250;         // the terrain is a square this many units wide
export const GRID = 100;          // terrain cells per side
export const MAX_HUMANS = 12;
export const FILL_TO = 10;        // bots top a match up to this many players

export const PLAYER_R = 0.7;
export const PLAYER_H = 2.1;
export const HAND_Y = 1.5;
export const SPEED = 8;
export const DASH_SPEED = 24;
export const DASH_TIME = 0.16;
export const DASH_CD = 2.2;
export const GRAVITY = 32;
export const JUMP_V = 11;
export const UMBRELLA_FALL = 8;   // top falling speed while floating down at the start
export const DROP_Y = 34;         // everyone floats down from this height
export const DROP_TIME = 4;       // seconds before the storm clock starts
export const MAX_HP = 100;
export const PICKUP_R = 1.8;
export const TOWEL_HEAL = 35;

export const W_BALLOON = 0;
export const W_SOAKER = 1;
export const W_MEGA = 2;

export const WEAPONS = [
  { id: 0, name: 'Balloon', cd: 0.5, range: 24, speed: 20, gravity: 30, arc: true, splash: 3.2, dmg: 24, minDmg: 9, size: 0.32 },
  { id: 1, name: 'Soaker', cd: 0.11, range: 17, speed: 36, arc: false, dmg: 5, size: 0.14, pick: 40, max: 120 },
  { id: 2, name: 'Mega', cd: 0.9, range: 20, speed: 15, gravity: 30, arc: true, splash: 6.5, dmg: 48, minDmg: 14, size: 0.62, pick: 1, max: 3 }
];

export const PICK_SOAKER = 0;
export const PICK_MEGA = 1;
export const PICK_TOWEL = 2;

// Storm plan: [seconds before it shrinks, seconds to shrink, new radius, wetness per second once it starts]
export const STORM_PLAN = [
  [45, 25, 72, 2],
  [25, 20, 42, 4],
  [20, 16, 22, 6],
  [16, 14, 9, 9],
  [12, 14, 0, 14]
];

export const COLORS = ['#ff6b8b', '#ffa24d', '#ffd84d', '#5fd68a', '#40c4ff', '#8b7bff', '#ff7ad9', '#f4f1ea'];
export const HATS = [
  { id: 'none', label: 'No hat', icon: '🚫' },
  { id: 'cap', label: 'Cap', icon: '🧢' },
  { id: 'crown', label: 'Crown', icon: '👑' },
  { id: 'bunny', label: 'Bunny ears', icon: '🐰' },
  { id: 'flower', label: 'Flower', icon: '🌸' },
  { id: 'propeller', label: 'Propeller', icon: '🚁' },
  { id: 'party', label: 'Party hat', icon: '🎉' },
  { id: 'frog', label: 'Frog', icon: '🐸' },
  { id: 'duck', label: 'Duck', icon: '🦆' }
];

export const BOT_NAMES = ['Splashy', 'Drizzle', 'Puddles', 'Bubbles', 'Soggy Sam', 'Misty', 'Ripple', 'Captain Wet',
  'Nimbus', 'Squirt', 'Wavey', 'Dewdrop', 'Sprinkles', 'Monsoon', 'Droplet', 'Tsunami Tim'];

/* ---------- Random numbers and noise ---------- */

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iz, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, z, seed) {
  return vnoise(x, z, seed) * 0.6 + vnoise(x * 2.1, z * 2.1, seed + 17) * 0.3 + vnoise(x * 4.3, z * 4.3, seed + 31) * 0.1;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);
export const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- The island ---------- */

export function buildWorld(seed) {
  const R = rng(seed);
  const N = GRID, cell = WORLD / N, half = WORLD / 2;
  const coast = [];
  for (let i = 0; i < 48; i++) coast.push(ISLAND_R + (vnoise(i * 0.45, 0.5, seed + 5) - 0.5) * 18);
  const coastR = (x, z) => {
    const a = (Math.atan2(z, x) / (Math.PI * 2) + 1) * 48;
    const i = Math.floor(a), f = a - i;
    return lerp(coast[i % 48], coast[(i + 1) % 48], f);
  };

  const hm = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = -half + i * cell, z = -half + j * cell;
      const r = Math.hypot(x, z);
      const land = smooth(clamp01((coastR(x, z) + 4 - r) / 18));
      const hill = Math.max(0, fbm(x * 0.022, z * 0.022, seed) - 0.45) * 9;
      hm[j * (N + 1) + i] = -2.4 + land * 3.4 + hill * land * land;
    }
  }

  const w = { seed, hm, N, cell, half, coastR, obstacles: [], cells: new Map(), pickups: [], stamp: 0 };

  const obs = w.obstacles;
  const randomLand = (margin, minH) => {
    for (let k = 0; k < 40; k++) {
      const r = Math.sqrt(R()) * (ISLAND_R - margin), a = R() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (groundHeight(w, x, z) > minH) return [x, z];
    }
    return null;
  };
  const free = (x, z, br) => {
    for (const o of obs) if (Math.hypot(o.x - x, o.z - z) < br + o.br + 1.2) return false;
    return true;
  };
  const place = (count, make) => {
    for (let n = 0, tries = 0; n < count && tries < count * 30; tries++) {
      const p = randomLand(8, 0.7);
      if (!p) continue;
      const o = make(p[0], p[1]);
      if (!free(o.x, o.z, o.br)) continue;
      o.y0 = groundHeight(w, o.x, o.z);
      o.id = obs.length;
      o.v = R();
      obs.push(o);
      n++;
    }
  };

  place(12, (x, z) => {
    const hw = 2.8 + R() * 1.6, hd = 2.8 + R() * 1.6;
    return { k: 'house', box: true, x, z, hw, hd, h: 4.4, br: Math.hypot(hw, hd) + 1 };
  });
  place(28, (x, z) => {
    const long = R() < 0.5;
    const hw = long ? 3.5 : 0.35, hd = long ? 0.35 : 3.5;
    return { k: 'wall', box: true, x, z, hw, hd, h: 1.7, br: 3.6 };
  });
  place(60, (x, z) => {
    const r = 0.9 + R() * 1.5;
    return { k: 'rock', box: false, x, z, r, pr: r, h: r * 1.15, br: r };
  });
  place(150, (x, z) => ({ k: 'tree', box: false, x, z, r: 0.55, pr: 1.25, h: 7, br: 1.4 }));

  for (const o of obs) {
    const x0 = Math.floor((o.x - o.br) / 10), x1 = Math.floor((o.x + o.br) / 10);
    const z0 = Math.floor((o.z - o.br) / 10), z1 = Math.floor((o.z + o.br) / 10);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = cx * 1000 + cz;
        if (!w.cells.has(key)) w.cells.set(key, []);
        w.cells.get(key).push(o);
      }
    }
  }

  for (let n = 0, tries = 0; n < 80 && tries < 2000; tries++) {
    const p = randomLand(6, 0.4);
    if (!p || !free(p[0], p[1], 0.6)) continue;
    const roll = R();
    const type = roll < 0.35 ? PICK_SOAKER : roll < 0.6 ? PICK_MEGA : PICK_TOWEL;
    w.pickups.push({ i: w.pickups.length, x: p[0], z: p[1], y: groundHeight(w, p[0], p[1]), type });
    n++;
  }
  return w;
}

// Height of the ground. Uses the same two triangles per cell as the drawn terrain,
// so feet always touch the grass exactly.
export function groundHeight(w, x, z) {
  const fx = (x + w.half) / w.cell, fz = (z + w.half) / w.cell;
  if (fx < 0 || fz < 0 || fx >= w.N || fz >= w.N) return -3;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const u = fx - ix, v = fz - iz, row = w.N + 1;
  const h00 = w.hm[iz * row + ix], h10 = w.hm[iz * row + ix + 1];
  const h01 = w.hm[(iz + 1) * row + ix], h11 = w.hm[(iz + 1) * row + ix + 1];
  if (u >= v) return h00 + (h10 - h00) * u + (h11 - h10) * v;
  return h00 + (h11 - h01) * u + (h01 - h00) * v;
}

export const onLand = (w, x, z) => groundHeight(w, x, z) > 0.15;

// Obstacles near a point, each listed once.
export function nearObstacles(w, x, z, rad, out) {
  out.length = 0;
  const stamp = ++w.stamp;
  const x0 = Math.floor((x - rad) / 10), x1 = Math.floor((x + rad) / 10);
  const z0 = Math.floor((z - rad) / 10), z1 = Math.floor((z + rad) / 10);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const list = w.cells.get(cx * 1000 + cz);
      if (!list) continue;
      for (const o of list) {
        if (o.s === stamp) continue;
        o.s = stamp;
        out.push(o);
      }
    }
  }
  return out;
}

const tmpList = [];

// Is a point inside the part of an obstacle that stops water?
export function pointInObstacle(o, x, z, y, pad) {
  if (y > o.y0 + o.h || y < o.y0 - 1.5) return false;
  if (o.box) return Math.abs(x - o.x) < o.hw + pad && Math.abs(z - o.z) < o.hd + pad;
  return Math.hypot(x - o.x, z - o.z) < o.pr + pad;
}

export function hitsObstacle(w, x, z, y, pad) {
  for (const o of nearObstacles(w, x, z, pad + 1, tmpList)) if (pointInObstacle(o, x, z, y, pad)) return o;
  return null;
}

// Is the straight line between two points blocked by something taller than `y`?
export function lineBlocked(w, ax, az, bx, bz, y) {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(d);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (hitsObstacle(w, ax + (bx - ax) * t, az + (bz - az) * t, y, 0)) return true;
  }
  return false;
}

// Push a circle out of trees, rocks, houses and walls.
function collide(w, s, rad) {
  for (const o of nearObstacles(w, s.x, s.z, rad + 1, tmpList)) {
    if (s.y > o.y0 + o.h - 0.2) continue; // standing on top of it
    if (o.box) {
      const cx = Math.max(o.x - o.hw, Math.min(s.x, o.x + o.hw));
      const cz = Math.max(o.z - o.hd, Math.min(s.z, o.z + o.hd));
      const dx = s.x - cx, dz = s.z - cz, d = Math.hypot(dx, dz);
      if (d >= rad) continue;
      if (d > 1e-6) {
        s.x = cx + (dx / d) * rad;
        s.z = cz + (dz / d) * rad;
      } else {
        const px = o.hw - Math.abs(s.x - o.x), pz = o.hd - Math.abs(s.z - o.z);
        if (px < pz) s.x = o.x + Math.sign(s.x - o.x || 1) * (o.hw + rad);
        else s.z = o.z + Math.sign(s.z - o.z || 1) * (o.hd + rad);
      }
    } else {
      const dx = s.x - o.x, dz = s.z - o.z, d = Math.hypot(dx, dz), min = o.r + rad;
      if (d < min && d > 1e-6) {
        s.x = o.x + (dx / d) * min;
        s.z = o.z + (dz / d) * min;
      }
    }
  }
}

/* ---------- Moving a player ---------- */
// s: { x, y, z, vy, dashT, dashCd, ddx, ddz, ground, umbrella }
// input: { mx, mz, jump, dash } with (mx, mz) at most length 1
export function movePlayer(w, s, input, dt) {
  const ox = s.x, oz = s.z;
  s.dashCd = Math.max(0, (s.dashCd || 0) - dt);
  if (input.dash && s.dashCd <= 0 && !s.umbrella) {
    let dx = input.mx, dz = input.mz;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) { dx = Math.sin(s.yaw || 0); dz = Math.cos(s.yaw || 0); } else { dx /= len; dz /= len; }
    s.ddx = dx; s.ddz = dz; s.dashT = DASH_TIME; s.dashCd = DASH_CD;
  }
  if (s.dashT > 0) {
    s.dashT -= dt;
    s.x += s.ddx * DASH_SPEED * dt;
    s.z += s.ddz * DASH_SPEED * dt;
  } else {
    s.x += input.mx * SPEED * dt;
    s.z += input.mz * SPEED * dt;
  }
  collide(w, s, PLAYER_R);
  // Water is the edge of the world.
  if (!onLand(w, s.x, s.z)) {
    if (onLand(w, s.x, oz)) s.z = oz;
    else if (onLand(w, ox, s.z)) s.x = ox;
    else { s.x = ox; s.z = oz; }
  }

  const gh = groundHeight(w, s.x, s.z);
  if (s.ground && input.jump) { s.vy = JUMP_V; s.ground = false; }
  if (s.ground && s.y - gh < 0.7) {
    s.y = gh;
    s.vy = 0;
  } else {
    s.vy -= GRAVITY * dt;
    if (s.umbrella && s.vy < -UMBRELLA_FALL) s.vy = -UMBRELLA_FALL;
    s.y += s.vy * dt;
    s.ground = false;
    if (s.y <= gh) { s.y = gh; s.vy = 0; s.ground = true; s.umbrella = false; }
  }
}

/* ---------- Water balloons and soaker shots ---------- */

// Fills in the flight path of a shot from its start and target.
export function shotPath(w, p) {
  const wp = WEAPONS[p.w];
  p.arc = wp.arc;
  if (wp.arc) {
    p.ty = groundHeight(w, p.tx, p.tz);
    const d = Math.hypot(p.tx - p.sx, p.tz - p.sz);
    p.T = Math.max(0.3, d / wp.speed);
    p.vy = (p.ty - p.sy + 0.5 * wp.gravity * p.T * p.T) / p.T;
  } else {
    p.life = wp.range / wp.speed;
  }
  return p;
}

export function shotPos(p, age, out) {
  const wp = WEAPONS[p.w];
  if (p.arc) {
    const f = age / p.T;
    out.x = p.sx + (p.tx - p.sx) * f;
    out.z = p.sz + (p.tz - p.sz) * f;
    out.y = p.sy + p.vy * age - 0.5 * wp.gravity * age * age;
  } else {
    out.x = p.sx + p.dx * wp.speed * age;
    out.z = p.sz + p.dz * wp.speed * age;
    out.y = p.sy - 1.2 * age * age;
  }
  return out;
}

// Where does a shot hit the ground or an obstacle between two ages? Returns the age or -1.
export function shotHitsWorld(w, p, a0, a1, out) {
  const wp = WEAPONS[p.w];
  let a = a0;
  while (a < a1) {
    a = Math.min(a + 0.02, a1);
    shotPos(p, a, out);
    if (out.y <= groundHeight(w, out.x, out.z) + 0.05) return a;
    if (hitsObstacle(w, out.x, out.z, out.y, wp.size * 0.5)) return a;
    if (!p.arc && a >= p.life) return -2;
  }
  return -1;
}

/* ---------- The storm ---------- */

export function buildStorm(seed) {
  const R = rng(seed ^ 0x5bd1e995);
  let cx = 0, cz = 0, r = ISLAND_R + 30, t = DROP_TIME, dmg = 1;
  const phases = [];
  for (const [wait, shrink, nr, nd] of STORM_PLAN) {
    let nx = cx, nz = cz;
    for (let k = 0; k < 30; k++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * Math.max(0, r - nr) * 0.85;
      const tx = cx + Math.cos(a) * d, tz = cz + Math.sin(a) * d;
      if (Math.hypot(tx, tz) <= Math.max(0, ISLAND_R * 0.75 - nr)) { nx = tx; nz = tz; break; }
    }
    phases.push({ t0: t + wait, t1: t + wait + shrink, x0: cx, z0: cz, r0: r, x1: nx, z1: nz, r1: nr, d0: dmg, d1: nd });
    t += wait + shrink;
    cx = nx; cz = nz; r = nr; dmg = nd;
  }
  return { phases };
}

export function stormAt(storm, t, out) {
  out = out || {};
  for (let i = 0; i < storm.phases.length; i++) {
    const ph = storm.phases[i];
    if (t < ph.t0) {
      Object.assign(out, { x: ph.x0, z: ph.z0, r: ph.r0, dmg: ph.d0, nx: ph.x1, nz: ph.z1, nr: ph.r1, shrinking: false, until: ph.t0 - t, phase: i });
      return out;
    }
    if (t < ph.t1) {
      const f = (t - ph.t0) / (ph.t1 - ph.t0);
      Object.assign(out, {
        x: lerp(ph.x0, ph.x1, f), z: lerp(ph.z0, ph.z1, f), r: lerp(ph.r0, ph.r1, f), dmg: ph.d1,
        nx: ph.x1, nz: ph.z1, nr: ph.r1, shrinking: true, until: ph.t1 - t, phase: i
      });
      return out;
    }
  }
  const last = storm.phases[storm.phases.length - 1];
  Object.assign(out, { x: last.x1, z: last.z1, r: last.r1, dmg: last.d1, nx: last.x1, nz: last.z1, nr: last.r1, shrinking: false, until: 0, phase: storm.phases.length });
  return out;
}

export const r2 = (v) => Math.round(v * 100) / 100;
