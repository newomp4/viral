import GUI from 'lil-gui';
import { Stage }                                      from './scene.js';
import { ViralField,
         LAYOUTS, NEIGHBOURS, FIRE_MODES }            from './viral.js';
import { Recorder, SIZE_PRESETS }                     from './export.js';

// ------------------------------------------------------------------
// Parameters — every knob the field reads, organised by what it
// controls. Defaults are tuned for the 'endemic' look out of the box.
// ------------------------------------------------------------------
const params = {
  // Grid
  cols:                12,
  rows:                10,
  layout:              'grid',     // grid | brick | hex | scatter
  cellAspect:          0.5625,     // 9:16 vertical clip
  cellScale:           0.55,       // size of one cell, world units
  cellPadding:         0.18,       // gap as a fraction of cell size
  seed:                1337,

  // Transmission topology
  neighbourMode:       '8',        // 4 | 8 | radius
  transmissionRadius:  2.5,        // cells (for radius mode)

  // Infection dynamics
  transmissionProb:    0.42,       // per neighbour per second @ activation 1
  broadcastThreshold:  0.32,
  infectionStrength:   0.55,       // how much activation jumps on hit
  decayRate:           0.95,       // per-frame at 60fps

  // Super-spreaders (hubs)
  superSpreaderRatio:  0.06,
  superSpreaderBoost:  2.4,

  // Firing modes
  fireMode:            'endemic',
  backgroundRate:      2.4,        // ignitions per second (steady/endemic)
  outbreakPeriod:      4.0,
  outbreakSources:     1,

  // Pulses
  showPulses:          true,
  pulseSize:           0.13,
  pulseGlow:           1.0,

  // Borders
  innerBorder:         false,
  innerBorderGap:      0.18,

  // Appearance
  lineWidth:           1.4,
  lineStyle:           'solid',
  dashSize:            0.08,
  gapSize:             0.06,
  flowSpeed:           1.6,
  opacity:             1.0,
  dimBaseline:         0.18,
  color:               '#ffffff',

  // Counter
  viewsPerFire:        12000,      // each unit of activation gained = N "views"

  // Resolve
  chaosJitter:         0.4,
  resolve:             1.0,        // start clean — chaos is opt-in

  // Camera
  fov:                 38,

  // Export
  exportSize:          'Fit viewport',
  exportFps:           60,
  exportBitrate:       24,
  exportDuration:      0,
  exportTransparent:   false,

  // Experimental
  trails:              false,
  trailAmount:         0.08,

  // Presets (populated below)
  preset:              '—',

  // Actions
  randomize:           () => {},
  reseed:              () => {},
  ignite:              () => {},
  igniteBurst:         () => {},
  igniteAll:           () => {},
  resetCounters:       () => {},
  resetView:           () => {},
  snapshot:            () => {},
  toggleRecording:     () => {},
  animateResolve:      () => {},
  viewFront:           () => {},
  view3Quarter:        () => {},
  revealExperimental:  () => {}
};

