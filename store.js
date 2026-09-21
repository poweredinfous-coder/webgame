import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class ValidationError extends Error {}

const LIMITS = { title: 80, name: 50, items: 40, points: 100_000 };
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const newId = () => randomUUID().slice(0, 8);

function seed() {
  const groups = [
    ['Tim Biru', '#4c9aff'],
    ['Tim Merah', '#ff6b6b'],
    ['Tim Hijau', '#3ddc97'],
    ['Tim Ungu', '#b28dff'],
    ['Tim Oranye', '#ff9f43'],
  ].map(([name, color]) => ({ id: newId(), name, color }));

  const games = ['Estafet balon', 'Kursi musik', 'Tarik tambang', 'Lempar bola', 'Estafet air'].map(
    (name) => ({ id: newId(), name }),
  );

  return {
    version: 1,
    title: 'Family Gathering 2026',
    groups,
    games,
    // Indeks 0 = poin untuk juara 1, indeks 1 = juara 2, dan seterusnya.
    placementPoints: [100, 80, 60, 40, 20],
    // results[gameId][groupId] = { place: number | null, manual: number }
    results: {},
    currentGameId: null,
    hideRanking: false,
  };
}

function cleanText(value, label, max) {
  if (typeof value !== 'string') throw new ValidationError(`${label} harus berupa teks.`);
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) throw new ValidationError(`${label} tidak boleh kosong.`);
  if (text.length > max) throw new ValidationError(`${label} maksimal ${max} karakter.`);
  return text;
}

function cleanInt(value, label, { min = -LIMITS.points, max = LIMITS.points } = {}) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(`${label} harus bilangan bulat antara ${min} dan ${max}.`);
  }
  return n;
}

function cleanList(value, label, min = 0) {
  if (!Array.isArray(value)) throw new ValidationError(`${label} harus berupa daftar.`);
  if (value.length < min) throw new ValidationError(`${label} minimal ${min} baris.`);
  if (value.length > LIMITS.items) throw new ValidationError(`${label} maksimal ${LIMITS.items} baris.`);
  return value;
}

// Dipakai untuk kelompok dan game: baris yang punya id harus id yang sudah ada
// di server, baris tanpa id dianggap baru.
function mergeNamed(current, incoming, noun, extra = () => ({})) {
  const list = cleanList(incoming, `Daftar ${noun}`);
  const known = new Set(current.map((item) => item.id));
  const used = new Set();
  const names = new Set();

  return list.map((item, i) => {
    const name = cleanText(item?.name, `Nama ${noun} ke-${i + 1}`, LIMITS.name);
    const key = name.toLowerCase();
    if (names.has(key)) throw new ValidationError(`Nama "${name}" dipakai dua kali.`);
    names.add(key);

    let id = item.id;
    if (id == null) {
      do id = newId();
      while (known.has(id) || used.has(id));
    } else if (!known.has(id) || used.has(id)) {
      throw new ValidationError('Daftar tidak cocok dengan data di server. Muat ulang halaman admin.');
    }
    used.add(id);
    return { id, name, ...extra(item, name) };
  });
}

function highestPlaceUsed(results) {
  let max = 0;
  for (const byGroup of Object.values(results)) {
    for (const entry of Object.values(byGroup)) if (entry.place > max) max = entry.place;
  }
  return max;
}

