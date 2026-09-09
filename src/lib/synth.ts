/**
 * Synthetic analyses, for the Phase 0 harness and the landing page's seed piece.
 *
 * The harness needs to feed the renderer plausible event streams with no audio
 * and no backend (PRD 14, Phase 0). The same generator answers the Phase 1 gate
 * question directly: give it five different speaker profiles and it produces
 * the five analyses that five different people saying the same sentence would,
 * so the "can you tell them apart" check can be run on demand instead of only
 * after recruiting five humans.
 *
 * Everything is seeded. No `Math.random()` anywhere.
 */

import { Analysis, BreathGroup, CONTOUR_POINTS, Pause, Peak } from "./audio/analyzer";
import { mulberry32, gauss, range } from "./prng";

export interface SpeakerProfile {
  name: string;
  /** Hz. Where this voice sits. */
  pitchCenter: number;
  /** Semitone spread within a phrase. The expressiveness dial (PRD 4.2). */
  expressiveness: number;
  /** Onsets per second. */
  rate: number;
  /** dB above the noise floor. */
  loudness: number;
  /** Bright or dark timbre, 0-1. */
  timbre: number;
  /** How much of the clip is spent not speaking. */
  pausiness: number;
}

export const SPEAKERS: SpeakerProfile[] = [
  { name: "monotone",   pitchCenter: 108, expressiveness: 0.6, rate: 3.4, loudness: 26, timbre: 0.34, pausiness: 0.18 },
  { name: "expressive", pitchCenter: 196, expressiveness: 4.2, rate: 4.6, loudness: 33, timbre: 0.66, pausiness: 0.14 },
  { name: "hesitant",   pitchCenter: 142, expressiveness: 1.9, rate: 2.1, loudness: 20, timbre: 0.45, pausiness: 0.52 },
  { name: "rapid",      pitchCenter: 168, expressiveness: 2.6, rate: 6.8, loudness: 31, timbre: 0.74, pausiness: 0.07 },
  { name: "low-slow",   pitchCenter: 92,  expressiveness: 1.1, rate: 1.9, loudness: 23, timbre: 0.22, pausiness: 0.38 },
];

export function synthAnalysis(profile: SpeakerProfile, seed: number, durationMs = 24000): Analysis {
  const r = mulberry32(seed >>> 0);
  const noiseFloorDb = -52;

  const groups: BreathGroup[] = [];
  const pauses: Pause[] = [];

  let t = range(r, 200, 900);
  const targetGroups = Math.max(4, Math.round(10 * (1 - profile.pausiness * 0.5) + gauss(r) * 2));

  while (t < durationMs - 500 && groups.length < 16) {
    const phraseMs = range(r, 900, 2600) * (1 + (1 - profile.rate / 7) * 0.6);
    const end = Math.min(durationMs, t + phraseMs);
    if (end - t < 400) break;

    const f0 = profile.pitchCenter * Math.pow(2, (gauss(r) * 2.2) / 12);
    groups.push({
      index: groups.length,
      startMs: t, endMs: end,
      f0Mean: f0,
      f0Var: Math.max(0.05, profile.expressiveness * (0.6 + Math.abs(gauss(r)) * 0.9)),
      rmsMean: noiseFloorDb + profile.loudness + gauss(r) * 4,
      rmsMax: noiseFloorDb + profile.loudness + 6 + Math.abs(gauss(r)) * 4,
      centroidMean: 700 + profile.timbre * 2600 + gauss(r) * 320,
      onsetCount: Math.round((profile.rate * (end - t)) / 1000),
      rate: profile.rate * (0.75 + r() * 0.5),
      words: [],
    });

    const gapBase = profile.pausiness > 0.4 ? 620 : 260;
    const gap = range(r, gapBase * 0.6, gapBase * 2.2) * (0.5 + profile.pausiness);
    if (gap >= 180) {
      pauses.push({ startMs: end, endMs: end + gap, major: gap > 450 });
    }
    t = end + gap;
    if (groups.length >= targetGroups && r() < 0.4) break;
  }

  const peaks: Peak[] = [];
  {
    const k = 2 + ((r() * 3) | 0);
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
    // stretch to the full 0-1 range so the horizon uses the whole contour
    let lo = 1, hi = 0;
    for (const x of contour) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    if (hi > lo) for (let i = 0; i < CONTOUR_POINTS; i++) contour[i] = (contour[i] - lo) / (hi - lo);
  }

  const semi = profile.expressiveness;
  return {
    durationMs, noiseFloorDb, groups, pauses, peaks, contour,
    voice: {
      pitchMin: profile.pitchCenter * Math.pow(2, -semi / 12),
      pitchMax: profile.pitchCenter * Math.pow(2, semi / 12),
      baselineCentroid: 700 + profile.timbre * 2600,
    },
    frameCount: Math.round(durationMs / 50),
  };
}

/** Sample vocabulary per subject, so the harness exercises the real colour
 *  table rather than the out-of-vocabulary hash fallback. */
export const SAMPLE_WORDS: Record<string, string[]> = {
  water: "ocean sea water river cold quiet waves shore evening tide swimming lake stones".split(" "),
  garden: "garden flowers green summer growing warm roses bees leaves bright morning".split(" "),
  field: "field grass gold wheat wind slow afternoon hills open quiet distance".split(" "),
  sky: "sky clouds air light open wide drifting pale nothing far".split(" "),
  street: "street city traffic noise cars crowded night lights concrete hurry corner".split(" "),
  interior: "room kitchen table chair lamp warm small window quiet coffee sitting".split(" "),
};

export function synthWords(subjectWords: string[], analysis: Analysis, seed: number) {
  const r = mulberry32((seed ^ 0x51ee) >>> 0);
  const out: { word: string; startMs: number; endMs: number }[] = [];
  for (const g of analysis.groups) {
    const n = Math.max(2, Math.round((g.endMs - g.startMs) / 380));
    for (let i = 0; i < n; i++) {
      const a = g.startMs + ((g.endMs - g.startMs) * i) / n;
      out.push({
        word: subjectWords[(r() * subjectWords.length) | 0],
        startMs: a,
        endMs: a + 300,
      });
    }
  }
  return out;
}
