// Working time, from activity events (file saves, _links.md edits, chat events).
//
// Events closer together than state.workingMinutes join into one working
// period, from its first event to its last. A period counts at least
// MIN_PERIOD_MINUTES, so a lone save isn't zero. Summed into "time today"
// (since local midnight) and "time total".
//
// Used by the dev-server helpers (tools/projectsFolder.js, tools/chats.js)
// and by the Claude Code hook (tools/reef-hook.mjs).

import fs from 'node:fs/promises';

export const MIN_PERIOD_MINUTES = 5;
const MAX_PERIODS = 400; // older periods are folded into pastMs

// a period's length: at least the minimum, but never counted past "now"
const span = (p, now = Infinity) => Math.max(p[1] - p[0], Math.min(MIN_PERIOD_MINUTES * 60e3, now - p[0]));

// rec: { periods: [[startMs, endMs], ...], pastMs }. Returns true if it changed.
export function addEvent(rec, t, workingMinutes) {
  if (!t || !Number.isFinite(t)) return false;
  rec.periods ??= [];
  const last = rec.periods.at(-1);
  if (last && t <= last[1]) return false; // already counted (or older)
  if (last && t - last[1] <= workingMinutes * 60e3) last[1] = t;
  else rec.periods.push([t, t]);
  while (rec.periods.length > MAX_PERIODS) rec.pastMs = (rec.pastMs ?? 0) + span(rec.periods.shift());
  return true;
}

export function summarize(rec, now = Date.now()) {
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  let total = rec?.pastMs ?? 0, today = 0;
  for (const p of rec?.periods ?? []) {
    const s = span(p, now);
    total += s;
    today += Math.max(0, Math.min(p[0] + s, now) - Math.max(p[0], midnight));
  }
  return { minutesToday: Math.round(today / 60e3), minutesTotal: Math.round(total / 60e3) };
}

// A small JSON store of periods per item id (read, change, save if changed).
export async function withTimeStore(file, fn) {
  let store = {};
  try {
    store = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {}
  const before = JSON.stringify(store);
  const result = await fn(store);
  if (JSON.stringify(store) !== before) {
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(store));
    await fs.rename(tmp, file); // atomic: the widget's server and `npm run dev` may both write
  }
  return result;
}
