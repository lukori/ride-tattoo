// Stage 0: the line on screen, played with a finger.
// Two modes: "play" (touch a point, the ride plays on from there)
// and "scrub" (the finger is the playhead; speed and direction of the finger drive the sound).

const DEFAULTS = {
  grain: 0.09,     // scrub: length of each sound grain, seconds
  every: 0.035,    // scrub: time between grains, seconds
  pitch: 1,        // scrub: 1 = sound speeds up / slows down with the finger (tape), 0 = constant pitch
  minRate: 0.35,   // scrub: slowest playback rate when pitch=1
  maxRate: 3,      // scrub: fastest playback rate when pitch=1
  hold: 0,         // scrub: 1 = keep sounding the moment under a still finger
  smooth: 0.25,    // scrub: finger speed smoothing (0 = raw, closer to 1 = smoother)
};
const LIMITS = {
  grain: [0.02, 0.4, 0.01], every: [0.01, 0.2, 0.005], pitch: [0, 1, 1],
  minRate: [0.1, 1, 0.05], maxRate: [1, 6, 0.25], hold: [0, 1, 1], smooth: [0, 0.95, 0.05],
};

const url = new URLSearchParams(location.search);
const P = { ...DEFAULTS };
for (const k in P) if (url.has(k)) P[k] = clampParam(k, parseFloat(url.get(k)));
const DEBUG = url.has('debug');

const canvas = document.getElementById('line');
const stage = document.getElementById('stage');
const timeEl = document.getElementById('time');
const statusEl = document.getElementById('status');
const btnPlay = document.getElementById('mode-play');
const btnScrub = document.getElementById('mode-scrub');

let line, buffer, reversed, ctx;
let mode = 'play';
let total = 0;            // seconds covered by the line
let head = null;          // current playhead in seconds (null = idle)

// play mode
let source = null, startedAt = 0, startPos = 0;

// scrub mode
let finger = null;        // { pos, lastPos, lastT, vel }
let nextGrain = 0, lastGrainPos = null, grainsThisSec = 0, grainsRate = 0;

function clampParam(k, v) {
  const [lo, hi] = LIMITS[k];
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULTS[k];
}

async function init() {
  line = await (await fetch('line.json?v=1')).json();
  total = line.levels.length * line.tickSeconds;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  // Let iPhone play even with the silent switch on.
  if (navigator.audioSession) try { navigator.audioSession.type = 'playback'; } catch (e) {}
  const bytes = await (await fetch('audio/ride.m4a?v=1')).arrayBuffer();
  buffer = await new Promise((ok, no) => ctx.decodeAudioData(bytes, ok, no));
  reversed = reverseBuffer(buffer);
  statusEl.hidden = true;
  resize();
  requestAnimationFrame(frame);
}

function reverseBuffer(b) {
  const r = ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const src = b.getChannelData(c), dst = r.getChannelData(c);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
  }
  return r;
}

// ---------- drawing ----------

let geo = null;
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const r = stage.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  const n = line.levels.length;
  const x0 = 14, x1 = r.width - 4;                   // a little room on the left for the start dot
  const pitch = (x1 - x0) / n;
  const maxH = Math.min(r.height * 0.32, 130);
  const maxMm = Math.max(...line.heightsMm);
  geo = { dpr, w: r.width, h: r.height, x0, x1, pitch, cy: r.height * 0.45,
    heights: line.heightsMm.map(mm => (mm / maxMm) * maxH),
    tick: Math.max(1, pitch * line.tickMm / (line.lengthMm / n)) };
  draw();
}

