import * as THREE from 'three';

// Gentle rolling seabed. The height is a sum of a few slow waves, so we
// know EXACTLY how high it can ever get (TERRAIN_MAX). Plots sit on top
// of that, so no hill can ever poke through a plot.
//
// Each wave: amplitude a, frequency f (lower = wider hills), direction
// (dx, dz) and phase p. Tweak the amplitudes for flatter/bumpier ground.
const WAVES = [
  { a: 0.45, f: 0.055, dx: 0.8, dz: 0.6, p: 0.3 },
  { a: 0.3, f: 0.09, dx: -0.4, dz: 0.92, p: 1.7 },
  { a: 0.15, f: 0.21, dx: 0.97, dz: -0.24, p: 4.1 },
  { a: 0.08, f: 0.43, dx: 0.3, dz: 0.95, p: 2.2 },
];
const AMP = WAVES.reduce((s, w) => s + w.a, 0);

// Heights range from 0 (deepest dip) to TERRAIN_MAX (bumpiest crest).
export const TERRAIN_MAX = 2 * AMP;

export function heightAt(x, z) {
  let h = AMP;
  for (const w of WAVES) h += w.a * Math.sin((x * w.dx + z * w.dz) * w.f + w.p);
  return h;
}

// One flat-shaded mesh. Colour blends from sand in the dips to sea-green
// on the crests (scenery, not data).
export function createTerrainMesh(cfg) {
  const size = cfg.worldRadius * 3;
  const seg = Math.round(size / 1.6); // triangle size ~1.6 units: low-poly look
  const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2).toNonIndexed();

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const low = new THREE.Color(cfg.colors.seabed);
  const high = new THREE.Color(cfg.colors.seabedHigh);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = heightAt(pos.getX(i), pos.getZ(i));
    pos.setY(i, h);
    c.copy(low).lerp(high, THREE.MathUtils.smoothstep(h / TERRAIN_MAX, 0.25, 0.85));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.name = 'terrain';
  return mesh;
}
