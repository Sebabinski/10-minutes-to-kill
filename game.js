'use strict';
// Moteur de jeu « 10' to Kill » — logique pure, aucune dépendance réseau.

const CHARACTERS = [
  { id: 'renard', name: 'Renard', emoji: '🦊' },
  { id: 'ours', name: 'Ours', emoji: '🐻' },
  { id: 'panda', name: 'Panda', emoji: '🐼' },
  { id: 'lion', name: 'Lion', emoji: '🦁' },
  { id: 'tigre', name: 'Tigre', emoji: '🐯' },
  { id: 'grenouille', name: 'Grenouille', emoji: '🐸' },
  { id: 'singe', name: 'Singe', emoji: '🐵' },
  { id: 'hibou', name: 'Hibou', emoji: '🦉' },
  { id: 'pingouin', name: 'Pingouin', emoji: '🐧' },
  { id: 'girafe', name: 'Girafe', emoji: '🦒' },
  { id: 'elephant', name: 'Éléphant', emoji: '🐘' },
  { id: 'zebre', name: 'Zèbre', emoji: '🦓' },
  { id: 'crocodile', name: 'Crocodile', emoji: '🐊' },
  { id: 'flamant', name: 'Flamant', emoji: '🦩' },
  { id: 'pieuvre', name: 'Pieuvre', emoji: '🐙' },
  { id: 'herisson', name: 'Hérisson', emoji: '🦔' },
];

const POLICE = [
  { id: 'flic1', name: 'Inspecteur Bastide', emoji: '👮', police: true },
  { id: 'flic2', name: 'Inspectrice Morel', emoji: '👮‍♀️', police: true },
  { id: 'flic3', name: 'Commissaire Vidal', emoji: '🕵️', police: true },
];

const PLACES = [
  'Gare', 'Marché', 'Opéra', 'Port', 'Musée', 'Parc', 'Casino', 'Hôtel',
  'Cinéma', 'Bibliothèque', 'Cimetière', 'Usine', 'Café', 'Pont', 'Banque', 'Théâtre',
];

const SNIPER_TILES = 5;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const isPolice = (id) => id.startsWith('flic');

// ---------- Plateau ----------
function generateTiles(layout) {
  let cells = [];
  if (layout === 'square') {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) cells.push({ x, y });
  } else {
    // Ville aléatoire : 16 lieux connectés, avec des trous entre eux.
    const key = (x, y) => x + ',' + y;
    const set = new Map([[key(3, 3), { x: 3, y: 3 }]]);
    while (set.size < 16) {
      const cand = new Map();
      for (const c of set.values()) {
        for (const [dx, dy] of DIRS) {
          const x = c.x + dx, y = c.y + dy;
          if (x < 0 || y < 0 || x > 6 || y > 6) continue;
          const k = key(x, y);
          if (set.has(k) || cand.has(k)) continue;
          const n = DIRS.filter(([a, b]) => set.has(key(x + a, y + b))).length;
          cand.set(k, { x, y, w: n * n });
        }
      }
      const arr = [...cand.values()];
      let r = Math.random() * arr.reduce((s, c) => s + c.w, 0);
      let pick = arr[arr.length - 1];
      for (const c of arr) { r -= c.w; if (r <= 0) { pick = c; break; } }
      set.set(key(pick.x, pick.y), { x: pick.x, y: pick.y });
    }
    cells = [...set.values()];
    const minX = Math.min(...cells.map((c) => c.x));
    const minY = Math.min(...cells.map((c) => c.y));
    cells = cells.map((c) => ({ x: c.x - minX, y: c.y - minY }));
  }
  cells.sort((a, b) => a.y - b.y || a.x - b.x);
  const names = shuffle([...PLACES]);
  const tiles = cells.map((c, i) => ({ id: i, x: c.x, y: c.y, sniper: false, name: names[i] }));
  shuffle([...tiles]).slice(0, SNIPER_TILES).forEach((t) => { t.sniper = true; });
  return tiles;
}