// ------------------------------------------------------------------
// Presets — each preset is a deliberate look. Mix-and-match knobs.
// ------------------------------------------------------------------
const PRESETS = {
  'Reel wall': {
    // The default look — endemic 9:16 grid, calm but never silent.
    cols: 12, rows: 10, layout: 'grid', cellAspect: 0.5625, cellScale: 0.55,
    cellPadding: 0.18, neighbourMode: '8',
    transmissionProb: 0.4, broadcastThreshold: 0.32, infectionStrength: 0.55,
    decayRate: 0.95,
    fireMode: 'endemic', backgroundRate: 2.4, outbreakPeriod: 5.0,
    superSpreaderRatio: 0.06, superSpreaderBoost: 2.4,
    showPulses: true, innerBorder: false,
    resolve: 1.0, chaosJitter: 0.4, dimBaseline: 0.18,
    lineStyle: 'solid', lineWidth: 1.4
  },
  'Slow burn': {
    cols: 14, rows: 10, layout: 'grid', cellAspect: 0.5625, cellScale: 0.5,
    cellPadding: 0.2, neighbourMode: '4',
    transmissionProb: 0.18, broadcastThreshold: 0.45, infectionStrength: 0.38,
    decayRate: 0.97,
    fireMode: 'steady', backgroundRate: 1.2,
    superSpreaderRatio: 0, showPulses: true, innerBorder: false,
    resolve: 1.0, chaosJitter: 0.3, dimBaseline: 0.2,
    lineStyle: 'solid', lineWidth: 1.2
  },
  'Outbreak': {
    cols: 16, rows: 12, layout: 'grid', cellAspect: 0.5625, cellScale: 0.4,
    cellPadding: 0.16, neighbourMode: '8',
    transmissionProb: 0.55, broadcastThreshold: 0.3, infectionStrength: 0.6,
    decayRate: 0.94,
    fireMode: 'outbreak', outbreakPeriod: 6.5, outbreakSources: 1,
    superSpreaderRatio: 0, showPulses: true, innerBorder: false,
    resolve: 1.0, chaosJitter: 0.35, dimBaseline: 0.15,
    lineStyle: 'solid', lineWidth: 1.2
  },
  'Wildfire': {
    cols: 18, rows: 13, layout: 'grid', cellAspect: 0.5625, cellScale: 0.36,
    cellPadding: 0.12, neighbourMode: '8',
    transmissionProb: 0.85, broadcastThreshold: 0.22, infectionStrength: 0.75,
    decayRate: 0.9,
    fireMode: 'endemic', backgroundRate: 4.0, outbreakPeriod: 3.0,
    superSpreaderRatio: 0.1, superSpreaderBoost: 3.0,
    showPulses: true, innerBorder: false,
    resolve: 1.0, chaosJitter: 0.3, dimBaseline: 0.12,
    lineStyle: 'solid', lineWidth: 1.1
  },
  'Trending hubs': {
    cols: 13, rows: 10, layout: 'grid', cellAspect: 0.5625, cellScale: 0.5,
    cellPadding: 0.18, neighbourMode: '8',
    transmissionProb: 0.32, broadcastThreshold: 0.35, infectionStrength: 0.5,
    decayRate: 0.95,
    fireMode: 'endemic', backgroundRate: 1.8, outbreakPeriod: 5.5,
    superSpreaderRatio: 0.14, superSpreaderBoost: 3.5,
    showPulses: true, innerBorder: false,
    resolve: 1.0, chaosJitter: 0.35, dimBaseline: 0.18,
    lineStyle: 'solid', lineWidth: 1.4
  },
  'Beat drop': {
    cols: 12, rows: 9, layout: 'grid', cellAspect: 0.5625, cellScale: 0.55,
    cellPadding: 0.18, neighbourMode: '4',
    transmissionProb: 0.0, broadcastThreshold: 0.5, infectionStrength: 0,
    decayRate: 0.86,
    fireMode: 'burst', outbreakPeriod: 1.6,
    superSpreaderRatio: 0, showPulses: false, innerBorder: true, innerBorderGap: 0.16,
    resolve: 1.0, chaosJitter: 0.0, dimBaseline: 0.05,
    lineStyle: 'solid', lineWidth: 1.6
  },
  'Brick stagger': {
    cols: 11, rows: 9, layout: 'brick', cellAspect: 0.5625, cellScale: 0.6,
    cellPadding: 0.18, neighbourMode: '8',
    transmissionProb: 0.5, broadcastThreshold: 0.3, infectionStrength: 0.55,
    decayRate: 0.95,
    fireMode: 'endemic', backgroundRate: 2.0, outbreakPeriod: 4.5,
    superSpreaderRatio: 0.06, superSpreaderBoost: 2.5,
    showPulses: true, innerBorder: false,
    resolve: 1.0, chaosJitter: 0.4, dimBaseline: 0.16,
    lineStyle: 'solid', lineWidth: 1.3
  },
  'Cold start': {
    cols: 14, rows: 10, layout: 'grid', cellAspect: 0.5625, cellScale: 0.5,
    cellPadding: 0.2, neighbourMode: '8',
    transmissionProb: 0.45, broadcastThreshold: 0.3, infectionStrength: 0.55,
    decayRate: 0.96,
    fireMode: 'idle',
    superSpreaderRatio: 0, showPulses: true, innerBorder: false,
    resolve: 1.0, chaosJitter: 0.3, dimBaseline: 0.12,
    lineStyle: 'solid', lineWidth: 1.3
  },
  'Square pixel': {
    // Square cells, no aspect — looks like LED matrix.
    cols: 18, rows: 18, layout: 'grid', cellAspect: 1.0, cellScale: 0.36,
    cellPadding: 0.14, neighbourMode: '8',
    transmissionProb: 0.5, broadcastThreshold: 0.3, infectionStrength: 0.55,
    decayRate: 0.94,
    fireMode: 'endemic', backgroundRate: 3.0, outbreakPeriod: 4.0,
    superSpreaderRatio: 0.08, superSpreaderBoost: 2.6,
    showPulses: true, innerBorder: false,
    resolve: 1.0, chaosJitter: 0.3, dimBaseline: 0.14,
    lineStyle: 'solid', lineWidth: 1.0
  }
};

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
const canvas = document.getElementById('view');
const stage  = new Stage(canvas);
const field  = new ViralField(stage.scene, stage.lineMaterial);
field.applyParams(params);
stage.applyParams(params);
stage.setFov(params.fov);

