// Turns the free-text status words people actually use into the four
// statuses of the common shape. Add your own words here.

const WORDS = {
  working: ['in progress', 'wip', 'doing', 'active', 'working', 'designing', 'in design', 'started'],
  done: ['done', 'shipped', 'complete', 'completed', 'delivered', 'launched', 'live', 'final', 'approved', 'sent'],
  waiting: ['waiting on me', 'needs me', 'needs feedback', 'feedback', 'to review', 'review', 'my review', 'waiting', 'blocked on me'],
  open: ['not started', 'todo', 'to do', 'backlog', 'planned', 'on hold', 'paused', 'open', 'idea'],
};
const LOOKUP = new Map(Object.entries(WORDS).flatMap(([status, words]) => words.map((w) => [w, status])));

export function statusFromWords(text) {
  return LOOKUP.get(String(text ?? '').trim().toLowerCase()) ?? 'open';
}

// '60', '60%', '0.6' → 0.6. Anything unreadable → undefined.
export function progressFrom(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = parseFloat(String(value).replace('%', ''));
  if (Number.isNaN(n)) return undefined;
  const p = n > 1 || String(value).includes('%') ? n / 100 : n;
  return Math.min(1, Math.max(0, p));
}

// '40m' / '3h' / '2d' ago, or a real date ('2026-09-20') → ISO string.
export function dateFrom(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') return undefined;
  const m = /^(\d+(?:\.\d+)?)\s*([mhd])$/.exec(String(value).trim());
  if (m) return new Date(now - Number(m[1]) * { m: 60e3, h: 3600e3, d: 86400e3 }[m[2]]).toISOString();
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

// Readable, stable id from text: "Halcyon Coffee / Checkout flow" → "halcyon-coffee-checkout-flow"
export const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
