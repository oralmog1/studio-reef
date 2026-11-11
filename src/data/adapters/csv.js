// A spreadsheet exported as CSV (public/data/projects.csv).
//
// First row = column names. Recognised (any case, any order):
//   client   (or: group, customer, account)
//   name     (or: title, deliverable, project, item)
//   status   (or: stage, state)            e.g. "in progress", "shipped", "waiting on me"
//   progress (or: percent, %, done %)      e.g. 60, 60%, 0.6
//   updated  (or: last activity, date, modified)   e.g. 2026-09-20, or 3d
//   link     (or: url)
//   id       (optional; otherwise made from client + name)
import { statusFromWords, progressFrom, dateFrom, slug } from './stages.js';

const ALIASES = {
  client: ['client', 'group', 'customer', 'account'],
  name: ['name', 'title', 'deliverable', 'project', 'item'],
  status: ['status', 'stage', 'state'],
  progress: ['progress', 'percent', '%', 'done %', 'done'],
  updated: ['updated', 'last activity', 'last_activity', 'date', 'modified', 'last modified'],
  link: ['link', 'url'],
  id: ['id', 'ref'],
};

// Minimal CSV parser: commas, "quoted, fields", "" escapes, CRLF.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') row.push(field), (field = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export async function load(src) {
  const res = await fetch(src.url, { cache: 'no-store' });
  // missing file (the dev server answers a missing file with the app page): no sheet yet: fine
  if (res.status === 404 || res.headers.get('content-type')?.includes('text/html')) return [];
  if (!res.ok) throw new Error(`could not load ${src.url} (${res.status})`);
  const [header, ...rows] = parseCsv(await res.text());
  if (!header) return [];
  const col = {};
  header.forEach((h, i) => {
    const key = Object.keys(ALIASES).find((k) => ALIASES[k].includes(h.trim().toLowerCase()));
    if (key && col[key] === undefined) col[key] = i;
  });
  if (col.client === undefined || col.name === undefined) throw new Error('the sheet needs a "client" and a "name" column');
  const get = (r, k) => (col[k] === undefined ? undefined : r[col[k]]?.trim());
  const now = Date.now();
  return rows.map((r) => ({
    id: get(r, 'id') || `${src.name}:${slug(`${get(r, 'client')}-${get(r, 'name')}`)}`,
    group: get(r, 'client'),
    title: get(r, 'name'),
    status: get(r, 'status') !== undefined ? statusFromWords(get(r, 'status')) : undefined,
    progress: progressFrom(get(r, 'progress')),
    lastActivity: dateFrom(get(r, 'updated'), now),
    link: get(r, 'link'),
  }));
}
