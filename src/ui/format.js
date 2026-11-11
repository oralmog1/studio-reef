// Small text helpers for the UI.

export const STATE_LABEL = {
  working: 'Working now',
  done: 'Done / shipped',
  waiting: 'Waiting on you',
  stale: 'Asleep',
  idle: 'Idle',
};

export function timeAgo(iso, now = Date.now()) {
  const mins = Math.round((now - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function fmtMinutes(m) {
  m = Math.round(m ?? 0);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} m` : `${h} h`;
}

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function el(tag, className, html = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.innerHTML = html;
  return node;
}

export function showError(err) {
  const node = el('div', 'panel error');
  node.textContent = String(err.message ?? err);
  document.body.appendChild(node);
}

// Small dismissible note (e.g. a data source that couldn't be read).
export function showNotice(lines) {
  const node = el('div', 'panel notice ui', `<button class="close" title="Dismiss">×</button>${lines.map((l) => `<div>${esc(l)}</div>`).join('')}`);
  node.querySelector('.close').onclick = () => node.remove();
  document.body.appendChild(node);
}
