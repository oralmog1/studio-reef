// Quality presets (Low / Medium / High) and the frame pacer.
//
// A preset sets screen resolution, frame-rate cap and how much scenery
// and background traffic there is. The data-driven parts (fish, corals,
// badges, bubbles, celebrations) are the same on every preset.
//
// The pacer also handles "screen left open all day": after a while with
// no mouse or keyboard input it drops to a low frame rate; any input
// restores full speed immediately.

const KEY = 'studio-reef.quality';

export class Quality {
  constructor(cfg, { renderer, scatter, life }) {
    this.cfg = cfg;
    this.targets = { renderer, scatter, life };
    let saved = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {}
    this.name = cfg.quality.presets[saved] ? saved : cfg.quality.default;
    // the desktop widget always uses its own preset (and never saves it)
    this.locked = new URLSearchParams(location.search).has('widget') ? 'widget' : null;
    if (this.locked) this.name = this.locked;
    this.lastInput = performance.now();
    for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown']) {
      window.addEventListener(ev, () => (this.lastInput = performance.now()), { passive: true });
    }
    this.apply(this.name);
    // frames actually drawn per second (for the readout in the ? panel)
    this.drawnFps = 0;
    this._frames = 0;
    setInterval(() => {
      this.drawnFps = this._frames;
      this._frames = 0;
    }, 1000);
  }

  apply(name) {
    const p = this.cfg.quality.presets[name];
    if (!p) return;
    this.name = name;
    if (!this.locked) {
      try {
        localStorage.setItem(KEY, name);
      } catch {}
    }
    const { renderer, scatter, life } = this.targets;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, p.pixelRatio, this.cfg.renderer.maxPixelRatio));
    scatter?.setDensity(p.scatterFill);
    life?.ambience.setAmount(p.snow);
    life?.traffic.setAmount(p);
  }

  // Add the parts that only exist after the data has loaded.
  attach(parts) {
    Object.assign(this.targets, parts);
    this.apply(this.name);
  }

  get idle() {
    return performance.now() - this.lastInput > this.cfg.quality.idleAfterSeconds * 1000;
  }

  // Should we draw a frame now? (called every animation frame)
  shouldRender(now, lastRender) {
    const fps = this.idle ? this.cfg.quality.idleFps : this.cfg.quality.presets[this.name].fps;
    const go = !fps || now - lastRender >= 1000 / fps - 2; // small slack so 60 on a 60 Hz screen isn't skipped
    if (go) this._frames++;
    return go;
  }
}
