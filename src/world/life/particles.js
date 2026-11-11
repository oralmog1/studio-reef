import * as THREE from 'three';

// Shared point-sprite material. ring = true draws hollow bubbles,
// ring = false draws soft dots.
export function pointsMaterial(ring) {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 500 }, uRing: { value: ring ? 1 : 0 } },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute float alpha;
      attribute vec3 tint;
      uniform float uScale;
      varying float vAlpha;
      varying vec3 vTint;
      void main() {
        vAlpha = alpha;
        vTint = tint;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = size * uScale / -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uRing;
      varying float vAlpha;
      varying vec3 vTint;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float soft = 1.0 - smoothstep(0.4, 1.0, d);
        float ring = smoothstep(0.55, 0.85, d) * (1.0 - smoothstep(0.88, 1.0, d)) + 0.2 * (1.0 - d);
        gl_FragColor = vec4(vTint, mix(soft, min(1.0, ring * 1.5), uRing) * vAlpha);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
}

// Keeps point sizes correct for the current screen size and camera.
export function updatePointScale(material, renderer, camera) {
  material.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
}

// A pool of short-lived rising particles (bubbles and celebration sparkles).
// Fixed size: when full, the oldest particle is reused.
export class Particles {
  constructor(scene, max, ring) {
    this.max = max;
    this.next = 0;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.tint = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max); // 0 = dead
    this.baseSize = new Float32Array(max);
    this.material = pointsMaterial(ring);
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, color, size) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.tint.set([color.r, color.g, color.b], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    this.alive = true;
    this.baseSize[i] = size;
  }

  update(dt, t) {
    if (!this.alive) return; // nothing to do (common when nothing is working)
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (!this.life[i]) continue;
      const a = (this.age[i] += dt);
      if (a >= this.life[i]) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        continue;
      }
      any = true;
      const k = a / this.life[i];
      const j = i * 3;
      this.vel[j + 1] += (0.9 - this.vel[j + 1]) * dt * 0.8; // drift toward a gentle rise
      this.vel[j] *= 1 - dt * 1.2;
      this.vel[j + 2] *= 1 - dt * 1.2;
      this.pos[j] += (this.vel[j] + Math.sin(t * 3 + i) * 0.12) * dt; // wobble
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.alpha[i] = Math.min(1, k * 8) * (1 - k); // quick fade in, slow fade out
      this.size[i] = this.baseSize[i] * (0.7 + 0.5 * k);
    }
    for (const n of ['position', 'size', 'alpha', 'tint']) this.geo.attributes[n].needsUpdate = true;
    this.alive = any;
  }
}
