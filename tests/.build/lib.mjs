// src/lib/prng.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function hashNumbers(nums) {
  let h = 2166136261;
  for (let i = 0; i < nums.length; i++) {
    const q = Math.round(nums[i] * 1e3) | 0;
    h ^= q & 255;
    h = Math.imul(h, 16777619);
    h ^= q >>> 8 & 255;
    h = Math.imul(h, 16777619);
    h ^= q >>> 16 & 255;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function subStream(seed, name) {
  return mulberry32((seed ^ hashString(name)) >>> 0);
}
var range = (r, lo, hi) => lo + r() * (hi - lo);
var gauss = (r) => (r() + r() + r() - 1.5) / 1.5;
var pick = (r, xs) => xs[Math.min(xs.length - 1, r() * xs.length | 0)];

// src/lib/color.ts
function linearToSrgb(x) {
  return x <= 31308e-7 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}
function oklchToRgbRaw(l, c, hDeg) {
  const h = hDeg * Math.PI / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;
  return [
    linearToSrgb(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    linearToSrgb(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    linearToSrgb(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S)
  ];
}
var inGamut = (rgb) => rgb.every((v) => v >= -5e-4 && v <= 1.0005);
function gamutFit(l, c, h) {
  let raw = oklchToRgbRaw(l, c, h);
  if (inGamut(raw)) return raw;
  let lo = 0;
  let hi = c;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    raw = oklchToRgbRaw(l, mid, h);
    if (inGamut(raw)) lo = mid;
    else hi = mid;
  }
  raw = oklchToRgbRaw(l, lo, h);
  return [
    Math.min(1, Math.max(0, raw[0])),
    Math.min(1, Math.max(0, raw[1])),
    Math.min(1, Math.max(0, raw[2]))
  ];
}
function oklchToCss(l, c, h, alpha = 1) {
  const [r, g, b] = gamutFit(l, c, h);
  const R = Math.round(r * 255);
  const G = Math.round(g * 255);
  const B = Math.round(b * 255);
  return alpha >= 1 ? `rgb(${R},${G},${B})` : `rgba(${R},${G},${B},${alpha.toFixed(3)})`;
}
var wrapHue = (h) => (h % 360 + 360) % 360;
var SHADOW_HUE = 285;
function noBlack(l, c, h) {
  if (l >= 0.42) return { l, c, h };
  const t = Math.min(1, (0.42 - l) / 0.42);
  return {
    l: Math.max(0.3, l),
    // darker => more decisively blue-violet, and never desaturated to grey
    c: Math.max(c, 0.05 + 0.09 * t),
    h: wrapHue(h + shortestHueStep(h, SHADOW_HUE) * (0.55 + 0.45 * t))
  };
}
function shortestHueStep(from, to) {
  let d = wrapHue(to) - wrapHue(from);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

// src/lib/events.ts
var isStroke = (e) => e.type === "stroke";
function streamDuration(events) {
  let max = 0;
  for (const e of events) if (e.t > max) max = e.t;
  return max;
}
function countStrokes(events) {
  let n = 0;
  for (const e of events) if (e.type === "stroke") n++;
  return n;
}
var STROKE_MIN = 80;
var STROKE_MAX = 200;
var STROKE_HARD_CAP = 300;

// src/lib/audio/features.ts
var FRAME = 2048;
var HOP = 1024;
var FEATURE_HZ = 20;
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + (len >> 1)] * cr - im[i + k + (len >> 1)] * ci;
        const vi = re[i + k + (len >> 1)] * ci + im[i + k + (len >> 1)] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + (len >> 1)] = ur - vr;
        im[i + k + (len >> 1)] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}
function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
  return w;
}
function magnitudeSpectrum(frame, window, out) {
  const n = frame.length;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = frame[i] * window[i];
  fft(re, im);
  const half = n >> 1;
  for (let i = 0; i < half; i++) out[i] = Math.hypot(re[i], im[i]);
}
function rms(frame) {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return Math.sqrt(s / frame.length);
}
var toDb = (x) => 20 * Math.log10(Math.max(1e-8, x));
function spectralCentroid(mag, sampleRate) {
  let num = 0, den = 0;
  const binHz = sampleRate / (mag.length * 2);
  for (let i = 1; i < mag.length; i++) {
    num += i * binHz * mag[i];
    den += mag[i];
  }
  return den > 1e-9 ? num / den : 0;
}
function spectralFlux(mag, prev) {
  let s = 0;
  for (let i = 0; i < mag.length; i++) {
    const d = mag[i] - prev[i];
    if (d > 0) s += d;
  }
  return s;
}
function decimate(frame, factor) {
  if (factor <= 1) return frame;
  const n = Math.floor(frame.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += frame[i * factor + k];
    out[i] = s / factor;
  }
  return out;
}
function detectPitch(frame, sampleRate, clarityFloor = 0.85) {
  const n = frame.length;
  const nsdf = new Float32Array(n);
  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += frame[i] * frame[i];
  let acfAtZero = sumSq;
  let running = sumSq;
  for (let tau2 = 0; tau2 < n; tau2++) {
    let acf = 0;
    for (let i = 0; i + tau2 < n; i++) acf += frame[i] * frame[i + tau2];
    if (tau2 > 0) {
      running -= frame[tau2 - 1] * frame[tau2 - 1] + frame[n - tau2] * frame[n - tau2];
    }
    const denom2 = tau2 === 0 ? 2 * acfAtZero : acfAtZero + running;
    nsdf[tau2] = denom2 > 1e-12 ? 2 * acf / denom2 : 0;
  }
  let tau = 0;
  while (tau < n - 1 && nsdf[tau] > 0) tau++;
  while (tau < n - 1 && nsdf[tau] <= 0) tau++;
  const peaks = [];
  let cur = -1, curVal = -1;
  for (; tau < n - 1; tau++) {
    if (nsdf[tau] > nsdf[tau - 1] && nsdf[tau] >= nsdf[tau + 1]) {
      if (nsdf[tau] > curVal) {
        curVal = nsdf[tau];
        cur = tau;
      }
    }
    if (nsdf[tau] <= 0 && cur >= 0) {
      peaks.push(cur);
      cur = -1;
      curVal = -1;
    }
  }
  if (cur >= 0) peaks.push(cur);
  if (!peaks.length) return { f0: 0, clarity: 0 };
  let maxPeak = 0;
  for (const p of peaks) if (nsdf[p] > maxPeak) maxPeak = nsdf[p];
  const threshold = maxPeak * 0.9;
  let chosen = peaks[0];
  for (const p of peaks) {
    if (nsdf[p] >= threshold) {
      chosen = p;
      break;
    }
  }
  const y1 = nsdf[chosen - 1] ?? nsdf[chosen];
  const y2 = nsdf[chosen];
  const y3 = nsdf[chosen + 1] ?? nsdf[chosen];
  const denom = 2 * (2 * y2 - y1 - y3);
  const shift = denom !== 0 ? (y3 - y1) / denom : 0;
  const period = chosen + shift;
  const clarity = Math.max(0, Math.min(1, y2));
  if (period <= 0 || clarity < clarityFloor) return { f0: 0, clarity };
  const f0 = sampleRate / period;
  if (f0 < 55 || f0 > 900) return { f0: 0, clarity };
  return { f0, clarity };
}
var OneEuro = class _OneEuro {
  constructor(minCutoff = 1, beta = 0.7, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }
  xPrev = null;
  dxPrev = 0;
  tPrev = 0;
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(x, tSec) {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = tSec;
      return x;
    }
    const dt = Math.max(1e-3, tSec - this.tPrev);
    this.tPrev = tSec;
    const dx = (x - this.xPrev) / dt;
    const aD = _OneEuro.alpha(this.dCutoff, dt);
    this.dxPrev = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const a = _OneEuro.alpha(cutoff, dt);
    const out = a * x + (1 - a) * this.xPrev;
    this.xPrev = out;
    return out;
  }
};
function medianThreshold(history, multiplier = 1.6, bias = 1e-5) {
  if (!history.length) return Infinity;
  const s = [...history].sort((a, b) => a - b);
  const med = s[s.length >> 1];
  return med * multiplier + bias;
}

// src/lib/audio/analyzer.ts
var CONTOUR_POINTS = 96;
var PAUSE_MIN_MS = 180;
var PAUSE_MAJOR_MS = 450;
var PAUSE_MIN_FRAMES = 3;
var hzToSemitones = (hz, ref) => 12 * Math.log2(Math.max(1e-6, hz) / Math.max(1e-6, ref));
function fillPitchGaps(frames) {
  const n = frames.length;
  const out = new Float32Array(n);
  let lastIdx = -1;
  for (let i = 0; i < n; i++) {
    if (frames[i].f0 > 0) {
      if (lastIdx >= 0 && i - lastIdx > 1) {
        const a = out[lastIdx], b = frames[i].f0;
        for (let k = lastIdx + 1; k < i; k++) out[k] = a + (b - a) * (k - lastIdx) / (i - lastIdx);
      } else if (lastIdx < 0) {
        for (let k = 0; k < i; k++) out[k] = frames[i].f0;
      }
      out[i] = frames[i].f0;
      lastIdx = i;
    }
  }
  if (lastIdx < 0) return out;
  for (let k = lastIdx + 1; k < n; k++) out[k] = out[lastIdx];
  return out;
}
function analyse(frames, noiseFloorDb) {
  const n = frames.length;
  if (n === 0) {
    return {
      durationMs: 0,
      noiseFloorDb,
      groups: [],
      pauses: [],
      peaks: [],
      contour: new Float32Array(CONTOUR_POINTS).fill(0.5),
      voice: { pitchMin: 100, pitchMax: 200, baselineCentroid: 1500 },
      frameCount: 0
    };
  }
  const durationMs = frames[n - 1].t * 1e3;
  const pitch = fillPitchGaps(frames);
  const silenceDb = noiseFloorDb + 6;
  const quiet = frames.map((f) => f.rmsDb < silenceDb);
  const pauses = [];
  {
    let run = 0;
    for (let i = 0; i <= n; i++) {
      if (i < n && quiet[i]) {
        run++;
        continue;
      }
      if (run >= PAUSE_MIN_FRAMES) {
        const startMs = frames[i - run].t * 1e3;
        const endMs = frames[i - 1].t * 1e3;
        if (endMs - startMs >= PAUSE_MIN_MS) {
          pauses.push({ startMs, endMs, major: endMs - startMs > PAUSE_MAJOR_MS });
        }
      }
      run = 0;
    }
  }
  const groups = [];
  {
    const bounds = [];
    let cursor = 0;
    for (const p of pauses) {
      if (p.startMs > frames[cursor].t * 1e3) bounds.push([frames[cursor].t * 1e3, p.startMs]);
      while (cursor < n && frames[cursor].t * 1e3 < p.endMs) cursor++;
    }
    if (cursor < n) bounds.push([frames[cursor].t * 1e3, durationMs]);
    for (const [a, b] of bounds) {
      if (b - a < 120) continue;
      const idx = [];
      for (let i = 0; i < n; i++) {
        const t = frames[i].t * 1e3;
        if (t >= a && t <= b && !quiet[i]) idx.push(i);
      }
      if (idx.length < 3) continue;
      const f0s = idx.map((i) => pitch[i]).filter((x) => x > 0);
      const f0Mean = f0s.length ? f0s.reduce((s, x) => s + x, 0) / f0s.length : 0;
      const semis = f0s.map((x) => hzToSemitones(x, f0Mean || 1));
      const f0Var = semis.length > 1 ? Math.sqrt(semis.reduce((s, x) => s + x * x, 0) / semis.length) : 0;
      const rmsVals = idx.map((i) => frames[i].rmsDb);
      const onsetCount = idx.reduce((s, i) => s + (frames[i].flux > 0 ? 1 : 0), 0);
      groups.push({
        index: groups.length,
        startMs: a,
        endMs: b,
        f0Mean,
        f0Var,
        rmsMean: rmsVals.reduce((s, x) => s + x, 0) / rmsVals.length,
        rmsMax: Math.max(...rmsVals),
        centroidMean: idx.reduce((s, i) => s + frames[i].centroid, 0) / idx.length,
        onsetCount,
        rate: onsetCount / Math.max(0.2, (b - a) / 1e3),
        words: []
      });
    }
  }
  const peaks = [];
  {
    const win = Math.max(3, Math.round(n / 24));
    const cands = [];
    for (let i = win; i < n - win; i++) {
      if (quiet[i]) continue;
      let isMax = true;
      for (let k = i - win; k <= i + win; k++) if (frames[k].rmsDb > frames[i].rmsDb) {
        isMax = false;
        break;
      }
      if (isMax) cands.push({ tMs: frames[i].t * 1e3, strength: frames[i].rmsDb });
    }
    cands.sort((a, b) => b.strength - a.strength);
    const chosen = cands.slice(0, 4);
    const lo = Math.min(...chosen.map((c) => c.strength), 0);
    const hi = Math.max(...chosen.map((c) => c.strength), 1);
    for (const c of chosen) peaks.push({ tMs: c.tMs, strength: hi > lo ? (c.strength - lo) / (hi - lo) : 1 });
    peaks.sort((a, b) => a.tMs - b.tMs);
  }
  const contour = new Float32Array(CONTOUR_POINTS);
  {
    const voiced = pitch.filter((x) => x > 0);
    const lo = voiced.length ? Math.min(...voiced) : 100;
    const hi = voiced.length ? Math.max(...voiced) : 200;
    for (let i = 0; i < CONTOUR_POINTS; i++) {
      const a = Math.floor(i / CONTOUR_POINTS * n);
      const b = Math.max(a + 1, Math.floor((i + 1) / CONTOUR_POINTS * n));
      let s = 0, k = 0;
      for (let j = a; j < b && j < n; j++) {
        if (pitch[j] > 0) {
          s += pitch[j];
          k++;
        }
      }
      const v = k ? s / k : (lo + hi) / 2;
      contour[i] = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    }
    const sm = new Float32Array(CONTOUR_POINTS);
    for (let i = 0; i < CONTOUR_POINTS; i++) {
      const a = contour[Math.max(0, i - 1)], b = contour[i], c = contour[Math.min(CONTOUR_POINTS - 1, i + 1)];
      sm[i] = (a + 2 * b + c) / 4;
    }
    contour.set(sm);
  }
  const voicedAll = pitch.filter((x) => x > 0);
  const cents = frames.filter((f) => f.rmsDb > silenceDb).map((f) => f.centroid);
  return {
    durationMs,
    noiseFloorDb,
    groups,
    pauses,
    peaks,
    contour,
    voice: {
      pitchMin: voicedAll.length ? Math.min(...voicedAll) : 100,
      pitchMax: voicedAll.length ? Math.max(...voicedAll) : 200,
      baselineCentroid: cents.length ? cents.reduce((s, x) => s + x, 0) / cents.length : 1500
    },
    frameCount: n
  };
}
function normalise(values, strength = 0.55) {
  if (values.length === 0) return () => 0.5;
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const median2 = sorted[sorted.length >> 1];
  const span = hi - lo;
  if (span < 1e-9) return () => 0.5;
  const medN = (median2 - lo) / span;
  return (v) => {
    const t = Math.max(0, Math.min(1, (v - lo) / span));
    const d = t < medN ? -Math.pow(medN > 0 ? (medN - t) / medN : 0, strength) : Math.pow(medN < 1 ? (t - medN) / (1 - medN) : 0, strength);
    return Math.max(0, Math.min(1, 0.5 + d * 0.5));
  };
}
function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

// src/lib/render/subjects.ts
var SUBJECTS = {
  water: {
    id: "water",
    label: "Water",
    horizonY: 0.44,
    baseAngle: 0,
    angleSpread: 0.55,
    elongation: 2.5,
    density: 1,
    hueTarget: 215,
    huePull: 0.45,
    chromaScale: 0.95,
    lightnessBias: 0.03,
    contrast: 0.95,
    reflection: true,
    edgeBias: -0.6,
    margin: 0.05,
    zone: [0.14, 0.88]
  },
  garden: {
    id: "garden",
    label: "Garden",
    // High horizon: little sky, a dense bank of planting filling the canvas.
    horizonY: 0.3,
    baseAngle: Math.PI / 2,
    angleSpread: 1.25,
    elongation: 1.05,
    density: 1.9,
    hueTarget: 95,
    huePull: 0.3,
    chromaScale: 1.3,
    lightnessBias: 0.04,
    contrast: 1.05,
    reflection: false,
    edgeBias: 0.5,
    margin: 0.03,
    zone: [0.24, 0.96]
  },
  field: {
    id: "field",
    label: "Field",
    horizonY: 0.63,
    baseAngle: 0,
    angleSpread: 0.5,
    elongation: 2.9,
    density: 0.8,
    hueTarget: 78,
    huePull: 0.38,
    chromaScale: 1.05,
    lightnessBias: 0.06,
    contrast: 0.9,
    reflection: false,
    edgeBias: -0.2,
    margin: 0.04,
    zone: [0.3, 0.95]
  },
  sky: {
    id: "sky",
    label: "Sky",
    horizonY: 0.82,
    baseAngle: 0.12,
    angleSpread: 0.8,
    elongation: 2.2,
    density: 0.55,
    hueTarget: 235,
    huePull: 0.34,
    chromaScale: 0.8,
    lightnessBias: 0.1,
    contrast: 0.8,
    reflection: false,
    edgeBias: -1,
    margin: 0.06,
    zone: [0.05, 0.78]
  },
  street: {
    id: "street",
    label: "Street",
    horizonY: 0.5,
    baseAngle: Math.PI / 2.6,
    angleSpread: 1.5,
    elongation: 1.5,
    density: 1.2,
    hueTarget: 40,
    huePull: 0.22,
    chromaScale: 0.62,
    lightnessBias: -0.06,
    contrast: 1.55,
    reflection: false,
    edgeBias: 1,
    margin: 0.02,
    zone: [0.14, 0.94]
  },
  interior: {
    id: "interior",
    label: "Interior",
    horizonY: null,
    baseAngle: Math.PI / 5,
    angleSpread: 0.9,
    elongation: 1.25,
    density: 1.1,
    hueTarget: 55,
    huePull: 0.4,
    chromaScale: 0.9,
    lightnessBias: -0.02,
    contrast: 1,
    reflection: false,
    edgeBias: -0.5,
    margin: 0.1,
    zone: [0.1, 0.92]
  }
};
var PROTOTYPES = [
  {
    id: "water",
    p: { valence: 0.62, arousal: 0.18, rate: 0.3, contentDensity: 0.5, pauseRatio: 0.35, brightness: 0.4 },
    w: { valence: 1, arousal: 1.6, rate: 1.2, contentDensity: 0.4, pauseRatio: 0.5, brightness: 0.5 }
  },
  {
    id: "garden",
    p: { valence: 0.85, arousal: 0.8, rate: 0.7, contentDensity: 0.7, pauseRatio: 0.2, brightness: 0.65 },
    w: { valence: 1.7, arousal: 1.5, rate: 0.7, contentDensity: 0.5, pauseRatio: 0.3, brightness: 0.4 }
  },
  {
    id: "field",
    p: { valence: 0.78, arousal: 0.22, rate: 0.18, contentDensity: 0.45, pauseRatio: 0.35, brightness: 0.5 },
    w: { valence: 1.5, arousal: 1.4, rate: 1.5, contentDensity: 0.3, pauseRatio: 0.4, brightness: 0.3 }
  },
  {
    id: "sky",
    p: { valence: 0.55, arousal: 0.25, rate: 0.15, contentDensity: 0.08, pauseRatio: 0.72, brightness: 0.55 },
    w: { valence: 0.3, arousal: 0.5, rate: 0.8, contentDensity: 2.4, pauseRatio: 2.2, brightness: 0.3 }
  },
  {
    id: "street",
    p: { valence: 0.18, arousal: 0.78, rate: 0.85, contentDensity: 0.75, pauseRatio: 0.12, brightness: 0.7 },
    w: { valence: 1.6, arousal: 1.2, rate: 1.7, contentDensity: 0.5, pauseRatio: 0.5, brightness: 0.6 }
  },
  {
    id: "interior",
    p: { valence: 0.25, arousal: 0.2, rate: 0.35, contentDensity: 0.6, pauseRatio: 0.3, brightness: 0.22 },
    w: { valence: 1.6, arousal: 1.5, rate: 0.8, contentDensity: 0.4, pauseRatio: 0.3, brightness: 1.8 }
  }
];
var KEYS = ["valence", "arousal", "rate", "contentDensity", "pauseRatio", "brightness"];
function selectSubject(f) {
  const scores = {};
  for (const proto of PROTOTYPES) {
    let d = 0;
    for (const k of KEYS) {
      const diff = f[k] - proto.p[k];
      d += proto.w[k] * diff * diff;
    }
    scores[proto.id] = Math.sqrt(d);
  }
  const ranked = PROTOTYPES.map((p) => p.id).sort((a, b) => scores[a] - scores[b]);
  return {
    subject: ranked[0],
    runnerUp: ranked[1],
    margin: scores[ranked[1]] - scores[ranked[0]],
    scores
  };
}

