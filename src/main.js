import GUI from 'lil-gui';
import { Stage }                                          from './scene.js';
import { RippleField,
         SOURCE_LAYOUTS, PHASE_MODES, FADE_STYLES }       from './ripple.js';
import { Recorder, SIZE_PRESETS }                         from './export.js';

// ------------------------------------------------------------------
// Parameters — kept tight on purpose. Two ideas (sources, rings)
// surfaced as a small handful of knobs.
// ------------------------------------------------------------------
const params = {
  // Sources
  sourceLayout:    'circle',
  sourceCount:     5,
  sourceSpread:    2.4,
  seed:            1337,

  // Emission
  emissionRate:    0.9,         // rings per second per source
  phaseMode:       'stagger',

  // Wave
  waveSpeed:       1.4,
  maxAge:          4.5,
  segments:        96,
  fadeStyle:       'linear',

  // Appearance
  lineWidth:       1.5,
  opacity:         1.0,
  dimBaseline:     0.0,
  color:           '#ffffff',

  // Resolve
  chaosJitter:     0.6,
  resolve:         1.0,

  // Camera
  fov:             38,

  // Export
  exportSize:        'Fit viewport',
  exportFps:         60,
  exportBitrate:     24,
  exportDuration:    0,
  exportTransparent: false,

  // Experimental
  trails:          false,
  trailAmount:     0.08,

  // Presets (populated below)
  preset:          '—',

  // Actions
  randomize:       () => {},
  reseed:          () => {},
  drop:            () => {},
  resetView:       () => {},
  snapshot:        () => {},
  toggleRecording: () => {},
  animateResolve:  () => {},
  viewFront:       () => {},
  view3Quarter:    () => {},
  revealExperimental: () => {}
};

// ------------------------------------------------------------------
// Presets — each is a distinct visual mood, not a parameter tweak.
// ------------------------------------------------------------------
const PRESETS = {
  'Quartet': {
    sourceLayout: 'grid', sourceCount: 4, sourceSpread: 1.8,
    emissionRate: 0.8, phaseMode: 'stagger',
    waveSpeed: 1.4, maxAge: 4.5, segments: 96, fadeStyle: 'linear',
    lineWidth: 1.5, dimBaseline: 0.0, opacity: 1.0,
    resolve: 1.0, chaosJitter: 0.4
  },
  'Single drop': {
    sourceLayout: 'single', sourceCount: 1, sourceSpread: 0,
    emissionRate: 0.6, phaseMode: 'sync',
    waveSpeed: 1.6, maxAge: 5.0, segments: 128, fadeStyle: 'quadratic',
    lineWidth: 1.6, dimBaseline: 0.0, opacity: 1.0,
    resolve: 1.0, chaosJitter: 0.0
  },
  'Heartbeat': {
    sourceLayout: 'phyllotaxis', sourceCount: 8, sourceSpread: 2.4,
    emissionRate: 0.55, phaseMode: 'sync',
    waveSpeed: 1.8, maxAge: 4.0, segments: 96, fadeStyle: 'exponential',
    lineWidth: 1.6, dimBaseline: 0.0, opacity: 1.0,
    resolve: 1.0, chaosJitter: 0.2
  },
  'Cascade': {
    sourceLayout: 'circle', sourceCount: 8, sourceSpread: 2.6,
    emissionRate: 1.4, phaseMode: 'stagger',
    waveSpeed: 1.3, maxAge: 4.5, segments: 96, fadeStyle: 'linear',
    lineWidth: 1.4, dimBaseline: 0.0, opacity: 1.0,
    resolve: 1.0, chaosJitter: 0.3
  },
  'Constellation': {
    sourceLayout: 'random', sourceCount: 12, sourceSpread: 2.8,
    emissionRate: 0.7, phaseMode: 'random',
    waveSpeed: 1.2, maxAge: 5.0, segments: 80, fadeStyle: 'linear',
    lineWidth: 1.3, dimBaseline: 0.0, opacity: 1.0,
    resolve: 1.0, chaosJitter: 0.4
  },
  'Quiet ocean': {
    sourceLayout: 'phyllotaxis', sourceCount: 14, sourceSpread: 3.2,
    emissionRate: 0.35, phaseMode: 'random',
    waveSpeed: 0.9, maxAge: 6.5, segments: 96, fadeStyle: 'quadratic',
    lineWidth: 1.0, dimBaseline: 0.0, opacity: 0.85,
    resolve: 1.0, chaosJitter: 0.3
  }
};

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
const canvas = document.getElementById('view');
const stage  = new Stage(canvas);
const field  = new RippleField(stage.scene, stage.lineMaterial);
field.applyParams(params);
stage.applyParams(params);
stage.setFov(params.fov);

