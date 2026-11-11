// Turns a common-shape item into ONE world state.
// Strict priority: the first rule that matches wins.

export const STATES = ['working', 'done', 'waiting', 'stale', 'idle'];

export function stateOf(item, rules, now = Date.now()) {
  // minutes since the last real event; Infinity when none is known
  const known = item.lastActivity !== null && item.lastActivity !== undefined;
  const minutesSince = known ? (now - Date.parse(item.lastActivity)) / 60e3 : Infinity;

  // 1. Working now — in progress AND a real event within the working window
  if (item.status === 'working' && minutesSince <= rules.workingMinutes) return 'working';
  // 2. Done / shipped
  if (item.status === 'done') return 'done';
  // 3. Waiting on me
  if (item.status === 'waiting') return 'waiting';
  // 4. Stale / asleep — no event for a long while (unknown activity is not "stale")
  if (known && minutesSince >= rules.staleAfterDays * 24 * 60) return 'stale';
  // 5. Idle — everything else
  return 'idle';
}
