import { standings, gameScore, formatScore, gamesScored } from './scoring.js';
import { contrast, DISPLAY_BG, MIN_BAR_CONTRAST } from './color.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

const TABS = [
  ['skor', 'Skor'],
  ['rekap', 'Rekap'],
  ['juara', 'Nilai juara'],
  ['kelompok', 'Kelompok'],
  ['game', 'Game'],
  ['pengaturan', 'Pengaturan'],
];
const STEP = 5;
const PALETTE = ['#4c9aff', '#ff6b6b', '#3ddc97', '#b28dff', '#ff9f43', '#2ec5d6', '#f472b6', '#c7d64a'];

let state = null;
let tab = 'skor';
let selectedGameId = null;
let dirty = false;
let saving = false;
let panel = null;
let toastTimer;

const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const signed = (n) => (n > 0 ? `+${n}` : formatScore(n));
const ratioText = (n) => n.toFixed(1).replace('.', ',');

async function api(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    const err = new Error('Server tidak terjangkau. Pastikan server masih menyala di laptop, lalu coba lagi. Isianmu di halaman ini tidak hilang.');
    err.status = 0;
    throw err;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* respons tanpa isi */
  }
  if (!res.ok) {
    const err = new Error(data?.error || 'Permintaan gagal. Coba lagi.');
    err.status = res.status;
    throw err;
  }
  return data;
}

const act = (type, payload = {}) => api('/api/action', { type, ...payload });

function toast(message, { error = false } = {}) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.classList.toggle('error', error);
  toastEl.hidden = false;
  toastTimer = setTimeout(() => (toastEl.hidden = true), error ? 7000 : 3000);
}

/* ---------- dialog ---------- */

function confirmDialog({ title, body, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.setAttribute('aria-labelledby', 'dialog-title');
    dialog.innerHTML = `
      <form method="dialog" class="dialog-body">
        <h2 id="dialog-title">${esc(title)}</h2>
        <p>${esc(body)}</p>
        <div class="actions">
          <button class="btn" value="cancel">Batal</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" value="ok">${esc(confirmLabel)}</button>
        </div>
      </form>`;
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
    });
    dialog.showModal();
  });
}

/* ---------- masuk ---------- */

function loginFormHTML(message = '') {
  return `
    <form class="login-form" id="login-form" novalidate>
      <label class="block-field">
        <span>PIN admin</span>
        <input type="password" name="pin" autocomplete="off" required />
      </label>
      <p class="form-error" role="alert" ${message ? '' : 'hidden'}>${esc(message)}</p>
      <button class="btn primary">Masuk</button>
    </form>`;
}

function bindLogin(form, onSuccess) {
  const error = form.querySelector('.form-error');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const pin = form.elements.pin.value;
    if (!pin) {
      error.textContent = 'Isi PIN dulu.';
      error.hidden = false;
      return;
    }
    try {
      await api('/api/login', { pin });
      await onSuccess();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      form.elements.pin.select();
    }
  });
  form.elements.pin.focus();
}

function renderLogin(message) {
  app.innerHTML = `
    <main class="login">
      <div class="panel login-card">
        <h1>Admin papan skor</h1>
        <p class="muted">Masukkan PIN admin. PIN diatur saat server dijalankan.</p>
        ${loginFormHTML(message)}
      </div>
    </main>`;
  bindLogin(app.querySelector('#login-form'), async () => {
    state = await api('/api/state');
    startApp();
  });
}

