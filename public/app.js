'use strict';
const socket = io();
const $app = document.getElementById('app');
const $toast = document.getElementById('toast');

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* rien */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* rien */ } },
};
let playerId = store.get('ttk.id');
if (!playerId) {
  playerId = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
  store.set('ttk.id', playerId);
}

let S = null; // état reçu du serveur
const ui = { sel: null, mode: null, confirmKill: false, hideDossier: false, hideResults: false, key: null };

// ---------- Réseau ----------
socket.on('connect', () => {
  const code = store.get('ttk.room');
  if (code) {
    socket.emit('join', { code, name: store.get('ttk.name'), playerId }, (res) => {
      if (!res.ok) { store.del('ttk.room'); S = null; render(); }
    });
  } else render();
});
socket.on('disconnect', () => toast('Connexion perdue, reconnexion…'));
socket.on('state', (s) => {
  S = s;
  const g = s.game;
  const key = g ? [g.turn, g.round, g.actionsLeft, !!g.pending, g.over].join('-') : s.phase;
  if (key !== ui.key) { ui.sel = null; ui.mode = null; ui.confirmKill = false; ui.key = key; }
  if (g && ui.sel && !(ui.sel in g.pos)) ui.sel = null;
  if (!g || !g.over) ui.hideResults = false;
  render();
});

function send(event, data, okMsg) {
  socket.emit(event, data, (res) => {
    if (res && !res.ok && res.error) toast(res.error);
    else if (res && res.ok && okMsg) toast(typeof okMsg === 'function' ? okMsg(res) : okMsg);
  });
}

// ---------- Utilitaires ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isPolice = (id) => id.startsWith('flic');
const cat = (id) => S.catalog.find((c) => c.id === id) || { name: id, emoji: '❔' };
const em = (id) => cat(id).emoji;
const full = (id) => `${em(id)} ${esc(cat(id).name)}`;
const pname = (id) => { const p = S.players.find((x) => x.id === id); return p ? esc(p.name) : '?'; };
const tname = (t) => esc(S.game.tiles[t].name);
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 3200);
}

const SCOPE = `<svg class="scope" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6"/></svg>`;

function rulesHtml(open) {
  return `<details class="rules"${open ? ' open' : ''}>
  <summary>Règles en bref</summary>
  <p>Chacun incarne en secret un des 16 personnages : c'est son tueur à gages. Il a aussi 3 cibles secrètes à éliminer sans se faire repérer. N'importe qui peut déplacer n'importe quel personnage, c'est ce qui brouille les pistes.</p>
  <p>À votre tour, faites <strong>2 actions</strong> (la même deux fois si vous voulez, sauf tuer) :</p>
  <ul>
    <li><strong>Déplacer</strong> un personnage (policiers compris) vers n'importe quel lieu.</li>
    <li><strong>Éliminer</strong> un personnage avec votre tueur, une fois par tour. Couteau : même lieu, même s'il y a du monde. Revolver : lieu adjacent, votre tueur doit être seul. Fusil : depuis un toit marqué d'une mire, en ligne droite à n'importe quelle distance, votre tueur doit être seul.</li>
    <li><strong>Contrôler une identité</strong> : désignez un personnage sur le même lieu qu'un policier et demandez à un joueur si c'est son tueur.</li>
  </ul>
  <p>Un policier sur le même lieu ou un lieu adjacent voit tout, même le couteau. Après un meurtre, le joueur suivant fait fuir les témoins (chacun vers un lieu différent) et un policier arrive sur la scène. Le jeu vérifie pour vous qu'un meurtre est possible et affiche la liste des suspects.</p>
  <p>Fin : quand les 3 cibles d'un joueur sont mortes (on termine le tour de table) ou quand tous les tueurs sont tombés. Points : tueur encore libre 2, cible tuée 1, tueur adverse arrêté 1, tueur adverse abattu 3, innocent −1, policier −1337.</p>
</details>`;
}

