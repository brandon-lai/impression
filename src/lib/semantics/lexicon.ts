/**
 * The semantic colour table (PRD 7.5).
 *
 * 25,000 words -> [hue, chroma, textureSeed], precomputed offline from GloVe
 * 300d via PCA -> UMAP -> OKLCH and committed as a 240KB gzipped artifact.
 * Zero API calls, ever, at any point in the product. Lazy-loaded when the user
 * taps record, never on page load, so it stays out of the landing budget.
 *
 * Out-of-vocabulary words hash deterministically into the same space rather
 * than falling back to grey: a made-up word or a proper noun still has to
 * produce a colour, and the same one every time.
 */

export interface WordColor {
  hue: number;      // 0-360
  chroma: number;   // 0-0.25
  texSeed: number;  // 0-1
}

interface Table {
  index: Map<string, number>;
  data: Uint16Array;
}

let table: Table | null = null;
let inflight: Promise<Table> | null = null;

function parse(buf: ArrayBuffer): Table {
  const view = new DataView(buf);
  const count = view.getUint32(0, true);
  const vocabLen = view.getUint32(4, true);
  const vocab = new TextDecoder().decode(new Uint8Array(buf, 8, vocabLen)).split("\n");
  // The vocab section is padded to an even length by the build script; without
  // that, this Uint16Array constructor throws on an odd byte offset.
  const off = 8 + vocabLen + (vocabLen & 1);
  const data = new Uint16Array(buf, off, count * 3);
  const index = new Map<string, number>();
  for (let i = 0; i < vocab.length; i++) index.set(vocab[i], i);
  return { index, data };
}

/**
 * Install an already-inflated artifact.
 *
 * Exists so the table can be loaded off disk in tests and off a worker message
 * on the upload path, without either having to invent a fetch.
 */
export function installLexicon(buf: ArrayBuffer): void {
  table = parse(buf);
}

export async function loadLexicon(url = "/lexicon.bin"): Promise<void> {
  if (table || inflight) { await inflight; return; }
  inflight = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`lexicon ${res.status}`);
    // The artifact is gzipped in the repo, so it must be inflated here rather
    // than relying on Content-Encoding, which a static host may or may not add.
    const stream = res.body!.pipeThrough(new DecompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    table = parse(buf);
    return table;
  })();
  try {
    await inflight;
  } finally {
    inflight = null;
  }
}

export const lexiconReady = () => table !== null;

function hashWord(w: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * Colour for a word. Never fails, never returns null, never calls anything.
 * Falls back to a deterministic hash for out-of-vocabulary words, at reduced
 * chroma so that a piece full of proper nouns does not out-shout a piece full
 * of real description.
 */
export function colorFor(word: string): WordColor {
  const w = word.toLowerCase();
  if (table) {
    const i = table.index.get(w);
    if (i !== undefined) {
      const d = table.data;
      return {
        hue: (d[i * 3] / 65535) * 360,
        chroma: (d[i * 3 + 1] / 65535) * 0.25,
        texSeed: d[i * 3 + 2] / 65535,
      };
    }
  }
  const h = hashWord(w);
  return {
    hue: (h % 360000) / 1000,
    chroma: 0.07 + ((h >>> 9) % 1000) / 1000 * 0.08,
    texSeed: ((h >>> 19) % 1000) / 1000,
  };
}

/**
 * Circular mean hue of a set of words, weighted by chroma.
 *
 * Averaging hue arithmetically is the classic bug here -- 350 and 10 average
 * to 180, a green from two reds. Vector-summing on the colour circle is the
 * only correct way, and the resultant length doubles as a usable measure of
 * how tightly the words agree.
 */
export function clusterHue(words: string[]): { hue: number; chroma: number; agreement: number } {
  if (words.length === 0) return { hue: 210, chroma: 0.1, agreement: 0 };
  let x = 0, y = 0, cSum = 0;
  for (const w of words) {
    const c = colorFor(w);
    const r = (c.hue * Math.PI) / 180;
    x += Math.cos(r) * c.chroma;
    y += Math.sin(r) * c.chroma;
    cSum += c.chroma;
  }
  const mag = Math.hypot(x, y);
  let hue = (Math.atan2(y, x) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return {
    hue,
    chroma: cSum / words.length,
    agreement: cSum > 0 ? mag / cSum : 0,
  };
}