function promptRelogin() {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog';
  dialog.setAttribute('aria-labelledby', 'relogin-title');
  dialog.innerHTML = `
    <div class="dialog-body">
      <h2 id="relogin-title">Sesi admin habis</h2>
      <p>Masukkan PIN lagi. Isianmu di halaman ini tidak hilang.</p>
      ${loginFormHTML()}
    </div>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  bindLogin(dialog.querySelector('#login-form'), async () => {
    dialog.close();
    toast('Sudah masuk lagi. Tekan tombol simpan sekali lagi.');
  });
  dialog.showModal();
  dialog.querySelector('input').focus();
}

/* ---------- kerangka ---------- */

function startApp() {
  app.innerHTML = `
    <header class="topbar">
      <div class="topbar-title">
        <strong>Admin</strong>
        <span class="muted" id="event-title"></span>
      </div>
      <div class="topbar-actions">
        <button type="button" class="switch" role="switch" id="hide-switch" aria-checked="false">
          <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
          <span>Sembunyikan peringkat di layar</span>
        </button>
        <a class="btn" href="/" target="_blank" rel="noopener">Buka layar proyektor</a>
        <button type="button" class="btn" id="logout">Keluar</button>
      </div>
    </header>
    <nav class="tabs" aria-label="Menu admin">
      ${TABS.map(([id, label]) => `<button type="button" class="tab" data-tab="${id}">${label}</button>`).join('')}
    </nav>
    <main class="content" id="panel"></main>`;

  panel = document.getElementById('panel');
  syncTopbar();
  syncTabs();
  renderTab();

  document.getElementById('hide-switch').addEventListener('click', toggleHide);
  document.getElementById('logout').addEventListener('click', logout);
  app.querySelector('.tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button) goTab(button.dataset.tab);
  });
  panel.addEventListener('click', onPanelClick);
  panel.addEventListener('input', onPanelInput);
  panel.addEventListener('submit', onPanelSubmit);
  panel.addEventListener('keydown', onPanelKeydown);
}

// Enter di form berisi banyak baris pindah ke isian berikutnya, bukan menyimpan.
// Menyimpan langsung mengubah layar proyektor, jadi harus lewat tombol simpan.
function onPanelKeydown(event) {
  if (event.key !== 'Enter' || event.target.tagName !== 'INPUT') return;
  const form = event.target.closest('form');
  if (!form || form.id === 'title-form') return;
  event.preventDefault();
  const fields = [...form.querySelectorAll('input:not([type="color"]), select')];
  const next = fields[fields.indexOf(event.target) + 1];
  (next ?? form.querySelector('button[type="submit"]')).focus();
}

function syncTopbar() {
  document.getElementById('event-title').textContent = state.title;
  document.getElementById('hide-switch').setAttribute('aria-checked', String(state.hideRanking));
}

function syncTabs() {
  for (const button of app.querySelectorAll('.tab')) {
    if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

async function guardDirty() {
  if (!dirty) return true;
  return confirmDialog({
    title: 'Buang perubahan?',
    body: 'Ada perubahan yang belum disimpan di halaman ini.',
    confirmLabel: 'Buang perubahan',
    danger: true,
  });
}

async function goTab(next) {
  if (next === tab) return;
  if (!(await guardDirty())) return;
  tab = next;
  syncTabs();
  renderTab();
}

async function toggleHide() {
  try {
    state = await act('setHideRanking', { value: !state.hideRanking });
    syncTopbar();
    toast(state.hideRanking ? 'Peringkat disembunyikan di layar.' : 'Peringkat dibuka di layar.');
  } catch (err) {
    if (err.status === 401) return promptRelogin();
    toast(err.message, { error: true });
  }
}

async function logout() {
  if (!(await guardDirty())) return;
  await api('/api/logout', {}).catch(() => {});
  dirty = false;
  renderLogin();
}

function renderTab({ focusSubmit = false } = {}) {
  dirty = false;
  const views = {
    skor: viewScores,
    rekap: viewRecap,
    juara: viewPlacement,
    kelompok: viewGroups,
    game: viewGames,
    pengaturan: viewSettings,
  };
  panel.innerHTML = views[tab]();
  if (tab === 'skor') {
    panel.querySelectorAll('.score-row').forEach(updateRowPreview);
    syncCurrentControls();
  }
  if (tab === 'kelompok') {
    renumber(panel.querySelector('#group-rows'), 'kelompok');
    panel.querySelectorAll('.edit-row').forEach(updateColorHint);
  }
  if (tab === 'game') renumber(panel.querySelector('#game-rows'), 'game');
  if (focusSubmit) panel.querySelector('button[type="submit"], form .btn.primary')?.focus();
}

function empty(heading, body, gotoTab, gotoLabel) {
  return `
    <section class="panel empty">
      <h2>${esc(heading)}</h2>
      <p class="muted">${esc(body)}</p>
      ${gotoTab ? `<button type="button" class="btn primary" data-action="goto" data-tab="${gotoTab}">${esc(gotoLabel)}</button>` : ''}
    </section>`;
}

function formFooter(label, note = true) {
  return `
    <p class="form-error" role="alert" hidden></p>
    <div class="actions">
      <button type="submit" class="btn primary">${esc(label)}</button>
      ${note ? '<span class="dirty-note" hidden>Ada perubahan yang belum disimpan.</span>' : ''}
    </div>`;
}

/* ---------- tab skor ---------- */

function gameStatus(game) {
  const scored = Object.keys(state.results[game.id] ?? {}).length > 0;
  const live = state.currentGameId === game.id;
  return `${scored ? 'Sudah dinilai' : 'Belum dinilai'}${live ? ' · tampil di layar' : ''}`;
}

function pickerHTML() {
  return state.games
    .map(
      (game) => `
      <button type="button" class="chip" data-action="pick-game" data-game="${game.id}" aria-pressed="${game.id === selectedGameId}">
        <span class="chip-name">${esc(game.name)}</span>
        <span class="chip-status">${gameStatus(game)}</span>
      </button>`,
    )
    .join('');
}

function currentNote() {
  const live = state.games.find((g) => g.id === state.currentGameId);
  if (!live) return 'Layar belum menampilkan game berjalan.';
  if (live.id === selectedGameId) return 'Layar menampilkan game ini sebagai game berjalan.';
  return `Layar menampilkan "${live.name}" sebagai game berjalan.`;
}

function scoreRowHTML(group, entry, total) {
  const name = esc(group.name);
  const place = entry?.place ?? '';
  const options = [
    `<option value="">Belum ada juara</option>`,
    ...state.placementPoints.map(
      (pts, i) => `<option value="${i + 1}" ${place === i + 1 ? 'selected' : ''}>Juara ${i + 1} (${formatScore(pts)} poin)</option>`,
    ),
  ].join('');
  return `
    <div class="score-row" role="group" aria-labelledby="sn-${group.id}" data-group="${group.id}">
      <span class="score-name" id="sn-${group.id}">
        <span class="swatch" style="background:${group.color}" aria-hidden="true"></span>${name}
      </span>
      <div class="field">
        <span class="field-label" aria-hidden="true">Juara</span>
        <select name="place" aria-label="Juara ${name}">${options}</select>
      </div>
      <div class="field">
        <span class="field-label" aria-hidden="true">Poin manual</span>
        <div class="stepper">
          <button type="button" class="btn step" data-action="step" data-step="${-STEP}" aria-label="Kurangi ${STEP} poin ${name}">${formatScore(-STEP)}</button>
          <input type="number" name="manual" step="1" value="${entry?.manual ?? 0}" aria-label="Poin manual ${name}" />
          <button type="button" class="btn step" data-action="step" data-step="${STEP}" aria-label="Tambah ${STEP} poin ${name}">+${STEP}</button>
        </div>
      </div>
      <div class="field">
        <span class="field-label" aria-hidden="true">Skor game ini</span>
        <output class="game-score"></output>
        <span class="breakdown"></span>
      </div>
      <div class="field">
        <span class="field-label" aria-hidden="true">Total tersimpan</span>
        <span class="total">${formatScore(total)}</span>
      </div>
    </div>`;
}

function viewScores() {
  if (!state.groups.length) return empty('Belum ada kelompok', 'Tambahkan kelompok dulu, baru skor bisa diisi.', 'kelompok', 'Tambah kelompok');
  if (!state.games.length) return empty('Belum ada game', 'Tambahkan game dulu, baru skor bisa diisi.', 'game', 'Tambah game');
  if (!state.games.some((g) => g.id === selectedGameId)) selectedGameId = state.currentGameId ?? state.games[0].id;

  const game = state.games.find((g) => g.id === selectedGameId);
  const totals = new Map(standings(state).map((r) => [r.group.id, r.total]));
  const rows = state.groups
    .map((group) => scoreRowHTML(group, state.results[game.id]?.[group.id], totals.get(group.id)))
    .join('');

  return `
    <div class="game-picker" id="game-picker" role="group" aria-label="Pilih game">${pickerHTML()}</div>
    <form class="panel" id="score-form" data-draft novalidate>
      <div class="panel-head">
        <div>
          <h2>${esc(game.name)}</h2>
          <p class="muted">Pilih juara, atau ketik poin manual (boleh minus). Layar baru berubah setelah kamu menekan Simpan skor.</p>
        </div>
        <div class="current-control">
          <button type="button" class="btn" data-action="toggle-current" id="toggle-current"></button>
          <p class="muted small" id="current-note"></p>
        </div>
      </div>
      <div class="score-head" aria-hidden="true">
        <span>Kelompok</span><span>Juara</span><span>Poin manual</span><span>Skor game ini</span><span>Total tersimpan</span>
      </div>
      <div class="score-rows">${rows}</div>
      ${formFooter('Simpan skor')}
    </form>`;
}

function syncCurrentControls() {
  const button = document.getElementById('toggle-current');
  if (!button) return;
  button.textContent = state.currentGameId === selectedGameId ? 'Lepas dari layar' : 'Tampilkan di layar';
  document.getElementById('current-note').textContent = currentNote();
  document.getElementById('game-picker').innerHTML = pickerHTML();
}

function updateRowPreview(row) {
  const place = row.querySelector('[name="place"]').value;
  const raw = row.querySelector('[name="manual"]').value.trim();
  const manual = raw === '' ? 0 : Number(raw);
  const points = place ? (state.placementPoints[Number(place) - 1] ?? 0) : 0;
  const output = row.querySelector('.game-score');
  const note = row.querySelector('.breakdown');
  if (!Number.isFinite(manual)) {
    output.textContent = '?';
    note.textContent = 'Poin manual tidak valid';
    return;
  }
  output.textContent = formatScore(points + manual);
  note.textContent = `${formatScore(points)} dari juara, ${signed(manual)} manual`;
}

function readScores(form) {
  const results = {};
  for (const row of form.querySelectorAll('.score-row')) {
    const place = row.querySelector('[name="place"]').value;
    const raw = row.querySelector('[name="manual"]').value.trim();
    results[row.dataset.group] = { place: place ? Number(place) : null, manual: raw === '' ? 0 : Number(raw) };
  }
  return results;
}

/* ---------- tab rekap ---------- */

function viewRecap() {
  if (!state.groups.length || !state.games.length) {
    return empty('Belum ada yang direkap', 'Rekap muncul setelah ada kelompok dan game.', state.groups.length ? 'game' : 'kelompok', state.groups.length ? 'Tambah game' : 'Tambah kelompok');
  }
  const head = state.games.map((g) => `<th scope="col">${esc(g.name)}</th>`).join('');
  const body = standings(state)
    .map((row) => {
      const cells = state.games
        .map((game) => {
          const s = gameScore(state, game.id, row.group.id);
          if (!s.entered) return '<td class="cell-empty">Belum ada</td>';
          const detail = [s.place ? `J${s.place}` : '', s.manual ? signed(s.manual) : ''].filter(Boolean).join(' ');
          return `<td><span class="cell-main">${formatScore(s.total)}</span>${detail ? `<span class="cell-sub">${detail}</span>` : ''}</td>`;
        })
        .join('');
      return `
        <tr>
          <th scope="row"><span class="rank-num">${row.rank}</span><span class="swatch" style="background:${row.group.color}" aria-hidden="true"></span>${esc(row.group.name)}</th>
          ${cells}
          <td class="cell-total">${formatScore(row.total)}</td>
        </tr>`;
    })
    .join('');
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Rekap skor</h2>
          <p class="muted">${gamesScored(state)} dari ${state.games.length} game sudah dinilai. Angka kecil di bawah skor: J1 berarti juara 1, lalu poin manual kalau ada.</p>
        </div>
      </div>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Rekap skor semua game">
        <table class="recap">
          <caption class="sr-only">Skor tiap kelompok di tiap game, diurutkan dari peringkat teratas</caption>
          <thead><tr><th scope="col">Kelompok</th>${head}<th scope="col">Total</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>`;
}

