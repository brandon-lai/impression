/**
 * Frames -> structure (PRD 4.2, 4.5, 7.2).
 *
 * The half of the product that decides whether the core claim survives. PRD
 * 14's Phase 1 gate is five people saying the same sentence producing five
 * distinguishable paintings, and everything that makes that true lives in
 * `normalise()` at the bottom of this file rather than in the renderer.
 */

export interface FrameFeature {
  t: number;       // seconds
  rmsDb: number;
  f0: number;      // 0 when unvoiced or rejected
  clarity: number;
  centroid: number; // Hz
  flux: number;
}

export interface BreathGroup {
  index: number;
  startMs: number;
  endMs: number;
  f0Mean: number;
  f0Var: number;     // normalised variance of f0 within the group, in semitones
  rmsMean: number;   // dB
  rmsMax: number;    // dB
  centroidMean: number;
  onsetCount: number;
  rate: number;      // onsets per second
  words: string[];   // filled by the semantic layer when a transcript exists
}

export interface Pause {
  startMs: number;
  endMs: number;
  major: boolean;    // > 450ms: open canvas, a passage of unbroken ground
}

export interface Peak {
  tMs: number;
  strength: number;  // 0-1 within this clip
}

export interface Analysis {
  durationMs: number;
  noiseFloorDb: number;
  groups: BreathGroup[];
  pauses: Pause[];
  peaks: Peak[];
  /** Pitch contour resampled to canvas width. The compositional spine. */
  contour: Float32Array;
  voice: { pitchMin: number; pitchMax: number; baselineCentroid: number };
  frameCount: number;
}

export const CONTOUR_POINTS = 96;

const PAUSE_MIN_MS = 180;
const PAUSE_MAJOR_MS = 450;
const PAUSE_MIN_FRAMES = 3; // PRD 7.2: avoid flicker
const hzToSemitones = (hz: number, ref: number) => 12 * Math.log2(Math.max(1e-6, hz) / Math.max(1e-6, ref));

/**
 * Interpolate across rejected pitch frames (PRD 7.2). Unvoiced consonants and
 * low-clarity frames leave holes; leaving them as zeros would put a cliff in
 * the horizon at every "s".
 */
function fillPitchGaps(frames: FrameFeature[]): Float32Array {
  const n = frames.length;
  const out = new Float32Array(n);
  let lastIdx = -1;
  for (let i = 0; i < n; i++) {
    if (frames[i].f0 > 0) {
      if (lastIdx >= 0 && i - lastIdx > 1) {
        const a = out[lastIdx], b = frames[i].f0;
        for (let k = lastIdx + 1; k < i; k++) out[k] = a + ((b - a) * (k - lastIdx)) / (i - lastIdx);
      } else if (lastIdx < 0) {
        for (let k = 0; k < i; k++) out[k] = frames[i].f0;
      }
      out[i] = frames[i].f0;
      lastIdx = i;
    }
  }
  if (lastIdx < 0) return out;                       // wholly unvoiced
  for (let k = lastIdx + 1; k < n; k++) out[k] = out[lastIdx];
  return out;
}

