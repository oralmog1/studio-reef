// Hex-grid maths (pointy-top hexes, "axial" q/r coordinates).
// A tile is identified by a key string like "2,-1".

const SQRT3 = Math.sqrt(3);
export const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export const key = (q, r) => `${q},${r}`;
export const parse = (k) => k.split(',').map(Number);

// Centre of a tile in world x/z. `size` = centre-to-corner distance.
export function toWorld(q, r, size) {
  return { x: size * SQRT3 * (q + r / 2), z: size * 1.5 * r };
}

export function distance(aq, ar, bq, br) {
  const dq = aq - bq, dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function neighbours(q, r) {
  return DIRECTIONS.map(([dq, dr]) => key(q + dq, r + dr));
}

// Every tile whose whole hexagon fits inside a circle of `radius`,
// sorted innermost-first (then by compass angle, so the order is fixed).
export function tilesWithin(radius, size) {
  const n = Math.ceil(radius / size);
  const out = [];
  for (let q = -n; q <= n; q++) {
    for (let r = -n; r <= n; r++) {
      const { x, z } = toWorld(q, r, size);
      if (Math.hypot(x, z) + size > radius) continue;
      out.push({ key: key(q, r), q, r, x, z, ring: distance(q, r, 0, 0), angle: Math.atan2(z, x) });
    }
  }
  out.sort((a, b) => a.ring - b.ring || a.angle - b.angle);
  return out;
}

// Is world point (px, pz) inside the hexagon centred at (cx, cz)?
// `size` can be inflated to add a safety margin.
export function insideHex(px, pz, cx, cz, size) {
  const dx = Math.abs(px - cx), dz = Math.abs(pz - cz);
  const h = (SQRT3 / 2) * size; // centre-to-flat-edge
  if (dx > h || dz > size) return false;
  return h * size - size / 2 * dx - h * dz >= 0 || dz <= size / 2;
}