/* ---------- tab nilai juara ---------- */

function placeRowHTML(index, points) {
  return `
    <label class="place-row">
      <span class="place-label">Juara ${index + 1}</span>
      <input type="number" name="points" step="1" value="${points}" aria-label="Poin untuk juara ${index + 1}" />
      <span class="muted small">poin</span>
    </label>`;
}

function viewPlacement() {
  return `
    <form class="panel narrow" id="placement-form" data-draft novalidate>
      <h2>Nilai juara</h2>
      <p class="muted">Poin yang didapat kelompok menurut juaranya di sebuah game. Kelompok tanpa juara tidak dapat poin dari juara, tapi poin manualnya tetap dihitung.</p>
      <div id="place-rows" class="place-rows">${state.placementPoints.map((pts, i) => placeRowHTML(i, pts)).join('')}</div>
      <div class="actions">
        <button type="button" class="btn" data-action="add-place">Tambah juara</button>
        <button type="button" class="btn" data-action="remove-place">Hapus juara terakhir</button>
      </div>
      ${formFooter('Simpan nilai juara')}
    </form>`;
}

/* ---------- tab kelompok ---------- */

function groupRowHTML(group) {
  return `
    <div class="edit-row" data-id="${group.id ?? ''}">
      <input type="color" name="color" value="${group.color}" />
      <input type="text" name="name" value="${esc(group.name)}" maxlength="50" autocomplete="off" />
      <button type="button" class="btn" data-action="remove-row">Hapus</button>
      <p class="row-hint" hidden></p>
    </div>`;
}

