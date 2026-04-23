import * as THREE from 'three';
import { LineSegments2 }        from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

/**
 * Viral — a field of short-form-clip cells (vertical 9:16 rectangles by
 * default) where engagement spreads cell-to-cell through a stochastic
 * SIR-ish infection process.
 *
 * Each cell carries an activation ∈ [0, 1] that decays exponentially.
 * Once a cell's activation crosses `broadcastThreshold`, every frame it
 * rolls dice against each neighbour and may push its own activation up
 * that neighbour's activation (capped at 1). Successful infections spawn
 * a travelling pulse from infector center → infected center.
 *
 * A subset of cells can be marked as "super-spreaders" — they transmit
 * with boosted probability/strength, so they effectively act as hubs
 * that fan out spreading events. Visible via a nested inner border.
 *
 * Firing modes drive the stream of ignitions:
 *   'steady'     — every frame, a small Poisson number of random cells
 *                  self-ignite. Looks like steady content posting.
 *   'outbreak'   — one (or a few) sources fire on a schedule; everything
 *                  in between cascades via transmission. Reads as one
 *                  clip going viral, then the next.
 *   'burst'      — every `wavePeriod`, every cell fires simultaneously.
 *   'endemic'    — steady background + periodic outbreak injections.
 *                  Feels like a real feed: always moving, occasional
 *                  spikes.
 *   'idle'       — no auto-firing; user triggers with spacebar.
 *
 * Rendering
 *   Each cell is four line segments. All cells share one LineSegments2
 *   mesh with vertex colors, so per-cell brightness is expressed via
 *   the color attribute (tint the four segments of that cell from
 *   `dimColor` to full white as activation rises). Optional inner
 *   border: an extra inset rectangle per cell. Super-spreaders always
 *   get the inner border regardless of the global toggle.
 *
 *   Transmission pulses are additive-blended THREE.Points that ride
 *   each infection event from infector to infected over ~0.25 s.
 *
 * Counters
 *   `totalViews`  cumulative activation gained across all cells ever;
 *                 scales like a view counter ticking up.
 *   `activeCount` cells currently above a small "viewing" threshold.
 *   `peakActive`  the largest activeCount observed in this session.
 */

export const LAYOUTS     = ['grid', 'brick', 'hex', 'scatter'];
export const NEIGHBOURS  = ['4', '8', 'radius'];
export const FIRE_MODES  = ['steady', 'outbreak', 'burst', 'endemic', 'idle'];

const MAX_PULSES = 4000;

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

function buildPulseTexture() {
  const s = 96;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0,    'rgba(255,255,255,1.0)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// ---------- Layout ------------------------------------------------------

function computeCellCenters(params, rand) {
  const cols = params.cols, rows = params.rows;
  const cellW = params.cellScale * params.cellAspect;
  const cellH = params.cellScale;
  const padX  = params.cellPadding * cellW;
  const padY  = params.cellPadding * cellH;
  const stepX = cellW + padX;
  const stepY = cellH + padY;

  const offsetX = -((cols - 1) * stepX) * 0.5;
  const offsetY = -((rows - 1) * stepY) * 0.5;

  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let x = offsetX + c * stepX;
      let y = offsetY + r * stepY;

      if (params.layout === 'brick' && (r & 1)) x += stepX * 0.5;
      if (params.layout === 'hex')   x += (r & 1) ? stepX * 0.5 : 0;
      // Scatter layout is implemented as per-cell baked jitter the
      // same way as the rest of the suite (chaos → resolve).

      out.push({
        col: c, row: r,
        cx: x, cy: y,
        w: cellW, h: cellH,
        jitter: new THREE.Vector2(
          (rand() - 0.5) * stepX * 1.4,
          (rand() - 0.5) * stepY * 1.4
        ),
        superSpreader: false
      });
    }
  }
  return out;
}

// ---------- Neighbour topology -----------------------------------------

