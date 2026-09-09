/**
 * Analysis + language -> PaintEvent[] (PRD 4.2, 4.3, 4.4, 4.6).
 *
 * The mapping specification, implemented literally. Audio drives structure and
 * composition; language drives colour and subject. Every constant in here is a
 * tuning knob and every one of them was placed to serve one sentence: your
 * voice made this painting, and no one else's voice would have made the same
 * one.
 */

import {
  PaintEvent, StrokeEvent, Vec2, SubjectId, Layer,
  STROKE_HARD_CAP,
} from "../events";
import { Analysis, BreathGroup, normalise } from "./analyzer";
import { SUBJECTS, Selection } from "../render/subjects";
import { clusterHue } from "../semantics/lexicon";
import { Sentiment } from "../semantics/sentiment";
import { subStream, gauss, range } from "../prng";
import { wrapHue } from "../color";

export interface TimedWord {
  word: string;
  startMs: number;
  endMs: number;
}

export interface ComposeInput {
  analysis: Analysis;
  words: TimedWord[];
  sentiment: Sentiment;
  selection: Selection;
  seed: number;
}

export interface ComposeResult {
  events: PaintEvent[];
  strokeCount: number;
  lightnessRange: [number, number];
}

/** PRD 4.4: the piece must span this much of the lightness axis or it dies at
 *  thumbnail size, which is exactly where a viral toy lives. */
export const L_MIN = 0.35;
export const L_MAX = 0.92;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Assign each breath group the words that were spoken inside it. Requires
 *  word-level timestamps; without them the colour layer decouples from the
 *  structural layer entirely (PRD 7.6). */
export function assignWords(groups: BreathGroup[], words: TimedWord[]): void {
  for (const g of groups) g.words = [];
  for (const w of words) {
    const mid = (w.startMs + w.endMs) / 2;
    let best: BreathGroup | null = null;
    let bestD = Infinity;
    for (const g of groups) {
      if (mid >= g.startMs && mid <= g.endMs) { best = g; bestD = 0; break; }
      const d = mid < g.startMs ? g.startMs - mid : mid - g.endMs;
      if (d < bestD) { bestD = d; best = g; }
    }
    // A word landing more than a second outside every group is transcription
    // drift, not speech we can place; colouring a cluster with it would be worse
    // than leaving that cluster to the structural palette.
    if (best && bestD < 1000) best.words.push(w.word);
  }
}

