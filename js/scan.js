// Stage 1: the camera reads the printed line; the moment under the red mark plays.
// Two modes, one continuous voice:
// "play": the ride always plays at real time; only a deliberate move (more than `moveMin`) jumps it there.
// "scrub": the camera is the playhead; a resting camera is silence. Near 1x both lock to real time.

const DEFAULTS = {
  band: 0.26,      // reading frame height, fraction of the screen
  width: 0.92,     // reading frame width, fraction of the screen
  proc: 800,       // processing width, px
  k: 0.12,         // ink: how much darker than its surroundings
  win: 25,         // ink: neighbourhood size, px
  maxTilt: 12,     // degrees of line tilt searched
  minTicks: 6,     // ticks needed for a reading
  maxErr: 1,       // misread tick heights always allowed
  errFrac: 0.1,    // ...or this fraction of the ticks seen
  jump: 0.6,       // a reading this far (s) from the last one must repeat `confirm` times
  confirm: 2,
  lostMs: 400,     // no reading for this long = line lost
  moveMin: 0.6,    // play: the camera must move this far (s of line, 0.6 s ≈ 3.5 mm) to count as a move; less = hand shake
  settle: 0.15,    // play: after a move, the camera counts as settled when it stays within this (s of line)...
  settleMs: 150,   // ...for this long; then the sound jumps there
  snap: 0.25,      // scrub: camera speed within 1 ± snap plays at exactly real time
  tau: 0.25,       // scrub: camera speed smoothing, seconds
  drift: 0.3,      // scrub: lag allowed before pulling the sound to the camera
  pull: 0.6,
  stopAt: 0.2,     // scrub: slower than this = silence
  minRate: 0.35, maxRate: 3,
};
const LIMITS = {
  band: [0.1, 0.6, 0.02], width: [0.5, 1, 0.02], proc: [400, 1600, 100],
  k: [0.02, 0.4, 0.02], win: [9, 81, 4], maxTilt: [0, 30, 2], minTicks: [4, 15, 1],
  maxErr: [0, 4, 1], errFrac: [0, 0.3, 0.02], jump: [0.2, 3, 0.1], confirm: [1, 6, 1],
  lostMs: [100, 2000, 50], moveMin: [0.1, 3, 0.1], settle: [0.05, 1, 0.05], settleMs: [0, 1000, 50],
  snap: [0, 0.6, 0.05], tau: [0.05, 1, 0.05], drift: [0.05, 1, 0.05], pull: [0, 2, 0.1],
  stopAt: [0.02, 0.6, 0.02], minRate: [0.1, 1, 0.05], maxRate: [1, 6, 0.25],
};

const url = new URLSearchParams(location.search);
const P = { ...DEFAULTS };
for (const k in P) if (url.has(k)) P[k] = clampParam(k, parseFloat(url.get(k)));
const DEBUG = url.has('debug');

const video = document.getElementById('cam');
const overlay = document.getElementById('overlay');
const hintEl = document.getElementById('hint');
const btnPlay = document.getElementById('mode-play');
const btnScrub = document.getElementById('mode-scrub');
const proc = document.createElement('canvas');
const pctx = proc.getContext('2d', { willReadFrequently: true });

let line, buffer, reversed, ctx, total = 0;
let mode = url.get('mode') === 'scrub' ? 'scrub' : 'play';
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
    line = await (await fetch('line.json?v=1')).json();
    total = line.levels.length * line.tickSeconds;
    const bytes = await (await fetch('audio/ride.m4a?v=1')).arrayBuffer();
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
  if (isLocked(now) && Math.abs(t - cam.pos) < P.jump) { cam.pos = t; cam.seen = now; cam.pending = null; return true; }
  if (cam.pending && Math.abs(t - cam.pending.t) < P.jump) {
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
  else tapeTick(now);
}

function onLost() {
  // scrub: silence; play: the ride plays on, forwards at real time
  if (mode === 'scrub') stopVoice();
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

  if (!voice) { if (speed > P.stopAt * 2) startVoice(dir, rd.pos); else return; }
  else if (speed < P.stopAt) { stopVoice(); return; }
  else if (dir !== voice.dir && speed > P.stopAt * 2) startVoice(dir, rd.pos);
  if (Math.abs(rd.pos - voice.pos) > 1) startVoice(dir, rd.pos);

  let rate = Math.abs(speed - 1) < P.snap ? 1 : speed;
  const err = (rd.pos - voice.pos) * voice.dir;
  if (Math.abs(err) > P.drift) rate *= 1 + P.pull * (err - Math.sign(err) * P.drift);
  rate = Math.min(P.maxRate, Math.max(P.minRate, rate));
  voice.src.playbackRate.setTargetAtTime(rate, t, 0.03);
  voice.rate = rate;
  if (voice.pos < 0 || voice.pos > buffer.duration) stopVoice();
}

