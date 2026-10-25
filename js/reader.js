// Reads the tick line from a grey image strip and says where on the ride the centre of the strip is.
// Steps: ink mask -> find the base line (and its tilt) -> measure each tick -> heights to levels
// -> slide the seen levels along the full sequence -> position under the centre.

const Reader = (() => {
  function median(a) {
    if (!a.length) return 0;
    const s = Float64Array.from(a).sort();
    return s[s.length >> 1];
  }

  function inkMask(gray, w, h, P) {
    const W1 = w + 1, ii = new Float64Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += gray[y * w + x]; ii[(y + 1) * W1 + x + 1] = ii[y * W1 + x + 1] + row; }
    }
    const r = P.win >> 1, ink = new Uint8Array(w * h);
    const xs = new Int16Array(w * h), ys = new Int16Array(w * h);
    let n = 0;
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const mean = (ii[y1 * W1 + x1] - ii[y0 * W1 + x1] - ii[y1 * W1 + x0] + ii[y0 * W1 + x0]) / ((x1 - x0) * (y1 - y0));
        const v = gray[y * w + x];
        if (v < mean * (1 - P.k) && mean - v > 8) { ink[y * w + x] = 1; xs[n] = x; ys[n] = y; n++; }
      }
    }
    return { ink, xs, ys, n };
  }

  function findBase(m, w, h, P) {
    const hist = new Uint16Array(h * 3);
    let best = { score: 0 };
    for (let deg = -P.maxTilt; deg <= P.maxTilt; deg += 1) {
      const tan = Math.tan(deg * Math.PI / 180);
      hist.fill(0);
      for (let i = 0; i < m.n; i++) {
        const yy = Math.round(m.ys[i] - (m.xs[i] - w / 2) * tan) + h;
        if (yy >= 0 && yy < hist.length) hist[yy]++;
      }
      for (let y = h + 1; y < 2 * h - 1; y++) {
        const s = hist[y - 1] + hist[y] + hist[y + 1];
        if (s > best.score) best = { score: s, y0: y - h, tan, deg };
      }
    }
    return best;
  }

  function measureTicks(m, w, h, base) {
    const { ink } = m, run = new Int16Array(w), top = new Int16Array(w), bot = new Int16Array(w);
    // walk across the base line, perpendicular to it (ticks lean with the line when the phone is tilted)
    const cos = 1 / Math.sqrt(1 + base.tan * base.tan), sin = base.tan * cos;
    const nx = -sin, ny = cos;
    for (let x = 0; x < w; x++) {
      const yb = base.y0 + (x - w / 2) * base.tan;
      const at = k => {
        const px = Math.round(x + k * nx), py = Math.round(yb + k * ny);
        return px >= 0 && px < w && py >= 0 && py < h && ink[py * w + px];
      };
      let ks = null;
      for (let d = 0; d <= 2 && ks === null; d++) { if (at(-d)) ks = -d; else if (at(d)) ks = d; }
      if (ks === null) continue;
      let up = ks, dn = ks;
      for (;;) { if (at(up - 1)) up--; else if (at(up - 2)) up -= 2; else break; }
      for (;;) { if (at(dn + 1)) dn++; else if (at(dn + 2)) dn += 2; else break; }
      run[x] = dn - up + 1; top[x] = Math.round(yb + up * ny); bot[x] = Math.round(yb + dn * ny);
    }
    const nz = [];
    for (let x = 0; x < w; x++) if (run[x] > 0) nz.push(run[x]);
    const baseThick = median(nz) || 1;
    const minRun = Math.max(baseThick * 2.2, baseThick + 3);
    const ticks = [];
    let g = null;
    for (let x = 0; x <= w; x++) {
      if (x < w && run[x] >= minRun) {
        const wgt = run[x] - baseThick;
        if (!g) g = { x0: x, sw: 0, swx: 0, h: 0, top: h, bot: 0 };
        g.sw += wgt; g.swx += wgt * x; g.h = Math.max(g.h, run[x]);
        g.top = Math.min(g.top, top[x]); g.bot = Math.max(g.bot, bot[x]); g.x1 = x;
      } else if (g) {
        if (g.x0 > 0 && g.x1 < w - 1) ticks.push({ x: g.swx / g.sw, h: g.h, top: g.top, bot: g.bot });
        g = null;
      }
    }
    return { ticks, baseThick };
  }

  // Skyline layout: the water line is the long straight edge with the dark city on one side and skin on the
  // other. `side` is +1 when the city is above it in the image (bars hang down), -1 when the phone is upside down.
  function findWater(gray, w, h, P) {
    const step = 4, acc = new Float64Array(h);
    let best = { score: 0 };
    // coarse pass every 3 degrees, then the neighbours of the best one
    const coarse = [];
    for (let deg = -P.maxTilt; deg <= P.maxTilt; deg += 3) coarse.push(deg);
    const tryAngle = deg => {
      const tan = Math.tan(deg * Math.PI / 180);
      acc.fill(0);
      for (let x = 0; x < w; x += step) {
        const off = (x - w / 2) * tan;
        for (let yo = 3; yo < h - 3; yo++) {
          const y = Math.round(yo + off);
          if (y < 2 || y >= h - 2) continue;
          acc[yo] += gray[(y + 2) * w + x] - gray[(y - 2) * w + x];
        }
      }
      for (let yo = 3; yo < h - 3; yo++) {
        const s = Math.abs(acc[yo]);
        if (s > best.score) best = { score: s, y0: yo, tan, deg, side: acc[yo] > 0 ? 1 : -1 };
      }
    };
    coarse.forEach(tryAngle);
    const c = best.deg;
    for (const d of [c - 2, c - 1, c + 1, c + 2]) if (Math.abs(d) <= P.maxTilt) tryAngle(d);
    best.contrast = best.score / Math.ceil(w / step);   // average brightness step across the edge
    return best;
  }

  function measureBars(m, w, h, base) {
    const { ink } = m;
    const cos = 1 / Math.sqrt(1 + base.tan * base.tan), sin = base.tan * cos;
    const nx = -sin * base.side, ny = cos * base.side;      // from the water line into the reflection
    const run = new Int16Array(w), tipY = new Int16Array(w);
    for (let x = 0; x < w; x++) {
      const yb = base.y0 + (x - w / 2) * base.tan;
      const at = k => {
        const px = Math.round(x + k * nx), py = Math.round(yb + k * ny);
        return px >= 0 && px < w && py >= 0 && py < h && ink[py * w + px];
      };
      let k0 = -1;
      for (let k = 2; k <= 5 && k0 < 0; k++) if (at(k)) k0 = k;    // a bar starts right at the water line
      if (k0 < 0) continue;
      let k = k0;
      for (;;) { if (at(k + 1)) k++; else if (at(k + 2)) k += 2; else break; }
      run[x] = k; tipY[x] = Math.round(yb + k * ny);
    }
    const ticks = [];
    let g = null;
    for (let x = 0; x <= w; x++) {
      if (x < w && run[x] >= 4) {
        if (!g) g = { x0: x, sw: 0, swx: 0, h: 0, tip: 0 };
        g.sw += run[x]; g.swx += run[x] * x;
        if (run[x] > g.h) { g.h = run[x]; g.tip = tipY[x]; }
        g.x1 = x;
      } else if (g) {
        if (g.x0 > 0 && g.x1 < w - 1) ticks.push({ x: g.swx / g.sw, h: g.h, top: Math.min(g.tip, Math.round(base.y0)), bot: Math.max(g.tip, Math.round(base.y0)) });
        g = null;
      }
    }
    return { ticks, baseThick: 0 };
  }

  function detect(gray, w, h, P, L) {
    const out = { found: false, ticks: [] };
    const m = inkMask(gray, w, h, P);
    out.mask = m.ink;
    let ticks, baseThick, base;
    if (L.layout === 'reflection') {
      base = findWater(gray, w, h, P);
      out.base = base;
      if (base.contrast < P.edgeMin) { out.reason = 'no line'; return out; }
      ({ ticks, baseThick } = measureBars(m, w, h, base));
    } else {
      base = findBase(m, w, h, P);
      out.base = base;
      if (base.score < w * 0.35) { out.reason = 'no line'; return out; }
      ({ ticks, baseThick } = measureTicks(m, w, h, base));
    }
    out.baseThick = baseThick;
    if (ticks.length < 3) { out.ticks = ticks; out.reason = 'few ticks'; return out; }

    // spacing: drop ticks too close to the previous one (noise), then number them allowing gaps
    let pitch = median(ticks.slice(1).map((t, i) => t.x - ticks[i].x));
    const kept = [ticks[0]];
    for (let j = 1; j < ticks.length; j++) {
      const prev = kept[kept.length - 1];
      if (ticks[j].x - prev.x < pitch * 0.5) { if (ticks[j].h > prev.h) kept[kept.length - 1] = ticks[j]; }
      else kept.push(ticks[j]);
    }
    ticks = kept;
    pitch = median(ticks.slice(1).map((t, i) => t.x - ticks[i].x));
    // x is measured along the image, the line is tilted: spacing along the line is pitch / cos
    pitch *= Math.sqrt(1 + base.tan * base.tan);
    // marks much shorter than the shortest tick (the start dot, specks) are not ticks
    const pitchMm0 = L.lengthMm / L.levels.length, shortest = Math.min(...L.heightsMm) / pitchMm0;
    ticks = ticks.filter(t => t.h / pitch > shortest * 0.75);
    if (ticks.length < 3) { out.ticks = ticks; out.reason = 'few ticks'; return out; }
    const step = pitch / Math.sqrt(1 + base.tan * base.tan);
    ticks[0].i = 0;
    for (let j = 1; j < ticks.length; j++) ticks[j].i = ticks[j - 1].i + Math.max(1, Math.round((ticks[j].x - ticks[j - 1].x) / step));
    out.ticks = ticks; out.pitch = pitch;
    if (ticks.length < P.minTicks) { out.reason = 'few ticks'; return out; }

    // heights -> levels; tick heights in units of the spacing, fitted with one free scale (tilt of the phone)
    const pitchMm = L.lengthMm / L.levels.length;
    const exp = L.heightsMm.map(mm => mm / pitchMm);
    const hp = ticks.map(t => t.h / pitch);
    const nearest = v => { let bl = 0; for (let l = 1; l < exp.length; l++) if (Math.abs(v - exp[l]) < Math.abs(v - exp[bl])) bl = l; return bl; };
    // free scale (phone tilt) and offset (blur and ink spread make every tick a bit taller)
    let bestS = 1, bestC = 0, bestE = Infinity;
    for (let s = 0.7; s <= 1.4; s += 0.02) for (let c = -1.2; c <= 0.2; c += 0.05) {
      let e = 0;
      for (const v of hp) { const u = s * v + c, d = u - exp[nearest(u)]; e += d * d; }
      if (e < bestE) { bestE = e; bestS = s; bestC = c; }
    }
    ticks.forEach((t, j) => { t.level = nearest(bestS * hp[j] + bestC); });
    out.scale = bestS; out.offset = bestC;

    // slide along the whole line, both directions
    const seq = L.levels, n = seq.length, S = ticks[ticks.length - 1].i;
    let best = null, second = null;
    // a placement may hang over either end of the line; ticks that fall off it count as misread
    for (const d of [1, -1]) {
      const oMin = d > 0 ? -S : 0, oMax = d > 0 ? n - 1 : n - 1 + S;
      for (let o = oMin; o <= oMax; o++) {
        let mis = 0, dist = 0;
        for (const t of ticks) {
          const li = o + d * t.i;
          const diff = li < 0 || li >= n ? 2 : Math.abs(seq[li] - t.level);
          if (diff) { mis++; dist += diff; }
        }
        const c = { d, o, mis, dist };
        const better = (a, b) => !b || a.mis < b.mis || (a.mis === b.mis && a.dist < b.dist);
        if (better(c, best)) { second = best; best = c; } else if (better(c, second)) second = c;
      }
    }
    out.match = best; out.second = second;
    // a few misread heights are fine as long as the winner is far ahead of any other place on the line
    const nt = ticks.length, allowed = Math.max(P.maxErr, Math.floor(nt * P.errFrac));
    if (!best || best.mis > allowed || (second && second.mis < best.mis + Math.max(2, Math.ceil(nt * 0.2)))) { out.reason = 'unsure'; return out; }

    // fractional tick index under the centre of the strip
    const cx = w / 2;
    let f;
    if (cx <= ticks[0].x) f = ticks[0].i - (ticks[0].x - cx) / step;
    else if (cx >= ticks[ticks.length - 1].x) f = S + (cx - ticks[ticks.length - 1].x) / step;
    else {
      let j = 0;
      while (ticks[j + 1].x < cx) j++;
      const a = ticks[j], b = ticks[j + 1];
      f = a.i + (cx - a.x) / (b.x - a.x) * (b.i - a.i);
    }
    ticks.forEach(t => { t.ok = seq[best.o + best.d * t.i] === t.level; });
    out.span = S;
    const lineIdx = best.o + best.d * f;
    out.t = Math.min(n * L.tickSeconds, Math.max(0, (lineIdx + 0.5) * L.tickSeconds));
    out.dir = best.d;
    out.found = true;
    return out;
  }

  return { detect };
})();
