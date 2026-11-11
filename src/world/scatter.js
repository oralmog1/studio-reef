import * as THREE from 'three';
import { paint, merge } from './lowpoly.js';
import { porousRock, lettuce } from './reefModels.js';
import { heightAt } from './terrain.js';
import { parse, toWorld, insideHex } from './hex.js';
import { hashString, seededRandom } from '../util/hash.js';

// Reef scenery: kelp, sponges, lettuce coral, seagrass and porous rocks on the
// seabed between plots. Pure decoration, never data, and kept in muted
// colours so it never competes with the state colours. Placement is
// seeded, so it looks the same every load. Rebuilt whenever the set of
// claimed tiles changes, so nothing ever pokes through a plot.

function makeKinds(colors) {
  // seagrass: a tuft of long thin blades
  const blade = (angle, lean, h) =>
    new THREE.ConeGeometry(0.07, h, 3).translate(0, h / 2, 0).rotateZ(lean).rotateY(angle);

  // kelp: a wobbly stalk of stacked segments with leaves along it
  const kelpParts = [];
  let x = 0, z = 0;
  for (let i = 0; i < 6; i++) {
    const nx = x + Math.sin(i * 1.7) * 0.12, nz = z + Math.cos(i * 2.3) * 0.12;
    const seg = new THREE.CylinderGeometry(0.05, 0.06, 0.62, 4).translate(0, 0.31, 0);
    seg.rotateZ((nx - x) * 1.2).rotateX(-(nz - z) * 1.2).translate(x, i * 0.6, z);
    kelpParts.push(paint(seg, colors.kelp));
    const leaf = new THREE.ConeGeometry(0.16, 0.7, 3).scale(1, 1, 0.25).translate(0, 0.35, 0)
      .rotateZ(i % 2 ? 0.9 : -0.9).rotateY(i * 1.3).translate(nx, i * 0.6 + 0.3, nz);
    kelpParts.push(paint(leaf, colors.kelpLeaf));
    x = nx; z = nz;
  }

  // tube sponge: three open-looking tubes of different heights
  const tube = (h, dx, dz, r) => paint(new THREE.CylinderGeometry(r, r * 0.8, h, 6).translate(dx, h / 2, dz), colors.sponge);

  return {
    seagrass: {
      share: 0.5,
      geo: merge([blade(0, 0.2, 0.9), blade(1.6, 0.3, 0.7), blade(3.1, 0.15, 1.0), blade(4.6, 0.35, 0.6)].map((g) => paint(g, colors.seagrass))),
      scale: [0.7, 1.4],
      sway: true,
    },
    kelp: { share: 0.09, geo: merge(kelpParts), scale: [0.8, 1.5], sway: true },
    sponge: { share: 0.07, geo: merge([tube(0.8, 0, 0, 0.14), tube(0.55, 0.22, 0.08, 0.12), tube(0.4, -0.08, 0.22, 0.1)]), scale: [0.7, 1.3] },
    lettuce: {
      share: 0.1,
      geo: lettuce(colors.lettuce, colors.lettuceTip).scale(1.3, 1.3, 1.3),
      scale: [0.6, 1.4],
    },
    rock: {
      share: 0.24,
      geo: porousRock({ detail: 1, flat: 0.6, craters: 6, seed: 11, stone: colors.rock, pit: colors.rockPit }).scale(0.45, 0.45, 0.45).translate(0, 0.1, 0),
      scale: [0.5, 1.6],
    },
  };
}

export class Scatter {
  constructor(scene, cfg) {
    this.scene = scene;
    this.cfg = cfg;
    this.kinds = makeKinds(cfg.colors);
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }); // double: thin lettuce leaves
    // Plants sway in the current. The higher up the plant, the more it moves.
    // ambience.js sets uSway (current strength) and uTime every frame.
    this.sway = { uTime: { value: 0 }, uSway: { value: 0.3 } };
    this.swayMaterial = this.material.clone();
    this.swayMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.sway);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSway;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 ip = instanceMatrix[3].xyz;
          float bend = pow(max(position.y, 0.0), 1.5) * 0.12 * (0.35 + uSway);
          transformed.x += sin(uTime * 1.4 + ip.x * 0.35 + ip.z * 0.2) * bend;
          transformed.z += cos(uTime * 1.1 + ip.z * 0.3) * bend * 0.6;`
        );
    };
    this.meshes = [];
    this.signature = null;
  }

  // Quality presets change how much scenery there is.
  setDensity(fill) {
    if (fill === this.fill) return;
    this.fill = fill;
    if (this.zones) this.rebuild(this.zones);
  }

  // Call with the current zones. Does nothing if the footprint (and density) is unchanged.
  rebuild(zones) {
    this.zones = zones;
    const tiles = Object.values(zones).flat().sort();
    const signature = tiles.join('|') + '@' + (this.fill ?? this.cfg.scatter.fill);
    if (signature === this.signature) return false;
    this.signature = signature;

    for (const m of this.meshes) {
      this.scene.remove(m);
      m.dispose();
    }
    this.meshes = [];

    const { tileSize } = this.cfg.plots;
    const { spacing, radius, plotMargin } = this.cfg.scatter;
    const fill = this.fill ?? this.cfg.scatter.fill;
    const centres = tiles.map((k) => toWorld(...parse(k), tileSize));
    const blocked = (x, z) => centres.some((c) => insideHex(x, z, c.x, c.z, tileSize + plotMargin));

    // Walk a jittered grid; each cell may get one piece of scenery.
    const placed = Object.fromEntries(Object.keys(this.kinds).map((k) => [k, []]));
    const kindNames = Object.keys(this.kinds);
    const n = Math.ceil(radius / spacing);
    for (let gx = -n; gx <= n; gx++) {
      for (let gz = -n; gz <= n; gz++) {
        const rng = seededRandom(hashString(`${gx},${gz}`));
        if (rng() > fill) continue;
        const x = (gx + rng() - 0.5) * spacing;
        const z = (gz + rng() - 0.5) * spacing;
        if (Math.hypot(x, z) > radius || blocked(x, z)) continue;
        let pick = rng(), kind = kindNames[0];
        for (const k of kindNames) {
          if ((pick -= this.kinds[k].share) <= 0) { kind = k; break; }
        }
        placed[kind].push({ x, z, rot: rng() * Math.PI * 2, s: rng(), tint: rng() });
      }
    }

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), tint = new THREE.Color();
    for (const [kind, list] of Object.entries(placed)) {
      if (!list.length) continue;
      const def = this.kinds[kind];
      const mesh = new THREE.InstancedMesh(def.geo, def.sway ? this.swayMaterial : this.material, list.length);
      list.forEach((it, i) => {
        const sc = THREE.MathUtils.lerp(def.scale[0], def.scale[1], it.s);
        p.set(it.x, heightAt(it.x, it.z) - 0.08, it.z); // sink slightly so slopes don't show a gap
        q.setFromAxisAngle(up, it.rot);
        s.set(sc, sc * (kind === 'rock' ? 0.7 : 1), sc);
        mesh.setMatrixAt(i, m.compose(p, q, s));
        mesh.setColorAt(i, tint.setScalar(0.88 + it.tint * 0.24)); // gentle variation
      });
      mesh.name = `scatter-${kind}`;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
    return true;
  }
}