const recorder = new Recorder(canvas);
const recIndicator = document.getElementById('rec-indicator');
recorder.onStateChange = (state) => {
  recIndicator.classList.toggle('hidden', state !== 'recording');
  recordCtrl.name(state === 'recording' ? 'Stop recording' : 'Start recording');
};

// Counter DOM nodes — updated every frame.
const elViews  = document.getElementById('count-views');
const elActive = document.getElementById('count-active');
const elPeak   = document.getElementById('count-peak');

// ------------------------------------------------------------------
// Actions
// ------------------------------------------------------------------
const randInt = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo + 1));
const randF   = (lo, hi) => lo + Math.random() * (hi - lo);
const pick    = (arr)    => arr[randInt(0, arr.length - 1)];

params.randomize = () => {
  params.cols              = randInt(8, 20);
  params.rows              = randInt(6, 16);
  params.layout            = pick(LAYOUTS);
  params.neighbourMode     = pick(NEIGHBOURS);
  params.transmissionProb  = randF(0.18, 0.78);
  params.broadcastThreshold = randF(0.22, 0.5);
  params.infectionStrength = randF(0.35, 0.7);
  params.decayRate         = randF(0.88, 0.98);
  params.fireMode          = pick(FIRE_MODES);
  params.backgroundRate    = randF(0.6, 4.0);
  params.outbreakPeriod    = randF(2, 7);
  params.superSpreaderRatio = Math.random() < 0.6 ? randF(0.04, 0.16) : 0;
  params.seed              = randInt(0, 999_999);
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  field.applyParams(params);
};

params.reseed = () => {
  params.seed = randInt(0, 999_999);
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  field.applyParams(params);
};

params.ignite      = () => field.ignite(1);
params.igniteBurst = () => field.ignite(8);
params.igniteAll   = () => field.igniteAll();

params.resetCounters = () => {
  field.stats.totalViews = 0;
  field.stats.peakActive = 0;
};

params.resetView    = () => stage.resetView();
params.viewFront    = () => stage.snapTo({ x: 0, y: 0,    z: 1 });
params.view3Quarter = () => stage.snapTo({ x: 1, y: 0.85, z: 1 });

params.snapshot = () => {
  applyExportSize();
  stage.setAlphaMode(params.exportTransparent);
  requestAnimationFrame(() => {
    field.update(0, params);
    stage.applyParams(params);
    stage.render();
    recorder.snapshot({ alpha: params.exportTransparent });
  });
};

params.toggleRecording = () => {
  if (recorder.state === 'recording') {
    recorder.stop();
    return;
  }
  applyExportSize();
  stage.setAlphaMode(params.exportTransparent);
  requestAnimationFrame(() => {
    recorder.start({
      fps:         params.exportFps,
      bitrateMbps: params.exportBitrate,
      durationSec: params.exportDuration,
      alpha:       params.exportTransparent
    });
  });
};

let resolveAnim = null;
params.animateResolve = () => {
  const from = params.resolve;
  const to   = from >= 0.5 ? 0 : 1;
  resolveAnim = { from, to, dur: 2.0, t0: performance.now() };
};

function applyExportSize() {
  const preset = SIZE_PRESETS[params.exportSize];
  if (!preset) return;
  if (preset.w === 0) stage.clearExportSize();
  else                stage.setExportSize(preset.w, preset.h);
}

function loadPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  Object.assign(params, p);
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  field.applyParams(params);
  stage.setFov(params.fov);
}

// ------------------------------------------------------------------
// Line-style sync (shared LineMaterial).
// ------------------------------------------------------------------
let lineDashedOn = false;
function syncLineStyle() {
  const m = stage.lineMaterial;
  const wantDashed = params.lineStyle !== 'solid';
  if (wantDashed !== lineDashedOn) {
    m.dashed = wantDashed;
    m.needsUpdate = true;
    lineDashedOn = wantDashed;
  }
  m.dashSize   = params.dashSize;
  m.gapSize    = params.gapSize;
  m.dashOffset = params.lineStyle === 'flow'
                 ? -performance.now() / 1000 * params.flowSpeed
                 : 0;
}