function viewGroups() {
  return `
    <form class="panel narrow" id="groups-form" data-draft novalidate>
      <h2>Kelompok</h2>
      <p class="muted">Nama dan warna tiap kelompok. Warna dipakai untuk batang skor di layar, jadi pilih yang terang supaya terbaca dari jauh.</p>
      <div id="group-rows" class="edit-rows">${state.groups.map(groupRowHTML).join('')}</div>
      <div class="actions"><button type="button" class="btn" data-action="add-group">Tambah kelompok</button></div>
      ${formFooter('Simpan kelompok')}
    </form>`;
}

function updateColorHint(row) {
  const color = row.querySelector('[name="color"]');
  const hint = row.querySelector('.row-hint');
  if (!color || !hint) return;
  const ratio = contrast(color.value, DISPLAY_BG);
  hint.hidden = ratio >= MIN_BAR_CONTRAST;
  hint.textContent = `Warna ini kurang terang untuk layar (kontras ${ratioText(ratio)}:1, minimal ${MIN_BAR_CONTRAST}:1). Pilih yang lebih terang.`;
}

/* ---------- tab game ---------- */

function gameRowHTML(game) {
  return `
    <div class="edit-row game-edit" data-id="${game.id ?? ''}">
      <span class="row-num" aria-hidden="true"></span>
      <input type="text" name="name" value="${esc(game.name)}" maxlength="50" autocomplete="off" />
      <div class="row-buttons">
        <button type="button" class="btn" data-action="move-up">Naik</button>
        <button type="button" class="btn" data-action="move-down">Turun</button>
        <button type="button" class="btn" data-action="remove-row">Hapus</button>
      </div>
    </div>`;
}