export function compose(input: ComposeInput): ComposeResult {
  const { analysis, sentiment, selection, seed } = input;
  const subject = SUBJECTS[selection.subject];
  const events: PaintEvent[] = [];
  const groups = analysis.groups;

  //
  // The piece's overall colour key.
  //
  // Cluster hues alone spread too far: consecutive breath groups drew slightly
  // different word sets and the render came out orange, cyan, green and
  // magenta all at once, which is a colour chart rather than a painting. Real
  // paintings sit in one key with local variation, so each cluster is pulled
  // partway toward the whole clip's content centroid before the subject pull
  // is applied. Language still decides the hue; it just decides it for the
  // piece as well as for the breath group.
  //
  const allWords = groups.flatMap((g) => g.words);
  const pieceHue = clusterHue(allWords);

  const rHorizon = subStream(seed, "horizon");
  const rGround = subStream(seed, "ground");
  const rLayout = subStream(seed, "layout");

  /* --------------------------------------------------- per-clip scaling --- */
  // PRD 4.5: everything is measured against this clip's own spread.
  const nF0 = normalise(groups.map((g) => g.f0Mean).filter((x) => x > 0));
  const nVar = normalise(groups.map((g) => g.f0Var), 0.45); // expanded hardest: see below
  const nRms = normalise(groups.map((g) => g.rmsMean));
  const nRate = normalise(groups.map((g) => g.rate));
  const nCent = normalise(groups.map((g) => g.centroidMean));

  /* ---------------------------------------------------------- ground ----- */
  // Voice signature -> underpainting tone (PRD 4.2). Seeded per voice so the
  // same speaker's pieces share a family resemblance even across subjects.
  const pitchSpan = analysis.voice.pitchMax - analysis.voice.pitchMin;
  //
  // The underpainting is warm and high-key, and only leans toward the subject.
  // Pulling it all the way to the subject hue gives a green ground under a
  // garden and an olive mud under everything, which is what the first render
  // did. Impressionist grounds are warm precisely so the cool notes laid over
  // them stay luminous.
  //
  const voiceTint = ((analysis.voice.baselineCentroid % 700) / 700) * 70 - 35 + (pitchSpan % 50) - 25;
  const sigHue = wrapHue(mixHue(62, subject.hueTarget, 0.3) + voiceTint);
  const groundL = clamp01(0.82 + sentiment.valence * 0.04 + subject.lightnessBias * 0.5);
  events.push({ t: 0, type: "ground", hue: sigHue, lightness: groundL });

  /* --------------------------------------------------------- horizon ----- */
  //
  // Asymmetry is mandatory (PRD 4.6). The contour is not simply dropped onto
  // the canvas centred: it is biased off-centre by a seeded amount, and one
  // piece in three deliberately violates the rule of thirds by pushing the
  // horizon out past it. Centred horizons are the single strongest tell of
  // generated landscape art.
  const horizonPoints: Vec2[] = [];
  if (subject.horizonY !== null) {
    const bias = gauss(rHorizon) * 0.14;
    const breakThirds = rHorizon() < 0.33;
    const base = clamp01(subject.horizonY + bias + (breakThirds ? (rHorizon() < 0.5 ? -0.12 : 0.12) : 0));
    const amp = 0.05 + 0.10 * clamp01(pitchSpan / 220);
    const c = analysis.contour;
    for (let i = 0; i < c.length; i++) {
      horizonPoints.push({
        x: i / (c.length - 1),
        y: clamp01(base + (c[i] - 0.5) * amp * 2),
      });
    }
    events.push({ t: 0, type: "horizon", points: horizonPoints });
  }
  const horizonAt = (x: number): number => {
    if (!horizonPoints.length) return 0.5;
    const u = clamp01(x) * (horizonPoints.length - 1);
    const i = Math.min(horizonPoints.length - 2, Math.floor(u));
    const f = u - i;
    return horizonPoints[i].y * (1 - f) + horizonPoints[i + 1].y * f;
  };

  /* --------------------------------------------------------- clusters ---- */
  const duration = Math.max(1, analysis.durationMs);
  const margin = subject.margin;
  const strokes: StrokeEvent[] = [];

  // Peak lookup for the passages of light (PRD 4.2).
  const peakNear = (ms: number): number => {
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

    // x follows time, so a long pause leaves a real horizontal gap on the
    // canvas. That is PRD 4.6's "preserve the stumbles" falling out of the
    // layout for free rather than being simulated.
    const cx = margin + (mid / duration) * (1 - margin * 2);

    // Vertical placement: pitch decides where inside the subject's zone this
    // cluster sits, high pitch high on the canvas. The horizon still pulls,
    // so the compositional spine stays legible, but it no longer forces every
    // mark into one strip across the middle.
    const hy = horizonAt(cx);
    const pitchN = nF0(g.f0Mean);
    const [z0, z1] = subject.zone;
    const zoned = z1 - (pitchN * (z1 - z0));
    const cy = clamp01(zoned * 0.72 + hy * 0.28 + gauss(rc) * 0.045);

    events.push({
      t: g.startMs, type: "cluster", id: g.index,
      center: { x: cx, y: cy }, subject: selection.subject,
    });

    /* ------------------------------------------------ cluster palette ---- */
    // Base hue from the words spoken in this breath group (PRD 4.3), pulled
    // toward the subject's family. When there is no transcript -- Firefox, or
    // a silent share -- `agreement` is 0 and the subject palette carries it
    // alone, which is the intended silent degradation from PRD 7.6.
    const ch = clusterHue(g.words);
    const own = g.words.length ? mixHue(ch.hue, pieceHue.hue, 0.55) : subject.hueTarget;
    const pull = g.words.length ? subject.huePull : 1;
    const baseHue = wrapHue(mixHue(own, subject.hueTarget, pull));
    // Pastel is a statement about hue, not about value (PRD 4.4). Chroma is
    // held down here so that the lightness axis -- which is what survives being
    // scaled to a thumbnail -- carries the contrast instead.
    const baseChroma = Math.max(0.03, Math.min(0.155,
      (g.words.length ? ch.chroma : 0.10) * subject.chromaScale * 0.72 *
      (0.65 + 0.7 * clamp01(sentiment.arousal * 0.6 + nRms(g.rmsMean) * 0.4))));

    /* ------------------------------------------------ cluster geometry --- */
    const varN = nVar(g.f0Var);
    const rmsN = nRms(g.rmsMean);
    const rateN = nRate(g.rate);
    const centN = nCent(g.centroidMean);

    //
    // Stroke direction variance. PRD 4.2 calls this "the single most legible
    // difference between two speakers" and says to weight it heavily, so it is
    // weighted heavily: a monotone speaker lands near 0.12 radians of spread
    // and produces near-parallel marks; an expressive one lands past 1.2 and
    // produces a swirl. Nothing else in the mapping has this much authority
    // over what the finished piece looks like.
    //
    const angleSpread = (0.12 + Math.pow(varN, 0.8) * 1.55) * subject.angleSpread;

    // Onset density -> how many marks and how much they overlap.
    const perCluster = Math.round(4 + rateN * 5 + rmsN * 3);
    const count = Math.max(4, Math.min(12, Math.round(perCluster * subject.density)));
    // Spread, not a pile. Strokes packed inside a small radius merge into one
    // mass and stop being countable, which is the check against sliding back
    // into haze (PRD 4.6).
    const blob = (0.065 + 0.085 * (1 - rateN)) * (1 + subject.elongation * 0.12);

    const edgeBand = Math.max(0, Math.min(4,
      Math.round(centN * 4 + subject.edgeBias))) as 0 | 1 | 2 | 3 | 4;

    const light = peakNear(mid);

    for (let i = 0; i < count; i++) {
      const u = count > 1 ? i / (count - 1) : 0.5;
      const t = g.startMs + (g.endMs - g.startMs) * u;

      const ox = gauss(rc) * blob * (1 + subject.elongation * 0.25);
      const oy = gauss(rc) * blob;
      const px = clamp01(cx + ox);
      const py = clamp01(cy + oy);

      const angle = subject.baseAngle + gauss(rc) * angleSpread;

      // One accent per cluster, and it is a near-complement rather than a true
      // one. A true 180-degree jump next to a pastel reads as a colour clash
      // rather than as the shimmer the technique is after; 150 degrees carries
      // the same optical charge without shouting.
      const isAccent = count > 5 && i === 2 + ((rc() * Math.max(1, count - 4)) | 0);

      // RMS -> length and paint load (PRD 4.2).
      const len = (0.065 + rmsN * 0.125) * subject.elongation * range(rc, 0.75, 1.4) * (isAccent ? 0.7 : 1);
      // Wide enough that the bristle streaks read as texture inside a loaded
      // mark. Thinner than this and each stamp's fibres separate out, and the
      // stroke reads as a blade of grass rather than as paint.
      const width = (0.016 + rmsN * 0.026) * range(rc, 0.82, 1.3);
      const load = clamp01(0.3 + rmsN * 0.6 + light * 0.3);

      // Broken colour (PRD 4.3): a narrow analogous band around the cluster
      // hue, and exactly one complementary accent per cluster. Never mixed
      // before placement -- adjacent unmixed deposits do the mixing in the eye.
      const hue = isAccent
        ? wrapHue(baseHue + 150 + gauss(rc) * 16)
        : wrapHue(baseHue + gauss(rc) * 18);
      const chroma = baseChroma * (isAccent ? 0.5 : range(rc, 0.7, 1.15));

      // Lightness: energy-driven, with the passages of light sitting highest.
      const lightness = clamp01(
        0.58 + (rmsN - 0.5) * 0.42 * subject.contrast + light * 0.26 +
        subject.lightnessBias + gauss(rc) * 0.07,
      );

      const layer: Layer = light > 0.45 && i >= count - 2 ? "light" : u < 0.4 ? "under" : "mid";

      const path = strokePath(px, py, angle, len, rc);
      strokes.push({
        t, type: "stroke", clusterId: g.index, path,
        width, angle, hue, chroma, lightness, edgeBand, load, layer,
      });

      // Water doubles below the horizon (PRD 5). A reflection is a real mark
      // in the water, not a mirrored copy of the sky: shorter, flatter, dimmer.
      if (subject.reflection && py < hy) {
        const ry = clamp01(hy + (hy - py) * range(rc, 0.85, 1.05));
        strokes.push({
          t: t + 30, type: "stroke", clusterId: g.index,
          path: strokePath(px + gauss(rc) * 0.01, ry, angle * 0.25, len * 0.85, rc),
          width: width * 1.05, angle: angle * 0.25,
          hue: wrapHue(hue - 8), chroma: chroma * 0.8,
          lightness: clamp01(lightness - 0.10), edgeBand: 0,
          load: load * 0.75, layer: "mid",
        });
      }
    }
  }

  /* ------------------------------------- value range: assert and correct -- */
  //
  // PRD 4.4 asks for this explicitly. The cheap failure mode of "pastel" is a
  // painting that occupies L 0.6-0.8 and turns into a single grey square in a
  // feed. Rather than hoping the constants land right, measure the finished
  // piece and rescale the lightness axis onto [0.35, 0.92] when it does not.
  //
  //
  // Read as a band, not only as a minimum. Rescaling only when the spread is
  // too *narrow* leaves the other half of the rule unenforced: the first build
  // measured L 0.34-1.00, which is a blown white highlight and a value below
  // the floor in the same piece. Mapping the actual range onto exactly
  // [0.35, 0.92] satisfies both halves at once and costs nothing.
  //
  let lo = 1, hi = 0;
  for (const s of strokes) { if (s.lightness < lo) lo = s.lightness; if (s.lightness > hi) hi = s.lightness; }
  if (strokes.length) {
    const span = hi - lo;
    const wanted = L_MAX - L_MIN;
    if (span < 1e-6) {
      // Degenerate: every stroke identical. Spread them deterministically
      // rather than leaving a flat piece, which fails the same test.
      const rl = subStream(seed, "valuefix");
      for (const s of strokes) s.lightness = L_MIN + rl() * wanted;
    } else {
      for (const s of strokes) s.lightness = L_MIN + ((s.lightness - lo) / span) * wanted;
    }
    lo = L_MIN; hi = L_MAX;
  }

  /* --------------------------------------------------------- hard cap ---- */
  // PRD 13. Strokes must stay individually countable (PRD 4.6); past this many
  // the piece slides back into the haze the whole design exists to avoid.
  strokes.sort((a, b) => a.t - b.t);
  let kept = strokes;
  if (strokes.length > STROKE_HARD_CAP) {
    const stride = strokes.length / STROKE_HARD_CAP;
    kept = [];
    for (let i = 0; i < STROKE_HARD_CAP; i++) kept.push(strokes[Math.floor(i * stride)]);
  }

  // Within a cluster, emit under -> mid -> light so that temporal order already
  // satisfies the layering rule (PRD 7.4.3) without the live pass having to
  // see the future.
  const rank: Record<Layer, number> = { under: 0, mid: 1, light: 2 };
  kept.sort((a, b) => a.clusterId - b.clusterId || rank[a.layer] - rank[b.layer] || a.t - b.t);
  kept.sort((a, b) => a.clusterId - b.clusterId);

  const byCluster = new Map<number, StrokeEvent[]>();
  for (const s of kept) {
    const arr = byCluster.get(s.clusterId) ?? [];
    arr.push(s);
    byCluster.set(s.clusterId, arr);
  }
  for (const [, arr] of byCluster) arr.sort((a, b) => rank[a.layer] - rank[b.layer] || a.t - b.t);
  const ordered = [...byCluster.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, v]) => v);

  events.push(...ordered);
  void rGround; void rLayout;

  return {
    events,
    strokeCount: ordered.length,
    lightnessRange: [lo, hi],
  };
}

/** Shortest-path hue interpolation. Arithmetic mixing of 350 and 10 gives 180,
 *  a green from two reds; on a colour circle only this is correct. */
function mixHue(from: number, to: number, t: number): number {
  let d = wrapHue(to) - wrapHue(from);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return wrapHue(from + d * t);
}

/**
 * A stroke's control points. Never a straight segment: a real loaded stroke
 * bows, because a wrist rotates. 3 points with a seeded perpendicular bow.
 */
function strokePath(x: number, y: number, angle: number, len: number, r: () => number): Vec2[] {
  const dx = Math.cos(angle) * len * 0.5;
  const dy = Math.sin(angle) * len * 0.5;
  const bow = gauss(r) * len * 0.30;
  const nx = -Math.sin(angle) * bow;
  const ny = Math.cos(angle) * bow;
  return [
    { x: x - dx, y: y - dy },
    { x: x + nx, y: y + ny },
    { x: x + dx, y: y + dy },
  ];
}
