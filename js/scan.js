// Stage 1: the camera reads the printed line; the moment under the red mark plays.
// Two modes, one continuous voice:
// "play": the ride always plays at real time; only a deliberate move (more than `moveMm`) jumps it there.
// Distances are in mm along the printed line, so the same settings fit a 30 s or a 30 min recording.
// "scrub": the camera is the playhead; a resting camera is silence. Near 1x both lock to real time.
// "glide" (forgiving scrub): sounds only while moving; any comfortable forward movement plays at real time,
//   catching up with tiny speed changes or soft jumps; very fast forward and backwards behave like scrub.

const DEFAULTS = {
  band: 0.26,      // reading frame height, fraction of the screen
  width: 0.92,     // reading frame width, fraction of the screen
  proc: 800,       // processing width, px
  k: 0.12,         // ink: how much darker than its surroundings
  win: 25,         // ink: neighbourhood size, px
  maxTilt: 12,     // degrees of line tilt searched
  edgeMin: 12,     // skyline: brightness step needed to call an edge the water line
  minTicks: 6,     // ticks needed for a reading
  maxErr: 1,       // misread tick heights always allowed
  errFrac: 0.1,    // ...or this fraction of the ticks seen
  jumpMm: 2.5,     // a reading this far (mm) from the last one must repeat `confirm` times
  confirm: 2,
  lostMs: 400,     // no reading for this long = line lost
  moveMm: 2.5,     // play: the camera must move this far (mm) to count as a move; less = hand shake
  settleMm: 0.6,   // play: after a move, the camera counts as settled when it stays within this (mm)...
  settleMs: 150,   // ...for this long; then the sound jumps there
  snap: 0.25,      // scrub: camera speed within 1 ± snap plays at exactly real time
  tau: 0.25,       // scrub: camera speed smoothing, seconds
  driftMm: 1.2,    // scrub: lag (mm) allowed before pulling the sound to the camera
  pull: 0.15,      // scrub: how hard, per mm beyond driftMm
  farMm: 4,        // scrub: sound this far (mm) from the camera is restarted at the camera
  stopMm: 0.8,     // scrub: camera slower than this (mm/s) = silence
  minRate: 0.35, maxRate: 3,
  // glide mode, all distances/speeds in mm along the printed line (so they fit any recording length)
  gStart: 2.5,     // from rest, the hand must travel this far (mm) one way before the sound starts
  gStill: 1,       // moving hand slower than this (mm/s) counts as resting
  gHold: 350,      // resting this long (ms) before the sound stops
  gFast: 15,       // forward faster than this (mm/s) = fast forward, the sound speeds up with the hand
  gNudge: 1.5,     // sound this far (mm) from the camera: start nudging its speed (barely audible)
  gLead: 4,        // camera this far (mm) ahead of the sound: soft jump to the camera
  gLag: 8,         // camera this far (mm) behind the sound: soft jump back
  gRef: 4,         // glide: hand speed (mm/s) that plays at exactly real time
  gFollow: 0.3,    // how much the sound's speed follows the hand's: 0 = always real time, 1 = fully
  gUp: 1.12,       // fastest nudge
  gDown: 0.92,     // slowest nudge
};
const LIMITS = {
  band: [0.1, 0.6, 0.02], width: [0.5, 1, 0.02], proc: [400, 1600, 100],
  k: [0.02, 0.4, 0.02], win: [9, 81, 4], maxTilt: [0, 30, 2], edgeMin: [2, 60, 2], minTicks: [4, 15, 1],
  maxErr: [0, 4, 1], errFrac: [0, 0.3, 0.02], jumpMm: [0.5, 15, 0.5], confirm: [1, 6, 1],
  lostMs: [100, 2000, 50], moveMm: [0.5, 15, 0.5], settleMm: [0.1, 5, 0.1], settleMs: [0, 1000, 50],
  snap: [0, 0.6, 0.05], tau: [0.05, 1, 0.05], driftMm: [0.2, 6, 0.2], pull: [0, 1, 0.05], farMm: [1, 20, 0.5],
  stopMm: [0.1, 5, 0.1], minRate: [0.1, 1, 0.05], maxRate: [1, 6, 0.25],
  gStart: [0.5, 15, 0.5], gStill: [0.2, 10, 0.2], gHold: [0, 2000, 50], gFast: [3, 60, 1], gNudge: [0.25, 10, 0.25],
  gLead: [1, 30, 0.5], gLag: [1, 40, 1], gRef: [0.5, 20, 0.5], gFollow: [0, 1, 0.05], gUp: [1, 1.5, 0.02], gDown: [0.6, 1, 0.02],
};