function createGame(playerIds, options = {}) {
  const order = shuffle([...playerIds]);
  const tiles = generateTiles(options.layout || 'random');
  const pos = {};
  shuffle(CHARACTERS.map((c) => c.id)).forEach((c, i) => { pos[c] = tiles[i].id; });
  const deck = shuffle(CHARACTERS.map((c) => c.id));
  const secrets = {};
  for (const p of order) secrets[p] = { hitman: deck.pop(), targets: [deck.pop(), deck.pop(), deck.pop()] };
  const nPolice = order.length === 2 ? 3 : 2;
  const by = (v) => Object.fromEntries(order.map((p) => [p, v()]));
  return {
    tiles, pos, order, secrets,
    reserve: POLICE.slice(0, nPolice).map((p) => p.id),
    status: by(() => 'alive'),
    lostAt: {},
    piles: by(() => []),
    deadTargets: by(() => []),
    turn: 0, round: 1, actionsLeft: 2, killedThisTurn: false,
    pending: null, endTriggered: false, over: false, results: null,
    seq: 0, log: [{ kind: 'start' }],
  };
}

// ---------- Utilitaires ----------
const current = (g) => g.order[g.turn];
const charsOn = (g, t) => Object.keys(g.pos).filter((c) => g.pos[c] === t);
function adj(g, a, b) {
  const A = g.tiles[a], B = g.tiles[b];
  return Math.abs(A.x - B.x) + Math.abs(A.y - B.y) === 1;
}
const err = (error) => ({ ok: false, error });
const OK = { ok: true };

// Renvoie l'arme utilisable par le personnage k pour tuer v, ou null s'il serait vu / hors de portée.
function killWeapon(g, k, v) {
  if (k === v || isPolice(k)) return null;
  const kt = g.pos[k], vt = g.pos[v];
  if (kt === undefined || vt === undefined) return null;
  // Un policier sur le même lieu ou un lieu adjacent voit tout, même le couteau.
  for (const c of Object.keys(g.pos)) {
    if (isPolice(c) && (g.pos[c] === kt || adj(g, g.pos[c], kt))) return null;
  }
  if (vt === kt) return 'couteau';
  const alone = charsOn(g, kt).length === 1;
  if (!alone) return null;
  if (adj(g, kt, vt)) return 'revolver';
  const A = g.tiles[kt], B = g.tiles[vt];
  if (A.sniper && (A.x === B.x || A.y === B.y)) return 'fusil';
  return null;
}

const suspectsFor = (g, v) => Object.keys(g.pos).filter((c) => !isPolice(c) && c !== v && killWeapon(g, c, v));
const hitmanOwner = (g, c) => g.order.find((p) => g.secrets[p].hitman === c && g.status[p] === 'alive');
const targetOwner = (g, c) => g.order.find((p) => g.secrets[p].targets.includes(c));
const allHitmenGone = (g) => g.order.every((p) => g.status[p] !== 'alive');

function score(g, p) {
  const pts = { target: 1, arrest: 1, hitman: 3, innocent: -1, police: -1337 };
  let s = g.status[p] === 'alive' ? 2 : 0;
  for (const it of g.piles[p]) s += pts[it.type] || 0;
  return s;
}

// ---------- Déroulement ----------
function finish(g) {
  if (g.over) return;
  g.over = true;
  g.pending = null;
  g.results = g.order
    .map((p) => ({ p, score: score(g, p), lostAt: g.status[p] === 'alive' ? Infinity : g.lostAt[p] }))
    .sort((a, b) => b.score - a.score || b.lostAt - a.lostAt)
    .map((r) => ({ ...r, lostAt: r.lostAt === Infinity ? null : r.lostAt }));
  g.log.push({ kind: 'end' });
}

function endTurn(g) {
  g.turn = (g.turn + 1) % g.order.length;
  if (g.turn === 0) {
    if (g.endTriggered) { finish(g); return; }
    g.round++;
  }
  g.actionsLeft = 2;
  g.killedThisTurn = false;
}