// Play mode: always real time, forwards. Small camera motions are ignored. A move of more than `moveMin`
// from where the camera rested jumps the sound there once the camera settles (unless the sound is already there).
function playTick(now) {
  const sp = voicePos();
  const land = () => {
    rd.anchor = rd.pos; rd.moving = false;
    if (!voice || Math.abs(rd.pos - sp) > P.moveMin) startVoice(1, rd.pos);
  };
  if (rd.anchor == null) return land();
  if (!rd.moving) {
    if (Math.abs(rd.pos - rd.anchor) > P.moveMin) { rd.moving = true; rd.mPos = rd.pos; rd.mT = now; }
    return;
  }
  if (Math.abs(rd.pos - rd.mPos) > P.settle) { rd.mPos = rd.pos; rd.mT = now; return; }
  if (now - rd.mT >= P.settleMs) land();
}

// ---------- drawing ----------

function resize() {
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(innerWidth * dpr);
  overlay.height = Math.round(innerHeight * dpr);
}
window.addEventListener('resize', resize);

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
  g.strokeStyle = locked ? '#7fd18b' : 'rgba(243,239,231,.9)'; g.lineWidth = 2;
  g.strokeRect(bx, by, bw, bh);
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
  g.fillStyle = 'rgba(243,239,231,.92)';
  g.beginPath(); g.roundRect ? g.roundRect(mx0 - 8, my - 26, mx1 - mx0 + 16, 52, 8) : g.rect(mx0 - 8, my - 26, mx1 - mx0 + 16, 52); g.fill();
  const sp = soundPos();
  const maxMm = Math.max(...line.heightsMm);
  g.lineWidth = Math.max(1, step * 0.34);
  line.levels.forEach((lv, i) => {
    const x = mx0 + (i + 0.5) * step, hh = line.heightsMm[lv] / maxMm * 16;
    g.strokeStyle = sp != null && (i + 0.5) * line.tickSeconds > sp ? '#b9b2a5' : '#1b1a17';
    g.beginPath(); g.moveTo(x, my - hh); g.lineTo(x, my + hh); g.stroke();
  });
  if (cam.pos != null) {
    const x = mx0 + cam.pos / total * (mx1 - mx0);
    g.fillStyle = locked ? '#1b1a17' : '#b9b2a5';
    g.beginPath(); g.moveTo(x, my + 19); g.lineTo(x - 5, my + 25); g.lineTo(x + 5, my + 25); g.fill();
  }
  if (sp != null) {
    const x = mx0 + sp / total * (mx1 - mx0);
    g.strokeStyle = '#d4553c'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, my - 22); g.lineTo(x, my + 18); g.stroke();
  }
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
  btnScrub.classList.toggle('on', m === 'scrub');
  syncUrl();
}
btnPlay.onclick = () => setMode('play');
btnScrub.onclick = () => setMode('scrub');
btnPlay.classList.toggle('on', mode === 'play');
btnScrub.classList.toggle('on', mode === 'scrub');

// ---------- loop ----------

function frame(now) {
  if (!('requestVideoFrameCallback' in video)) process(now);
  const vp = voicePos();
  if (vp != null && (vp < 0 || vp > buffer.duration)) stopVoice();   // ran off an end of the ride
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
  if (mode !== 'play') q.set('mode', mode);
  for (const k in P) if (P[k] !== DEFAULTS[k]) q.set(k, +(+P[k]).toFixed(3));
  history.replaceState(null, '', '?' + q.toString().replace('debug=', 'debug'));
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
  const line3 = `mis ${r.match ? r.match.mis : '-'} 2nd ${r.second ? r.second.mis : '-'} dir ${r.dir || '-'} read ${r.t != null ? r.t.toFixed(2) : '-'} cam ${cam.pos != null ? cam.pos.toFixed(2) : '-'} sound ${sp != null ? sp.toFixed(2) : '-'} vel ${rd ? rd.vel.toFixed(2) : '-'}`;
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
