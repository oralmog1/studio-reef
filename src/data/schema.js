// The one shape every data source is normalised into.
// The world only ever reads objects like this.
//
// {
//   id:           string   — stable, unique. Colours and props are hashed from it.
//   group:        string   — the territory (client) this item belongs to.
//   title:        string   — what shows on the info card.
//   status:       'working' | 'done' | 'waiting' | 'open'
//   progress:     number   — 0 to 1. Drives how big the coral grows.
//   lastActivity: string | null — ISO date of the last real event on this item
//                  (a file saved, its status/% edited). null = none known yet.
//   link:         string   — URL of the original item.
//   note:         string?  — optional short detail for the card (e.g. what a chat is waiting for).
//   linkLabel:    string?  — optional button text for the link (default "Open original").
//   steps:        {done,total}? — a task list (Claude Code sessions)
//   minutesToday, minutesTotal: number? — working time (see tools/timeTracker.js)
//   progressSource: set by load.js — where the coral's size came from:
//                  'manual' (set on the card) · 'steps' · 'written' (a % in a file) · 'time'
// }

export const STATUSES = ['working', 'done', 'waiting', 'open'];

// Throws a readable error if an adapter produced something off-shape.
export function validateItem(item, index) {
  const where = `item #${index} (${item?.id ?? 'no id'})`;
  const fail = (msg) => {
    throw new Error(`Bad data from adapter — ${where}: ${msg}`);
  };
  if (typeof item.id !== 'string' || !item.id) fail('id must be a non-empty string');
  if (typeof item.group !== 'string' || !item.group) fail('group must be a non-empty string');
  if (typeof item.title !== 'string') fail('title must be a string');
  if (!STATUSES.includes(item.status)) fail(`status must be one of ${STATUSES.join(', ')}`);
  if (!(item.progress >= 0 && item.progress <= 1)) fail('progress must be between 0 and 1');
  if (item.lastActivity !== null && Number.isNaN(Date.parse(item.lastActivity))) fail('lastActivity must be an ISO date or null');
  if (typeof item.link !== 'string') fail('link must be a string');
  return item;
}