function spend(g) {
  g.actionsLeft--;
  if (g.actionsLeft <= 0 && !g.pending && !g.over) endTurn(g);
  return OK;
}

function checkEndTrigger(g) {
  if (g.endTriggered) return;
  const p = g.order.find((q) => g.deadTargets[q].length >= 3);
  if (p) { g.endTriggered = true; g.log.push({ kind: 'endTrigger', p }); }
}

function placePolice(g, tile) {
  let id = g.reserve.shift();
  if (!id) {
    const inPlay = Object.keys(g.pos).filter((c) => isPolice(c) && g.pos[c] !== tile);
    if (!inPlay.length) return;
    id = inPlay[Math.floor(Math.random() * inPlay.length)];
  }
  g.pos[id] = tile;
  g.log.push({ kind: 'police', c: id, tile });
}

function resolveFlee(g) {
  const P = g.pending;
  g.log.push({ kind: 'flee', p: P.placer, moves: P.placed });
  g.pending = null;
  placePolice(g, P.tile);
  if (g.actionsLeft <= 0) endTurn(g);
}

function act(g, pid, a) {
  if (g.over) return err('La partie est terminée.');
  if (g.pending) return err('Il faut d\'abord faire fuir les témoins.');
  if (current(g) !== pid) return err('Ce n\'est pas votre tour.');
  a = a || {};

  if (a.type === 'pass') {
    g.log.push({ kind: 'pass', p: pid });
    endTurn(g);
    return OK;
  }

  if (a.type === 'move') {
    const c = a.char, t = Number(a.tile);
    if (!(c in g.pos)) return err('Ce personnage n\'est pas sur le plateau.');
    if (!g.tiles[t]) return err('Lieu inconnu.');
    if (g.pos[c] === t) return err('Ce personnage est déjà sur ce lieu.');
    const from = g.pos[c];
    g.pos[c] = t;
    g.log.push({ kind: 'move', p: pid, c, from, to: t });
    return spend(g);
  }

  if (a.type === 'kill') {
    if (g.killedThisTurn) return err('Un seul meurtre par tour.');
    if (g.status[pid] !== 'alive') return err('Vous n\'avez plus de tueur.');
    const k = g.secrets[pid].hitman, v = a.char;
    if (!(v in g.pos)) return err('Ce personnage n\'est pas sur le plateau.');
    if (v === k) return err('Votre tueur ne peut pas s\'éliminer lui-même.');
    const weapon = killWeapon(g, k, v);
    if (!weapon) return err('Impossible : votre tueur serait vu, ou la victime est hors de portée.');

    const suspects = suspectsFor(g, v);
    const tile = g.pos[v];
    delete g.pos[v];
    let vtype, owner = null;
    if (isPolice(v)) vtype = 'police';
    else if (g.secrets[pid].targets.includes(v)) { vtype = 'target'; g.deadTargets[pid].push(v); }
    else if ((owner = hitmanOwner(g, v))) { vtype = 'hitman'; g.status[owner] = 'killed'; g.lostAt[owner] = ++g.seq; }
    else {
      vtype = 'innocent';
      owner = targetOwner(g, v) || null;
      if (owner) { vtype = 'otherTarget'; g.deadTargets[owner].push(v); }
    }
    g.piles[pid].push({ c: v, type: vtype === 'otherTarget' ? 'innocent' : vtype });
    g.killedThisTurn = true;
    g.actionsLeft--;
    g.log.push({ kind: 'kill', p: pid, v, tile, vtype, owner, suspects });

    checkEndTrigger(g);
    if (allHitmenGone(g)) { finish(g); return { ok: true, weapon }; }

    const witnesses = charsOn(g, tile);
    if (witnesses.length) {
      g.pending = { type: 'flee', placer: g.order[(g.turn + 1) % g.order.length], tile, witnesses, placed: {} };
    } else {
      placePolice(g, tile);
      if (g.actionsLeft <= 0) endTurn(g);
    }
    return { ok: true, weapon };
  }

  if (a.type === 'investigate') {
    const c = a.char, q = a.player;
    if (!(c in g.pos) || isPolice(c)) return err('Choisissez un personnage sur le plateau (pas un policier).');
    if (!charsOn(g, g.pos[c]).some(isPolice)) return err('Il faut un policier sur le même lieu que ce personnage.');
    if (q === pid || !g.order.includes(q)) return err('Choisissez un autre joueur.');
    if (g.status[q] !== 'alive') return err('Ce joueur n\'a plus de tueur.');
    const success = g.secrets[q].hitman === c;
    if (success) {
      g.status[q] = 'arrested';
      g.lostAt[q] = ++g.seq;
      delete g.pos[c];
      g.piles[pid].push({ c, type: 'arrest' });
    }
    g.log.push({ kind: 'investigate', p: pid, q, c, success });
    if (success && allHitmenGone(g)) { finish(g); return OK; }
    return spend(g);
  }

  return err('Action inconnue.');
}

