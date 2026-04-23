import * as THREE from 'three';
import { LineSegments2 }        from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

/**
 * Ripple — concentric circles emitted from a small set of source points,
 * expanding outward and fading as they age. Read it as content reaching
 * audiences: each clip is a stone dropped in the pond, the rings are
 * its reach.
 *
 * One LineSegments2 mesh holds every active ring. Per-vertex colors
 * tint each ring's brightness from `dimBaseline` toward white as a
 * function of its age, so older rings dim out cleanly.
 *
 * The whole sim is two ideas:
 *   - Sources emit a ring every (1 / emissionRate) seconds.
 *   - A ring's radius = age × waveSpeed, brightness fades from 1 → 0
 *     across `maxAge` according to `fadeStyle`.
 *
 * That's it. Layouts, phase modes, and the resolve slider modulate the
 * static parts (where sources sit, when they fire, how scattered they
 * are) without touching the core mechanic.
 */

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const SOURCE_LAYOUTS = ['single', 'random', 'grid', 'circle', 'phyllotaxis'];
export const PHASE_MODES    = ['sync', 'stagger', 'random'];
export const FADE_STYLES    = ['linear', 'quadratic', 'exponential'];

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

// Source positions for a layout. Single is always one origin point;
// other layouts span `spread` (distance from origin to outermost source).
function layoutPositions(layout, count, spread, rand) {
  if (layout === 'single' || count <= 1) return [[0, 0]];
  const out = [];
  if (layout === 'random') {
    for (let i = 0; i < count; i++) {
      out.push([(rand() - 0.5) * spread * 2, (rand() - 0.5) * spread * 2]);
    }
  } else if (layout === 'grid') {
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
    const rows = Math.max(1, Math.ceil(count / cols));
    const stepX = (cols > 1) ? (spread * 2) / (cols - 1) : 0;
    const stepY = (rows > 1) ? (spread * 2) / (rows - 1) : 0;
    for (let i = 0; i < count; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      out.push([
        (cols > 1 ? -spread + c * stepX : 0),
        (rows > 1 ? -spread + r * stepY : 0)
      ]);
    }
  } else if (layout === 'circle') {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      out.push([Math.cos(a) * spread, Math.sin(a) * spread]);
    }
  } else if (layout === 'phyllotaxis') {
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt((i + 0.5) / count) * spread;
      const a = i * GOLDEN_ANGLE;
      out.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  return out;
}

class Source {
  constructor(idx, x, y, jitterX, jitterY) {
    this.idx           = idx;
    this.basePos       = { x, y };
    this.jitter        = { x: jitterX, y: jitterY };
    this.emissionTimer = 0;     // negative offsets stagger the first emission
  }
}

export class RippleField {
  constructor(scene, lineMaterial) {
    this.scene        = scene;
    this.lineMaterial = lineMaterial;

    // Per-vertex tinting so rings can fade independently.
    this.lineMaterial.vertexColors = true;
    this.lineMaterial.needsUpdate  = true;

    this.group = new THREE.Group();
    scene.add(this.group);

    this.lineGeom = new LineSegmentsGeometry();
    this.lineGeom.setPositions(new Float32Array(6));
    this.lineGeom.setColors(new Float32Array(6));
    this.lineMesh = new LineSegments2(this.lineGeom, this.lineMaterial);
    this.lineMesh.frustumCulled = false;
    this.group.add(this.lineMesh);

    this.sources = [];
    this.rings   = [];      // { sourceIdx, age }
    this.params  = null;
    this.time    = 0;

    this._posBuf = new Float32Array(0);
    this._colBuf = new Float32Array(0);
  }

  _rebuild(params) {
    const rand      = mulberry32(params.seed);
    const positions = layoutPositions(params.sourceLayout, params.sourceCount,
                                      params.sourceSpread, rand);

    this.sources = positions.map((p, i) => {
      const jx = (rand() - 0.5) * 1.4;
      const jy = (rand() - 0.5) * 1.4;
      const s  = new Source(i, p[0], p[1], jx, jy);

      // Phase the first emission so sources don't all fire on frame 0.
      const period = 1 / Math.max(0.01, params.emissionRate);
      let phase = 0;
      if (params.phaseMode === 'stagger') phase = i / Math.max(1, positions.length);
      else if (params.phaseMode === 'random') phase = rand();
      // Negative timer means "next emission is in (period × phase) seconds".
      s.emissionTimer = -phase * period;
      return s;
    });

    this.rings = [];
  }