const url = new URLSearchParams(location.search);
const P = { ...DEFAULTS };
for (const k in P) if (url.has(k)) P[k] = clampParam(k, parseFloat(url.get(k)));
const DEBUG = url.has('debug');
const LINE = /^[\w-]+$/.test(url.get('line') || '') ? url.get('line') : 'sky-95-old-final';   // default = the printed tattoo, so the plain link (and its QR code) always works

const video = document.getElementById('cam');
const overlay = document.getElementById('overlay');
const hintEl = document.getElementById('hint');
const btnPlay = document.getElementById('mode-play');
const btnGlide = document.getElementById('mode-glide');
const proc = document.createElement('canvas');
const pctx = proc.getContext('2d', { willReadFrequently: true });

let line, buffer, reversed, ctx, total = 0;
let spm = 1;              // seconds of ride per mm of printed line
let mode = ['scrub', 'play'].includes(url.get('mode')) ? url.get('mode') : 'glide';
let last = null, detMs = 0, geo = null, gray = null;
const cam = { pos: null, seen: -1e9, pending: null };   // accepted camera position on the ride
let wasLocked = false;

function clampParam(k, v) {
  const [lo, hi] = LIMITS[k];
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULTS[k];
}

// ---------- start ----------

document.getElementById('go').onclick = async () => {
  const err = document.getElementById('err');
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (navigator.audioSession) try { navigator.audioSession.type = 'playback'; } catch (e) {}
    ctx.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    const track = stream.getVideoTracks()[0];
    try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) {}
    err.textContent = 'טוען…';
    line = await (await fetch(LINE + '.json?v=1')).json();
    total = line.levels.length * line.tickSeconds;
    spm = total / line.lengthMm;
    const bytes = await (await fetch(line.audio + '?v=1')).arrayBuffer();
    buffer = await new Promise((ok, no) => ctx.decodeAudioData(bytes, ok, no));
    reversed = reverseBuffer(buffer);
    document.getElementById('start').hidden = true;
    resize();
    if ('requestVideoFrameCallback' in video) {
      const onFrame = () => { process(performance.now()); video.requestVideoFrameCallback(onFrame); };
      video.requestVideoFrameCallback(onFrame);
    }
    requestAnimationFrame(frame);
  } catch (e) {
    err.textContent = 'לא הצלחתי להפעיל את המצלמה: ' + e.message;
  }
};

function reverseBuffer(b) {
  const r = ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const src = b.getChannelData(c), dst = r.getChannelData(c);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
  }
  return r;
}

// ---------- camera -> position ----------

function geometry() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const sw = innerWidth, sh = innerHeight;
  const cs = Math.max(sw / vw, sh / vh);                 // object-fit: cover
  const offX = (sw - vw * cs) / 2, offY = (sh - vh * cs) / 2;
  const bw = sw * P.width, bh = sh * P.band, bx = (sw - bw) / 2, by = sh * 0.4 - bh / 2;
  const srcW = bw / cs, srcH = bh / cs;
  const pw = Math.round(Math.min(P.proc, srcW)), ph = Math.round(pw * bh / bw);
  return { bx, by, bw, bh, sx: (bx - offX) / cs, sy: (by - offY) / cs, srcW, srcH, pw, ph };
}

function process(now) {
  if (!line || video.readyState < 2 || !video.videoWidth) return;
  geo = geometry();
  const { pw, ph } = geo;
  if (proc.width !== pw || proc.height !== ph) { proc.width = pw; proc.height = ph; gray = new Uint8ClampedArray(pw * ph); }
  pctx.drawImage(video, geo.sx, geo.sy, geo.srcW, geo.srcH, 0, 0, pw, ph);
  const d = pctx.getImageData(0, 0, pw, ph).data;
  for (let i = 0, n = pw * ph; i < n; i++) gray[i] = (d[i * 4] + 2 * d[i * 4 + 1] + d[i * 4 + 2]) >> 2;
  const t0 = performance.now();
  last = Reader.detect(gray, pw, ph, P, line);
  detMs = performance.now() - t0;
  if (last.found && accept(last.t, now)) onReading(now);
  const locked = isLocked(now);
  if (!locked && wasLocked) onLost();
  wasLocked = locked;
}

