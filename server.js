'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const G = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;
const rooms = new Map();
const CATALOG = [...G.CHARACTERS, ...G.POLICE];

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do { code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

const cleanName = (n) => String(n || '').trim().slice(0, 16) || 'Anonyme';
const cleanId = (id) => String(id || '').slice(0, 64);

function view(room, pid) {
  return {
    code: room.code, me: pid, hostId: room.hostId, phase: room.phase, options: room.options, catalog: CATALOG,
    players: room.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
    game: room.game ? G.viewFor(room.game, pid) : null,
  };
}

function broadcast(room) {
  room.lastActive = Date.now();
  for (const p of room.players) if (p.socketId) io.to(p.socketId).emit('state', view(room, p.id));
}

function ensureHost(room) {
  const host = room.players.find((p) => p.id === room.hostId);
  if (!host || !host.connected) {
    const next = room.players.find((p) => p.connected);
    if (next) room.hostId = next.id;
  }
}

// Si un joueur absent doit agir à la place de quelqu'un, on débloque.
function unstick(room) {
  const g = room.game;
  if (!g) return;
  if (g.pending) {
    const placer = room.players.find((p) => p.id === g.pending.placer);
    if (!placer || !placer.connected) G.fleeRandom(g);
  }
  if (g.over) room.phase = 'ended';
}

function removeFromRoom(room, pid) {
  room.players = room.players.filter((p) => p.id !== pid);
  if (!room.players.length) { rooms.delete(room.code); return; }
  ensureHost(room);
  broadcast(room);
}

io.on('connection', (socket) => {
  let room = null;
  let pid = null;

  const reply = (cb, res) => { if (typeof cb === 'function') cb(res); };
  const me = () => room && room.players.find((p) => p.id === pid);

  function leaveCurrent() {
    if (!room) return;
    const p = me();
    socket.leave(room.code);
    if (p) {
      if (room.phase === 'lobby') removeFromRoom(room, pid);
      else { p.connected = false; p.socketId = null; ensureHost(room); unstick(room); broadcast(room); }
    }
    room = null;
  }

  socket.on('create', ({ name, playerId } = {}, cb) => {
    leaveCurrent();
    pid = cleanId(playerId);
    if (!pid) return reply(cb, { ok: false, error: 'Identifiant manquant.' });
    const code = newCode();
    room = {
      code, hostId: pid, phase: 'lobby', options: { layout: 'random' }, game: null, lastActive: Date.now(),
      players: [{ id: pid, name: cleanName(name), socketId: socket.id, connected: true }],
    };
    rooms.set(code, room);
    socket.join(code);
    reply(cb, { ok: true, code });
    broadcast(room);
  });

  socket.on('join', ({ code, name, playerId } = {}, cb) => {
    const r = rooms.get(String(code || '').trim().toUpperCase());
    if (!r) return reply(cb, { ok: false, error: 'Aucune partie avec ce code.' });
    const id = cleanId(playerId);
    if (!id) return reply(cb, { ok: false, error: 'Identifiant manquant.' });
    if (room && room !== r) leaveCurrent();
    let p = r.players.find((x) => x.id === id);
    if (p) {
      p.socketId = socket.id;
      p.connected = true;
      if (r.phase === 'lobby' && name) p.name = cleanName(name);
    } else {
      if (r.phase !== 'lobby') return reply(cb, { ok: false, error: 'La partie a déjà commencé.' });
      if (r.players.length >= MAX_PLAYERS) return reply(cb, { ok: false, error: 'La partie est complète (4 joueurs maximum).' });
      p = { id, name: cleanName(name), socketId: socket.id, connected: true };
      r.players.push(p);
    }
    room = r;
    pid = id;
    socket.join(r.code);
    ensureHost(r);
    reply(cb, { ok: true, code: r.code });
    broadcast(r);
  });

  socket.on('leave', (_d, cb) => { leaveCurrent(); reply(cb, { ok: true }); });

  socket.on('options', (opts = {}, cb) => {
    if (!room || room.hostId !== pid || room.phase !== 'lobby') return reply(cb, { ok: false });
    if (['random', 'square'].includes(opts.layout)) room.options.layout = opts.layout;
    broadcast(room);
    reply(cb, { ok: true });
  });

  socket.on('start', (_d, cb) => {
    if (!room || room.hostId !== pid) return reply(cb, { ok: false, error: 'Seul l\'hôte peut lancer la partie.' });
    if (room.phase !== 'lobby') return reply(cb, { ok: false, error: 'La partie est déjà lancée.' });
    const ids = room.players.filter((p) => p.connected).map((p) => p.id);
    if (ids.length < 2) return reply(cb, { ok: false, error: 'Il faut au moins 2 joueurs.' });
    room.players = room.players.filter((p) => p.connected);
    room.game = G.createGame(ids, room.options);
    room.phase = 'playing';
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('action', (a, cb) => {
    if (!room || !room.game) return reply(cb, { ok: false, error: 'Pas de partie en cours.' });
    const res = G.act(room.game, pid, a);
    if (res.ok) { unstick(room); broadcast(room); }
    reply(cb, res);
  });

  socket.on('flee', ({ char, tile } = {}, cb) => {
    if (!room || !room.game) return reply(cb, { ok: false });
    const res = G.flee(room.game, pid, char, tile);
    if (res.ok) { unstick(room); broadcast(room); }
    reply(cb, res);
  });

  socket.on('fleeRandom', (_d, cb) => {
    const g = room && room.game;
    if (!g || !g.pending || g.pending.placer !== pid) return reply(cb, { ok: false });
    G.fleeRandom(g);
    unstick(room);
    broadcast(room);
    reply(cb, { ok: true });
  });

  socket.on('skip', (_d, cb) => {
    const g = room && room.game;
    if (!g || room.hostId !== pid) return reply(cb, { ok: false, error: 'Réservé à l\'hôte.' });
    const cur = room.players.find((p) => p.id === g.order[g.turn]);
    if (cur && cur.connected) return reply(cb, { ok: false, error: 'Ce joueur est connecté.' });
    const res = G.skipTurn(g);
    if (res.ok) { unstick(room); broadcast(room); }
    reply(cb, res);
  });

  socket.on('restart', (_d, cb) => {
    if (!room || room.hostId !== pid) return reply(cb, { ok: false, error: 'Réservé à l\'hôte.' });
    room.phase = 'lobby';
    room.game = null;
    room.players = room.players.filter((p) => p.connected);
    broadcast(room);
    reply(cb, { ok: true });
  });

  socket.on('disconnect', () => {
    if (!room) return;
    const r = room, id = pid;
    const p = me();
    if (!p || p.socketId !== socket.id) return;
    p.connected = false;
    p.socketId = null;
    if (r.phase === 'lobby') {
      // Petit délai pour laisser le temps de recharger la page.
      setTimeout(() => {
        const still = r.players.find((x) => x.id === id);
        if (still && !still.connected && r.phase === 'lobby') removeFromRoom(r, id);
      }, 20000);
    }
    ensureHost(r);
    unstick(r);
    broadcast(r);
  });
});

// Ménage : salons vides depuis 30 minutes.
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (!r.players.some((p) => p.connected) && now - r.lastActive > 30 * 60 * 1000) rooms.delete(code);
  }
}, 5 * 60 * 1000);

server.listen(PORT, () => console.log(`10' to Kill en ligne sur http://localhost:${PORT}`));
