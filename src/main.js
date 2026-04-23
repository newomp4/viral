import GUI from 'lil-gui';
import { Stage }                                 from './scene.js';
import { SwarmField, ATTRACTOR_LAYOUTS }         from './swarm.js';
import { Recorder, SIZE_PRESETS }                from './export.js';

// ------------------------------------------------------------------
// Parameters — focused on what shapes the look. The mechanics are
// 3D physics + viral events + an orbital resolve target.
// ------------------------------------------------------------------
const params = {
  // Swarm structure
  particleCount:     900,
  attractorLayout:   'triangle',
  attractorCount:    3,
  attractorSpread:   2.4,
  orbitRadius:       1.6,
  showAttractors:    true,
  attractorSize:     0.55,
  seed:              1337,

  // Physics (resolve = 0 regime)
  gravity:           1.0,
  damping:           0.98,
  drift:             0.04,

  // Viral events
  eventRate:         0.7,     // events per second; 0 = no auto-events
  eventRadius:       2.5,
  eventForce:        7.0,
  brightnessDecay:   0.93,
  dimBaseline:       0.05,

  // Resolved-state orbits
  orbitSpeed:        0.6,

  // Appearance
  particleSize:      0.16,
  opacity:           1.0,
  color:             '#ffffff',

  // Resolve
  resolve:           0.0,

  // Camera
  fov:               42,

  // Export
  exportSize:        'Fit viewport',
  exportFps:         60,
  exportBitrate:     24,
  exportDuration:    0,
  exportTransparent: false,

  // Experimental
  trails:            false,
  trailAmount:       0.06,

  // Presets (populated below)
  preset:            '—',

  // Actions
  randomize:         () => {},
  reseed:            () => {},
  ignite:            () => {},
  resetView:         () => {},
  snapshot:          () => {},
  toggleRecording:   () => {},
  animateResolve:    () => {},
  viewFront:         () => {},
  view3Quarter:      () => {},
  revealExperimental: () => {}
};

// ------------------------------------------------------------------
// Presets — each is a deliberate look, not a parameter tweak.
// ------------------------------------------------------------------
const PRESETS = {
  'Trinity': {
    // Default: three attractors in a triangle, calm steady firing.
    particleCount: 900, attractorLayout: 'triangle', attractorCount: 3,
    attractorSpread: 2.4, orbitRadius: 1.6, gravity: 1.0, damping: 0.98,
    drift: 0.04, eventRate: 0.7, eventRadius: 2.5, eventForce: 7.0,
    brightnessDecay: 0.93, dimBaseline: 0.05, orbitSpeed: 0.6,
    particleSize: 0.16, resolve: 0.0
  },
  'Single sun': {
    particleCount: 1100, attractorLayout: 'single', attractorCount: 1,
    attractorSpread: 0, orbitRadius: 2.0, gravity: 1.4, damping: 0.985,
    drift: 0.02, eventRate: 0.4, eventRadius: 3.0, eventForce: 9.0,
    brightnessDecay: 0.92, dimBaseline: 0.04, orbitSpeed: 0.45,
    particleSize: 0.16, resolve: 0.0
  },
  'Binary': {
    particleCount: 1200, attractorLayout: 'pair', attractorCount: 2,
    attractorSpread: 2.6, orbitRadius: 1.4, gravity: 1.2, damping: 0.98,
    drift: 0.05, eventRate: 1.0, eventRadius: 2.4, eventForce: 8.0,
    brightnessDecay: 0.92, dimBaseline: 0.05, orbitSpeed: 0.7,
    particleSize: 0.15, resolve: 0.0
  },
  'Crystalline orbit': {
    // Ride the resolved state — clean orbital shells around each attractor.
    particleCount: 1400, attractorLayout: 'cube', attractorCount: 8,
    attractorSpread: 2.6, orbitRadius: 1.0, gravity: 0.8, damping: 0.97,
    drift: 0.0, eventRate: 0.0, eventRadius: 2.0, eventForce: 5.0,
    brightnessDecay: 0.95, dimBaseline: 0.18, orbitSpeed: 0.5,
    particleSize: 0.13, resolve: 1.0
  },
  'Galaxy': {
    particleCount: 1600, attractorLayout: 'single', attractorCount: 1,
    attractorSpread: 0, orbitRadius: 2.4, gravity: 1.0, damping: 0.985,
    drift: 0.0, eventRate: 0.0, eventRadius: 3.0, eventForce: 6.0,
    brightnessDecay: 0.95, dimBaseline: 0.18, orbitSpeed: 0.35,
    particleSize: 0.13, resolve: 1.0
  },
  'Storm': {
    particleCount: 1300, attractorLayout: 'circle', attractorCount: 5,
    attractorSpread: 2.8, orbitRadius: 1.5, gravity: 1.6, damping: 0.97,
    drift: 0.08, eventRate: 2.4, eventRadius: 2.4, eventForce: 9.0,
    brightnessDecay: 0.9, dimBaseline: 0.04, orbitSpeed: 0.7,
    particleSize: 0.16, resolve: 0.0
  },
  'Constellation': {
    particleCount: 700, attractorLayout: 'random', attractorCount: 7,
    attractorSpread: 3.2, orbitRadius: 1.0, gravity: 0.9, damping: 0.99,
    drift: 0.02, eventRate: 0.5, eventRadius: 2.0, eventForce: 6.0,
    brightnessDecay: 0.94, dimBaseline: 0.06, orbitSpeed: 0.5,
    particleSize: 0.14, resolve: 0.0
  }
};

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
const canvas = document.getElementById('view');
const stage  = new Stage(canvas);
const field  = new SwarmField(stage.scene);
field.applyParams(params);
stage.applyParams(params);
stage.setFov(params.fov);