function accept(t, now) {
  if (isLocked(now) && Math.abs(t - cam.pos) < P.jumpMm * spm) { cam.pos = t; cam.seen = now; cam.pending = null; return true; }
  if (cam.pending && Math.abs(t - cam.pending.t) < P.jumpMm * spm) {
    cam.pending.t = t;
    if (++cam.pending.n >= P.confirm) { cam.pos = t; cam.seen = now; cam.pending = null; cam.jumped = true; return true; }
  } else cam.pending = { t, n: 1 };
  return false;
}
const isLocked = now => cam.pos != null && now - cam.seen < P.lostMs;

// ---------- sound ----------

let paused = false;
let rd = null;            // camera: { pos, lastPos, lastT, vel } + play-mode move tracking
let voice = null;         // { src, gain, dir, pos, rate, t }

function onReading(now) {
  const pos = cam.pos;
  if (cam.jumped) { rd = null; cam.jumped = false; }     // a jump is a new place, not a fast movement
  if (!rd) rd = { pos, lastPos: pos, lastT: now, vel: 0, anchor: null };
  else rd.pos = pos;
  if (mode === 'play') { if (!paused) playTick(now); }
  else if (mode === 'glide') glideTick(now);
  else tapeTick(now);
}

function onLost() {
  // scrub: silence; glide: frame() stops it if the line stays lost; play: the ride plays on, forwards at 1x
  if (mode === 'scrub') stopVoice();
  else if (mode === 'glide') { /* keep going for a moment */ }
  else if (voice) {
    if (voice.dir < 0) startVoice(1, voicePos());
    else { voice.pos = voicePos(); voice.t = ctx.currentTime; voice.rate = 1; voice.src.playbackRate.setTargetAtTime(1, ctx.currentTime, 0.03); }
  }
  rd = null;
}

function voicePos() {
  return voice ? voice.pos + voice.dir * voice.rate * (ctx.currentTime - voice.t) : null;
}
const soundPos = voicePos;

function startVoice(dir, pos) {
  stopVoice();
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = dir > 0 ? buffer : reversed;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(1, t + 0.02);
  src.connect(gain).connect(ctx.destination);
  src.start(t, Math.max(0, dir > 0 ? pos : buffer.duration - pos));
  voice = { src, gain, dir, pos, rate: 1, t };
}

function stopVoice() {
  if (!voice) return;
  const t = ctx.currentTime, v = voice;
  voice = null;
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setValueAtTime(v.gain.gain.value, t);
  v.gain.gain.linearRampToValueAtTime(0, t + 0.04);
  v.src.stop(t + 0.06);
}

function tapeTick(now) {
  const dt = (now - rd.lastT) / 1000;
  if (dt <= 0) return;
  const raw = (rd.pos - rd.lastPos) / dt;
  rd.vel += (1 - Math.exp(-dt / P.tau)) * (raw - rd.vel);
  rd.lastPos = rd.pos; rd.lastT = now;

  const t = ctx.currentTime;
  if (voice) { voice.pos += voice.dir * voice.rate * (t - voice.t); voice.t = t; }
  const speed = Math.abs(rd.vel), dir = rd.vel < 0 ? -1 : 1;

  const handMm = speed / spm;                           // camera speed along the line, mm/s
  if (!voice) { if (handMm > P.stopMm * 2) startVoice(dir, rd.pos); else return; }
  else if (handMm < P.stopMm) { stopVoice(); return; }
  else if (dir !== voice.dir && handMm > P.stopMm * 2) startVoice(dir, rd.pos);
  if (Math.abs(rd.pos - voice.pos) > P.farMm * spm) startVoice(dir, rd.pos);

  let rate = Math.abs(speed - 1) < P.snap ? 1 : speed;
  rate = Math.min(P.maxRate, Math.max(P.minRate, rate * follow(rd.pos - voice.pos, voice.dir)));
  voice.src.playbackRate.setTargetAtTime(rate, t, 0.03);
  voice.rate = rate;
  if (voice.pos < 0 || voice.pos > buffer.duration) stopVoice();
}

