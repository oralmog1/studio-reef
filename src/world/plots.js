import * as THREE from 'three';
import { parse, toWorld } from './hex.js';
import { TERRAIN_MAX } from './terrain.js';

// Everything that stands on a plot is measured from this ONE height:
// just above the bumpiest the terrain can ever get.
export function plotTopY(cfg) {
  return TERRAIN_MAX + cfg.plots.clearance;
}

// All claimed tiles as one instanced mesh of raised hexagonal slabs.
// Plots are neutral stone on purpose: colour is reserved for state.
export function createPlots(zones, cfg) {
  const top = plotTopY(cfg);
  const bottom = -0.5; // sink below the lowest dip so no gap shows
  const size = cfg.plots.tileSize;
  const inset = cfg.plots.inset; // small gap between neighbouring tiles

  // three's 6-sided cylinder has a corner pointing along +z = pointy-top hex.
  const geo = new THREE.CylinderGeometry(size - inset, size - inset + 0.15, top - bottom, 6, 1)
    .translate(0, (top - bottom) / 2 + bottom, 0);
  const materials = [
    new THREE.MeshLambertMaterial({ color: cfg.colors.plotSide, flatShading: true }), // sides
    new THREE.MeshLambertMaterial({ color: cfg.colors.plotTop, flatShading: true }), // top
    new THREE.MeshLambertMaterial({ color: cfg.colors.plotSide }), // bottom (never seen)
  ];

  const keys = Object.values(zones).flat();
  const mesh = new THREE.InstancedMesh(geo, materials, Math.max(keys.length, 1));
  mesh.count = keys.length;
  const m = new THREE.Matrix4();
  keys.forEach((k, i) => {
    const { x, z } = toWorld(...parse(k), size);
    mesh.setMatrixAt(i, m.makeTranslation(x, 0, z));
  });
  mesh.name = 'plots';
  return mesh;
}
