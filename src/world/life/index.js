import { Particles, updatePointScale } from './particles.js';
import { Ambience } from './ambience.js';
import { Traffic } from './traffic.js';
import { Events, compareWithLastVisit } from './events.js';

// Everything that makes the world feel alive, in one place.
export class Life {
  constructor({ scene, cfg, plotTop, inhabitants, scatter, now }) {
    this.scatter = scatter;
    this.particles = new Particles(scene, cfg.life.maxParticles, true);
    this.ambience = new Ambience(scene, cfg);
    this.traffic = new Traffic(scene, cfg);
    this.events = new Events({ list: inhabitants.list, particles: this.particles, cfg, plotTop });
    const replay = new URLSearchParams(location.search).has('replay');
    this.events.start(compareWithLastVisit(inhabitants.list, replay), now);
  }

  update(t, dt, camera, renderer) {
    this.events.update(t, dt);
    this.particles.update(dt, t);
    this.ambience.update(t, dt);
    this.traffic.update(t, this.ambience.strength);
    this.scatter.sway.uTime.value = t;
    this.scatter.sway.uSway.value = this.ambience.strength;
    updatePointScale(this.particles.material, renderer, camera);
    updatePointScale(this.ambience.material, renderer, camera);
  }
}
