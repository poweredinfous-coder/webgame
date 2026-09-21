import { standings, gamesScored, formatScore } from './scoring.js';

const $ = (id) => document.getElementById(id);
const els = {
  title: $('title'),
  subtitle: $('subtitle'),
  game: $('game'),
  gameName: $('game-name'),
  gameRole: $('game-role'),
  board: $('board'),
  message: $('message'),
  status: $('status'),
};

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const rows = new Map(); // groupId -> { li, rank, name, bar, score, value, raf }
let hasData = false;
let wasHidden = null;
let revealTimers = [];

function el(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function makeRow() {
  const li = el('li', 'row');
  const rank = el('span', 'rank');
  const name = el('span', 'name');
  const track = el('span', 'track');
  const bar = el('span', 'bar');
  const score = el('span', 'score');
  track.setAttribute('aria-hidden', 'true');
  track.append(bar);
  li.append(rank, name, track, score);
  return { li, rank, name, bar, score, value: null, raf: 0 };
}

function showMessage(heading, detail = '') {
  els.board.hidden = true;
  els.message.hidden = false;
  els.message.querySelector('h2').textContent = heading;
  els.message.querySelector('p').textContent = detail;
}

function subtitleFor(state) {
  if (!state.games.length) return 'Belum ada game';
  const scored = gamesScored(state);
  if (!scored) return 'Belum ada game yang dinilai';
  return `${scored} dari ${state.games.length} game sudah dinilai`;
}

function setScore(row, value, animate) {
  cancelAnimationFrame(row.raf);
  const from = row.value ?? value;
  row.value = value;
  if (!animate || from === value) {
    row.score.textContent = formatScore(value);
    return;
  }
  const start = performance.now();
  const duration = 900;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    row.score.textContent = formatScore(Math.round(from + (value - from) * eased));
    if (t < 1) row.raf = requestAnimationFrame(tick);
  };
  row.raf = requestAnimationFrame(tick);
}

// Baris yang dipindah di DOM kehilangan transisinya, jadi batangnya dikembalikan
// ke lebar lama dulu supaya tetap terlihat memanjang atau memendek.
function setBar(row, ratio, wasMoved) {
  const next = `${(ratio * 100).toFixed(2)}%`;
  if (wasMoved && row.bar.style.width) {
    const previous = row.bar.style.width;
    row.bar.style.transition = 'none';
    row.bar.style.width = previous;
    void row.bar.offsetWidth;
    row.bar.style.transition = '';
  }
  row.bar.style.width = next;
}

function drawBoard(state, revealing) {
  const table = standings(state);
  const top = Math.max(1, ...table.map((r) => r.total));
  const animate = hasData && !revealing && !reduceMotion.matches;

  const firstTops = new Map();
  if (animate) for (const [id, row] of rows) firstTops.set(id, row.li.getBoundingClientRect().top);

  const alive = new Set(table.map((r) => r.group.id));
  for (const [id, row] of rows) {
    if (!alive.has(id)) {
      row.li.remove();
      rows.delete(id);
    }
  }

  els.board.style.setProperty('--n', table.length);
  // Semakin panjang nama terpanjang, semakin kecil huruf nama, supaya cukup dua baris di kolomnya.
  const longest = Math.max(...table.map((r) => r.group.name.length));
  els.board.style.setProperty('--name-scale', longest <= 16 ? 1 : longest <= 28 ? 0.85 : 0.75);
  // Sorotan pemimpin baru muncul kalau ada yang benar-benar unggul, bukan saat semua masih 0.
  const hasLeader = table[0].total > 0;
  let cursor = els.board.firstElementChild;
  for (const item of table) {
    let row = rows.get(item.group.id);
    if (!row) {
      row = makeRow();
      rows.set(item.group.id, row);
    }
    let moved = false;
    if (row.li === cursor) {
      cursor = cursor.nextElementSibling;
    } else {
      els.board.insertBefore(row.li, cursor);
      moved = true;
    }

    if (hasLeader && item.rank === 1) row.li.dataset.lead = '';
    else delete row.li.dataset.lead;
    row.li.style.setProperty('--team', item.group.color);
    row.rank.textContent = item.rank;
    row.name.textContent = item.group.name;
    setBar(row, Math.max(0, item.total) / top, moved);
    setScore(row, item.total, animate);
  }

  els.message.hidden = true;
  els.board.hidden = false;

  if (animate) {
    for (const [id, row] of rows) {
      const before = firstTops.get(id);
      if (before === undefined) continue;
      const dy = before - row.li.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) {
        row.li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 650, easing: EASE });
      }
    }
  }
  return { table, top };
}

