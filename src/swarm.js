import * as THREE from 'three';

/**
 * Swarm — a 3D cloud of glowing particles bound to a small set of
 * attractor points. Particles flow toward their home attractor under an
 * inverse-square pull, with damping and Brownian drift. Periodic
 * "viral events" pick a random attractor and shove every particle in a
 * sphere around it outward in a bright explosion.
 *
 * Resolve is the main slider. At resolve = 0 the swarm flows freely:
 * gravity, damping, drift, and the occasional event shape it. At
 * resolve = 1 every particle is locked onto a unique pre-baked orbit
 * around its home attractor, producing a clean shell of sweeping rings
 * (each particle traces its own great-circle on a small inscribed
 * sphere around its attractor). The slider lerps cleanly between the
 * two regimes — that's the chaos-to-order moment for a comp.
 *
 * Read the metaphor as content distribution: attractors are the
 * platforms, particles are pieces of audience flowing through, viral
 * events are the moments a clip catches and ripples through everyone
 * nearby. Brightness piles up additively, so dense moments feel like
 * spikes against a calm baseline.
 *
 * Rendering uses a single THREE.Points cloud with an additive-blended
 * radial-glow texture and per-vertex colors, plus a separate Points
 * cloud for the attractor markers (hollow rings).
 */

const MAX_PARTICLES  = 4096;
const MAX_ATTRACTORS = 16;

export const ATTRACTOR_LAYOUTS = ['single', 'pair', 'triangle', 'circle', 'cube', 'random'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Textures ---------------------------------------------------------

function buildGlowTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0,    'rgba(255,255,255,1.0)');
  g.addColorStop(0.4,  'rgba(255,255,255,0.45)');
  g.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

function buildRingTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 10, 0, Math.PI * 2);
  ctx.lineWidth   = 6;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// ---- Attractor layouts ------------------------------------------------

function attractorPositions(layout, count, spread, rand) {
  const out = [];
  if (layout === 'single' || count <= 1) return [{ x: 0, y: 0, z: 0 }];
  if (layout === 'pair') {
    return [{ x: -spread, y: 0, z: 0 }, { x: spread, y: 0, z: 0 }];
  }
  if (layout === 'triangle') {
    const r = spread;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
      out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, z: 0 });
    }
    return out;
  }
  if (layout === 'circle') {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      out.push({ x: Math.cos(a) * spread, y: Math.sin(a) * spread, z: 0 });
    }
    return out;
  }
  if (layout === 'cube') {
    const c = spread / Math.sqrt(3);
    for (const x of [-c, c]) for (const y of [-c, c]) for (const z of [-c, c]) {
      out.push({ x, y, z });
      if (out.length >= count) return out;
    }
    return out;
  }
  // random
  for (let i = 0; i < count; i++) {
    out.push({
      x: (rand() - 0.5) * spread * 2,
      y: (rand() - 0.5) * spread * 2,
      z: (rand() - 0.5) * spread * 2
    });
  }
  return out;
}

// ---- Field ------------------------------------------------------------

export class SwarmField {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    // Particles — additive glow.
    this.particleTex = buildGlowTexture();
    this.particleMat = new THREE.PointsMaterial({
      size:            0.18,
      map:             this.particleTex,
      transparent:     true,
      depthWrite:      false,
      blending:        THREE.AdditiveBlending,
      sizeAttenuation: true,
      vertexColors:    true,
      color:           0xffffff
    });
    this._posArr = new Float32Array(MAX_PARTICLES * 3);
    this._colArr = new Float32Array(MAX_PARTICLES * 3);
    this.particleGeom = new THREE.BufferGeometry();
    this.particleGeom.setAttribute('position', new THREE.BufferAttribute(this._posArr, 3));
    this.particleGeom.setAttribute('color',    new THREE.BufferAttribute(this._colArr, 3));
    this.particleGeom.attributes.position.usage = THREE.DynamicDrawUsage;
    this.particleGeom.attributes.color.usage    = THREE.DynamicDrawUsage;
    this.particleGeom.setDrawRange(0, 0);
    this.particles = new THREE.Points(this.particleGeom, this.particleMat);
    this.particles.frustumCulled = false;
    this.group.add(this.particles);

    // Attractors — hollow rings, rendered with regular alpha (not additive)
    // so they read as anchor points, not flares.
    this.attractorTex = buildRingTexture();
    this.attractorMat = new THREE.PointsMaterial({
      size:            0.55,
      map:             this.attractorTex,
      transparent:     true,
      depthWrite:      false,
      sizeAttenuation: true,
      color:           0xffffff,
      opacity:         0.6
    });
    this._attrPosArr = new Float32Array(MAX_ATTRACTORS * 3);
    this.attractorGeom = new THREE.BufferGeometry();
    this.attractorGeom.setAttribute('position', new THREE.BufferAttribute(this._attrPosArr, 3));
    this.attractorGeom.setDrawRange(0, 0);
    this.attractorPoints = new THREE.Points(this.attractorGeom, this.attractorMat);
    this.attractorPoints.frustumCulled = false;
    this.group.add(this.attractorPoints);

