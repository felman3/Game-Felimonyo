// Finding other players.
//
// PeerJS links browsers directly (WebRTC). Its free cloud server only
// introduces them, so there is no game server: one player's browser hosts
// each match and everyone else connects to it.
//
// Quick Play uses numbered public rooms ("qp-1", "qp-2", ...). We try to join
// room 1; if nobody hosts it we become its host; if it's full we try room 2.

/* global Peer */

export const CFG = Object.assign(
  { peerOptions: {}, idPrefix: 'splashroyale-', turnCredentialsUrl: '', quickRooms: 30 },
  window.GAME_CONFIG || {}
);

const err = (type, message) => Object.assign(new Error(message || type), { type });

export async function loadIceServers() {
  if (!CFG.turnCredentialsUrl || CFG._iceLoaded) return;
  const ctrl = window.AbortController ? new AbortController() : null;
  const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, 5000);
  try {
    const res = await fetch(CFG.turnCredentialsUrl, ctrl ? { signal: ctrl.signal } : {});
    const list = await res.json();
    const servers = Array.isArray(list) ? list : (list && Array.isArray(list.iceServers) ? list.iceServers : []);
    if (servers.length) {
      const config = Object.assign({}, CFG.peerOptions.config);
      config.iceServers = servers.concat(config.iceServers || []);
      CFG.peerOptions = Object.assign({}, CFG.peerOptions, { config });
      CFG._iceLoaded = true;
    }
  } catch (e) {
    console.warn('couldn\'t load TURN servers; trying without them', e);
  } finally {
    clearTimeout(timer);
  }
}

// Register with the PeerJS server, optionally under a chosen id.
export function openPeer(id) {
  return new Promise((resolve, reject) => {
    if (typeof Peer === 'undefined') { reject(err('no-peerjs', 'The game didn\'t load completely.')); return; }
    const p = new Peer(id, CFG.peerOptions);
    let done = false;
    const finish = (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (e) { try { p.destroy(); } catch (x) { /* ignore */ } reject(e); } else resolve(p);
    };
    const timer = setTimeout(() => finish(err('timeout', 'The connection service didn\'t answer.')), 12000);
    p.on('open', () => finish());
    p.on('error', (e) => finish(e));
    // Lost the PeerJS server (not the other players): reconnect so new players can still find us.
    p.on('disconnected', () => {
      setTimeout(() => { if (!p.destroyed && p.disconnected) { try { p.reconnect(); } catch (x) { /* ignore */ } } }, 1500);
    });
  });
}

// Open a data channel to another peer. Rejects with type 'missing' if nobody has that id.
export function connectTo(peer, id, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const c = peer.connect(id, { reliable: true, serialization: 'json' });
    const onErr = (e) => {
      if (e && e.type === 'peer-unavailable' && String(e.message || '').indexOf(id) !== -1) finish(err('missing'));
    };
    const finish = (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.off('error', onErr);
      if (e) { try { c.close(); } catch (x) { /* ignore */ } reject(e); } else resolve(c);
    };
    const timer = setTimeout(() => finish(err('timeout')), timeoutMs || 9000);
    peer.on('error', onErr);
    c.on('open', () => finish());
    c.on('close', () => finish(err('missing')));
    c.on('error', (e) => finish(e));
  });
}

// Say hello to a host and wait for its answer.
function handshake(conn, profile, extra) {
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); conn.off('data', onData); conn.off('close', onClose); };
    const timer = setTimeout(() => { done(); reject(err('timeout')); }, 6000);
    // Closed before saying hello back (a host that's shutting down): give up right away.
    const onClose = () => { done(); reject(err('missing')); };
    const onData = (m) => {
      if (!m || (m.t !== 'welcome' && m.t !== 'full')) return;
      done();
      if (m.t === 'full') reject(err('full'));
      else resolve(m);
    };
    conn.on('data', onData);
    conn.on('close', onClose);
    conn.send(Object.assign({ t: 'hi', name: profile.name, color: profile.color, hat: profile.hat, v: 1 }, extra));
  });
}

const quickId = (n) => CFG.idPrefix + 'qp-' + n;
export const roomId = (code) => CFG.idPrefix + 'room-' + code.toLowerCase();

// The PeerJS id a room's host registers under.
export const peerIdFor = (code) => (/^qp-\d+$/.test(code) ? quickId(code.slice(3)) : roomId(code));

export function newRoomCode() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

// Join a host by its peer id. Resolves { peer, conn, welcome }.
export async function joinId(peer, id, profile, extra) {
  const conn = await connectTo(peer, id);
  try {
    const welcome = await handshake(conn, profile, extra);
    return { conn, welcome };
  } catch (e) {
    try { conn.close(); } catch (x) { /* ignore */ }
    throw e;
  }
}

export async function quickPlay(profile, onStatus, isCancelled) {
  await loadIceServers();
  let guestPeer = null;
  try {
    for (let n = 1; n <= CFG.quickRooms; n++) {
      if (isCancelled()) throw err('cancelled');
      onStatus(n === 1 ? 'Looking for a match…' : 'Looking for a match… (island ' + n + ')');
      if (!guestPeer || guestPeer.destroyed) guestPeer = await openPeer();
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { conn, welcome } = await joinId(guestPeer, quickId(n), profile, { avoidBusy: true });
          return { role: 'guest', peer: guestPeer, conn, welcome };
        } catch (e) {
          if (isCancelled()) throw err('cancelled');
          if (e.type !== 'missing') break; // full or unreachable: try the next island
          // Nobody hosts this island. Host it ourselves.
          try {
            const hostPeer = await openPeer(quickId(n));
            try { guestPeer.destroy(); } catch (x) { /* ignore */ }
            return { role: 'host', peer: hostPeer, quick: true, code: 'qp-' + n };
          } catch (e2) {
            if (e2.type !== 'unavailable-id') throw e2;
            // Someone else just became its host; join them on the second attempt.
          }
        }
      }
    }
    throw err('all-full', 'Every public island is full right now. Try again in a minute, or create a room.');
  } catch (e) {
    if (guestPeer) { try { guestPeer.destroy(); } catch (x) { /* ignore */ } }
    throw e;
  }
}

export async function createRoom() {
  await loadIceServers();
  for (let i = 0; i < 5; i++) {
    const code = newRoomCode();
    try {
      const peer = await openPeer(roomId(code));
      return { role: 'host', peer, quick: false, code };
    } catch (e) {
      if (e.type !== 'unavailable-id') throw e;
    }
  }
  throw err('busy', 'Couldn\'t make a room code. Try again.');
}

export async function joinRoom(code, profile) {
  await loadIceServers();
  const peer = await openPeer();
  try {
    const { conn, welcome } = await joinId(peer, roomId(code), profile);
    return { role: 'guest', peer, conn, welcome };
  } catch (e) {
    try { peer.destroy(); } catch (x) { /* ignore */ }
    if (e.type === 'missing') throw err('missing', 'That room is closed or the code is wrong.');
    if (e.type === 'full') throw err('full', 'That room is full.');
    if (e.type === 'timeout') throw err('timeout', 'Couldn\'t reach the room\'s host. One of your networks may be blocking direct connections.');
    throw e;
  }
}

export function errorText(e) {
  const t = e && e.type;
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') {
    return 'Can\'t reach the connection service. Check your internet connection, then try again — or play Practice with bots meanwhile.';
  }
  if (t === 'browser-incompatible') return 'This browser can\'t play online. Try a recent Chrome, Safari, Edge or Firefox.';
  return (e && e.message) || 'Something went wrong. Try again.';
}
