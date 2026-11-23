import { collectBlooms, curve, makeMeadow, nearbyBloomTurn, newFlight, smooth, stepFlight, tiltControl } from './flight.js';
import { createMeadowView } from './meadow-view.js';
import { MeadowScore } from './score.js';
import piano45 from '../samples/piano45.mp3';
import piano53 from '../samples/piano53.mp3';
import piano61 from '../samples/piano61.mp3';
import piano69 from '../samples/piano69.mp3';
import piano77 from '../samples/piano77.mp3';
import cello35 from '../samples/cello35.mp3';
import cello45 from '../samples/cello45.mp3';
import cello52 from '../samples/cello52.mp3';
import cello59 from '../samples/cello59.mp3';
import cello65 from '../samples/cello65.mp3';
import flute60 from '../samples/flute60.mp3';
import flute69 from '../samples/flute69.mp3';
import flute76 from '../samples/flute76.mp3';
import harp59 from '../samples/harp59.mp3';
import harp69 from '../samples/harp69.mp3';
import harp79 from '../samples/harp79.mp3';

const byId = id => document.getElementById(id);
const canvas = byId('meadow');
const begin = byId('begin');
const title = byId('title-screen');
const paused = byId('paused');
const hint = byId('hint');
const milestone = byId('milestone');
const inputHelp = byId('input-help');
const touchDevice = matchMedia('(pointer: coarse)').matches
  || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const meadow = makeMeadow();
const music = new MeadowScore({
  piano45, piano53, piano61, piano69, piano77,
  cello35, cello45, cello52, cello59, cello65,
  flute60, flute69, flute76, harp59, harp69, harp79,
});

let flight = newFlight();
let view;
let playing = false;
let started = false;
let total = 0;
let completed = 0;
let time = 0;
let activeTime = 0;
let hintUntil = 0;
let milestoneUntil = 0;
let mode = touchDevice ? 'touch' : 'mouse';
let motionReference = null;
let motionReading = null;
let motionAngle = 0;
let recalibratingTilt = false;
let tiltAttempt = 0;
let pointerId = null;
let anchor = null;
let pointer = [0, 0];
let gust = false;
const keys = new Set();
const steerKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's', ' ']);

function sayHint(message, seconds = 6) {
  hint.textContent = message;
  hint.hidden = false;
  hintUntil = activeTime + seconds;
}

function guidance() {
  if (mode === 'tilt') return 'Tilt to steer. Hold the meadow for a gust.';
  if (mode === 'touch') return 'Drag to steer. Let go to glide.';
  return 'Move the mouse to steer. Hold to send a gust.';
}

function renderInputMode() {
  byId('recenter').hidden = mode !== 'tilt';
  byId('reset-tilt').hidden = mode !== 'tilt';
  byId('change-input').hidden = !touchDevice;
  byId('change-input').textContent = mode === 'tilt' ? 'Switch to touch' : 'Enable tilt';
  byId('pause-help').textContent = guidance();
}

function resetInput() {
  pointer = [0, 0];
  pointerId = null;
  anchor = null;
  gust = false;
  keys.clear();
}

function useTouch(message = '') {
  tiltAttempt++;
  motionReference = motionReading = null;
  recalibratingTilt = false;
  mode = 'touch';
  resetInput();
  renderInputMode();
  if (message && paused.open) {
    inputHelp.textContent = message;
    inputHelp.hidden = false;
  } else if (message) sayHint(message, 8);
}

function currentAngle() {
  return screen.orientation?.angle ?? (Number.isFinite(window.orientation) ? window.orientation : 0);
}

