// Dev-server helper: serves the chat states written by tools/reef-hook.mjs
// (~/.claude/reef/sessions/*.json) to the page.
//   GET /api/chats → { chats: [ { session_id, cwd, title, state, note, event, at } ] }
//   GET /api/open-app?app=claude → brings the Claude app to the front
//   GET  /api/progress → { overrides: { itemId: 0..1 | "auto" } }
//   POST /api/progress { id, value } → set a coral's % by hand (value 0..1),
//        "auto" (ignore any % written in files), or null (forget)
//        stored in .reef-overrides.json
// Each chat also gets minutesToday / minutesTotal: from the periods the
// Claude Code hook records, or (for Claude app chats) from the times its
// state changed, recorded here in .reef-time.json.
//   (used by the cards of chats seen in those apps)
// Only on the local dev server (npm run dev / the widget), never published.
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { addEvent, summarize, withTimeStore } from './timeTracker.js';
import { config as reef } from '../src/config.js'; // the reef's settings (workingMinutes)

const DIR = path.join(os.homedir(), '.claude', 'reef', 'sessions');

async function readChats() {
  let names = [];
  try {
    names = (await fs.readdir(DIR)).filter((n) => n.endsWith('.json'));
  } catch {
    return []; // no chats recorded yet
  }
  const out = [];
  for (const n of names) {
    try {
      out.push(JSON.parse(await fs.readFile(path.join(DIR, n), 'utf8')));
    } catch {
      /* half-written or broken file: skip */
    }
  }
  return out;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

export function chats({ timeFile = '.reef-time.json', overridesFile = '.reef-overrides.json' } = {}) {
  let times, overrides;
  return {
    name: 'reef-chats',
    configResolved(c) {
      times = path.resolve(c.root, timeFile);
      overrides = path.resolve(c.root, overridesFile);
    },
    configureServer(server) {
      server.middlewares.use('/api/progress', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'POST') {
          // JSON only: a page on another site can't send this without the browser blocking it
          if (!String(req.headers['content-type']).startsWith('application/json')) return (res.statusCode = 415), res.end();
          let body = '';
          for await (const chunk of req) body += chunk;
          let msg;
          try {
            msg = JSON.parse(body);
          } catch {
            return (res.statusCode = 400), res.end();
          }
          const ok = typeof msg.id === 'string' && (msg.value === null || msg.value === 'auto' || (typeof msg.value === 'number' && msg.value >= 0 && msg.value <= 1));
          if (!ok) return (res.statusCode = 400), res.end();
          const all = await readJson(overrides);
          if (msg.value === null) delete all[msg.id];
          else all[msg.id] = msg.value;
          const tmp = `${overrides}.${process.pid}.tmp`;
          await fs.writeFile(tmp, JSON.stringify(all, null, 1));
          await fs.rename(tmp, overrides);
          res.statusCode = 204;
          return res.end();
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ overrides: await readJson(overrides) }));
      });
      server.middlewares.use('/api/open-app', (req, res) => {
        const name = { claude: 'Claude' }[new URL(req.url, 'http://x').searchParams.get('app')];
        if (name) execFile('open', ['-a', name], () => {});
        res.statusCode = name ? 204 : 400;
        res.end();
      });
      server.middlewares.use('/api/chats', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        const list = await readChats();
        const now = Date.now();
        await withTimeStore(times, (store) => {
          for (const c of list) {
            if (c.periods) Object.assign(c, summarize(c, now)); // Claude Code: the hook keeps exact periods
            else {
              const rec = (store[`chat:${c.session_id}`] ??= {});
              addEvent(rec, Date.parse(c.at), reef.state.workingMinutes);
              Object.assign(c, summarize(rec, now));
            }
            delete c.periods; // the page only needs the totals
            delete c.tasks;
          }
        });
        res.end(JSON.stringify({ chats: list }));
      });
    },
  };
}
