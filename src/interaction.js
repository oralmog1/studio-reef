import * as THREE from 'three';
import { Card } from './ui/card.js';
import { resolveProgress } from './data/load.js';
import { Search } from './ui/search.js';
import { createHelp } from './ui/help.js';
import { createCounts } from './ui/counts.js';
import { ZoneLabels } from './ui/zoneLabels.js';

// Everything you can do with the mouse and keyboard (besides moving the
// camera, which lives in world/earthControls.js):
//   click a fish → info card + camera follows it
//   W next waiting · / search · H hide panels · P screenshot · F photo mode · ? help · Esc close

const CLICK_SLOP = 5; // px the mouse may move and still count as a click

export class Interaction {
  constructor({ renderer, scene, camera, controls, inhabitants, zones, cfg, plotTop, quality, onResetLayout }) {
    Object.assign(this, { renderer, scene, camera, controls, inhabitants, zones, cfg, plotTop });
    this.list = inhabitants.list;
    this.selected = null;
    this.waitingIndex = -1;
    this._v = new THREE.Vector3();

    this.card = new Card(cfg.stateColors, () => this.deselect(), (e, value) => this.setProgress(e, value), cfg.coral.fullAfterHours);
    this.search = new Search(this.list, cfg.stateColors, (e) => this.select(e, true));
    this.help = createHelp({ onResetLayout, quality, renderer });
    createCounts(this.list, cfg.stateColors, () => this.nextWaiting());
    this.labels = new ZoneLabels(zones, this.list, cfg, plotTop);

    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', (e) => (this._down = { x: e.clientX, y: e.clientY, button: e.button }));
    dom.addEventListener('pointerup', (e) => this._onUp(e));
    dom.addEventListener('pointermove', (e) => this._onHover(e));
    window.addEventListener('keydown', (e) => this._onKey(e));
  }

  // ---- selection -----------------------------------------------------

  select(e, fly) {
    this.selected = e;
    this.card.show(e);
    this.controls.follow(() => ({ x: e.px, z: e.pz }));
    if (fly) this.controls.flyTo(e.px, e.pz, Math.min(this.controls.distance, this.cfg.interaction.flyDistance));
  }

  deselect() {
    this.selected = null;
    this.card.hide();
    this.controls.stopAuto();
  }

  nextWaiting() {
    const waiting = this.list.filter((e) => e.state === 'waiting');
    if (!waiting.length) return;
    this.waitingIndex = (this.waitingIndex + 1) % waiting.length;
    this.select(waiting[this.waitingIndex], true);
  }

  // The card's slider / Automatic button: save it (the server keeps it in
  // .reef-overrides.json), then grow the coral straight away.
  async setProgress(e, value) {
    try {
      await fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.item.id, value }) });
    } catch {
      return; // server unreachable: nothing changes
    }
    const { progress, progressSource } = resolveProgress(e.item, value, this.cfg.coral.fullAfterHours);
    e.item.progressSource = progressSource;
    this.inhabitants.setProgress(e.item.id, progress);
    document.activeElement?.blur(); // let go of the slider so the card can redraw
    this.card.refresh(e);
  }

  // Fresh numbers arrived (liveness.js): redraw the open card.
  itemsUpdated() {
    if (this.selected) this.card.refresh(this.selected);
  }

  // ---- picking -------------------------------------------------------

  // Screen position of a fish (roughly its middle).
  _project(e, out = this._v) {
    return out.set(e.px, this.plotTop + this.cfg.inhabitants.hover + (e.arriving ? e.flyY : 0), e.pz).project(this.camera);
  }

  // Nearest fish OR coral under the cursor, measured on screen (forgiving
  // on small things). A coral is its item's project, so it opens the same card.
  _pickFish(cx, cy) {
    const focal = innerHeight / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    let best = null, bestD = Infinity;
    const consider = (e, x, y, z, size) => {
      const v = this._v.set(x, y, z).project(this.camera);
      if (v.z > 1) return;
      const sx = ((v.x + 1) / 2) * innerWidth, sy = ((1 - v.y) / 2) * innerHeight;
      const dist = this.camera.position.distanceTo(this._v.set(x, y, z));
      const radius = Math.max(16, (size * focal) / dist);
      const d = Math.hypot(sx - cx, sy - cy);
      if (d < radius && d < bestD) (best = e), (bestD = d);
    };
    for (const e of this.list) {
      consider(e, e.px, this.plotTop + this.cfg.inhabitants.hover + (e.arriving ? e.flyY : 0), e.pz, 0.8 * this.cfg.inhabitants.scale);
      if (!e.arriving) {
        // middle of its branch, which leans outward from the big coral
        const lean = this.cfg.coral.branchLean, half = e.coralSize * 0.5;
        const reach = Math.sin(lean) * half;
        consider(e, e.coralX + e.dirOutX * reach, e.coralY + Math.cos(lean) * half, e.coralZ + e.dirOutZ * reach, 0.6 * e.coralSize);
      }
    }
    return best;
  }

  _onUp(ev) {
    const d = this._down;
    this._down = null;
    if (!d || d.button !== 0 || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > CLICK_SLOP) return;
    const fish = this._pickFish(ev.clientX, ev.clientY);
    if (fish) this.select(fish, true);
    else this.deselect();
  }

  _onHover(ev) {
    if (ev.buttons) return; // dragging
    const fish = this._pickFish(ev.clientX, ev.clientY);
    this.renderer.domElement.style.cursor = fish ? 'pointer' : '';
  }

  // ---- keyboard ------------------------------------------------------

  _onKey(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.target instanceof HTMLInputElement) return;
    const k = ev.key;
    if (k === 'Escape') {
      if (this.photo) return this.togglePhoto();
      this.search.hide();
      this.help.hide();
      this.deselect();
    } else if (k === 'w' || k === 'W') this.nextWaiting();
    else if (k === 'h' || k === 'H') document.body.classList.toggle('hide-ui');
    else if (k === 'p' || k === 'P') this.screenshot();
    else if (k === 'f' || k === 'F') this.togglePhoto();
    else if (k === '?') this.help.toggle();
    else if (k === '/') {
      ev.preventDefault();
      document.body.classList.remove('hide-ui');
      this.search.show();
    }
  }

  // Photo mode: panels away, camera drops low and slowly circles.
  togglePhoto() {
    this.photo = !this.photo;
    document.body.classList.toggle('photo', this.photo);
    const c = this.controls;
    if (this.photo) {
      this._pitchBefore = c.pitch;
      c.orbit = this.cfg.life.photoOrbitSpeed;
      c.pitchGoal = (this.cfg.life.photoPitchDeg * Math.PI) / 180;
      this._toast('Photo mode · P to save a picture · Esc to leave');
    } else {
      c.orbit = 0;
      c.pitchGoal = this._pitchBefore;
    }
  }

  _toast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('gone'), 2500);
    setTimeout(() => t.remove(), 3500);
  }

  // Saves exactly what the 3D view shows (badges included, HTML panels not).
  screenshot() {
    this.renderer.render(this.scene, this.camera); // draw, then read before the browser clears it
    this.renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      a.download = `studio-reef-${stamp}.png`;
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  // ---- per frame -----------------------------------------------------

  update() {
    this.labels.update(this.camera);
    if (this.selected) {
      const v = this._project(this.selected);
      this.card.place(((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight, v.z <= 1);
    }
  }
}
