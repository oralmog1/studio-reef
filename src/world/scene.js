import * as THREE from 'three';
import { createTerrainMesh } from './terrain.js';

// Base scene: sea colour, fog, rolling seabed, temporary lights.
// Milestone 3 replaces the lights with the scrubbable day/night sun.
export function createScene(cfg) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(cfg.colors.background);
  scene.fog = new THREE.Fog(cfg.colors.fog, cfg.fog.near, cfg.fog.far);

  scene.add(createTerrainMesh(cfg));

  scene.add(new THREE.HemisphereLight('#e8fff4', '#6d7a5a', 1.6));
  const sun = new THREE.DirectionalLight('#fff6e0', 1.6);
  sun.position.set(30, 50, 20);
  scene.add(sun);

  return scene;
}