// Speed factor that pulls the sound back to the camera once it has drifted more than driftMm.
function follow(diffS, dir) {
  const errMm = diffS * dir / spm;
  return Math.abs(errMm) > P.driftMm ? 1 + P.pull * (errMm - Math.sign(errMm) * P.driftMm) : 1;
}

// Play mode: always real time, forwards. Small camera motions are ignored. A move of more than `moveMm`
// from where the camera rested jumps the sound there once the camera settles (unless the sound is already there).
function playTick(now) {
  const sp = voicePos();
  const land = () => {
    rd.anchor = rd.pos; rd.moving = false;
    if (!voice || Math.abs(rd.pos - sp) > P.moveMm * spm) startVoice(1, rd.pos);
  };
  if (rd.anchor == null) return land();
  if (!rd.moving) {
    if (Math.abs(rd.pos - rd.anchor) > P.moveMm * spm) { rd.moving = true; rd.mPos = rd.pos; rd.mT = now; }
    return;
  }
  if (Math.abs(rd.pos - rd.mPos) > P.settleMm * spm) { rd.mPos = rd.pos; rd.mT = now; return; }
  if (now - rd.mT >= P.settleMs) land();
}

// Glide mode: as much real-time playback as possible while the camera moves forwards.
function glideTick(now) {
  const dt = (now - rd.lastT) / 1000;
  if (dt <= 0) return;
  const raw = (rd.pos - rd.lastPos) / dt;
  rd.vel += (1 - Math.exp(-dt / P.tau)) * (raw - rd.vel);
  rd.lastPos = rd.pos; rd.lastT = now;
  const hs = rd.vel / spm;                              // hand speed, mm/s (negative = backwards)
  const t = ctx.currentTime;
  if (voice) { voice.pos = voicePos(); voice.t = t; }

  // what the hand is doing. From rest it must really travel `gStart` mm one way (shake goes back and forth
  // around a point and never gets there); once moving, a direction change needs a clear speed the other way.
  let g = rd.glide || 'still';
  if (g === 'still') {
    if (rd.restAt == null) rd.restAt = rd.pos;
    const moved = (rd.pos - rd.restAt) / spm;
    if (moved >= P.gStart) g = hs >= P.gFast ? 'fast' : 'fwd';
    else if (moved <= -P.gStart) g = 'back';
  } else if (Math.abs(hs) < P.gStill) {
    rd.stillSince = rd.stillSince || now;
    if (now - rd.stillSince > P.gHold) { g = 'still'; rd.restAt = rd.pos; }
  } else {
    rd.stillSince = 0;
    if (hs <= -2 * P.gStill) g = 'back';
    else if (hs >= P.gFast) g = 'fast';
    else if (hs >= 2 * P.gStill || g === 'fast') g = 'fwd';
  }
  rd.glide = g;

  if (g === 'still') { stopVoice(); return; }
  if (rd.stillSince) return;                            // resting briefly: the sound carries on as it is

  let rate = 1;
  if (g === 'back' || g === 'fast') {
    const dir = g === 'back' ? -1 : 1, speed = Math.abs(rd.vel);
    if (!voice || voice.dir !== dir || Math.abs(rd.pos - voice.pos) > P.farMm * spm) startVoice(dir, rd.pos);
    rate = Math.abs(speed - 1) < P.snap ? 1 : speed;
    rate = Math.min(P.maxRate, Math.max(dir > 0 ? 1 : P.minRate, rate * follow(rd.pos - voice.pos, voice.dir)));
  } else {
    if (!voice || voice.dir < 0) startVoice(1, rd.pos);
    const gap = (rd.pos - voice.pos) / spm;             // mm, > 0: camera ahead of the sound
    // part of the hand's pace relative to gRef (near gRef: exactly real time), times a small nudge that closes the gap
    const ratio = Math.max(0, hs) / P.gRef;
    const pace = Math.abs(ratio - 1) < P.snap ? 1 : 1 + P.gFollow * (ratio - 1);
    let nudge = 1;
    if (gap > P.gLead || gap < -P.gLag) startVoice(1, rd.pos);
    else if (gap > P.gNudge) nudge = 1 + (P.gUp - 1) * Math.min(1, (gap - P.gNudge) / (P.gLead - P.gNudge));
    else if (gap < -P.gNudge) nudge = 1 - (1 - P.gDown) * Math.min(1, (-gap - P.gNudge) / (P.gLag - P.gNudge));
    rate = Math.min(P.maxRate, Math.max(P.minRate, pace * nudge));
  }
  voice.src.playbackRate.setTargetAtTime(rate, t, 0.05);
  voice.rate = rate;
}