  applyParams(params) {
    const structuralChange = !this.params ||
      this.params.seed         !== params.seed ||
      this.params.sourceLayout !== params.sourceLayout ||
      this.params.sourceCount  !== params.sourceCount ||
      this.params.sourceSpread !== params.sourceSpread ||
      this.params.phaseMode    !== params.phaseMode ||
      this.params.emissionRate !== params.emissionRate;
    if (structuralChange) this._rebuild(params);
    this.params = { ...params };
  }

  // External trigger — drop a manual ring at every source right now.
  drop() {
    for (const s of this.sources) this.rings.push({ sourceIdx: s.idx, age: 0 });
  }

  update(dt, params) {
    this.time += dt;
    const period = 1 / Math.max(0.01, params.emissionRate);

    // 1. Emission tick.
    for (const s of this.sources) {
      s.emissionTimer += dt;
      // Use while in case dt > period (pause + resume).
      while (s.emissionTimer >= period) {
        s.emissionTimer -= period;
        this.rings.push({ sourceIdx: s.idx, age: 0 });
      }
    }

    // 2. Age + drop dead rings (in-place compaction).
    const maxAge = Math.max(0.1, params.maxAge);
    let write = 0;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      r.age += dt;
      if (r.age <= maxAge) this.rings[write++] = r;
    }
    this.rings.length = write;

    // 3. Build geometry — segments approximating each ring as a polygon.
    const segs       = Math.max(8, Math.round(params.segments));
    const ringCount  = this.rings.length;
    const totalEdges = ringCount * segs;
    const need       = totalEdges * 6;

    if (this._posBuf.length < need) {
      // Grow with margin so we don't reallocate every frame.
      const grown = Math.max(need, Math.ceil(this._posBuf.length * 1.5));
      this._posBuf = new Float32Array(grown);
      this._colBuf = new Float32Array(grown);
    }

    const pos = this._posBuf, col = this._colBuf;
    let cursor = 0;

    const chaos       = (1 - params.resolve) * params.chaosJitter;
    const dim         = params.dimBaseline;
    const opacity     = params.opacity;
    const fadeStyle   = params.fadeStyle;
    const waveSpeed   = params.waveSpeed;

    for (let r = 0; r < ringCount; r++) {
      const ring = this.rings[r];
      const src  = this.sources[ring.sourceIdx];
      const cx   = src.basePos.x + src.jitter.x * chaos;
      const cy   = src.basePos.y + src.jitter.y * chaos;
      const radius = ring.age * waveSpeed;

      // Brightness fades 1 → 0 over the ring's lifetime, shaped by fadeStyle.
      const t = ring.age / maxAge;
      let fade;
      if (fadeStyle === 'quadratic')        fade = (1 - t) * (1 - t);
      else if (fadeStyle === 'exponential') fade = Math.exp(-3 * t);
      else /* linear */                     fade = 1 - t;
      const v = (dim + (1 - dim) * fade) * opacity;

      // Walk the polygon. Reuse the previous endpoint as next segment's start.
      const dAng = (Math.PI * 2) / segs;
      let prevX  = cx + radius;
      let prevY  = cy;
      for (let i = 1; i <= segs; i++) {
        const a = i * dAng;
        const nx = cx + Math.cos(a) * radius;
        const ny = cy + Math.sin(a) * radius;
        pos[cursor + 0] = prevX; pos[cursor + 1] = prevY; pos[cursor + 2] = 0;
        pos[cursor + 3] = nx;    pos[cursor + 4] = ny;    pos[cursor + 5] = 0;
        col[cursor + 0] = v; col[cursor + 1] = v; col[cursor + 2] = v;
        col[cursor + 3] = v; col[cursor + 4] = v; col[cursor + 5] = v;
        cursor += 6;
        prevX = nx; prevY = ny;
      }
    }

    this.lineGeom.setPositions(pos.subarray(0, cursor));
    this.lineGeom.setColors(col.subarray(0, cursor));

    this.lineMaterial.linewidth = params.lineWidth;
    this.lineMaterial.opacity   = 1;     // we tint via vertex colors
  }
}
