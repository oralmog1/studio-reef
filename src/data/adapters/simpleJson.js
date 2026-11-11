// Hand-written projects (public/data/my-projects.json) — and the demo file.
//
// Each row: { client, name, stage, percent, updated, url }  (all optional
// except client + name for new items). A row can also CORRECT an item that
// comes from another source: give its id as "ref" and only the fields to
// change, e.g. { "ref": "figma:AbC123", "percent": 60 }.
import { statusFromWords, progressFrom, dateFrom, slug } from './stages.js';

export async function load(src) {
  const res = await fetch(src.url, { cache: 'no-store' });
  // missing file (the dev server answers a missing file with the app page): file not created yet: fine
  if (res.status === 404 || res.headers.get('content-type')?.includes('text/html')) return [];
  if (!res.ok) throw new Error(`could not load ${src.url} (${res.status})`);
  const raw = await res.json();
  const now = Date.now();
  return (raw.projects ?? []).map((p) => ({
    id: p.ref ?? `${src.name}:${slug(`${p.client}-${p.name}`)}`,
    group: p.client,
    title: p.name,
    status: p.stage !== undefined ? statusFromWords(p.stage) : undefined,
    progress: progressFrom(p.percent),
    lastActivity: dateFrom(p.updated, now),
    link: p.url,
  }));
}
