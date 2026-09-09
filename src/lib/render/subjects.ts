/**
 * The six subjects (PRD 5). Recognisable, not invented.
 *
 * Each subject is a set of biases the composer applies while turning breath
 * groups into strokes: where the horizon sits, which way the marks run, how
 * elongated and how dense they are, and which way the palette is pulled.
 *
 * The subject is a bias, never an override. A monotone speaker and an
 * expressive one both painting "garden" must still produce visibly different
 * gardens, or the subject has eaten the voice and the core claim dies.
 */

import { SubjectId } from "../events";

export interface SubjectConfig {
  id: SubjectId;
  label: string;
  /** Horizon height, 0 = top of canvas. null = no horizon (interior). */
  horizonY: number | null;
  /** Dominant stroke direction, radians. 0 = horizontal. */
  baseAngle: number;
  /** Multiplier on the angular spread the voice asks for. */
  angleSpread: number;
  /** Length relative to width. High = broad bands, low = dabs. */
  elongation: number;
  /** Strokes per cluster multiplier. */
  density: number;
  /** Palette pull: hue target and how hard the subject pulls toward it. */
  hueTarget: number;
  huePull: number;
  chromaScale: number;
  /** Added to every stroke's lightness before the value-range fit. */
  lightnessBias: number;
  /** Extra value contrast across the piece. */
  contrast: number;
  /** Water: strokes are mirrored below the horizon as reflections. */
  reflection: boolean;
  /** Bias applied to the spectral-centroid edge band. */
  edgeBias: number;
  /** Fraction of the canvas kept clear at the margins. */
  margin: number;
  /**
   * Vertical band the clusters occupy, [top, bottom].
   *
   * Placing every cluster symmetrically about the horizon is what made the
   * first renders pile their marks into one horizontal strip with a dead
   * bottom third. Where the paint actually goes is a property of the subject:
   * a garden's planting sits *below* a high horizon, a sky's weather sits
   * *above* a low one. Pitch then places the cluster within this band.
   */
  zone: [number, number];
}

export const SUBJECTS: Record<SubjectId, SubjectConfig> = {
  water: {
    id: "water", label: "Water",
    horizonY: 0.44, baseAngle: 0, angleSpread: 0.55, elongation: 2.5, density: 1.0,
    hueTarget: 215, huePull: 0.45, chromaScale: 0.95, lightnessBias: 0.03,
    contrast: 0.95, reflection: true, edgeBias: -0.6, margin: 0.05, zone: [0.14, 0.88],
  },
  garden: {
    id: "garden", label: "Garden",
    // High horizon: little sky, a dense bank of planting filling the canvas.
    horizonY: 0.30, baseAngle: Math.PI / 2, angleSpread: 1.25, elongation: 1.05, density: 1.9,
    hueTarget: 95, huePull: 0.30, chromaScale: 1.30, lightnessBias: 0.04,
    contrast: 1.05, reflection: false, edgeBias: 0.5, margin: 0.03, zone: [0.24, 0.96],
  },
  field: {
    id: "field", label: "Field",
    horizonY: 0.63, baseAngle: 0, angleSpread: 0.5, elongation: 2.9, density: 0.8,
    hueTarget: 78, huePull: 0.38, chromaScale: 1.05, lightnessBias: 0.06,
    contrast: 0.9, reflection: false, edgeBias: -0.2, margin: 0.04, zone: [0.30, 0.95],
  },
  sky: {
    id: "sky", label: "Sky",
    horizonY: 0.82, baseAngle: 0.12, angleSpread: 0.8, elongation: 2.2, density: 0.55,
    hueTarget: 235, huePull: 0.34, chromaScale: 0.8, lightnessBias: 0.10,
    contrast: 0.8, reflection: false, edgeBias: -1.0, margin: 0.06, zone: [0.05, 0.78],
  },
  street: {
    id: "street", label: "Street",
    horizonY: 0.50, baseAngle: Math.PI / 2.6, angleSpread: 1.5, elongation: 1.5, density: 1.2,
    hueTarget: 40, huePull: 0.22, chromaScale: 0.62, lightnessBias: -0.06,
    contrast: 1.55, reflection: false, edgeBias: 1.0, margin: 0.02, zone: [0.14, 0.94],
  },
  interior: {
    id: "interior", label: "Interior",
    horizonY: null, baseAngle: Math.PI / 5, angleSpread: 0.9, elongation: 1.25, density: 1.1,
    hueTarget: 55, huePull: 0.40, chromaScale: 0.9, lightnessBias: -0.02,
    contrast: 1.0, reflection: false, edgeBias: -0.5, margin: 0.10, zone: [0.10, 0.92],
  },
};

