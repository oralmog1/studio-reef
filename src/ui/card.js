import { el, esc, timeAgo, fmtMinutes, STATE_LABEL } from './format.js';

// The info card that appears next to a clicked fish.
// Why the coral is the size it is (see data/load.js → resolveProgress).
function coralLabel(it, fullAfterHours) {
  const pct = Math.round(it.progress * 100);
  switch (it.progressSource) {
    case 'manual': return `Coral ${pct}% · set by hand`;
    case 'steps': return `Coral · ${it.steps.done} of ${it.steps.total} steps done`;
    case 'written': return `Coral ${pct}% · written in a file`;
    default: return `Coral · ${fmtMinutes(it.minutesTotal)} invested <span class="dim">(full at ${fullAfterHours} h)</span>`;
  }
}

export class Card {
  // onSetProgress(entry, value): value 0..1 (set by hand) or 'auto'
  constructor(stateColors, onClose, onSetProgress, fullAfterHours) {
    this.onSetProgress = onSetProgress;
    this.fullAfterHours = fullAfterHours;
    this.stateColors = stateColors;
    this.node = el('div', 'card ui');
    this.node.hidden = true;
    this.node.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.onClose = onClose;
    document.body.appendChild(this.node);
  }

  show(e) {
    const it = e.item;
    const pct = Math.round(it.progress * 100);
    this.node.innerHTML = `
      <button class="close" title="Close (Esc)">×</button>
      <div class="client">${esc(it.group)}</div>
      <div class="title">${esc(it.title)}</div>
      <div class="state"><span class="dot" style="background:${this.stateColors[e.state]}"></span>${STATE_LABEL[e.state]}</div>
      ${it.note ? `<div class="note">${esc(it.note)}</div>` : ''}
      <div class="coral">${coralLabel(it, this.fullAfterHours)}</div>
      <input class="slider" type="range" min="0" max="100" step="1" value="${pct}" title="Set the coral by hand">
      ${['manual', 'written'].includes(it.progressSource) ? '<button class="auto" title="Size from the task list or time invested">Automatic</button>' : ''}
      <div class="meta">Today ${fmtMinutes(it.minutesToday)} · total ${fmtMinutes(it.minutesTotal)} · ${it.lastActivity ? `last activity ${timeAgo(it.lastActivity)}` : 'no activity yet'}</div>
      ${it.link ? `<a class="open" href="${esc(it.link)}"${/^(https?:|\/(?!api\/))/.test(it.link) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(it.linkLabel ?? 'Open original')} ↗</a>` : ''}`;
    this.node.querySelector('.close').onclick = this.onClose;
    const slider = this.node.querySelector('.slider');
    slider.oninput = () => (this.node.querySelector('.coral').textContent = `Coral ${slider.value}% · set by hand`);
    slider.onchange = () => this.onSetProgress(e, Number(slider.value) / 100);
    const auto = this.node.querySelector('.auto');
    if (auto) auto.onclick = () => this.onSetProgress(e, 'auto');
    const open = this.node.querySelector('.open');
    if (open && it.link.startsWith('/api/')) {
      // an action on the local server (e.g. bring the Claude app forward), not a page to show
      open.onclick = (ev) => {
        ev.preventDefault();
        fetch(it.link);
      };
    }
    this.node.hidden = false;
  }

  // redraw the open card with fresh numbers (not while you're dragging the slider)
  refresh(e) {
    if (this.node.hidden || document.activeElement?.classList.contains('slider')) return;
    this.show(e);
  }

  hide() {
    this.node.hidden = true;
  }

  // Place the card beside a screen point (x, y); flip to the left near the edge.
  place(x, y, visible) {
    if (this.node.hidden) return;
    this.node.style.visibility = visible ? 'visible' : 'hidden';
    const w = this.node.offsetWidth, h = this.node.offsetHeight;
    let left = x + 28;
    if (left + w > innerWidth - 12) left = x - 28 - w;
    const top = Math.min(Math.max(12, y - h / 2), innerHeight - h - 12);
    this.node.style.transform = `translate(${Math.max(12, left)}px, ${top}px)`;
  }
}
