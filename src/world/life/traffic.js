import * as THREE from 'three';
import { paint, merge, toonMaterial } from '../lowpoly.js';
import { seededRandom } from '../../util/hash.js';

// Background traffic: pure scenery, in neutral colours, never data.
//   - schools of small silver fish looping high over the map
//   - one turtle gliding a slow wide circle
//   - a few pale jellyfish pulsing near the edges
// Everything here moves on fixed loops, so it's calm and predictable.

const TAU = Math.PI * 2;

function schoolFishGeo() {
  return merge([
    paint(new THREE.ConeGeometry(0.13, 0.55, 5).rotateX(Math.PI / 2).scale(0.7, 1, 1), '#cdd6d6'),
    paint(new THREE.ConeGeometry(0.12, 0.2, 3).rotateX(-Math.PI / 2).scale(0.3, 1, 1).translate(0, 0, -0.33), '#b5c0c0'),
  ]);
}

function turtleParts() {
  const shell = merge([
    paint(new THREE.IcosahedronGeometry(1, 1).scale(1.0, 0.42, 1.25), '#7f8f62'),
    paint(new THREE.CylinderGeometry(1.02, 1.02, 0.1, 10).scale(1, 1, 1.25).translate(0, -0.08, 0), '#a4a882'),
    paint(new THREE.IcosahedronGeometry(0.32, 1).scale(0.9, 0.8, 1.1).translate(0, 0.02, 1.45), '#b4ad8c'),
  ]);
  const flipper = paint(new THREE.ConeGeometry(0.28, 1.1, 4).scale(1, 1, 0.25).rotateZ(-Math.PI / 2).translate(0.55, 0, 0), '#b4ad8c');
  return { shell, flipper };
}

function jellyGeo() {
  const parts = [paint(new THREE.SphereGeometry(0.7, 10, 5, 0, TAU, 0, Math.PI / 2).scale(1, 0.8, 1), '#eef2f0')];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    parts.push(paint(new THREE.ConeGeometry(0.05, 1.4, 3).rotateX(Math.PI).translate(Math.cos(a) * 0.4, -0.7, Math.sin(a) * 0.4), '#e3e9e6'));
  }
  return merge(parts);
}

export class Traffic {
  constructor(scene, cfg) {
    const L = cfg.life;
    this.R = cfg.worldRadius;
    const material = toonMaterial();
    const rng = seededRandom(424242);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);

    // Schools: each follows a big tilted loop; members hold loose formation.
    this.schools = [];
    for (let s = 0; s < L.schools; s++) {
      const members = [];
      for (let i = 0; i < L.fishPerSchool; i++) {
        members.push({ ox: (rng() - 0.5) * 3, oy: (rng() - 0.5) * 1.2, oz: (rng() - 0.5) * 4, ph: rng() * TAU });
      }
      this.schools.push({
        rx: this.R * (0.55 + rng() * 0.4),
        rz: this.R * (0.45 + rng() * 0.4),
        h: 8 + rng() * 5,
        speed: (0.018 + rng() * 0.012) * (rng() < 0.5 ? 1 : -1),
        offset: rng() * TAU,
        spin: rng() * TAU,
        members,
      });
    }
    this.schoolMesh = new THREE.InstancedMesh(schoolFishGeo(), material, Math.max(1, L.schools * L.fishPerSchool));
    this.schoolMesh.frustumCulled = false;
    scene.add(this.schoolMesh);

    // Turtle
    const tp = turtleParts();
    this.turtle = new THREE.Group();
    this.turtle.add(new THREE.Mesh(tp.shell, material));
    this.flippers = [
      [0.75, 0.55, 1, 1.0], [-0.75, 0.55, -1, 1.0], // front: big
      [0.7, -0.75, 1, 0.55], [-0.7, -0.75, -1, 0.55], // back: small
    ].map(([x, z, side, size]) => {
      const f = new THREE.Mesh(tp.flipper, material);
      f.position.set(x, -0.05, z);
      f.scale.set(side * size, size, size);
      this.turtle.add(f);
      return f;
    });
    this.turtle.scale.setScalar(1.3);
    this.turtle.visible = L.turtle;
    scene.add(this.turtle);

