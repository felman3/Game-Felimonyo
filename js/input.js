// Keyboard + mouse on computers, two thumb sticks on phones.
//
// Phones: drag on the left half to walk. Drag on the right half to aim and
// let go to throw. A quick tap on the right half throws at the nearest enemy.

const STICK = 60; // px a stick can be pushed

export function createInput({ canvas, touchLayer, sticks }) {
  const keys = new Set();
  const events = [];
  const mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false, seen: false };
  const left = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const right = { id: null, ox: 0, oy: 0, x: 0, y: 0, t: 0, max: 0 };
  let enabled = false;

  const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');

  addEventListener('keydown', (e) => {
    if (typing(e) || !enabled) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
    if (e.repeat) { keys.add(k); return; }
    keys.add(k);
    if (k === ' ') events.push({ type: 'jump' });
    else if (k === 'shift') events.push({ type: 'dash' });
    else if (k === '1' || k === '2' || k === '3') events.push({ type: 'weapon', w: +k - 1 });
    else if (k === 'q') events.push({ type: 'cycle' });
    else if (k === 'e') events.push({ type: 'emote' });
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => { keys.clear(); mouse.down = false; });

  canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.seen = true; });
  canvas.addEventListener('mousedown', (e) => {
    if (!enabled) return;
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.seen = true;
    if (e.button === 0) mouse.down = true;
    if (e.button === 2) events.push({ type: 'dash' });
  });
  addEventListener('mouseup', (e) => { if (e.button === 0) mouse.down = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    if (!enabled) return;
    events.push({ type: 'cycle', dir: e.deltaY > 0 ? 1 : -1 });
  }, { passive: true });

  /* ---------- Touch ---------- */
  const showStick = (el, s) => {
    el.base.style.transform = `translate(${s.ox}px, ${s.oy}px)`;
    el.knob.style.transform = `translate(${s.ox + s.x * STICK}px, ${s.oy + s.y * STICK}px)`;
    el.base.hidden = el.knob.hidden = false;
  };
  const hideStick = (el) => { el.base.hidden = el.knob.hidden = true; };

  touchLayer.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!enabled) return;
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth / 2) {
        if (left.id !== null) continue;
        Object.assign(left, { id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 });
        showStick(sticks.left, left);
      } else {
        if (right.id !== null) continue;
        Object.assign(right, { id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0, t: performance.now(), max: 0 });
        showStick(sticks.right, right);
      }
    }
  }, { passive: false });

  touchLayer.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const s = t.identifier === left.id ? left : t.identifier === right.id ? right : null;
      if (!s) continue;
      let dx = (t.clientX - s.ox) / STICK, dy = (t.clientY - s.oy) / STICK;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      // Let the left stick follow the thumb if it drags far.
      if (s === left && len > 1.4) {
        s.ox = t.clientX - dx * STICK;
        s.oy = t.clientY - dy * STICK;
      }
      s.x = dx; s.y = dy;
      if (s === right) s.max = Math.max(s.max, Math.hypot(dx, dy));
      showStick(s === left ? sticks.left : sticks.right, s);
    }
  }, { passive: false });

  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === left.id) {
        left.id = null; left.x = left.y = 0;
        hideStick(sticks.left);
      } else if (t.identifier === right.id) {
        const tap = right.max < 0.25 && performance.now() - right.t < 350;
        events.push({ type: 'release', x: right.x, y: right.y, tap });
        right.id = null; right.x = right.y = 0;
        hideStick(sticks.right);
      }
    }
  };
  touchLayer.addEventListener('touchend', end);
  touchLayer.addEventListener('touchcancel', end);

  return {
    setEnabled(on) {
      enabled = on;
      if (!on) {
        keys.clear(); mouse.down = false;
        left.id = right.id = null; left.x = left.y = right.x = right.y = 0;
        hideStick(sticks.left); hideStick(sticks.right);
        events.length = 0;
      }
    },
    // Walking direction in world space (screen up = -z).
    move() {
      let x = left.x, z = left.y;
      if (keys.has('a') || keys.has('arrowleft')) x -= 1;
      if (keys.has('d') || keys.has('arrowright')) x += 1;
      if (keys.has('w') || keys.has('arrowup')) z -= 1;
      if (keys.has('s') || keys.has('arrowdown')) z += 1;
      const len = Math.hypot(x, z);
      if (len > 1) { x /= len; z /= len; }
      return { x, z };
    },
    mouse,
    // The right thumb stick while it's held: x/y from -1 to 1.
    aimStick() { return right.id === null ? null : { x: right.x, y: right.y, len: Math.hypot(right.x, right.y) }; },
    push(ev) { events.push(ev); },
    take() { return events.splice(0, events.length); }
  };
}
