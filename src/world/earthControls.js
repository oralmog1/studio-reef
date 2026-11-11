import * as THREE from 'three';

// Google Earth-style camera.
//   Left-drag      grab the ground: the point you clicked stays under the cursor
//   Wheel / pinch  zoom toward whatever is under the cursor
//   Right-drag     (or Shift + left-drag) rotate and tilt around the screen centre
//
// It can also fly to a point (flyTo) and keep a moving thing centred
// (follow). Grabbing the ground cancels both; rotating and zooming don't.
//
// Internally the camera is described by a ground point it looks at ("target"),
// a distance from it, a yaw (compass direction) and a pitch (tilt).

const DEG = Math.PI / 180;

export class EarthControls {
  constructor(camera, dom, cfg, worldRadius, groundY = 0) {
    this.camera = camera;
    this.dom = dom;
    this.cfg = cfg;
    this.worldRadius = worldRadius;
    // The imaginary sheet you grab and zoom against: plot height, so the
    // plots themselves stay glued to the cursor.
    this.groundY = groundY;
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY);

    this.target = new THREE.Vector3();
    this.distance = cfg.startDistance;
    this.yaw = cfg.startYawDeg * DEG;
    this.pitch = cfg.startPitchDeg * DEG;

    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._grab = null; // ground point held during a left-drag
    this._rotating = false;
    this._last = { x: 0, y: 0 };
    this._fly = null; // { from, toD, t, dur, to }
    this._follow = null; // () => {x, z} | null
    this.orbit = 0; // radians per second of slow automatic circling (photo mode)
    this.pitchGoal = null; // ease the tilt toward this (radians), then stop

    dom.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    dom.addEventListener('wheel', this._onWheel, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    this.update();
  }

  // Put the camera where target/distance/yaw/pitch say it should be.
  update() {
    const c = this.cfg;
    this.distance = THREE.MathUtils.clamp(this.distance, c.minDistance, c.maxDistance);
    this.pitch = THREE.MathUtils.clamp(this.pitch, c.minPitchDeg * DEG, c.maxPitchDeg * DEG);
    // keep the look-at point on the map
    const r = Math.hypot(this.target.x, this.target.z);
    if (r > this.worldRadius) this.target.multiplyScalar(this.worldRadius / r);
    this.target.y = this.groundY;

    const horiz = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horiz,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * horiz
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  // Where does the ray under screen pixel (x, y) hit the ground?
  groundAt(clientX, clientY, out = new THREE.Vector3()) {
    const rect = this.dom.getBoundingClientRect();
    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this._ray.setFromCamera(this._ndc, this.camera);
    return this._ray.ray.intersectPlane(this.ground, out);
  }

  get following() {
    return !!this._follow;
  }

  // Glide to a ground point (x, z), ending at `distance` from it.
  flyTo(x, z, distance = this.distance, duration = 1.1) {
    this._fly = { from: { x: this.target.x, z: this.target.z, d: this.distance }, to: { x, z }, toD: distance, t: 0, dur: duration };
  }

  // Keep whatever `getPoint()` returns in the middle of the screen.
  follow(getPoint) {
    this._follow = getPoint;
  }

  stopAuto() {
    this._fly = null;
    this._follow = null;
  }

  // Call every frame.
  tick(dt) {
    if (this.orbit || this.pitchGoal !== null) {
      this.yaw += this.orbit * dt;
      if (this.pitchGoal !== null) {
        this.pitch += (this.pitchGoal - this.pitch) * (1 - Math.exp(-dt * 1.5));
        if (Math.abs(this.pitchGoal - this.pitch) < 0.002) this.pitchGoal = null;
      }
      this.update();
    }
    if (this._fly) {
      const f = this._fly;
      f.t = Math.min(1, f.t + dt / f.dur);
      const k = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2; // ease in-out
      const to = this._follow?.() ?? f.to; // chase a moving target while flying
      this.target.x = THREE.MathUtils.lerp(f.from.x, to.x, k);
      this.target.z = THREE.MathUtils.lerp(f.from.z, to.z, k);
      this.distance = THREE.MathUtils.lerp(f.from.d, f.toD, k);
      if (f.t >= 1) this._fly = null;
      this.update();
    } else if (this._follow) {
      const p = this._follow();
      if (!p) return;
      const k = 1 - Math.exp(-dt * 5);
      this.target.x += (p.x - this.target.x) * k;
      this.target.z += (p.z - this.target.z) * k;
      this.update();
    }
  }

  _onDown = (e) => {
    this._last = { x: e.clientX, y: e.clientY };
    this._downAt = { x: e.clientX, y: e.clientY };
    if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
      this._rotating = true;
    } else if (e.button === 0) {
      this._grab = this.groundAt(e.clientX, e.clientY);
    }
    if (this._rotating || this._grab) this.dom.style.cursor = 'grabbing';
  };

  _onMove = (e) => {
    if (this._rotating) {
      const dx = e.clientX - this._last.x;
      const dy = e.clientY - this._last.y;
      this.yaw -= dx * this.cfg.rotateSpeed;
      this.pitch += dy * this.cfg.rotateSpeed;
      this.update();
    } else if (this._grab) {
      // Slide the camera so the grabbed ground point sits under the cursor again.
      const now = this.groundAt(e.clientX, e.clientY);
      if (now) {
        // a real drag (not a click's wobble) means you took over: stop flying/following
        if (Math.hypot(e.clientX - this._downAt.x, e.clientY - this._downAt.y) > 5) this.stopAuto();
        this.target.add(this._grab.clone().sub(now));
        this.update();
      }
    }
    this._last = { x: e.clientX, y: e.clientY };
  };

  _onUp = () => {
    this._grab = null;
    this._rotating = false;
    this.dom.style.cursor = '';
  };

  _onWheel = (e) => {
    e.preventDefault();
    // Trackpad pinch arrives as wheel + ctrlKey with small deltas; boost it.
    const delta = e.deltaY * (e.ctrlKey ? 8 : 1) * (e.deltaMode === 1 ? 16 : 1);
    const hit = this.groundAt(e.clientX, e.clientY);
    const before = this.distance;
    this.distance = THREE.MathUtils.clamp(
      before * Math.exp(delta * this.cfg.zoomSpeed),
      this.cfg.minDistance,
      this.cfg.maxDistance
    );
    // Scale the target toward the cursor point by the same ratio, so the
    // ground under the cursor stays put while everything else zooms.
    this._fly = null;
    if (hit && !this._follow) {
      const k = this.distance / before;
      this.target.sub(hit).multiplyScalar(k).add(hit);
    }
    this.update();
  };
}