    // Per-particle simulation state.
    this._vel       = new Float32Array(MAX_PARTICLES * 3);
    this._bright    = new Float32Array(MAX_PARTICLES);
    this._home      = new Int32Array(MAX_PARTICLES);
    this._orbAngle  = new Float32Array(MAX_PARTICLES);
    this._orbRadius = new Float32Array(MAX_PARTICLES);
    this._orbTilt   = new Float32Array(MAX_PARTICLES);   // axis tilt for per-particle orbit plane
    this._orbSpeed  = new Float32Array(MAX_PARTICLES);   // signed: ±

    this.attractors    = [];
    this.particleCount = 0;
    this.params        = null;
    this.time          = 0;
    this._eventTimer   = 0;
  }

  _rebuild(params) {
    const rand = mulberry32(params.seed);

    // Attractors.
    this.attractors = attractorPositions(params.attractorLayout,
      params.attractorCount, params.attractorSpread, rand)
      .slice(0, MAX_ATTRACTORS);

    for (let i = 0; i < this.attractors.length; i++) {
      this._attrPosArr[i*3 + 0] = this.attractors[i].x;
      this._attrPosArr[i*3 + 1] = this.attractors[i].y;
      this._attrPosArr[i*3 + 2] = this.attractors[i].z;
    }
    this.attractorGeom.attributes.position.needsUpdate = true;
    this.attractorGeom.setDrawRange(0, this.attractors.length);

    // Particles.
    this.particleCount = Math.min(MAX_PARTICLES, Math.max(1, params.particleCount));
    for (let i = 0; i < this.particleCount; i++) {
      const homeIdx = i % this.attractors.length;
      this._home[i] = homeIdx;
      const home    = this.attractors[homeIdx];

      // Pre-baked orbital descriptor — used at resolve = 1.
      this._orbAngle[i]  = rand() * Math.PI * 2;
      this._orbRadius[i] = (0.4 + rand() * 0.8) * params.orbitRadius;
      this._orbTilt[i]   = (rand() - 0.5) * Math.PI;       // 0 = equatorial, ±π/2 = polar
      this._orbSpeed[i]  = (rand() < 0.5 ? -1 : 1) * (0.5 + rand());

      // Initial position: scatter randomly around home.
      const r     = (rand() * 0.4 + 0.6) * params.orbitRadius * 1.5;
      const theta = rand() * Math.PI * 2;
      const phi   = Math.acos(2 * rand() - 1);
      this._posArr[i*3 + 0] = home.x + r * Math.sin(phi) * Math.cos(theta);
      this._posArr[i*3 + 1] = home.y + r * Math.sin(phi) * Math.sin(theta);
      this._posArr[i*3 + 2] = home.z + r * Math.cos(phi);

      // Tangential initial velocity so particles want to orbit, not crash in.
      const vScale = 0.6;
      this._vel[i*3 + 0] = (rand() - 0.5) * vScale;
      this._vel[i*3 + 1] = (rand() - 0.5) * vScale;
      this._vel[i*3 + 2] = (rand() - 0.5) * vScale;

      this._bright[i] = rand() * 0.3;
    }
    this.particleGeom.setDrawRange(0, this.particleCount);
  }

  applyParams(params) {
    const structuralChange = !this.params ||
      this.params.seed             !== params.seed ||
      this.params.attractorLayout  !== params.attractorLayout ||
      this.params.attractorCount   !== params.attractorCount ||
      this.params.attractorSpread  !== params.attractorSpread ||
      this.params.particleCount    !== params.particleCount ||
      this.params.orbitRadius      !== params.orbitRadius;
    if (structuralChange) this._rebuild(params);
    this.params = { ...params };
  }

  // External viral event — explode particles outward from a random
  // attractor (or the closest one to the user's view, if extended).
  ignite() {
    if (this.attractors.length === 0) return;
    const idx = Math.floor(Math.random() * this.attractors.length);
    this._fireEvent(idx, this.params || {});
  }

  _fireEvent(attractorIdx, params) {
    const target = this.attractors[attractorIdx];
    const eR = params.eventRadius || 2.5;
    const eR2 = eR * eR;
    const force = params.eventForce || 6.0;
    for (let i = 0; i < this.particleCount; i++) {
      const dx = this._posArr[i*3 + 0] - target.x;
      const dy = this._posArr[i*3 + 1] - target.y;
      const dz = this._posArr[i*3 + 2] - target.z;
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 < eR2) {
        const d = Math.max(0.05, Math.sqrt(d2));
        const f = force * (1 - d / eR);   // strongest at center
        const inv = 1 / d;
        this._vel[i*3 + 0] += dx * inv * f;
        this._vel[i*3 + 1] += dy * inv * f;
        this._vel[i*3 + 2] += dz * inv * f;
        this._bright[i] = 1.0;
      }
    }
  }

  update(dt, params) {
    this.time += dt;

    // ---- Auto-fire viral events on a schedule -------------------------
    if (params.eventRate > 0) {
      this._eventTimer -= dt;
      if (this._eventTimer <= 0) {
        const idx = Math.floor(Math.random() * Math.max(1, this.attractors.length));
        this._fireEvent(idx, params);
        this._eventTimer = 1 / Math.max(0.05, params.eventRate);
      }
    }

    // ---- Per-particle physics + orbital lerp --------------------------
    const damping     = Math.pow(params.damping,         dt * 60);
    const decay       = Math.pow(params.brightnessDecay, dt * 60);
    const gravity     = params.gravity;
    const drift       = params.drift;
    const resolve     = params.resolve;
    const orbitSpeed  = params.orbitSpeed;
    const dim         = params.dimBaseline;
    const t           = this.time;

    const pos = this._posArr;
    const col = this._colArr;
    const vel = this._vel;

    for (let i = 0; i < this.particleCount; i++) {
      const home = this.attractors[this._home[i]];

      // Vector toward home and its squared length.
      const dx = home.x - pos[i*3 + 0];
      const dy = home.y - pos[i*3 + 1];
      const dz = home.z - pos[i*3 + 2];
      const d2 = dx*dx + dy*dy + dz*dz;
      const d  = Math.sqrt(d2);
      const invD = 1 / Math.max(0.4, d);
      // Inverse-square attraction, but softened at very close range so
      // particles don't shoot past at infinite speed.
      const F = gravity * invD * invD;

      vel[i*3 + 0] += dx * invD * F * dt;
      vel[i*3 + 1] += dy * invD * F * dt;
      vel[i*3 + 2] += dz * invD * F * dt;

      // Damping.
      vel[i*3 + 0] *= damping;
      vel[i*3 + 1] *= damping;
      vel[i*3 + 2] *= damping;

      // Brownian drift.
      if (drift > 0) {
        vel[i*3 + 0] += (Math.random() - 0.5) * drift;
        vel[i*3 + 1] += (Math.random() - 0.5) * drift;
        vel[i*3 + 2] += (Math.random() - 0.5) * drift;
      }

      // Physics-driven position.
      let px = pos[i*3 + 0] + vel[i*3 + 0] * dt;
      let py = pos[i*3 + 1] + vel[i*3 + 1] * dt;
      let pz = pos[i*3 + 2] + vel[i*3 + 2] * dt;

      // Resolved-state position: pre-baked orbit around home attractor.
      // The orbit lives in a plane tilted off equatorial by `_orbTilt[i]`,
      // rotates at `_orbSpeed[i] * orbitSpeed`, and has a per-particle radius.
      if (resolve > 0) {
        const r     = this._orbRadius[i];
        const angle = this._orbAngle[i] + t * orbitSpeed * this._orbSpeed[i];
        const tilt  = this._orbTilt[i];
        const c = Math.cos(angle), s = Math.sin(angle);
        const cT = Math.cos(tilt), sT = Math.sin(tilt);
        // Orbit point around home in tilted plane.
        const ox = home.x + c * r;
        const oy = home.y + s * r * cT;
        const oz = home.z + s * r * sT;

        px = px + (ox - px) * resolve;
        py = py + (oy - py) * resolve;
        pz = pz + (oz - pz) * resolve;

        // At high resolve, bleed off velocity so the chaotic state doesn't
        // accumulate forever underneath the orbit lerp.
        if (resolve > 0.6) {
          const k = 1 - (resolve - 0.6) * 1.2;
          vel[i*3 + 0] *= k;
          vel[i*3 + 1] *= k;
          vel[i*3 + 2] *= k;
        }
      }

      pos[i*3 + 0] = px;
      pos[i*3 + 1] = py;
      pos[i*3 + 2] = pz;

      // Brightness decay + write color.
      this._bright[i] *= decay;
      const b = dim + (1 - dim) * this._bright[i];
      col[i*3 + 0] = b;
      col[i*3 + 1] = b;
      col[i*3 + 2] = b;
    }

    this.particleGeom.attributes.position.needsUpdate = true;
    this.particleGeom.attributes.color.needsUpdate    = true;

    this.particleMat.size    = params.particleSize;
    this.particleMat.color.set(params.color);
    this.attractorMat.size   = params.attractorSize;
    this.attractorMat.color.set(params.color);
    this.attractorPoints.visible = params.showAttractors;
  }
}