window.addEventListener('deviceorientation', event => {
  if (mode !== 'tilt' || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
  motionReading = [event.beta, event.gamma];
  const angle = currentAngle();
  if (!motionReference || angle !== motionAngle) {
    motionReference = motionReading;
    motionAngle = angle;
    const reset = recalibratingTilt;
    recalibratingTilt = false;
    if (playing) sayHint(reset ? 'Tilt recalibrated.' : guidance());
    else if (paused.open) {
      inputHelp.textContent = reset ? 'Tilt recalibrated.' : 'Tilt is ready. Resume when you’re comfortable.';
      inputHelp.hidden = false;
    }
  }
});

async function useTilt() {
  const attempt = ++tiltAttempt;
  const events = window.DeviceOrientationEvent;
  if (!window.isSecureContext || !events) {
    useTouch('Touch steering is active. Open the HTTPS game link to use tilt.');
    return;
  }
  try {
    if (typeof events.requestPermission === 'function' && await events.requestPermission() !== 'granted') {
      if (attempt === tiltAttempt) useTouch('Touch steering is active. You can enable tilt in Pause.');
      return;
    }
  } catch {
    if (attempt === tiltAttempt) useTouch('Touch steering is active. You can retry tilt in Pause.');
    return;
  }
  if (attempt !== tiltAttempt) return;
  mode = 'tilt';
  motionReference = motionReading = null;
  resetInput();
  renderInputMode();
  if (playing) sayHint('Hold the phone comfortably to centre the breeze.');
  window.setTimeout(() => {
    if (attempt === tiltAttempt && mode === 'tilt' && !motionReference) {
      useTouch('Touch steering is active. Drag to steer.');
    }
  }, 3500);
}

function startSound() {
  music.start().catch(() => {
    byId('sound').disabled = true;
    byId('sound').textContent = 'Sound unavailable';
  });
}

function sampleControl() {
  const axisX = +keys.has('ArrowRight') + +keys.has('d') - +keys.has('ArrowLeft') - +keys.has('a');
  const axisY = +keys.has('ArrowUp') + +keys.has('w') - +keys.has('ArrowDown') - +keys.has('s');
  const axes = mode === 'tilt' && motionReference && motionReading
    ? tiltControl(motionReference, motionReading, motionAngle)
    : pointer;
  return { x: Math.sign(axisX) || axes[0], y: Math.sign(axisY) || axes[1], gust: gust || keys.has(' ') };
}

function resetMeadow() {
  flight = newFlight();
  total = completed = activeTime = 0;
  for (const flower of meadow.flowers) {
    flower.bloomed = false;
    flower.growth = 0;
  }
  for (const glade of meadow.glades) {
    glade.lit = false;
    glade.count = glade.glow = 0;
  }
  music.stage = 0;
  music.lastNote = null;
  view.reset();
  milestone.hidden = true;
}

function pauseFlight() {
  if (!playing) return;
  playing = false;
  resetInput();
  music.pause();
  inputHelp.hidden = true;
  renderInputMode();
  paused.showModal();
  byId('resume').focus();
}

function resumeFlight() {
  if (!started || playing) return;
  resetInput();
  if (paused.open) paused.close();
  playing = true;
  canvas.focus({ preventScroll: true });
  startSound();
}

begin.addEventListener('click', () => {
  started = true;
  title.hidden = true;
  byId('flight-controls').hidden = false;
  if (touchDevice) void useTilt();
  resumeFlight();
  if (!touchDevice) sayHint(guidance());
});
byId('pause').addEventListener('click', pauseFlight);
byId('resume').addEventListener('click', resumeFlight);
byId('restart').addEventListener('click', () => {
  resetMeadow();
  resumeFlight();
  sayHint(guidance());
});
byId('sound').addEventListener('click', event => {
  const muted = !music.muted;
  music.setMute(muted);
  event.currentTarget.setAttribute('aria-pressed', String(muted));
  event.currentTarget.textContent = muted ? 'Unmute' : 'Mute';
  if (!muted) startSound();
});
byId('change-input').addEventListener('click', () => {
  inputHelp.hidden = true;
  if (mode === 'tilt') useTouch('Touch steering is active.');
  else void useTilt();
});
function resetTilt() {
  if (mode !== 'tilt') return;
  motionReference = motionReading = null;
  recalibratingTilt = true;
  flight.steer = flight.rise = 0;
  const message = 'Hold the phone at your new neutral angle.';
  if (playing) sayHint(message);
  else {
    inputHelp.textContent = message;
    inputHelp.hidden = false;
  }
}

byId('reset-tilt').addEventListener('click', resetTilt);
byId('recenter').addEventListener('click', resetTilt);
paused.addEventListener('cancel', event => {
  event.preventDefault();
  resumeFlight();
});

canvas.addEventListener('pointermove', event => {
  if (!playing) return;
  if (mode === 'mouse' && (event.pointerType === 'mouse' || event.pointerType === 'pen')) {
    const bounds = canvas.getBoundingClientRect();
    pointer = [
      curve((event.clientX - bounds.left - bounds.width / 2) / (bounds.width * 0.33)),
      curve((bounds.top + bounds.height / 2 - event.clientY) / (bounds.height * 0.31)),
    ];
  } else if (mode === 'touch' && pointerId === event.pointerId && anchor) {
    pointer = [curve((event.clientX - anchor[0]) / 78), curve((anchor[1] - event.clientY) / 72)];
  }
});
canvas.addEventListener('pointerdown', event => {
  if (!playing || pointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
  pointerId = event.pointerId;
  if (event.pointerType !== 'mouse') canvas.setPointerCapture(event.pointerId);
  if (mode === 'touch') anchor = [event.clientX, event.clientY];
  else gust = true;
});
function releasePointer(event) {
  if (event.pointerId !== pointerId) return;
  pointerId = null;
  anchor = null;
  gust = false;
  if (mode === 'touch') pointer = [0, 0];
}
window.addEventListener('pointerup', releasePointer);
window.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('lostpointercapture', releasePointer);
canvas.addEventListener('pointerleave', () => {
  if (mode === 'mouse') pointer = [0, 0];
});
window.addEventListener('blur', resetInput);
window.addEventListener('keydown', event => {
  if (!playing) return;
  if (event.key === 'Escape' || event.key.toLowerCase() === 'p') {
    event.preventDefault();
    pauseFlight();
  } else if (!event.target.closest?.('button') && steerKeys.has(event.key)) {
    event.preventDefault();
    keys.add(event.key);
  }
});
window.addEventListener('keyup', event => keys.delete(event.key));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseFlight();
});