// ---------- Rendu ----------
function render() {
  if (!S || !S.code) return renderHome();
  if (S.phase === 'lobby' || !S.game) return renderLobby();
  return renderGame();
}

function renderHome() {
  const params = new URLSearchParams(location.search);
  const code = (params.get('code') || '').toUpperCase().slice(0, 4);
  $app.innerHTML = `<main class="home">
    <h1 class="title">10<span class="tick">′</span><br>to Kill</h1>
    <p class="lede">Seize personnages en ville. L'un d'eux est votre tueur à gages, trois autres sont vos cibles. Personne ne sait qui est qui.</p>
    <div class="entry">
      <label>Votre nom<input type="text" id="name" maxlength="16" autocomplete="nickname" value="${esc(store.get('ttk.name') || '')}"></label>
      <div class="row"><button class="btn primary" data-act="create">Créer une partie</button></div>
      <span class="or">ou rejoindre avec un code</span>
      <div class="join"><input type="text" id="code" maxlength="4" placeholder="ABCD" value="${esc(code)}" aria-label="Code de la partie"><button class="btn" data-act="join">Rejoindre</button></div>
    </div>
    ${rulesHtml(false)}
  </main>`;
}

function renderLobby() {
  const host = S.hostId === S.me;
  const n = S.players.length;
  const lay = S.options.layout;
  $app.innerHTML = `<main class="lobby">
    <h1 class="title small">10′ to Kill</h1>
    <div class="code-block"><div><div class="label">Code de la partie</div><div class="code">${esc(S.code)}</div></div>
      <button class="btn small" data-act="copy">Copier le lien d'invitation</button></div>
    <ul class="roster">${S.players.map((p) => `<li><span>${esc(p.name)}${p.id === S.me ? ' (vous)' : ''}</span>
      <span class="tag">${p.id === S.hostId ? 'hôte' : ''}${p.connected ? '' : ' déconnecté'}</span></li>`).join('')}</ul>
    ${host ? `<div class="label">Plateau</div>
      <div class="choice">
        <button class="btn small" data-act="layout" data-layout="random" aria-pressed="${lay === 'random'}">Ville aléatoire</button>
        <button class="btn small" data-act="layout" data-layout="square" aria-pressed="${lay === 'square'}">Carré 4 × 4</button>
      </div>
      <div class="row"><button class="btn primary" data-act="start" ${n < 2 ? 'disabled' : ''}>Lancer la partie</button>
      <span class="hint">${n < 2 ? 'Il faut au moins 2 joueurs.' : `${n} joueurs, c'est parti quand vous voulez.`}</span></div>`
      : `<p class="hint">Plateau : ${lay === 'square' ? 'carré 4 × 4' : 'ville aléatoire'}. L'hôte lance la partie.</p>`}
    <div class="row" style="margin-top:1.4rem"><button class="btn small" data-act="leave">Quitter</button></div>
    ${rulesHtml(false)}
  </main>`;
}

function renderGame() {
  const g = S.game;
  $app.innerHTML = `<div class="game">
    <header class="topbar">
      <span class="brand">10′ to Kill</span>
      <span class="meta">Partie ${esc(S.code)}, tour de table ${g.round}</span>
      ${g.endTriggered && !g.over ? '<span class="last">Dernier tour de table</span>' : ''}
    </header>
    <section class="stage">
      ${boardHtml(g)}
      ${actionBarHtml(g)}
      <div class="legend">
        <span><i class="dot me"></i>votre tueur</span><span><i class="dot mark"></i>vos cibles</span>
        <span><i class="dot kill"></i>à portée</span><span><i class="dot scope"></i>toit de tir</span>
      </div>
    </section>
    <aside class="side">
      ${dossierHtml(g)}
      <section><h2>Joueurs</h2>${playersHtml(g)}</section>
      <section><h2>Journal</h2>${logHtml(g)}</section>
      <div class="row"><button class="btn small" data-act="leave">Quitter la partie</button></div>
    </aside>
  </div>
  ${g.over && !ui.hideResults ? resultsHtml(g) : ''}`;
}

function boardHtml(g) {
  const cols = Math.max(...g.tiles.map((t) => t.x)) + 1;
  const byTile = {};
  const order = S.catalog.map((c) => c.id);
  for (const c of order) if (c in g.pos) (byTile[g.pos[c]] = byTile[g.pos[c]] || []).push(c);
  const mine = g.mine || { targets: [], killable: [] };
  const show = !ui.hideDossier;
  const myTurn = g.current === S.me && !g.over && !g.pending;
  const P = g.pending;
  const placing = P && P.placer === S.me;
  const killable = new Set(myTurn ? mine.killable.map((k) => k.c) : []);
  const used = new Set(P ? Object.values(P.placed) : []);
  const destMode = (ui.mode === 'move' && ui.sel) || (placing && ui.sel);

  const tiles = g.tiles.map((t) => {
    const cls = ['tile'];
    if (t.sniper) cls.push('sniper');
    if (P && P.tile === t.id) cls.push('crime');
    if (destMode && !(placing && (t.id === P.tile || used.has(t.id)))) cls.push('dest');
    if (placing && used.has(t.id)) cls.push('used');
    const chips = (byTile[t.id] || []).map((c) => {
      const k = ['chip'];
      if (isPolice(c)) k.push('police');
      if (show && c === mine.hitman) k.push('me');
      if (show && mine.targets.includes(c)) k.push('mark');
      if (show && killable.has(c)) k.push('killable');
      if (ui.sel === c) k.push('sel');
      if (P && P.witnesses.includes(c) && !(c in P.placed)) k.push('witness');
      return `<button class="${k.join(' ')}" data-chip="${c}" title="${esc(cat(c).name)}" aria-label="${esc(cat(c).name)}">${em(c)}</button>`;
    }).join('');
    return `<div class="${cls.join(' ')}" data-tile="${t.id}" style="grid-column:${t.x + 1};grid-row:${t.y + 1}">
      <div class="chips">${chips}</div>${t.sniper ? SCOPE : ''}<span class="place">${esc(t.name)}</span></div>`;
  }).join('');
  return `<div class="board" style="--cols:${cols}">${tiles}</div>`;
}

function pips(n) {
  return `<span class="pips" aria-label="${plural(n, 'action')} restante${n > 1 ? 's' : ''}">${[0, 1].map((i) => `<i class="${i < n ? '' : 'off'}"></i>`).join('')}</span>`;
}

function actionBarHtml(g) {
  if (g.over) return `<div class="actionbar"><span class="msg">Partie terminée.</span><button class="btn small" data-act="showResults">Voir les résultats</button></div>`;
  const P = g.pending;
  if (P) {
    const left = P.witnesses.filter((w) => !(w in P.placed));
    if (P.placer === S.me) {
      return `<div class="actionbar alert"><span class="msg"><b>Meurtre à ${tname(P.tile)}.</b> Faites fuir les témoins (${left.map(em).join(' ')}) : touchez-en un, puis un lieu. Un lieu différent pour chacun.</span>
        <button class="btn small" data-act="fleeRandom">Placer au hasard</button></div>`;
    }
    return `<div class="actionbar alert"><span class="msg">Meurtre à ${tname(P.tile)}. ${pname(P.placer)} fait fuir les témoins…</span></div>`;
  }
  if (g.current !== S.me) {
    const cur = S.players.find((p) => p.id === g.current);
    const skip = S.hostId === S.me && cur && !cur.connected;
    return `<div class="actionbar"><span class="msg">Au tour de <b>${pname(g.current)}</b>${pips(g.actionsLeft)}</span>
      ${skip ? '<button class="btn small" data-act="skip">Passer son tour (déconnecté)</button>' : ''}</div>`;
  }
  const head = `<span class="msg">`;
  if (!ui.sel) {
    return `<div class="actionbar mine">${head}<b>À vous.</b> Touchez un personnage pour agir.${pips(g.actionsLeft)}</span>
      <button class="btn small" data-act="pass">Terminer mon tour</button></div>`;
  }
  const c = ui.sel;
  if (ui.mode === 'move') {
    return `<div class="actionbar mine">${head}Où envoyer ${full(c)} ? Touchez un lieu.</span><button class="btn small" data-act="cancel">Annuler</button></div>`;
  }
  if (ui.mode === 'investigate') {
    const others = g.order.filter((p) => p !== S.me && g.status[p] === 'alive');
    return `<div class="actionbar mine">${head}Demander à qui si ${full(c)} est son tueur ?</span>
      ${others.map((p) => `<button class="btn small" data-act="ask" data-player="${esc(p)}">${pname(p)}</button>`).join('')}
      <button class="btn small" data-act="cancel">Annuler</button></div>`;
  }
  const kill = (g.mine && g.mine.killable || []).find((k) => k.c === c);
  const policeHere = !isPolice(c) && Object.keys(g.pos).some((x) => isPolice(x) && g.pos[x] === g.pos[c]);
  const canAsk = policeHere && g.order.some((p) => p !== S.me && g.status[p] === 'alive');
  const weapon = kill ? { couteau: 'au couteau', revolver: 'au revolver', fusil: 'au fusil' }[kill.w] : '';
  let killBtn = '';
  if (kill) {
    killBtn = ui.confirmKill
      ? `<button class="btn small danger" data-act="kill">Confirmer : éliminer ${weapon}${isPolice(c) ? ' (−1337 points !)' : ''}</button>`
      : `<button class="btn small" data-act="kill">Éliminer ${weapon}</button>`;
  }
  return `<div class="actionbar mine">${head}${full(c)}, à ${tname(g.pos[c])}${pips(g.actionsLeft)}</span>
    <button class="btn small primary" data-act="move">Déplacer</button>
    ${killBtn}
    ${canAsk ? '<button class="btn small" data-act="investigate">Contrôler l\'identité</button>' : ''}
    <button class="btn small" data-act="cancel">Annuler</button></div>`;
}

function dossierHtml(g) {
  const m = g.mine;
  if (!m) return '';
  const st = g.status[S.me];
  const dead = new Set(g.deadTargets[S.me] || []);
  const body = ui.hideDossier ? '<p class="label">Dossier masqué.</p>' : `
    <div class="label">Votre tueur</div>
    <div class="who"><span class="em">${em(m.hitman)}</span> ${esc(cat(m.hitman).name)}
      ${st === 'killed' ? '<span class="lost">abattu</span>' : st === 'arrested' ? '<span class="lost">arrêté</span>' : ''}</div>
    <div class="label">Vos cibles (${dead.size}/3 tombées)</div>
    <ul class="targets">${m.targets.map((t) => `<li class="${dead.has(t) ? 'dead' : ''}">${full(t)}</li>`).join('')}</ul>
    ${st !== 'alive' ? '<p class="label" style="margin-top:.8rem">Vous ne pouvez plus tuer, mais vous pouvez encore démasquer les autres avec la police.</p>' : ''}`;
  return `<section class="dossier"><div class="head"><h2>Votre dossier</h2>
    <button class="btn small" data-act="toggleDossier">${ui.hideDossier ? 'Afficher' : 'Masquer'}</button></div>${body}</section>`;
}

function playersHtml(g) {
  return `<ul class="players">${g.order.map((p) => {
    const pl = S.players.find((x) => x.id === p);
    const st = g.status[p];
    const rev = g.revealedHitmen[p];
    const stTxt = st === 'alive' ? 'tueur en liberté' : `tueur ${st === 'killed' ? 'abattu' : 'arrêté'} : ${full(rev)}`;
    const pile = g.piles[p].map((it) => `<span class="${it.type}" title="${esc(cat(it.c).name)}">${em(it.c)}</span>`).join('');
    return `<li class="${p === g.current && !g.over ? 'now' : ''}">
      <div class="top"><span class="name">${pname(p)}${p === S.me ? ' (vous)' : ''}${pl && !pl.connected ? ' <span class="off">déconnecté</span>' : ''}</span>
      <span class="st">${g.deadTargets[p].length}/3 cibles</span></div>
      <div class="st ${st === 'alive' ? '' : 'bad'}">${stTxt}</div>
      ${pile ? `<div class="pile">${pile}</div>` : ''}</li>`;
  }).join('')}</ul>`;
}

function logLine(e) {
  const P = (id) => `<b>${pname(id)}</b>`;
  switch (e.kind) {
    case 'start': return ['', 'La partie commence. Les tueurs se fondent dans la foule.'];
    case 'move': return ['', `${P(e.p)} déplace ${full(e.c)} de ${tname(e.from)} à ${tname(e.to)}.`];
    case 'pass': return ['', `${P(e.p)} termine son tour.`];
    case 'skip': return ['', `Le tour de ${P(e.p)} est passé.`];
    case 'kill': {
      const what = {
        target: 'C\'était une de ses cibles.',
        hitman: `C'était le tueur de ${P(e.owner)} !`,
        otherTarget: `Victime innocente… et cible de ${P(e.owner)}.`,
        innocent: 'Victime innocente.',
        police: 'Un policier. −1337 points.',
      }[e.vtype];
      const sus = e.suspects.length ? e.suspects.map(em).join(' ') : 'aucun';
      return ['kill', `${P(e.p)} a éliminé ${full(e.v)} à ${tname(e.tile)}. ${what}<span class="sus">Suspects possibles : ${sus}</span>`];
    }
    case 'flee': return ['', `${P(e.p)} fait fuir les témoins.`];
    case 'police': return ['inv', `${full(e.c)} arrive à ${tname(e.tile)}.`];
    case 'investigate': return ['inv', `${P(e.p)} à ${P(e.q)} : « ${full(e.c)} est-il ton tueur ? » ${e.success ? '<b>Oui, arrêté !</b>' : 'Non.'}`];
    case 'endTrigger': return ['kill', `Les 3 cibles de ${P(e.p)} sont tombées : on finit le tour de table.`];
    case 'end': return ['', 'Fin de partie.'];
    default: return ['', ''];
  }
}

