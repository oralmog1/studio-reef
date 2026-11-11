import * as THREE from 'three';
import { hashString } from '../../util/hash.js';

// Data-driven moments:
//   - an item that wasn't here last visit ARRIVES: its fish swims in from
//     the edge of the map and lands on its plot
//   - an item that became done since last visit CELEBRATES: sparkle bursts
//     and extra-high hops
//   - a coral whose progress ROSE since last visit grows on screen; a
//     newcomer's coral sprouts from a seedling once its fish has landed
//   - every working fish breathes out a slow bubble trail, so busy
//     zones look busier
//
// "Last visit" is remembered in the browser (localStorage).
// Add ?replay to the URL to replay every arrival and celebration.

const SEEN_KEY = 'studio-reef.seen.v1';

export function compareWithLastVisit(list, replay) {
  let prev = null;
  try {
    prev = JSON.parse(localStorage.getItem(SEEN_KEY));
  } catch {}
  if (replay) prev = {};
  const arrivals = [], celebrate = new Set(), grew = new Map();
  // First visit ever: no arrivals or parties, just a calm world.
  if (prev) {
    for (const e of list) {
      const raw = prev[e.item.id];
      const was = typeof raw === 'string' ? { state: raw } : raw; // older saves stored just the state
      if (was === undefined) arrivals.push(e);
      if (e.state === 'done' && was?.state !== 'done') celebrate.add(e);
      if (was?.progress !== undefined && e.item.progress > was.progress + 0.001) grew.set(e, was.progress);
    }
  }
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(list.map((e) => [e.item.id, { state: e.state, progress: e.item.progress }]))));
  } catch {}
  return { arrivals, celebrate, grew };
}

export class Events {
  constructor({ list, particles, cfg, plotTop }) {
    this.list = list;
    this.particles = particles;
    this.cfg = cfg;
    this.L = cfg.life;
    this.plotTop = plotTop;
    this.pending = []; // celebrations waiting to fire: { e, at }
    this.white = new THREE.Color('#ffffff');
    this.doneColor = new THREE.Color(cfg.stateColors.done);
    for (const e of list) e.bubbleIn = (hashString(e.item.id) % 100) / 100; // stagger bubble trails
  }

  start({ arrivals, celebrate, grew }, t) {
    const L = this.L;
    for (const [e, from] of grew) {
      e.growFrom = from;
      e.growAt = t + L.arrivalDelay;
    }
    const sorted = [...arrivals].sort((a, b) => a.item.group.localeCompare(b.item.group) || a.item.id.localeCompare(b.item.id));
    sorted.forEach((e, k) => {
      // come in from the map edge, on the side of the map where its plot is
      let ang = Math.atan2(e.z, e.x);
      if (Math.hypot(e.x, e.z) < 1) ang = (hashString(e.item.id) % 360) * (Math.PI / 180);
      const R = this.cfg.worldRadius + 15;
      const sx = Math.cos(ang) * R, sz = Math.sin(ang) * R;
      const dist = Math.hypot(e.x - sx, e.z - sz);
      e.arriving = { t: -(L.arrivalDelay + k * L.arrivalStagger), dur: Math.max(4, dist / L.arrivalSpeed), sx, sz };
      e.px = sx;
      e.pz = sz;
      e.flyY = L.arrivalHeight;
      e.growFrom = 0; // its coral sprouts once it lands
      e.growAt = Infinity;
    });
    for (const e of celebrate) if (!e.arriving) this.pending.push({ e, at: t + L.arrivalDelay });
  }

  update(t, dt) {
    const L = this.L;

    // arrivals: follow an arc from the edge to the fish's spot
    for (const e of this.list) {
      const a = e.arriving;
      if (!a) continue;
      a.t += dt;
      if (a.t < 0) continue; // still waiting its turn, out beyond the fog
      const k = Math.min(1, a.t / a.dur);
      const s = k * k * (3 - 2 * k); // ease in and out
      const nx = THREE.MathUtils.lerp(a.sx, e.x, s), nz = THREE.MathUtils.lerp(a.sz, e.z, s);
      const dx = nx - e.px, dz = nz - e.pz;
      if (Math.hypot(dx, dz) > 1e-4) e.facing = Math.atan2(dx, dz);
      e.px = nx;
      e.pz = nz;
      e.flyY = L.arrivalHeight * (1 - s) + Math.sin(s * Math.PI) * 2; // high, then glide down
      e.speed = this.cfg.movement.wanderSpeed; // full swim animation
      if (k >= 1) {
        e.arriving = null;
        e.flyY = 0;
        e.atHome = true;
        e.growAt = t + 0.4;
        if (e.state === 'done') this.pending.push({ e, at: t + 0.3 });
      }
    }

    // celebrations: three sparkle bursts + extra-high hops
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const c = this.pending[i];
      if (c.burst || t < c.at) continue; // bursts are handled just below
      this.pending.splice(i, 1);
      c.e.celebrateUntil = t + L.celebrateSeconds;
      for (let b = 0; b < 3; b++) this.pending.push({ burst: c.e, at: t + b * 1.2 });
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const c = this.pending[i];
      if (!c.burst || t < c.at) continue;
      this.pending.splice(i, 1);
      this._burst(c.burst);
    }

    // a puff of bubbles when a coral starts growing
    for (const e of this.list) {
      if (e.growAt === undefined || e.puffed || t < e.growAt) continue;
      e.puffed = true;
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * 0.8;
        this.particles.emit(e.coralX, e.coralY + 0.3, e.coralZ, Math.cos(a) * sp, 0.6 + Math.random(), Math.sin(a) * sp, 2.5 + Math.random(), this.white, 0.14 + Math.random() * 0.12);
      }
    }

    // working fish breathe out bubbles
    for (const e of this.list) {
      if (e.state !== 'working' || e.arriving || !e.atHome) continue;
      e.bubbleIn -= dt;
      if (e.bubbleIn > 0) continue;
      e.bubbleIn = L.bubbleEvery * (0.6 + Math.random() * 0.8);
      const y = this.plotTop + this.cfg.inhabitants.hover + 0.4;
      this.particles.emit(e.px + Math.sin(e.facing) * 0.6, y, e.pz + Math.cos(e.facing) * 0.6, 0, 0.5, 0, 3.5 + Math.random() * 1.5, this.white, 0.16 + Math.random() * 0.14);
    }
  }

  _burst(e) {
    const y = this.plotTop + this.cfg.inhabitants.hover + 1;
    for (let i = 0; i < this.L.burstSize; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.5;
      const color = i % 3 ? this.doneColor : this.white;
      this.particles.emit(e.px, y, e.pz, Math.cos(a) * sp, 1 + Math.random() * 2.5, Math.sin(a) * sp, 2 + Math.random() * 1.5, color, 0.18 + Math.random() * 0.22);
    }
  }
}