function viewGames() {
  return `
    <form class="panel narrow" id="games-form" data-draft novalidate>
      <h2>Game</h2>
      <p class="muted">Nama dan urutan game. Urutan ini dipakai di daftar game dan rekap.</p>
      <div id="game-rows" class="edit-rows">${state.games.map(gameRowHTML).join('')}</div>
      <div class="actions"><button type="button" class="btn" data-action="add-game">Tambah game</button></div>
      ${formFooter('Simpan game')}
    </form>`;
}

// Nomor dan label aksesibel dihitung ulang dari urutan baris setelah tambah, hapus, atau pindah.
function renumber(container, noun) {
  container.querySelectorAll('.edit-row').forEach((row, i) => {
    const n = i + 1;
    const num = row.querySelector('.row-num');
    if (num) num.textContent = n;
    const name = row.querySelector('[name="name"]');
    name.setAttribute('aria-label', `Nama ${noun} ke-${n}`);
    row.querySelector('[name="color"]')?.setAttribute('aria-label', `Warna ${noun} ke-${n}`);
    row.querySelector('[data-action="remove-row"]').setAttribute('aria-label', `Hapus ${noun} ke-${n}`);
    row.querySelector('[data-action="move-up"]')?.setAttribute('aria-label', `Naikkan ${noun} ke-${n}`);
    row.querySelector('[data-action="move-down"]')?.setAttribute('aria-label', `Turunkan ${noun} ke-${n}`);
  });
}