function draw() {
  const g = canvas.getContext('2d');
  const { dpr, w, h, x0, x1, pitch, cy, heights, tick } = geo;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--ink'), faint = css.getPropertyValue('--faint'), red = css.getPropertyValue('--head');
  const headX = head == null ? null : x0 + (head / total) * (x1 - x0);

  g.strokeStyle = ink; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x0 - 4, cy); g.lineTo(x1, cy); g.stroke();
  g.beginPath(); g.arc(x0 - 8, cy, 3, 0, Math.PI * 2); g.stroke();

  g.lineWidth = tick;
  line.levels.forEach((lvl, i) => {
    const x = x0 + (i + 0.5) * pitch;
    g.strokeStyle = headX != null && x > headX ? faint : ink;
    const half = heights[lvl] / 2;
    g.beginPath(); g.moveTo(x, cy - half); g.lineTo(x, cy + half); g.stroke();
  });

  if (headX != null) {
    g.strokeStyle = red; g.lineWidth = 2;
    const top = heights[heights.length - 1] / 2 + 14;
    g.beginPath(); g.moveTo(headX, cy - top); g.lineTo(headX, cy + top); g.stroke();
    timeEl.textContent = fmt(head) + ' / ' + fmt(total);
  } else {
    timeEl.textContent = fmt(0) + ' / ' + fmt(total);
  }
}