function cancelReveal() {
  for (const timer of revealTimers) clearTimeout(timer);
  revealTimers = [];
  for (const row of rows.values()) {
    row.li.classList.remove('pending');
    row.bar.style.transition = '';
  }
}

// Peringkat dibuka dari juara terakhir sampai juara 1, dengan jeda ekstra sebelum juara 1.
function playReveal(table, top) {
  if (reduceMotion.matches) return;
  for (const item of table) {
    const row = rows.get(item.group.id);
    row.li.classList.add('pending');
    row.bar.style.transition = 'none';
    row.bar.style.width = '0%';
    row.score.textContent = '0';
    row.value = 0;
  }
  void els.board.offsetWidth;

  const order = table.slice().reverse();
  order.forEach((item, i) => {
    const row = rows.get(item.group.id);
    const delay = i * 700 + (i === order.length - 1 && order.length > 1 ? 600 : 0);
    revealTimers.push(
      setTimeout(() => {
        row.li.classList.remove('pending');
        row.bar.style.transition = '';
        row.bar.style.width = `${(Math.max(0, item.total) / top) * 100}%`;
        setScore(row, item.total, true);
      }, delay),
    );
  });
}

function render(state) {
  document.title = `${state.title} · Papan skor`;
  els.title.textContent = state.title;
  els.subtitle.textContent = subtitleFor(state);

  const game = state.games.find((g) => g.id === state.currentGameId);
  els.game.hidden = !game;
  if (game) {
    els.gameName.textContent = game.name;
    els.gameRole.textContent = game.role || '';
    els.gameRole.hidden = !game.role;
  } else {
    els.gameRole.textContent = '';
    els.gameRole.hidden = true;
  }

  const revealing = wasHidden === true && !state.hideRanking;
  wasHidden = state.hideRanking;
  cancelReveal();

  if (!state.groups.length) {
    showMessage('Belum ada kelompok', 'Tambahkan kelompok lewat halaman admin di /admin.');
  } else if (state.hideRanking) {
    showMessage('Peringkat segera diumumkan', 'Skor disembunyikan sampai panitia membukanya.');
  } else {
    const { table, top } = drawBoard(state, revealing);
    if (revealing) playReveal(table, top);
  }
  hasData = true;
}

function setOnline(online) {
  els.status.hidden = online || !hasData;
}

function connect() {
  const source = new EventSource('/api/stream');
  source.onmessage = (event) => {
    setOnline(true);
    render(JSON.parse(event.data));
  };
  source.onerror = () => {
    setOnline(false);
    if (source.readyState === EventSource.CLOSED) {
      source.close();
      setTimeout(connect, 2000);
    }
  };
}

setTimeout(() => {
  if (!hasData) {
    showMessage(
      'Server belum terjangkau',
      'Pastikan server menyala di laptop panitia. Halaman ini mencoba menyambung lagi otomatis.',
    );
  }
}, 6000);

connect();

// Layar penuh dengan tombol F atau klik dua kali. Kursor disembunyikan saat mouse diam.
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}
addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey) toggleFullscreen();
});
addEventListener('dblclick', toggleFullscreen);

let idleTimer;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 2500);
}
addEventListener('mousemove', wake);
wake();