// src/lib/semantics/lexicon.ts
var table = null;
function parse(buf) {
  const view = new DataView(buf);
  const count = view.getUint32(0, true);
  const vocabLen = view.getUint32(4, true);
  const vocab = new TextDecoder().decode(new Uint8Array(buf, 8, vocabLen)).split("\n");
  const off = 8 + vocabLen + (vocabLen & 1);
  const data = new Uint16Array(buf, off, count * 3);
  const index = /* @__PURE__ */ new Map();
  for (let i = 0; i < vocab.length; i++) index.set(vocab[i], i);
  return { index, data };
}
function installLexicon(buf) {
  table = parse(buf);
}
var lexiconReady = () => table !== null;
function hashWord(w) {
  let h = 2166136261;
  for (let i = 0; i < w.length; i++) {
    h ^= w.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function colorFor(word) {
  const w = word.toLowerCase();
  if (table) {
    const i = table.index.get(w);
    if (i !== void 0) {
      const d = table.data;
      return {
        hue: d[i * 3] / 65535 * 360,
        chroma: d[i * 3 + 1] / 65535 * 0.25,
        texSeed: d[i * 3 + 2] / 65535
      };
    }
  }
  const h = hashWord(w);
  return {
    hue: h % 36e4 / 1e3,
    chroma: 0.07 + (h >>> 9) % 1e3 / 1e3 * 0.08,
    texSeed: (h >>> 19) % 1e3 / 1e3
  };
}
function clusterHue(words) {
  if (words.length === 0) return { hue: 210, chroma: 0.1, agreement: 0 };
  let x = 0, y = 0, cSum = 0;
  for (const w of words) {
    const c = colorFor(w);
    const r = c.hue * Math.PI / 180;
    x += Math.cos(r) * c.chroma;
    y += Math.sin(r) * c.chroma;
    cSum += c.chroma;
  }
  const mag = Math.hypot(x, y);
  let hue = Math.atan2(y, x) * 180 / Math.PI;
  if (hue < 0) hue += 360;
  return {
    hue,
    chroma: cSum / words.length,
    agreement: cSum > 0 ? mag / cSum : 0
  };
}

// src/lib/audio/compose.ts
var L_MIN = 0.35;
var L_MAX = 0.92;
var clamp01 = (x) => Math.max(0, Math.min(1, x));
function assignWords(groups, words) {
  for (const g of groups) g.words = [];
  for (const w of words) {
    const mid = (w.startMs + w.endMs) / 2;
    let best = null;
    let bestD = Infinity;
    for (const g of groups) {
      if (mid >= g.startMs && mid <= g.endMs) {
        best = g;
        bestD = 0;
        break;
      }
      const d = mid < g.startMs ? g.startMs - mid : mid - g.endMs;
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    if (best && bestD < 1e3) best.words.push(w.word);
  }
}
function compose(input) {
  const { analysis, sentiment, selection, seed } = input;
  const subject = SUBJECTS[selection.subject];
  const events = [];
  const groups = analysis.groups;
  const allWords = groups.flatMap((g) => g.words);
  const pieceHue = clusterHue(allWords);
  const rHorizon = subStream(seed, "horizon");
  const rGround = subStream(seed, "ground");
  const rLayout = subStream(seed, "layout");
  const nF0 = normalise(groups.map((g) => g.f0Mean).filter((x) => x > 0));
  const nVar = normalise(groups.map((g) => g.f0Var), 0.45);
  const nRms = normalise(groups.map((g) => g.rmsMean));
  const nRate = normalise(groups.map((g) => g.rate));
  const nCent = normalise(groups.map((g) => g.centroidMean));
  const pitchSpan = analysis.voice.pitchMax - analysis.voice.pitchMin;
  const voiceTint = analysis.voice.baselineCentroid % 700 / 700 * 70 - 35 + pitchSpan % 50 - 25;
  const sigHue = wrapHue(mixHue(62, subject.hueTarget, 0.3) + voiceTint);
  const groundL = clamp01(0.82 + sentiment.valence * 0.04 + subject.lightnessBias * 0.5);
  events.push({ t: 0, type: "ground", hue: sigHue, lightness: groundL });
  const horizonPoints = [];
  if (subject.horizonY !== null) {
    const bias = gauss(rHorizon) * 0.14;
    const breakThirds = rHorizon() < 0.33;
    const base = clamp01(subject.horizonY + bias + (breakThirds ? rHorizon() < 0.5 ? -0.12 : 0.12 : 0));
    const amp = 0.05 + 0.1 * clamp01(pitchSpan / 220);
    const c = analysis.contour;
    for (let i = 0; i < c.length; i++) {
      horizonPoints.push({
        x: i / (c.length - 1),
        y: clamp01(base + (c[i] - 0.5) * amp * 2)
      });
    }
    events.push({ t: 0, type: "horizon", points: horizonPoints });
  }
  const horizonAt = (x) => {
    if (!horizonPoints.length) return 0.5;
    const u = clamp01(x) * (horizonPoints.length - 1);
    const i = Math.min(horizonPoints.length - 2, Math.floor(u));
    const f = u - i;
    return horizonPoints[i].y * (1 - f) + horizonPoints[i + 1].y * f;
  };
  const duration = Math.max(1, analysis.durationMs);
  const margin = subject.margin;
  const strokes = [];
  const peakNear = (ms) => {
    let best = 0;
    for (const p of analysis.peaks) {
      const d = Math.abs(p.tMs - ms);
      if (d < 900) best = Math.max(best, p.strength * (1 - d / 900));
    }
    return best;
  };
  for (const g of groups) {
    const rc = subStream(seed, `cluster${g.index}`);
    const mid = (g.startMs + g.endMs) / 2;
    const cx = margin + mid / duration * (1 - margin * 2);
    const hy = horizonAt(cx);
    const pitchN = nF0(g.f0Mean);
    const [z0, z1] = subject.zone;
    const zoned = z1 - pitchN * (z1 - z0);
    const cy = clamp01(zoned * 0.72 + hy * 0.28 + gauss(rc) * 0.045);
    events.push({
      t: g.startMs,
      type: "cluster",
      id: g.index,
      center: { x: cx, y: cy },
      subject: selection.subject
    });
    const ch = clusterHue(g.words);
    const own = g.words.length ? mixHue(ch.hue, pieceHue.hue, 0.55) : subject.hueTarget;
    const pull = g.words.length ? subject.huePull : 1;
    const baseHue = wrapHue(mixHue(own, subject.hueTarget, pull));
    const baseChroma = Math.max(0.03, Math.min(
      0.155,
      (g.words.length ? ch.chroma : 0.1) * subject.chromaScale * 0.72 * (0.65 + 0.7 * clamp01(sentiment.arousal * 0.6 + nRms(g.rmsMean) * 0.4))
    ));
    const varN = nVar(g.f0Var);
    const rmsN = nRms(g.rmsMean);
    const rateN = nRate(g.rate);
    const centN = nCent(g.centroidMean);
    const angleSpread = (0.12 + Math.pow(varN, 0.8) * 1.55) * subject.angleSpread;
    const perCluster = Math.round(4 + rateN * 5 + rmsN * 3);
    const count = Math.max(4, Math.min(12, Math.round(perCluster * subject.density)));
    const blob = (0.065 + 0.085 * (1 - rateN)) * (1 + subject.elongation * 0.12);
    const edgeBand = Math.max(0, Math.min(
      4,
      Math.round(centN * 4 + subject.edgeBias)
    ));
    const light = peakNear(mid);
    for (let i = 0; i < count; i++) {
      const u = count > 1 ? i / (count - 1) : 0.5;
      const t = g.startMs + (g.endMs - g.startMs) * u;
      const ox = gauss(rc) * blob * (1 + subject.elongation * 0.25);
      const oy = gauss(rc) * blob;
      const px = clamp01(cx + ox);
      const py = clamp01(cy + oy);
      const angle = subject.baseAngle + gauss(rc) * angleSpread;
      const isAccent = count > 5 && i === 2 + (rc() * Math.max(1, count - 4) | 0);
      const len = (0.065 + rmsN * 0.125) * subject.elongation * range(rc, 0.75, 1.4) * (isAccent ? 0.7 : 1);
      const width = (0.016 + rmsN * 0.026) * range(rc, 0.82, 1.3);
      const load = clamp01(0.3 + rmsN * 0.6 + light * 0.3);
      const hue = isAccent ? wrapHue(baseHue + 150 + gauss(rc) * 16) : wrapHue(baseHue + gauss(rc) * 18);
      const chroma = baseChroma * (isAccent ? 0.5 : range(rc, 0.7, 1.15));
      const lightness = clamp01(
        0.58 + (rmsN - 0.5) * 0.42 * subject.contrast + light * 0.26 + subject.lightnessBias + gauss(rc) * 0.07
      );
      const layer = light > 0.45 && i >= count - 2 ? "light" : u < 0.4 ? "under" : "mid";
      const path = strokePath(px, py, angle, len, rc);
      strokes.push({
        t,
        type: "stroke",
        clusterId: g.index,
        path,
        width,
        angle,
        hue,
        chroma,
        lightness,
        edgeBand,
        load,
        layer
      });
      if (subject.reflection && py < hy) {
        const ry = clamp01(hy + (hy - py) * range(rc, 0.85, 1.05));
        strokes.push({
          t: t + 30,
          type: "stroke",
          clusterId: g.index,
          path: strokePath(px + gauss(rc) * 0.01, ry, angle * 0.25, len * 0.85, rc),
          width: width * 1.05,
          angle: angle * 0.25,
          hue: wrapHue(hue - 8),
          chroma: chroma * 0.8,
          lightness: clamp01(lightness - 0.1),
          edgeBand: 0,
          load: load * 0.75,
          layer: "mid"
        });
      }
    }
  }
  let lo = 1, hi = 0;
  for (const s of strokes) {
    if (s.lightness < lo) lo = s.lightness;
    if (s.lightness > hi) hi = s.lightness;
  }
  if (strokes.length) {
    const span = hi - lo;
    const wanted = L_MAX - L_MIN;
    if (span < 1e-6) {
      const rl = subStream(seed, "valuefix");
      for (const s of strokes) s.lightness = L_MIN + rl() * wanted;
    } else {
      for (const s of strokes) s.lightness = L_MIN + (s.lightness - lo) / span * wanted;
    }
    lo = L_MIN;
    hi = L_MAX;
  }
  strokes.sort((a, b) => a.t - b.t);
  let kept = strokes;
  if (strokes.length > STROKE_HARD_CAP) {
    const stride = strokes.length / STROKE_HARD_CAP;
    kept = [];
    for (let i = 0; i < STROKE_HARD_CAP; i++) kept.push(strokes[Math.floor(i * stride)]);
  }
  const rank = { under: 0, mid: 1, light: 2 };
  const structural = events.filter((e) => e.type === "ground" || e.type === "horizon");
  const timed = [...events.filter((e) => e.type === "cluster"), ...kept].sort((a, b) => a.t - b.t || (a.type === "cluster" ? -1 : 0) - (b.type === "cluster" ? -1 : 0) || (a.type === "stroke" && b.type === "stroke" ? rank[a.layer] - rank[b.layer] : 0));
  const ordered = kept;
  const stream = [...structural, ...timed];
  return {
    events: stream,
    strokeCount: ordered.length,
    lightnessRange: [lo, hi]
  };
}
function mixHue(from, to, t) {
  let d = wrapHue(to) - wrapHue(from);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return wrapHue(from + d * t);
}
function strokePath(x, y, angle, len, r) {
  const dx = Math.cos(angle) * len * 0.5;
  const dy = Math.sin(angle) * len * 0.5;
  const bow = gauss(r) * len * 0.3;
  const nx = -Math.sin(angle) * bow;
  const ny = Math.cos(angle) * bow;
  return [
    { x: x - dx, y: y - dy },
    { x: x + nx, y: y + ny },
    { x: x + dx, y: y + dy }
  ];
}

// src/lib/semantics/sentiment.ts
var PACKED = "aas:25,aayf:27,afu:-29,alol:28,ambw:29,aml:34,atab:-19,awol:-13,ayc:2,ayor:-12,bfd:-27,bfe:-26,bff:29,bffn:10,bl:23,bsod:-22,btd:-21,btdt:-1,bz:4,cwot:-23,doa:-23,dx:-30,ez:15,fav:24,fcol:-18,ff:18,ffs:-28,fkm:-24,foaf:18,ftw:20,fu:-37,fubar:-30,fwb:25,fyi:8,fysa:4,gg:12,gga:17,gigo:-6,gj:20,gl:13,gla:25,gn:12,grrr:-4,gt:11,hagd:22,hagn:22,hago:12,hak:19,hand:22,heart:32,hearts:33,hhoj:20,hhok:9,hugz:20,idk:-4,ijs:7,ilu:34,iluaaf:27,ily:34,iou:7,iyq:23,jho:8,jhomf:10,jj:10,jk:9,jp:8,jt:9,jw:16,jealz:-12,kfy:23,kia:-32,kk:15,kmuf:22,laoj:13,lmao:20,lmbao:18,lmfao:25,lmso:27,lol:29,lolz:27,lts:16,ly:26,lya:33,lyb:30,lyl:31,lylab:27,lylas:26,lylb:16,mia:-12,mml:20,mofo:-24,muah:28,mubar:-10,musm:9,mwah:25,nbd:13,nbif:-5,nfc:-27,nfw:-24,nh:22,nimby:-8,nimjd:-7,nimq:-2,nimy:-14,nitl:-15,nme:-21,noyb:-7,np:14,ntmu:14,ok:16,pita:-24,pls:3,plz:3,pmbi:8,pmfji:3,pmji:7,po:-26,ptl:26,pu:-11,qq:-22,qt:18,rofl:27,roflmao:25,rotfl:26,rotflmao:28,rotflmfao:25,rotflol:30,rotgl:29,rotglmao:18,sapfu:-11,sete:28,sfete:27,sgtm:24,slap:6,slaw:21,smh:-13,snafu:-25,sob:-28,swak:23,tgif:23,thks:14,thx:15,tia:23,tmi:-3,tnx:11,true:18,tx:15,txs:11,ty:16,tyvm:25,urw:19,vbg:21,vbs:31,vip:23,vwd:26,vwp:21,wag:-2,wd:27,wilco:9,wp:10,wtf:-28,wtg:21,wth:-24,x-d:27,x-p:18,xd:27,xlnt:30,xoxo:30,xoxozzz:23,xp:12,xqzt:16,xtc:8,yolo:11,yoyo:4,yvw:16,yw:18,ywia:25,zzz:-12,abandon:-19,abandoned:-20,abandoner:-19,abandoners:-19,abandoning:-16,abandonment:-24,abandonments:-17,abandons:-13,abducted:-23,abduction:-28,abductions:-20,abhor:-20,abhorred:-24,abhorrent:-31,abhors:-29,abilities:10,ability:13,aboard:1,absentee:-11,absentees:-8,absolve:12,absolved:15,absolves:13,absolving:16,abuse:-32,abused:-23,abuser:-26,abusers:-26,abuses:-26,abusing:-20,abusive:-32,abusively:-28,abusiveness:-25,abusivenesses:-30,accept:16,acceptabilities:16,acceptability:11,acceptable:13,acceptableness:13,acceptably:15,acceptance:20,acceptances:17,acceptant:16,acceptation:13,acceptations:9,accepted:11,accepting:16,accepts:13,accident:-21,accidental:-3,accidentally:-14,accidents:-13,accomplish:18,accomplished:19,accomplishes:17,accusation:-10,accusations:-13,accuse:-8,accused:-12,accuses:-14,accusing:-7,ache:-16,ached:-16,aches:-10,achievable:13,aching:-22,acquit:8,acquits:1,acquitted:10,acquitting:13,acrimonious:-17,active:17,actively:13,activeness:6,activenesses:8,actives:11,adequate:9,admirability:24,admirable:26,admirableness:22,admirably:25,admiral:13,admirals:15,admiralties:16,admiralty:12,admiration:25,admirations:16,admire:21,admired:23,admirer:18,admirers:17,admires:15,admiring:16,admiringly:23,admit:8,admits:12,admitted:4,admonished:-19,adopt:7,adopts:7,adorability:22,adorable:22,adorableness:25,adorably:21,adoration:29,adorations:22,adore:26,adored:18,adorer:17,adorers:21,adores:16,adoring:26,adoringly:24,adorn:9,adorned:8,adorner:13,adorners:9,adorning:10,adornment:13,adornments:8,adorns:5,advanced:10,advantage:10,advantaged:14,advantageous:15,advantageously:19,advantageousness:16,advantages:15,advantaging:16,adventure:13,adventured:13,adventurer:12,adventurers:9,adventures:14,adventuresome:17,adventuresomeness:13,adventuress:8,adventuresses:14,adventuring:23,adventurism:15,adventurist:14,adventuristic:17,adventurists:12,adventurous:14,adventurously:13,adventurousness:18,adversarial:-15,adversaries:-10,adversary:-8,adversative:-12,adversatively:-1,adversatives:-10,adverse:-15,adversely:-8,adverseness:-6,adversities:-15,adversity:-18,affected:-6,affection:24,affectional:19,affectionally:15,affectionate:19,affectionately:22,affectioned:18,affectionless:-20,affections:15,afflicted:-15,affronted:2,aggravate:-25,aggravated:-19,aggravates:-19,aggravating:-12,aggress:-13,aggressed:-14,aggresses:-5,aggressing:-6,aggression:-12,aggressions:-13,aggressive:-6,aggressively:-13,aggressiveness:-18,aggressivities:-14,aggressivity:-6,aggressor:-8,aggressors:-9,aghast:-19,agitate:-17,agitated:-20,agitatedly:-16,agitates:-14,agitating:-18,agitation:-10,agitational:-12,agitations:-13,agitative:-13,agitato:-1,agitator:-14,agitators:-21,agog:19,agonise:-21,agonised:-23,agonises:-24,agonising:-15,agonize:-23,agonized:-22,agonizes:-23,agonizing:-27,agonizingly:-23,agony:-18,agree:15,agreeability:19,agreeable:18,agreeableness:18,agreeablenesses:13,agreeably:16,agreed:11,agreeing:14,agreement:22,agreements:11,agrees:8,alarm:-14,alarmed:-14,alarming:-5,alarmingly:-26,alarmism:-3,alarmists:-11,alarms:-11,alas:-11,alert:12,alienation:-11,alive:16,allergic:-12,allow:9,alone:-10,alright:10,amaze:25,amazed:22,amazedly:21,amazement:25,amazements:22,amazes:22,amazing:28,amazon:7,amazonite:2,amazons:-1,amazonstone:10,amazonstones:2,ambitious:21,ambivalent:5,amor:30,amoral:-16,amoralism:-7,amoralisms:-7,amoralities:-12,amorality:-15,amorally:-10,amoretti:2,amoretto:6,amorettos:3,amorino:12,amorist:16,amoristic:10,amorists:1,amoroso:23,amorous:18,amorously:23,amorousness:20,amorphous:-2,amorphously:1,amorphousness:3,amort:-21,amortise:5,amortised:-2,amortises:1,amortizable:5,amortization:6,amortizations:2,amortize:-1,amortized:8,amortizes:6,amortizing:8,amusable:7,amuse:17,amused:18,amusedly:22,amusement:15,amusements:15,amuser:11,amusers:13,amuses:17,amusia:3,amusias:-4,amusing:16,amusingly:8,amusingness:18,amusive:17,anger:-27,angered:-23,angering:-22,angerly:-19,angers:-23,angrier:-23,angriest:-31,angrily:-18,angriness:-17,angry:-23,anguish:-29,anguished:-18,anguishes:-21,anguishing:-27,animosity:-19,annoy:-19,annoyance:-13,annoyances:-18,annoyed:-16,annoyer:-22,annoyers:-15,annoying:-17,annoys:-18,antagonism:-19,antagonisms:-12,antagonist:-19,antagonistic:-17,antagonistically:-22,antagonists:-17,antagonize:-20,antagonized:-14,antagonizes:-5,antagonizing:-27,anti:-13,anticipation:4,anxieties:-6,anxiety:-7,anxious:-10,anxiously:-9,anxiousness:-10,aok:20,apathetic:-12,apathetically:-4,apathies:-6,apathy:-12,apeshit:-9,apocalyptic:-34,apologise:16,apologised:4,apologises:8,apologising:2,apologize:4,apologized:13,apologizes:15,apologizing:-3,apology:2,appall:-24,appalled:-20,appalling:-15,appallingly:-20,appalls:-19,appease:11,appeased:9,appeases:9,appeasing:10,applaud:20,applauded:15,applauding:21,applauds:14,applause:18,appreciate:17,appreciated:23,appreciates:23,appreciating:19,appreciation:23,appreciations:17,appreciative:26,appreciatively:18,appreciativeness:16,appreciator:26,appreciators:15,appreciatory:17,apprehensible:11,apprehensibly:-2,apprehension:-21,apprehensions:-9,apprehensively:-3,apprehensiveness:-7,approval:21,approved:18,approves:17,ardent:21,arguable:-10,arguably:-10,argue:-14,argued:-15,arguer:-16,arguers:-14,argues:-16,arguing:-20,argument:-15,argumentative:-15,argumentatively:-18,argumentive:-15,arguments:-17,arrest:-14,arrested:-21,arrests:-19,arrogance:-24,arrogances:-19,arrogant:-22,arrogantly:-18,ashamed:-21,ashamedly:-17,ass:-25,assassination:-29,assassinations:-27,assault:-28,assaulted:-24,assaulting:-23,assaultive:-28,assaults:-25,asset:15,assets:7,assfucking:-25,assholes:-28,assurance:14,assurances:14,assure:14,assured:15,assuredly:16,assuredness:14,assurer:9,assurers:11,assures:13,assurgent:13,assuring:16,assuror:5,assurors:7,astonished:16,astound:17,astounded:18,astounding:18,astoundingly:21,astounds:21,attachment:12,attachments:11,attack:-21,attacked:-20,attacker:-27,attackers:-27,attacking:-20,attacks:-19,attract:15,attractancy:9,attractant:13,attractants:14,attracted:18,attracting:21,attraction:20,attractions:18,attractive:19,attractively:22,attractiveness:18,attractivenesses:21,attractor:12,attractors:12,attracts:17,audacious:9,authority:3,aversion:-19,aversions:-11,aversive:-16,aversively:-8,avert:-7,averted:-3,averts:-4,avid:12,avoid:-12,avoidance:-17,avoidances:-11,avoided:-14,avoider:-18,avoiders:-14,avoiding:-14,avoids:-7,await:4,awaited:-1,awaits:3,award:25,awardable:24,awarded:17,awardee:18,awardees:12,awarder:9,awarders:13,awarding:19,awards:20,awesome:31,awful:-20,awkward:-6,awkwardly:-13,awkwardness:-7,axe:-4,axed:-13,backed:1,backing:1,backs:-2,bad:-25,badass:14,badly:-21,bailout:-4,bamboozle:-15,bamboozled:-15,bamboozles:-15,ban:-26,banish:-19,bankrupt:-26,bankster:-21,banned:-20,bargain:8,barrier:-5,bashful:-1,bashfully:2,bashfulness:-8,bastard:-25,bastardies:-18,bastardise:-21,bastardised:-23,bastardises:-23,bastardising:-26,bastardization:-24,bastardizations:-21,bastardize:-24,bastardized:-20,bastardizes:-18,bastardizing:-23,bastardly:-27,bastards:-30,bastardy:-27,battle:-16,battled:-12,battlefield:-16,battlefields:-9,battlefront:-12,battlefronts:-8,battleground:-17,battlegrounds:-6,battlement:-4,battlements:-4,battler:-8,battlers:-2,battles:-16,battleship:-1,battleships:-5,battlewagon:-3,battlewagons:-5,battling:-11,beaten:-18,beatific:18,beating:-20,beaut:16,beauteous:25,beauteously:26,beauteousness:27,beautician:12,beauticians:4,beauties:24,beautification:19,beautifications:24,beautified:21,beautifier:17,beautifiers:17,beautifies:18,beautiful:29,beautifuler:21,beautifulest:26,beautifully:27,beautifulness:26,beautify:23,beautifying:23,beauts:17,beauty:28,belittle:-19,belittled:-20,beloved:23,benefic:14,benefice:4,beneficed:11,beneficence:28,beneficences:15,beneficent:23,beneficently:22,benefices:11,beneficial:19,beneficially:24,beneficialness:17,beneficiaries:18,beneficiary:21,beneficiate:10,beneficiation:4,benefit:20,benefits:16,benefitted:17,benefitting:19,benevolence:17,benevolences:19,benevolent:27,benevolently:14,benevolentness:12,benign:13,benignancy:6,benignant:22,benignantly:11,benignities:9,benignity:13,benignly:2,bereave:-21,bereaved:-21,bereaves:-19,bereaving:-13,best:32,betray:-32,betrayal:-28,betrayed:-30,betraying:-25,betrays:-25,better:19,bias:-4,biased:-11,bitch:-28,bitched:-26,bitcheries:-23,bitchery:-27,bitches:-29,bitchier:-20,bitchiest:-30,bitchily:-26,bitchiness:-26,bitching:-11,bitchy:-23,bitter:-18,bitterbrush:-2,bitterbrushes:-6,bittered:-18,bitterer:-19,bitterest:-23,bittering:-12,bitterish:-16,bitterly:-20,bittern:-2,bitterness:-17,bitterns:-4,bitterroots:-2,bitters:-4,bittersweet:-3,bittersweetness:-6,bittersweets:-2,bitterweeds:-5,bizarre:-13,blah:-4,blam:-2,blamable:-18,blamably:-18,blame:-14,blamed:-21,blameful:-17,blamefully:-16,blameless:7,blamelessly:9,blamelessness:6,blamer:-21,blamers:-20,blames:-17,blameworthiness:-16,blameworthy:-23,blaming:-22,bless:18,blessed:29,blesseder:20,blessedest:28,blessedly:17,blessedness:16,blesser:26,blessers:19,blesses:26,blessing:22,blessings:25,blind:-17,bliss:27,blissful:29,blithe:12,block:-19,blockbuster:29,blocked:-11,blocking:-16,blocks:-9,bloody:-19,blurry:-4,bold:16,bolder:12,boldest:16,boldface:3,boldfaced:-1,boldfaces:1,boldfacing:1,boldly:15,boldness:15,boldnesses:9,bolds:13,bomb:-22,bonus:25,bonuses:26,boost:17,boosted:15,boosting:14,boosts:13,bore:-10,boreal:-3,borecole:-2,borecoles:-3,bored:-11,boredom:-13,boredoms:-11,boreen:1,boreens:2,boreholes:-2,borer:-4,borers:-12,bores:-13,borescopes:-1,boresome:-13,boring:-13,bother:-14,botheration:-17,botherations:-13,bothered:-13,bothering:-16,bothers:-8,bothersome:-13,boycott:-13,boycotted:-17,boycotting:-17,boycotts:-14,brainwashing:-15,brave:24,braved:19,bravely:23,braver:24,braveries:20,bravery:22,braves:19,bravest:23,breathtaking:20,bribe:-8,bright:19,brighten:19,brightened:21,brightener:10,brighteners:10,brightening:25,brightens:15,brighter:16,brightest:30,brightly:15,brightness:16,brightnesses:14,brights:4,brightwork:11,brilliance:29,brilliances:29,brilliancies:23,brilliancy:26,brilliant:28,brilliantine:8,brilliantines:20,brilliantly:30,brilliants:19,brisk:6,broke:-18,broken:-21,brooding:1,brutal:-31,brutalise:-27,brutalised:-29,brutalises:-32,brutalising:-28,brutalities:-26,brutality:-30,brutalization:-21,brutalizations:-23,brutalize:-29,brutalized:-24,brutalizes:-32,brutalizing:-34,brutally:-30,bullied:-31,bullshit:-28,bully:-22,bullying:-29,bummer:-16,buoyant:9,burden:-19,burdened:-17,burdener:-13,burdeners:-17,burdening:-14,burdens:-15,burdensome:-18,bwahaha:4,bwahahah:25,calm:13,calmative:11,calmatives:5,calmed:16,calmer:15,calmest:16,calming:17,calmly:13,calmness:17,calmnesses:16,calmodulin:2,calms:13,cancel:-10,cancelled:-10,cancelling:-8,cancels:-9,cancer:-34,capable:16,captivated:16,care:22,cared:18,carefree:17,careful:6,carefully:5,carefulness:20,careless:-15,carelessly:-10,carelessness:-14,carelessnesses:-16,cares:20,caring:22,casual:8,casually:7,casualty:-24,catastrophe:-34,catastrophic:-22,cautious:-4,celebrate:27,celebrated:27,celebrates:27,celebrating:27,censor:-20,censored:-6,censors:-12,certain:11,certainly:14,certainties:9,certainty:10,chagrin:-19,chagrined:-14,challenge:3,challenged:-4,challenger:5,challengers:4,challenges:3,challenging:6,challengingly:-6,champ:21,champac:-2,champagne:12,champagnes:5,champaign:2,champaigns:5,champaks:-2,champed:10,champer:-1,champers:5,champerties:-1,champertous:3,champerty:-2,champignon:4,champignons:2,champing:7,champion:29,championed:12,championing:18,champions:24,championship:19,championships:22,champs:18,champy:10,chance:10,chances:8,chaos:-27,chaotic:-22,charged:-8,charges:-11,charitable:17,charitableness:19,charitablenesses:16,charitably:14,charities:22,charity:18,charm:17,charmed:20,charmer:19,charmers:21,charmeuse:3,charmeuses:4,charming:28,charminger:15,charmingest:24,charmingly:22,charmless:-18,charms:19,chastise:-25,chastised:-22,chastises:-17,chastising:-17,cheat:-20,cheated:-23,cheater:-25,cheaters:-19,cheating:-26,cheats:-18,cheer:23,cheered:23,cheerer:17,cheerers:18,cheerful:25,cheerfuller:19,cheerfullest:32,cheerfully:21,cheerfulness:21,cheerier:26,cheeriest:22,cheerily:25,cheeriness:25,cheering:23,cheerio:12,cheerlead:17,cheerleader:9,cheerleaders:12,cheerleading:12,cheerleads:12,cheerled:15,cheerless:-17,cheerlessly:-8,cheerlessness:-17,cheerly:24,cheers:21,cheery:26,cherish:16,cherishable:20,cherished:23,cherisher:22,cherishers:19,cherishes:22,cherishing:20,chic:11,childish:-12,chilling:-1,choke:-25,choked:-21,chokes:-20,choking:-20,chuckle:17,chuckled:12,chucklehead:-19,chuckleheaded:-13,chuckleheads:-11,chuckler:8,chucklers:12,chuckles:11,chucklesome:11,chuckling:14,chucklingly:12,clarifies:9,clarity:17,classy:19,clean:17,cleaner:7,clear:16,cleared:4,clearly:17,clears:3,clever:20,cleverer:20,cleverest:26,cleverish:10,cleverly:23,cleverness:23,clevernesses:14,clouded:-2,clueless:-15,cock:-6,cocksucker:-31,cocksuckers:-26,cocky:-5,coerced:-15,collapse:-22,collapsed:-11,collapses:-12,collapsing:-12,collide:-3,collides:-11,colliding:-5,collision:-15,collisions:-11,colluding:-12,combat:-14,combats:-8,comedian:16,comedians:12,comedic:17,comedically:21,comedienne:6,comediennes:16,comedies:17,comedo:3,comedones:-8,comedown:-8,comedowns:-9,comedy:15,comfort:15,comfortable:23,comfortableness:13,comfortably:18,comforted:18,comforter:19,comforters:12,comforting:17,comfortingly:17,comfortless:-18,comforts:21,commend:19,commended:19,commit:12,commitment:16,commitments:5,commits:1,committed:11,committing:3,compassion:20,compassionate:22,compassionated:16,compassionately:17,compassionateness:9,compassionates:16,compassionating:16,compassionless:-26,compelled:2,compelling:9,competent:13,competitive:7,complacent:-3,complain:-15,complainant:-7,complainants:-11,complained:-17,complainer:-18,complainers:-13,complaining:-8,complainingly:-17,complains:-16,complaint:-12,complaints:-17,compliment:21,complimentarily:17,complimentary:19,complimented:18,complimenting:23,compliments:17,comprehensive:10,conciliate:10,conciliated:11,conciliates:11,conciliating:13,condemn:-16,condemnation:-28,condemned:-19,condemns:-23,confidence:23,confident:22,confidently:21,conflict:-13,conflicting:-17,conflictive:-18,conflicts:-16,confront:-7,confrontation:-13,confrontational:-16,confrontationist:-10,confrontationists:-12,confrontations:-15,confronted:-8,confronter:-3,confronters:-13,confronting:-6,confronts:-9,confuse:-9,confused:-13,confusedly:-6,confusedness:-15,confuses:-13,confusing:-9,confusingly:-14,confusion:-12,confusional:-12,confusions:-9,congrats:24,congratulate:22,congratulation:29,congratulations:29,consent:9,consents:10,considerate:19,consolable:11,conspiracy:-24,constrained:-4,contagion:-20,contagions:-15,contagious:-14,contempt:-28,contemptibilities:-20,contemptibility:-9,contemptible:-16,contemptibleness:-19,contemptibly:-14,contempts:-10,contemptuous:-22,contemptuously:-24,contemptuousness:-11,contend:2,contender:5,contented:14,contentedly:19,contentedness:14,contentious:-12,contentment:15,contestable:6,contradict:-13,contradictable:-10,contradicted:-13,contradicting:-13,contradiction:-10,contradictions:-13,contradictious:-19,contradictor:-10,contradictories:-5,contradictorily:-9,contradictoriness:-14,contradictors:-16,contradictory:-14,contradicts:-14,controversial:-8,controversially:-11,convince:10,convinced:17,convincer:6,convincers:3,convinces:7,convincing:17,convincingly:16,convincingness:7,convivial:12,cool:13,cornered:-11,corpse:-27,costly:-4,courage:22,courageous:24,courageously:23,courageousness:21,courteous:23,courtesy:15,cover-up:-12,coward:-20,cowardly:-16,coziness:15,cramp:-8,crap:-16,crappy:-26,crash:-17,craze:-6,crazed:-5,crazes:2,crazier:-1,craziest:-2,crazily:-15,craziness:-16,crazinesses:-10,crazing:-5,crazy:-14,crazyweed:8,create:11,created:10,creates:11,creatin:1,creatine:2,creating:12,creatinine:4,creation:11,creationism:7,creationisms:11,creationist:8,creationists:5,creations:16,creative:19,creatively:15,creativeness:18,creativities:17,creativity:16,credit:16,creditabilities:14,creditability:19,creditable:18,creditableness:12,creditably:17,credited:15,crediting:6,creditor:-1,credits:15,creditworthiness:19,creditworthy:24,crestfallen:-25,cried:-16,cries:-17,crime:-25,criminal:-24,criminals:-27,crisis:-31,critic:-11,critical:-13,criticise:-19,criticised:-18,criticises:-13,criticising:-17,criticism:-19,criticisms:-9,criticizable:-10,criticize:-16,criticized:-15,criticizer:-15,criticizers:-16,criticizes:-14,criticizing:-15,critics:-12,crude:-27,crudely:-12,crudeness:-20,crudenesses:-20,cruder:-20,crudes:-11,crudest:-24,cruel:-28,crueler:-23,cruelest:-26,crueller:-24,cruellest:-29,cruelly:-28,cruelness:-29,cruelties:-23,cruelty:-29,crush:-6,crushed:-18,crushes:-19,crushing:-15,cry:-21,crying:-21,cunt:-22,cunts:-29,curious:13,curse:-25,cut:-11,cute:20,cutely:13,cuteness:23,cutenesses:19,cuter:23,cutes:18,cutesie:10,cutesier:15,cutesiest:22,cutest:28,cutesy:21,cutey:21,cuteys:15,cutie:15,cutiepie:20,cuties:22,cuts:-12,cutting:-5,cynic:-14,cynical:-16,cynically:-13,cynicism:-17,cynicisms:-17,cynics:-3,damage:-22,damaged:-19,damager:-19,damagers:-20,damages:-19,damaging:-23,damagingly:-20,damn:-17,damnable:-17,damnableness:-18,damnably:-17,damnation:-26,damnations:-14,damnatory:-26,damned:-16,damnedest:-5,damnified:-28,damnifies:-18,damnify:-22,damnifying:-24,damning:-14,damningly:-20,damnit:-24,damns:-22,danger:-24,dangered:-24,dangering:-25,dangerous:-21,dangerously:-20,dangerousness:-20,dangers:-22,daredevil:5,daring:15,daringly:21,daringness:14,darings:4,darkest:-22,darkness:-10,darling:28,darlingly:16,darlingness:23,darlings:22,dauntless:23,daze:-7,dazed:-7,dazedly:-4,dazedness:-5,dazes:-3,dead:-33,deadlock:-14,deafening:-12,dear:16,dearer:19,dearest:26,dearie:22,dearies:10,dearly:18,dearness:20,dears:19,dearth:-23,dearths:-9,deary:19,death:-29,debonair:8,debt:-15,decay:-17,decayed:-16,decayer:-16,decayers:-16,decaying:-17,decays:-17,deceit:-20,deceitful:-19,deceive:-17,deceived:-19,deceives:-16,deceiving:-14,deception:-19,decisive:9,dedicated:20,defeat:-20,defeated:-21,defeater:-14,defeaters:-9,defeating:-16,defeatism:-13,defeatist:-17,defeatists:-21,defeats:-13,defeature:-19,defeatures:-15,defect:-14,defected:-17,defecting:-18,defection:-14,defections:-15,defective:-19,defectively:-21,defectiveness:-18,defectives:-18,defector:-19,defectors:-13,defects:-17,defence:4,defenceman:4,defencemen:6,defences:-2,defender:4,defenders:3,defense:5,defenseless:-14,defenselessly:-11,defenselessness:-13,defenseman:1,defensemen:-4,defenses:7,defensibility:4,defensible:8,defensibly:1,defensive:1,defensively:-6,defensiveness:-4,defensives:-3,defer:-12,deferring:-7,defiant:-9,deficit:-17,definite:11,definitely:17,degradable:-10,degradation:-24,degradations:-15,degradative:-20,degrade:-19,degraded:-18,degrader:-20,degraders:-20,degrades:-21,degrading:-28,degradingly:-27,dehumanize:-18,dehumanized:-19,dehumanizes:-15,dehumanizing:-24,deject:-22,dejected:-22,dejecting:-23,dejects:-20,delay:-13,delayed:-9,delectable:29,delectables:14,delectably:28,delicate:2,delicately:10,delicates:6,delicatessen:4,delicatessens:4,delicious:27,deliciously:19,deliciousness:18,delight:29,delighted:23,delightedly:24,delightedness:21,delighter:20,delighters:26,delightful:28,delightfully:27,delightfulness:21,delighting:16,delights:20,delightsome:23,demand:-5,demanded:-9,demanding:-9,demonstration:4,demoralized:-16,denied:-19,denier:-15,deniers:-11,denies:-18,denounce:-14,denounces:-19,deny:-14,denying:-14,depress:-22,depressant:-16,depressants:-16,depressed:-23,depresses:-22,depressible:-17,depressing:-16,depressingly:-23,depression:-27,depressions:-22,depressive:-16,depressively:-21,depressives:-15,depressor:-18,depressors:-17,depressurization:-3,depressurizations:-4,depressurize:-5,depressurized:-3,depressurizes:-3,depressurizing:-7,deprival:-21,deprivals:-12,deprivation:-18,deprivations:-18,deprive:-21,deprived:-21,depriver:-16,deprivers:-14,deprives:-17,depriving:-20,derail:-12,derailed:-14,derails:-13,deride:-11,derided:-8,derides:-10,deriding:-15,derision:-12,desirable:13,desire:17,desired:11,desirous:13,despair:-13,despaired:-27,despairer:-13,despairers:-13,despairing:-23,despairingly:-22,despairs:-27,desperate:-13,desperately:-16,desperateness:-15,desperation:-20,desperations:-22,despise:-14,despised:-17,despisement:-24,despisements:-25,despiser:-18,despisers:-16,despises:-20,despising:-27,despondent:-21,destroy:-25,destroyed:-22,destroyer:-20,destroyers:-23,destroying:-26,destroys:-26,destruct:-24,destructed:-19,destructibility:-18,destructible:-15,destructing:-25,destruction:-27,destructionist:-26,destructionists:-21,destructions:-23,destructive:-30,destructively:-24,destructiveness:-24,destructivity:-22,destructs:-24,detached:-5,detain:-18,detained:-17,detention:-15,determinable:9,determinableness:2,determinably:9,determinacy:10,determinant:2,determinantal:-3,determinate:8,determinately:12,determinateness:11,determination:17,determinations:8,determinative:11,determinatives:9,determinator:11,determined:14,devastate:-31,devastated:-30,devastates:-28,devastating:-33,devastatingly:-24,devastation:-18,devastations:-19,devastative:-32,devastator:-28,devastators:-29,devil:-34,deviled:-16,devilfish:-8,devilfishes:-6,deviling:-22,devilish:-21,devilishly:-16,devilishness:-23,devilkin:-24,devilled:-23,devilling:-18,devilment:-19,devilments:-11,devilries:-16,devilry:-28,devils:-27,deviltries:-15,deviltry:-28,devilwood:-8,devilwoods:-10,devote:14,devoted:17,devotedly:16,devotedness:20,devotee:16,devotees:5,devotement:15,devotements:11,devotes:16,devoting:21,devotion:20,devotional:12,devotionally:22,devotionals:12,devotions:18,diamond:14,dick:-23,dickhead:-31,die:-29,died:-26,difficult:-15,difficulties:-12,difficultly:-17,difficulty:-14,diffident:-10,dignified:22,dignifies:20,dignify:18,dignifying:21,dignitaries:6,dignitary:19,dignities:14,dignity:17,dilemma:-7,dipshit:-21,dire:-20,direful:-31,dirt:-14,dirtier:-14,dirtiest:-24,dirty:-19,disabling:-21,disadvantage:-18,disadvantaged:-17,disadvantageous:-18,disadvantageously:-21,disadvantageousness:-16,disadvantages:-17,disagree:-16,disagreeable:-17,disagreeableness:-17,disagreeablenesses:-19,disagreeably:-15,disagreed:-13,disagreeing:-14,disagreement:-15,disagreements:-18,disagrees:-13,disappear:-9,disappeared:-9,disappears:-14,disappoint:-17,disappointed:-21,disappointedly:-17,disappointing:-22,disappointingly:-19,disappointment:-23,disappointments:-20,disappoints:-16,disaster:-31,disasters:-26,disastrous:-29,disbelieve:-12,discard:-10,discarded:-14,discarding:-7,discards:-10,discomfort:-18,discomfortable:-16,discomforted:-16,discomforting:-16,discomforts:-13,disconsolate:-23,disconsolation:-17,discontented:-18,discord:-17,discounted:2,discourage:-18,discourageable:-12,discouraged:-17,discouragement:-20,discouragements:-18,discourager:-17,discouragers:-19,discourages:-19,discouraging:-19,discouragingly:-18,discredited:-19,disdain:-21,disgrace:-22,disgraced:-20,disguise:-10,disguised:-11,disguises:-10,disguising:-13,disgust:-29,disgusted:-24,disgustedly:-30,disgustful:-26,disgusting:-24,disgustingly:-29,disgusts:-21,dishearten:-20,disheartened:-22,disheartening:-18,dishearteningly:-20,disheartenment:-23,disheartenments:-22,disheartens:-22,dishonest:-27,disillusion:-10,disillusioned:-19,disillusioning:-13,disillusionment:-17,disillusionments:-15,disillusions:-16,disinclined:-11,disjointed:-13,dislike:-16,disliked:-17,dislikes:-17,disliking:-13,dismal:-30,dismay:-18,dismayed:-19,dismaying:-22,dismayingly:-19,dismays:-18,disorder:-17,disorganized:-12,disoriented:-15,disparage:-20,disparaged:-14,disparages:-16,disparaging:-22,displeased:-19,dispute:-17,disputed:-14,disputes:-11,disputing:-17,disqualified:-18,disquiet:-13,disregard:-11,disregarded:-16,disregarding:-9,disregards:-14,disrespect:-18,disrespected:-20,disruption:-15,disruptions:-14,disruptive:-13,dissatisfaction:-22,dissatisfactions:-19,dissatisfactory:-20,dissatisfied:-16,dissatisfies:-18,dissatisfy:-22,dissatisfying:-24,distort:-13,distorted:-17,distorting:-11,distorts:-14,distract:-12,distractable:-13,distracted:-14,distractedly:-9,distractibility:-13,distractible:-15,distracting:-12,distractingly:-14,distraction:-16,distractions:-10,distractive:-16,distracts:-13,distraught:-26,distress:-24,distressed:-18,distresses:-16,distressful:-22,distressfully:-17,distressfulness:-24,distressing:-17,distressingly:-22,distrust:-18,distrusted:-24,distrustful:-21,distrustfully:-18,distrustfulness:-16,distrusting:-21,distrusts:-13,disturb:-17,disturbance:-16,disturbances:-14,disturbed:-16,disturber:-14,disturbers:-21,disturbing:-23,disturbingly:-23,disturbs:-19,dithering:-5,divination:17,divinations:11,divinatory:16,divine:26,divined:8,divinely:29,diviner:3,diviners:12,divines:8,divinest:27,diving:3,divining:9,divinise:5,divinities:18,divinity:27,divinize:23,dizzy:-9,dodging:-4,dodgy:-9,dolorous:-22,dominance:8,dominances:-1,dominantly:2,dominants:2,dominate:-5,dominates:2,dominating:-12,domination:-2,dominations:-3,dominative:-7,dominators:-4,dominatrices:-2,dominatrix:-5,dominatrixes:6,doom:-17,doomed:-32,doomful:-21,dooming:-28,dooms:-11,doomsayer:-7,doomsayers:-17,doomsaying:-15,doomsayings:-15,doomsday:-28,doomsdayer:-22,doomsdays:-24,doomster:-22,doomsters:-16,doomy:-11,dork:-14,dorkier:-11,dorkiest:-12,dorks:-5,dorky:-11,doubt:-15,doubtable:-15,doubted:-11,doubter:-16,doubters:-13,doubtful:-14,doubtfully:-12,doubtfulness:-12,doubting:-14,doubtingly:-14,doubtless:9,doubtlessly:12,doubtlessness:8,doubts:-12,douche:-15,douchebag:-30,downcast:-18,downhearted:-23,downside:-10,drag:-9,dragged:-2,drags:-7,drained:-15,dread:-20,dreaded:-27,dreadful:-19,dreadfully:-27,dreadfulness:-32,dreadfuls:-24,dreading:-24,dreadlock:-4,dreadlocks:-2,dreadnought:-6,dreadnoughts:-4,dreads:-14,dream:10,dreams:17,dreary:-14,droopy:-8,drop:-11,drown:-27,drowned:-29,drowns:-22,drunk:-14,dubious:-15,dud:-10,dull:-17,dullard:-16,dullards:-18,dulled:-15,duller:-17,dullest:-17,dulling:-11,dullish:-11,dullness:-14,dullnesses:-19,dulls:-10,dullsville:-24,dully:-11,dumb:-23,dumbass:-26,dumbbell:-8,dumbbells:-2,dumbcane:-3,dumbcanes:-6,dumbed:-14,dumber:-15,dumbest:-23,dumbfound:-1,dumbfounded:-16,dumbfounder:-10,dumbfounders:-10,dumbfounding:-8,dumbfounds:-3,dumbhead:-26,dumbheads:-19,dumbing:-5,dumbly:-13,dumbness:-19,dumbs:-15,dumbstruck:-10,dumbwaiter:2,dumbwaiters:-1,dump:-16,dumpcart:-6,dumped:-17,dumper:-12,dumpers:-8,dumpier:-14,dumpiest:-16,dumpiness:-12,dumping:-13,dumpings:-11,dumpish:-18,dumpling:4,dumplings:-3,dumps:-17,dumpster:-6,dumpsters:-10,dumpy:-17,dupe:-15,duped:-18,dwell:5,dwelled:4,dweller:3,dwellers:-3,dwelling:1,dwells:-1,dynamic:16,dynamical:12,dynamically:15,dynamics:11,dynamism:16,dynamisms:12,dynamist:14,dynamistic:15,dynamists:9,dynamite:7,dynamited:-9,dynamiter:-12,dynamiters:4,dynamites:-3,dynamitic:9,dynamiting:2,dynamometer:3,dynamometers:3,dynamometric:3,dynamometry:6,dynamos:3,dynamotor:6,dysfunction:-18,eager:15,eagerly:16,eagerness:17,eagers:16,earnest:23,ease:15,eased:12,easeful:15,easefully:14,easel:3,easement:16,easements:4,eases:13,easier:18,easiest:18,easily:14,easiness:16,easing:10,easy:19,easygoing:13,easygoingness:15,ecstacy:33,ecstasies:23,ecstasy:29,ecstatic:23,ecstatically:28,ecstatics:29,eerie:-15,eery:-9,effective:21,effectively:19,efficiencies:16,efficiency:15,efficient:18,efficiently:17,effin:-23,egotism:-14,egotisms:-10,egotist:-23,egotistic:-14,egotistical:-9,egotistically:-18,egotists:-17,elated:32,elation:15,elegance:21,elegances:18,elegancies:16,elegancy:21,elegant:21,elegantly:19,embarrass:-12,embarrassable:-16,embarrassed:-15,embarrassedly:-11,embarrasses:-17,embarrassing:-16,embarrassingly:-17,embarrassment:-19,embarrassments:-17,embittered:-4,embrace:13,emergency:-16,emotional:6,empathetic:17,emptied:-7,emptier:-7,emptiers:-7,empties:-7,emptiest:-18,emptily:-10,emptiness:-19,emptinesses:-15,emptins:-3,empty:-8,emptying:-6,enchanted:16,encourage:23,encouraged:15,encouragement:18,encouragements:21,encourager:15,encouragers:15,encourages:19,encouraging:24,encouragingly:20,endorse:13,endorsed:10,endorsement:13,endorses:14,enemies:-22,enemy:-25,energetic:19,energetically:18,energetics:3,energies:9,energise:22,energised:21,energises:22,energising:19,energization:16,energizations:15,energize:21,energized:23,energizer:21,energizers:17,energizes:21,energizing:20,energy:11,engage:14,engaged:17,engagement:20,engagements:6,engager:11,engagers:10,engages:10,engaging:14,engagingly:15,engrossed:6,enjoy:22,enjoyable:19,enjoyableness:19,enjoyably:18,enjoyed:23,enjoyer:22,enjoyers:22,enjoying:24,enjoyment:26,enjoyments:20,enjoys:23,enlighten:23,enlightened:22,enlightening:23,enlightens:17,ennui:-12,enrage:-26,enraged:-17,enrages:-18,enraging:-28,enrapture:30,enslave:-31,enslaved:-17,enslaves:-16,ensure:16,ensuring:11,enterprising:23,entertain:13,entertained:17,entertainer:16,entertainers:10,entertaining:19,entertainingly:19,entertainment:18,entertainments:23,entertains:24,enthral:4,enthuse:16,enthused:20,enthuses:17,enthusiasm:19,enthusiasms:20,enthusiast:15,enthusiastic:22,enthusiastically:26,enthusiasts:14,enthusing:19,entitled:11,entrusted:8,envied:-11,envier:-10,enviers:-11,envies:-8,envious:-11,envy:-11,envying:-8,envyingly:-13,erroneous:-18,error:-17,errors:-14,escape:7,escapes:5,escaping:2,esteemed:19,ethical:23,euphoria:33,euphoric:32,eviction:-20,evil:-34,evildoer:-31,evildoers:-24,evildoing:-31,evildoings:-25,eviler:-21,evilest:-25,eviller:-29,evillest:-33,evilly:-34,evilness:-31,evils:-27,exaggerate:-6,exaggerated:-4,exaggerates:-6,exaggerating:-7,exasperated:-18,excel:20,excelled:22,excellence:31,excellences:25,excellencies:24,excellency:25,excellent:27,excellently:31,excelling:25,excels:25,excelsior:7,excitabilities:15,excitability:12,excitable:15,excitableness:10,excitant:18,excitants:12,excitation:18,excitations:18,excitative:3,excitatory:11,excite:21,excited:14,excitedly:23,excitement:22,excitements:19,exciter:19,exciters:14,excites:21,exciting:22,excitingly:19,exciton:3,excitonic:2,excitons:8,excitor:5,exclude:-9,excluded:-14,exclusion:-12,exclusive:5,excruciate:-27,excruciated:-13,excruciates:-10,excruciating:-33,excruciatingly:-29,excruciation:-34,excruciations:-19,excuse:3,exempt:4,exhaust:-12,exhausted:-15,exhauster:-13,exhausters:-13,exhaustibility:-8,exhaustible:-10,exhausting:-15,exhaustion:-15,exhaustions:-11,exhaustive:-5,exhaustively:-7,exhaustiveness:-11,exhaustless:2,exhaustlessness:9,exhausts:-11,exhilarated:30,exhilarates:28,exhilarating:17,exonerate:18,exonerated:18,exonerates:16,exonerating:10,expand:13,expands:4,expel:-19,expelled:-10,expelling:-16,expels:-16,exploit:-4,exploited:-20,exploiting:-19,exploits:-14,exploration:9,explorations:3,expose:-6,exposed:-3,exposes:-5,exposing:-11,extend:7,extends:5,exuberant:28,exultant:30,exultantly:14,fab:20,fabulous:24,fabulousness:28,fad:9,fag:-21,faggot:-34,faggots:-32,fail:-25,failed:-23,failing:-23,failingly:-14,failings:-22,faille:1,fails:-18,failure:-23,failures:-20,fainthearted:-3,fair:13,faith:18,faithed:13,faithful:19,faithfully:18,faithfulness:19,faithless:-10,faithlessly:-9,faithlessness:-18,faiths:18,fake:-21,fakes:-18,faking:-18,fallen:-15,falling:-6,falsified:-16,falsify:-20,fame:19,fan:13,fantastic:26,fantastical:20,fantasticalities:21,fantasticality:17,fantasticalness:13,fantasticate:15,fantastico:4,farce:-17,fascinate:24,fascinated:21,fascinates:20,fascination:22,fascinating:25,fascist:-26,fascists:-8,fatal:-25,fatalism:-6,fatalisms:-17,fatalist:-5,fatalistic:-10,fatalists:-12,fatalities:-29,fatality:-35,fatally:-32,fatigue:-10,fatigued:-14,fatigues:-13,fatiguing:-12,fatiguingly:-15,fault:-17,faulted:-14,faultfinder:-8,faultfinders:-15,faultfinding:-21,faultier:-21,faultiest:-21,faultily:-20,faultiness:-15,faulting:-14,faultless:20,faultlessly:20,faultlessness:11,faults:-21,faulty:-13,fav:20,fave:19,favor:17,favorable:21,favorableness:22,favorably:16,favored:18,favorer:13,favorers:14,favoring:18,favorite:20,favorited:17,favorites:18,favoritism:7,favoritisms:7,favors:10,favour:19,favoured:18,favourer:16,favourers:16,favouring:13,favours:18,fear:-22,feared:-22,fearful:-22,fearfuller:-22,fearfullest:-25,fearfully:-22,fearfulness:-18,fearing:-27,fearless:19,fearlessly:11,fearlessness:11,fears:-18,fearsome:-17,feeble:-12,feeling:5,felonies:-25,felony:-25,ferocious:-4,ferociously:-11,ferociousness:-10,ferocities:-10,ferocity:-7,fervent:11,fervid:5,festival:22,festivalgoer:13,festivalgoers:12,festivals:15,festive:20,festively:22,festiveness:24,festivities:21,festivity:22,feud:-14,feudal:-8,feudalism:-9,feudalisms:-2,feudalist:-9,feudalistic:-11,feudalities:-4,feudality:-5,feudalization:-3,feudalize:-5,feudalized:-8,feudalizes:-1,feudalizing:-7,feudally:-6,feudaries:-3,feudary:-8,feudatories:-5,feudatory:-1,feuded:-22,feuding:-16,feudist:-11,feudists:-7,feuds:-14,fiasco:-23,fidgety:-14,fiery:-14,fiesta:21,fiestas:15,fight:-16,fighter:6,fighters:-2,fighting:-15,fightings:-19,fights:-17,fine:8,fire:-14,fired:-26,firing:-14,fit:15,fitness:11,flagship:4,flatter:4,flattered:16,flatterer:-3,flatterers:3,flatteries:12,flattering:13,flatteringly:10,flatters:6,flattery:4,flawed:-21,flawless:23,flawlessly:8,flees:-7,flexibilities:10,flexibility:14,flexible:9,flexibly:13,flirtation:17,flirtations:-1,flirtatious:5,flirtatiously:-1,flirtatiousness:6,flirted:-2,flirter:-4,flirters:6,flirtier:-1,flirtiest:4,flirting:8,flirts:7,flirty:6,flop:-14,flops:-14,flu:-16,flunk:-13,flunked:-21,flunker:-19,flunkers:-16,flunkey:-18,flunkeys:-6,flunkies:-14,flunking:-15,flunks:-18,flunky:-18,flustered:-10,focused:16,foe:-19,foehns:2,foeman:-18,foemen:-3,foes:-20,foetal:-1,foetid:-23,foetor:-30,foetors:-21,foetus:2,foetuses:2,fond:19,fondly:19,fondness:25,fool:-19,fooled:-16,fooleries:-18,foolery:-18,foolfish:-8,foolfishes:-4,foolhardier:-15,foolhardiest:-13,foolhardily:-10,foolhardiness:-16,foolhardy:-14,fooling:-17,foolish:-11,foolisher:-17,foolishest:-14,foolishly:-18,foolishness:-18,foolishnesses:-20,foolproof:16,fools:-22,foolscaps:-8,forbid:-13,forbiddance:-14,forbiddances:-10,forbidden:-18,forbidder:-16,forbidders:-15,forbidding:-19,forbiddingly:-19,forbids:-13,forced:-20,foreclosure:-5,foreclosures:-24,forgave:14,forget:-9,forgetful:-11,forgivable:17,forgivably:16,forgive:11,forgiven:16,forgiveness:11,forgiver:17,forgivers:12,forgives:17,forgiving:19,forgivingly:14,forgivingness:18,forgotten:-9,fortunate:19,fought:-13,foughten:-19,frantic:-19,frantically:-14,franticness:-7,fraud:-28,frauds:-23,fraudster:-25,fraudsters:-24,fraudulence:-23,fraudulent:-22,freak:-19,freaked:-12,freakier:-13,freakiest:-16,freakiness:-14,freaking:-18,freakish:-21,freakishly:-8,freakishness:-14,freakout:-18,freakouts:-15,freaks:-4,freaky:-15,free:23,freebase:-1,freebased:8,freebases:8,freebasing:-4,freebee:13,freebees:13,freebie:18,freebies:18,freeboard:3,freeboards:7,freeboot:-7,freebooter:-17,freebooters:-2,freebooting:-8,freeborn:12,freed:17,freedman:11,freedmen:7,freedom:32,freedoms:12,freedwoman:16,freedwomen:13,freeform:9,freehand:5,freehanded:14,freehearted:15,freehold:7,freeholder:5,freeholders:1,freeholds:10,freeing:21,freelance:12,freelanced:7,freelancer:11,freelancers:4,freelances:7,freelancing:4,freeload:-19,freeloaded:-16,freeloader:-7,freeloaders:-1,freeloading:-13,freeloads:-13,freely:19,freeman:17,freemartin:-5,freemasonries:7,freemasonry:3,freemen:15,freeness:16,freenesses:17,freer:11,freers:10,frees:12,freesia:4,freesias:4,freest:16,freestanding:11,freestyle:7,freestyler:4,freestylers:8,freestyles:3,freethinker:10,freethinkers:10,freethinking:11,freeware:7,freeway:2,freewheel:5,freewheeled:3,freewheeler:2,freewheelers:-3,freewheeling:5,freewheelingly:8,freewheels:6,freewill:10,freewriting:8,freeze:2,freezers:-1,freezes:-1,freezing:-4,freezingly:-16,frenzy:-13,fresh:13,friend:22,friended:17,friending:18,friendless:-15,friendlessness:-3,friendlier:20,friendlies:22,friendliest:26,friendlily:18,friendliness:20,friendly:22,friends:21,friendship:19,friendships:16,fright:-16,frighted:-14,frighten:-14,frightened:-19,frightening:-22,frighteningly:-21,frightens:-17,frightful:-23,frightfully:-17,frightfulness:-19,frighting:-15,frights:-11,frisky:10,frowning:-14,frustrate:-20,frustrated:-24,frustrates:-19,frustrating:-19,frustratingly:-20,frustration:-21,frustrations:-20,fuck:-25,fucked:-34,fucker:-33,fuckers:-29,fuckface:-32,fuckhead:-31,fucks:-21,fucktard:-31,fud:-11,fuked:-25,fuking:-32,fulfill:19,fulfilled:18,fulfills:10,fume:-12,fumed:-18,fumeless:3,fumelike:-7,fumer:7,fumers:-8,fumes:-1,fumet:4,fumets:-4,fumette:-6,fuming:-27,fun:23,funeral:-15,funerals:-16,funky:-4,funned:23,funnel:1,funneled:1,funnelform:5,funneling:-1,funnelled:-1,funnelling:1,funnels:4,funner:22,funnest:29,funnier:17,funnies:13,funniest:26,funnily:19,funniness:18,funninesses:16,funning:18,funny:19,funnyman:14,funnymen:13,furious:-27,furiously:-19,fury:-27,futile:-19,gag:-14,gagged:-13,gain:24,gained:16,gaining:18,gains:14,gallant:17,gallantly:19,gallantry:26,geek:-8,geekier:2,geekiest:-1,geeks:-4,geeky:-6,generosities:26,generosity:23,generous:23,generously:18,generousness:24,genial:18,gentle:19,gentler:14,gentlest:18,gently:20,ghost:-13,giddy:-6,gift:19,giggle:18,giggled:15,giggler:6,gigglers:14,giggles:8,gigglier:10,giggliest:17,giggling:15,gigglingly:11,giggly:10,giver:14,givers:17,giving:14,glad:20,gladly:14,glamor:21,glamorise:13,glamorised:18,glamorises:21,glamorising:12,glamorization:16,glamorize:17,glamorized:21,glamorizer:24,glamorizers:16,glamorizes:24,glamorizing:18,glamorous:23,glamorously:21,glamors:14,glamour:24,glamourize:8,glamourless:-16,glamourous:20,glamours:19,glee:32,gleeful:29,gloom:-26,gloomed:-19,gloomful:-21,gloomier:-15,gloomiest:-18,gloominess:-18,gloominesses:-10,glooming:-18,glooms:-9,gloomy:-6,gloried:24,glories:21,glorification:20,glorified:23,glorifier:23,glorifiers:16,glorifies:22,glorify:27,glorifying:24,gloriole:15,glorioles:12,glorious:32,gloriously:29,gloriousness:26,glory:25,glum:-21,god:11,goddam:-25,goddammed:-24,goddamn:-21,goddamned:-18,goddamns:-21,goddams:-19,godsend:28,good:19,goodness:20,gorgeous:30,gorgeously:23,gorgeousness:29,gorgeousnesses:21,gossip:-7,gossiped:-11,gossiper:-11,gossipers:-11,gossiping:-16,gossipmonger:-10,gossipmongers:-14,gossipped:-13,gossipping:-18,gossipries:-8,gossipry:-12,gossips:-13,gossipy:-13,grace:18,graced:9,graceful:20,gracefuller:22,gracefullest:28,gracefully:24,gracefulness:22,graces:16,gracile:17,graciles:6,gracilis:4,gracility:12,gracing:13,gracioso:10,gracious:26,graciously:23,graciousness:24,grand:20,grandee:11,grandees:12,grander:17,grandest:24,grandeur:24,grandeurs:21,grant:15,granted:10,granting:13,grants:9,grateful:20,gratefuller:18,gratefully:21,gratefulness:22,graticule:1,graticules:2,gratification:16,gratifications:18,gratified:16,gratifies:15,gratify:13,gratifying:23,gratifyingly:20,gratin:4,grating:-4,gratingly:-2,gratings:-8,gratins:2,gratis:2,gratitude:23,gratz:20,grave:-16,graved:-9,gravel:-5,graveled:-5,graveless:-13,graveling:-4,gravelled:-9,gravelling:-4,gravelly:-9,gravels:-5,gravely:-15,graven:-9,graveness:-15,graver:-11,gravers:-12,graves:-12,graveside:-8,gravesides:-16,gravest:-13,gravestone:-7,gravestones:-5,graveyard:-12,graveyards:-12,great:31,greater:15,greatest:32,greed:-17,greedier:-20,greediest:-28,greedily:-19,greediness:-17,greeds:-10,greedy:-13,greenwash:-18,greenwashing:-4,greet:13,greeted:11,greeting:16,greetings:18,greets:6,grey:2,grief:-22,grievance:-21,grievances:-15,grievant:-8,grievants:-11,grieve:-16,grieved:-20,griever:-19,grievers:-3,grieves:-21,grieving:-23,grievous:-20,grievously:-17,grievousness:-27,grim:-27,grimace:-10,grimaced:-20,grimaces:-18,grimacing:-14,grimalkin:-9,grimalkins:-9,grime:-15,grimed:-12,grimes:-10,grimier:-16,grimiest:-7,grimily:-7,griminess:-16,griming:-7,grimly:-13,grimmer:-15,grimmest:-8,grimness:-8,grimy:-18,grin:21,grinned:11,grinner:11,grinners:16,grinning:15,grins:9,gross:-21,grossed:-4,grosser:-3,grosses:-8,grossest:-21,grossing:-3,grossly:-9,grossness:-18,grossular:-3,grossularite:-1,grossularites:-7,grossulars:-3,grouch:-22,grouched:-8,grouches:-9,grouchier:-20,grouchiest:-23,grouchily:-14,grouchiness:-20,grouching:-17,grouchy:-19,growing:7,growth:16,guarantee:10,guilt:-11,guiltier:-20,guiltiest:-17,guiltily:-11,guiltiness:-18,guiltless:8,guiltlessly:7,guiltlessness:6,guilts:-14,guilty:-18,gullibility:-16,gullible:-15,gun:-14,ha:14,hacked:-17,haha:20,hahaha:26,hahas:18,hail:3,hailed:9,hallelujah:30,handsome:22,handsomely:19,handsomeness:24,handsomer:20,handsomest:26,hapless:-14,haplessness:-14,happier:24,happiest:32,happily:26,happiness:26,happing:11,happy:27,harass:-22,harassed:-25,harasser:-24,harassers:-28,harasses:-25,harassing:-25,harassment:-25,harassments:-26,hard:-4,hardier:-6,hardship:-13,hardy:17,harm:-25,harmed:-21,harmfully:-26,harmfulness:-26,harming:-26,harmless:10,harmlessly:14,harmlessness:8,harmonic:18,harmonica:6,harmonically:21,harmonicas:1,harmonicist:5,harmonicists:9,harmonics:15,harmonies:13,harmonious:20,harmoniously:19,harmoniousness:18,harmonise:18,harmonised:13,harmonising:14,harmonium:9,harmoniums:8,harmonization:19,harmonizations:9,harmonize:17,harmonized:16,harmonizer:16,harmonizers:16,harmonizes:15,harmonizing:14,harmony:17,harms:-22,harried:-14,harsh:-19,harsher:-22,harshest:-29,hate:-27,hated:-32,hateful:-22,hatefully:-23,hatefulness:-36,hater:-18,haters:-22,hates:-19,hating:-23,hatred:-32,haunt:-17,haunted:-21,haunting:-11,haunts:-10,havoc:-29,healthy:17,heartbreak:-27,heartbreaker:-22,heartbreakers:-21,heartbreaking:-20,heartbreakingly:-18,heartbreaks:-18,heartbroken:-33,heartfelt:25,heartless:-22,heartlessly:-28,heartlessness:-28,heartwarming:21,heaven:23,heavenlier:30,heavenliest:27,heavenliness:27,heavenlinesses:23,heavenly:30,heavens:17,heavenward:14,heavenwards:12,heavyhearted:-21,heh:-6,hell:-36,hellish:-32,help:17,helper:14,helpers:11,helpful:18,helpfully:23,helpfulness:19,helping:12,helpless:-20,helplessly:-14,helplessness:-21,helplessnesses:-17,helps:16,hero:26,heroes:23,heroic:26,heroical:29,heroically:24,heroicomic:10,heroicomical:11,heroics:24,heroin:-22,heroine:27,heroines:18,heroinism:-20,heroism:28,heroisms:22,heroize:21,heroized:20,heroizes:22,heroizing:19,heron:1,heronries:7,heronry:1,herons:5,heros:13,hesitance:-9,hesitancies:-10,hesitancy:-9,hesitant:-10,hesitantly:-12,hesitate:-11,hesitated:-13,hesitater:-14,hesitaters:-14,hesitates:-14,hesitating:-14,hesitatingly:-15,hesitation:-11,hesitations:-11,hid:-4,hide:-7,hides:-7,hiding:-12,highlight:14,hilarious:17,hindrance:-17,hoax:-11,holiday:17,holidays:16,homesick:-7,homesickness:-18,homesicknesses:-18,honest:23,honester:19,honestest:30,honesties:18,honestly:20,honesty:22,honor:22,honorability:22,honorable:25,honorableness:22,honorably:24,honoraria:6,honoraries:15,honorarily:19,honorarium:7,honorariums:10,honorary:14,honored:28,honoree:21,honorees:23,honorer:17,honorers:13,honorific:14,honorifically:22,honorifics:17,honoring:23,honors:23,honour:27,honourable:21,honoured:22,honourer:18,honourers:16,honouring:21,honours:22,hooligan:-15,hooliganism:-21,hooligans:-11,hooray:23,hope:19,hoped:16,hopeful:23,hopefully:17,hopefulness:16,hopeless:-20,hopelessly:-22,hopelessness:-31,hopes:18,hoping:18,horrendous:-28,horrendously:-19,horrent:-9,horrible:-25,horribleness:-24,horribles:-21,horribly:-24,horrid:-25,horridly:-14,horridness:-23,horridnesses:-30,horrific:-34,horrifically:-29,horrified:-25,horrifies:-29,horrify:-25,horrifying:-27,horrifyingly:-33,horror:-27,horrors:-27,hostile:-16,hostilely:-22,hostiles:-13,hostilities:-21,hostility:-25,huckster:-9,hug:21,huge:13,huggable:16,hugged:17,hugger:16,huggers:18,hugging:18,hugs:22,humerous:14,humiliate:-25,humiliated:-14,humiliates:-10,humiliating:-12,humiliatingly:-26,humiliation:-27,humiliations:-24,humor:11,humoral:6,humored:12,humoresque:12,humoresques:9,humoring:21,humorist:12,humoristic:15,humorists:13,humorless:-13,humorlessness:-14,humorous:16,humorously:23,humorousness:24,humors:16,humour:21,humoured:11,humouring:17,humourous:20,hunger:-10,hurrah:26,hurrahed:19,hurrahing:24,hurrahs:21,hurray:27,hurrayed:18,hurraying:12,hurrays:24,hurt:-24,hurter:-23,hurters:-19,hurtful:-24,hurtfully:-26,hurtfulness:-19,hurting:-17,hurtle:-3,hurtled:-6,hurtles:-10,hurtless:3,hurtling:-14,hurts:-21,hypocritical:-20,hysteria:-19,hysterical:-1,hysterics:-18,ideal:24,idealess:-19,idealise:14,idealised:21,idealises:20,idealising:6,idealism:17,idealisms:8,idealist:16,idealistic:18,idealistically:17,idealists:7,idealities:15,ideality:19,idealization:18,idealizations:14,idealize:12,idealized:18,idealizer:13,idealizers:19,idealizes:20,idealizing:14,idealless:-17,ideally:18,idealogues:5,idealogy:8,ideals:8,idiot:-23,idiotic:-26,ignorable:-10,ignorami:-19,ignoramus:-19,ignoramuses:-23,ignorance:-15,ignorances:-12,ignorant:-11,ignorantly:-16,ignorantness:-11,ignore:-15,ignored:-13,ignorer:-13,ignorers:-7,ignores:-11,ignoring:-17,ill:-18,illegal:-26,illiteracy:-19,illness:-17,illnesses:-22,imbecile:-22,immobilized:-12,immoral:-20,immoralism:-16,immoralist:-21,immoralists:-17,immoralities:-11,immorality:-6,immorally:-21,immortal:10,immune:12,impatience:-18,impatiens:-2,impatient:-12,impatiently:-17,imperfect:-13,impersonal:-13,impolite:-16,impolitely:-18,impoliteness:-18,impolitenesses:-23,importance:15,importancies:4,importancy:14,important:8,importantly:13,impose:-12,imposed:-3,imposes:-4,imposing:-4,impotent:-11,impress:19,impressed:21,impresses:21,impressibility:12,impressible:8,impressing:25,impression:9,impressionable:2,impressionism:8,impressionisms:5,impressionist:10,impressionistic:15,impressionistically:16,impressionists:5,impressions:9,impressive:23,impressively:20,impressiveness:17,impressment:-4,impressments:5,impressure:6,imprisoned:-20,improve:19,improved:21,improvement:20,improvements:13,improver:18,improvers:13,improves:18,improving:18,inability:-17,inaction:-10,inadequacies:-17,inadequacy:-17,inadequate:-17,inadequately:-10,inadequateness:-17,inadequatenesses:-16,incapable:-16,incapacitated:-19,incensed:-20,incentive:15,incentives:13,incompetence:-23,incompetent:-21,inconsiderate:-19,inconvenience:-15,inconvenient:-14,increase:13,increased:11,indecision:-8,indecisions:-11,indecisive:-10,indecisively:-7,indecisiveness:-13,indecisivenesses:-9,indestructible:6,indifference:-2,indifferent:-8,indignant:-18,indignation:-24,indoctrinate:-14,indoctrinated:-4,indoctrinates:-6,indoctrinating:-7,ineffective:-5,ineffectively:-13,ineffectiveness:-13,ineffectual:-12,ineffectuality:-16,ineffectually:-11,ineffectualness:-13,infatuated:2,infatuation:6,infected:-22,inferior:-17,inferiorities:-19,inferiority:-11,inferiorly:-20,inferiors:-5,inflamed:-14,influential:19,infringement:-21,infuriate:-22,infuriated:-30,infuriates:-26,infuriating:-24,inhibin:-2,inhibit:-16,inhibited:-4,inhibiting:-4,inhibition:-15,inhibitions:-8,inhibitive:-14,inhibitor:-3,inhibitors:-10,inhibitory:-10,inhibits:-9,injured:-17,injury:-18,injustice:-27,innocence:16,innocency:19,innocent:14,innocenter:9,innocently:14,innocents:11,innovate:22,innovates:20,innovation:16,innovative:19,inquisition:-12,inquisitive:7,insane:-17,insanity:-27,insecure:-18,insecurely:-14,insecureness:-18,insecurities:-18,insecurity:-18,insensitive:-9,insensitivity:-18,insignificant:-14,insincere:-18,insincerely:-19,insincerity:-14,insipid:-20,inspiration:24,inspirational:23,inspirationally:23,inspirations:21,inspirator:19,inspirators:12,inspiratory:15,inspire:27,inspired:22,inspirer:22,inspirers:20,inspires:19,inspiring:18,inspiringly:26,inspirit:19,inspirited:13,inspiriting:18,inspiritingly:21,inspirits:8,insult:-23,insulted:-23,insulter:-20,insulters:-20,insulting:-22,insultingly:-23,insults:-18,intact:8,integrity:16,intellect:20,intellection:6,intellections:8,intellective:17,intellectively:8,intellects:18,intellectual:23,intellectualism:22,intellectualist:20,intellectualistic:13,intellectualists:8,intellectualities:17,intellectuality:17,intellectualization:15,intellectualize:15,intellectualized:12,intellectualizes:18,intellectualizing:8,intellectually:14,intellectualness:15,intellectuals:16,intelligence:21,intelligencer:15,intelligencers:16,intelligences:16,intelligent:20,intelligential:19,intelligently:20,intelligentsia:15,intelligibility:15,intelligible:14,intelligibleness:15,intelligibly:12,intense:3,interest:20,interested:17,interestedly:15,interesting:17,interestingly:17,interestingness:18,interests:10,interrogated:-16,interrupt:-14,interrupted:-12,interrupter:-11,interrupters:-13,interruptible:-13,interrupting:-12,interruption:-15,interruptions:-17,interruptive:-14,interruptor:-13,interrupts:-13,intimidate:-8,intimidated:-19,intimidates:-13,intimidating:-19,intimidatingly:-11,intimidation:-18,intimidations:-14,intimidator:-16,intimidators:-16,intimidatory:-11,intricate:6,intrigues:9,invigorate:19,invigorated:8,invigorates:21,invigorating:21,invigoratingly:20,invigoration:15,invigorations:12,invigorator:11,invigorators:12,invincible:22,invite:6,inviting:13,invulnerable:13,irate:-29,ironic:-5,irony:-2,irrational:-14,irrationalism:-15,irrationalist:-21,irrationalists:-15,irrationalities:-15,irrationality:-17,irrationally:-16,irrationals:-11,irresistible:14,irresolute:-14,irresponsible:-19,irreversible:-8,irritabilities:-17,irritability:-14,irritable:-21,irritableness:-17,irritably:-18,irritant:-23,irritants:-21,irritate:-18,irritated:-20,irritates:-17,irritating:-20,irritatingly:-20,irritation:-23,irritations:-15,irritative:-20,isolatable:2,isolate:-8,isolated:-13,isolates:-13,isolation:-17,isolationism:4,isolationist:7,isolations:-5,isolator:-4,isolators:-4,itchy:-11,jackass:-18,jackasses:-28,jaded:-16,jailed:-22,jaunty:12,jealous:-20,jealousies:-20,jealously:-20,jealousness:-17,jealousy:-13,jeopardy:-21,jerk:-14,jerked:-8,jerks:-11,jewel:15,jewels:20,jocular:12,join:12,joke:12,joked:13,joker:5,jokes:10,jokester:15,jokesters:9,jokey:11,joking:9,jollied:24,jollier:24,jollies:20,jolliest:29,jollification:22,jollifications:20,jollify:21,jollily:27,jolliness:25,jollities:17,jollity:18,jolly:23,jollying:23,jovial:19,joy:28,joyance:23,joyed:29,joyful:29,joyfuller:24,joyfully:25,joyfulness:27,joying:25,joyless:-25,joylessly:-17,joylessness:-27,joyous:31,joyously:29,joyousness:28,joypop:-2,joypoppers:-1,joyridden:6,joyride:11,joyrider:7,joyriders:13,joyrides:8,joyriding:9,joyrode:10,joys:22,joystick:7,joysticks:2,jubilant:30,jumpy:-10,justice:24,justifiably:10,justified:17,keen:15,keened:3,keener:5,keeners:6,keenest:19,keening:-7,keenly:10,keenness:14,keens:1,kewl:13,kidding:4,kill:-37,killdeer:-11,killdeers:-1,killdees:-6,killed:-35,killer:-33,killers:-33,killick:1,killie:-1,killifish:-1,killifishes:-1,killing:-34,killingly:-26,killings:-35,killjoy:-21,killjoys:-17,killock:-3,killocks:-4,kills:-25,kind:24,kinder:22,kindly:22,kindness:20,kindnesses:23,kiss:18,kissable:20,kissably:19,kissed:16,kisser:17,kissers:15,kisses:23,kissing:27,kissy:18,kudos:23,lack:-13,lackadaisical:-16,lag:-14,lagged:-12,lagging:-11,lags:-15,laidback:5,lame:-18,lamebrain:-16,lamebrained:-25,lamebrains:-12,lamedh:1,lamella:-1,lamellae:-1,lamellas:1,lamellibranch:2,lamellibranchs:-1,lamely:-20,lameness:-8,lament:-20,lamentable:-15,lamentableness:-13,lamentably:-15,lamentation:-14,lamentations:-19,lamented:-14,lamenter:-12,lamenters:-5,lamenting:-20,laments:-15,lamer:-14,lames:-12,lamest:-15,landmark:3,laugh:26,laughable:2,laughableness:12,laughably:12,laughed:20,laugher:17,laughers:17,laughing:22,laughingly:23,laughings:19,laughingstocks:-13,laughs:22,laughter:22,laughters:22,launched:5,lawl:14,lawsuit:-9,lawsuits:-6,lazier:-23,laziest:-27,lazy:-15,leak:-14,leaked:-13,leave:-2,leet:13,legal:5,legally:4,lenient:11,lethargic:-12,lethargy:-14,liabilities:-8,liability:-8,liar:-23,liards:-4,liars:-24,libelous:-21,libertarian:9,libertarianism:4,libertarianisms:1,libertarians:1,liberties:23,libertinage:2,libertine:-9,libertines:4,libertinisms:12,liberty:24,lied:-16,lies:-18,lifesaver:28,lighthearted:18,like:15,likeable:20,liked:18,likes:18,liking:17,limitation:-12,limited:-9,litigation:-8,litigious:-8,livelier:17,liveliest:21,livelihood:8,livelihoods:9,livelily:18,liveliness:16,livelong:17,lively:19,livid:-25,lmao:29,loathe:-22,loathed:-21,loathes:-19,loathing:-27,lobby:1,lobbying:-3,lol:18,lone:-11,lonelier:-14,loneliest:-24,loneliness:-18,lonelinesses:-15,lonely:-15,loneness:-11,loner:-13,loners:-9,lonesome:-15,lonesomely:-13,lonesomeness:-18,lonesomes:-14,longing:-1,longingly:7,longings:4,loom:-9,loomed:-11,looming:-5,looms:-6,loose:-13,looses:-6,lose:-17,loser:-24,losers:-24,loses:-13,losing:-16,loss:-13,losses:-17,lossy:-12,lost:-13,louse:-16,loused:-10,louses:-13,lousewort:1,louseworts:-6,lousier:-22,lousiest:-26,lousily:-12,lousiness:-17,lousing:-11,lousy:-25,lovable:30,love:32,loved:29,lovelies:22,lovely:28,lover:28,loverly:28,lovers:24,loves:27,loving:29,lovingly:32,lovingness:27,low:-11,lowball:-8,lowballed:-15,lowballing:-7,lowballs:-12,lowborn:-7,lowboys:-6,lowbred:-26,lowbrow:-19,lowbrows:-6,lowdown:-8,lowdowns:-2,lowe:5,lowed:-8,lower:-12,lowercase:3,lowercased:-2,lowerclassman:-4,lowered:-5,lowering:-10,lowermost:-14,lowers:-5,lowery:-18,lowest:-16,lowing:-5,lowish:-9,lowland:-1,lowlander:-4,lowlanders:-3,lowlands:-1,lowlier:-17,lowliest:-18,lowlife:-15,lowlifes:-22,lowlight:-20,lowlights:-3,lowlihead:-3,lowliness:-11,lowlinesses:-12,lowlives:-21,lowly:-10,lown:9,lowness:-13,lowrider:-2,lowriders:1,lows:-8,lowse:-7,loyal:21,loyalism:10,loyalisms:9,loyalist:15,loyalists:11,loyally:21,loyalties:19,loyalty:25,luck:20,lucked:19,luckie:16,luckier:19,luckiest:29,luckily:23,luckiness:10,lucking:12,luckless:-13,lucks:16,lucky:18,ludicrous:-15,ludicrously:-2,ludicrousness:-19,lugubrious:-21,lulz:20,lunatic:-22,lunatics:-16,lurk:-8,lurking:-5,lurks:-9,lying:-24,mad:-22,maddening:-22,madder:-12,maddest:-28,madly:-17,madness:-19,magnific:23,magnifical:24,magnifically:24,magnification:10,magnifications:12,magnificence:24,magnificences:23,magnificent:29,magnificently:34,magnifico:18,magnificoes:14,mandatory:3,maniac:-21,maniacal:-3,maniacally:-17,maniacs:-12,manipulated:-16,manipulating:-15,manipulation:-12,marvel:18,marvelous:29,marvels:20,masochism:-16,masochisms:-11,masochist:-17,masochistic:-22,masochistically:-16,masochists:-12,masterpiece:31,masterpieces:25,matter:1,matters:1,mature:18,meaningful:13,meaningless:-19,medal:21,mediocrity:-3,meditative:14,meh:-3,melancholia:-5,melancholiac:-20,melancholias:-16,melancholic:-3,melancholics:-10,melancholies:-11,melancholy:-19,menace:-22,menaced:-17,mercy:15,merit:18,merited:14,meriting:11,meritocracy:6,meritocrat:4,meritocrats:11,meritorious:21,meritoriously:13,meritoriousness:17,merits:17,merrier:17,merriest:27,merrily:24,merriment:24,merriments:20,merriness:22,merry:25,merrymaker:22,merrymakers:17,merrymaking:22,merrymakings:24,merrythought:11,merrythoughts:16,mess:-15,messed:-14,messy:-15,methodical:6,mindless:-19,miracle:28,mirth:26,mirthful:27,mirthfully:20,misbehave:-19,misbehaved:-16,misbehaves:-16,misbehaving:-17,mischief:-15,mischiefs:-8,miser:-18,miserable:-22,miserableness:-28,miserably:-21,miserere:-8,misericorde:1,misericordes:-5,miseries:-27,miserliness:-26,miserly:-14,misers:-15,misery:-27,misgiving:-14,misinformation:-13,misinformed:-16,misinterpreted:-13,misleading:-17,misread:-11,misreporting:-15,misrepresentation:-20,miss:-6,missed:-12,misses:-9,missing:-12,mistakable:-8,mistake:-14,mistaken:-15,mistakenly:-12,mistaker:-16,mistakers:-16,mistakes:-15,mistaking:-11,misunderstand:-15,misunderstanding:-18,misunderstands:-13,misunderstood:-14,mlm:-14,mmk:6,moan:-6,moaned:-4,moaning:-4,moans:-6,mock:-18,mocked:-13,mocker:-8,mockeries:-16,mockers:-13,mockery:-13,mocking:-17,mocks:-20,molest:-21,molestation:-19,molestations:-29,molested:-19,molester:-23,molesters:-22,molesting:-28,molests:-31,mongering:-8,monopolize:-8,monopolized:-9,monopolizes:-11,monopolizing:-5,mooch:-17,mooched:-14,moocher:-15,moochers:-19,mooches:-14,mooching:-17,moodier:-11,moodiest:-21,moodily:-13,moodiness:-14,moodinesses:-14,moody:-15,mope:-19,moping:-10,moron:-22,moronic:-27,moronically:-14,moronity:-11,morons:-13,motherfucker:-36,motherfucking:-28,motivate:16,motivated:20,motivating:22,motivation:14,mourn:-18,mourned:-13,mourner:-16,mourners:-18,mournful:-16,mournfuller:-19,mournfully:-17,mournfulness:-18,mourning:-19,mourningly:-23,mourns:-24,muah:23,mumpish:-14,murder:-37,murdered:-34,murderee:-32,murderees:-31,murderer:-36,murderers:-33,murderess:-22,murderesses:-26,murdering:-33,murderous:-32,murderously:-31,murderousness:-29,murders:-30,nag:-15,nagana:-17,nagged:-17,nagger:-18,naggers:-15,naggier:-14,naggiest:-24,nagging:-17,naggingly:-9,naggy:-17,nags:-11,nah:-4,naive:-11,nastic:2,nastier:-23,nasties:-21,nastiest:-24,nastily:-19,nastiness:-11,nastinesses:-26,nasturtium:4,nasturtiums:1,nasty:-26,natural:15,neat:20,neaten:12,neatened:20,neatening:13,neatens:11,neater:10,neatest:17,neath:2,neatherd:-4,neatly:14,neatness:13,neats:11,needy:-14,negative:-27,negativity:-23,neglect:-20,neglected:-24,neglecter:-17,neglecters:-15,neglectful:-20,neglectfully:-21,neglectfulness:-20,neglecting:-17,neglects:-22,nerd:-12,nerdier:-2,nerdiest:6,nerdish:-1,nerdy:-2,nerves:-4,nervous:-11,nervously:-6,nervousness:-12,neurotic:-14,neurotically:-18,neuroticism:-9,neurotics:-7,nice:18,nicely:19,niceness:16,nicenesses:21,nicer:19,nicest:22,niceties:15,nicety:12,nifty:17,niggas:-14,nigger:-33,no:-12,noble:20,noisy:-7,nonsense:-17,noob:-2,nosey:-8,notorious:-19,novel:13,numb:-14,numbat:2,numbed:-9,number:3,numberable:6,numbest:-10,numbfish:-4,numbfishes:-7,numbing:-11,numbingly:-13,numbles:4,numbly:-14,numbness:-11,numbs:-7,numbskull:-23,numbskulls:-22,nurtural:15,nurturance:16,nurturances:13,nurturant:17,nurture:14,nurtured:19,nurturer:19,nurturers:8,nurtures:19,nurturing:20,nuts:-13,obliterate:-29,obliterated:-21,obnoxious:-20,obnoxiously:-23,obnoxiousness:-21,obscene:-28,obsess:-10,obsessed:-7,obsesses:-10,obsessing:-14,obsession:-14,obsessional:-15,obsessionally:-13,obsessions:-9,obsessive:-9,obsessively:-4,obsessiveness:-12,obsessives:-7,obsolete:-12,obstacle:-15,obstacles:-16,obstinate:-12,odd:-13,offence:-12,offences:-14,offend:-12,offended:-10,offender:-15,offenders:-15,offending:-23,offends:-20,offense:-10,offenseless:7,offenses:-15,offensive:-20,offensively:-28,offensiveness:-23,offensives:-8,offline:-5,ok:12,okay:9,okays:21,ominous:-14,once-in-a-lifetime:18,openness:14,opportune:17,opportunely:15,opportuneness:12,opportunism:4,opportunisms:2,opportunist:2,opportunistic:-1,opportunistically:9,opportunists:3,opportunities:16,opportunity:18,oppressed:-21,oppressive:-17,optimal:15,optimality:19,optimally:13,optimisation:16,optimisations:18,optimise:19,optimised:17,optimises:16,optimising:17,optimism:25,optimisms:20,optimist:24,optimistic:13,optimistically:21,optimists:16,optimization:16,optimizations:9,optimize:22,optimized:20,optimizer:15,optimizers:21,optimizes:18,optimizing:20,optionless:-17,original:13,outcry:-23,outgoing:12,outmaneuvered:5,outrage:-23,outraged:-25,outrageous:-20,outrageously:-12,outrageousness:-12,outrageousnesses:-13,outrages:-23,outraging:-20,outreach:11,outstanding:30,overjoyed:27,overload:-15,overlooked:-1,overreact:-10,overreacted:-17,overreaction:-7,overreacts:-22,oversell:-9,overselling:-8,oversells:3,oversimplification:2,oversimplifies:1,oversimplify:-6,overstatement:-11,overstatements:-7,overweight:-15,overwhelm:-7,overwhelmed:2,overwhelmingly:-5,overwhelms:-8,oxymoron:-5,pain:-23,pained:-18,painful:-19,painfuller:-17,painfully:-24,painfulness:-27,paining:-17,painless:12,painlessly:11,painlessness:4,pains:-18,palatable:16,palatableness:8,palatably:11,panic:-23,panicked:-20,panicking:-19,panicky:-15,panicle:5,panicled:1,panicles:-2,panics:-19,paniculate:1,panicums:-1,paradise:32,paradox:-4,paranoia:-10,paranoiac:-13,paranoiacs:-7,paranoias:-15,paranoid:-10,paranoids:-16,pardon:13,pardoned:9,pardoning:17,pardons:12,parley:-4,partied:14,partier:14,partiers:7,parties:17,party:17,partyer:12,partyers:11,partying:16,passion:20,passional:16,passionate:24,passionately:24,passionateness:23,passionflower:3,passionflowers:4,passionless:-19,passions:22,passive:8,passively:-7,pathetic:-27,pathetical:-12,pathetically:-18,pay:-4,peace:25,peaceable:17,peaceableness:18,peaceably:20,peaceful:22,peacefuller:19,peacefullest:31,peacefully:24,peacefulness:21,peacekeeper:16,peacekeepers:16,peacekeeping:20,peacekeepings:16,peacemaker:20,peacemakers:24,peacemaking:17,peacenik:8,peaceniks:7,peaces:21,peacetime:22,peacetimes:21,peculiar:6,peculiarities:1,peculiarity:6,peculiarly:-4,penalty:-20,pensive:3,perfect:27,perfecta:14,perfectas:6,perfected:27,perfecter:18,perfecters:14,perfectest:31,perfectibilities:21,perfectibility:18,perfectible:15,perfecting:23,perfection:27,perfectionism:13,perfectionist:15,perfectionistic:7,perfectionists:1,perfections:25,perfective:12,perfectively:21,perfectiveness:9,perfectives:9,perfectivity:22,perfectly:32,perfectness:30,perfecto:13,perfects:16,peril:-17,perjury:-19,perpetrator:-22,perpetrators:-10,perplexed:-13,persecute:-21,persecuted:-13,persecutes:-12,persecuting:-15,perturbed:-14,perverse:-18,perversely:-22,perverseness:-21,perversenesses:-5,perversion:-13,perversions:-12,perversities:-11,perversity:-26,perversive:-21,pervert:-23,perverted:-25,pervertedly:-12,pervertedness:-12,perverter:-17,perverters:-6,perverting:-10,perverts:-28,pesky:-12,pessimism:-15,pessimisms:-20,pessimist:-15,pessimistic:-15,pessimistically:-20,pessimists:-10,petrifaction:-19,petrifactions:-3,petrification:-1,petrifications:-4,petrified:-25,petrifies:-23,petrify:-17,petrifying:-26,pettier:-3,pettiest:-13,petty:-8,phobia:-16,phobias:-20,phobic:-12,phobics:-13,picturesque:16,pileup:-11,pique:-11,piqued:1,piss:-17,pissant:-15,pissants:-25,pissed:-32,pisser:-20,pissers:-14,pisses:-14,pissing:-17,pissoir:-8,piteous:-12,pitiable:-11,pitiableness:-11,pitiably:-11,pitied:-13,pitier:-12,pitiers:-13,pities:-12,pitiful:-22,pitifuller:-18,pitifullest:-11,pitifully:-12,pitifulness:-12,pitiless:-18,pitilessly:-21,pitilessness:-5,pity:-12,pitying:-14,pityingly:-10,pityriasis:-8,play:14,played:14,playful:19,playfully:16,playfulness:12,playing:8,plays:10,pleasant:23,pleasanter:15,pleasantest:26,pleasantly:21,pleasantness:23,pleasantnesses:23,pleasantries:13,pleasantry:20,please:13,pleased:19,pleaser:17,pleasers:10,pleases:17,pleasing:24,pleasurability:19,pleasurable:24,pleasurableness:24,pleasurably:26,pleasure:27,pleasured:23,pleasureless:-16,pleasures:19,pleasuring:28,poised:10,poison:-25,poisoned:-22,poisoner:-27,poisoners:-31,poisoning:-28,poisonings:-24,poisonous:-27,poisonously:-29,poisons:-27,poisonwood:-10,pollute:-23,polluted:-20,polluter:-18,polluters:-20,pollutes:-22,poor:-21,poorer:-15,poorest:-25,popular:18,popularise:16,popularised:11,popularises:5,popularising:12,popularities:16,popularity:21,popularization:13,popularizations:9,popularize:13,popularized:19,popularizer:18,popularizers:10,popularizes:14,popularizing:15,popularly:18,positive:26,positively:24,positiveness:23,positivenesses:22,positiver:23,positives:24,positivest:29,positivism:16,positivisms:18,positivist:20,positivistic:19,positivists:17,positivities:26,positivity:23,possessive:-9,postpone:-9,postponed:-8,postpones:-11,postponing:-5,poverty:-23,powerful:18,powerless:-22,praise:26,praised:22,praiser:20,praisers:20,praises:24,praiseworthily:19,praiseworthiness:24,praiseworthy:26,praising:25,pray:13,praying:15,prays:14,prblm:-16,prblms:-23,precious:27,preciously:22,preciousness:19,prejudice:-23,prejudiced:-19,prejudices:-18,prejudicial:-26,prejudicially:-15,prejudicialness:-24,prejudicing:-18,prepared:9,pressure:-12,pressured:-9,pressureless:10,pressures:-13,pressuring:-14,pressurise:-6,pressurised:-4,pressurises:-8,pressurising:-6,pressurizations:-3,pressurize:-7,pressurized:1,pressurizer:1,pressurizers:-7,pressurizes:-2,pressurizing:-2,pretend:-4,pretending:4,pretends:-4,prettied:16,prettier:21,pretties:17,prettiest:27,pretty:22,prevent:1,prevented:1,preventing:-1,prevents:3,prick:-14,pricked:-6,pricker:-3,prickers:-2,pricket:-5,prickets:3,pricking:-9,prickle:-10,prickled:-2,prickles:-8,pricklier:-16,prickliest:-14,prickliness:-6,prickling:-8,prickly:-9,pricks:-9,pricky:-6,pride:14,prison:-23,prisoner:-25,prisoners:-23,privilege:15,privileged:19,privileges:16,privileging:7,prize:23,prized:24,prizefight:-1,prizefighter:10,prizefighters:-1,prizefighting:4,prizefights:3,prizer:10,prizers:8,prizes:20,prizewinner:23,prizewinners:24,prizewinning:30,proactive:18,problem:-17,problematic:-19,problematical:-18,problematically:-20,problematics:-13,problems:-17,profit:19,profitabilities:11,profitability:11,profitable:19,profitableness:24,profitably:16,profited:13,profiteer:8,profiteered:-5,profiteering:-6,profiteers:5,profiter:7,profiterole:4,profiteroles:5,profiting:16,profitless:-15,profits:19,profitwise:9,progress:18,prominent:13,promiscuities:-8,promiscuity:-18,promiscuous:-3,promiscuously:-15,promiscuousness:-9,promise:13,promised:15,promisee:8,promisees:11,promiser:13,promisers:16,promises:16,promising:17,promisingly:12,promisor:10,promisors:4,promissory:9,promote:16,promoted:18,promotes:14,promoting:15,propaganda:-10,prosecute:-17,prosecuted:-16,prosecutes:-18,prosecution:-22,prospect:12,prospects:12,prosperous:21,protect:16,protected:19,protects:13,protest:-10,protested:-5,protesters:-9,protesting:-18,protests:-9,proud:21,prouder:22,proudest:26,proudful:19,proudhearted:14,proudly:26,provoke:-17,provoked:-11,provokes:-13,provoking:-8,pseudoscience:-12,puke:-24,puked:-18,pukes:-19,puking:-18,pukka:28,punish:-24,punishabilities:-17,punishability:-16,punishable:-19,punished:-20,punisher:-19,punishers:-26,punishes:-21,punishing:-26,punishment:-22,punishments:-18,punitive:-23,pushy:-11,puzzled:-7,quaking:-15,questionable:-12,questioned:-4,questioning:-4,racism:-31,racist:-30,racists:-25,radian:4,radiance:14,radiances:11,radiancies:8,radiancy:14,radians:2,radiant:21,radiantly:13,radiants:12,rage:-26,raged:-20,ragee:-4,rageful:-28,rages:-21,raging:-24,rainy:-3,rancid:-25,rancidity:-26,rancidly:-25,rancidness:-26,rancidnesses:-16,rant:-14,ranter:-12,ranters:-12,rants:-13,rape:-37,raped:-36,raper:-34,rapers:-36,rapes:-35,rapeseeds:-5,raping:-38,rapist:-39,rapists:-33,rapture:6,raptured:9,raptures:7,rapturous:17,rash:-17,ratified:6,reach:1,reached:4,reaches:2,reaching:8,readiness:10,ready:15,reassurance:15,reassurances:14,reassure:14,reassured:17,reassures:15,reassuring:17,reassuringly:18,rebel:-6,rebeldom:-15,rebelled:-10,rebelling:-11,rebellion:-5,rebellions:-11,rebellious:-12,rebelliously:-18,rebelliousness:-12,rebels:-8,recession:-18,reckless:-17,recommend:15,recommended:8,recommends:9,redeemed:13,reek:-24,reeked:-20,reeker:-17,reekers:-15,reeking:-20,refuse:-12,refused:-12,refusing:-17,regret:-18,regretful:-19,regretfully:-19,regretfulness:-16,regrets:-15,regrettable:-23,regrettably:-20,regretted:-16,regretter:-16,regretters:-20,regretting:-17,reinvigorate:23,reinvigorated:19,reinvigorates:18,reinvigorating:17,reinvigoration:22,reject:-17,rejected:-23,rejectee:-23,rejectees:-18,rejecter:-16,rejecters:-18,rejecting:-20,rejectingly:-17,rejection:-25,rejections:-21,rejective:-18,rejector:-18,rejects:-22,rejoice:19,rejoiced:20,rejoices:21,rejoicing:28,relax:19,relaxant:10,relaxants:7,relaxation:24,relaxations:10,relaxed:22,relaxedly:15,relaxedness:20,relaxer:16,relaxers:14,relaxes:15,relaxin:17,relaxing:22,relaxins:12,relentless:2,reliant:5,relief:21,reliefs:13,relievable:11,relieve:15,relieved:16,relievedly:14,reliever:15,relievers:10,relieves:15,relieving:15,relievo:13,relishing:16,reluctance:-14,reluctancy:-16,reluctant:-10,reluctantly:-4,remarkable:26,remorse:-11,remorseful:-9,remorsefully:-7,remorsefulness:-7,remorseless:-23,remorselessly:-20,remorselessness:-28,repetitive:-10,repress:-14,repressed:-13,represses:-13,repressible:-15,repressing:-18,repression:-16,repressions:-17,repressive:-14,repressively:-17,repressiveness:-10,repressor:-14,repressors:-22,repressurize:-3,repressurized:1,repressurizes:1,repressurizing:-1,repulse:-28,repulsed:-22,rescue:23,rescued:18,rescues:13,resent:-7,resented:-16,resentence:-10,resentenced:-8,resentences:-6,resentencing:2,resentful:-21,resentfully:-14,resentfulness:-20,resenting:-12,resentment:-19,resentments:-19,resents:-12,resign:-14,resignation:-12,resignations:-12,resigned:-10,resignedly:-7,resignedness:-8,resigner:-12,resigners:-10,resigning:-9,resigns:-13,resolute:11,resolvable:10,resolve:16,resolved:7,resolvent:7,resolvents:4,resolver:7,resolvers:14,resolves:7,resolving:16,respect:21,respectabilities:18,respectability:24,respectable:19,respectableness:12,respectably:17,respected:21,respecter:21,respecters:16,respectful:20,respectfully:17,respectfulness:19,respectfulnesses:13,respecting:22,respective:18,respectively:14,respectiveness:11,respects:13,responsible:13,responsive:15,restful:15,restless:-11,restlessly:-14,restlessness:-12,restore:12,restored:14,restores:12,restoring:12,restrict:-16,restricted:-16,restricting:-16,restriction:-11,restricts:-13,retained:1,retard:-24,retarded:-27,retreat:8,revenge:-24,revenged:-9,revengeful:-24,revengefully:-14,revengefulness:-22,revenger:-21,revengers:-20,revenges:-19,revered:23,revive:14,revives:16,reward:27,rewardable:20,rewarded:22,rewarder:16,rewarders:19,rewarding:24,rewardingly:24,rewards:21,rich:26,richened:19,richening:10,richens:8,richer:24,riches:24,richest:24,richly:19,richness:22,richnesses:21,richweed:1,richweeds:-1,ridicule:-20,ridiculed:-15,ridiculer:-16,ridiculers:-16,ridicules:-18,ridiculing:-18,ridiculous:-15,ridiculously:-14,ridiculousness:-11,ridiculousnesses:-16,rig:-5,rigged:-15,rigid:-5,rigidification:-11,rigidifications:-8,rigidified:-7,rigidifies:-6,rigidify:-3,rigidities:-7,rigidity:-7,rigidly:-7,rigidness:-3,rigorous:-11,rigorously:-4,riot:-26,riots:-23,risk:-11,risked:-9,risker:-8,riskier:-14,riskiest:-15,riskily:-7,riskiness:-13,riskinesses:-16,risking:-13,riskless:13,risks:-11,risky:-8,rob:-26,robber:-26,robed:-7,robing:-15,robs:-20,robust:14,roflcopter:21,romance:26,romanced:22,romancer:13,romancers:17,romances:13,romancing:20,romantic:17,romantically:18,romanticise:17,romanticised:17,romanticises:13,romanticising:27,romanticism:22,romanticisms:21,romanticist:19,romanticists:13,romanticization:15,romanticizations:20,romanticize:18,romanticized:9,romanticizes:18,romanticizing:12,romantics:19,rotten:-23,rude:-20,rudely:-22,rudeness:-15,ruder:-21,ruderal:-8,ruderals:-4,rudesby:-20,rudest:-25,ruin:-28,ruinable:-16,ruinate:-28,ruinated:-15,ruinates:-15,ruinating:-15,ruination:-27,ruinations:-16,ruined:-21,ruiner:-20,ruing:-16,ruining:-10,ruinous:-27,ruinously:-26,ruinousness:-10,ruins:-19,sabotage:-24,sad:-21,sadden:-26,saddened:-24,saddening:-22,saddens:-19,sadder:-24,saddest:-30,sadly:-18,sadness:-19,safe:19,safecracker:-7,safecrackers:-9,safecracking:-9,safecrackings:-7,safeguard:16,safeguarded:15,safeguarding:11,safeguards:14,safekeeping:14,safelight:11,safelights:8,safely:22,safeness:15,safer:18,safes:4,safest:17,safeties:15,safety:18,safetyman:3,salient:11,sappy:-10,sarcasm:-9,sarcasms:-9,sarcastic:-10,sarcastically:-11,satisfaction:19,satisfactions:21,satisfactorily:16,satisfactoriness:15,satisfactory:15,satisfiable:19,satisfied:18,satisfies:18,satisfy:20,satisfying:20,satisfyingly:19,savage:-20,savaged:-20,savagely:-22,savageness:-26,savagenesses:-9,savageries:-19,savagery:-25,savages:-24,save:22,saved:18,scam:-27,scams:-28,scandal:-19,scandalous:-24,scandals:-22,scapegoat:-17,scapegoats:-14,scare:-22,scarecrow:-8,scarecrows:-7,scared:-19,scaremonger:-21,scaremongers:-20,scarer:-17,scarers:-13,scares:-14,scarey:-17,scaring:-19,scary:-22,sceptic:-10,sceptical:-12,scepticism:-8,sceptics:-7,scold:-17,scoop:6,scorn:-17,scornful:-18,scream:-17,screamed:-13,screamers:-15,screaming:-16,screams:-12,screw:-4,screwball:-2,screwballs:-3,screwbean:3,screwdriver:3,screwdrivers:1,screwed:-22,screwer:-12,screwers:-5,screwier:-6,screwiest:-20,screwiness:-5,screwing:-9,screwlike:1,screws:-10,screwup:-17,screwups:-10,screwworm:-4,screwworms:-1,screwy:-14,scrumptious:21,scrumptiously:15,scumbag:-32,secure:14,secured:17,securely:14,securement:11,secureness:14,securer:15,securers:6,secures:13,securest:26,securing:13,securities:12,securitization:2,securitizations:1,securitize:3,securitized:14,securitizes:16,securitizing:7,security:14,sedition:-18,seditious:-17,seduced:-15,self-confident:25,selfish:-21,selfishly:-14,selfishness:-17,selfishnesses:-20,sentence:3,sentenced:-1,sentences:2,sentencing:-6,sentimental:13,sentimentalise:12,sentimentalised:8,sentimentalising:4,sentimentalism:10,sentimentalisms:4,sentimentalist:8,sentimentalists:7,sentimentalities:9,sentimentality:12,sentimentalization:12,sentimentalizations:4,sentimentalize:8,sentimentalized:11,sentimentalizes:11,sentimentalizing:8,sentimentally:19,serene:20,serious:-3,seriously:-7,seriousness:-2,severe:-16,severed:-15,severely:-20,severeness:-10,severer:-16,severest:-15,sexy:24,shake:-7,shakeable:-3,shakedown:-12,shakedowns:-14,shaken:-3,shakeout:-13,shakeouts:-8,shakers:3,shakeup:-6,shakeups:-5,shakier:-9,shakiest:-12,shakily:-7,shakiness:-7,shaking:-7,shaky:-9,shame:-21,shamed:-26,shamefaced:-23,shamefacedly:-19,shamefacedness:-20,shamefast:-10,shameful:-22,shamefully:-19,shamefulness:-24,shamefulnesses:-23,shameless:-14,shamelessly:-14,shamelessness:-14,shamelessnesses:-20,shames:-17,share:12,shared:14,shares:12,sharing:18,shattered:-21,shit:-26,shitake:-3,shitakes:-11,shithead:-31,shitheads:-26,shits:-21,shittah:1,shitted:-17,shittier:-21,shittiest:-34,shittim:-6,shittimwood:-3,shitting:-18,shitty:-26,shock:-16,shockable:-10,shocked:-13,shocker:-6,shockers:-11,shocking:-17,shockingly:-7,shockproof:13,shocks:-16,shook:-4,shoot:-14,short-sighted:-12,short-sightedness:-11,shortage:-10,shortages:-6,shrew:-9,shy:-10,shyer:-8,shying:-9,shylock:-21,shylocked:-7,shylocking:-15,shylocks:-14,shyly:-7,shyness:-13,shynesses:-12,shyster:-16,shysters:-9,sick:-23,sicken:-19,sickened:-25,sickener:-22,sickeners:-22,sickening:-24,sickeningly:-21,sickens:-20,sigh:1,significance:11,significant:8,silencing:-5,sillibub:-1,sillier:10,sillies:8,silliest:8,sillily:-1,sillimanite:1,sillimanites:2,silliness:-9,sillinesses:-12,silly:1,sin:-26,sincere:17,sincerely:21,sincereness:18,sincerer:20,sincerest:20,sincerities:15,sinful:-26,singleminded:12,sinister:-29,sins:-20,skeptic:-9,skeptical:-13,skeptically:-12,skepticism:-10,skepticisms:-12,skeptics:-4,slam:-16,slash:-11,slashed:-9,slashes:-8,slashing:-11,slavery:-38,sleeplessness:-16,slicker:4,slickest:3,sluggish:-17,slut:-28,sluts:-27,sluttier:-27,sluttiest:-31,sluttish:-22,sluttishly:-21,sluttishness:-25,sluttishnesses:-20,slutty:-23,smart:17,smartass:-21,smartasses:-17,smarted:7,smarten:19,smartened:15,smartening:17,smartens:15,smarter:20,smartest:30,smartie:13,smarties:17,smarting:-7,smartly:15,smartness:20,smartnesses:15,smarts:16,smartweed:2,smartweeds:1,smarty:11,smear:-15,smilax:6,smilaxes:3,smile:15,smiled:25,smileless:-14,smiler:17,smiles:21,smiley:17,smileys:15,smiling:20,smilingly:23,smog:-12,smother:-18,smothered:-9,smothering:-14,smothers:-19,smothery:-11,smug:8,smugger:-10,smuggest:-15,smuggle:-16,smuggled:-15,smuggler:-21,smugglers:-14,smuggles:-17,smuggling:-21,smugly:2,smugness:-14,smugnesses:-17,sneaky:-9,snob:-20,snobbery:-20,snobbier:-7,snobbiest:-5,snobbily:-16,snobbish:-9,snobbishly:-12,snobbishness:-11,snobbishnesses:-17,snobbism:-10,snobbisms:-3,snobby:-17,snobs:-14,snub:-18,snubbed:-20,snubbing:-9,snubs:-21,sob:-10,sobbed:-19,sobbing:-16,sobering:-8,sobs:-25,sociabilities:12,sociability:11,sociable:19,sociableness:15,sociably:16,sok:13,solemn:-3,solemnified:-5,solemnifies:-5,solemnify:3,solemnifying:1,solemnities:3,solemnity:-11,solemnization:7,solemnize:3,solemnized:-7,solemnizes:6,solemnizing:-6,solemnly:8,solid:6,solidarity:12,solution:13,solutions:7,solve:8,solved:11,solves:11,solving:14,somber:-18,son-of-a-bitch:-27,soothe:15,soothed:5,soothing:13,sophisticated:26,sore:-15,sorrow:-24,sorrowed:-24,sorrower:-23,sorrowful:-22,sorrowfully:-23,sorrowfulness:-25,sorrowing:-17,sorrows:-16,sorry:-3,soulmate:29,spam:-15,spammer:-22,spammers:-16,spamming:-21,spark:9,sparkle:18,sparkles:13,sparkling:12,special:17,speculative:4,spirit:7,spirited:13,spiritless:-13,spite:-24,spited:-24,spiteful:-19,spitefully:-23,spitefulness:-15,spitefulnesses:-23,spites:-14,splendent:27,splendid:28,splendidly:21,splendidness:23,splendiferous:26,splendiferously:19,splendiferousness:17,splendor:30,splendorous:22,splendors:20,splendour:22,splendours:22,splendrous:22,sprightly:20,squelched:-10,stab:-28,stabbed:-19,stable:12,stabs:-19,stall:-8,stalled:-8,stalling:-8,stamina:12,stammer:-9,stammered:-9,stammerer:-11,stammerers:-8,stammering:-10,stammers:-8,stampede:-18,stank:-19,startle:-13,startled:-7,startlement:-5,startlements:2,startler:-8,startlers:-5,startles:-5,startling:3,startlingly:-3,starve:-19,starved:-26,starves:-23,starving:-18,steadfast:10,steal:-22,stealable:-17,stealer:-17,stealers:-22,stealing:-27,stealings:-19,steals:-23,stealth:-3,stealthier:-3,stealthiest:4,stealthily:1,stealthiness:2,stealths:-3,stealthy:-1,stench:-23,stenches:-15,stenchful:-24,stenchy:-23,stereotype:-13,stereotyped:-12,stifled:-14,stimulate:9,stimulated:9,stimulates:10,stimulating:19,stingy:-16,stink:-17,stinkard:-23,stinkards:-10,stinkbug:-2,stinkbugs:-10,stinker:-15,stinkers:-12,stinkhorn:-2,stinkhorns:-8,stinkier:-15,stinkiest:-21,stinking:-24,stinkingly:-13,stinko:-15,stinkpot:-25,stinkpots:-7,stinks:-10,stinkweed:-4,stinkwood:-1,stinky:-15,stolen:-22,stop:-12,stopped:-9,stopping:-6,stops:-6,stout:7,straight:9,strain:-2,strained:-17,strainer:-8,strainers:-3,straining:-13,strains:-12,strange:-8,strangely:-12,strangled:-25,strength:22,strengthen:13,strengthened:18,strengthener:18,strengtheners:14,strengthening:22,strengthens:20,strengths:17,stress:-18,stressed:-14,stresses:-20,stressful:-23,stressfully:-26,stressing:-15,stressless:16,stresslessness:16,stressor:-18,stressors:-21,stricken:-23,strike:-5,strikers:-6,strikes:-15,strong:23,strongbox:7,strongboxes:3,stronger:16,strongest:19,stronghold:5,strongholds:10,strongish:17,strongly:11,strongman:7,strongmen:5,strongyl:6,strongyles:2,strongyloidosis:-8,strongyls:1,struck:-10,struggle:-13,struggled:-14,struggler:-11,strugglers:-14,struggles:-15,struggling:-18,stubborn:-17,stubborner:-15,stubbornest:-6,stubbornly:-14,stubbornness:-11,stubbornnesses:-15,stuck:-10,stunk:-16,stunned:-4,stunning:16,stuns:1,stupid:-24,stupider:-25,stupidest:-24,stupidities:-20,stupidity:-19,stupidly:-20,stupidness:-17,stupidnesses:-26,stupids:-23,stutter:-10,stuttered:-9,stutterer:-10,stutterers:-11,stuttering:-13,stutters:-10,suave:20,submissive:-13,submissively:-10,submissiveness:-7,substantial:8,subversive:-9,succeed:22,succeeded:18,succeeder:12,succeeders:13,succeeding:22,succeeds:22,success:27,successes:26,successful:28,successfully:22,successfulness:27,succession:8,successional:9,successionally:11,successions:1,successive:11,successively:9,successiveness:10,successor:9,successors:11,suck:-19,sucked:-20,sucker:-24,suckered:-20,suckering:-21,suckers:-23,sucks:-15,sucky:-19,suffer:-25,suffered:-22,sufferer:-20,sufferers:-24,suffering:-21,suffers:-21,suicidal:-35,suicide:-35,suing:-11,sulking:-15,sulky:-8,sullen:-17,sunnier:23,sunniest:24,sunny:18,sunshine:22,sunshiny:19,super:29,superb:31,superior:25,superiorities:8,superiority:14,superiorly:22,superiors:10,support:17,supported:13,supporter:11,supporters:19,supporting:19,supportive:12,supportiveness:15,supports:15,supremacies:8,supremacist:5,supremacists:-10,supremacy:2,suprematists:4,supreme:26,supremely:27,supremeness:23,supremer:23,supremest:22,supremo:19,supremos:13,sure:13,surefire:10,surefooted:19,surefootedly:16,surefootedness:15,surely:19,sureness:20,surer:12,surest:13,sureties:13,surety:10,suretyship:-1,suretyships:4,surprisal:15,surprisals:7,surprise:11,surprised:9,surpriser:6,surprisers:3,surprises:9,surprising:11,surprisingly:12,survived:23,surviving:12,survivor:15,suspect:-12,suspected:-9,suspecting:-7,suspects:-14,suspend:-13,suspended:-21,suspicion:-16,suspicions:-15,suspicious:-15,suspiciously:-17,suspiciousness:-12,sux:-15,swear:-2,swearing:-10,swears:2,sweet:20,sweetheart:33,sweethearts:28,sweetie:22,sweeties:21,sweetly:21,sweetness:22,sweets:22,swift:8,swiftly:12,swindle:-24,swindles:-15,swindling:-20,sympathetic:23,sympathy:15,talent:18,talented:23,talentless:-16,talents:20,tantrum:-18,tantrums:-15,tard:-25,tears:-9,teas:3,tease:-13,teased:-12,teasel:-1,teaseled:-8,teaseler:-8,teaselers:-12,teaseling:-4,teaselled:-4,teaselling:-2,teasels:-1,teaser:-10,teasers:-7,teases:-12,teashops:2,teasing:-3,teasingly:-4,teaspoon:2,teaspoonful:2,teaspoonfuls:4,teaspoons:5,teaspoonsful:3,temper:-18,tempers:-13,tendered:5,tenderer:6,tenderers:12,tenderest:14,tenderfeet:-4,tenderfoot:-1,tenderfoots:-5,tenderhearted:15,tenderheartedly:27,tenderheartedness:7,tenderheartednesses:28,tendering:6,tenderization:2,tenderize:1,tenderized:1,tenderizer:4,tenderizes:3,tenderizing:3,tenderloin:-2,tenderloins:4,tenderly:18,tenderness:18,tendernesses:9,tenderometer:2,tenderometers:2,tenders:6,tense:-14,tensed:-10,tensely:-12,tenseness:-15,tenser:-15,tenses:-9,tensest:-12,tensing:-10,tension:-13,tensional:-8,tensioned:-4,tensioner:-16,tensioners:-9,tensioning:-14,tensionless:6,tensions:-17,terrible:-21,terribleness:-19,terriblenesses:-26,terribly:-26,terrific:21,terrifically:17,terrified:-30,terrifies:-26,terrify:-23,terrifying:-27,terror:-24,terrorise:-31,terrorised:-33,terrorises:-33,terrorising:-30,terrorism:-36,terrorisms:-32,terrorist:-37,terroristic:-33,terrorists:-31,terrorization:-27,terrorize:-33,terrorized:-31,terrorizes:-31,terrorizing:-30,terrorless:9,terrors:-26,thank:15,thanked:19,thankful:27,thankfuller:19,thankfullest:20,thankfully:18,thankfulness:21,thanks:19,thief:-24,thieve:-22,thieved:-14,thieveries:-21,thievery:-20,thieves:-23,thorny:-11,thoughtful:16,thoughtfully:17,thoughtfulness:19,thoughtless:-20,threat:-24,threaten:-16,threatened:-20,threatener:-14,threateners:-18,threatening:-24,threateningly:-22,threatens:-16,threating:-20,threats:-18,thrill:15,thrilled:19,thriller:4,thrillers:1,thrilling:21,thrillingly:20,thrills:15,thwarted:-1,thwarting:-7,thwarts:-4,ticked:-18,timid:-10,timider:-10,timidest:-9,timidities:-7,timidity:-13,timidly:-7,timidness:-10,timorous:-8,tired:-19,tits:-9,tolerance:12,tolerances:3,tolerant:11,tolerantly:4,toothless:-14,top:8,tops:23,torn:-10,torture:-29,tortured:-26,torturer:-23,torturers:-35,tortures:-25,torturing:-30,torturous:-27,torturously:-22,totalitarian:-21,totalitarianism:-27,tough:-5,toughed:7,toughen:1,toughened:1,toughening:9,toughens:-2,tougher:7,toughest:-3,toughie:-7,toughies:-6,toughing:-5,toughish:-10,toughly:-11,toughness:-2,toughnesses:3,toughs:-8,toughy:-5,tout:-5,touted:-2,touting:-7,touts:-1,tragedian:-5,tragedians:-10,tragedienne:-4,tragediennes:-14,tragedies:-19,tragedy:-34,tragic:-20,tragical:-24,tragically:-27,tragicomedy:2,tragicomic:-2,tragics:-22,tranquil:2,tranquiler:19,tranquilest:16,tranquilities:15,tranquility:18,tranquilize:3,tranquilized:-2,tranquilizer:-1,tranquilizers:-4,tranquilizes:-1,tranquilizing:-5,tranquillest:8,tranquillities:5,tranquillity:18,tranquillized:-2,tranquillizer:-1,tranquillizers:-2,tranquillizes:1,tranquillizing:8,tranquilly:12,tranquilness:15,trap:-13,trapped:-24,trauma:-18,traumas:-22,traumata:-17,traumatic:-27,traumatically:-28,traumatise:-28,traumatised:-24,traumatises:-22,traumatising:-19,traumatism:-24,traumatization:-30,traumatizations:-22,traumatize:-24,traumatized:-17,traumatizes:-14,traumatizing:-23,travesty:-27,treason:-19,treasonous:-27,treasurable:25,treasure:12,treasured:26,treasurer:5,treasurers:4,treasurership:4,treasurerships:12,treasures:18,treasuries:9,treasuring:21,treasury:8,treat:17,tremble:-11,trembled:-11,trembler:-6,tremblers:-10,trembles:-1,trembling:-15,trembly:-12,tremulous:-10,trick:-2,tricked:-6,tricker:-9,trickeries:-12,trickers:-14,trickery:-11,trickie:-4,trickier:-7,trickiest:-12,trickily:-8,trickiness:-12,trickinesses:-4,tricking:1,trickish:-10,trickishly:-7,trickishness:-4,trickled:1,trickledown:-7,trickles:2,trickling:-2,trickly:-3,tricks:-5,tricksier:-5,tricksiness:-10,trickster:-9,tricksters:-13,tricksy:-8,tricky:-6,trite:-8,triumph:21,triumphal:20,triumphalisms:19,triumphalist:5,triumphalists:9,triumphant:24,triumphantly:23,triumphed:22,triumphing:23,triumphs:20,trivial:-1,trivialise:-8,trivialised:-8,trivialises:-11,trivialising:-14,trivialities:-10,triviality:-5,trivialization:-9,trivializations:-7,trivialize:-11,trivialized:-6,trivializes:-10,trivializing:-6,trivially:4,trivium:-3,trouble:-17,troubled:-20,troublemaker:-20,troublemakers:-22,troublemaking:-18,troubler:-14,troublers:-19,troubles:-20,troubleshoot:8,troubleshooter:10,troubleshooters:8,troubleshooting:7,troubleshoots:5,troublesome:-23,troublesomely:-18,troublesomeness:-19,troubling:-25,troublous:-21,troublously:-21,trueness:21,truer:15,truest:19,truly:19,trust:23,trustability:21,trustable:23,trustbuster:-5,trusted:21,trustee:10,trustees:3,trusteeship:5,trusteeships:6,truster:19,trustful:21,trustfully:15,trustfulness:21,trustier:13,trusties:10,trustiest:22,trustily:16,trustiness:16,trusting:17,trustingly:16,trustingness:16,trustless:-23,trustor:4,trustors:12,trusts:21,trustworthily:23,trustworthiness:18,trustworthy:26,trusty:22,truth:13,truthful:20,truthfully:19,truthfulness:17,truths:18,tumor:-16,turmoil:-15,twat:-34,ugh:-18,uglier:-22,uglies:-20,ugliest:-28,uglification:-22,uglified:-15,uglifies:-18,uglify:-21,uglifying:-22,uglily:-21,ugliness:-27,uglinesses:-25,ugly:-23,unacceptable:-20,unappreciated:-17,unapproved:-14,unattractive:-19,unaware:-8,unbelievable:8,unbelieving:-8,unbiased:-1,uncertain:-12,uncertainly:-14,uncertainness:-13,uncertainties:-14,uncertainty:-14,unclear:-10,uncomfortable:-16,uncomfortably:-17,uncompelling:-9,unconcerned:-9,unconfirmed:-5,uncontrollability:-17,uncontrollable:-15,uncontrollably:-15,uncontrolled:-10,unconvinced:-16,uncredited:-10,undecided:-9,underestimate:-12,underestimated:-11,underestimates:-11,undermine:-12,undermined:-15,undermines:-14,undermining:-15,undeserving:-19,undesirable:-19,unease:-17,uneasier:-14,uneasiest:-21,uneasily:-14,uneasiness:-16,uneasinesses:-18,uneasy:-16,unemployment:-19,unequal:-14,unequaled:5,unethical:-23,unfair:-21,unfocused:-17,unfortunate:-20,unfortunately:-14,unfortunates:-19,unfriendly:-15,unfulfilled:-18,ungrateful:-20,ungratefully:-18,ungratefulness:-16,unhappier:-24,unhappiest:-25,unhappily:-19,unhappiness:-24,unhappinesses:-22,unhappy:-18,unhealthy:-24,unified:16,unimportant:-13,unimpressed:-14,unimpressive:-14,unintelligent:-20,uninvolved:-22,uninvolving:-20,united:18,unjust:-23,unkind:-16,unlovable:-27,unloved:-19,unlovelier:-19,unloveliest:-19,unloveliness:-20,unlovely:-21,unloving:-23,unmatched:-3,unmotivated:-14,unpleasant:-21,unprofessional:-23,unprotected:-15,unresearched:-11,unsatisfied:-17,unsavory:-19,unsecured:-16,unsettled:-13,unsophisticated:-12,unstable:-15,unstoppable:-8,unsuccessful:-15,unsuccessfully:-17,unsupported:-17,unsure:-10,unsurely:-13,untarnished:16,unwanted:-9,unwelcome:-17,unworthy:-20,upset:-16,upsets:-15,upsetter:-19,upsetters:-20,upsetting:-21,uptight:-16,uptightness:-12,urgent:8,useful:19,usefully:18,usefulness:12,useless:-18,uselessly:-15,uselessness:-16,vague:-4,vain:-18,validate:15,validated:9,validates:14,validating:14,valuable:21,valuableness:17,valuables:21,valuably:23,value:14,valued:19,values:17,valuing:14,vanity:-9,verdict:6,verdicts:3,vested:6,vexation:-19,vexing:-20,vibrant:24,vicious:-15,viciously:-13,viciousness:-24,viciousnesses:-6,victim:-11,victimhood:-20,victimhoods:-9,victimise:-11,victimised:-15,victimises:-12,victimising:-25,victimization:-23,victimizations:-15,victimize:-25,victimized:-18,victimizer:-18,victimizers:-16,victimizes:-15,victimizing:-26,victimless:6,victimologies:-6,victimologist:-5,victimologists:-4,victimology:3,victims:-13,vigilant:7,vigor:11,vigorish:-4,vigorishes:4,vigoroso:15,vigorously:5,vigorousness:4,vigors:10,vigour:9,vigours:4,vile:-31,villain:-26,villainess:-29,villainesses:-20,villainies:-23,villainous:-20,villainously:-29,villainousness:-27,villains:-34,villainy:-26,vindicate:3,vindicated:18,vindicates:16,vindicating:-11,violate:-22,violated:-24,violater:-26,violaters:-24,violates:-23,violating:-25,violation:-22,violations:-24,violative:-24,violator:-24,violators:-19,violence:-31,violent:-29,violently:-28,virtue:18,virtueless:-14,virtues:15,virtuosa:17,virtuosas:18,virtuose:10,virtuosi:9,virtuosic:22,virtuosity:21,virtuoso:20,virtuosos:18,virtuous:24,virtuously:18,virtuousness:20,virulent:-27,vision:10,visionary:24,visioning:11,visions:9,vital:12,vitalise:11,vitalised:6,vitalises:11,vitalising:21,vitalism:2,vitalist:3,vitalists:3,vitalities:12,vitality:13,vitalization:16,vitalizations:8,vitalize:16,vitalized:15,vitalizes:14,vitalizing:13,vitally:11,vitals:11,vitamin:12,vitriolic:-21,vivacious:18,vociferous:-8,vulnerabilities:-6,vulnerability:-9,vulnerable:-9,vulnerableness:-11,vulnerably:-12,vulture:-20,vultures:-13,walkout:-13,walkouts:-7,wanker:-25,want:3,war:-29,warfare:-12,warfares:-18,warm:9,warmblooded:2,warmed:11,warmer:12,warmers:10,warmest:17,warmhearted:18,warmheartedness:27,warming:6,warmish:14,warmly:17,warmness:15,warmonger:-29,warmongering:-25,warmongers:-28,warmouth:4,warmouths:-8,warms:11,warmth:20,warmup:4,warmups:8,warn:-4,warned:-11,warning:-14,warnings:-12,warns:-4,warred:-24,warring:-19,wars:-26,warsaw:-1,warsaws:-2,warship:-7,warships:-5,warstle:1,waste:-18,wasted:-22,wasting:-17,wavering:-6,weak:-19,weaken:-18,weakened:-13,weakener:-16,weakeners:-13,weakening:-13,weakens:-13,weaker:-19,weakest:-23,weakfish:-2,weakfishes:-6,weakhearted:-16,weakish:-12,weaklier:-15,weakliest:-21,weakling:-13,weaklings:-14,weakly:-18,weakness:-18,weaknesses:-15,weakside:-11,wealth:22,wealthier:22,wealthiest:22,wealthily:20,wealthiness:24,wealthy:15,weapon:-12,weaponed:-14,weaponless:1,weaponry:-9,weapons:-19,weary:-11,weep:-27,weeper:-19,weepers:-11,weepie:-4,weepier:-18,weepies:-16,weepiest:-24,weeping:-19,weepings:-19,weeps:-14,weepy:-13,weird:-7,weirder:-5,weirdest:-9,weirdie:-13,weirdies:-10,weirdly:-12,weirdness:-9,weirdnesses:-7,weirdo:-18,weirdoes:-13,weirdos:-11,weirds:-6,weirdy:-9,welcome:20,welcomed:14,welcomely:19,welcomeness:20,welcomer:14,welcomers:19,welcomes:17,welcoming:19,well:11,welladay:3,wellaway:-8,wellborn:18,welldoer:25,welldoers:16,welled:4,wellhead:1,wellheads:5,wellhole:-1,wellies:4,welling:16,wellness:19,wells:10,wellsite:5,wellspring:15,wellsprings:14,welly:2,wept:-20,whimsical:3,whine:-15,whined:-9,whiner:-12,whiners:-6,whines:-18,whiney:-13,whining:-9,whitewash:1,whore:-33,whored:-28,whoredom:-21,whoredoms:-24,whorehouse:-11,whorehouses:-19,whoremaster:-19,whoremasters:-15,whoremonger:-26,whoremongers:-20,whores:-30,whoreson:-22,whoresons:-25,wicked:-24,wickeder:-22,wickedest:-29,wickedly:-21,wickedness:-21,wickednesses:-22,widowed:-21,willingness:11,wimp:-14,wimpier:-10,wimpiest:-9,wimpiness:-12,wimpish:-16,wimpishness:-2,wimple:-2,wimples:-3,wimps:-10,wimpy:-9,win:28,winnable:18,winned:18,winner:28,winners:21,winning:24,winningly:23,winnings:25,winnow:-3,winnower:-1,winnowers:-2,winnowing:-1,winnows:-2,wins:27,wisdom:24,wise:21,wiseacre:-12,wiseacres:-1,wiseass:-18,wiseasses:-15,wisecrack:-1,wisecracked:-5,wisecracker:-1,wisecrackers:1,wisecracking:-6,wisecracks:-3,wised:15,wiseguys:3,wiselier:9,wiseliest:16,wisely:18,wiseness:19,wisenheimer:-10,wisenheimers:-14,wisents:4,wiser:12,wises:13,wisest:21,wisewomen:13,wish:17,wishes:6,wishing:9,witch:-15,withdrawal:1,woe:-18,woebegone:-26,woebegoneness:-11,woeful:-19,woefully:-17,woefulness:-21,woes:-19,woesome:-12,won:27,wonderful:27,wonderfully:29,wonderfulness:29,woo:21,woohoo:23,woot:18,worn:-12,worried:-12,worriedly:-20,worrier:-18,worriers:-17,worries:-18,worriment:-15,worriments:-19,worrisome:-17,worrisomely:-20,worrisomeness:-19,worrit:-21,worrits:-12,worry:-19,worrying:-14,worrywart:-18,worrywarts:-15,worse:-21,worsen:-23,worsened:-19,worsening:-20,worsens:-21,worser:-20,worship:12,worshiped:24,worshiper:10,worshipers:9,worshipful:7,worshipfully:11,worshipfulness:16,worshiping:10,worshipless:-6,worshipped:27,worshipper:6,worshippers:8,worshipping:16,worships:14,worst:-31,worth:9,worthless:-19,worthwhile:14,worthy:19,wow:28,wowed:26,wowing:25,wows:20,wowser:-11,wowsers:10,wrathful:-27,wreck:-19,wrong:-21,wronged:-19,x-d:26,x-p:17,xd:28,xp:16,yay:24,yeah:12,yearning:5,yeees:17,yep:12,yes:17,youthful:13,yucky:-18,yummy:24,zealot:-19,zealots:-8,zealous:5";
var table2 = null;
function lexicon() {
  if (table2) return table2;
  const m = /* @__PURE__ */ new Map();
  for (const pair of PACKED.split(",")) {
    const i = pair.lastIndexOf(":");
    m.set(pair.slice(0, i), Number(pair.slice(i + 1)) / 10);
  }
  table2 = m;
  return m;
}
var BOOSTERS = {
  absolutely: 0.293,
  amazingly: 0.293,
  completely: 0.293,
  deeply: 0.293,
  enormously: 0.293,
  entirely: 0.293,
  especially: 0.293,
  extremely: 0.293,
  exceptionally: 0.293,
  incredibly: 0.293,
  intensely: 0.293,
  particularly: 0.293,
  purely: 0.293,
  quite: 0.293,
  really: 0.293,
  remarkably: 0.293,
  so: 0.293,
  substantially: 0.293,
  thoroughly: 0.293,
  totally: 0.293,
  tremendously: 0.293,
  unbelievably: 0.293,
  utterly: 0.293,
  very: 0.293,
  super: 0.293,
  almost: -0.293,
  barely: -0.293,
  hardly: -0.293,
  kinda: -0.293,
  kind: -0.293,
  less: -0.293,
  little: -0.293,
  marginally: -0.293,
  occasionally: -0.293,
  partly: -0.293,
  scarcely: -0.293,
  slightly: -0.293,
  somewhat: -0.293,
  sort: -0.293
};
var NEGATIONS = /* @__PURE__ */ new Set([
  "not",
  "no",
  "never",
  "none",
  "nobody",
  "nothing",
  "neither",
  "nowhere",
  "cannot",
  "cant",
  "wont",
  "didnt",
  "doesnt",
  "isnt",
  "wasnt",
  "arent",
  "werent",
  "havent",
  "hasnt",
  "hadnt",
  "wouldnt",
  "couldnt",
  "shouldnt",
  "aint",
  "without",
  "rarely",
  "seldom",
  "hardly"
]);
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z'\s-]/g, " ").split(/\s+/).filter((w) => w.length > 0 && w.length < 24);
}
function analyseSentiment(words) {
  const lex = lexicon();
  let sum = 0;
  let hits = 0;
  let intensity = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let v = lex.get(w);
    if (v === void 0) continue;
    let scale = 1;
    for (let k = 1; k <= 2 && i - k >= 0; k++) {
      const b = BOOSTERS[words[i - k]];
      if (b !== void 0) {
        scale += b * (k === 1 ? 1 : 0.75);
        intensity += Math.abs(b);
      }
    }
    v *= scale;
    for (let k = 1; k <= 3 && i - k >= 0; k++) {
      if (NEGATIONS.has(words[i - k].replace(/'/g, ""))) {
        v *= -0.74;
        break;
      }
    }
    sum += v;
    intensity += Math.min(1, Math.abs(v) / 3);
    hits++;
  }
  if (hits === 0) return { valence: 0, arousal: 0, coverage: 0 };
  const valence = sum / Math.sqrt(sum * sum + 15);
  const arousal = Math.min(1, intensity / Math.max(3, hits));
  return { valence, arousal, coverage: hits / Math.max(1, words.length) };
}
function lightFrom(valence, arousal, brightness) {
  if (valence < -0.15 && brightness < 0.5) return "overcast";
  if (valence > 0.1 && arousal > 0.55) return "midday";
  if (brightness > 0.62) return "morning";
  return "evening";
}

// src/lib/semantics/title.ts
function makeTitle(subject, light, durationMs) {
  const seconds = Math.max(1, Math.round(durationMs / 1e3));
  return `${SUBJECTS[subject].label}, ${light}, ${seconds} second${seconds === 1 ? "" : "s"}`;
}

// src/lib/pipeline.ts
function seedFor(a) {
  const nums = [a.durationMs / 1e3, a.groups.length];
  for (const g of a.groups) nums.push(g.f0Mean, g.f0Var, g.rmsMean, g.rate, g.centroidMean);
  for (let i = 0; i < a.contour.length; i += 4) nums.push(a.contour[i]);
  return hashNumbers(nums);
}
function selectionFeatures(a, s) {
  const total = Math.max(1, a.durationMs);
  const pauseMs = a.pauses.reduce((x, p) => x + (p.endMs - p.startMs), 0);
  const speech = a.groups.reduce((x, g) => x + (g.endMs - g.startMs), 0);
  const rates = a.groups.map((g) => g.rate);
  const cents = a.groups.map((g) => g.centroidMean);
  return {
    valence: (s.valence + 1) / 2,
    // Arousal blends the lexical signal with the voice's own energy. How loudly
    // and how fast something was said carries more arousal than word choice, so
    // the audio gets the larger share (PRD 4.3, and sentiment.ts explains why).
    arousal: Math.max(0, Math.min(
      1,
      s.arousal * 0.35 + Math.min(1, median(rates) / 6) * 0.4 + Math.min(1, Math.max(0, (median(a.groups.map((g) => g.rmsMean)) - a.noiseFloorDb) / 45)) * 0.25
    )),
    rate: Math.min(1, median(rates) / 7),
    contentDensity: Math.min(1, speech / total / 0.75),
    pauseRatio: Math.min(1, pauseMs / total),
    brightness: Math.min(1, median(cents) / 3200)
  };
}
function openingSeed(a) {
  const g = a.groups[0];
  if (!g) return hashNumbers([a.durationMs / 1e3]);
  return hashNumbers([g.f0Mean, g.f0Var, g.rmsMean, g.rate, g.centroidMean, a.noiseFloorDb]);
}
function buildPiece(a, words, seedOverride) {
  assignWords(a.groups, words);
  const sentiment = analyseSentiment(words.map((w) => w.word));
  const feats = selectionFeatures(a, sentiment);
  const selection = selectSubject(feats);
  const light = lightFrom(sentiment.valence, feats.arousal, feats.brightness);
  const seed = seedOverride ?? seedFor(a);
  const result = compose({ analysis: a, words, sentiment, selection, seed });
  return {
    events: result.events,
    seed,
    subject: selection.subject,
    runnerUp: selection.runnerUp,
    light,
    title: makeTitle(selection.subject, light, a.durationMs),
    durationMs: a.durationMs,
    strokeCount: result.strokeCount,
    lightnessRange: result.lightnessRange,
    selection,
    sentiment
  };
}

// src/lib/synth.ts
var SPEAKERS = [
  { name: "monotone", pitchCenter: 108, expressiveness: 0.6, rate: 3.4, loudness: 26, timbre: 0.34, pausiness: 0.18 },
  { name: "expressive", pitchCenter: 196, expressiveness: 4.2, rate: 4.6, loudness: 33, timbre: 0.66, pausiness: 0.14 },
  { name: "hesitant", pitchCenter: 142, expressiveness: 1.9, rate: 2.1, loudness: 20, timbre: 0.45, pausiness: 0.52 },
  { name: "rapid", pitchCenter: 168, expressiveness: 2.6, rate: 6.8, loudness: 31, timbre: 0.74, pausiness: 0.07 },
  { name: "low-slow", pitchCenter: 92, expressiveness: 1.1, rate: 1.9, loudness: 23, timbre: 0.22, pausiness: 0.38 }
];
function synthAnalysis(profile, seed, durationMs = 24e3) {
  const r = mulberry32(seed >>> 0);
  const noiseFloorDb = -52;
  const groups = [];
  const pauses = [];
  let t = range(r, 200, 900);
  const targetGroups = Math.max(4, Math.round(10 * (1 - profile.pausiness * 0.5) + gauss(r) * 2));
  while (t < durationMs - 500 && groups.length < 16) {
    const phraseMs = range(r, 900, 2600) * (1 + (1 - profile.rate / 7) * 0.6);
    const end = Math.min(durationMs, t + phraseMs);
    if (end - t < 400) break;
    const f0 = profile.pitchCenter * Math.pow(2, gauss(r) * 2.2 / 12);
    groups.push({
      index: groups.length,
      startMs: t,
      endMs: end,
      f0Mean: f0,
      f0Var: Math.max(0.05, profile.expressiveness * (0.6 + Math.abs(gauss(r)) * 0.9)),
      rmsMean: noiseFloorDb + profile.loudness + gauss(r) * 4,
      rmsMax: noiseFloorDb + profile.loudness + 6 + Math.abs(gauss(r)) * 4,
      centroidMean: 700 + profile.timbre * 2600 + gauss(r) * 320,
      onsetCount: Math.round(profile.rate * (end - t) / 1e3),
      rate: profile.rate * (0.75 + r() * 0.5),
      words: []
    });
    const gapBase = profile.pausiness > 0.4 ? 620 : 260;
    const gap = range(r, gapBase * 0.6, gapBase * 2.2) * (0.5 + profile.pausiness);
    if (gap >= 180) {
      pauses.push({ startMs: end, endMs: end + gap, major: gap > 450 });
    }
    t = end + gap;
    if (groups.length >= targetGroups && r() < 0.4) break;
  }
  const peaks = [];
  {
    const k = 2 + (r() * 3 | 0);
    for (let i = 0; i < k && i < groups.length; i++) {
      const g = groups[Math.min(groups.length - 1, Math.floor((i + 0.5) * (groups.length / k)))];
      peaks.push({ tMs: (g.startMs + g.endMs) / 2, strength: 0.55 + r() * 0.45 });
    }
    peaks.sort((a, b) => a.tMs - b.tMs);
  }
  const contour = new Float32Array(CONTOUR_POINTS);
  {
    let v = 0.5;
    const drift = profile.expressiveness / 6;
    for (let i = 0; i < CONTOUR_POINTS; i++) {
      v = Math.max(0, Math.min(1, v + gauss(r) * 0.06 * (0.4 + drift)));
      contour[i] = v;
    }
    let lo = 1, hi = 0;
    for (const x of contour) {
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    if (hi > lo) for (let i = 0; i < CONTOUR_POINTS; i++) contour[i] = (contour[i] - lo) / (hi - lo);
  }
  const semi = profile.expressiveness;
  return {
    durationMs,
    noiseFloorDb,
    groups,
    pauses,
    peaks,
    contour,
    voice: {
      pitchMin: profile.pitchCenter * Math.pow(2, -semi / 12),
      pitchMax: profile.pitchCenter * Math.pow(2, semi / 12),
      baselineCentroid: 700 + profile.timbre * 2600
    },
    frameCount: Math.round(durationMs / 50)
  };
}
var SAMPLE_WORDS = {
  water: "ocean sea water river cold quiet waves shore evening tide swimming lake stones".split(" "),
  garden: "garden flowers green summer growing warm roses bees leaves bright morning".split(" "),
  field: "field grass gold wheat wind slow afternoon hills open quiet distance".split(" "),
  sky: "sky clouds air light open wide drifting pale nothing far".split(" "),
  street: "street city traffic noise cars crowded night lights concrete hurry corner".split(" "),
  interior: "room kitchen table chair lamp warm small window quiet coffee sitting".split(" ")
};
function synthWords(subjectWords, analysis, seed) {
  const r = mulberry32((seed ^ 20974) >>> 0);
  const out = [];
  for (const g of analysis.groups) {
    const n = Math.max(2, Math.round((g.endMs - g.startMs) / 380));
    for (let i = 0; i < n; i++) {
      const a = g.startMs + (g.endMs - g.startMs) * i / n;
      out.push({
        word: subjectWords[r() * subjectWords.length | 0],
        startMs: a,
        endMs: a + 300
      });
    }
  }
  return out;
}

// src/lib/moderation.ts
var BLOCK = [
  "nigger",
  "nigga",
  "faggot",
  "fag",
  "kike",
  "spic",
  "chink",
  "tranny",
  "retard",
  "rape",
  "raping",
  "rapist",
  "molest",
  "pedophile",
  "paedophile",
  "childporn",
  "kys",
  "killyourself",
  "lynch"
];
var SOFT = ["fuck", "shit", "cunt", "bitch", "whore", "dick", "cock", "asshole"];
function moderate(transcript) {
  if (!transcript) return "approved";
  const norm = transcript.toLowerCase().replace(/[^a-z]+/g, "");
  const words = transcript.toLowerCase().split(/[^a-z']+/).filter(Boolean);
  for (const bad of BLOCK) {
    if (norm.includes(bad) || words.includes(bad)) return "rejected";
  }
  for (const w of words) if (SOFT.includes(w)) return "pending";
  return "approved";
}

// src/lib/prompts.ts
var PROMPTS = [
  { id: "calm", text: "Describe somewhere you felt calm" },
  { id: "travel", text: "Talk about the last place you travelled" },
  { id: "street", text: "Describe your street" },
  { id: "room", text: "Tell me about a room you remember" },
  { id: "now", text: "Say what you can see right now" },
  { id: "weather", text: "Describe the weather where you are" },
  { id: "morning", text: "Talk about this morning" }
];
function promptFor(date) {
  let h = 0;
  for (let i = 0; i < date.length; i++) h = h * 31 + date.charCodeAt(i) >>> 0;
  return PROMPTS[h % PROMPTS.length];
}
function todayKey(now = /* @__PURE__ */ new Date()) {
  return now.toISOString().slice(0, 10);
}
export {
  CONTOUR_POINTS,
  FEATURE_HZ,
  FRAME,
  HOP,
  L_MAX,
  L_MIN,
  OneEuro,
  PROMPTS,
  SAMPLE_WORDS,
  SHADOW_HUE,
  SPEAKERS,
  STROKE_HARD_CAP,
  STROKE_MAX,
  STROKE_MIN,
  SUBJECTS,
  analyse,
  analyseSentiment,
  assignWords,
  buildPiece,
  clusterHue,
  colorFor,
  compose,
  countStrokes,
  decimate,
  detectPitch,
  fft,
  gamutFit,
  gauss,
  hann,
  hashNumbers,
  hashString,
  installLexicon,
  isStroke,
  lexiconReady,
  lightFrom,
  magnitudeSpectrum,
  makeTitle,
  median,
  medianThreshold,
  moderate,
  mulberry32,
  noBlack,
  normalise,
  oklchToCss,
  oklchToRgbRaw,
  openingSeed,
  pick,
  promptFor,
  range,
  rms,
  seedFor,
  selectSubject,
  selectionFeatures,
  spectralCentroid,
  spectralFlux,
  streamDuration,
  subStream,
  synthAnalysis,
  synthWords,
  toDb,
  todayKey,
  tokenize,
  wrapHue
};
