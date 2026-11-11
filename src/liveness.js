// Keeps the world current while the page stays open.
//
// Every `checkSeconds` it re-reads all sources and works out every state
// again with the current time. It refreshes the page only when an item
// appeared or went, or its state, title, note or link changed. (States also
// change with time alone: "working" runs out after state.workingMinutes.)
// Everything else is updated in place, without a refresh: timestamps, time
// today/total, task steps, and coral size (the coral grows on screen).
// The main view waits until you've left it alone for `calmSeconds`; the
// widget refreshes at once.
import { loadItems } from './data/load.js';
import { stateOf } from './data/state.js';

const visible = (it, state) => [it.id, it.group, it.title, it.status, state, it.note ?? '', it.link ?? ''].join('\u0001');
const signature = (items, stateFn) => items.map((it) => visible(it, stateFn(it))).sort().join('\u0002');

export function keepCurrent({ dataCfg, items, states, rules, quality, checkSeconds, calmSeconds, fullAfterHours, onProgress, onUpdate }) {
  const shown = signature(items, (it) => states.get(it.id));
  const check = async () => {
    let fresh;
    try {
      fresh = (await loadItems(dataCfg, { fullAfterHours })).items;
    } catch {
      return; // server busy or restarting: try again next time
    }
    const now = Date.now();
    if (signature(fresh, (it) => stateOf(it, rules, now)) === shown) {
      const byId = new Map(fresh.map((it) => [it.id, it]));
      for (const it of items) {
        const f = byId.get(it.id);
        if (!f) continue;
        for (const k of ['lastActivity', 'minutesToday', 'minutesTotal', 'steps', 'progressSource', 'writtenProgress']) it[k] = f[k];
        if (Math.abs(f.progress - it.progress) >= 0.001) onProgress(it.id, f.progress);
      }
      onUpdate();
      return;
    }
    const calm = performance.now() - quality.lastInput > calmSeconds * 1000;
    if (calm) location.reload(); // otherwise try again at the next check
  };
  setInterval(check, checkSeconds * 1000);
  // macOS pauses pages in covered windows; catch up the moment it's visible again
  document.addEventListener('visibilitychange', () => document.hidden || check());
}
