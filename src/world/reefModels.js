import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paintGradient, merge } from './lowpoly.js';
import { seededRandom } from '../util/hash.js';

// Organic reef models, after the reference sheet: tapered, rounded coral
// arms; tube sponges with open rims and dark insides; flared cup corals;
// porous rocks; curly lettuce coral. Smooth shading, lighter at the tips.
//
// Coral branch species (one per item, picked from its id), all ~1.2 tall:
//   antler  forked, tapering arms with rounded tips
//   ytube   a Y-shaped tube sponge with open ends
//   tubes   a cluster of short, fat open tubes
//   cup     a stalk carrying a wide, wavy cup

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP_Z = V(0, 0, 1);

// A tube along a curve whose radius tapers from r0 to r1.
function taperedTube(points, r0, r1, radial = 8, segs = 10) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const pos = geo.attributes.position, P = V(0, 0, 0), v = V(0, 0, 0);
  for (let i = 0; i <= segs; i++) {
    curve.getPointAt(i / segs, P);
    const r = THREE.MathUtils.lerp(r0, r1, i / segs);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(P).multiplyScalar(r).add(P);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  return { geo, curve };
}

// An open end: a soft rim plus a dark disc a little way inside.
function opening(parts, curve, r) {
  const end = curve.getPointAt(1), dir = curve.getTangentAt(1).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(UP_Z, dir);
  parts.push({ geo: new THREE.TorusGeometry(r, r * 0.26, 6, 16).applyQuaternion(q).translate(end.x, end.y, end.z) });
  const inner = end.clone().addScaledVector(dir, -r * 0.4);
  parts.push({ geo: new THREE.CircleGeometry(r * 0.98, 16).applyQuaternion(q).translate(inner.x, inner.y, inner.z), dark: true });
}

const ball = (p, r) => ({ geo: new THREE.SphereGeometry(r, 8, 6).translate(p.x, p.y, p.z) });

// Colour every part: body parts fade base→tip by height, insides are dark.
function finish(parts, c) {
  const top = Math.max(...parts.filter((p) => !p.dark).map((p) => (p.geo.computeBoundingBox(), p.geo.boundingBox.max.y)));
  return merge(parts.map((p) => (p.dark ? paintGradient(p.geo, c.inside, c.inside, 0, 1) : paintGradient(p.geo, c.base, c.tip, 0, top * 1.05))));
}

function antler(c) {
  const parts = [];
  const rng = seededRandom(7);
  const grow = (start, dir, len, r, depth) => {
    const end = start.clone().addScaledVector(dir, len);
    const mid = start.clone().addScaledVector(dir, len * 0.5).add(V((rng() - 0.5) * len * 0.3, 0, (rng() - 0.5) * len * 0.3));
    parts.push({ geo: taperedTube([start, mid, end], r, r * 0.74, 8, 8).geo });
    parts.push(ball(end, r * 0.74)); // joint, or a rounded tip
    if (!depth) return;
    const kids = depth >= 2 ? 3 : 2;
    for (let k = 0; k < kids; k++) {
      const a = (k / kids) * Math.PI * 2 + rng() * 0.9;
      const nd = dir.clone().applyAxisAngle(V(Math.cos(a), 0, Math.sin(a)), 0.5 + rng() * 0.35);
      nd.y += 0.2;
      grow(end, nd.normalize(), len * 0.74, r * 0.74, depth - 1);
    }
  };
  grow(V(0, 0, 0), V(0, 1, 0), 0.42, 0.14, 3);
  return finish(parts, c);
}

function ytube(c) {
  const parts = [];
  parts.push({ geo: taperedTube([V(0, 0, 0), V(0.02, 0.18, 0), V(0, 0.34, 0)], 0.2, 0.17).geo });
  parts.push(ball(V(0, 0.34, 0), 0.19));
  const arms = [
    [V(0, 0.32, 0), V(-0.28, 0.55, 0.02), V(-0.36, 1.18, 0.04), 0.16, 0.18],
    [V(0, 0.32, 0), V(0.26, 0.5, -0.02), V(0.34, 1.08, -0.05), 0.16, 0.17],
    [V(-0.1, 0.4, 0.05), V(-0.3, 0.52, 0.2), V(-0.42, 0.78, 0.3), 0.1, 0.11],
  ];
  for (const [a, b, e, r0, r1] of arms) {
    const t = taperedTube([a, b, e], r0, r1, 10, 12);
    parts.push({ geo: t.geo });
    opening(parts, t.curve, r1);
  }
  return finish(parts, c);
}