// ---------- start screen ----------

// A thin black line runs up the middle of the start screen, broken around the title, text and button,
// trembling a little as if it were carrying the sound.
(function pulse() {
  const start = document.getElementById('start'), cv = document.getElementById('pulse');
  const title = start.querySelector('h1'), btn = document.getElementById('go');
  const gap = 28;
  function frame(now) {
    if (start.hidden) return;
    const dpr = window.devicePixelRatio || 1, w = start.clientWidth, h = start.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const t = now / 1000, cx = w / 2;
    // the strength swells and fades slowly, like a voice
    const amp = 1.1 + 1.0 * Math.max(0, Math.sin(t * 1.3) * Math.sin(t * 0.47 + 1) + 0.3 * Math.sin(t * 3.1));
    const at = y => cx + amp * (Math.sin(y * 0.09 + t * 17) * 0.8 + Math.sin(y * 0.031 - t * 9) * 0.6 + Math.sin(y * 0.23 + t * 29) * 0.25);
    g.strokeStyle = '#1b1a17'; g.lineWidth = 1;
    const seg = (y0, y1) => {
      if (y1 - y0 < 4) return;
      g.beginPath();
      for (let y = y0; y <= y1; y += 2) {
        const fade = Math.min(1, (y - y0) / 30, (y1 - y) / 30);   // the ends stay still
        const x = cx + (at(y) - cx) * fade;
        y === y0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    };
    const top = title.getBoundingClientRect().top, bottom = btn.getBoundingClientRect().bottom;
    seg(0, top - gap);
    seg(bottom + gap, h);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

// ---------- drawing ----------

function resize() {
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(innerWidth * dpr);
  overlay.height = Math.round(innerHeight * dpr);
}
window.addEventListener('resize', resize);

// The ride map is a white tyre track. Only the stretches the sound has passed are printed solid;
// the rest is a faint ghost of the tread, so every viewing leaves its own trail.
let tread = null;         // pre-rendered tread texture { c, w, h, dpr }
let trail = null;         // per tick: has the sound passed here
let trailLast = -1;

function makeTread(w, h, dpr) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = '#fff';
  const pitch = 10, lug = 6, slant = 5, row = h * 0.4, mid = h * 0.12;
  const rowB = h - row;                                // bottom row starts here
  for (let x = -pitch; x < w + pitch; x += pitch) {
    // top row leans right, bottom row leans left (a chevron tread)
    g.beginPath(); g.moveTo(x, row); g.lineTo(x + slant, 0); g.lineTo(x + slant + lug, 0); g.lineTo(x + lug, row); g.fill();
    g.beginPath(); g.moveTo(x, rowB); g.lineTo(x + lug, rowB); g.lineTo(x + lug + slant, h); g.lineTo(x + slant, h); g.fill();
    g.fillRect(x + pitch / 2, h / 2 - mid / 2, pitch - 3, mid);   // thin centre rib
  }
  // dirt: specks and a few blotches knocked out of the white
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < w * h / 9; i++) {
    g.beginPath(); g.arc(rnd() * w, rnd() * h, 0.3 + rnd() * rnd() * 1.4, 0, 7); g.fill();
  }
  for (let i = 0; i < w / 14; i++) {
    const cx = rnd() * w, cy = rnd() * h;
    for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(cx + (rnd() - .5) * 5, cy + (rnd() - .5) * 4, 0.5 + rnd() * 1.3, 0, 7); g.fill(); }
  }
  return { c, w, h, dpr };
}

// mark the ticks the sound has passed since the last frame (filling small gaps, not jumps)
function markTrail(sp) {
  const n = line.levels.length;
  if (!trail) trail = new Uint8Array(n);
  if (sp == null) { trailLast = -1; return; }
  const i = Math.min(n - 1, Math.max(0, Math.floor(sp / line.tickSeconds)));
  if (trailLast >= 0 && Math.abs(i - trailLast) <= 3) {
    for (let k = Math.min(i, trailLast); k <= Math.max(i, trailLast); k++) trail[k] = 1;
  }
  trail[i] = 1;
  trailLast = i;
}

function hint(now) {
  if (isLocked(now)) return mode === 'play' && paused ? 'מושהה. גע במסך כדי להמשיך' : '';
  if (!last || last.reason === 'no line') return 'כוון את הקו לתוך המסגרת';
  if (last.pitch && last.pitch < 7) return 'התקרב לדף';
  if (last.pitch && last.pitch > 60) return 'התרחק מעט מהדף';
  if (last.reason === 'few ticks') return 'הנח את הקו לאורך המסגרת';
  return 'רגע…';
}

function draw(now) {
  const g = overlay.getContext('2d'), dpr = window.devicePixelRatio || 1;
  const sw = innerWidth, sh = innerHeight;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, sw, sh);
  if (!geo) return;
  const { bx, by, bw, bh, pw, ph } = geo;
  const locked = isLocked(now);

  // dim everything outside the reading frame
  g.fillStyle = 'rgba(0,0,0,.4)';
  g.fillRect(0, 0, sw, by); g.fillRect(0, by + bh, sw, sh - by - bh);
  g.fillRect(0, by, bx, bh); g.fillRect(bx + bw, by, sw - bx - bw, bh);
  // four white corners mark the reading frame
  const cl = Math.min(22, bw / 4, bh / 4);
  g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.lineCap = 'round';
  g.beginPath();
  for (const [x, y, dx, dy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]]) {
    g.moveTo(x + dx * cl, y); g.lineTo(x, y); g.lineTo(x, y + dy * cl);
  }
  g.stroke();
  g.lineCap = 'butt';
  g.strokeStyle = '#d4553c'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(bx + bw / 2, by - 10); g.lineTo(bx + bw / 2, by + bh + 10); g.stroke();

  // ticks the camera sees
  if (last && last.ticks) {
    for (const t of last.ticks) {
      g.fillStyle = t.ok === undefined ? 'rgba(243,239,231,.8)' : t.ok ? '#7fd18b' : '#d4553c';
      g.beginPath(); g.arc(bx + t.x / pw * bw, by + t.top / ph * bh - 5, 2.5, 0, 7); g.fill();
    }
  }

  // the whole line, with where the sound is and where the camera is
  const foot = document.querySelector('footer').getBoundingClientRect().top;
  const mx0 = 16, mx1 = sw - 16, my = foot - 44, n = line.levels.length, step = (mx1 - mx0) / n;
  g.save();
  g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 3;     // white on the camera image, a soft shadow keeps it legible on light skin
  const sp = soundPos();
  markTrail(sp);
  const th = 28, ty = my - th / 2;
  if (!tread || tread.w !== mx1 - mx0 || tread.dpr !== dpr) tread = makeTread(mx1 - mx0, th, dpr);
  g.globalAlpha = 0.22;                                 // the tread not yet ridden
  g.drawImage(tread.c, mx0, ty, tread.w, th);
  g.globalAlpha = 1;
  const k = tread.c.width / tread.w;
  for (let i = 0; i < n; i++) {
    if (!trail[i]) continue;
    let j = i; while (j + 1 < n && trail[j + 1]) j++;     // draw each ridden stretch in one go
    const x = i * step, wd = (j - i + 1) * step;
    g.drawImage(tread.c, x * k, 0, wd * k, tread.c.height, mx0 + x, ty, wd, th);
    i = j;
  }
  if (cam.pos != null) {
    const x = mx0 + cam.pos / total * (mx1 - mx0);
    g.fillStyle = locked ? '#fff' : 'rgba(255,255,255,.45)';
    g.beginPath(); g.moveTo(x, my + 19); g.lineTo(x - 5, my + 25); g.lineTo(x + 5, my + 25); g.fill();
  }
  if (sp != null) {
    const x = mx0 + sp / total * (mx1 - mx0);
    g.strokeStyle = '#d4553c'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, my - 22); g.lineTo(x, my + 18); g.stroke();
  }
  g.restore();
  hintEl.textContent = hint(now);
}

