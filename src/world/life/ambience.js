import * as THREE from 'three';
import { pointsMaterial } from './particles.js';

// Scenery only: the slow "current" (our weather) and drifting marine snow.
//
// The current rises and falls over a few minutes. It makes seagrass and
// kelp sway harder and the marine snow drift faster. It is never data.

export class Ambience {
  constructor(scene, cfg) {
    this.cfg = cfg.life;
    this.radius = cfg.worldRadius + 10;
    this.strength = 0.3; // 0 calm … 1 strong current
    this.dir = { x: 1, z: 0 };

    const n = this.cfg.snowCount;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    const tint = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n);
    let s = 1;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647); // fixed seed: same snow every load
    for (let i = 0; i < n; i++) {
      this.pos.set([(rnd() * 2 - 1) * this.radius, rnd() * this.cfg.snowHeight, (rnd() * 2 - 1) * this.radius], i * 3);
      tint.set([0.95, 0.97, 0.94], i * 3);
      size[i] = 0.08 + rnd() * 0.1;
      alpha[i] = 0.25 + rnd() * 0.35;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    this.material = pointsMaterial(false);
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.active = n;
    scene.add(this.points);
  }

  // Quality presets: only draw (and move) the first `n` specks.
  setAmount(n) {
    this.active = Math.min(n, this.cfg.snowCount);
    this.geo.setDrawRange(0, this.active);
  }

  update(t, dt) {
    // slow, non-repeating-feeling mix of waves: calm spells and gusty spells
    const p = this.cfg.currentPeriod;
    const w = 0.5 + 0.3 * Math.sin((t / p) * Math.PI * 2) + 0.2 * Math.sin((t / (p * 0.37)) * Math.PI * 2 + 1.3);
    this.strength = THREE.MathUtils.clamp(w, 0, 1);
    const ang = 0.6 + Math.sin(t / (p * 1.7)) * 0.8; // direction wanders a little
    this.dir.x = Math.cos(ang);
    this.dir.z = Math.sin(ang);

    const speed = 0.15 + this.strength * 0.9;
    const R = this.radius, H = this.cfg.snowHeight;
    for (let i = 0; i < this.active * 3; i += 3) {
      let x = this.pos[i] + (this.dir.x * speed + Math.sin(t * 0.7 + i) * 0.05) * dt;
      let y = this.pos[i + 1] - 0.05 * dt; // sinks very slowly
      let z = this.pos[i + 2] + (this.dir.z * speed + Math.cos(t * 0.6 + i) * 0.05) * dt;
      if (x > R) x -= 2 * R; else if (x < -R) x += 2 * R;
      if (z > R) z -= 2 * R; else if (z < -R) z += 2 * R;
      if (y < 0) y += H;
      this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = z;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