/**
 * The normalised feature space subject selection happens in.
 * Every component is 0-1 and comes out of the per-clip normalisation, so a
 * quiet speaker and a loud one are compared on their own terms (PRD 4.5).
 */
export interface SelectionFeatures {
  valence: number;     // 0 negative .. 1 positive
  arousal: number;     // 0 calm .. 1 charged
  rate: number;        // 0 slow .. 1 fast
  contentDensity: number; // 0 sparse .. 1 wordy
  pauseRatio: number;  // fraction of the clip spent in pauses
  brightness: number;  // 0 dark timbre .. 1 bright timbre
}

interface Prototype {
  id: SubjectId;
  p: SelectionFeatures;
  w: SelectionFeatures;
}

/*
 * Prototypes read straight off the PRD's table. Weights say which of a
 * subject's conditions are load-bearing: "sky" is selected by *low content
 * density and long pauses* and by almost nothing else, so those two dominate
 * its distance and its valence barely matters.
 */
const PROTOTYPES: Prototype[] = [
  { id: "water",
    p: { valence: 0.62, arousal: 0.18, rate: 0.3, contentDensity: 0.5, pauseRatio: 0.35, brightness: 0.4 },
    w: { valence: 1.0, arousal: 1.6, rate: 1.2, contentDensity: 0.4, pauseRatio: 0.5, brightness: 0.5 } },
  { id: "garden",
    p: { valence: 0.85, arousal: 0.8, rate: 0.7, contentDensity: 0.7, pauseRatio: 0.2, brightness: 0.65 },
    w: { valence: 1.7, arousal: 1.5, rate: 0.7, contentDensity: 0.5, pauseRatio: 0.3, brightness: 0.4 } },
  { id: "field",
    p: { valence: 0.78, arousal: 0.22, rate: 0.18, contentDensity: 0.45, pauseRatio: 0.35, brightness: 0.5 },
    w: { valence: 1.5, arousal: 1.4, rate: 1.5, contentDensity: 0.3, pauseRatio: 0.4, brightness: 0.3 } },
  { id: "sky",
    p: { valence: 0.55, arousal: 0.25, rate: 0.15, contentDensity: 0.08, pauseRatio: 0.72, brightness: 0.55 },
    w: { valence: 0.3, arousal: 0.5, rate: 0.8, contentDensity: 2.4, pauseRatio: 2.2, brightness: 0.3 } },
  { id: "street",
    p: { valence: 0.18, arousal: 0.78, rate: 0.85, contentDensity: 0.75, pauseRatio: 0.12, brightness: 0.7 },
    w: { valence: 1.6, arousal: 1.2, rate: 1.7, contentDensity: 0.5, pauseRatio: 0.5, brightness: 0.6 } },
  { id: "interior",
    p: { valence: 0.25, arousal: 0.2, rate: 0.35, contentDensity: 0.6, pauseRatio: 0.3, brightness: 0.22 },
    w: { valence: 1.6, arousal: 1.5, rate: 0.8, contentDensity: 0.4, pauseRatio: 0.3, brightness: 1.8 } },
];

const KEYS: (keyof SelectionFeatures)[] =
  ["valence", "arousal", "rate", "contentDensity", "pauseRatio", "brightness"];

export interface Selection {
  subject: SubjectId;
  runnerUp: SubjectId;
  /** Distance gap to the runner-up. Small = the choice was nearly a coin toss. */
  margin: number;
  scores: Record<SubjectId, number>;
}

/** Pure, deterministic, and unit-tested per subject (PRD 5). */
export function selectSubject(f: SelectionFeatures): Selection {
  const scores = {} as Record<SubjectId, number>;
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
    scores,
  };
}