/* ---------- tab pengaturan ---------- */

function viewSettings() {
  return `
    <form class="panel narrow" id="title-form" data-draft novalidate>
      <h2>Acara</h2>
      <p class="muted">Judul tampil sebagai tulisan besar di kiri atas layar proyektor.</p>
      <label class="block-field">
        <span>Judul acara</span>
        <input type="text" name="title" value="${esc(state.title)}" maxlength="80" autocomplete="off" />
      </label>
      ${formFooter('Simpan judul')}
    </form>

    <section class="panel narrow">
      <h2>Layar proyektor</h2>
      <p>Buka <a href="/" target="_blank" rel="noopener">alamat layar</a> di browser yang tersambung ke proyektor. Tekan F atau klik dua kali di layar itu untuk layar penuh.</p>
      <p class="muted">Peringkat bisa disembunyikan lewat tombol di bagian atas halaman ini, lalu dibuka lagi saat pengumuman.</p>
    </section>

    <section class="panel narrow">
      <h2>Hapus semua skor</h2>
      <p class="muted">Mengosongkan juara dan poin manual di semua game. Kelompok, game, dan nilai juara tetap ada. Berguna setelah latihan sebelum acara.</p>
      <div class="actions"><button type="button" class="btn danger" data-action="reset-scores">Hapus semua skor</button></div>
    </section>`;
}

/* ---------- event ---------- */

function markDirty(form) {
  dirty = true;
  const note = form.querySelector('.dirty-note');
  if (note) note.hidden = false;
}

function showFormError(form, message) {
  const error = form.querySelector('.form-error');
  error.textContent = message;
  error.hidden = false;
}

async function pickGame(id) {
  if (id === selectedGameId) return;
  if (!(await guardDirty())) return;
  selectedGameId = id;
  renderTab();
}

async function toggleCurrent() {
  const next = state.currentGameId === selectedGameId ? null : selectedGameId;
  try {
    state = await act('setCurrentGame', { gameId: next });
    syncCurrentControls();
    toast(next ? 'Game ini tampil di layar.' : 'Game berjalan dilepas dari layar.');
  } catch (err) {
    if (err.status === 401) return promptRelogin();
    toast(err.message, { error: true });
  }
}

