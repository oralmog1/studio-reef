import { el, esc } from './format.js';

// Search by name ( / ). Type to filter, ↑↓ to choose, Enter to fly there.
export class Search {
  constructor(list, stateColors, onPick) {
    this.list = list;
    this.stateColors = stateColors;
    this.onPick = onPick;
    this.node = el('div', 'search ui', `<input type="text" placeholder="Search by name or client…" spellcheck="false" /><div class="results"></div>`);
    this.node.hidden = true;
    this.input = this.node.querySelector('input');
    this.results = this.node.querySelector('.results');
    this.input.addEventListener('input', () => this._render());
    this.input.addEventListener('keydown', (e) => this._key(e));
    document.body.appendChild(this.node);
  }

  get open() {
    return !this.node.hidden;
  }

  show() {
    this.node.hidden = false;
    this.input.value = '';
    this._render();
    this.input.focus();
  }

  hide() {
    this.node.hidden = true;
    this.input.blur();
  }

  _render() {
    const q = this.input.value.trim().toLowerCase();
    this.matches = q
      ? this.list.filter((e) => e.item.title.toLowerCase().includes(q) || e.item.group.toLowerCase().includes(q)).slice(0, 7)
      : [];
    this.active = 0;
    this.results.innerHTML = this.matches
      .map(
        (e, i) =>
          `<div class="result${i === 0 ? ' active' : ''}" data-i="${i}"><span class="dot" style="background:${this.stateColors[e.state]}"></span>${esc(e.item.title)} <span class="sub">${esc(e.item.group)}</span></div>`
      )
      .join('') || (q ? '<div class="none">No matches</div>' : '');
    this.results.querySelectorAll('.result').forEach((r) => (r.onclick = () => this._pick(Number(r.dataset.i))));
  }

  _key(e) {
    e.stopPropagation(); // typing here shouldn't trigger world shortcuts
    if (e.key === 'Escape') return this.hide();
    if (!this.matches?.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + this.matches.length) % this.matches.length;
      this.results.querySelectorAll('.result').forEach((r, i) => r.classList.toggle('active', i === this.active));
    } else if (e.key === 'Enter') this._pick(this.active);
  }

  _pick(i) {
    const e = this.matches[i];
    this.hide();
    if (e) this.onPick(e);
  }
}
