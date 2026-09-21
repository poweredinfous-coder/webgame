// Dipakai layar proyektor dan halaman admin, supaya angka di kedua tempat selalu sama.

export function placePoints(state, place) {
  return place ? (state.placementPoints[place - 1] ?? 0) : 0;
}

export function gameScore(state, gameId, groupId) {
  const entry = state.results[gameId]?.[groupId];
  if (!entry) return { place: null, placePts: 0, manual: 0, total: 0, entered: false };
  const placePts = placePoints(state, entry.place);
  return { place: entry.place, placePts, manual: entry.manual, total: placePts + entry.manual, entered: true };
}

// Peringkat kompetisi: skor sama berbagi peringkat (1, 2, 2, 4). Urutan seri mengikuti urutan kelompok.
export function standings(state) {
  const rows = state.groups.map((group, order) => ({
    group,
    order,
    total: state.games.reduce((sum, game) => sum + gameScore(state, game.id, group.id).total, 0),
  }));
  rows.sort((a, b) => b.total - a.total || a.order - b.order);

  let rank = 0;
  let previous;
  rows.forEach((row, i) => {
    if (row.total !== previous) {
      rank = i + 1;
      previous = row.total;
    }
    row.rank = rank;
  });
  return rows;
}

export function gamesScored(state) {
  return state.games.filter((game) => Object.keys(state.results[game.id] ?? {}).length > 0).length;
}

// Tanda minus sungguhan (U+2212) supaya terbaca jelas di proyektor.
export const formatScore = (n) => (n < 0 ? `−${-n}` : String(n));
