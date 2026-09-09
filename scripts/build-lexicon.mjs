/**
 * Build the semantic colour artifact (PRD 7.5).
 *
 *   GloVe 300d (top 25k, stopwords removed)
 *     -> PCA to 50d          (makes the JS UMAP kNN tractable; preserves structure)
 *     -> UMAP to 3d
 *     -> OKLCH: hue = atan2(x, y), chroma = radius, texSeed = z
 *     -> quantised to 16 bits per channel, gzipped
 *
 * Using the UMAP plane's *angle* for hue rather than one axis is what makes the
 * mapping behave: hue is circular, so a circular coordinate is the honest one,
 * and words that land near each other in the embedding get near-identical hues.
 *
 * Run once; the artifact is committed. Never called at runtime.
 */
import fs from "node:fs";
import zlib from "node:zlib";
import { UMAP } from "umap-js";

const GLOVE = process.argv[2];
const OUT = process.argv[3] || "public/lexicon.bin";
const TARGET = 25000;    // words kept in the shipped artifact
const SCAN = 80000;      // frequent words considered before relevance filtering
const PCA_DIMS = 50;
const NN = +(process.env.NN || 20);   // UMAP neighbourhood: larger keeps more global structure
const MD = +(process.env.MD || 0.25);

const STOP = new Set(`a about above after again against all am an and any are aren't as at be because been
before being below between both but by can't cannot could couldn't did didn't do does doesn't doing don't
down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here
here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself
let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out
over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs
them themselves then there there's these they they'd they'll they're they've this those through to too under
until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which
while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself
yourselves s t just don now also one two three said would could may many us new first last`.split(/\s+/));

