/**
 * Audio feature extraction (PRD 7.2), written as pure functions over
 * `Float32Array` frames (PRD 6.2).
 *
 * Nothing here knows it is inside an AudioWorklet. That is deliberate and it
 * is the one piece of forward-planning the PRD asks for: upload is the first
 * feature to be added back after launch, and when it lands it will call these
 * same functions from a Web Worker over a decoded AudioBuffer. The two paths
 * then differ only in how frames are delivered.
 */

export const FRAME = 2048;
export const HOP = 1024;
export const FEATURE_HZ = 20;

/* ------------------------------------------------------------------ FFT --- */

/** In-place iterative radix-2 FFT. `re`/`im` must have power-of-two length. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + (len >> 1)] * cr - im[i + k + (len >> 1)] * ci;
        const vi = re[i + k + (len >> 1)] * ci + im[i + k + (len >> 1)] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + (len >> 1)] = ur - vr; im[i + k + (len >> 1)] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/** Magnitude spectrum (first half) of a windowed frame. */
export function magnitudeSpectrum(frame: Float32Array, window: Float32Array, out: Float32Array): void {
  const n = frame.length;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = frame[i] * window[i];
  fft(re, im);
  const half = n >> 1;
  for (let i = 0; i < half; i++) out[i] = Math.hypot(re[i], im[i]);
}

/* ------------------------------------------------------------- features --- */

export function rms(frame: Float32Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return Math.sqrt(s / frame.length);
}

export const toDb = (x: number) => 20 * Math.log10(Math.max(1e-8, x));

/** Magnitude-weighted mean bin frequency, in Hz. */
export function spectralCentroid(mag: Float32Array, sampleRate: number): number {
  let num = 0, den = 0;
  const binHz = sampleRate / (mag.length * 2);
  for (let i = 1; i < mag.length; i++) {
    num += i * binHz * mag[i];
    den += mag[i];
  }
  return den > 1e-9 ? num / den : 0;
}

/** Half-wave rectified spectral flux. Feeds onset detection. */
export function spectralFlux(mag: Float32Array, prev: Float32Array): number {
  let s = 0;
  for (let i = 0; i < mag.length; i++) {
    const d = mag[i] - prev[i];
    if (d > 0) s += d;
  }
  return s;
}

/**
 * McLeod Pitch Method, matching the `pitchy` package's algorithm.
 *
 * Implemented here rather than imported so that the whole extraction path
 * stays dependency-free and can be bundled into an AudioWorklet, where module
 * imports are awkward, and reused verbatim from a Worker on the upload path.
 * Frames below `clarityFloor` are rejected outright and the caller
 * interpolates across the gap (PRD 7.2).
 */
export function detectPitch(
  frame: Float32Array,
  sampleRate: number,
  clarityFloor = 0.85,
): { f0: number; clarity: number } {
  const n = frame.length;
  const nsdf = new Float32Array(n);

  // normalised square difference via autocorrelation
  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += frame[i] * frame[i];
  let acfAtZero = sumSq;
  let running = sumSq;

  for (let tau = 0; tau < n; tau++) {
    let acf = 0;
    for (let i = 0; i + tau < n; i++) acf += frame[i] * frame[i + tau];
    if (tau > 0) {
      running -= frame[tau - 1] * frame[tau - 1] + frame[n - tau] * frame[n - tau];
    }
    const denom = tau === 0 ? 2 * acfAtZero : acfAtZero + running;
    nsdf[tau] = denom > 1e-12 ? (2 * acf) / denom : 0;
  }

  // first positively-sloped zero crossing, then peaks up to the global max
  let tau = 0;
  while (tau < n - 1 && nsdf[tau] > 0) tau++;
  while (tau < n - 1 && nsdf[tau] <= 0) tau++;

  const peaks: number[] = [];
  let cur = -1, curVal = -1;
  for (; tau < n - 1; tau++) {
    if (nsdf[tau] > nsdf[tau - 1] && nsdf[tau] >= nsdf[tau + 1]) {
      if (nsdf[tau] > curVal) { curVal = nsdf[tau]; cur = tau; }
    }
    if (nsdf[tau] <= 0 && cur >= 0) { peaks.push(cur); cur = -1; curVal = -1; }
  }
  if (cur >= 0) peaks.push(cur);
  if (!peaks.length) return { f0: 0, clarity: 0 };

  let maxPeak = 0;
  for (const p of peaks) if (nsdf[p] > maxPeak) maxPeak = nsdf[p];
  const threshold = maxPeak * 0.9;
  let chosen = peaks[0];
  for (const p of peaks) { if (nsdf[p] >= threshold) { chosen = p; break; } }

  // parabolic interpolation around the chosen lag
  const y1 = nsdf[chosen - 1] ?? nsdf[chosen];
  const y2 = nsdf[chosen];
  const y3 = nsdf[chosen + 1] ?? nsdf[chosen];
  const denom = 2 * (2 * y2 - y1 - y3);
  const shift = denom !== 0 ? (y3 - y1) / denom : 0;
  const period = chosen + shift;
  const clarity = Math.max(0, Math.min(1, y2));
  if (period <= 0 || clarity < clarityFloor) return { f0: 0, clarity };
  const f0 = sampleRate / period;
  if (f0 < 55 || f0 > 900) return { f0: 0, clarity }; // outside plausible speech
  return { f0, clarity };
}
/* -------------------------------------------------------- one-euro ------- */

/**
 * One-euro filter (PRD 7.2). Adaptive: heavy smoothing when the signal is
 * steady, light when it is moving fast.
 *
 * Tuned to *under*-smooth on purpose. Over-smoothing removes the hesitations,
 * and the hesitations are the point -- PRD 4.6 requires that if someone
 * stumbles, the canvas visibly goes empty there.
 */
export class OneEuro {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(
    private minCutoff = 1.0,
    private beta = 0.7,
    private dCutoff = 1.0,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, tSec: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = tSec;
      return x;
    }
    const dt = Math.max(1e-3, tSec - this.tPrev);
    this.tPrev = tSec;

    const dx = (x - this.xPrev) / dt;
    const aD = OneEuro.alpha(this.dCutoff, dt);
    this.dxPrev = aD * dx + (1 - aD) * this.dxPrev;

    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const a = OneEuro.alpha(cutoff, dt);
    const out = a * x + (1 - a) * this.xPrev;
    this.xPrev = out;
    return out;
  }
}

/* ------------------------------------------------------ adaptive onset --- */

/** Adaptive median threshold over a sliding window (PRD 7.2). */
export function medianThreshold(history: number[], multiplier = 1.6, bias = 1e-5): number {
  if (!history.length) return Infinity;
  const s = [...history].sort((a, b) => a - b);
  const med = s[s.length >> 1];
  return med * multiplier + bias;
}