// ---------- input ----------

overlay.addEventListener('pointerdown', () => {
  if (!ctx) return;
  ctx.resume();
  if (mode !== 'play') return;
  paused = !paused;
  if (paused) stopVoice();
  else if (isLocked(performance.now())) startVoice(1, cam.pos);
});

function setMode(m) {
  mode = m;
  stopVoice(); rd = null; paused = false;
  btnPlay.classList.toggle('on', m === 'play');
  btnGlide.classList.toggle('on', m === 'glide');
  syncUrl();
}
btnPlay.onclick = () => setMode('play');
btnGlide.onclick = () => setMode('glide');
btnPlay.classList.toggle('on', mode === 'play');
btnGlide.classList.toggle('on', mode === 'glide');

// ---------- loop ----------

function frame(now) {
  if (!('requestVideoFrameCallback' in video)) process(now);
  const vp = voicePos();
  if (vp != null && (vp < 0 || vp > buffer.duration)) stopVoice();   // ran off an end of the ride
  if (mode === 'glide' && voice && now - cam.seen > P.lostMs + P.gHold) stopVoice();   // line lost for a while
  draw(now);
  if (DEBUG) debugTick(now);
  requestAnimationFrame(frame);
}

// ---------- debug overlay (?debug) ----------

const log = [];
let lastLog = 0, fps = 0, frames = 0, fpsT = performance.now(), procCount = 0, procFps = 0;
const dbg = document.getElementById('debug');
const _process = process;
process = now => { procCount++; _process(now); };

