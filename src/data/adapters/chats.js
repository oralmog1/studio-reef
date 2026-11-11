// Chats: Claude Code chats (recorded by tools/reef-hook.mjs) and the chats
// open in the Claude Mac app (recorded by Reef Helper, widget/ReefHelper.swift).
// Both are served at /api/chats.
//
//   territory  "Chats · <project folder>" (the folder the chat runs in)
//   title      the first thing you wrote in the chat
//   status     working (thinking / using tools) · waiting (needs your
//              permission, or answered and it's your turn) · done (chat ended)
//   note       exactly what it's doing or waiting for (shown on the card)
//   link       claude://… opens the chat in the Claude app ("Go to chat");
//              chats run in a terminal have no link
// Chats with nothing new for `showDays` are left out.

const STATUS = { new: 'open', seen: 'open', working: 'working', permission: 'waiting', waiting: 'waiting', answered: 'waiting', ended: 'done' };
const APP_NAMES = { claude: 'Claude' }; // chats seen in the Claude Mac app (widget/ReefHelper.swift)

function territory(cwd) {
  if (!cwd || cwd.includes('/scratch-workspaces/')) return 'Chats';
  return `Chats · ${cwd.split('/').filter(Boolean).pop()}`;
}

export async function load(src) {
  const res = await fetch(src.url, { cache: 'no-store' });
  if (res.status === 404 || res.headers.get('content-type')?.includes('text/html')) return []; // no chat tracking here
  if (!res.ok) throw new Error(`could not read chats (${res.status})`);
  const { chats } = await res.json();
  const cutoff = Date.now() - src.showDays * 864e5;
  return chats
    .filter((c) => Date.parse(c.at) >= cutoff && (!c.source || APP_NAMES[c.source]))
    .map((c) => ({
      id: `chat:${c.session_id}`,
      group: APP_NAMES[c.source] ? `Chats · ${APP_NAMES[c.source]}` : territory(c.cwd),
      title: c.title || 'Untitled chat',
      status: STATUS[c.state] ?? 'open',
      steps: c.steps ?? undefined, // Claude Code task list: { done, total }
      minutesToday: c.minutesToday,
      minutesTotal: c.minutesTotal,
      lastActivity: c.at,
      note: c.note,
      link: c.link || (c.host_session_id ? `claude://claude.ai/epitaxy/${encodeURIComponent(c.host_session_id)}` : ''),
      linkLabel: c.link?.startsWith('/api/open-app') ? `Open ${APP_NAMES[c.source]}` : 'Go to chat',
    }));
}