function logHtml(g) {
  return `<ul class="log">${g.log.slice().reverse().map((e) => {
    const [cls, txt] = logLine(e);
    return `<li class="${cls}">${txt}</li>`;
  }).join('')}</ul>`;
}

function resultsHtml(g) {
  const host = S.hostId === S.me;
  const rows = g.results.map((r) => {
    const sec = g.secrets[r.p];
    const st = g.status[r.p];
    const dead = new Set(g.deadTargets[r.p]);
    return `<li><span class="sc">${r.score}</span><b>${pname(r.p)}</b>
      <div class="detail">Tueur : ${full(sec.hitman)}, ${st === 'alive' ? 'en liberté' : st === 'killed' ? 'abattu' : 'arrêté'}</div>
      <div class="detail">Cibles : ${sec.targets.map((t) => `<span style="${dead.has(t) ? 'text-decoration:line-through' : ''}">${em(t)}</span>`).join(' ')}</div></li>`;
  }).join('');
  return `<div class="overlay"><div class="results" role="dialog" aria-label="Résultats">
    <h2>${pname(g.results[0].p)} gagne</h2>
    <ol>${rows}</ol>
    <div class="row">
      ${host ? '<button class="btn primary" data-act="restart">Nouvelle partie</button>' : '<span class="hint">L\'hôte peut relancer une partie.</span>'}
      <button class="btn small" data-act="hideResults">Voir le plateau</button>
    </div></div></div>`;
}

