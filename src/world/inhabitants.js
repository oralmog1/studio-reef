import * as THREE from 'three';
import { parse, toWorld } from './hex.js';
import { hashString } from '../util/hash.js';
import { toonMaterial } from './lowpoly.js';
import { ZoneNav } from './nav.js';
import { Crowd } from './crowd.js';
import { fishBody, fishTail, TAIL_JOINT_Z, fishFaces, accessories } from './models.js';
import { coralBranches, porousRock } from './reefModels.js';

// The inhabitants: one fish per item, all working on their client's ONE
// big coral. The coral is the project; each item is one branch of it, and
// the fish lives in a ring around the coral, facing its own branch.
//
// Every part is ONE instanced mesh for the whole crowd (body, tail, each
// face, each accessory, coral), so the draw-call count stays flat no
// matter how many items there are.
//
// What's data and what's not:
//   body + tail colour → state
//   animation          → state
//   branch size        → that item's progress (grows on screen if it rose since last visit)
//   coral rock size    → how many items the client has
//   accessory, branch species, spot, work motion → hashed from the id (identity only)
//
// Where fish go is decided in crowd.js; this file draws them.

const ACCESSORY_NAMES = ['cap', 'bow', 'glasses', 'flower', 'headphones'];
const CORAL_SPECIES = ['antler', 'ytube', 'tubes', 'cup'];
const FACE_FOR_STATE = { working: 'normal', idle: 'normal', waiting: 'normal', done: 'happy', stale: 'sleepy' };
const TAU = Math.PI * 2;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class Inhabitants {
  constructor(scene, cfg, plotTop) {
    this.scene = scene;
    this.cfg = cfg;
    this.plotTop = plotTop;
    this.material = toonMaterial();
    this.geo = {
      body: fishBody(),
      tail: fishTail(),
      faces: fishFaces(),
      accessories: accessories(),
      corals: coralBranches(cfg.colors),
      coralBase: porousRock({ detail: 6, flat: 0.55, craters: 22, seed: 5, stone: cfg.colors.coralBase, pit: cfg.colors.coralBasePit }),
    };
    // Corals and their rock: soft, smooth shading (like the reference art).
    // Double-sided so you can see into the open tubes and cups.
    this.coralMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.meshes = [];
    this.list = [];
    // scratch objects reused every frame (no garbage while running all day)
    this._m = new THREE.Matrix4();
    this._t = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  // items: common-shape items; states: Map id → state; zones: layout
  build(items, states, zones) {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.dispose();
    }
    this.meshes = [];

    // One walkable grid per zone (obstacles are added further down).
    const mv = this.cfg.movement;
    const size = this.cfg.plots.tileSize;
    this.navs = new Map();
    for (const [group, tiles] of Object.entries(zones)) {
      this.navs.set(group, new ZoneNav(tiles.map((k) => toWorld(...parse(k), size)), size, mv));
    }

    const slots = this._assignSlots(items, zones);
    this.list = items
      .filter((item) => slots.has(item.id))
      .map((item) => {
        const h = hashString(item.id);
        const s = slots.get(item.id);
        const dx = s.coralX - s.x, dz = s.coralZ - s.z;
        return {
          item,
          state: states.get(item.id),
          ...s,
          yaw: Math.atan2(dx, dz), // face its branch
          dirX: dx / Math.hypot(dx, dz),
          dirZ: dz / Math.hypot(dx, dz),
          phase: ((h % 1000) / 1000) * TAU, // so they don't all move in sync
          accessory: ACCESSORY_NAMES[(h >>> 8) % ACCESSORY_NAMES.length],
          workMotion: (h >>> 16) % 3, // 0 tend, 1 hammer, 2 paint
          species: CORAL_SPECIES[hashString(item.id + ':coral') % CORAL_SPECIES.length],
        };
      });
    const n = Math.max(this.list.length, 1);

    const make = (geo, name, material = this.material) => {
      const mesh = new THREE.InstancedMesh(geo, material, n);
      mesh.count = this.list.length;
      mesh.name = name;
      mesh.frustumCulled = false; // instances move; the default bounds would go stale
      for (let i = 0; i < n; i++) mesh.setMatrixAt(i, HIDDEN);
      this.scene.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    this.body = make(this.geo.body, 'fish-body');
    this.tail = make(this.geo.tail, 'fish-tail');
    this.faces = Object.fromEntries(Object.entries(this.geo.faces).map(([k, g]) => [k, make(g, `fish-face-${k}`)]));
    this.acc = Object.fromEntries(Object.entries(this.geo.accessories).map(([k, g]) => [k, make(g, `fish-${k}`)]));
    // Each branch species gets exactly as many instances as it has branches
    // (hidden spare copies would still cost the GPU their triangles).
    this.corals = {};
    for (const [k, g] of Object.entries(this.geo.corals)) {
      const mine = this.list.filter((e) => e.species === k);
      mine.forEach((e, slot) => (e.coralSlot = slot));
      const mesh = new THREE.InstancedMesh(g, this.coralMaterial, Math.max(mine.length, 1));
      mesh.count = mine.length;
      mesh.name = `coral-${k}`;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.meshes.push(mesh);
      this.corals[k] = mesh;
    }
    this.coralMeshes = Object.values(this.corals);

    // one big coral base per client
    const bases = Object.values(this.cores);
    this.baseMesh = new THREE.InstancedMesh(this.geo.coralBase, this.coralMaterial, Math.max(bases.length, 1));
    this.baseMesh.count = bases.length;
    this.baseMesh.name = 'coral-bases';
    bases.forEach((b, i) => {
      this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, b.spin);
      this.baseMesh.setMatrixAt(i, this._m.compose(this._p.set(b.x, this.plotTop - 0.1, b.z), this._q, this._s.set(b.r, b.r, b.r)));
    });
    this.scene.add(this.baseMesh);
    this.meshes.push(this.baseMesh);

    const c = new THREE.Color();
    this.list.forEach((e, i) => {
      c.set(this.cfg.stateColors[e.state]);
      this.body.setColorAt(i, c);
      this.tail.setColorAt(i, c);

      // Coral: set once (only re-set while it's growing). Size = progress.
      e.coralSize = this.coralSize(e.item.progress);
      this._setCoral(i, e, e.coralSize);
    });

    // Obstacles: the coral (base + branches) and sleeping fish.
    for (const [group, nav] of this.navs) {
      const core = this.cores[group];
      const here = this.list.filter((e) => e.item.group === group);
      nav.setObstacles([
        ...(core ? [{ x: core.x, z: core.z, r: core.r + 0.25 }] : []),
        ...here.map((e) => ({ x: e.coralX + e.dirOutX * 0.45, z: e.coralZ + e.dirOutZ * 0.45, r: mv.coralClearance * e.coralSize + 0.2 })),
        ...here.filter((e) => e.state === 'stale').map((e) => ({ x: e.x, z: e.z, r: mv.sleeperClearance })),
      ]);
    }
    this.crowd = new Crowd(mv);
    this.crowd.init(this.list, this.navs);
  }

  // Coral size for a progress value (0..1).
  coralSize(progress) {
    const { coralMin, coralScale } = this.cfg.inhabitants;
    return THREE.MathUtils.lerp(coralMin, 1, progress) * coralScale;
  }

  // A branch sits on the base's shoulder and leans outward, toward its fish.
  _setCoral(i, e, size) {
    const out = Math.atan2(e.dirOutX, e.dirOutZ);
    this._q.setFromEuler(this._e.set(this.cfg.coral.branchLean, out, 0)); // lean away from the centre
    this._q2.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, e.phase); // twist for variety
    this._q.multiply(this._q2);
    this.corals[e.species].setMatrixAt(e.coralSlot, this._m.compose(this._p.set(e.coralX, e.coralY, e.coralZ), this._q, this._s.setScalar(size)));
  }

  // Corals whose progress rose since last visit grow on screen
  // (e.growFrom / e.growAt are set by life/events.js).
  _growCorals(t) {
    let changed = false;
    this.list.forEach((e, i) => {
      if (e.growAt === undefined) return;
      const from = this.coralSize(e.growFrom);
      const k = t < e.growAt ? 0 : Math.min(1, (t - e.growAt) / this.cfg.life.growSeconds);
      const ease = 1 - (1 - k) ** 3;
      this._setCoral(i, e, THREE.MathUtils.lerp(from, e.coralSize, ease));
      if (k >= 1) delete e.growAt;
      changed = true;
    });
    if (changed) for (const m of this.coralMeshes) m.instanceMatrix.needsUpdate = true;
  }

  // Call every frame. t = seconds since start, dt = seconds since last frame.
  // A coral's size changed while the page is open: grow (or shrink) it on screen.
  setProgress(id, progress) {
    const e = this.list.find((x) => x.item.id === id);
    if (!e || Math.abs(e.item.progress - progress) < 0.001) return;
    e.growFrom = e.item.progress;
    e.item.progress = progress;
    e.coralSize = this.coralSize(progress);
    e.growAt = this.lastT ?? 0;
    e.puffed = progress < e.growFrom; // bubbles only when it grows
  }

  update(t, dt, camera) {
    this.lastT = t;
    this.crowd.step(dt, camera);
    this._growCorals(t);
    const { scale, hover } = this.cfg.inhabitants;
    const walkSpeed = this.cfg.movement.wanderSpeed;
    const top = this.plotTop;
    const m = this._m, p = this._p, s = this._s, q = this._q, eul = this._e;

    this.list.forEach((e, i) => {
      const ph = e.phase;
      let x = e.px, z = e.pz, y = top + hover;
      let yaw = e.facing, pitch = 0, roll = 0; // pitch > 0 = nose down
      let sx = 1, sy = 1, sz = 1;
      // How much is this fish actually swimming right now? 0 = resting, 1 = full swim.
      // Measured from real movement, so a fish blocked by the crowd doesn't "swim on the spot".
      const swim = Math.min(1, e.speed / walkSpeed);
      let wagSpeed = 2.5 + 8 * swim, wagAmount = 0.15 + 0.3 * swim;
      y += Math.sin(t * 7 + ph) * 0.05 * swim; // little swim bob
      roll = Math.sin(t * wagSpeed + ph) * 0.08 * swim;
      const home = e.atHome && swim < 0.3 && !e.arriving; // state poses only once settled at its spot
      if (e.arriving) y += e.flyY; // swimming in from the edge (life/events.js)

      if (!e.arriving) switch (e.state) {
        case 'working': {
          if (!home) break;
          wagSpeed = 9;
          wagAmount = 0.35;
          const dx = e.coralX - x, dz = e.coralZ - z, d = Math.hypot(dx, dz) || 1;
          if (e.workMotion === 0) {
            // tending / farming: pecks at its coral
            const k = Math.pow(Math.max(0, Math.sin(t * 4 + ph)), 3);
            x += (dx / d) * k * 0.3;
            z += (dz / d) * k * 0.3;
            pitch = k * 0.4;
            y -= k * 0.15;
          } else if (e.workMotion === 1) {
            // hammering / blacksmith: quick nose-down strikes
            const k = Math.pow(Math.max(0, Math.sin(t * 5.5 + ph)), 6);
            pitch = -0.25 + 0.8 * k;
            y += 0.12 * (1 - k);
          } else {
            // painting / writing: sweeps side to side
            const w = Math.sin(t * 2.2 + ph);
            yaw += w * 0.45;
            roll = w * 0.15;
            y += Math.abs(Math.cos(t * 2.2 + ph)) * 0.05;
          }
          break;
        }
        case 'done': {
          if (!home) break;
          // happy hops with a spin, a little squash on landing
          const cycle = (t / 1.5 + ph / TAU) % 1;
          if (cycle < 0.6) {
            const k = cycle / 0.6;
            const boost = e.celebrateUntil > t ? 1.8 : 1; // celebrating: jump higher
            y += 4 * k * (1 - k) * 1.1 * boost;
            yaw += k * TAU;
          } else {
            const sq = Math.sin(((cycle - 0.6) / 0.4) * Math.PI) * 0.18;
            sy = 1 - sq;
            sx = sz = 1 + sq * 0.6;
          }
          wagSpeed = 10;
          break;
        }
        case 'waiting': {
          if (!home) break;
          // holds still and looks at you (the turning happens in crowd.js)
          y += Math.sin(t * 1.1 + ph) * 0.03;
          wagSpeed = 1.5;
          wagAmount = 0.12;
          break;
        }
        case 'stale': {
          // lying on its side on the plot, slow breathing, no movement
          y = top + 0.21 * scale;
          roll = Math.PI / 2;
          sx = 1 + Math.sin(t * 0.9 + ph) * 0.04;
          wagAmount = 0;
          break;
        }
        default: {
          // idle: gentle bob while resting between wanders
          y += Math.sin(t * 1.3 + ph) * 0.08 * (1 - swim);
        }
      }

      q.setFromEuler(eul.set(pitch, yaw, roll));
      m.compose(p.set(x, y, z), q, s.set(sx * scale, sy * scale, sz * scale));
      this.body.setMatrixAt(i, m);
      this.faces[FACE_FOR_STATE[e.state]].setMatrixAt(i, m);
      this.acc[e.accessory].setMatrixAt(i, m);

      // tail: hinge at the back of the body, wagging left-right
      const wag = Math.sin(t * wagSpeed + ph) * wagAmount;
      this._t.makeRotationY(wag).setPosition(0, 0, TAIL_JOINT_Z);
      this.tail.setMatrixAt(i, m.multiply(this._t));
    });

    for (const mesh of this.meshes) if (!this.coralMeshes.includes(mesh)) mesh.instanceMatrix.needsUpdate = true;
  }

  // Where everything goes, per client:
  //  - the big coral stands in the middle of the client's first tile (its
  //    root tile never moves, so neither does the coral);
  //  - fish homes sit on rings around it (6+ spots per ring, further rings
  //    only where the plot has room, e.g. on the client's extra tiles);
  //  - each item's preferred spot is hashed from its id (taken → next one);
  //  - its branch grows from the coral base in the direction of its fish.
  _assignSlots(items, zones) {
    const C = this.cfg.coral;
    const size = this.cfg.plots.tileSize;
    const out = new Map();
    this.cores = {};
    const byGroup = new Map();
    for (const it of items) {
      if (!byGroup.has(it.group)) byGroup.set(it.group, []);
      byGroup.get(it.group).push(it);
    }
    for (const [group, list] of byGroup) {
      const tiles = zones[group];
      if (!tiles) continue;
      const nav = this.navs.get(group);
      const centre = toWorld(...parse(tiles[0]), size);
      const r = Math.min(C.baseMax, C.baseRadius + C.basePerItem * list.length);
      const spin = (hashString(group) % 360) * (Math.PI / 180);
      this.cores[group] = { x: centre.x, z: centre.z, r, spin };

      // candidate spots, ring by ring, keeping only ones on the plot
      const ringR = r * 0.8 + C.fishDistance;
      const spots = [];
      for (let k = 0; spots.length < list.length && k < 6; k++) {
        const R = ringR + k * C.ringSpacing;
        const count = Math.max(6, Math.floor((TAU * R) / C.fishSpacing));
        for (let j = 0; j < count; j++) {
          const a = spin + (j / count) * TAU;
          const x = centre.x + Math.cos(a) * R, z = centre.z + Math.sin(a) * R;
          if (nav.isWalkable(x, z)) spots.push({ x, z, a });
        }
      }
      const firstRing = Math.max(1, spots.filter((p) => Math.hypot(p.x - centre.x, p.z - centre.z) < ringR + 0.01).length);
      const taken = new Set();
      for (const it of [...list].sort((a, b) => a.id.localeCompare(b.id))) {
        let i = hashString(it.id) % firstRing;
        for (let tries = 0; taken.has(i) && tries < spots.length; tries++) i = (i + 1) % spots.length;
        if (taken.has(i) || !spots[i]) continue; // plot full (shouldn't happen with the tile rule)
        taken.add(i);
        const s = spots[i];
        const ox = Math.cos(s.a), oz = Math.sin(s.a);
        out.set(it.id, {
          x: s.x,
          z: s.z,
          // branch root: on the base's shoulder, toward this fish
          coralX: centre.x + ox * r * 0.6,
          coralZ: centre.z + oz * r * 0.6,
          coralY: this.plotTop - 0.1 + r * 0.4, // on the rock's shoulder
          dirOutX: ox,
          dirOutZ: oz,
        });
      }
    }
    return out;
  }
}
