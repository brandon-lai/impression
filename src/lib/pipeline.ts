/**
 * One place that turns an analysis plus whatever language we have into a
 * finished piece. Shared by the live path, the final pass, the harness and the
 * landing page's seed piece, so all four cannot drift apart.
 */

import { Analysis, median } from "./audio/analyzer";
import { compose, assignWords, TimedWord, ComposeResult } from "./audio/compose";
import { selectSubject, SelectionFeatures, Selection } from "./render/subjects";
import { analyseSentiment, lightFrom, Sentiment } from "./semantics/sentiment";
import { makeTitle, Light } from "./semantics/title";
import { hashNumbers } from "./prng";
import { SubjectId } from "./events";

export interface Piece {
  events: ComposeResult["events"];
  seed: number;
  subject: SubjectId;
  runnerUp: SubjectId;
  light: Light;
  title: string;
  durationMs: number;
  strokeCount: number;
  lightnessRange: [number, number];
  selection: Selection;
  sentiment: Sentiment;
}

/**
 * Seed derived from the feature stream (PRD 4.7), never from a clock or a
 * counter. Two recordings of the same clip must land on the same painting, and
 * a piece reloaded from storage must repaint identically a year later.
 */
export function seedFor(a: Analysis): number {
  const nums: number[] = [a.durationMs / 1000, a.groups.length];
  for (const g of a.groups) nums.push(g.f0Mean, g.f0Var, g.rmsMean, g.rate, g.centroidMean);
  for (let i = 0; i < a.contour.length; i += 4) nums.push(a.contour[i]);
  return hashNumbers(nums);
}

export function selectionFeatures(a: Analysis, s: Sentiment): SelectionFeatures {
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
    arousal: Math.max(0, Math.min(1,
      s.arousal * 0.35 + Math.min(1, median(rates) / 6) * 0.4 +
      Math.min(1, Math.max(0, (median(a.groups.map((g) => g.rmsMean)) - a.noiseFloorDb) / 45)) * 0.25)),
    rate: Math.min(1, median(rates) / 7),
    contentDensity: Math.min(1, speech / total / 0.75),
    pauseRatio: Math.min(1, pauseMs / total),
    brightness: Math.min(1, median(cents) / 3200),
  };
}

export function buildPiece(a: Analysis, words: TimedWord[]): Piece {
  assignWords(a.groups, words);
  const sentiment = analyseSentiment(words.map((w) => w.word));
  const feats = selectionFeatures(a, sentiment);
  const selection = selectSubject(feats);
  const light = lightFrom(sentiment.valence, feats.arousal, feats.brightness);
  const seed = seedFor(a);
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
    sentiment,
  };
}