function tubes(c) {
  const parts = [ball(V(0, 0.05, 0), 0.34)];
  parts[0].geo.scale(1, 0.5, 1);
  const set = [
    [0, 0, 1.1, 0.2],
    [0.28, 0.1, 0.8, 0.17],
    [-0.24, 0.16, 0.9, 0.16],
    [0.05, -0.3, 0.65, 0.15],
    [-0.2, -0.18, 0.5, 0.13],
  ];
  for (const [x, z, h, r] of set) {
    const t = taperedTube([V(x * 0.6, 0, z * 0.6), V(x * 0.9, h * 0.5, z * 0.9), V(x * 1.15, h, z * 1.15)], r * 0.85, r, 10, 10);
    parts.push({ geo: t.geo });
    opening(parts, t.curve, r);
  }
  return finish(parts, c);
}

function cup(c) {
  const parts = [{ geo: taperedTube([V(0, 0, 0), V(0.04, 0.3, 0), V(0, 0.62, 0)], 0.1, 0.07).geo }];
  // flared cup from a lathe profile, with a wavy rim
  const profile = [[0.06, 0.58], [0.13, 0.66], [0.22, 0.8], [0.31, 0.97], [0.37, 1.12]].map(([x, y]) => new THREE.Vector2(x, y));
  const lathe = new THREE.LatheGeometry(profile, 24);
  const pos = lathe.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), rr = Math.hypot(x, z);
    pos.setY(i, pos.getY(i) + Math.sin(Math.atan2(z, x) * 6) * 0.06 * (rr / 0.37) ** 3);
  }
  lathe.computeVertexNormals();
  parts.push({ geo: lathe });
  parts.push({ geo: new THREE.CircleGeometry(0.16, 12).rotateX(-Math.PI / 2).translate(0, 0.72, 0), dark: true });
  return finish(parts, c);
}

export function coralBranches(colors) {
  const c = { base: colors.coral, tip: colors.coralTip, inside: colors.coralInside };
  return { antler: antler(c), ytube: ytube(c), tubes: tubes(c), cup: cup(c) };
}

// Porous rock: a lumpy stone pitted with round craters.
// detail: smoothness; flat: squash (1 = round).
export function porousRock({ detail = 4, flat = 0.55, craters = 16, seed = 3, stone, pit }) {
  const rng = seededRandom(seed);
  let geo = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo);
  const holes = [];
  for (let i = 0; i < craters; i++) {
    const u = rng() * 2 - 1, a = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    holes.push({ d: V(s * Math.cos(a), Math.abs(u) * 0.9 + 0.1, s * Math.sin(a)).normalize(), r: 0.12 + rng() * 0.16 });
  }
  const pos = geo.attributes.position, v = V(0, 0, 0), dir = V(0, 0, 0);
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    dir.copy(v).normalize();
    let r = 1 + Math.sin(dir.x * 3.1 + seed) * 0.08 + Math.sin(dir.z * 2.7 + dir.y * 2) * 0.07; // lumps
    for (const h of holes) {
      const ang = dir.angleTo(h.d);
      if (ang < h.r) {
        const k = 1 - ang / h.r;
        r -= k * k * 0.12;
        depth[i] = Math.max(depth[i], k);
      }
    }
    pos.setXYZ(i, dir.x * r, dir.y * r * flat, dir.z * r);
  }
  geo.computeVertexNormals();
  // colour: pits darker
  const a = new THREE.Color(stone), b = new THREE.Color(pit), c = new THREE.Color();
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    c.copy(a).lerp(b, Math.min(1, depth[i] * 1.6));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo.toNonIndexed();
}

// Lettuce coral (scenery): curled leaves around a centre.
export function lettuce(base, tip) {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.SphereGeometry(0.34, 5, 4, 0, 1.4, 0.25, 1.35) // a curved shell patch
      .rotateZ(-0.35)
      .translate(0.12, 0.05, 0)
      .rotateY((i / 6) * Math.PI * 2 + (i % 2) * 0.3);
    if (i % 2) leaf.scale(0.8, 0.8, 0.8);
    parts.push(paintGradient(leaf, base, tip, 0, 0.35));
  }
  return merge(parts);
}