function addEditRow(containerId, html, noun) {
  const container = document.getElementById(containerId);
  container.insertAdjacentHTML('beforeend', html);
  renumber(container, noun);
  const row = container.lastElementChild;
  row.querySelector('[name="name"]')?.focus();
  markDirty(container.closest('form'));
  return row;
}

function nextColor() {
  const used = new Set([...panel.querySelectorAll('#group-rows [name="color"]')].map((i) => i.value.toLowerCase()));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[used.size % PALETTE.length];
}

async function resetScores() {
  const ok = await confirmDialog({
    title: 'Hapus semua skor?',
    body: 'Juara dan poin manual di semua game akan dikosongkan. Ini tidak bisa dibatalkan.',
    confirmLabel: 'Hapus semua skor',
    danger: true,
  });
  if (!ok) return;
  try {
    state = await act('resetScores');
    toast('Semua skor sudah dihapus.');
  } catch (err) {
    if (err.status === 401) return promptRelogin();
    toast(err.message, { error: true });
  }
}

async function onPanelClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action } = target.dataset;
  const form = target.closest('form');

  if (action === 'goto') return goTab(target.dataset.tab);
  if (action === 'pick-game') return pickGame(target.dataset.game);
  if (action === 'toggle-current') return toggleCurrent();
  if (action === 'reset-scores') return resetScores();

  if (action === 'step') {
    const input = target.closest('.stepper').querySelector('input');
    input.value = String((Number(input.value) || 0) + Number(target.dataset.step));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (action === 'add-place') {
    const rows = document.getElementById('place-rows');
    const count = rows.children.length;
    const last = Number(rows.lastElementChild?.querySelector('input').value) || 0;
    rows.insertAdjacentHTML('beforeend', placeRowHTML(count, Math.max(0, last - 20)));
    rows.lastElementChild.querySelector('input').focus();
    return markDirty(form);
  }
  if (action === 'remove-place') {
    const rows = document.getElementById('place-rows');
    if (rows.children.length <= 1) return showFormError(form, 'Minimal harus ada satu juara.');
    rows.lastElementChild.remove();
    return markDirty(form);
  }
  if (action === 'add-group') {
    return addEditRow('group-rows', groupRowHTML({ name: '', color: nextColor() }), 'kelompok');
  }
  if (action === 'add-game') return addEditRow('game-rows', gameRowHTML({ name: '' }), 'game');

  const row = target.closest('.edit-row');
  if (!row) return;
  const container = row.parentElement;
  const noun = container.id === 'group-rows' ? 'kelompok' : 'game';

  if (action === 'remove-row') {
    const neighbour = row.nextElementSibling ?? row.previousElementSibling;
    row.remove();
    renumber(container, noun);
    (neighbour?.querySelector('[name="name"]') ?? form.querySelector('[data-action^="add-"]')).focus();
  } else if (action === 'move-up' && row.previousElementSibling) {
    row.previousElementSibling.before(row);
    renumber(container, noun);
    target.focus();
  } else if (action === 'move-down' && row.nextElementSibling) {
    row.nextElementSibling.after(row);
    renumber(container, noun);
    target.focus();
  }
  markDirty(form);
}

function onPanelInput(event) {
  const form = event.target.closest('form[data-draft]');
  if (!form) return;
  form.querySelector('.form-error')?.setAttribute('hidden', '');
  markDirty(form);

  const scoreRow = event.target.closest('.score-row');
  if (scoreRow) updateRowPreview(scoreRow);
  const editRow = event.target.closest('.edit-row');
  if (editRow && event.target.name === 'color') updateColorHint(editRow);
}

