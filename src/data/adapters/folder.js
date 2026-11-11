// The Projects folder on your disk (read by tools/projectsFolder.js in the
// dev server). Folder = client, file = deliverable, _links.md = extra ones.
//
// A file with no status written anywhere counts as "in progress"; whether it
// is working NOW is decided by state.js from its last real event.
// lastActivity comes from the server: a file's save time, or when a line in
// _links.md last changed (null when the line has never changed while watched).
import { statusFromWords, progressFrom } from './stages.js';

export async function load(src) {
  const res = await fetch(src.url, { cache: 'no-store' });
  // missing file (the dev server answers a missing file with the app page): not running in the dev server
  if (res.status === 404 || res.headers.get('content-type')?.includes('text/html')) return [];
  if (!res.ok) throw new Error(`could not read the Projects folder (${res.status})`);
  const { projects } = await res.json();
  return projects.map((p) => {
    return {
      id: p.ref,
      group: p.client,
      title: p.name,
      status: p.stage ? statusFromWords(p.stage) : 'working',
      progress: progressFrom(p.percent), // only when a % is written; otherwise the coral follows time
      minutesToday: p.minutesToday,
      minutesTotal: p.minutesTotal,
      lastActivity: p.updated ?? null,
      link: p.url,
    };
  });
}
