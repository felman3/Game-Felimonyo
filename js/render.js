// Everything you see: the island, the bean-shaped splashers, balloons,
// splashes and the storm. Built from simple shapes with flat shading, so it
// looks like a toy and runs on phones.

import * as THREE from '../vendor/three.module.min.js';
import * as S from './shared.js';

const UP = new THREE.Vector3(0, 1, 0);

export function createRenderer(canvas, { mobile }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.6 : 2));
  renderer.shadowMap.enabled = !mobile;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const SKY = new THREE.Color('#8fd6ff');
  const STORM_SKY = new THREE.Color('#6f6fa8');
  scene.background = SKY.clone();
  scene.fog = new THREE.Fog(SKY.clone(), 80, 210);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 700);
  const hemi = new THREE.HemisphereLight('#e6f6ff', '#5e8a4a', 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
  sun.castShadow = !mobile;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);

  const lambert = (color, extra) => new THREE.MeshLambertMaterial(Object.assign({ color, flatShading: true }, extra));

  /* ---------- Water ---------- */
  const water = new THREE.Mesh(new THREE.CircleGeometry(500, 48), lambert('#3fc6e6', { transparent: true, opacity: 0.82 }));
  water.rotation.x = -Math.PI / 2;
  water.receiveShadow = true;
  scene.add(water);
  const deep = new THREE.Mesh(new THREE.CircleGeometry(500, 48), lambert('#1f8fc4'));
  deep.rotation.x = -Math.PI / 2;
  deep.position.y = -2.6;
  scene.add(deep);

  /* ---------- Island ---------- */
  let worldGroup = null;
  let pickupMeshes = [];

  function setWorld(w) {
    if (worldGroup) {
      scene.remove(worldGroup);
      worldGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    worldGroup = new THREE.Group();
    scene.add(worldGroup);
    worldGroup.add(buildTerrain(w));
    buildObstacles(w, worldGroup);
    pickupMeshes = w.pickups.map((p) => {
      const m = makePickup(p.type);
      m.position.set(p.x, p.y, p.z);
      m.userData.phase = p.i * 1.7;
      worldGroup.add(m);
      return m;
    });
  }

  function buildTerrain(w) {
    const N = w.N, row = N + 1;
    const pos = [], col = [];
    const c = new THREE.Color();
    const pick = (h, i, j) => {
      const v = ((i * 7919 + j * 104729) % 97) / 97;
      if (h < -0.4) return c.set('#e3c27e');
      if (h < 0.45) return c.set(v < 0.5 ? '#f6dfa0' : '#f1d896');
      if (h < 0.85) return c.set('#c9d97a');
      if (h > 3.2) return c.set(v < 0.5 ? '#63ad4b' : '#5ea548');
      return c.set(v < 0.33 ? '#7fd05c' : v < 0.66 ? '#78c957' : '#86d663');
    };
    const vert = (i, j) => {
      const x = -w.half + i * w.cell, z = -w.half + j * w.cell;
      pos.push(x, w.hm[j * row + i], z);
    };
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = -w.half + i * w.cell, z = -w.half + j * w.cell;
        if (Math.hypot(x, z) > S.ISLAND_R + 40) continue;
        const h00 = w.hm[j * row + i], h10 = w.hm[j * row + i + 1], h01 = w.hm[(j + 1) * row + i], h11 = w.hm[(j + 1) * row + i + 1];
        // Same split as groundHeight(): (00, 11, 10) and (00, 01, 11).
        vert(i, j); vert(i + 1, j + 1); vert(i + 1, j);
        pick((h00 + h11 + h10) / 3, i, j);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
        vert(i, j); vert(i, j + 1); vert(i + 1, j + 1);
        pick((h00 + h01 + h11) / 3, i + 3, j + 5);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, lambert('#ffffff', { vertexColors: true }));
    m.receiveShadow = true;
    return m;
  }

  function buildObstacles(w, group) {
    const trees = w.obstacles.filter((o) => o.k === 'tree');
    const rocks = w.obstacles.filter((o) => o.k === 'rock');
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const c = new THREE.Color();

    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.42, 2.6, 6), lambert('#9b6a43'), trees.length);
    const leaf1 = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 0), lambert('#ffffff'), trees.length);
    const leaf2 = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.35, 0), lambert('#ffffff'), trees.length);
    trees.forEach((o, i) => {
      const sz = 0.85 + o.v * 0.35;
      q.setFromAxisAngle(UP, o.v * 6.28);
      m4.compose(p.set(o.x, o.y0 + 1.1 * sz, o.z), q, s.set(sz, sz, sz));
      trunk.setMatrixAt(i, m4);
      m4.compose(p.set(o.x, o.y0 + 3.6 * sz, o.z), q, s.set(sz, sz * 1.1, sz));
      leaf1.setMatrixAt(i, m4);
      m4.compose(p.set(o.x + 0.2, o.y0 + 5.2 * sz, o.z - 0.1), q, s.set(sz, sz, sz));
      leaf2.setMatrixAt(i, m4);
      const blossom = o.v > 0.9;
      c.set(blossom ? '#ffb3d1' : o.v < 0.3 ? '#4fb35a' : o.v < 0.6 ? '#5cc062' : '#6acb5e');
      leaf1.setColorAt(i, c);
      c.offsetHSL(0, 0, 0.05);
      leaf2.setColorAt(i, c);
    });
    for (const m of [trunk, leaf1, leaf2]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }

    const rock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), lambert('#ffffff'), rocks.length);
    rocks.forEach((o, i) => {
      q.setFromEuler(new THREE.Euler(o.v * 3, o.v * 9, o.v * 5));
      m4.compose(p.set(o.x, o.y0 + o.r * 0.25, o.z), q, s.set(o.r, o.r * 0.95, o.r));
      rock.setMatrixAt(i, m4);
      rock.setColorAt(i, c.set(o.v < 0.5 ? '#b3afc2' : '#a39fb3'));
    });
    rock.castShadow = true; rock.receiveShadow = true;
    group.add(rock);

    const wallColors = ['#ffd9c7', '#fff1b8', '#cfeaff', '#ffd3ea', '#daf6c9'];
    const roofColors = ['#ef7474', '#7b8cff', '#ff9d5c', '#58b6a0'];
    for (const o of w.obstacles) {
      if (o.k === 'house') {
        const h = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(o.hw * 2, 4, o.hd * 2), lambert(wallColors[Math.floor(o.v * 5)]));
        body.position.y = 1.5;
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 2.2, 4), lambert(roofColors[Math.floor(o.v * 4)]));
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(o.hw * 1.6, 1, o.hd * 1.6);
        roof.position.y = 4.6;
        const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.1), lambert('#8a5a3c'));
        door.position.set(0, 0.95 + 0.5, o.hd + 0.03);
        const win1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.1), lambert('#a8e4ff'));
        win1.position.set(o.hw * 0.55, 2.3, o.hd + 0.03);
        const win2 = win1.clone();
        win2.position.x = -o.hw * 0.55;
        h.add(body, roof, door, win1, win2);
        h.position.set(o.x, o.y0 - 0.5, o.z);
        h.traverse((m) => { m.castShadow = true; m.receiveShadow = true; });
        group.add(h);
      } else if (o.k === 'wall') {
        const f = new THREE.Mesh(new THREE.BoxGeometry(o.hw * 2, 2.2, o.hd * 2), lambert('#d0955f'));
        f.position.set(o.x, o.y0 + 0.6, o.z);
        const top = new THREE.Mesh(new THREE.BoxGeometry(o.hw * 2 + 0.2, 0.18, o.hd * 2 + 0.2), lambert('#e8b582'));
        top.position.set(o.x, o.y0 + 1.75, o.z);
        f.castShadow = top.castShadow = true;
        f.receiveShadow = true;
        group.add(f, top);
      }
    }
  }

  function makePickup(type) {
    const g = new THREE.Group();
    const item = new THREE.Group();
    if (type === S.PICK_SOAKER) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.32, 0.26), lambert('#ff9f1c'));
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8), lambert('#40c4ff'));
      tank.rotation.z = Math.PI / 2; tank.position.set(-0.05, 0.3, 0);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.45, 0.2), lambert('#ff6b8b'));
      grip.position.set(-0.25, -0.3, 0);
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 6), lambert('#ffd84d'));
      nozzle.rotation.z = Math.PI / 2; nozzle.position.set(0.6, 0, 0);
      item.add(body, tank, grip, nozzle);
    } else if (type === S.PICK_MEGA) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), lambert('#b06bff'));
      b.scale.y = 1.15;
      const knot = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.2, 6), lambert('#8a45e0'));
      knot.position.y = -0.6; knot.rotation.x = Math.PI;
      item.add(b, knot);
    } else {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.14, 0.6), lambert('#ff7aa8'));
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.14, 0.6), lambert('#ffffff'));
      b2.position.y = 0.14;
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.14, 0.6), lambert('#ff7aa8'));
      c2.position.y = 0.28;
      item.add(a, b2, c2);
    }
    item.position.y = 1;
    item.traverse((m) => { m.castShadow = true; });
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 20), new THREE.MeshBasicMaterial({ color: type === S.PICK_TOWEL ? '#ffd1e3' : type === S.PICK_MEGA ? '#e2c9ff' : '#ffe2b8', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.08;
    g.add(item, glow);
    g.userData.item = item;
    return g;
  }

  function setPickupTaken(i, taken) {
    const m = pickupMeshes[i];
    if (m) m.visible = !taken;
  }

  /* ---------- Splashers ---------- */
  const avatars = new Map();
  const sphere = (r, color, ws, hs) => new THREE.Mesh(new THREE.SphereGeometry(r, ws || 10, hs || 8), lambert(color));

  // Little hats, all sitting on top of the head (about y = 2).
  function makeHat(kind, color) {
    const g = new THREE.Group();
    const add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
    const accent = new THREE.Color(color).offsetHSL(0.5, 0, 0).getStyle();
    let spin = null;
    switch (S.HATS[kind] && S.HATS[kind].id) {
      case 'cap': {
        add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), lambert(accent)), 0, 1.78, 0).scale.set(1.05, 0.7, 1.05);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.42), lambert(accent)), 0, 1.8, 0.5);
        add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), lambert('#ffffff')), 0, 2.13, 0);
        break;
      }
      case 'crown': {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.34, 0.26, 7, 1, true), lambert('#ffd84d', { side: THREE.DoubleSide })), 0, 2.02, 0);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          add(new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 4), lambert('#ffd84d')), Math.sin(a) * 0.35, 2.24, Math.cos(a) * 0.35);
        }
        add(new THREE.Mesh(new THREE.OctahedronGeometry(0.07), lambert('#ff4f82')), 0, 2.03, 0.36);
        break;
      }
      case 'bunny': {
        for (const sx of [-1, 1]) {
          const ear = add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), lambert('#ffffff')), sx * 0.22, 2.32, -0.05);
          ear.scale.set(0.16, 0.5, 0.1);
          ear.rotation.z = -sx * 0.18;
          const inner = add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), lambert('#ffb3cb')), sx * 0.22, 2.32, 0.0);
          inner.scale.set(0.09, 0.38, 0.06);
          inner.rotation.z = -sx * 0.18;
        }
        break;
      }
      case 'flower': {
        const cx = 0.3, cy = 1.9, cz = 0.25;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), lambert('#ff8fb8')), cx + Math.cos(a) * 0.12, cy + Math.sin(a) * 0.12, cz);
        }
        add(new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), lambert('#ffd84d')), cx, cy, cz + 0.04);
        break;
      }
      case 'propeller': {
        add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), lambert('#ff4f82')), 0, 1.84, 0).scale.y = 0.6;
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 5), lambert('#555555')), 0, 2.2, 0);
        spin = new THREE.Group();
        spin.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.14), lambert('#ffd84d')));
        spin.add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.9), lambert('#40c4ff')));
        add(spin, 0, 2.32, 0);
        break;
      }
      case 'party': {
        const cone = add(new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.62, 10), lambert(accent)), 0.08, 2.22, 0);
        cone.rotation.z = -0.15;
        add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), lambert('#ffffff')), 0.13, 2.55, 0);
        add(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 5, 12), lambert('#ffffff')), 0.06, 2.05, 0).rotation.x = Math.PI / 2;
        break;
      }
      case 'frog': {
        for (const sx of [-1, 1]) {
          add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), lambert('#5fd68a')), sx * 0.22, 2.02, 0.12);
          add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), lambert('#ffffff')), sx * 0.22, 2.06, 0.24);
          add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), lambert('#2b2340')), sx * 0.22, 2.07, 0.32);
        }
        break;
      }
      case 'duck': {
        add(new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), lambert('#ffd84d')), 0, 2.08, -0.05).scale.set(1, 0.75, 1.25);
        add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), lambert('#ffd84d')), 0, 2.3, 0.15);
        add(new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 6), lambert('#ff9f1c')), 0, 2.28, 0.32).rotation.x = Math.PI / 2;
        for (const sx of [-1, 1]) add(new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), lambert('#2b2340')), sx * 0.08, 2.34, 0.27);
        break;
      }
      default:
    }
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    return { g, spin };
  }

  function addAvatar(id, color, hat) {
    removeAvatar(id);
    const base = new THREE.Color(color);
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const mat = lambert(color);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 0.72, 4, 12), mat);
    torso.position.y = 1.0;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), lambert(base.clone().lerp(new THREE.Color('#ffffff'), 0.55)));
    belly.scale.set(0.95, 1.05, 0.5);
    belly.position.set(0, 0.85, 0.36);
    const eyes = new THREE.Group();
    for (const sx of [-1, 1]) {
      const white = sphere(0.18, '#ffffff');
      white.position.set(sx * 0.22, 1.42, 0.5);
      const pupil = sphere(0.1, '#2b2340', 8, 6);
      pupil.position.set(sx * 0.22, 1.42, 0.65);
      const shine = sphere(0.035, '#ffffff', 6, 4);
      shine.position.set(sx * 0.22 + 0.03, 1.46, 0.74);
      eyes.add(white, pupil, shine);
    }
    const cheekMat = lambert('#ff9cb5');
    const cheeks = new THREE.Group();
    for (const sx of [-1, 1]) {
      const ck = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), cheekMat);
      ck.scale.set(1, 0.6, 0.4);
      ck.position.set(sx * 0.38, 1.24, 0.52);
      cheeks.add(ck);
    }
    const footMat = lambert(base.clone().multiplyScalar(0.7));
    const footL = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), footMat);
    footL.scale.set(1, 0.6, 1.4);
    const footR = footL.clone();
    footL.position.set(-0.28, 0.12, 0);
    footR.position.set(0.28, 0.12, 0);
    const handL = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), mat);
    const handR = handL.clone();
    handL.position.set(-0.7, 0.95, 0.1);
    handR.position.set(0.7, 0.95, 0.1);
    body.add(torso, belly, eyes, cheeks, footL, footR, handL, handR);
    const hatObj = makeHat(hat | 0, color);
    body.add(hatObj.g);

    // What they hold in their right hand.
    const held = [];
    const hb = sphere(0.26, base.clone().lerp(new THREE.Color('#ffffff'), 0.3).getStyle());
    hb.scale.y = 1.15;
    held.push(hb);
    const hs = new THREE.Group();
    const hsb = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.7), lambert('#ff9f1c'));
    const hst = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.32, 8), lambert('#40c4ff'));
    hst.position.set(0, 0.22, -0.05);
    hs.add(hsb, hst);
    hs.position.z = 0.25;
    held.push(hs);
    const hm = sphere(0.45, '#b06bff');
    hm.position.y = 0.25;
    held.push(hm);
    for (const h of held) { h.visible = false; handR.add(h); }

    // Umbrella for floating down at the start.
    const umbrella = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.7, 8, 1, true), lambert(color, { side: THREE.DoubleSide }));
    canopy.position.y = 3.35;
    const stripe = new THREE.Mesh(new THREE.ConeGeometry(1.52, 0.72, 8, 1, true, 0, Math.PI / 4), lambert('#ffffff', { side: THREE.DoubleSide }));
    stripe.position.y = 3.35;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 5), lambert('#6b4f3a'));
    stick.position.set(0.55, 2.4, 0.1);
    canopy.position.x = stripe.position.x = 0.55;
    umbrella.add(canopy, stripe, stick);
    umbrella.visible = false;
    root.add(umbrella);

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.75, 16), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.22, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    scene.add(shadow);

    root.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    scene.add(root);
    const a = {
      id, root, body, mat, base, eyes, cheeks, footL, footR, handL, handR, held, umbrella, shadow, hat: hatObj.g, prop: hatObj.spin,
      phase: Math.random() * 6, yaw: 0, throwT: 0, hitT: 0, deadT: -1, hp: S.MAX_HP, dripT: 0, landT: 0, wasAir: false
    };
    avatars.set(id, a);
    return a;
  }

  function removeAvatar(id) {
    const a = avatars.get(id);
    if (!a) return;
    scene.remove(a.root, a.shadow);
    a.root.traverse((m) => { if (m.geometry) m.geometry.dispose(); });
    avatars.delete(id);
  }

  function clearAvatars() { for (const id of [...avatars.keys()]) removeAvatar(id); }

  const WET = new THREE.Color('#2f5f9e');
  const tmpC = new THREE.Color();

  // st: { x, y, z, yaw, moving, dash, alive, hp, umbrella, weapon, ground }
  function updateAvatar(id, st, dt, gh) {
    const a = avatars.get(id);
    if (!a) return;
    a.root.position.set(st.x, st.y, st.z);
    let dy = st.yaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    a.yaw += dy * Math.min(1, dt * 16);
    a.root.rotation.y = a.yaw;
    a.shadow.position.set(st.x, gh + 0.06, st.z);
    const air = st.y - gh;
    a.shadow.scale.setScalar(Math.max(0.3, 1 - air * 0.05));
    a.shadow.visible = st.alive;

    if (!st.alive) {
      // A puddle with a little floating soul-bubble.
      if (a.deadT < 0) a.deadT = 0;
      a.deadT += dt;
      const t = Math.min(1, a.deadT * 3);
      a.body.scale.set(1 + t * 0.8, Math.max(0.06, 1 - t), 1 + t * 0.8);
      a.body.position.y = 0;
      a.eyes.visible = a.cheeks.visible = a.hat.visible = false;
      a.umbrella.visible = false;
      a.mat.color.copy(a.base).lerp(WET, 0.6);
      a.root.visible = a.deadT < 6;
      return;
    }
    if (a.deadT >= 0) {
      a.deadT = -1;
      a.root.visible = true;
      a.eyes.visible = a.cheeks.visible = a.hat.visible = true;
      a.body.scale.set(1, 1, 1);
    }

    // Wetter = darker and bluer.
    if (st.hp !== undefined) a.hp = st.hp;
    const wet = (1 - a.hp / S.MAX_HP) * 0.45;
    tmpC.copy(a.base).lerp(WET, wet);
    if (a.hitT > 0) tmpC.lerp(new THREE.Color('#ffffff'), a.hitT * 2);
    a.mat.color.copy(tmpC);

    a.umbrella.visible = !!st.umbrella && air > 0.3;
    for (let i = 0; i < 3; i++) a.held[i].visible = !a.umbrella.visible && i === (st.weapon || 0);

    let sx = 1, sy = 1, sz = 1, by = 0, lean = 0;
    if (st.moving && air < 0.2) {
      a.phase += dt * 15;
      const s = Math.sin(a.phase);
      a.footL.position.z = s * 0.28;
      a.footR.position.z = -s * 0.28;
      a.footL.position.y = 0.12 + Math.max(0, s) * 0.12;
      a.footR.position.y = 0.12 + Math.max(0, -s) * 0.12;
      by = Math.abs(Math.cos(a.phase)) * 0.14;
      lean = 0.14;
      a.handL.position.z = 0.1 - s * 0.2;
    } else {
      a.phase += dt * 3;
      a.footL.position.z += (0 - a.footL.position.z) * Math.min(1, dt * 10);
      a.footR.position.z += (0 - a.footR.position.z) * Math.min(1, dt * 10);
      a.footL.position.y = a.footR.position.y = 0.12;
      sy = 1 + Math.sin(a.phase) * 0.025;
      sx = sz = 1 - Math.sin(a.phase) * 0.012;
    }
    if (air > 0.3) {
      a.handL.position.y = 1.35;
      if (!a.umbrella.visible) a.handR.position.y = 1.35;
      sy *= 1.06; sx *= 0.96; sz *= 0.96;
      a.wasAir = true;
    } else {
      a.handL.position.y = 0.95;
      if (a.wasAir) { a.landT = 0.18; a.wasAir = false; }
    }
    if (a.landT > 0) {
      a.landT -= dt;
      const k = a.landT / 0.18;
      sy *= 1 - 0.25 * k; sx *= 1 + 0.18 * k; sz *= 1 + 0.18 * k;
    }
    if (st.dash) { sz *= 1.35; sx *= 0.85; sy *= 0.85; lean = 0.35; }
    if (a.hitT > 0) {
      a.hitT -= dt;
      const k = Math.max(0, a.hitT / 0.3);
      sy *= 1 - 0.2 * k; sx *= 1 + 0.15 * k; sz *= 1 + 0.15 * k;
    }
    // Throwing arm.
    if (a.throwT > 0) {
      a.throwT -= dt;
      const k = Math.max(0, a.throwT / 0.25);
      a.handR.position.set(0.6, 0.95 + Math.sin(k * Math.PI) * 0.7, 0.1 + (1 - k) * 0.5);
    } else if (!a.umbrella.visible) {
      a.handR.position.set(0.7, air > 0.3 ? 1.35 : 0.95, 0.15);
    } else {
      a.handR.position.set(0.55, 1.6, 0.1);
    }
    if (a.prop) a.prop.rotation.y += dt * (st.moving || air > 0.3 ? 22 : 5);
    a.body.scale.set(sx, sy, sz);
    a.body.position.y = by;
    a.body.rotation.x = lean;

    // Drips when very wet.
    if (a.hp < 55) {
      a.dripT -= dt;
      if (a.dripT <= 0) {
        a.dripT = 0.15 + (a.hp / 55) * 0.5;
        droplet(st.x + (Math.random() - 0.5) * 0.9, st.y + 0.8 + Math.random() * 1.2, st.z + (Math.random() - 0.5) * 0.9, 0, 0.5, 0, 0.5);
      }
    }
  }

  function avatarThrow(id) { const a = avatars.get(id); if (a) a.throwT = 0.25; }
  function avatarHit(id) { const a = avatars.get(id); if (a) a.hitT = 0.3; }

  /* ---------- Balloons and droplets in flight ---------- */
  const shots = new Map();
  const shotShadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.2, depthWrite: false });
  const dropMat = lambert('#8ae4ff', { transparent: true, opacity: 0.9 });
  const dropGeo = new THREE.SphereGeometry(1, 6, 4);
  const ballGeo = new THREE.SphereGeometry(1, 12, 9);
  const shadowGeo = new THREE.CircleGeometry(1, 14);

  function addShot(key, w, color) {
    const wp = S.WEAPONS[w];
    let mesh;
    if (w === S.W_SOAKER) {
      mesh = new THREE.Mesh(dropGeo, dropMat);
      mesh.scale.set(wp.size, wp.size, wp.size * 2.4);
    } else {
      const c = new THREE.Color(w === S.W_MEGA ? '#b06bff' : color).lerp(new THREE.Color('#ffffff'), w === S.W_MEGA ? 0.1 : 0.3);
      mesh = new THREE.Mesh(ballGeo, lambert(c, { transparent: true, opacity: 0.95 }));
      mesh.scale.set(wp.size, wp.size * 1.12, wp.size);
      mesh.castShadow = true;
    }
    scene.add(mesh);
    let shadow = null;
    if (wp.arc) {
      shadow = new THREE.Mesh(shadowGeo, shotShadowMat);
      shadow.rotation.x = -Math.PI / 2;
      scene.add(shadow);
    }
    shots.set(key, { mesh, shadow, w, px: null, pz: null, t: 0 });
  }

  function moveShot(key, x, y, z, gh, dt) {
    const s = shots.get(key);
    if (!s) return;
    if (s.w === S.W_SOAKER && s.px !== null) {
      s.mesh.lookAt(x + (x - s.px), y, z + (z - s.pz));
    } else {
      s.t += dt;
      s.mesh.rotation.set(Math.sin(s.t * 12) * 0.2, s.t * 3, Math.cos(s.t * 10) * 0.2);
    }
    s.px = x; s.pz = z;
    s.mesh.position.set(x, y, z);
    if (s.shadow) {
      s.shadow.position.set(x, gh + 0.07, z);
      s.shadow.scale.setScalar(S.WEAPONS[s.w].size * Math.max(0.6, 1.6 - (y - gh) * 0.05));
    }
  }

  function removeShot(key) {
    const s = shots.get(key);
    if (!s) return;
    scene.remove(s.mesh);
    if (s.shadow) scene.remove(s.shadow);
    if (s.w !== S.W_SOAKER) s.mesh.material.dispose();
    shots.delete(key);
  }

  function clearShots() { for (const k of [...shots.keys()]) removeShot(k); }

  /* ---------- Splashes ---------- */
  const MAXD = mobile ? 400 : 800;
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 6, 4), lambert('#86dcff', { transparent: true, opacity: 0.9 }), MAXD);
  drops.frustumCulled = false;
  scene.add(drops);
  const dp = new Float32Array(MAXD * 3), dv = new Float32Array(MAXD * 3), dl = new Float32Array(MAXD), ds = new Float32Array(MAXD);
  let dNext = 0;
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAXD; i++) drops.setMatrixAt(i, hide);

  function droplet(x, y, z, vx, vy, vz, size) {
    const i = dNext;
    dNext = (dNext + 1) % MAXD;
    dp[i * 3] = x; dp[i * 3 + 1] = y; dp[i * 3 + 2] = z;
    dv[i * 3] = vx; dv[i * 3 + 1] = vy; dv[i * 3 + 2] = vz;
    dl[i] = 0.6 + Math.random() * 0.5;
    ds[i] = size || 1;
  }

  const rings = [];
  const ringGeo = new THREE.RingGeometry(0.8, 1, 32);
  const spotGeo = new THREE.CircleGeometry(1, 20);
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#e8fbff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    scene.add(m);
    rings.push({ m, t: 1, r: 1 });
  }
  const spots = [];
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(spotGeo, new THREE.MeshBasicMaterial({ color: '#1d4f8f', transparent: true, opacity: 0, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    scene.add(m);
    spots.push({ m, t: 99 });
  }
  let ringNext = 0, spotNext = 0;

  function splash(x, y, z, radius, gh) {
    const n = Math.min(70, Math.round(14 + radius * 8));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (0.4 + Math.random()) * radius * 2.2;
      droplet(x, y + 0.1, z, Math.cos(a) * sp, 3 + Math.random() * 6 + radius, Math.sin(a) * sp, 0.7 + Math.random() * 0.9);
    }
    const r = rings[ringNext];
    ringNext = (ringNext + 1) % rings.length;
    r.t = 0; r.r = radius; r.m.visible = true;
    r.m.position.set(x, Math.max(gh, y - 0.5) + 0.12, z);
    if (y - gh < 1.5) {
      const s = spots[spotNext];
      spotNext = (spotNext + 1) % spots.length;
      s.t = 0;
      s.m.visible = true;
      s.m.position.set(x, gh + 0.05 + spotNext * 0.001, z);
      s.m.scale.setScalar(radius * 0.8);
    }
  }

  function smallSplash(x, y, z) {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      droplet(x, y, z, Math.cos(a) * 2, 2 + Math.random() * 3, Math.sin(a) * 2, 0.6);
    }
  }

  const m4 = new THREE.Matrix4();
  function stepFx(dt) {
    for (let i = 0; i < MAXD; i++) {
      if (dl[i] <= 0) continue;
      dl[i] -= dt;
      if (dl[i] <= 0) { drops.setMatrixAt(i, hide); continue; }
      dv[i * 3 + 1] -= 22 * dt;
      dp[i * 3] += dv[i * 3] * dt;
      dp[i * 3 + 1] += dv[i * 3 + 1] * dt;
      dp[i * 3 + 2] += dv[i * 3 + 2] * dt;
      const s = ds[i] * Math.min(1, dl[i] * 3);
      m4.makeScale(s, s, s).setPosition(dp[i * 3], dp[i * 3 + 1], dp[i * 3 + 2]);
      drops.setMatrixAt(i, m4);
    }
    drops.instanceMatrix.needsUpdate = true;
    for (const r of rings) {
      if (!r.m.visible) continue;
      r.t += dt * 2.2;
      if (r.t >= 1) { r.m.visible = false; continue; }
      r.m.scale.setScalar(0.3 + r.t * r.r);
      r.m.material.opacity = 0.9 * (1 - r.t);
    }
    for (const s of spots) {
      if (!s.m.visible) continue;
      s.t += dt;
      if (s.t > 8) { s.m.visible = false; continue; }
      s.m.material.opacity = 0.28 * Math.min(1, (8 - s.t) / 3);
    }
  }

  /* ---------- Storm ---------- */
  const stormTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(90,80,200,0.55)';
    g.fillRect(0, 0, 128, 256);
    g.strokeStyle = 'rgba(220,235,255,0.55)';
    g.lineWidth = 2;
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * 128, y = Math.random() * 256;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 3, y + 18); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(40, 3);
    return t;
  })();
  const stormWall = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 70, 96, 1, true),
    new THREE.MeshBasicMaterial({ map: stormTex, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false, fog: false })
  );
  stormWall.visible = false;
  scene.add(stormWall);
  const nextRing = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 128), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  nextRing.rotation.x = -Math.PI / 2;
  nextRing.visible = false;
  scene.add(nextRing);

  // Rain falls everywhere outside the safe circle, near the camera.
  const RAIN = mobile ? 350 : 700;
  const rainPos = new Float32Array(RAIN * 6);
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#d8e8ff', transparent: true, opacity: 0.6 }));
  rain.frustumCulled = false;
  scene.add(rain);
  const rainSeed = new Float32Array(RAIN * 3);
  for (let i = 0; i < RAIN; i++) { rainSeed[i * 3] = Math.random(); rainSeed[i * 3 + 1] = Math.random(); rainSeed[i * 3 + 2] = Math.random(); }
  let storm = null;
  let rainT = 0;

  function setStorm(st) {
    storm = st;
    if (!st) { stormWall.visible = false; nextRing.visible = false; return; }
    stormWall.visible = true;
    stormWall.position.set(st.x, 20, st.z);
    stormWall.scale.set(Math.max(0.5, st.r), 1, Math.max(0.5, st.r));
    stormTex.repeat.x = Math.max(4, Math.round(st.r / 3));
    nextRing.visible = st.nr > 0.5 && (st.nr < st.r - 0.5);
    nextRing.position.set(st.nx, 2.2, st.nz);
    nextRing.scale.setScalar(st.nr);
  }

  function stepRain(dt) {
    rainT += dt;
    stormTex.offset.y = -rainT * 1.2;
    let any = false;
    const cx = camTarget.x, cz = camTarget.z;
    for (let i = 0; i < RAIN; i++) {
      const x = cx + (rainSeed[i * 3] - 0.5) * 90;
      const z = cz + (rainSeed[i * 3 + 1] - 0.5) * 70 - 8;
      const y = 30 - ((rainSeed[i * 3 + 2] * 30 + rainT * 28) % 30);
      const outside = storm && Math.hypot(x - storm.x, z - storm.z) > storm.r;
      const o = i * 6;
      if (outside) {
        any = true;
        rainPos[o] = x; rainPos[o + 1] = y; rainPos[o + 2] = z;
        rainPos[o + 3] = x - 0.15; rainPos[o + 4] = y - 1.3; rainPos[o + 5] = z;
      } else {
        rainPos[o + 1] = rainPos[o + 4] = -100;
      }
    }
    rain.visible = any;
    rainGeo.attributes.position.needsUpdate = true;
  }

  /* ---------- Aiming guide ---------- */
  const aimRing = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  aimRing.rotation.x = -Math.PI / 2;
  scene.add(aimRing);
  const aimFill = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.16, depthWrite: false }));
  aimFill.rotation.x = -Math.PI / 2;
  scene.add(aimFill);
  const DOTS = 16;
  const aimDots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8 }), DOTS);
  aimDots.frustumCulled = false;
  scene.add(aimDots);
  // Always drawn on top, so hills and trees never hide where you're aiming.
  for (const m of [aimRing, aimFill, aimDots]) { m.material.depthTest = false; m.renderOrder = 10; }

  // guide: null, or { p: shot params (shotPath already run), color }
  const tmpP = { x: 0, y: 0, z: 0 };
  function setAim(guide, w) {
    const show = !!guide;
    aimRing.visible = aimFill.visible = show && guide.p.arc;
    aimDots.visible = show;
    if (!show) return;
    const p = guide.p;
    if (p.arc) {
      const r = S.WEAPONS[p.w].splash;
      aimRing.position.set(p.tx, p.ty + 0.1, p.tz);
      aimRing.scale.setScalar(r);
      aimFill.position.set(p.tx, p.ty + 0.09, p.tz);
      aimFill.scale.setScalar(r);
    }
    const total = p.arc ? p.T : p.life;
    let end = total;
    if (!p.arc) {
      const hit = S.shotHitsWorld(w, p, 0, total, tmpP);
      if (hit > 0) end = hit;
    }
    for (let i = 0; i < DOTS; i++) {
      const t = ((i + 1) / (DOTS + 1)) * end;
      S.shotPos(p, t, tmpP);
      m4.makeTranslation(tmpP.x, tmpP.y, tmpP.z);
      aimDots.setMatrixAt(i, m4);
    }
    aimDots.instanceMatrix.needsUpdate = true;
  }

  /* ---------- Camera ---------- */
  const camTarget = new THREE.Vector3(0, 0, 0);
  const camCur = new THREE.Vector3(0, 0, 0);
  let orbit = true, orbitA = 0;
  let width = 1, height = 1;
  let shake = 0;

  function resize() {
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function follow(x, y, z, snap) {
    orbit = false;
    camTarget.set(x, y, z);
    if (snap) camCur.copy(camTarget);
  }
  function setOrbit() { orbit = true; }
  function addShake(v) { shake = Math.min(1, shake + v); }

  let stormTint = 0;
  function render(dt, time, outside) {
    stepFx(dt);
    stepRain(dt);
    for (const m of pickupMeshes) {
      if (!m.visible) continue;
      const it = m.userData.item;
      it.rotation.y = time * 1.6 + m.userData.phase;
      it.position.y = 1 + Math.sin(time * 2.4 + m.userData.phase) * 0.15;
    }
    water.position.y = Math.sin(time * 0.8) * 0.06;

    stormTint += ((outside ? 1 : 0) - stormTint) * Math.min(1, dt * 3);
    scene.background.copy(SKY).lerp(STORM_SKY, stormTint);
    scene.fog.color.copy(scene.background);

    if (orbit) {
      orbitA += dt * 0.06;
      camera.position.set(Math.cos(orbitA) * 95, 62, Math.sin(orbitA) * 95);
      camera.lookAt(0, 0, 0);
      camCur.set(0, 0, 0);
    } else {
      camCur.lerp(camTarget, 1 - Math.exp(-dt * 9));
      const portrait = height > width;
      const off = portrait ? [0, 33, 17] : [0, 24, 16.5];
      const ahead = portrait ? -4 : -1;
      camera.position.set(camCur.x + off[0], camCur.y + off[1], camCur.z + ahead + off[2]);
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake * 0.8;
        camera.position.y += (Math.random() - 0.5) * shake * 0.8;
        shake = Math.max(0, shake - dt * 3);
      }
      camera.lookAt(camCur.x, camCur.y + 1, camCur.z + ahead);
    }
    sun.position.set(camCur.x + 30, camCur.y + 60, camCur.z + 22);
    sun.target.position.copy(camCur);
    renderer.render(scene, camera);
  }

  // Where on the ground (at height y) is this screen point?
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitP = new THREE.Vector3();
  function groundAt(clientX, clientY, y) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    plane.constant = -y;
    return ray.ray.intersectPlane(plane, hitP) ? { x: hitP.x, z: hitP.z } : null;
  }

  const proj = new THREE.Vector3();
  function toScreen(x, y, z) {
    proj.set(x, y, z).project(camera);
    if (proj.z > 1) return null;
    return { x: (proj.x * 0.5 + 0.5) * width, y: (-proj.y * 0.5 + 0.5) * height };
  }

  return {
    setWorld, setPickupTaken, addAvatar, removeAvatar, clearAvatars, updateAvatar, avatarThrow, avatarHit,
    addShot, moveShot, removeShot, clearShots, splash, smallSplash, setStorm, setAim,
    follow, setOrbit, addShake, render, groundAt, toScreen, resize
  };
}
