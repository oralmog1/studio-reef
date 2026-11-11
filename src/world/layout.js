// Sticky layout: which hex tiles each zone (client) owns.
//
// Rules
//  - A zone wants 1 tile, plus 1 more per `itemsPerExtraTile` items.
//  - A growing zone claims free tiles touching it, closest to its root first.
//  - A shrinking zone gives back its newest tiles first.
//  - A new zone takes the innermost free tile.
//  - Zones try to keep a one-tile gap from each other so they read as
//    separate places (they only touch if the map runs out of room).
//  - Zones whose client disappeared from the data free their tiles.
//
// The result is saved in the browser (localStorage) so the map stays put
// between reloads. Saved shape: { [zoneName]: ["q,r", ...] } where the
// first key is the root and the list is in claim order (oldest first).

import { parse, neighbours, distance } from './hex.js';

const STORAGE_KEY = 'studio-reef.layout.v1';

export function tilesWanted(count, itemsPerExtraTile) {
  return 1 + Math.floor(count / itemsPerExtraTile);
}

// groups: [{ name, count }]; cells: output of hex.tilesWithin (innermost first)
export function computeLayout(groups, saved, cells, itemsPerExtraTile) {
  const valid = new Set(cells.map((c) => c.key));
  const owner = new Map(); // tile key → zone name
  const zones = {};
  const wanted = Object.fromEntries(groups.map((g) => [g.name, tilesWanted(g.count, itemsPerExtraTile)]));
  const names = groups.map((g) => g.name).sort(); // fixed order, independent of data order

  // 1. Keep saved zones that still exist, trimming newest tiles if they shrank.
  for (const name of names) {
    const tiles = (saved?.[name] ?? []).filter((k) => valid.has(k) && !owner.has(k));
    if (!tiles.length) continue;
    zones[name] = tiles.slice(0, wanted[name]);
    zones[name].forEach((k) => owner.set(k, name));
  }

  const touchesOther = (k, name) => neighbours(...parse(k)).some((n) => owner.has(n) && owner.get(n) !== name);

  const grow = (name) => {
    const tiles = zones[name];
    const [rq, rr] = parse(tiles[0]);
    while (tiles.length < wanted[name]) {
      const candidates = new Set();
      for (const t of tiles) for (const n of neighbours(...parse(t))) if (valid.has(n) && !owner.has(n)) candidates.add(n);
      if (!candidates.size) break; // boxed in; stays smaller
      const ranked = [...candidates].sort((a, b) => {
        const [aq, ar] = parse(a), [bq, br] = parse(b);
        return (
          touchesOther(a, name) - touchesOther(b, name) || // prefer keeping the gap
          distance(aq, ar, rq, rr) - distance(bq, br, rq, rr) || // stay compact around the root
          distance(aq, ar, 0, 0) - distance(bq, br, 0, 0) || // then lean inward
          cells.findIndex((c) => c.key === a) - cells.findIndex((c) => c.key === b)
        );
      });
      tiles.push(ranked[0]);
      owner.set(ranked[0], name);
    }
  };

  // 2. Existing zones grow first, so their familiar shape isn't crowded out.
  for (const name of names) if (zones[name]) grow(name);

  // 3. New zones: innermost free tile, keeping the gap if possible.
  for (const name of names) {
    if (zones[name]) continue;
    const free = cells.filter((c) => !owner.has(c.key));
    const root = free.find((c) => !touchesOther(c.key, name) && !neighbours(c.q, c.r).some((n) => owner.has(n)))
      ?? free[0];
    if (!root) continue; // map is full
    zones[name] = [root.key];
    owner.set(root.key, name);
    grow(name);
  }

  return zones;
}

export function loadSavedLayout() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? null;
  } catch {
    return null;
  }
}

export function saveLayout(zones) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(zones));
  } catch {
    /* private mode etc. — layout just won't persist */
  }
}

export function clearSavedLayout() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