// Pretty-print numbers like "1.23M", "523K", or "812".
function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.floor(n).toLocaleString();
}

// ------------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------------
const gui = new GUI({ title: 'VIRAL' });

gui.add(params, 'preset', ['—', ...Object.keys(PRESETS)]).name('✶ Preset')
   .onChange((name) => { if (name !== '—') loadPreset(name); });
gui.add(params, 'randomize').name('✦ Randomize parameters');
gui.add(params, 'ignite').name('⚡ Ignite (1)');
gui.add(params, 'igniteBurst').name('⚡⚡ Ignite burst (8)');
gui.add(params, 'igniteAll').name('⚡⚡⚡ Ignite entire field');

const fGrid = gui.addFolder('Grid');
fGrid.add(params, 'cols', 2, 30, 1).name('Cols')
     .onChange(() => field.applyParams(params));
fGrid.add(params, 'rows', 2, 30, 1).name('Rows')
     .onChange(() => field.applyParams(params));
fGrid.add(params, 'layout', LAYOUTS).name('Layout')
     .onChange(() => field.applyParams(params));
fGrid.add(params, 'cellAspect', 0.2, 3, 0.005).name('Cell aspect (W/H)')
     .onChange(() => field.applyParams(params));
fGrid.add(params, 'cellScale', 0.1, 1.5, 0.005).name('Cell scale')
     .onChange(() => field.applyParams(params));
fGrid.add(params, 'cellPadding', 0, 0.6, 0.005).name('Cell padding')
     .onChange(() => field.applyParams(params));
fGrid.add(params, 'seed', 0, 999999, 1).name('Seed')
     .onChange(() => field.applyParams(params));
fGrid.add(params, 'reseed').name('↻ Randomize seed');

const fInfect = gui.addFolder('Infection');
fInfect.add(params, 'neighbourMode', NEIGHBOURS).name('Neighbours')
       .onChange(() => field.applyParams(params));
fInfect.add(params, 'transmissionRadius', 1, 6, 0.1).name('Radius (mode = radius)')
       .onChange(() => field.applyParams(params));
fInfect.add(params, 'transmissionProb',  0, 1, 0.005).name('Transmission prob');
fInfect.add(params, 'broadcastThreshold', 0.05, 0.95, 0.005).name('Broadcast threshold');
fInfect.add(params, 'infectionStrength',  0, 1, 0.005).name('Infection strength');
fInfect.add(params, 'decayRate', 0.6, 0.99, 0.005).name('Decay rate');

const fSpread = gui.addFolder('Super-spreaders');
fSpread.add(params, 'superSpreaderRatio', 0, 0.3, 0.005).name('Ratio')
       .onChange(() => field.applyParams(params));
fSpread.add(params, 'superSpreaderBoost', 1, 6, 0.05).name('Boost ×');

const fFire = gui.addFolder('Firing');
fFire.add(params, 'fireMode', FIRE_MODES).name('Mode');
fFire.add(params, 'backgroundRate',  0, 8, 0.05).name('Background rate (Hz)');
fFire.add(params, 'outbreakPeriod', 0.3, 10, 0.05).name('Outbreak / burst period (s)');
fFire.add(params, 'outbreakSources', 1, 8, 1).name('Outbreak sources');

const fPulse = gui.addFolder('Transmission pulses');
fPulse.add(params, 'showPulses').name('Show pulses');
fPulse.add(params, 'pulseSize', 0.03, 0.5, 0.005).name('Pulse size');
fPulse.add(params, 'pulseGlow', 0, 2, 0.01).name('Pulse glow');

const fLook = gui.addFolder('Appearance');
fLook.add(params, 'innerBorder').name('Inner border')
     .onChange(() => field.applyParams(params));
fLook.add(params, 'innerBorderGap', 0.04, 0.4, 0.005).name('Inner gap');
fLook.add(params, 'lineStyle', ['solid', 'dashed', 'flow']).name('Line style');
fLook.add(params, 'lineWidth', 0.3, 6, 0.05).name('Line weight (px)');
fLook.add(params, 'dimBaseline', 0, 0.6, 0.005).name('Dim baseline');
fLook.add(params, 'opacity',     0, 1,   0.005).name('Opacity');
fLook.addColor(params, 'color').name('Color');