function step(dt) {
  activeTime += dt;
  const x = flight.x, z = flight.z;
  const control = sampleControl();
  if (Math.abs(control.x) < 0.025 && flight.height < 2.3) control.x = nearbyBloomTurn(meadow, flight);
  stepFlight(flight, control, dt);
  for (const { flower, completed: lit } of collectBlooms(meadow, flight, x, z)) {
    total++;
    view.bloom(total, flower, time);
    if (lit) {
      completed++;
      music.stage = completed;
      milestone.textContent = completed === 3
        ? 'The meadow is in bloom. Stay as long as you like.'
        : `${meadow.glades[flower.glade].name} are in bloom.`;
      milestone.hidden = false;
      milestoneUntil = activeTime + 6.5;
    }
    music.bloom(flower, (flower.x - flight.x) * 0.22, lit);
  }
  if (activeTime >= hintUntil) hint.hidden = true;
  if (activeTime >= milestoneUntil) milestone.hidden = true;
  for (const flower of meadow.flowers) {
    if (flower.bloomed && flower.growth < 0.999) flower.growth = smooth(flower.growth, 1, dt, 5.8);
  }
  music.update((flight.speed - 3.65) / (7.3 - 3.65));
}

let previousTime = performance.now();
function frame(now) {
  const dt = Math.min(0.072, (now - previousTime) / 1000);
  previousTime = now;
  if (playing || !started) time += dt;
  if (playing) step(dt);
  view.draw(flight, time, dt, total, meadow.glades.findIndex(glade => !glade.lit), started);
  requestAnimationFrame(frame);
}

try {
  view = createMeadowView(canvas, meadow, touchDevice, reducedMotion);
  view.draw(flight, 0, 0, 0, 0, false);
  begin.disabled = false;
  requestAnimationFrame(frame);
} catch (error) {
  console.error(error);
  const explanation = byId('start-error');
  explanation.textContent = 'Salt Meadow needs a browser with WebGL 2 and hardware acceleration.';
  explanation.hidden = false;
}