export function analyse(frames: FrameFeature[], noiseFloorDb: number): Analysis {
  const n = frames.length;
  if (n === 0) {
    return {
      durationMs: 0, noiseFloorDb, groups: [], pauses: [], peaks: [],
      contour: new Float32Array(CONTOUR_POINTS).fill(0.5),
      voice: { pitchMin: 100, pitchMax: 200, baselineCentroid: 1500 }, frameCount: 0,
    };
  }
  const durationMs = frames[n - 1].t * 1000;
  const pitch = fillPitchGaps(frames);

  // --- silence mask -------------------------------------------------------
  const silenceDb = noiseFloorDb + 6; // PRD 7.2
  const quiet = frames.map((f) => f.rmsDb < silenceDb);

  const pauses: Pause[] = [];
  {
    let run = 0;
    for (let i = 0; i <= n; i++) {
      if (i < n && quiet[i]) { run++; continue; }
      if (run >= PAUSE_MIN_FRAMES) {
        const startMs = frames[i - run].t * 1000;
        const endMs = frames[i - 1].t * 1000;
        if (endMs - startMs >= PAUSE_MIN_MS) {
          pauses.push({ startMs, endMs, major: endMs - startMs > PAUSE_MAJOR_MS });
        }
      }
      run = 0;
    }
  }

  // --- breath groups: the voiced spans between those pauses ----------------
  const groups: BreathGroup[] = [];
  {
    const bounds: Array<[number, number]> = [];
    let cursor = 0;
    for (const p of pauses) {
      if (p.startMs > frames[cursor].t * 1000) bounds.push([frames[cursor].t * 1000, p.startMs]);
      while (cursor < n && frames[cursor].t * 1000 < p.endMs) cursor++;
    }
    if (cursor < n) bounds.push([frames[cursor].t * 1000, durationMs]);

    for (const [a, b] of bounds) {
      if (b - a < 120) continue;                       // too short to be a phrase
      const idx: number[] = [];
      for (let i = 0; i < n; i++) {
        const t = frames[i].t * 1000;
        if (t >= a && t <= b && !quiet[i]) idx.push(i);
      }
      if (idx.length < 3) continue;

      const f0s = idx.map((i) => pitch[i]).filter((x) => x > 0);
      const f0Mean = f0s.length ? f0s.reduce((s, x) => s + x, 0) / f0s.length : 0;
      // Variance in semitones, not Hz. A 20Hz wobble is enormous at 90Hz and
      // trivial at 400Hz; in Hz this feature would just re-measure the
      // speaker's register instead of their expressiveness.
      const semis = f0s.map((x) => hzToSemitones(x, f0Mean || 1));
      const f0Var = semis.length > 1
        ? Math.sqrt(semis.reduce((s, x) => s + x * x, 0) / semis.length)
        : 0;

      const rmsVals = idx.map((i) => frames[i].rmsDb);
      const onsetCount = idx.reduce((s, i) => s + (frames[i].flux > 0 ? 1 : 0), 0);

      groups.push({
        index: groups.length,
        startMs: a, endMs: b,
        f0Mean,
        f0Var,
        rmsMean: rmsVals.reduce((s, x) => s + x, 0) / rmsVals.length,
        rmsMax: Math.max(...rmsVals),
        centroidMean: idx.reduce((s, i) => s + frames[i].centroid, 0) / idx.length,
        onsetCount,
        rate: onsetCount / Math.max(0.2, (b - a) / 1000),
        words: [],
      });
    }
  }

  // --- passages of light: 2-4 RMS maxima (PRD 4.2) -------------------------
  const peaks: Peak[] = [];
  {
    const win = Math.max(3, Math.round(n / 24));
    const cands: Peak[] = [];
    for (let i = win; i < n - win; i++) {
      if (quiet[i]) continue;
      let isMax = true;
      for (let k = i - win; k <= i + win; k++) if (frames[k].rmsDb > frames[i].rmsDb) { isMax = false; break; }
      if (isMax) cands.push({ tMs: frames[i].t * 1000, strength: frames[i].rmsDb });
    }
    cands.sort((a, b) => b.strength - a.strength);
    const chosen = cands.slice(0, 4);
    const lo = Math.min(...chosen.map((c) => c.strength), 0);
    const hi = Math.max(...chosen.map((c) => c.strength), 1);
    for (const c of chosen) peaks.push({ tMs: c.tMs, strength: hi > lo ? (c.strength - lo) / (hi - lo) : 1 });
    peaks.sort((a, b) => a.tMs - b.tMs);
  }

  // --- contour: the horizon (PRD 4.2) --------------------------------------
  const contour = new Float32Array(CONTOUR_POINTS);
  {
    const voiced = pitch.filter((x) => x > 0);
    const lo = voiced.length ? Math.min(...voiced) : 100;
    const hi = voiced.length ? Math.max(...voiced) : 200;
    for (let i = 0; i < CONTOUR_POINTS; i++) {
      const a = Math.floor((i / CONTOUR_POINTS) * n);
      const b = Math.max(a + 1, Math.floor(((i + 1) / CONTOUR_POINTS) * n));
      let s = 0, k = 0;
      for (let j = a; j < b && j < n; j++) { if (pitch[j] > 0) { s += pitch[j]; k++; } }
      const v = k ? s / k : (lo + hi) / 2;
      contour[i] = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    }
    // light smoothing only: PRD 4.6 wants the stumbles preserved
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
    durationMs, noiseFloorDb, groups, pauses, peaks, contour,
    voice: {
      pitchMin: voicedAll.length ? Math.min(...voicedAll) : 100,
      pitchMax: voicedAll.length ? Math.max(...voicedAll) : 200,
      baselineCentroid: cents.length ? cents.reduce((s, x) => s + x, 0) / cents.length : 1500,
    },
    frameCount: n,
  };
}

/* ------------------------------------------------ normalise and expand --- */

export interface Norm {
  /** Map a raw value to 0-1 against this clip's own spread, then exaggerate. */
  (v: number): number;
}

/**
 * PRD 4.5, and the single most important function in the audio path.
 *
 * At 30 seconds there are only 6-14 breath groups and ordinary speakers differ
 * far less than intuition suggests. Mapping absolute feature values produces
 * paintings that all look broadly alike, which fails the Phase 1 gate outright.
 *
 * So: rescale against the clip's own min/max, then push mid-range values toward
 * the extremes with a symmetric power curve about the median. `strength` below
 * 1 expands; 0.5 is aggressive and deliberate. A quiet, even speaker must still
 * produce a painting with visible internal variation.
 */
export function normalise(values: number[], strength = 0.55): Norm {
  if (values.length === 0) return () => 0.5;
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const median = sorted[sorted.length >> 1];
  // A degenerate spread (a perfectly steady speaker) must not divide by zero
  // and must not collapse to a constant, or the piece has no internal variation
  // at all -- which is the exact failure this function exists to prevent.
  const span = hi - lo;
  if (span < 1e-9) return () => 0.5;
  const medN = (median - lo) / span;

  return (v: number) => {
    const t = Math.max(0, Math.min(1, (v - lo) / span));
    // signed distance from the median, expanded
    const d = t < medN
      ? -Math.pow(medN > 0 ? (medN - t) / medN : 0, strength)
      : Math.pow(medN < 1 ? (t - medN) / (1 - medN) : 0, strength);
    return Math.max(0, Math.min(1, 0.5 + d * 0.5));
  };
}

/** Median of a list, for feature summaries. */
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}