const fDash = gui.addFolder('Dash & flow');
fDash.add(params, 'dashSize',  0.02, 0.6, 0.005).name('Dash length');
fDash.add(params, 'gapSize',   0.02, 0.6, 0.005).name('Gap length');
fDash.add(params, 'flowSpeed', 0,    6,   0.01 ).name('Flow speed');

const fCounter = gui.addFolder('Counter');
fCounter.add(params, 'viewsPerFire', 100, 100000, 100).name('Views per unit');
fCounter.add(params, 'resetCounters').name('↻ Reset counters');

const fRes = gui.addFolder('Resolve');
fRes.add(params, 'chaosJitter', 0, 1.5, 0.01).name('Chaos jitter');
const resolveCtrl = fRes.add(params, 'resolve', 0, 1, 0.001).name('Resolve');
fRes.add(params, 'animateResolve').name('▶ Animate resolve');

const fCam = gui.addFolder('Camera');
fCam.add(params, 'fov', 15, 90, 0.1).name('Field of view')
    .onChange((v) => stage.setFov(v));
fCam.add(params, 'resetView').name('↺ Reset camera');
fCam.add(params, 'viewFront'   ).name('● Front (flat)');
fCam.add(params, 'view3Quarter').name('◆ 3/4 perspective');

const fExport = gui.addFolder('Export');
fExport.add(params, 'exportSize', Object.keys(SIZE_PRESETS)).name('Canvas size')
       .onChange(() => applyExportSize());
fExport.add(params, 'exportTransparent').name('Transparent background')
       .onChange((v) => stage.setAlphaMode(v));
fExport.add(params, 'exportFps', [24, 30, 60]).name('FPS');
fExport.add(params, 'exportBitrate', 4, 200, 1).name('Bitrate (Mbps)');
fExport.add(params, 'exportDuration', 0, 120, 1).name('Duration (s, 0=manual)');
fExport.add(params, 'snapshot').name('⤓ Save PNG frame');
const recordCtrl = fExport.add(params, 'toggleRecording').name('Start recording');

// ------------------------------------------------------------------
// Experimental — motion trails.
// ------------------------------------------------------------------
const fExp = gui.addFolder('∞ Experimental');
const fTrails = fExp.addFolder('Motion trails');
fTrails.add(params, 'trails').name('Enabled')
       .onChange((v) => stage.enableTrails(v, params.trailAmount));
fTrails.add(params, 'trailAmount', 0.02, 0.4, 0.005).name('Fade amount')
       .onChange((v) => stage.enableTrails(params.trails, v));
fExp.hide();

let experimentalShown = false;
function toggleExperimental(force) {
  experimentalShown = typeof force === 'boolean' ? force : !experimentalShown;
  if (experimentalShown) { fExp.show(); fExp.open(); }
  else                   { fExp.hide(); }
  expBtn.name(experimentalShown ? '✦ HIDE EXPERIMENTAL ✦' : '✦ EXPERIMENTAL ✦');
}
params.revealExperimental = () => toggleExperimental();

const expBtn = gui.add(params, 'revealExperimental').name('✦ EXPERIMENTAL ✦');
expBtn.domElement.classList.add('rainbow-btn');

// Keyboard shortcuts.
window.addEventListener('keydown', (e) => {
  if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.key === 'r' || e.key === 'R') stage.resetView();
  if (e.key === ' ') { e.preventDefault(); params.ignite(); }
  if (e.key === 'b' || e.key === 'B') params.igniteBurst();
  if (e.key === 'a' || e.key === 'A') params.animateResolve();
  if (e.key === 'x' || e.key === 'X') params.randomize();
  if (e.key === '`' || e.key === '~') toggleExperimental();
});

// ------------------------------------------------------------------
// Main loop
// ------------------------------------------------------------------
let prev = performance.now();
function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;

  if (resolveAnim) {
    const t = Math.min(1, (now - resolveAnim.t0) / 1000 / resolveAnim.dur);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    params.resolve = resolveAnim.from + (resolveAnim.to - resolveAnim.from) * eased;
    resolveCtrl.updateDisplay();
    if (t >= 1) resolveAnim = null;
  }

  syncLineStyle();
  field.update(dt, params);
  stage.applyParams(params);
  stage.render();

  // Live counter readout.
  elViews .textContent = fmt(field.stats.totalViews);
  elActive.textContent = fmt(field.stats.activeCount);
  elPeak  .textContent = fmt(field.stats.peakActive);

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
