// End-to-end check of the lobby and the signalling socket against a running
// `npm run dev` of packages/backend (bun on :30050). Two fake peers: create a room, join,
// exchange offer / answer / ICE both ways, the host leaves, the other peer
// becomes host; then the empty room vanishes from the lobby after the grace
// (CC_EMPTY_GRACE_MS=5000 in .env). Node 22: global WebSocket.
//   node scripts/test-signal.mjs [http://localhost:30050]
const base = process.argv[2] ?? 'http://localhost:30050';
const wsBase = base.replace(/^http/, 'ws');

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};

function connect(roomId, name) {
  const ws = new WebSocket(`${wsBase}/ws/room/${roomId}`);
  const queue = [];
  const waiters = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    const i = waiters.findIndex((w) => w.pred(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  const expect = (pred, label, timeoutMs = 5000) =>
    new Promise((resolve, reject) => {
      const i = queue.findIndex(pred);
      if (i >= 0) return resolve(queue.splice(i, 1)[0]);
      const timer = setTimeout(() => reject(new Error(`${name}: timed out waiting for ${label}`)), timeoutMs);
      waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    });
  const send = (msg) => ws.send(JSON.stringify(msg));
  const open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error(`${name}: socket error`)), { once: true });
  });
  return { ws, send, expect, open, name };
}

const started = Date.now();
const health = await fetch(`${base}/health_check`).then((r) => r.json());
if (health.status !== 'ok') fail('health_check');

const created = await fetch(`${base}/api/rooms`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ mode: 'dm', mapId: 'kolhoz_old_summer', mapName: 'Kolhoz', host: 'Alice', maxPlayers: 4 }),
}).then((r) => r.json());
if (created.status !== 'ok' || typeof created.id !== 'string') fail(`create: ${JSON.stringify(created)}`);
const roomId = created.id;
console.log('room', roomId);

const bad = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'nope' }) });
if (bad.status !== 400) fail(`bad create should be 400, got ${bad.status}`);

const ice = await fetch(`${base}/api/ice`).then((r) => r.json());
if (!Array.isArray(ice.iceServers) || ice.iceServers.length === 0) fail('ice servers');

const a = connect(roomId, 'alice');
await a.open;
a.send({ t: 'join', name: 'Alice', hull: 'Hunter', turret: 'Smoky' });
const welcomeA = await a.expect((m) => m.t === 'welcome', 'welcome A');
if (welcomeA.hostId !== welcomeA.peerId || welcomeA.peers.length !== 0 || welcomeA.room.id !== roomId) fail(`welcome A: ${JSON.stringify(welcomeA)}`);
console.log('alice', welcomeA.peerId, 'host epoch', welcomeA.hostEpoch);

const b = connect(roomId, 'bob');
await b.open;
b.send({ t: 'join', name: 'Bob', hull: 'Wasp', turret: 'Twins', team: 'blue' });
const welcomeB = await b.expect((m) => m.t === 'welcome', 'welcome B');
if (welcomeB.hostId !== welcomeA.peerId || welcomeB.peers.length !== 1 || welcomeB.peers[0].peerId !== welcomeA.peerId) fail(`welcome B: ${JSON.stringify(welcomeB)}`);
const joined = await a.expect((m) => m.t === 'peerJoined', 'peerJoined at A');
if (joined.peer.peerId !== welcomeB.peerId || joined.rejoined) fail('peerJoined');
console.log('bob', welcomeB.peerId);

const listed = await fetch(`${base}/api/rooms?mode=dm`).then((r) => r.json());
const row = listed.rooms.find((r) => r.id === roomId);
if (row == null || row.players !== 2 || row.host !== 'Alice') fail(`listing: ${JSON.stringify(listed)}`);