function syncUrl() {
  const q = new URLSearchParams();
  if (DEBUG) q.set('debug', '');
  if (mode !== 'glide') q.set('mode', mode);
  if (LINE !== 'sky-95-old-final') q.set('line', LINE);
  for (const k in P) if (P[k] !== DEFAULTS[k]) q.set(k, +(+P[k]).toFixed(3));
  const qs = q.toString().replace('debug=', 'debug');
  history.replaceState(null, '', qs ? '?' + qs : location.pathname);
}

function buildDebug() {
  dbg.hidden = false;
  dbg.innerHTML = '<div id="dbg-live"></div><canvas id="dbg-mask"></canvas>' + Object.keys(P).map(k =>
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
    a.download = `scan-log-${Date.now()}.txt`; a.click();
  };
}
const logText = () => `params ${JSON.stringify(P)}\nmode ${mode}\nua ${navigator.userAgent}\n` + log.join('\n');

function debugTick(now) {
  frames++;
  if (now - fpsT > 500) { fps = Math.round(frames * 1000 / (now - fpsT)); procFps = Math.round(procCount * 1000 / (now - fpsT)); frames = 0; procCount = 0; fpsT = now; }
  for (const k in P) document.getElementById('v-' + k).textContent = P[k];
  const r = last || {}, sp = soundPos();
  const line1 = `fps ${fps} read/s ${procFps} det ${detMs.toFixed(1)}ms ${geo ? geo.pw + 'x' + geo.ph : ''} cam ${video.videoWidth}x${video.videoHeight}`;
  const line2 = `${r.found ? 'FOUND' : r.reason || '-'} ticks ${r.ticks ? r.ticks.length : 0} pitch ${r.pitch ? r.pitch.toFixed(1) : '-'} tilt ${r.base ? r.base.deg : '-'} scale ${r.scale ? r.scale.toFixed(2) : '-'}/${r.offset != null ? r.offset.toFixed(2) : '-'}`;
  const line3 = `mis ${r.match ? r.match.mis : '-'} 2nd ${r.second ? r.second.mis : '-'} dir ${r.dir || '-'} read ${r.t != null ? r.t.toFixed(2) : '-'} cam ${cam.pos != null ? cam.pos.toFixed(2) : '-'} sound ${sp != null ? sp.toFixed(2) : '-'} vel ${rd ? rd.vel.toFixed(2) : '-'}${rd && rd.glide ? ' glide ' + rd.glide : ''}`;
  document.getElementById('dbg-live').innerHTML = line1 + '<br>' + line2 + '<br>' + line3;
  if (r.mask && geo) {
    const c = document.getElementById('dbg-mask');
    if (c.width !== geo.pw || c.height !== geo.ph) { c.width = geo.pw; c.height = geo.ph; }
    const cg = c.getContext('2d'), img = cg.createImageData(geo.pw, geo.ph);
    for (let i = 0; i < r.mask.length; i++) { const v = r.mask[i] ? 0 : 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    cg.putImageData(img, 0, 0);
  }
  if (now - lastLog > 250) {
    lastLog = now;
    log.push(`${(now / 1000).toFixed(2)} ${line2} | ${line3} | det ${detMs.toFixed(1)}ms read/s ${procFps}`);
    if (log.length > 2400) log.shift();
  }
}

if (DEBUG) buildDebug();