function computeNeighbours(cells, params) {
  const n = cells.length;
  const byRC = new Map();
  for (let i = 0; i < n; i++) byRC.set(cells[i].row * 100000 + cells[i].col, i);
  const lookup = (r, c) => byRC.get(r * 100000 + c);

  const neighbours = Array.from({ length: n }, () => []);
  const mode = params.neighbourMode;

  if (mode === '4' || mode === '8') {
    const offsets = mode === '8'
      ? [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]
      : [[0,-1],[-1,0],[1,0],[0,1]];
    for (let i = 0; i < n; i++) {
      const { col, row } = cells[i];
      for (const [dc, dr] of offsets) {
        const j = lookup(row + dr, col + dc);
        if (j !== undefined) neighbours[i].push(j);
      }
    }
  } else {
    // 'radius' mode: every cell within `transmissionRadius` cell-steps.
    const rad = params.transmissionRadius;
    const rad2 = rad * rad;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = cells[i].col - cells[j].col;
        const dy = cells[i].row - cells[j].row;
        if (dx*dx + dy*dy <= rad2) neighbours[i].push(j);
      }
    }
  }
  return neighbours;
}

// ---------- Super spreader selection -----------------------------------

function markSuperSpreaders(cells, ratio, rand) {
  for (const c of cells) c.superSpreader = false;
  const count = Math.max(0, Math.min(cells.length, Math.floor(cells.length * ratio)));
  const indices = cells.map((_, i) => i);
  // Fisher–Yates shuffle, take first `count` indices.
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = indices[i]; indices[i] = indices[j]; indices[j] = t;
  }
  for (let i = 0; i < count; i++) cells[indices[i]].superSpreader = true;
}

// ---------- Field ------------------------------------------------------

export class ViralField {
  constructor(scene, lineMaterial) {
    this.scene        = scene;
    this.lineMaterial = lineMaterial;
    this.group        = new THREE.Group();
    scene.add(this.group);

    // Enable vertex colors on the shared line material so each cell
    // can glow independently.
    this.lineMaterial.vertexColors = true;
    this.lineMaterial.needsUpdate  = true;

    this.lineGeom = new LineSegmentsGeometry();
    this.lineGeom.setPositions(new Float32Array(6));
    this.lineGeom.setColors(new Float32Array(6));
    this.lineMesh = new LineSegments2(this.lineGeom, this.lineMaterial);
    this.lineMesh.frustumCulled = false;
    this.group.add(this.lineMesh);

    // Transmission pulses.
    this.pulseTex      = buildPulseTexture();
    this.pulseMaterial = new THREE.PointsMaterial({
      size:            0.13,
      map:             this.pulseTex,
      transparent:     true,
      depthWrite:      false,
      blending:        THREE.AdditiveBlending,
      sizeAttenuation: true,
      color:           0xffffff
    });
    this.pulseGeom      = new THREE.BufferGeometry();
    this.pulsePositions = new Float32Array(MAX_PULSES * 3);
    this.pulseGeom.setAttribute('position',
      new THREE.BufferAttribute(this.pulsePositions, 3));
    this.pulseGeom.setDrawRange(0, 0);
    this.pulsePoints = new THREE.Points(this.pulseGeom, this.pulseMaterial);
    this.pulsePoints.frustumCulled = false;
    this.group.add(this.pulsePoints);

    this.cells       = [];
    this.neighbours  = [];
    this.activation  = new Float32Array(0);
    this.pulses      = [];   // { srcIdx, dstIdx, progress, speed }
    this.params      = null;

    // Counter state — exposed via `stats` object for the UI to read.
    this.stats = {
      totalViews:  0,
      activeCount: 0,
      peakActive:  0
    };

    this._nextOutbreak = 0;
    this._nextBurst    = 0;
    this.time          = 0;

    // Preallocated buffers, resized on rebuild.
    this._posBuf   = new Float32Array(0);
    this._colBuf   = new Float32Array(0);
    this._segsPerCell = 4;   // single border
  }

  _rebuild(params) {
    const rand = mulberry32(params.seed);
    this.cells      = computeCellCenters(params, rand);
    this.neighbours = computeNeighbours(this.cells, params);
    markSuperSpreaders(this.cells, params.superSpreaderRatio, rand);

    const n = this.cells.length;
    this.activation = new Float32Array(n);
    this.pulses.length = 0;
    this._nextOutbreak = 0;
    this._nextBurst    = 0;

    // Decide how many segments per cell — single border (4) or double (8).
    const doubleBorder = params.innerBorder || params.superSpreaderRatio > 0;
    this._segsPerCell = doubleBorder ? 8 : 4;

    const maxSegs = n * this._segsPerCell;
    this._posBuf = new Float32Array(maxSegs * 6);
    this._colBuf = new Float32Array(maxSegs * 6);

    this.stats.peakActive = 0;  // reset peak on structural change
  }