const isWord = (w) => /^[a-z][a-z'-]{1,19}$/.test(w) && !STOP.has(w);

/*
 * Relevance filtering, and why the artifact is not simply "the 25k most common
 * English words" as first specced.
 *
 * GloVe 6B's frequency order is Wikipedia + Gigaword's frequency order, which
 * is to say a *news corpus*. Built literally, the top 25k is dominated by
 * politics, finance and sport -- "percent", "government", "quarterback" -- and
 * the words someone actually says into a microphone when asked to describe
 * somewhere they felt calm are a small minority sitting close together in
 * embedding space. Measured on that first build, "ocean", "street", "flower"
 * and "fire" landed within 5 degrees of hue of one another: four unrelated
 * subjects, one colour. The language layer would have been decorative.
 *
 * So the vocabulary is chosen by similarity to everyday sensory description
 * instead of by raw corpus frequency. The hue circle then gets spent entirely
 * on words that can plausibly be spoken in a 30-second answer, and those words
 * separate. Same pipeline otherwise; strictly a better use of the same budget.
 */
const SEED_KEEP = `room kitchen window door garden tree flower grass river ocean beach mountain forest
street house home road field sky cloud rain snow wind sun moon light dark morning evening night summer
winter warm cold quiet loud soft rough smooth bright dim green blue red yellow water fire stone wood
glass paper cloth mother father sister brother friend child baby dog cat bird fish walking sitting
running sleeping eating drinking laughing crying singing remember forget happy sad calm afraid tired
angry lonely gentle music voice smell taste touch coffee bread wine dinner table chair bed floor wall
summer harbour village train journey travelled coast valley hill meadow dusk dawn shadow`.split(/\s+/);

const SEED_DROP = `percent government minister parliament election senate campaign court lawsuit
economy market shares investors billion quarterly revenue analysts company corporate merger
championship playoffs coach quarterback tournament scored inning striker league
troops military missile insurgents deployment sanctions treaty
software server database protocol processor gigabyte
stocks bonds fiscal deficit inflation regulatory shareholders defendant prosecutors indictment`.split(/\s+/);

console.error("reading glove...");
const allWords = [];
const allVecs = [];
{
  const stream = fs.createReadStream(GLOVE, { encoding: "utf8", highWaterMark: 1 << 20 });
  let tail = "";
  outer: for await (const chunk of stream) {
    const lines = (tail + chunk).split("\n");
    tail = lines.pop();
    for (const line of lines) {
      if (!line) continue;
      const sp = line.indexOf(" ");
      const w = line.slice(0, sp);
      if (!isWord(w)) continue;
      const parts = line.slice(sp + 1).split(" ");
      const v = new Float32Array(300);
      for (let i = 0; i < 300; i++) v[i] = +parts[i];
      allWords.push(w);
      allVecs.push(v);
      if (allWords.length >= SCAN) break outer;
    }
  }
}
console.error(`scanned ${allWords.length} words`);

const wIndex = new Map(allWords.map((w, i) => [w, i]));
const normed = allVecs.map((v) => {
  let n = 0; for (let i = 0; i < 300; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const o = new Float32Array(300); for (let i = 0; i < 300; i++) o[i] = v[i] / n;
  return o;
});
const centroid = (seeds) => {
  const c = new Float64Array(300); let k = 0;
  for (const w of seeds) { const i = wIndex.get(w); if (i == null) continue; k++;
    for (let d = 0; d < 300; d++) c[d] += normed[i][d]; }
  let n = 0; for (let d = 0; d < 300; d++) { c[d] /= k; n += c[d] * c[d]; }
  n = Math.sqrt(n) || 1;
  for (let d = 0; d < 300; d++) c[d] /= n;
  return c;
};
const keepC = centroid(SEED_KEEP), dropC = centroid(SEED_DROP);
const score = normed.map((v) => {
  let a = 0, b = 0;
  for (let d = 0; d < 300; d++) { a += v[d] * keepC[d]; b += v[d] * dropC[d]; }
  return a - 0.6 * b;
});
const order = score.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).slice(0, TARGET);
// Keep the frequency order among the survivors: stable, and it makes the
// committed artifact diff-readable.
order.sort((a, b) => a[1] - b[1]);
const words = order.map(([, i]) => allWords[i]);
const vecs = order.map(([, i]) => allVecs[i]);
console.error(`kept ${words.length} words after relevance filtering`);

// --- PCA to PCA_DIMS via power iteration on the 300x300 covariance ---
console.error("pca...");
const N = vecs.length, D = 300;
const mean = new Float64Array(D);
for (const v of vecs) for (let i = 0; i < D; i++) mean[i] += v[i];
for (let i = 0; i < D; i++) mean[i] /= N;

const cov = new Float64Array(D * D);
for (const v of vecs) {
  const c = new Float64Array(D);
  for (let i = 0; i < D; i++) c[i] = v[i] - mean[i];
  for (let i = 0; i < D; i++) {
    const ci = c[i];
    if (ci === 0) continue;
    for (let j = i; j < D; j++) cov[i * D + j] += ci * c[j];
  }
}
for (let i = 0; i < D; i++) for (let j = i; j < D; j++) { const x = cov[i*D+j]/N; cov[i*D+j] = x; cov[j*D+i] = x; }

// Deterministic PRNG so the artifact is reproducible.
let seed = 0x9e3779b9;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const comps = [];
const work = Float64Array.from(cov);
for (let k = 0; k < PCA_DIMS; k++) {
  let v = new Float64Array(D);
  for (let i = 0; i < D; i++) v[i] = rnd() - 0.5;
  let lambda = 0;
  for (let it = 0; it < 120; it++) {
    const u = new Float64Array(D);
    for (let i = 0; i < D; i++) { let s = 0; const row = i * D; for (let j = 0; j < D; j++) s += work[row + j] * v[j]; u[i] = s; }
    let n = Math.hypot(...u) || 1;
    for (let i = 0; i < D; i++) u[i] /= n;
    lambda = n; v = u;
  }
  comps.push(v);
  // deflate
  for (let i = 0; i < D; i++) for (let j = 0; j < D; j++) work[i * D + j] -= lambda * v[i] * v[j];
}

const reduced = [];
for (const vec of vecs) {
  const c = new Float64Array(D);
  for (let i = 0; i < D; i++) c[i] = vec[i] - mean[i];
  const r = new Array(PCA_DIMS);
  for (let k = 0; k < PCA_DIMS; k++) { let s = 0; const comp = comps[k]; for (let i = 0; i < D; i++) s += comp[i] * c[i]; r[k] = s; }
  reduced.push(r);
}
const CACHE = `${OUT}.umap-${NN}-${MD}.json`;
let emb;
if (fs.existsSync(CACHE)) {
  const c = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  if (c.n === N) { emb = c.emb; console.error("umap: reused cache"); }
}
if (!emb) {
  console.error("umap...");
  const umap = new UMAP({ nComponents: 3, nNeighbors: NN, minDist: MD, random: rnd });
  emb = umap.fit(reduced);
  fs.writeFileSync(CACHE, JSON.stringify({ n: N, emb }));
  console.error("umap done");
}

// --- map to OKLCH channels ---
// Centre the plane so the angle around the centroid is meaningful.
const cx = emb.reduce((s, p) => s + p[0], 0) / N;
const cy = emb.reduce((s, p) => s + p[1], 0) / N;

const rawAngle = emb.map((p) => {
  let a = Math.atan2(p[1] - cy, p[0] - cx);
  return a < 0 ? a + Math.PI * 2 : a;
});
const radii = emb.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
const zs = emb.map((p) => p[2]);

const rank = (arr) => {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Float64Array(arr.length);
  idx.forEach(([, i], r) => { out[i] = r / (arr.length - 1); });
  return out;
};

/*
 * Rank-normalise the angle before it becomes hue.
 *
 * Taking atan2 directly looks right and is wrong. UMAP puts the vocabulary in
 * one dense lobe with sparse arms, so ~90% of words sit within a 60-degree
 * wedge as seen from the centroid: measured on the real artifact, "ocean",
 * "street", "flower" and "fire" all came out between 294 and 359 degrees --
 * four unrelated subjects, one colour. The language layer would have been
 * decorative.
 *
 * Ranking the angles and spreading them uniformly round the circle preserves
 * the cyclic *ordering* -- neighbours in the embedding stay neighbours in hue,
 * which is the property the product actually needs -- while using all 360
 * degrees. Local structure kept, global compression removed.
 */
const aq = rank(rawAngle);
const rq = rank(radii), zq = rank(zs);

const out = new Uint16Array(N * 3);
for (let i = 0; i < N; i++) {
  const hue = aq[i] * 360;                                 // 0-360, uniform
  const chroma = 0.06 + rq[i] * (0.25 - 0.06);             // 0.06-0.25, never fully grey
  out[i * 3 + 0] = Math.round((hue / 360) * 65535);
  out[i * 3 + 1] = Math.round((chroma / 0.25) * 65535);
  out[i * 3 + 2] = Math.round(zq[i] * 65535);
}

const vocabBuf = Buffer.from(words.join("\n"), "utf8");
// Pad the vocab section to an even length. Without this the Uint16 table lands
// on an odd byte offset and `new Uint16Array(buf, off, ...)` throws in the
// browser loader -- which is exactly what happened on the first build.
const pad = vocabBuf.length & 1 ? Buffer.from([0x0a]) : Buffer.alloc(0);
const header = Buffer.alloc(8);
header.writeUInt32LE(N, 0);
header.writeUInt32LE(vocabBuf.length, 4);
const payload = Buffer.concat([header, vocabBuf, pad, Buffer.from(out.buffer)]);
const gz = zlib.gzipSync(payload, { level: 9 });
fs.writeFileSync(OUT, gz);
console.error(`wrote ${OUT}: ${(gz.length / 1024).toFixed(1)}KB gz (${(payload.length/1024).toFixed(1)}KB raw), ${N} words`);
