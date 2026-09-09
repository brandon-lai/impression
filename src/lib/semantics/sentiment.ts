/**
 * Sentiment (PRD 4.3, 7.5).
 *
 * VADER's lexicon, compiled to a flat string at build time and parsed once on
 * first use. Shipped client-side: sentiment must never be a network call, for
 * the same reason the colour table is not one -- a piece has to be paintable
 * with the tab offline and it must never fail.
 *
 * Emoticon entries are dropped. This lexicon only ever sees speech
 * transcripts, which do not contain ":-)".
 *
 * Valence is VADER's. Arousal is not: VADER does not model it. Arousal here is
 * lexical intensity (booster words, superlatives, magnitude of valence)
 * blended with the audio's own energy by the caller, which is the honest way
 * to get it -- how loudly and how fast someone said a thing carries more
 * arousal information than which words they chose.
 */


let table: Map<string, number> | null = null;
let inflight: Promise<void> | null = null;

/**
 * Load the lexicon. Called alongside the colour table when the user taps
 * record -- never on page load.
 */
export async function loadSentiment(): Promise<void> {
  if (table) return;
  if (!inflight) {
    inflight = import("./vader-data").then(({ PACKED }) => {
      const m = new Map<string, number>();
      for (const pair of PACKED.split(",")) {
        const i = pair.lastIndexOf(":");
        m.set(pair.slice(0, i), Number(pair.slice(i + 1)) / 10);
      }
      table = m;
    });
  }
  await inflight;
}

export const sentimentReady = () => table !== null;

/** Intensifiers. VADER applies these as multipliers on the following token. */
const BOOSTERS: Record<string, number> = {
  absolutely: 0.293, amazingly: 0.293, completely: 0.293, deeply: 0.293,
  enormously: 0.293, entirely: 0.293, especially: 0.293, extremely: 0.293,
  exceptionally: 0.293, incredibly: 0.293, intensely: 0.293, particularly: 0.293,
  purely: 0.293, quite: 0.293, really: 0.293, remarkably: 0.293, so: 0.293,
  substantially: 0.293, thoroughly: 0.293, totally: 0.293, tremendously: 0.293,
  unbelievably: 0.293, utterly: 0.293, very: 0.293, super: 0.293,
  almost: -0.293, barely: -0.293, hardly: -0.293, kinda: -0.293, kind: -0.293,
  less: -0.293, little: -0.293, marginally: -0.293, occasionally: -0.293,
  partly: -0.293, scarcely: -0.293, slightly: -0.293, somewhat: -0.293, sort: -0.293,
};

const NEGATIONS = new Set([
  "not", "no", "never", "none", "nobody", "nothing", "neither", "nowhere",
  "cannot", "cant", "wont", "didnt", "doesnt", "isnt", "wasnt", "arent",
  "werent", "havent", "hasnt", "hadnt", "wouldnt", "couldnt", "shouldnt",
  "aint", "without", "rarely", "seldom", "hardly",
]);

export interface Sentiment {
  /** -1 (negative) .. 1 (positive) */
  valence: number;
  /** 0 (flat) .. 1 (charged) -- lexical component only */
  arousal: number;
  /** how much of the text carried any sentiment at all */
  coverage: number;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z'\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && w.length < 24);
}

export function analyseSentiment(words: string[]): Sentiment {
  // Neutral until the table has loaded. The structural layer carries the piece
  // on its own in that window, which is the same silent degradation Firefox
  // gets from having no Web Speech API (PRD 7.6).
  const lex = table;
  if (!lex) return { valence: 0, arousal: 0, coverage: 0 };
  let sum = 0;
  let hits = 0;
  let intensity = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let v = lex.get(w);
    if (v === undefined) continue;

    // preceding booster
    let scale = 1;
    for (let k = 1; k <= 2 && i - k >= 0; k++) {
      const b = BOOSTERS[words[i - k]];
      if (b !== undefined) {
        scale += b * (k === 1 ? 1 : 0.75);
        intensity += Math.abs(b);
      }
    }
    v *= scale;

    // negation flips within a 3-token window, VADER's rule
    for (let k = 1; k <= 3 && i - k >= 0; k++) {
      if (NEGATIONS.has(words[i - k].replace(/'/g, ""))) { v *= -0.74; break; }
    }

    sum += v;
    intensity += Math.min(1, Math.abs(v) / 3);
    hits++;
  }

  if (hits === 0) return { valence: 0, arousal: 0, coverage: 0 };

  // VADER's normalisation: x / sqrt(x^2 + 15). Compresses long texts sensibly.
  const valence = sum / Math.sqrt(sum * sum + 15);
  const arousal = Math.min(1, intensity / Math.max(3, hits));
  return { valence, arousal, coverage: hits / Math.max(1, words.length) };
}

/**
 * Time of day for the title and the palette (PRD 5 "Titles").
 * Positive and calm reads as evening light; negative and tense as overcast.
 */
export function lightFrom(valence: number, arousal: number, brightness: number):
  "morning" | "midday" | "evening" | "overcast" {
  if (valence < -0.15 && brightness < 0.5) return "overcast";
  if (valence > 0.1 && arousal > 0.55) return "midday";
  if (brightness > 0.62) return "morning";
  return "evening";
}