    // Jellyfish: one instanced mesh, placed near the edges of the map.
    this.jellies = [];
    for (let j = 0; j < L.jellies; j++) {
      this.jellies.push({ a: rng() * TAU, r: this.R * (0.75 + rng() * 0.35), h: 4 + rng() * 5, ph: rng() * TAU });
    }
    const jellyMat = toonMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
    this.jellyMesh = new THREE.InstancedMesh(jellyGeo(), jellyMat, Math.max(1, L.jellies));
    this.jellyMesh.count = L.jellies;
    this.jellyMesh.frustumCulled = false;
    scene.add(this.jellyMesh);
    this.activeSchools = this.schools.length;
    this.turtleWanted = L.turtle;
  }

  // Quality presets: how much background traffic to show.
  setAmount({ schools, jellies, turtle }) {
    this.activeSchools = Math.min(schools, this.schools.length);
    this.jellyMesh.count = Math.min(jellies, this.jellies.length);
    this.turtle.visible = turtle && this.turtleWanted;
  }

  update(t, current) {
    const m = this._m, p = this._p, q = this._q, e = this._e, s = this._s;
    const push = 1 + current * 0.3; // currents speed everyone up a touch

    // schools
    let n = 0;
    for (let si = 0; si < this.activeSchools; si++) {
      const sc = this.schools[si];
      const a = sc.offset + t * sc.speed * push;
      const cs = Math.cos(sc.spin), sn = Math.sin(sc.spin);
      const lx = Math.cos(a) * sc.rx, lz = Math.sin(a) * sc.rz;
      const cx = lx * cs - lz * sn, cz = lx * sn + lz * cs;
      // heading = direction of travel along the loop
      const dlx = -Math.sin(a) * sc.rx * Math.sign(sc.speed), dlz = Math.cos(a) * sc.rz * Math.sign(sc.speed);
      const yaw = Math.atan2(dlx * cs - dlz * sn, dlx * sn + dlz * cs);
      const cy = sc.h + Math.sin(a * 2) * 1.5;
      const fy = Math.cos(yaw), fx = Math.sin(yaw);
      for (const f of sc.members) {
        const wob = Math.sin(t * 2 + f.ph) * 0.3;
        // offset in the school's own frame: sideways (ox), up (oy), along (oz)
        p.set(cx + fy * (f.ox + wob) + fx * f.oz, cy + f.oy + Math.sin(t * 1.3 + f.ph) * 0.2, cz - fx * (f.ox + wob) + fy * f.oz);
        q.setFromEuler(e.set(0, yaw + Math.sin(t * 9 + f.ph) * 0.15, 0));
        this.schoolMesh.setMatrixAt(n++, m.compose(p, q, s.set(1, 1, 1)));
      }
    }
    this.schoolMesh.count = n;
    this.schoolMesh.instanceMatrix.needsUpdate = true;

    // turtle: slow wide circle, flippers paddling
    if (this.turtle.visible) {
      const a = t * 0.035 * push + 1;
      const r = this.R * 0.8;
      this.turtle.position.set(Math.cos(a) * r, 6 + Math.sin(t * 0.3) * 0.6, Math.sin(a) * r);
      this.turtle.rotation.set(Math.sin(t * 0.5) * 0.05, Math.atan2(-Math.sin(a), Math.cos(a)), -0.15);
      const stroke = Math.sin(t * 1.6);
      this.flippers.forEach((f, i) => (f.rotation.z = (i < 2 ? 0.5 : 0.25) * stroke * (i % 2 ? -1 : 1)));
    }

    // jellyfish: pulse (squash) and rise a little on each pulse, drift slowly
    for (let i = 0; i < this.jellyMesh.count; i++) {
      const j = this.jellies[i];
      const pulse = Math.sin(t * 1.8 + j.ph);
      const a = j.a + t * 0.01 * push;
      p.set(Math.cos(a) * j.r, j.h + Math.sin(t * 0.4 + j.ph) * 1.2 + pulse * 0.15, Math.sin(a) * j.r);
      q.setFromEuler(e.set(Math.sin(t * 0.3 + j.ph) * 0.1, 0, Math.cos(t * 0.25 + j.ph) * 0.1));
      this.jellyMesh.setMatrixAt(i, m.compose(p, q, s.set(1 - pulse * 0.08, 1 + pulse * 0.12, 1 - pulse * 0.08)));
    }
    this.jellyMesh.instanceMatrix.needsUpdate = true;
  }
}