const recorder = new Recorder(canvas);
const recIndicator = document.getElementById('rec-indicator');
recorder.onStateChange = (state) => {
  recIndicator.classList.toggle('hidden', state !== 'recording');
  recordCtrl.name(state === 'recording' ? 'Stop recording' : 'Start recording');
};

// ------------------------------------------------------------------
// Actions
// ------------------------------------------------------------------
const randInt = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo + 1));
const randF   = (lo, hi) => lo + Math.random() * (hi - lo);
const pick    = (arr)    => arr[randInt(0, arr.length - 1)];

params.randomize = () => {
  params.sourceLayout = pick(SOURCE_LAYOUTS);
  params.sourceCount  = randInt(2, 14);
  params.sourceSpread = randF(1.4, 3.2);
  params.emissionRate = randF(0.4, 1.6);
  params.phaseMode    = pick(PHASE_MODES);
  params.waveSpeed    = randF(0.7, 1.8);
  params.maxAge       = randF(2.8, 6.5);
  params.fadeStyle    = pick(FADE_STYLES);
  params.seed         = randInt(0, 999_999);
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  field.applyParams(params);
};

params.reseed = () => {
  params.seed = randInt(0, 999_999);
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  field.applyParams(params);
};

params.drop         = () => field.drop();
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
// Dashboard — kept short on purpose.
// ------------------------------------------------------------------
const gui = new GUI({ title: 'RIPPLE' });

gui.add(params, 'preset', ['—', ...Object.keys(PRESETS)]).name('✶ Preset')
   .onChange((name) => { if (name !== '—') loadPreset(name); });
gui.add(params, 'randomize').name('✦ Randomize parameters');
gui.add(params, 'drop').name('● Drop a ring at every source');

const fSrc = gui.addFolder('Sources');
fSrc.add(params, 'sourceLayout', SOURCE_LAYOUTS).name('Layout')
    .onChange(() => field.applyParams(params));
fSrc.add(params, 'sourceCount', 1, 24, 1).name('Count')
    .onChange(() => field.applyParams(params));
fSrc.add(params, 'sourceSpread', 0, 5, 0.01).name('Spread')
    .onChange(() => field.applyParams(params));
fSrc.add(params, 'seed', 0, 999999, 1).name('Seed')
    .onChange(() => field.applyParams(params));
fSrc.add(params, 'reseed').name('↻ Randomize seed');

const fEmit = gui.addFolder('Emission');
fEmit.add(params, 'emissionRate', 0.05, 4, 0.01).name('Rate (per source · s)')
     .onChange(() => field.applyParams(params));
fEmit.add(params, 'phaseMode', PHASE_MODES).name('Phase')
     .onChange(() => field.applyParams(params));

const fWave = gui.addFolder('Wave');
fWave.add(params, 'waveSpeed', 0.1, 5,    0.01).name('Speed');
fWave.add(params, 'maxAge',    0.5, 12,   0.05).name('Lifetime (s)');
fWave.add(params, 'segments',  16,  192,  1   ).name('Segments');
fWave.add(params, 'fadeStyle', FADE_STYLES).name('Fade');

const fLook = gui.addFolder('Appearance');
fLook.add(params, 'lineWidth',   0.3, 6,   0.05 ).name('Line weight (px)');
fLook.add(params, 'opacity',     0,   1,   0.005).name('Opacity');
fLook.add(params, 'dimBaseline', 0,   0.6, 0.005).name('Dim baseline');
fLook.addColor(params, 'color').name('Color');

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
  if (e.key === ' ') { e.preventDefault(); params.drop(); }
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

  field.update(dt, params);
  stage.applyParams(params);
  stage.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