const actions = {
  saveTitle(state, { title }) {
    state.title = cleanText(title, 'Judul acara', LIMITS.title);
  },

  saveGroups(state, { groups }) {
    state.groups = mergeNamed(state.groups, groups, 'kelompok', (item, name) => {
      if (typeof item.color !== 'string' || !HEX_COLOR.test(item.color)) {
        throw new ValidationError(`Warna untuk "${name}" tidak valid.`);
      }
      return { color: item.color.toLowerCase() };
    });
    const keep = new Set(state.groups.map((g) => g.id));
    for (const byGroup of Object.values(state.results)) {
      for (const groupId of Object.keys(byGroup)) if (!keep.has(groupId)) delete byGroup[groupId];
    }
  },

  saveGames(state, { games }) {
    state.games = mergeNamed(state.games, games, 'game');
    const keep = new Set(state.games.map((g) => g.id));
    for (const gameId of Object.keys(state.results)) if (!keep.has(gameId)) delete state.results[gameId];
    if (state.currentGameId && !keep.has(state.currentGameId)) state.currentGameId = null;
  },

  savePlacementPoints(state, { points }) {
    const next = cleanList(points, 'Nilai juara', 1).map((p, i) => cleanInt(p, `Nilai juara ke-${i + 1}`));
    const used = highestPlaceUsed(state.results);
    if (next.length < used) {
      throw new ValidationError(
        `Juara ke-${used} masih dipakai di hasil game. Ubah hasil itu dulu sebelum menghapus barisnya.`,
      );
    }
    state.placementPoints = next;
  },

  saveResults(state, { gameId, results }) {
    if (!state.games.some((g) => g.id === gameId)) {
      throw new ValidationError('Game tidak ditemukan. Muat ulang halaman admin.');
    }
    if (!results || typeof results !== 'object' || Array.isArray(results)) {
      throw new ValidationError('Data hasil tidak valid.');
    }
    const groupIds = new Set(state.groups.map((g) => g.id));
    if (Object.keys(results).some((id) => !groupIds.has(id))) {
      throw new ValidationError('Daftar kelompok tidak cocok dengan data di server. Muat ulang halaman admin.');
    }

    const next = {};
    for (const group of state.groups) {
      const raw = results[group.id] ?? {};
      const place =
        raw.place == null || raw.place === ''
          ? null
          : cleanInt(raw.place, `Juara ${group.name}`, { min: 1, max: state.placementPoints.length });
      const manual =
        raw.manual == null || raw.manual === '' ? 0 : cleanInt(raw.manual, `Poin manual ${group.name}`);
      if (place !== null || manual !== 0) next[group.id] = { place, manual };
    }

    if (Object.keys(next).length) state.results[gameId] = next;
    else delete state.results[gameId];
  },

  setCurrentGame(state, { gameId }) {
    if (gameId !== null && !state.games.some((g) => g.id === gameId)) {
      throw new ValidationError('Game tidak ditemukan. Muat ulang halaman admin.');
    }
    state.currentGameId = gameId;
  },

  setHideRanking(state, { value }) {
    if (typeof value !== 'boolean') throw new ValidationError('Nilai tidak valid.');
    state.hideRanking = value;
  },

  resetScores(state) {
    state.results = {};
  },
};

function looksValid(s) {
  return (
    s &&
    Array.isArray(s.groups) &&
    Array.isArray(s.games) &&
    Array.isArray(s.placementPoints) &&
    s.results &&
    typeof s.results === 'object'
  );
}

function persist(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(tmp, file);
}

function load(file) {
  const problems = [];
  for (const candidate of [file, `${file}.bak`]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (!looksValid(parsed)) throw new Error('struktur data tidak dikenali');
      if (candidate !== file) console.warn(`Memakai cadangan ${candidate} karena ${file} rusak.`);
      return parsed;
    } catch (err) {
      problems.push(`${candidate}: ${err.message}`);
    }
  }

  if (problems.length) {
    console.warn(`Data lama tidak bisa dibaca, memulai dari data awal.\n  ${problems.join('\n  ')}`);
    if (fs.existsSync(file)) fs.renameSync(file, `${file}.rusak-${Date.now()}`);
  }
  const fresh = seed();
  persist(file, fresh);
  return fresh;
}

export function createStore(file) {
  let state = load(file);
  const listeners = new Set();

  return {
    get state() {
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispatch(type, payload = {}) {
      if (!Object.hasOwn(actions, type)) throw new ValidationError('Aksi tidak dikenal.');
      // Ubah salinan dulu: kalau validasi gagal di tengah jalan, data asli tetap utuh.
      const next = structuredClone(state);
      actions[type](next, payload);
      persist(file, next);
      state = next;
      for (const listener of listeners) {
        try {
          listener(state);
        } catch (err) {
          console.error('Listener gagal:', err);
        }
      }
      return state;
    },
  };
}
