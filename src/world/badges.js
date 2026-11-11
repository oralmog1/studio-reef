import * as THREE from 'three';

// Badges float over a fish ONLY when it needs attention or deserves it:
//   waiting → "!" (needs you)      done → "✓" (shipped)
// Every other state is silent. Badges are part of the 3D scene, so they
// show up in screenshots, and they keep the same size on screen at any zoom.

const GLYPH = { waiting: '!', done: '✓' };

function badgeTexture(color, glyph) {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.beginPath();
  g.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `bold ${glyph === '!' ? 78 : 66}px system-ui, -apple-system, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, size / 2, size / 2 + 5);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Badges {
  constructor(scene, cfg, plotTop) {
    this.cfg = cfg;
    this.plotTop = plotTop;
    this.group = new THREE.Group();
    this.group.name = 'badges';
    scene.add(this.group);
    this.materials = Object.fromEntries(
      Object.entries(GLYPH).map(([state, glyph]) => [
        state,
        new THREE.SpriteMaterial({
          map: badgeTexture(cfg.stateColors[state], glyph),
          sizeAttenuation: false, // constant size on screen
          depthTest: false, // never hidden behind a plot
          transparent: true,
        }),
      ])
    );
    this.items = [];
  }

  build(list) {
    this.group.clear();
    this.items = list
      .filter((e) => GLYPH[e.state])
      .map((e) => {
        const sprite = new THREE.Sprite(this.materials[e.state]);
        sprite.scale.setScalar(this.cfg.badges.size);
        sprite.renderOrder = 10;
        this.group.add(sprite);
        return { e, sprite };
      });
  }

  update(t) {
    const h = this.plotTop + this.cfg.badges.height;
    for (const { e, sprite } of this.items) {
      sprite.visible = !e.arriving; // no badge until it has landed
      sprite.position.set(e.px, h + Math.sin(t * 2 + e.phase) * 0.1, e.pz);
    }
  }
}
