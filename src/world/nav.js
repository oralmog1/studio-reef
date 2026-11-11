import { insideHex } from './hex.js';

// Walkability grid for ONE zone (one client's plot), plus A* pathfinding.
//
// The zone is covered with small square cells. A cell is walkable if it
// sits on the zone's tiles, at least `edgeMargin` away from the outer edge
// (shared edges between the zone's own tiles don't count as edges), and
// isn't covered by an obstacle (corals, sleeping fish).

const SQRT2 = Math.SQRT2;
const NEIGHBOURS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]];

export class ZoneNav {
  constructor(centres, tileSize, { cellSize, edgeMargin }) {
    this.cs = cellSize;
    const xs = centres.map((c) => c.x), zs = centres.map((c) => c.z);
    this.x0 = Math.min(...xs) - tileSize;
    this.z0 = Math.min(...zs) - tileSize;
    this.w = Math.ceil((Math.max(...xs) + tileSize - this.x0) / cellSize);
    this.h = Math.ceil((Math.max(...zs) + tileSize - this.z0) / cellSize);

    const onPlot = (x, z) => centres.some((c) => insideHex(x, z, c.x, c.z, tileSize));
    this.base = new Uint8Array(this.w * this.h);
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const { x, z } = this.centre(i, j);
        let ok = onPlot(x, z);
        // erode: every point `edgeMargin` around must be on the plot too
        for (let k = 0; ok && k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          ok = onPlot(x + Math.cos(a) * edgeMargin, z + Math.sin(a) * edgeMargin);
        }
        this.base[j * this.w + i] = ok ? 1 : 0;
      }
    }
    this.setObstacles([]);
  }

  // obstacles: [{ x, z, r }] — replaces any previous obstacles
  setObstacles(list) {
    this.walk = this.base.slice();
    for (const o of list) {
      for (let j = 0; j < this.h; j++) {
        for (let i = 0; i < this.w; i++) {
          const c = this.centre(i, j);
          if (Math.hypot(c.x - o.x, c.z - o.z) < o.r) this.walk[j * this.w + i] = 0;
        }
      }
    }
    this.open = [];
    for (let n = 0; n < this.walk.length; n++) if (this.walk[n]) this.open.push(n);
  }

  centre(i, j) {
    return { x: this.x0 + (i + 0.5) * this.cs, z: this.z0 + (j + 0.5) * this.cs };
  }

  _cell(x, z) {
    const i = Math.floor((x - this.x0) / this.cs), j = Math.floor((z - this.z0) / this.cs);
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i;
  }

  isWalkable(x, z) {
    const n = this._cell(x, z);
    return n >= 0 && this.walk[n] === 1;
  }

  randomPoint(rng) {
    if (!this.open.length) return null;
    const n = this.open[Math.floor(rng() * this.open.length)];
    return this.centre(n % this.w, Math.floor(n / this.w));
  }

  // Straight line between two points stays on walkable cells?
  lineOfSight(ax, az, bx, bz) {
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (this.cs * 0.5));
    for (let s = 1; s <= steps; s++) {
      const k = s / steps;
      if (!this.isWalkable(ax + (bx - ax) * k, az + (bz - az) * k)) return false;
    }
    return true;
  }

  // Nearest walkable cell to a point (small spiral search).
  _nearestOpen(x, z) {
    let n = this._cell(x, z);
    if (n >= 0 && this.walk[n]) return n;
    let best = -1, bestD = Infinity;
    for (const m of this.open) {
      const c = this.centre(m % this.w, Math.floor(m / this.w));
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bestD) (bestD = d), (best = m);
    }
    return best;
  }

  // A* from a to b. Returns a list of waypoints [{x, z}] or null.
  findPath(ax, az, bx, bz) {
    const start = this._nearestOpen(ax, az), goal = this._nearestOpen(bx, bz);
    if (start < 0 || goal < 0) return null;
    const W = this.w, N = this.walk.length;
    const g = new Float32Array(N).fill(Infinity);
    const f = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const gi = goal % W, gj = Math.floor(goal / W);
    const h = (n) => {
      const dx = Math.abs((n % W) - gi), dz = Math.abs(Math.floor(n / W) - gj);
      return dx + dz + (SQRT2 - 2) * Math.min(dx, dz); // octile distance
    };
    g[start] = 0;
    f[start] = h(start);
    const open = [start]; // zones are small (a few hundred cells): a plain list is plenty

    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const ci = cur % W, cj = Math.floor(cur / W);
      for (const [di, dj, cost] of NEIGHBOURS) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
        const nb = nj * W + ni;
        if (!this.walk[nb] || closed[nb]) continue;
        // no cutting corners diagonally past a blocked cell
        if (di && dj && (!this.walk[cj * W + ni] || !this.walk[nj * W + ci])) continue;
        const ng = g[cur] + cost;
        if (ng < g[nb]) {
          g[nb] = ng;
          f[nb] = ng + h(nb);
          came[nb] = cur;
          open.push(nb);
        }
      }
    }
    if (start !== goal && came[goal] < 0) return null;

    const cells = [];
    for (let n = goal; n >= 0; n = came[n]) cells.push(n);
    cells.reverse();
    const pts = cells.map((n) => this.centre(n % W, Math.floor(n / W)));
    if (this.isWalkable(bx, bz)) pts[pts.length - 1] = { x: bx, z: bz };

    // smooth: skip waypoints that can be seen directly
    const out = [];
    let from = { x: ax, z: az }, k = 0;
    while (k < pts.length) {
      let far = k;
      while (far + 1 < pts.length && this.lineOfSight(from.x, from.z, pts[far + 1].x, pts[far + 1].z)) far++;
      out.push(pts[far]);
      from = pts[far];
      k = far + 1;
    }
    return out;
  }
}