  applyParams(params) {
    const structuralChange = !this.params ||
      this.params.seed            !== params.seed ||
      this.params.cols            !== params.cols ||
      this.params.rows            !== params.rows ||
      this.params.layout          !== params.layout ||
      this.params.cellAspect      !== params.cellAspect ||
      this.params.cellScale       !== params.cellScale ||
      this.params.cellPadding     !== params.cellPadding ||
      this.params.neighbourMode   !== params.neighbourMode ||
      this.params.transmissionRadius !== params.transmissionRadius ||
      this.params.superSpreaderRatio !== params.superSpreaderRatio ||
      this.params.innerBorder     !== params.innerBorder;
    if (structuralChange) this._rebuild(params);
    this.params = { ...params };
  }

  resetView() {
    this.stats.totalViews  = 0;
    this.stats.peakActive  = 0;
  }

  // External ignition hooks — bound to buttons and hotkeys.
  ignite(count = 1) {
    for (let k = 0; k < count; k++) {
      const i = (Math.random() * this.cells.length) | 0;
      if (this.activation[i] < 1) this.activation[i] = 1;
    }
  }
  igniteAll() {
    for (let i = 0; i < this.activation.length; i++) this.activation[i] = 1;
  }

  update(dt, params) {
    this.time += dt;
    const n = this.cells.length;
    if (n === 0) return;

    const decay = Math.pow(params.decayRate, dt * 60);
    const threshold = params.broadcastThreshold;
    const probBase  = params.transmissionProb;
    const probSS    = probBase * params.superSpreaderBoost;
    const strengthBase = params.infectionStrength;
    const strengthSS   = strengthBase * params.superSpreaderBoost;

    // ---- 1. Auto-firing -------------------------------------------
    const mode = params.fireMode;
    if (mode === 'steady' || mode === 'endemic') {
      // Poisson-ish background.
      const rate = params.backgroundRate;
      const lambda = rate * dt;
      let k = Math.floor(lambda);
      if (Math.random() < lambda - k) k++;
      for (let i = 0; i < k; i++) this.ignite(1);
    }
    if (mode === 'outbreak' || mode === 'endemic') {
      if (this.time >= this._nextOutbreak) {
        const sources = Math.max(1, Math.round(params.outbreakSources));
        this.ignite(sources);
        this._nextOutbreak = this.time + Math.max(0.5, params.outbreakPeriod);
      }
    }
    if (mode === 'burst') {
      if (this.time >= this._nextBurst) {
        this.igniteAll();
        this._nextBurst = this.time + Math.max(0.3, params.outbreakPeriod);
      }
    }

    // ---- 2. Transmission ------------------------------------------
    // Snapshot activations before transmission so infections in this
    // frame don't immediately re-broadcast (prevents instant blanket).
    const prev = Float32Array.from(this.activation);
    let totalGained = 0;

    // Cap new pulses per frame so very dense grids don't balloon memory.
    const pulseBudget = Math.max(0, MAX_PULSES - this.pulses.length);
    let pulsesSpawnedThisFrame = 0;

    for (let i = 0; i < n; i++) {
      if (prev[i] < threshold) continue;
      const iBoost = this.cells[i].superSpreader ? probSS    : probBase;
      const iStr   = this.cells[i].superSpreader ? strengthSS: strengthBase;
      // Probability scales with dt and current activation of the source.
      const p = 1 - Math.pow(1 - iBoost * prev[i], dt * 60);
      const neigh = this.neighbours[i];
      for (let nb = 0; nb < neigh.length; nb++) {
        const j = neigh[nb];
        if (Math.random() >= p) continue;
        const before = this.activation[j];
        const after  = Math.min(1, before + iStr);
        if (after > before) {
          this.activation[j] = after;
          totalGained += (after - before);
          if (pulsesSpawnedThisFrame < pulseBudget) {
            this.pulses.push({ srcIdx: i, dstIdx: j, progress: 0, speed: 4.0 });
            pulsesSpawnedThisFrame++;
          }
        }
      }
    }

    // ---- 3. Decay ------------------------------------------------
    let active = 0;
    for (let i = 0; i < n; i++) {
      this.activation[i] *= decay;
      if (this.activation[i] < 0.002) this.activation[i] = 0;
      if (this.activation[i] > 0.12) active++;
    }
    this.stats.activeCount = active;
    if (active > this.stats.peakActive) this.stats.peakActive = active;

    // Views: scale gained activation to an insane-looking number, like
    // real views on a clip. Each frame the counter leaps forward.
    this.stats.totalViews += totalGained * params.viewsPerFire;

    // ---- 4. Geometry emit (borders with per-cell vertex colors) ---
    const resolve     = params.resolve;
    const chaos       = (1 - resolve) * params.chaosJitter;
    const innerScaleW = Math.max(0, 1 - params.innerBorderGap * 2);
    const innerScaleH = innerScaleW;   // uniform inset, simpler to read
    const dim         = params.dimBaseline;
    const doubleAny   = params.innerBorder;
    const pos = this._posBuf, col = this._colBuf;
    let cursor = 0;

    for (let i = 0; i < n; i++) {
      const cell = this.cells[i];
      const x = cell.cx + cell.jitter.x * chaos;
      const y = cell.cy + cell.jitter.y * chaos;
      const w = cell.w;
      const h = cell.h;

      // Brightness: dim baseline → full white.
      const a = this.activation[i];
      const v = dim + (1 - dim) * a;

      cursor = emitRect(pos, col, cursor, x, y, w, h, v);
      if (doubleAny || cell.superSpreader) {
        cursor = emitRect(pos, col, cursor,
          x, y, w * innerScaleW, h * innerScaleH, v * 0.85);
      }
      // If this cell was marked for a double border in config but
      // isn't a super-spreader, we already emitted the inner border.
      // If `innerBorder` is false but this cell is a super-spreader,
      // we just emitted the inner border to mark it — which means
      // super-spreaders always show their inner tick even when the
      // global double-border toggle is off. That's the whole point.
    }

    // Any unused slots (super-spreader count varies per rebuild) sit as
    // zeros in the pre-allocated buffers.
    for (let i = cursor; i < pos.length; i++) { pos[i] = 0; col[i] = 0; }

    this.lineGeom.setPositions(pos);
    this.lineGeom.setColors(col);
    this.lineMesh.computeLineDistances();

    // ---- 5. Advance and render transmission pulses ---------------
    let write = 0;
    const sp = this.pulsePositions;
    for (let i = 0; i < this.pulses.length; i++) {
      const p = this.pulses[i];
      p.progress += dt * p.speed;
      if (p.progress >= 1) continue;
      const src = this.cells[p.srcIdx];
      const dst = this.cells[p.dstIdx];
      const sx = src.cx + src.jitter.x * chaos;
      const sy = src.cy + src.jitter.y * chaos;
      const dx = dst.cx + dst.jitter.x * chaos;
      const dy = dst.cy + dst.jitter.y * chaos;
      sp[write * 3 + 0] = sx + (dx - sx) * p.progress;
      sp[write * 3 + 1] = sy + (dy - sy) * p.progress;
      sp[write * 3 + 2] = 0;
      this.pulses[write] = p;
      write++;
    }
    this.pulses.length = write;
    this.pulseGeom.setDrawRange(0, write);
    this.pulseGeom.attributes.position.needsUpdate = true;
    this.pulseMaterial.size    = params.pulseSize;
    this.pulseMaterial.opacity = params.showPulses ? params.pulseGlow : 0;
    this.pulsePoints.visible   = params.showPulses;

    // Sync shared material visual knobs.
    this.lineMaterial.linewidth = params.lineWidth;
    this.lineMaterial.opacity   = params.opacity;
  }
}

// Emit the four edges of a rectangle (center x,y / width w / height h) with
// all eight vertex colors set to RGB `v`. Writes in place, returns new cursor.
function emitRect(pos, col, cursor, x, y, w, h, v) {
  const hw = w * 0.5, hh = h * 0.5;
  const x1 = x - hw, y1 = y - hh, x2 = x + hw, y2 = y + hh;
  const P = [
    x1, y1, 0,  x2, y1, 0,   // bottom
    x2, y1, 0,  x2, y2, 0,   // right
    x2, y2, 0,  x1, y2, 0,   // top
    x1, y2, 0,  x1, y1, 0    // left
  ];
  for (let i = 0; i < 24; i++) pos[cursor + i] = P[i];
  for (let i = 0; i < 24; i += 3) {
    col[cursor + i + 0] = v;
    col[cursor + i + 1] = v;
    col[cursor + i + 2] = v;
  }
  return cursor + 24;
}
