import * as THREE from 'three';
import { parse, toWorld } from '../world/hex.js';
import { el, esc } from './format.js';

// Zone (client) names, always shown on each plot's rim nearest the camera.
// A small dot marks zones with something waiting on you.
export class ZoneLabels {
  constructor(zones, list, cfg, plotTop) {
    this.plotTop = plotTop;
    this.size = cfg.plots.tileSize;
    this.labels = Object.entries(zones).map(([name, tiles]) => {
      const pts = tiles.map((k) => toWorld(...parse(k), this.size));
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
      const spread = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.z - cz)));
      const needsMe = list.some((e) => e.item.group === name && e.state === 'waiting');
      const node = el('div', `zone-label ui visible${needsMe ? ' needs-me' : ''}`, esc(name));
      node.style.setProperty('--dot', cfg.stateColors.waiting);
      document.body.appendChild(node);
      return { name, cx, cz, reach: spread + this.size * 0.9, needsMe, node };
    });
    this._v = new THREE.Vector3();
  }

  update(camera) {
    for (const L of this.labels) {
      const dx = camera.position.x - L.cx, dz = camera.position.z - L.cz, d = Math.hypot(dx, dz) || 1;
      const v = this._v.set(L.cx + (dx / d) * L.reach, this.plotTop, L.cz + (dz / d) * L.reach).project(camera);
      const behind = v.z > 1;
      L.node.style.visibility = behind ? 'hidden' : 'visible';
      L.node.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px)`;
    }
  }
}