const fmt = s => `0:${String(Math.floor(s)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;

function posFromX(clientX) {
  const r = stage.getBoundingClientRect();
  const x = clientX - r.left;
  return Math.min(total, Math.max(0, ((x - geo.x0) / (geo.x1 - geo.x0)) * total));
}

// ---------- play mode ----------

function playFrom(pos) {
  stopPlay();
  source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0, pos);
  startedAt = ctx.currentTime; startPos = pos;
  const s = source;
  s.onended = () => { if (source === s) { source = null; head = null; } };
}
function stopPlay() {
  if (source) { const s = source; source = null; try { s.stop(); } catch (e) {} }
}

// ---------- scrub mode ----------

const hann = (() => { const n = 64, a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.sin(Math.PI * i / (n - 1)) ** 2; return a; })();

function grain(pos, rate, backwards) {
  const when = Math.max(ctx.currentTime + 0.005, nextGrain);
  const src = ctx.createBufferSource();
  src.buffer = backwards ? reversed : buffer;
  src.playbackRate.value = rate;
  const env = ctx.createGain();
  env.gain.value = 0;
  env.gain.setValueCurveAtTime(hann, when, P.grain);
  src.connect(env).connect(ctx.destination);
  const span = P.grain * rate;                    // seconds of audio this grain covers
  let offset = backwards ? buffer.duration - pos : pos;
  offset = Math.min(Math.max(0, offset - span / 2), buffer.duration - span);
  src.start(when, Math.max(0, offset), span);
  src.stop(when + P.grain + 0.01);
  nextGrain = when + P.every;
  grainsThisSec++;
}

function scrubTick(now) {
  if (!finger) return;
  const dt = Math.max(1e-3, (now - finger.lastT) / 1000);
  const raw = (finger.pos - finger.lastPos) / dt;  // audio seconds per real second
  finger.vel = P.smooth * finger.vel + (1 - P.smooth) * raw;
  finger.lastPos = finger.pos; finger.lastT = now;
  if (ctx.currentTime + 0.02 < nextGrain) return;   // next grain already scheduled
  const moving = lastGrainPos == null || Math.abs(finger.pos - lastGrainPos) > 0.004;
  if (!moving && !P.hold) return;
  const speed = Math.abs(finger.vel);
  const rate = P.pitch ? Math.min(P.maxRate, Math.max(P.minRate, speed || 1)) : 1;
  grain(finger.pos, rate, finger.vel < -0.05);
  lastGrainPos = finger.pos;
}

// ---------- input ----------

let pointerId = null;
stage.addEventListener('pointerdown', e => {
  if (!buffer) return;
  ctx.resume();
  pointerId = e.pointerId;
  try { stage.setPointerCapture(e.pointerId); } catch (err) {}
  const pos = posFromX(e.clientX);
  if (mode === 'play') playFrom(pos);
  else { finger = { pos, lastPos: pos, lastT: performance.now(), vel: 0 }; lastGrainPos = null; }
  head = pos;
});
stage.addEventListener('pointermove', e => {
  if (e.pointerId !== pointerId) return;
  const pos = posFromX(e.clientX);
  if (mode === 'play') { if (Math.abs(pos - head) > line.tickSeconds) playFrom(pos); }
  else if (finger) { finger.pos = pos; head = pos; }
});
const up = e => {
  if (e.pointerId !== pointerId) return;
  pointerId = null;
  if (mode === 'scrub') finger = null;
};
stage.addEventListener('pointerup', up);
stage.addEventListener('pointercancel', up);

function setMode(m) {
  mode = m;
  stopPlay(); finger = null; head = null;
  btnPlay.classList.toggle('on', m === 'play');
  btnScrub.classList.toggle('on', m === 'scrub');
  document.getElementById('hint').textContent = m === 'play'
    ? 'גע בקו כדי לשמוע את המקום הזה בדרך'
    : 'גרור את האצבע לאורך הקו. המהירות והכיוון קובעים את הצליל';
  syncUrl();
}
btnPlay.onclick = () => setMode('play');
btnScrub.onclick = () => setMode('scrub');
if (url.get('mode') === 'scrub') setMode('scrub');
window.addEventListener('resize', () => line && resize());

// ---------- loop ----------

let lastSec = performance.now();
function frame(now) {
  if (mode === 'play' && source) head = Math.min(total, startPos + (ctx.currentTime - startedAt));
  if (mode === 'scrub') scrubTick(now);
  if (now - lastSec > 1000) { grainsRate = grainsThisSec; grainsThisSec = 0; lastSec = now; }
  draw();
  if (DEBUG) debugTick(now);
  requestAnimationFrame(frame);
}

// ---------- debug overlay (?debug) ----------

const log = [];
let lastLog = 0, fps = 0, frames = 0, fpsT = performance.now();
const dbg = document.getElementById('debug');

function syncUrl() {
  const q = new URLSearchParams();
  if (DEBUG) q.set('debug', '');
  if (mode !== 'play') q.set('mode', mode);
  for (const k in P) if (P[k] !== DEFAULTS[k]) q.set(k, +P[k].toFixed(3));
  history.replaceState(null, '', '?' + q.toString().replace('debug=', 'debug'));
}

function buildDebug() {
  dbg.hidden = false;
  dbg.innerHTML = '<div id="dbg-live"></div>' + Object.keys(P).map(k =>
    `<div class="row"><span>${k} <b id="v-${k}"></b></span><button data-k="${k}" data-d="-1">−</button><button data-k="${k}" data-d="1">+</button></div>`
  ).join('') + '<div class="row"><button id="dbg-copy">Copy log</button><button id="dbg-save">Save log</button></div>';
  dbg.addEventListener('click', e => {
    const k = e.target.dataset.k;
    if (k) { P[k] = clampParam(k, +(P[k] + LIMITS[k][2] * e.target.dataset.d).toFixed(3)); syncUrl(); }
  });
  document.getElementById('dbg-copy').onclick = () => navigator.clipboard.writeText(logText());
  document.getElementById('dbg-save').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([logText()], { type: 'text/plain' }));
    a.download = `scrub-log-${Date.now()}.txt`; a.click();
  };
}
const logText = () => `params ${JSON.stringify(P)}\nmode ${mode}\n` + log.join('\n');

function debugTick(now) {
  frames++;
  if (now - fpsT > 500) { fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; }
  for (const k in P) document.getElementById('v-' + k).textContent = P[k];
  const vel = finger ? finger.vel.toFixed(2) : '-';
  document.getElementById('dbg-live').textContent =
    `fps ${fps}  pos ${head == null ? '-' : head.toFixed(2)}  vel ${vel}  grains/s ${grainsRate}`;
  if (now - lastLog > 250) {
    lastLog = now;
    log.push(`${(now / 1000).toFixed(2)} mode=${mode} pos=${head == null ? '-' : head.toFixed(3)} vel=${vel} grains/s=${grainsRate}`);
    if (log.length > 2400) log.shift();
  }
}

if (DEBUG) buildDebug();
init().catch(err => { statusEl.textContent = 'שגיאה בטעינה: ' + err.message; });