// ---------- Interactions ----------
function onChip(c) {
  const g = S.game;
  const P = g.pending;
  if (P) {
    if (P.placer !== S.me) return;
    if (P.witnesses.includes(c) && !(c in P.placed)) { ui.sel = c; render(); return; }
    if (ui.sel) onTile(g.pos[c]);
    return;
  }
  if (g.over || g.current !== S.me) return;
  if (ui.mode === 'move' && ui.sel && c !== ui.sel) { onTile(g.pos[c]); return; }
  ui.sel = ui.sel === c ? null : c;
  ui.mode = null;
  ui.confirmKill = false;
  render();
}

function onTile(t) {
  const g = S.game;
  const P = g.pending;
  if (P && P.placer === S.me && ui.sel) {
    const c = ui.sel;
    ui.sel = null;
    send('flee', { char: c, tile: t });
    return;
  }
  if (ui.mode === 'move' && ui.sel && !P) {
    const c = ui.sel;
    ui.sel = null; ui.mode = null;
    send('action', { type: 'move', char: c, tile: t });
  }
}

function onAct(act, data) {
  switch (act) {
    case 'create':
    case 'join': {
      const name = document.getElementById('name').value.trim();
      if (!name) { toast('Entrez votre nom.'); document.getElementById('name').focus(); return; }
      store.set('ttk.name', name);
      const code = act === 'join' ? document.getElementById('code').value.trim().toUpperCase() : null;
      if (act === 'join' && code.length !== 4) { toast('Le code fait 4 lettres.'); return; }
      socket.emit(act, { name, code, playerId }, (res) => {
        if (!res.ok) return toast(res.error);
        store.set('ttk.room', res.code);
        history.replaceState(null, '', location.pathname);
      });
      return;
    }
    case 'leave':
      if (S && S.game && !S.game.over && !confirm('Quitter la partie en cours ?')) return;
      socket.emit('leave');
      store.del('ttk.room');
      S = null;
      render();
      return;
    case 'copy': {
      const url = `${location.origin}${location.pathname}?code=${S.code}`;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
        .then(() => toast('Lien copié.'), () => toast(url));
      return;
    }
    case 'layout': send('options', { layout: data.layout }); return;
    case 'start': send('start'); return;
    case 'restart': send('restart'); return;
    case 'skip': send('skip'); return;
    case 'pass': send('action', { type: 'pass' }); return;
    case 'fleeRandom': send('fleeRandom'); return;
    case 'move': ui.mode = 'move'; render(); return;
    case 'investigate': ui.mode = 'investigate'; render(); return;
    case 'ask': {
      const c = ui.sel;
      ui.sel = null; ui.mode = null;
      send('action', { type: 'investigate', char: c, player: data.player });
      return;
    }
    case 'kill': {
      if (!ui.confirmKill) { ui.confirmKill = true; render(); return; }
      const c = ui.sel;
      ui.sel = null; ui.confirmKill = false;
      send('action', { type: 'kill', char: c }, 'Contrat rempli. Personne ne vous a vu.');
      return;
    }
    case 'cancel': ui.sel = null; ui.mode = null; ui.confirmKill = false; render(); return;
    case 'toggleDossier': ui.hideDossier = !ui.hideDossier; render(); return;
    case 'hideResults': ui.hideResults = true; render(); return;
    case 'showResults': ui.hideResults = false; render(); return;
    default:
  }
}

$app.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (a) { onAct(a.dataset.act, a.dataset); return; }
  if (!S || !S.game) return;
  const chip = e.target.closest('[data-chip]');
  if (chip) { onChip(chip.dataset.chip); return; }
  const tile = e.target.closest('[data-tile]');
  if (tile) onTile(Number(tile.dataset.tile));
});

$app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.matches('input')) return;
  onAct(e.target.id === 'code' ? 'join' : 'create', {});
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (ui.sel || ui.mode)) onAct('cancel', {});
});

render();