async function onPanelSubmit(event) {
  event.preventDefault();
  if (saving) return;
  const form = event.target;
  form.querySelector('.form-error').hidden = true;

  let action;
  let payload;
  let message;
  let rerender = false;

  if (form.id === 'score-form') {
    action = 'saveResults';
    payload = { gameId: selectedGameId, results: readScores(form) };
    message = 'Skor tersimpan. Layar sudah diperbarui.';
  } else if (form.id === 'placement-form') {
    action = 'savePlacementPoints';
    payload = { points: [...form.querySelectorAll('[name="points"]')].map((i) => (i.value.trim() === '' ? NaN : Number(i.value))) };
    message = 'Nilai juara tersimpan. Total semua kelompok dihitung ulang.';
  } else if (form.id === 'title-form') {
    action = 'saveTitle';
    payload = { title: form.elements.title.value };
    message = 'Judul tersimpan.';
  } else if (form.id === 'groups-form' || form.id === 'games-form') {
    const isGroups = form.id === 'groups-form';
    const rows = [...form.querySelectorAll('.edit-row')];
    const items = rows.map((row) => ({
      ...(row.dataset.id ? { id: row.dataset.id } : {}),
      name: row.querySelector('[name="name"]').value,
      ...(isGroups ? { color: row.querySelector('[name="color"]').value } : {}),
    }));
    const list = isGroups ? state.groups : state.games;
    const kept = new Set(items.map((i) => i.id));
    const removed = list.filter((item) => !kept.has(item.id));
    if (removed.length) {
      const ok = await confirmDialog({
        title: `Hapus ${removed.length} ${isGroups ? 'kelompok' : 'game'}?`,
        body: `Yang dihapus: ${removed.map((r) => r.name).join(', ')}. Skornya ${isGroups ? 'di semua game' : 'di semua kelompok'} ikut terhapus dan tidak bisa dikembalikan.`,
        confirmLabel: 'Hapus dan simpan',
        danger: true,
      });
      if (!ok) return;
    }
    action = isGroups ? 'saveGroups' : 'saveGames';
    payload = isGroups ? { groups: items } : { games: items };
    message = isGroups ? 'Kelompok tersimpan.' : 'Game tersimpan.';
    rerender = true;
  } else {
    return;
  }

  // Tombol tidak di-disable supaya fokus keyboard tidak hilang saat menyimpan.
  saving = true;
  const button = form.querySelector('button[type="submit"]');
  const idleLabel = button.textContent;
  button.textContent = 'Menyimpan…';
  button.setAttribute('aria-busy', 'true');
  try {
    state = await act(action, payload);
    dirty = false;
    syncTopbar();
    toast(message);
    if (rerender) {
      renderTab({ focusSubmit: true });
    } else {
      form.querySelector('.dirty-note')?.setAttribute('hidden', '');
      if (form.id === 'score-form') refreshSavedTotals(form);
    }
  } catch (err) {
    if (err.status === 401) promptRelogin();
    else showFormError(form, err.message);
  } finally {
    saving = false;
    button.textContent = idleLabel;
    button.removeAttribute('aria-busy');
  }
}

function refreshSavedTotals(form) {
  const totals = new Map(standings(state).map((r) => [r.group.id, r.total]));
  for (const row of form.querySelectorAll('.score-row')) {
    row.querySelector('.total').textContent = formatScore(totals.get(row.dataset.group) ?? 0);
  }
  document.getElementById('game-picker').innerHTML = pickerHTML();
}

addEventListener('beforeunload', (event) => {
  if (dirty) event.preventDefault();
});

async function boot() {
  try {
    const session = await api('/api/session');
    if (!session.admin) return renderLogin();
    state = await api('/api/state');
    startApp();
  } catch (err) {
    app.innerHTML = `
      <main class="login">
        <div class="panel login-card">
          <h1>Server tidak terjangkau</h1>
          <p class="muted">Pastikan server menyala di laptop panitia, lalu coba lagi.</p>
          <button type="button" class="btn primary" id="retry">Coba lagi</button>
        </div>
      </main>`;
    document.getElementById('retry').addEventListener('click', boot);
  }
}

boot();
