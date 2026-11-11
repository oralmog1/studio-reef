import { hashString, seededRandom } from '../util/hash.js';

// Moves the fish around. Three separate jobs, in this order each frame:
//   1. Decide  — where does each fish want to go? (A* path on its zone)
//   2. Crowd   — fish that are too close get gently pushed apart.
//   3. Collide — every step is checked against the zone's walkable cells,
//                so nothing leaves the plot, even if a path failed.
// Afterwards we measure how far each fish ACTUALLY moved; the renderer
// uses that (not the intended speed) to choose swim vs rest animation.
//
// Who moves:
//   idle              wanders its own plot: pick a spot, swim there, pause
//   working/done/waiting  stays at its spot; if pushed away, swims back
//   stale             never moves (others route around it)

const HOME_STATES = new Set(['working', 'done', 'waiting']);

export class Crowd {
  constructor(cfg) {
    this.cfg = cfg; // config.movement
  }

  // list: inhabitant entries; navs: Map group → ZoneNav
  init(list, navs) {
    this.list = list;
    for (const e of list) {
      e.nav = navs.get(e.item.group);
      e.px = e.x;
      e.pz = e.z;
      e.facing = e.yaw;
      e.speed = 0; // measured, smoothed
      e.path = null;
      e.pathIndex = 0;
      e.stuck = 0;
      e.atHome = true;
      e.rng = seededRandom(hashString(e.item.id) ^ 0x9e3779b9);
      e.wait = e.rng() * this.cfg.pauseMax; // stagger the first wander
    }
  }

  step(dt, camera) {
    const c = this.cfg;
    // reuse one scratch array (no garbage created per frame)
    if (!this.moves || this.moves.length !== this.list.length) this.moves = this.list.map(() => ({ x: 0, z: 0 }));
    const moves = this.moves;
    for (const m of moves) m.x = m.z = 0;

    // 1. Decide + follow paths
    this.list.forEach((e, i) => {
      if (e.state === 'stale' || e.arriving) return; // arriving fish are steered by life/events.js
      let speed = c.wanderSpeed;

      if (HOME_STATES.has(e.state)) {
        const away = Math.hypot(e.x - e.px, e.z - e.pz);
        if (away > c.arriveDistance && !e.path) {
          e.path = e.nav.findPath(e.px, e.pz, e.x, e.z);
          e.pathIndex = 0;
        }
        e.atHome = away <= c.arriveDistance * 2 && !e.path;
        speed = c.returnSpeed;
      } else if (!e.path) {
        // idle: pause, then pick a new spot on the plot
        e.wait -= dt;
        if (e.wait <= 0) {
          const target = e.nav.randomPoint(e.rng);
          if (target && Math.hypot(target.x - e.px, target.z - e.pz) > c.minWander) {
            e.path = e.nav.findPath(e.px, e.pz, target.x, target.z);
            e.pathIndex = 0;
          }
          if (!e.path) e.wait = 1; // no luck; try again shortly
        }
      }

      if (e.path) {
        const wp = e.path[e.pathIndex];
        const dx = wp.x - e.px, dz = wp.z - e.pz;
        const d = Math.hypot(dx, dz);
        const last = e.pathIndex === e.path.length - 1;
        if (d < (last ? c.arriveDistance : 0.3)) {
          e.pathIndex++;
          if (e.pathIndex >= e.path.length) {
            e.path = null;
            e.wait = c.pauseMin + e.rng() * (c.pauseMax - c.pauseMin);
          }
        } else {
          const v = speed * (last ? Math.min(1, d / 0.8) : 1); // ease in on arrival
          moves[i].x = (dx / d) * v * dt;
          moves[i].z = (dz / d) * v * dt;
        }
      }
    });

    // 2. Crowd: push apart anyone closer than personalSpace
    for (let a = 0; a < this.list.length; a++) {
      for (let b = a + 1; b < this.list.length; b++) {
        const A = this.list[a], B = this.list[b];
        if (A.arriving || B.arriving) continue;
        const dx = B.px - A.px, dz = B.pz - A.pz;
        const d = Math.hypot(dx, dz);
        if (d >= c.personalSpace || d === 0) continue;
        const push = (c.personalSpace - d) * c.pushStrength * dt;
        const nx = dx / d, nz = dz / d;
        const aFixed = A.state === 'stale', bFixed = B.state === 'stale';
        if (aFixed && bFixed) continue;
        const shareA = aFixed ? 0 : bFixed ? 1 : 0.5;
        moves[a].x -= nx * push * shareA;
        moves[a].z -= nz * push * shareA;
        moves[b].x += nx * push * (1 - shareA);
        moves[b].z += nz * push * (1 - shareA);
      }
    }

    // 3. Collide + measure what actually happened
    const smooth = 1 - Math.exp(-dt * 8);
    this.list.forEach((e, i) => {
      if (e.arriving) return;
      const m = moves[i];
      const ox = e.px, oz = e.pz;
      if (e.state !== 'stale') this._moveWithCollision(e, m.x, m.z);
      const mx = e.px - ox, mz = e.pz - oz;
      const moved = Math.hypot(mx, mz);
      e.speed += (moved / Math.max(dt, 1e-4) - e.speed) * smooth;

      // stuck on a path (crowd blocking)? give up and rethink
      if (e.path && moved < c.wanderSpeed * dt * 0.2) {
        e.stuck += dt;
        if (e.stuck > c.stuckAfter) {
          e.path = null;
          e.wait = 1;
          e.stuck = 0;
        }
      } else e.stuck = 0;

      // facing: follow the direction of travel; when resting at home,
      // turn to the state's resting direction
      let want = null;
      if (moved / Math.max(dt, 1e-4) > 0.15) want = Math.atan2(mx, mz);
      else if (e.atHome && e.state === 'working') want = Math.atan2(e.coralX - e.px, e.coralZ - e.pz);
      else if (e.atHome && e.state === 'waiting') want = Math.atan2(camera.position.x - e.px, camera.position.z - e.pz);
      if (want !== null) {
        const diff = Math.atan2(Math.sin(want - e.facing), Math.cos(want - e.facing)); // shortest way round
        e.facing += Math.sign(diff) * Math.min(Math.abs(diff), c.turnRate * dt);
      }
    });
  }

  // Try the full step; if that lands off the walkable area, slide along
  // one axis; otherwise stay put. A fish that somehow starts off the
  // walkable area may always move (so it can get back on).
  _moveWithCollision(e, dx, dz) {
    const nav = e.nav;
    const free = !nav.isWalkable(e.px, e.pz);
    if (free || nav.isWalkable(e.px + dx, e.pz + dz)) {
      e.px += dx;
      e.pz += dz;
    } else if (nav.isWalkable(e.px + dx, e.pz)) {
      e.px += dx;
    } else if (nav.isWalkable(e.px, e.pz + dz)) {
      e.pz += dz;
    }
  }
}
