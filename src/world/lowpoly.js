import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Small toolkit for building low-poly models in code.

// Paint a whole piece one colour and give it flat (faceted) shading.
export function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv'); // unused, and every merged piece must have the same attributes
  g.computeVertexNormals(); // non-indexed → one normal per face = faceted look
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// Paint with a bottom→top colour fade and keep SMOOTH shading (for the
// organic reef models). y0/y1: heights where the fade starts and ends.
export function paintGradient(geo, bottomHex, topHex, y0, y1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const a = new THREE.Color(bottomHex), b = new THREE.Color(topHex), c = new THREE.Color();
  const pos = g.attributes.position, arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    c.copy(a).lerp(b, THREE.MathUtils.smoothstep(pos.getY(i), y0, y1));
    arr.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// Glue painted pieces into one geometry (= one draw call).
export const merge = (parts) => mergeGeometries(parts);

// Toon material: light falls off in 3 hard steps instead of a smooth fade.
let gradient;
export function toonMaterial(opts = {}) {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 255, 255, 255, 255]), 3, 1);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return new THREE.MeshToonMaterial({ gradientMap: gradient, vertexColors: true, ...opts });
}
