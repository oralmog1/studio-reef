#!/usr/bin/env node
// Claude Code hook for Studio Reef: records each chat's latest state so the
// reef can show it. Claude Code runs this at key moments of every chat and
// passes the details as JSON on stdin. It writes one small file per chat:
//   ~/.claude/reef/sessions/<session id>.json
//
// It never prints anything and always exits 0, so it can't block or change
// a chat. Set up in ~/.claude/settings.json (see README → Chats).
//
//   event              state        shown in the reef as
//   SessionStart       new          idle
//   UserPromptSubmit   working      working ("Thinking…")
//   PreToolUse         working      working ("Using Bash")
//   PostToolUse        working      working
//   Notification       permission   waiting on you ("…needs your permission…")
//                      waiting      waiting on you ("…waiting for your input")
//   Stop               answered     waiting on you ("Answered: your turn")
//   SessionEnd         ended        done
//
// It also keeps, per chat:
//   periods  working time (every event counts; see tools/timeTracker.js)
//   steps    the chat's task list, done/total. This Claude Code version has
//            TaskCreate/TaskUpdate tools with TaskCreated/TaskCompleted hook
//            events; older versions use TodoWrite with the whole list. Both work.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { addEvent } from './timeTracker.js';
import { config } from '../src/config.js';

const DIR = path.join(os.homedir(), '.claude', 'reef', 'sessions');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 2000); // never hang
  });
}

// A readable title: the first thing you wrote in the chat.
function cleanTitle(text) {
  const lines = String(text)
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<[^>]+>/g, '\n') // drop tags like <pasted_content …>
    .split('\n')
    .map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
    .filter(Boolean);
  const t = lines[0] ?? '';
  return t.length > 60 ? t.slice(0, 57).trimEnd() + '…' : t;
}

async function titleFromTranscript(file) {
  if (!file || !fs.existsSync(file)) return '';
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    if (++n > 400) break; // the first message is near the top
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== 'user' || entry.isMeta) continue;
    const c = entry.message?.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p.type === 'text').map((p) => p.text).join('\n') : '';
    const t = cleanTitle(text);
    if (t) {
      rl.close();
      return t;
    }
  }
  return '';
}

function stateFor(input) {
  switch (input.hook_event_name) {
    case 'SessionStart':
      return ['new', 'New chat'];
    case 'UserPromptSubmit':
      return ['working', 'Thinking…'];
    case 'PreToolUse':
      return ['working', `Using ${input.tool_name ?? 'a tool'}`];
    case 'PostToolUse':
    case 'SubagentStop':
    case 'TaskCreated':
    case 'TaskCompleted':
      return ['working', 'Working…'];
    case 'Notification': {
      const msg = input.message ?? '';
      return /permission/i.test(msg) ? ['permission', msg || 'Needs your permission'] : ['waiting', msg || 'Waiting for your input'];
    }
    case 'Stop':
      return ['answered', 'Answered: your turn'];
    case 'SessionEnd':
      return ['ended', 'Chat ended'];
    default:
      return [null, null];
  }
}

try {
  const input = JSON.parse((await readStdin()) || '{}');
  const id = String(input.session_id ?? '').replace(/[^\w.-]/g, '');
  const [state, note] = stateFor(input);
  if (id && state) {
    fs.mkdirSync(DIR, { recursive: true });
    const file = path.join(DIR, `${id}.json`);
    let prev = {};
    try {
      prev = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    // "waiting for your input" after an answer keeps saying answered
    const keep = state === 'waiting' && prev.state === 'answered';
    const title = prev.title || (await titleFromTranscript(input.transcript_path)) || cleanTitle(input.prompt ?? '');
    // task list: TaskCreated / TaskCompleted events, TaskUpdate (status, deletion), or TodoWrite (whole list)
    const tasks = { ...(prev.tasks ?? {}) };
    let todos = prev.todos ?? null;
    const ev = input.hook_event_name, tool = input.tool_name, ti = input.tool_input ?? {};
    if (ev === 'TaskCreated' && input.task_id) tasks[input.task_id] ??= 'pending';
    if (ev === 'TaskCompleted' && input.task_id) tasks[input.task_id] = 'completed';
    if (ev === 'PostToolUse' && tool === 'TaskUpdate') {
      const tid = ti.taskId ?? ti.task_id ?? ti.id;
      if (tid && ti.status === 'deleted') delete tasks[tid];
      else if (tid && ti.status) tasks[tid] = ti.status;
    }
    if (ev === 'PostToolUse' && tool === 'TodoWrite' && Array.isArray(ti.todos)) {
      todos = { done: ti.todos.filter((t) => t.status === 'completed').length, total: ti.todos.length };
    }
    const taskIds = Object.keys(tasks);
    const steps = taskIds.length
      ? { done: taskIds.filter((k) => tasks[k] === 'completed').length, total: taskIds.length }
      : todos;

    // working time: every event is activity
    const time = { periods: prev.periods ?? [], pastMs: prev.pastMs ?? 0 };
    addEvent(time, Date.now(), config.state.workingMinutes);

    const record = {
      session_id: id,
      // the Claude app's own id for this chat (lets the reef link straight to it);
      // empty for chats run in a terminal
      host_session_id: process.env.CLAUDE_CODE_HOST_SESSION_ID || prev.host_session_id || '',
      entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT || prev.entrypoint || '',
      cwd: input.cwd ?? prev.cwd ?? '',
      title,
      state: keep ? prev.state : state,
      note: keep ? prev.note : note,
      event: input.hook_event_name,
      at: new Date().toISOString(),
      tasks,
      todos,
      steps: steps && steps.total ? steps : null,
      periods: time.periods,
      pastMs: time.pastMs,
    };
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record));
    fs.renameSync(tmp, file);
  }
} catch {
  /* never disturb the chat */
}
process.exit(0);