function flee(g, pid, w, tile) {
  const P = g.pending;
  if (!P) return err('Aucun témoin à déplacer.');
  if (P.placer !== pid) return err('Ce n\'est pas à vous de placer les témoins.');
  if (!P.witnesses.includes(w) || w in P.placed) return err('Choisissez un témoin qui n\'a pas encore fui.');
  const t = Number(tile);
  if (!g.tiles[t]) return err('Lieu inconnu.');
  if (t === P.tile) return err('Les témoins doivent quitter la scène du crime.');
  if (Object.values(P.placed).includes(t)) return err('Chaque témoin doit fuir vers un lieu différent.');
  P.placed[w] = t;
  g.pos[w] = t;
  if (Object.keys(P.placed).length === P.witnesses.length) resolveFlee(g);
  return OK;
}

function fleeRandom(g) {
  const P = g.pending;
  if (!P) return OK;
  for (const w of P.witnesses) {
    if (w in P.placed) continue;
    const used = new Set(Object.values(P.placed));
    const free = g.tiles.filter((t) => t.id !== P.tile && !used.has(t.id));
    const t = free[Math.floor(Math.random() * free.length)].id;
    P.placed[w] = t;
    g.pos[w] = t;
  }
  resolveFlee(g);
  return OK;
}

function skipTurn(g) {
  if (g.over || g.pending) return err('Impossible pour le moment.');
  g.log.push({ kind: 'skip', p: current(g) });
  endTurn(g);
  return OK;
}

// Vue envoyée à un joueur : uniquement l'info publique + ses propres secrets.
function viewFor(g, pid) {
  const v = {
    tiles: g.tiles, pos: g.pos, order: g.order, turn: g.turn, current: current(g), round: g.round,
    actionsLeft: g.actionsLeft, killedThisTurn: g.killedThisTurn, reserve: g.reserve.length,
    status: g.status, piles: g.piles, deadTargets: g.deadTargets,
    revealedHitmen: Object.fromEntries(g.order.filter((p) => g.status[p] !== 'alive').map((p) => [p, g.secrets[p].hitman])),
    pending: g.pending, endTriggered: g.endTriggered, over: g.over, results: g.results,
    log: g.log.slice(-80),
  };
  if (g.over) v.secrets = g.secrets;
  const me = g.secrets[pid];
  if (me) {
    const canKill = current(g) === pid && !g.pending && !g.over && g.status[pid] === 'alive' && !g.killedThisTurn && g.actionsLeft > 0;
    v.mine = {
      hitman: me.hitman,
      targets: me.targets,
      killable: canKill
        ? Object.keys(g.pos).map((c) => ({ c, w: killWeapon(g, me.hitman, c) })).filter((x) => x.w)
        : [],
    };
  }
  return v;
}

module.exports = {
  CHARACTERS, POLICE, isPolice, createGame, act, flee, fleeRandom, skipTurn, viewFor, killWeapon, score,
};