// Signalling both ways: the relay stamps `from` and passes the payload untouched.
a.send({ t: 'signal', to: welcomeB.peerId, kind: 'offer', payload: { type: 'offer', sdp: 'v=0 fake-sdp-from-alice' } });
const offer = await b.expect((m) => m.t === 'signal' && m.kind === 'offer', 'offer at B');
if (offer.from !== welcomeA.peerId || offer.payload.sdp !== 'v=0 fake-sdp-from-alice') fail('offer relay');
b.send({ t: 'signal', to: welcomeA.peerId, kind: 'answer', payload: { type: 'answer', sdp: 'v=0 fake-sdp-from-bob' } });
const answer = await a.expect((m) => m.t === 'signal' && m.kind === 'answer', 'answer at A');
if (answer.from !== welcomeB.peerId) fail('answer relay');
b.send({ t: 'signal', to: welcomeA.peerId, kind: 'ice', payload: { candidate: 'candidate:1 1 udp 2122260223 192.168.1.10 54321 typ host', sdpMid: '0' } });
const cand = await a.expect((m) => m.t === 'signal' && m.kind === 'ice', 'ice at A');
if (!cand.payload.candidate.includes('typ host')) fail('ice relay');
// A signal to a stranger is refused, the sender is told, nothing is relayed.
a.send({ t: 'signal', to: 'p_000000000000', kind: 'ice', payload: {} });
const unknown = await a.expect((m) => m.t === 'error', 'error for unknown peer');
if (unknown.code !== 'unknown_peer') fail(`unknown peer: ${JSON.stringify(unknown)}`);
// Only the host may change the phase.
b.send({ t: 'listing', phase: 'playing' });
const notHost = await b.expect((m) => m.t === 'error', 'not_host');
if (notHost.code !== 'not_host') fail('not_host');
a.send({ t: 'listing', phase: 'playing' });
await new Promise((r) => setTimeout(r, 300));
const playing = await fetch(`${base}/api/rooms/${roomId}`).then((r) => r.json());
if (playing.room.phase !== 'playing') fail(`phase: ${JSON.stringify(playing)}`);
console.log('signalling relay ok, phase playing');

// Host migration: Alice's socket drops, Bob is told he is host with a new epoch.
a.ws.close();
const hostChanged = await b.expect((m) => m.t === 'hostChanged', 'hostChanged at B');
if (hostChanged.hostId !== welcomeB.peerId || hostChanged.hostEpoch !== welcomeA.hostEpoch + 1) fail(`hostChanged: ${JSON.stringify(hostChanged)}`);
await b.expect((m) => m.t === 'peerLeft' && m.peerId === welcomeA.peerId, 'peerLeft at B');
console.log('host migrated to bob, epoch', hostChanged.hostEpoch);

// Alice comes back with her token: same peerId, no longer host (Bob keeps the seat).
const a2 = connect(roomId, 'alice2');
await a2.open;
a2.send({ t: 'join', name: 'Alice', hull: 'Hunter', turret: 'Smoky', token: welcomeA.token });
const welcomeA2 = await a2.expect((m) => m.t === 'welcome', 'welcome A2');
if (welcomeA2.peerId !== welcomeA.peerId || welcomeA2.hostId !== welcomeB.peerId) fail(`rejoin: ${JSON.stringify(welcomeA2)}`);
const rejoined = await b.expect((m) => m.t === 'peerJoined', 'rejoin at B');
if (!rejoined.rejoined) fail('rejoined flag');
console.log('alice rejoined with her token');

// Everyone leaves: the room leaves the lobby after the grace.
a2.send({ t: 'leave' });
b.send({ t: 'leave' });
await new Promise((r) => setTimeout(r, 6500));
const after = await fetch(`${base}/api/rooms`).then((r) => r.json());
if (after.rooms.some((r) => r.id === roomId)) fail('room still listed after the grace');
const gone = await fetch(`${base}/api/rooms/${roomId}`);
if (gone.status !== 404) fail(`room should be 404 after purge, got ${gone.status}`);
console.log(`room purged. all good in ${Date.now() - started} ms`);
process.exit(0);
