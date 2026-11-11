// Runs every data source in config, merges them, checks every item.
//
// Sources run in order. If two sources give the same id, the later one
// wins field by field, so a later source can CORRECT an earlier one (e.g.
// my-projects.json setting the real % of a folder or Figma item).
// A source that fails is skipped with a warning; the rest still load.
// If every real source is empty, the demo data is shown instead.
//
// Then each coral's size (progress) is decided, first match wins:
//   1. manual   you set it on the card (saved by the server, /api/progress)
//   2. steps    a Claude Code session's task list: 3 of 5 done = 60%
//   3. written  a % written in a source file (_links.md, CSV, JSON), unless
//               you pressed "Automatic" on the card
//   4. time     working time invested, full size at coral.fullAfterHours
import { validateItem } from './schema.js';

const adapters = import.meta.glob('./adapters/*.js');

async function run(src) {
  const importer = adapters[`./adapters/${src.adapter}.js`];
  if (!importer) throw new Error(`no adapter called "${src.adapter}" in src/data/adapters/`);
  return (await importer()).load(src);
}

async function loadOverrides() {
  try {
    const res = await fetch('/api/progress', { cache: 'no-store' });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return {};
    return (await res.json()).overrides ?? {};
  } catch {
    return {};
  }
}

export function resolveProgress(it, override, fullAfterHours) {
  if (typeof override === 'number') return { progress: override, progressSource: 'manual' };
  if (it.steps?.total) return { progress: it.steps.done / it.steps.total, progressSource: 'steps' };
  if (override !== 'auto' && typeof it.writtenProgress === 'number') return { progress: it.writtenProgress, progressSource: 'written' };
  return { progress: Math.min(1, (it.minutesTotal ?? 0) / 60 / fullAfterHours), progressSource: 'time' };
}

export async function loadItems(dataConfig, { fullAfterHours = 20 } = {}) {
  const merged = new Map();
  const warnings = [];
  for (const src of dataConfig.sources) {
    if (src.enabled === false) continue;
    try {
      for (const row of await run(src)) {
        const prev = merged.get(row.id) ?? {};
        const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined && v !== ''));
        merged.set(row.id, { ...prev, ...clean });
      }
    } catch (err) {
      warnings.push(`${src.name}: ${err.message}`);
    }
  }

  // defaults for fields a source didn't know
  let items = [...merged.values()]
    .filter((it) => {
      const ok = it.group && it.title;
      if (!ok) warnings.push(`skipped "${it.id}": no client/name (a correction for an item that isn't there?)`);
      return ok;
    })
    .map((it) => {
      const { progress: writtenProgress, ...rest } = it;
      return { status: 'open', lastActivity: null, link: '', ...rest, writtenProgress };
    });

  if (!items.length && dataConfig.demo) {
    items = await run(dataConfig.demo);
    warnings.push('No projects found yet, so this is demo data. Add some to the Projects folder.');
  }

  const overrides = await loadOverrides();
  for (const it of items) Object.assign(it, resolveProgress(it, overrides[it.id], fullAfterHours));

  const seen = new Set();
  items.forEach((item, i) => {
    validateItem(item, i);
    if (seen.has(item.id)) throw new Error(`Duplicate id "${item.id}"`);
    seen.add(item.id);
  });
  return { items, warnings };
}
