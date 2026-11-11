import * as THREE from 'three';
import { paint, merge } from './lowpoly.js';

// Every model, built from simple shapes. Units: a fish is ~1 long before
// the `inhabitants.scale` setting. Fish face +z; their centre is (0,0,0).
//
// Pieces painted WHITE get tinted per fish (that's the state colour).
// Pieces painted a real colour keep it.

const WHITE = '#ffffff';
const INK = '#1d2127';

export function fishBody() {
  return merge([
    paint(new THREE.IcosahedronGeometry(0.5, 1).scale(0.4, 0.62, 0.9), WHITE),
    // dorsal fin
    paint(new THREE.ConeGeometry(0.14, 0.3, 4).scale(0.3, 1, 1).rotateX(-0.5).translate(0, 0.36, -0.05), WHITE),
    // side fins
    paint(new THREE.ConeGeometry(0.08, 0.22, 3).scale(1, 1, 0.35).rotateZ(-1.9).translate(0.22, -0.08, 0.06), WHITE),
    paint(new THREE.ConeGeometry(0.08, 0.22, 3).scale(1, 1, 0.35).rotateZ(1.9).translate(-0.22, -0.08, 0.06), WHITE),
  ]);
}

// Pivot at the joint (origin); fans out backwards along -z.
export function fishTail() {
  return paint(new THREE.ConeGeometry(0.26, 0.38, 4).rotateX(Math.PI / 2).scale(0.22, 1, 1).translate(0, 0, -0.19), WHITE);
}
export const TAIL_JOINT_Z = -0.42;

// Three faces: normal, happy (done), sleepy (stale).
export function fishFaces() {
  const both = (fn) => [fn(1), fn(-1)];
  return {
    normal: merge([
      ...both((s) => paint(new THREE.IcosahedronGeometry(0.085, 1).translate(0.16 * s, 0.08, 0.25), WHITE)),
      ...both((s) => paint(new THREE.IcosahedronGeometry(0.045, 0).translate(0.222 * s, 0.09, 0.285), INK)),
    ]),
    happy: merge([
      ...both((s) =>
        paint(new THREE.TorusGeometry(0.055, 0.017, 3, 8, Math.PI).rotateY((s * Math.PI) / 2).translate(0.19 * s, 0.07, 0.25), INK)
      ),
      paint(new THREE.TorusGeometry(0.075, 0.018, 3, 8, Math.PI).rotateZ(Math.PI).translate(0, -0.04, 0.43), INK),
    ]),
    sleepy: merge([
      ...both((s) => paint(new THREE.BoxGeometry(0.02, 0.02, 0.12).translate(0.175 * s, 0.06, 0.25), INK)),
    ]),
  };
}

// Accessories — picked per fish from its id. Neutral colours on purpose,
// so they never read as state.
export function accessories() {
  const petals = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    petals.push(paint(new THREE.IcosahedronGeometry(0.05, 0).translate(Math.cos(a) * 0.07, 0.33, 0.05 + Math.sin(a) * 0.07), '#fbf8f0'));
  }
  return {
    cap: merge([
      paint(new THREE.SphereGeometry(0.15, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.26, 0.1), '#4b5a6e'),
      paint(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 8).scale(1, 1, 1.2).translate(0, 0.27, 0.24), '#4b5a6e'),
    ]),
    bow: merge([
      paint(new THREE.ConeGeometry(0.08, 0.14, 4).rotateZ(Math.PI / 2).translate(0.07, 0.33, 0.08), '#f1ece1'),
      paint(new THREE.ConeGeometry(0.08, 0.14, 4).rotateZ(-Math.PI / 2).translate(-0.07, 0.33, 0.08), '#f1ece1'),
      paint(new THREE.IcosahedronGeometry(0.035, 0).translate(0, 0.33, 0.08), '#d8d0bf'),
    ]),
    glasses: merge([
      paint(new THREE.TorusGeometry(0.095, 0.016, 4, 10).rotateY(Math.PI / 2).translate(0.19, 0.08, 0.25), '#2d3036'),
      paint(new THREE.TorusGeometry(0.095, 0.016, 4, 10).rotateY(Math.PI / 2).translate(-0.19, 0.08, 0.25), '#2d3036'),
      paint(new THREE.BoxGeometry(0.3, 0.016, 0.016).translate(0, 0.13, 0.34), '#2d3036'),
    ]),
    flower: merge([...petals, paint(new THREE.IcosahedronGeometry(0.04, 0).translate(0, 0.345, 0.05), '#e3cf9f')]),
    headphones: merge([
      paint(new THREE.TorusGeometry(0.27, 0.022, 4, 12, Math.PI).translate(0, 0.06, 0.02), '#3b4250'),
      paint(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 8).rotateZ(Math.PI / 2).translate(0.23, 0.04, 0.02), '#3b4250'),
      paint(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 8).rotateZ(Math.PI / 2).translate(-0.23, 0.04, 0.02), '#3b4250'),
    ]),
  };
}
