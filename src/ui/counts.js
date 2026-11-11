import { el } from './format.js';

// The small permanent count, bottom-left: how many items are in each state.
// Clicking the "waiting" count flies to the next one waiting on you.

const ORDER = [
  ['waiting', 'waiting'],
  ['done', 'done'],
  ['working', 'working'],
  ['idle', 'idle'],
  ['stale', 'asleep'],
];

export function createCounts(list, stateColors, onWaitingClick) {
  const n = {};
  for (const e of list) n[e.state] = (n[e.state] ?? 0) + 1;
  const node = el('div', 'counts ui');
  for (const [state, label] of ORDER) {
    const pill = el('button', `count ${n[state] ? '' : 'zero'}`, `<span class="dot" style="background:${stateColors[state]}"></span>${n[state] ?? 0} ${label}`);
    if (state === 'waiting') {
      pill.title = 'Fly to the next one waiting on you (W)';
      pill.onclick = onWaitingClick;
    } else pill.tabIndex = -1;
    node.appendChild(pill);
  }
  document.body.appendChild(node);
}
