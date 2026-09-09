"use client";

/**
 * The landing page's seed piece (PRD 3): a painting already forming on screen.
 *
 * In its own module so it can be dynamically imported. The analyser, the
 * composer and the synthetic speaker profiles are only ever needed to build
 * this one piece, and pulling them into the initial bundle spends the landing
 * page's JS budget (PRD 13) on code that runs once and then never again.
 */

import { buildPiece } from "./pipeline";
import { compose } from "./audio/compose";
import { synthAnalysis, synthWords, SPEAKERS, SAMPLE_WORDS } from "./synth";
import { PaintEvent } from "./events";

const SEED = 20260909;

export interface SeedPiece {
  events: PaintEvent[];
  seed: number;
  durationMs: number;
}

export function makeSeedPiece(): SeedPiece {
  // Water, always. The product is named after Impression, Sunrise -- a harbour
  // at dawn -- and water is the subject whose horizontal banding reads as a
  // painting fastest, which is what a seed piece has to do.
  //
  // Composed with the subject pinned rather than selected, because neither the
  // colour table nor the sentiment lexicon is loaded on the landing page and
  // selection without them would be a coin toss.
  const a = synthAnalysis(SPEAKERS[1], SEED);
  const w = synthWords(SAMPLE_WORDS.water, a, SEED);
  const base = buildPiece(a, w);
  const r = compose({
    analysis: a,
    words: w,
    sentiment: base.sentiment,
    selection: { ...base.selection, subject: "water" },
    seed: base.seed,
  });
  return { events: r.events, seed: base.seed, durationMs: a.durationMs };
}
