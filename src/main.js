import * as THREE from 'three';
import { config } from './config.js';
import { loadItems } from './data/load.js';
import { stateOf } from './data/state.js';
import { createRenderer } from './world/renderer.js';
import { createScene } from './world/scene.js';
import { EarthControls } from './world/earthControls.js';
import { tilesWithin } from './world/hex.js';
import { computeLayout, loadSavedLayout, saveLayout, clearSavedLayout } from './world/layout.js';
import { createPlots, plotTopY } from './world/plots.js';
import { Scatter } from './world/scatter.js';
import { Inhabitants } from './world/inhabitants.js';
import { Badges } from './world/badges.js';
import { Life } from './world/life/index.js';
import { Interaction } from './interaction.js';
import { Quality } from './quality.js';
import { isWidget } from './widget.js';
import { keepCurrent } from './liveness.js';
import { parse, toWorld } from './world/hex.js';
import { showError, showNotice } from './ui/format.js';

const container = document.getElementById('app');
const renderer = createRenderer(container, config);
const scene = createScene(config);
const plotTop = plotTopY(config);
const camera = new THREE.PerspectiveCamera(config.camera.fov, window.innerWidth / window.innerHeight, 0.5, 500);
const controls = new EarthControls(camera, renderer.domElement, config.camera, config.worldRadius, plotTop);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let inhabitants = null, badges = null, interaction = null, life = null;
const quality = new Quality(config, { renderer });
const start = performance.now();
let last = start;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  if (!quality.shouldRender(now, last)) return; // frame cap / idle mode
  const dt = Math.min((now - last) / 1000, 0.1); // cap, so a hidden tab doesn't teleport fish
  last = now;
  const t = (now - start) / 1000;
  life?.update(t, dt, camera, renderer);
  inhabitants?.update(t, dt, camera);
  badges?.update(t);
  controls.tick(dt);
  interaction?.update();
  renderer.render(scene, camera);
});

if (isWidget) document.body.classList.add('widget');

try {
  const { items, warnings } = await loadItems(config.data, { fullAfterHours: config.coral.fullAfterHours });
  if (warnings.length) showNotice(warnings);
  const states = new Map(items.map((it) => [it.id, stateOf(it, config.state)]));

  // Layout: which tiles each client owns (sticky, saved in the browser).
  const counts = new Map();
  for (const it of items) counts.set(it.group, (counts.get(it.group) ?? 0) + 1);
  const groups = [...counts].map(([name, count]) => ({ name, count }));
  const cells = tilesWithin(config.worldRadius, config.plots.tileSize);
  const zones = computeLayout(groups, loadSavedLayout(), cells, config.layout.itemsPerExtraTile);
  saveLayout(zones);

  // Start with every client in view.
  const tilePts = Object.values(zones).flat().map((k) => toWorld(...parse(k), config.plots.tileSize));
  if (tilePts.length) {
    const cx = tilePts.reduce((a, p) => a + p.x, 0) / tilePts.length;
    const cz = tilePts.reduce((a, p) => a + p.z, 0) / tilePts.length;
    const reach = Math.max(...tilePts.map((p) => Math.hypot(p.x - cx, p.z - cz))) + config.plots.tileSize;
    controls.target.set(cx, plotTop, cz);
    controls.distance = (reach * 3) / Math.min(1, camera.aspect);
    controls.update();
  }

  scene.add(createPlots(zones, config));
  const scatter = new Scatter(scene, config);
  scatter.rebuild(zones);
  inhabitants = new Inhabitants(scene, config, plotTop);
  inhabitants.build(items, states, zones);
  badges = new Badges(scene, config, plotTop);
  badges.build(inhabitants.list);
  life = new Life({ scene, cfg: config, plotTop, inhabitants, scatter, now: (performance.now() - start) / 1000 });

  quality.attach({ scatter, life });

  interaction = new Interaction({
    renderer, scene, camera, controls, inhabitants, zones, cfg: config, plotTop, quality,
    onResetLayout: () => {
      clearSavedLayout();
      location.reload();
    },
  });
  // ?focus=<id> (from "Fish only"): fly straight to that item and open its card
  const focus = new URLSearchParams(location.search).get('focus');
  const focused = focus && inhabitants.list.find((e) => e.item.id === focus);
  if (focused) setTimeout(() => interaction.select(focused, true), 600);

  // Handy for poking around in the browser console.
  keepCurrent({
    dataCfg: config.data, items, states, rules: config.state, quality,
    fullAfterHours: config.coral.fullAfterHours,
    onProgress: (id, p) => inhabitants.setProgress(id, p),
    onUpdate: () => interaction.itemsUpdated(),
    checkSeconds: config.liveness.checkSeconds,
    calmSeconds: isWidget ? 0 : config.liveness.calmSeconds,
  });
  window.reef = { items, states, zones, scene, camera, controls, scatter, inhabitants, badges, interaction, life, quality };
} catch (err) {
  console.error(err);
  showError(err);
}
