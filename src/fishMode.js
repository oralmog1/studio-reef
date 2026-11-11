// "Fish only" (?widget&fish): instead of the whole reef, a transparent strip
// with one fish per item WAITING ON YOU. Nothing shows while all is calm.
//   - each fish looks like it does in the reef (state colour, its accessory)
//     with the "!" badge and its name; hover it to see what it's waiting for
//   - click a fish → the widget switches to the reef and flies to that item
//   - fish come and go as items start or stop waiting (checked every
//     liveness.checkSeconds)
// Inside the widget it tells the Mac app how many fish there are, so the
// strip can resize itself.
import * as THREE from 'three';
import { config } from './config.js';
import { loadItems } from './data/load.js';
import { stateOf } from './data/state.js';
import { toonMaterial } from './world/lowpoly.js';
import { fishBody, fishTail, TAIL_JOINT_Z, fishFaces, accessories } from './world/models.js';
import { hashString } from './util/hash.js';

const ACCESSORY_NAMES = ['cap', 'bow', 'glasses', 'flower', 'headphones']; // same pick as in the reef
const toMac = (msg) => window.webkit?.messageHandlers?.reef?.postMessage(msg);

document.body.classList.add('fish');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setSize(innerWidth, innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#e8fff4', '#6d7a5a', 1.6));
const sun = new THREE.DirectionalLight('#fff6e0', 1.6);
sun.position.set(3, 6, 8);
scene.add(sun);

// a fixed, slightly-from-above view; the fish row always fills the width
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
camera.position.set(0, 1.6, 10);
camera.lookAt(0, 0.1, 0);
const SLOT = 2.4; // world units per fish
function fitCamera(n) {
  // fit the row's width AND a fish's height, whichever needs more room
  const aspect = innerWidth / innerHeight;
  let halfW = (Math.max(n, 1) * SLOT) / 2, halfH = halfW / aspect;
  if (halfH < 1.5) (halfH = 1.5), (halfW = halfH * aspect);
  Object.assign(camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
  camera.updateProjectionMatrix();
}

const material = toonMaterial();
const geo = { body: fishBody(), tail: fishTail(), face: fishFaces().normal, acc: accessories() };
const labels = document.createElement('div');
document.body.appendChild(labels);

let fish = []; // [{ item, group, tail, phase, label }]
let shownIds = '';

function build(items) {
  for (const f of fish) scene.remove(f.group);
  labels.innerHTML = '';
  const color = new THREE.Color(config.stateColors.waiting);
  fish = items.map((item, i) => {
    const h = hashString(item.id);
    const body = new THREE.Mesh(geo.body, material.clone());
    body.material.color = color; // vertex colours are white, so this is the state colour
    const tail = new THREE.Mesh(geo.tail, body.material);
    tail.position.z = TAIL_JOINT_Z;
    const group = new THREE.Group();
    group.add(body, tail, new THREE.Mesh(geo.face, material), new THREE.Mesh(geo.acc[ACCESSORY_NAMES[(h >>> 8) % ACCESSORY_NAMES.length]], material));
    group.scale.setScalar(1.7);
    group.position.x = (i - (items.length - 1) / 2) * SLOT;
    scene.add(group);
    const badge = document.createElement('div');
    badge.className = 'fish-badge';
    badge.textContent = '!';
    const label = document.createElement('div');
    label.className = 'fish-name';
    label.textContent = item.title;
    label.title = badge.title = item.note || 'Waiting on you';
    labels.append(badge, label);
    return { item, group, tail, phase: ((h % 1000) / 1000) * Math.PI * 2, label, badge };
  });
  fitCamera(items.length);
  toMac({ fishCount: items.length });
}

async function refresh() {
  let items;
  try {
    items = (await loadItems(config.data, { fullAfterHours: config.coral.fullAfterHours })).items;
  } catch {
    return; // server busy: keep what's shown
  }
  const now = Date.now();
  const waiting = items.filter((it) => stateOf(it, config.state, now) === 'waiting').sort((a, b) => a.id.localeCompare(b.id));
  const ids = waiting.map((it) => `${it.id}|${it.title}|${it.note ?? ''}`).join('\n');
  if (ids !== shownIds) {
    shownIds = ids;
    build(waiting);
  }
}

// click a fish (or its name or badge) → open it in the reef
function open(f) {
  if (window.webkit?.messageHandlers?.reef) toMac({ openReef: f.item.id });
  else location.href = `/?focus=${encodeURIComponent(f.item.id)}`;
}
addEventListener('click', (ev) => {
  if (!fish.length) return;
  const slot = Math.floor((ev.clientX / innerWidth) * fish.length); // each fish owns an equal slice of the strip
  open(fish[Math.min(slot, fish.length - 1)]);
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  fitCamera(fish.length);
});

const v = new THREE.Vector3();
renderer.setAnimationLoop((ms) => {
  const t = ms / 1000;
  for (const f of fish) {
    // waiting: holds still and looks at you, a gentle bob, a slow tail
    f.group.position.y = Math.sin(t * 1.1 + f.phase) * 0.05;
    f.group.rotation.y = 0.6 + Math.sin(t * 0.6 + f.phase) * 0.12; // three-quarter view, facing you
    f.tail.rotation.y = Math.sin(t * 1.5 + f.phase) * 0.12;
    v.copy(f.group.position).project(camera);
    const x = ((v.x + 1) / 2) * innerWidth, y = ((1 - v.y) / 2) * innerHeight;
    f.label.style.transform = `translate(-50%, 0) translate(${x}px, ${y + 30}px)`;
    f.badge.style.transform = `translate(-50%, -100%) translate(${x}px, ${y - 30}px)`;
  }
  renderer.render(scene, camera);
});

refresh();
setInterval(refresh, config.liveness.checkSeconds * 1000);
// macOS pauses pages in covered windows; catch up the moment you can see it again
document.addEventListener('visibilitychange', () => document.hidden || refresh());
