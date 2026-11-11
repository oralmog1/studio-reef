// Dev-server helper: reads the Projects folder on your disk and hands the
// page a list of deliverables. (A web page can't read folders by itself.)
//
//   Projects/
//     <Client>/                   one folder per client
//       Some deliverable.html     each file is a deliverable (same name,
//       Some deliverable.pdf      different extension = the same deliverable)
//       _links.md                 deliverables that live elsewhere, one per line:
//                                   url | title | status | progress
//                                 or corrections for a file here:
//                                   Some deliverable | status | progress
//     _links.md                   the same, for all clients at once. Link lines
//                                 name their client in the third field:
//                                   url | title | client | status | progress
//                                 (client left empty → the client folder whose
//                                 name appears in the title)
//
// ACTIVITY (the "updated" time of each deliverable) comes only from real events:
//   - a file deliverable: when its file was last saved;
//   - a line in _links.md: when THAT line's content (status, %, title, link)
//     last changed. Saving, moving or reorganising _links.md is not activity.
//     Changes are remembered in .reef-activity.json (project root). A line seen
//     for the first time has no known activity (updated: null).
//   A file with a correction line gets whichever of the two is newer.
//
// TIME invested: each of those events (a save, a line edit) is recorded in
// .reef-time.json and summed into working time (tools/timeTracker.js):
// minutesToday / minutesTotal per deliverable.
//
// GET /api/projects          → { projects: [ { ref, client, name, stage, percent, updated, url, minutesToday, minutesTotal } ] }
// GET /projects-files/<path> → the file itself (read-only, only inside Projects/)
//
// Runs only with `npm run dev` (and the desktop widget). Nothing here is
// published by `npm run build`.

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { addEvent, summarize, withTimeStore } from './timeTracker.js';
import { config as reef } from '../src/config.js'; // the reef's settings (workingMinutes)

const OPEN_ORDER = ['.html', '.htm', '.pdf', '.png', '.jpg', '.jpeg', '.key', '.pptx', '.fig'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8' };
const hidden = (name) => name.startsWith('.') || name.startsWith('_');
const fileUrl = (...parts) => '/projects-files/' + parts.map(encodeURIComponent).join('/');
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

function parseLinks(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('|').map((f) => f.trim()));
}

async function readLinks(file) {
  try {
    return parseLinks(await fs.readFile(file, 'utf8'));
  } catch {
    return []; // no _links.md: fine
  }
}

// ---- activity record: when did each _links.md line last change? --------

async function loadActivity(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

async function saveActivity(file, record) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(record, null, 1));
  await fs.rename(tmp, file); // atomic: the widget's server and `npm run dev` may both write
}

// Record a line's content; returns when it last changed (ms), or null if never seen changing.
function lineEvent(record, key, content, now) {
  const sig = JSON.stringify(content);
  const prev = record[key];
  if (!prev) record[key] = { sig, at: null }; // first sighting: not an event
  else if (prev.sig !== sig) record[key] = { sig, at: now }; // edited: an event
  return record[key].at;
}

export async function scanProjects(root, activityFile, timeFile) {
  const now = Date.now();
  const record = activityFile ? await loadActivity(activityFile) : {};
  const before = JSON.stringify(record);
  const items = new Map(); // ref → item (+ fileMs / lineMs)

  let clients = [];
  try {
    clients = (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && !hidden(d.name));
  } catch {
    return []; // no Projects folder
  }
  const folders = clients.map((d) => d.name);

  // files → deliverables, grouped by name without extension
  for (const client of folders) {
    const folder = path.join(root, client);
    const byTitle = new Map();
    for (const e of await fs.readdir(folder, { withFileTypes: true })) {
      if (!e.isFile() || hidden(e.name)) continue;
      const title = path.basename(e.name, path.extname(e.name));
      const { mtimeMs } = await fs.stat(path.join(folder, e.name));
      if (!byTitle.has(title)) byTitle.set(title, []);
      byTitle.get(title).push({ name: e.name, ext: path.extname(e.name).toLowerCase(), mtimeMs });
    }
    for (const [title, files] of byTitle) {
      const rank = (f) => OPEN_ORDER.indexOf(f.ext) + 1 || 99;
      const main = [...files].sort((a, b) => rank(a) - rank(b))[0];
      const ref = `folder:${client}/${title}`;
      items.set(ref, { ref, client, name: title, url: fileUrl(client, main.name), fileMs: Math.max(...files.map((f) => f.mtimeMs)) });
    }
  }

  // _links.md lines: per-client files first, then the top-level one
  const linkFiles = [...folders.map((c) => ({ client: c, file: path.join(root, c, '_links.md') })), { client: null, file: path.join(root, '_links.md') }];
  for (const { client: folderClient, file } of linkFiles) {
    for (const fields of await readLinks(file)) {
      if (/^https?:\/\//.test(fields[0])) {
        // a deliverable that lives elsewhere
        let url, title, client, stage, percent;
        if (folderClient) [url, title = url, stage, percent] = fields;
        else {
          [url, title = url, client, stage, percent] = fields;
          client = client || folders.find((f) => title.toLowerCase().includes(f.toLowerCase())) || 'Other';
        }
        client = folderClient ?? client;
        const ref = `folder:${client}/${title}`;
        // key and content are about the deliverable, not the file it's written in,
        // so moving a line between _links.md files is not an edit
        const lineMs = lineEvent(record, ref, [url, stage ?? '', percent ?? ''], now);
        items.set(ref, { ...items.get(ref), ref, client, name: title, stage, percent, url, lineMs });
      } else {
        // a correction for file deliverable(s) with this name
        const [title, stage, percent] = fields;
        for (const it of items.values()) {
          if (it.name !== title || (folderClient && it.client !== folderClient)) continue;
          const lineMs = lineEvent(record, `${it.ref}#line`, [stage ?? '', percent ?? ''], now);
          Object.assign(it, { stage, percent, lineMs });
        }
      }
    }
  }

  if (activityFile && JSON.stringify(record) !== before) await saveActivity(activityFile, record);

  const list = [...items.values()];
  const time = async (store) => {
    for (const it of list) {
      const rec = (store[it.ref] ??= {});
      for (const t of [it.fileMs, it.lineMs].filter(Boolean).sort((a, b) => a - b)) addEvent(rec, t, reef.state.workingMinutes);
      Object.assign(it, summarize(rec, now));
    }
  };
  if (timeFile) await withTimeStore(timeFile, time);
  else await time({});

  return list.map(({ fileMs, lineMs, ...it }) => ({
    ...it,
    updated: iso(Math.max(fileMs ?? 0, lineMs ?? 0)), // newest real event, or null
  }));
}

export function projectsFolder({ dir = 'Projects', activityFile = '.reef-activity.json', timeFile = '.reef-time.json' } = {}) {
  let root, record, times;
  return {
    name: 'projects-folder',
    configResolved(config) {
      root = path.resolve(config.root, dir);
      record = path.resolve(config.root, activityFile);
      times = path.resolve(config.root, timeFile);
    },
    configureServer(server) {
      server.middlewares.use('/api/projects', async (req, res) => {
        const projects = await scanProjects(root, record, times);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ projects }));
      });
      server.middlewares.use('/projects-files', async (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
        const file = path.resolve(root, rel);
        if (!file.startsWith(root + path.sep)) return next(); // never leave the Projects folder
        try {
          const st = await fs.stat(file);
          if (!st.isFile()) return next();
          res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
          createReadStream(file).pipe(res);
        } catch {
          next();
        }
      });
    },
  };
}
