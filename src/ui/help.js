import { el } from './format.js';

// Shortcut list ( ? ) — also home of the quality setting, a live
// performance readout, and "Reset layout".
export function createHelp({ onResetLayout, quality, renderer }) {
  const node = el(
    'div',
    'help panel ui',
    `<h2>Shortcuts</h2>
    <table>
      <tr><td><kbd>W</kbd></td><td>Fly to the next one waiting on you</td></tr>
      <tr><td><kbd>/</kbd></td><td>Search by name</td></tr>
      <tr><td><kbd>H</kbd></td><td>Hide / show all panels</td></tr>
      <tr><td><kbd>P</kbd></td><td>Save a screenshot</td></tr>
      <tr><td><kbd>F</kbd></td><td>Photo mode</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Close card, stop following</td></tr>
      <tr><td><kbd>?</kbd></td><td>This list</td></tr>
    </table>
    <div class="hint">Drag: move · Scroll/pinch: zoom · Right-drag or Shift-drag: rotate · Click a fish for details</div>
    <h2 class="q-title">Quality</h2>
    <div class="quality">
      <button data-q="low">Low</button><button data-q="medium">Medium</button><button data-q="high">High</button>
    </div>
    <div class="stats"></div>
    <button class="reset">Reset saved layout</button>`
  );
  node.hidden = true;
  node.querySelector('.reset').onclick = onResetLayout;

  const buttons = [...node.querySelectorAll('.quality button')];
  const mark = () => buttons.forEach((b) => b.classList.toggle('on', b.dataset.q === quality.name));
  buttons.forEach((b) => (b.onclick = () => (quality.apply(b.dataset.q), mark())));
  mark();

  // live readout, refreshed once a second while the panel is open
  const stats = node.querySelector('.stats');
  let frames = 0, since = performance.now();
  const count = () => {
    frames++;
    requestAnimationFrame(count);
  };
  requestAnimationFrame(count);
  setInterval(() => {
    const now = performance.now();
    const screenFps = (frames * 1000) / (now - since);
    frames = 0;
    since = now;
    if (node.hidden) return;
    mark(); // stay in sync if the preset changed elsewhere
    const info = renderer.info.render;
    const drawn = quality.drawnFps ?? screenFps;
    stats.textContent = `${Math.round(drawn)} fps · ${info.calls} draw calls · ${Math.round(info.triangles / 1000)}k triangles${quality.idle ? ' · idle mode' : ''}`;
  }, 1000);
  const button = el('button', 'help-button ui', '?');
  button.title = 'Shortcuts (?)';
  button.onclick = () => (node.hidden = !node.hidden);
  document.body.append(node, button);
  return { toggle: () => (node.hidden = !node.hidden), hide: () => (node.hidden = true) };
}