// Open with a 3-quarter view so the 3D depth is obvious from the first
// frame. The user can orbit further or hit R to reset.
stage.snapTo({ x: 0.7, y: 0.5, z: 1.0 }, 0.001);

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
  params.attractorLayout = pick(ATTRACTOR_LAYOUTS);
  params.attractorCount  = randInt(2, 8);
  params.attractorSpread = randF(1.6, 3.2);
  params.particleCount   = randInt(500, 1600);
  params.orbitRadius     = randF(1.0, 2.2);
  params.gravity         = randF(0.6, 1.6);
  params.damping         = randF(0.96, 0.99);
  params.drift           = randF(0, 0.08);
  params.eventRate       = randF(0, 2.0);
  params.eventForce      = randF(4, 10);
  params.orbitSpeed      = randF(0.3, 0.9);
  params.seed            = randInt(0, 999_999);
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  field.applyParams(params);
};

params.reseed = () => {
  params.seed = randInt(0, 999_999);
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  field.applyParams(params);
};

params.ignite       = () => field.ignite();
params.resetView    = () => stage.resetView();
params.viewFront    = () => stage.snapTo({ x: 0,   y: 0,   z: 1   });
params.view3Quarter = () => stage.snapTo({ x: 0.7, y: 0.5, z: 1.0 });

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
  resolveAnim = { from, to, dur: 2.4, t0: performance.now() };
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
// Dashboard — kept tight on purpose.
// ------------------------------------------------------------------
const gui = new GUI({ title: 'SWARM' });

gui.add(params, 'preset', ['—', ...Object.keys(PRESETS)]).name('✶ Preset')
   .onChange((name) => { if (name !== '—') loadPreset(name); });
gui.add(params, 'randomize').name('✦ Randomize parameters');
gui.add(params, 'ignite').name('⚡ Ignite event');

const fStruct = gui.addFolder('Structure');
fStruct.add(params, 'attractorLayout', ATTRACTOR_LAYOUTS).name('Attractor layout')
       .onChange(() => field.applyParams(params));
fStruct.add(params, 'attractorCount', 1, 8, 1).name('Attractor count')
       .onChange(() => field.applyParams(params));
fStruct.add(params, 'attractorSpread', 0, 5, 0.05).name('Attractor spread')
       .onChange(() => field.applyParams(params));
fStruct.add(params, 'particleCount', 100, 2400, 50).name('Particle count')
       .onChange(() => field.applyParams(params));
fStruct.add(params, 'orbitRadius', 0.4, 4, 0.05).name('Orbit radius')
       .onChange(() => field.applyParams(params));
fStruct.add(params, 'showAttractors').name('Show attractors');
fStruct.add(params, 'attractorSize', 0.1, 1.5, 0.01).name('Attractor size');
fStruct.add(params, 'seed', 0, 999999, 1).name('Seed')
       .onChange(() => field.applyParams(params));
fStruct.add(params, 'reseed').name('↻ Randomize seed');

const fPhys = gui.addFolder('Physics');
fPhys.add(params, 'gravity', 0, 4,    0.01).name('Gravity');
fPhys.add(params, 'damping', 0.9, 0.999, 0.001).name('Damping');
fPhys.add(params, 'drift',   0, 0.3,  0.005).name('Drift');

const fEvent = gui.addFolder('Viral events');
fEvent.add(params, 'eventRate',   0, 4,   0.05 ).name('Rate (per s)');
fEvent.add(params, 'eventRadius', 0.2, 8, 0.05 ).name('Radius');
fEvent.add(params, 'eventForce',  0, 20,  0.1  ).name('Force');
fEvent.add(params, 'brightnessDecay', 0.7, 0.99, 0.005).name('Brightness decay');
fEvent.add(params, 'dimBaseline', 0, 0.5, 0.005).name('Dim baseline');

const fOrbit = gui.addFolder('Resolved orbits');
fOrbit.add(params, 'orbitSpeed', 0, 2, 0.01).name('Orbit speed');

const fLook = gui.addFolder('Appearance');
fLook.add(params, 'particleSize', 0.04, 0.6, 0.005).name('Particle size');
fLook.add(params, 'opacity',      0,    1,   0.005).name('Opacity');
fLook.addColor(params, 'color').name('Color');

const fRes = gui.addFolder('Resolve');
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
  if (e.key === ' ') { e.preventDefault(); params.ignite(); }
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
