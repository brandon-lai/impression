/**
 * Unit tests for the pure layers.
 *
 * These cover the PRD's acceptance criteria that can be decided without a
 * browser: determinism of the event stream, the palette rules, the stroke
 * budget, subject selection, sentiment, and moderation. Pixel-level
 * determinism needs a real canvas and is covered by tests/render.test.mjs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as L from "./.build/lib.mjs";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

// The colour table is a committed artifact, so the tests read it off disk
// rather than exercising the out-of-vocabulary hash and calling it a pass.
const raw = gunzipSync(readFileSync("public/lexicon.bin"));
L.installLexicon(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
// The sentiment table is lazily imported in the browser; load it up front here
// so the tests exercise it rather than the neutral fallback.
await L.loadSentiment();

const speakers = L.SPEAKERS;

function piece(profileIndex = 1, seed = 7, subject = "water") {
  const a = L.synthAnalysis(speakers[profileIndex], seed);
  const w = L.synthWords(L.SAMPLE_WORDS[subject], a, seed);
  return { a, w, p: L.buildPiece(a, w) };
}

/* ------------------------------------------------------- determinism ---- */

test("the same analysis composes to a byte-identical event stream (PRD 4.7)", () => {
  const { a, w } = piece();
  const one = JSON.stringify(L.buildPiece(a, w).events);
  const two = JSON.stringify(L.buildPiece(a, w).events);
  assert.equal(one, two);
});

test("the seed is a function of the features, not of a clock", () => {
  const a1 = L.synthAnalysis(speakers[2], 99);
  const a2 = L.synthAnalysis(speakers[2], 99);
  assert.equal(L.seedFor(a1), L.seedFor(a2));
  assert.notEqual(L.seedFor(a1), L.seedFor(L.synthAnalysis(speakers[2], 100)));
});

test("the opening seed is stable and available from the first breath group", () => {
  const a = L.synthAnalysis(speakers[0], 3);
  const opening = L.openingSeed(a);
  // Truncating the clip must not change the seed the live pass already chose.
  const truncated = { ...a, groups: a.groups.slice(0, 1) };
  assert.equal(L.openingSeed(truncated), opening);
});

test("no module in the render path reaches for ambient state", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  // fit.ts is deliberately excluded: it is the boundary that reads
  // devicePixelRatio once and hands it to the renderer as an argument. That it
  // is the *only* such place is asserted below.
  const dirs = ["src/lib/render", "src/lib/audio/compose.ts", "src/lib/prng.ts", "src/lib/color.ts"];
  const files = [];
  for (const d of dirs) {
    if (fs.statSync(d).isDirectory()) {
      for (const f of fs.readdirSync(d)) if (f.endsWith(".ts")) files.push(path.join(d, f));
    } else files.push(d);
  }
  const boundary = files.filter((f) => f.endsWith("fit.ts"));
  assert.equal(boundary.length, 1, "the pixel-ratio boundary moved");
  for (const f of files.filter((f) => !f.endsWith("fit.ts"))) {
    const src = fs.readFileSync(f, "utf8");
    // Comments legitimately name these; code must not call them.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/Math\.random\s*\(/.test(code), `${f} calls Math.random`);
    assert.ok(!/Date\.now\s*\(/.test(code), `${f} calls Date.now`);
    assert.ok(!/devicePixelRatio/.test(code), `${f} reads devicePixelRatio`);
  }
});

/* ------------------------------------------------------------ palette --- */

test("every piece spans the required lightness band (PRD 4.4)", () => {
  for (let s = 0; s < 25; s++) {
    for (let i = 0; i < speakers.length; i++) {
      const { p } = piece(i, s);
      const [lo, hi] = p.lightnessRange;
      assert.ok(lo >= L.L_MIN - 1e-6, `seed ${s} speaker ${i}: floor ${lo}`);
      assert.ok(hi <= L.L_MAX + 1e-6, `seed ${s} speaker ${i}: ceiling ${hi}`);
      for (const e of p.events) {
        if (e.type !== "stroke") continue;
        assert.ok(e.lightness >= L.L_MIN - 1e-6 && e.lightness <= L.L_MAX + 1e-6);
      }
    }
  }
});

test("no stroke is black or near-black, and darks turn blue-violet (PRD 4.4)", () => {
  for (let s = 0; s < 12; s++) {
    const { p } = piece(4, s, "street"); // the darkest subject
    for (const e of p.events) {
      if (e.type !== "stroke") continue;
      const fixed = L.noBlack(e.lightness, e.chroma, e.hue);
      assert.ok(fixed.l >= 0.3, "lightness floor");
      const [r, g, b] = L.gamutFit(fixed.l, fixed.c, fixed.h);
      assert.ok(Math.max(r, g, b) > 0.18, "not black");
      if (e.lightness < 0.42) {
        // pulled toward the shadow hue rather than left on the grey axis
        assert.ok(fixed.c >= 0.05, "shadows keep chroma");
      }
    }
  }
});

test("gamut fitting preserves hue instead of clipping channels", () => {
  // A chroma far outside sRGB at this lightness.
  const [r, g, b] = L.gamutFit(0.6, 0.4, 140);
  assert.ok(r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1);
  assert.ok(g > r && g > b, "a green stays green");
});

/* ------------------------------------------------------ stroke budget --- */

test("stroke counts stay inside the hard cap and marks stay countable (PRD 13)", () => {
  for (let s = 0; s < 30; s++) {
    for (let i = 0; i < speakers.length; i++) {
      const { p } = piece(i, s);
      assert.ok(p.strokeCount > 0);
      assert.ok(p.strokeCount <= L.STROKE_HARD_CAP, `${p.strokeCount} strokes`);
    }
  }
});

test("a full-length clip lands in the 80-200 target band", () => {
  let inBand = 0, total = 0;
  for (let s = 0; s < 30; s++) {
    for (let i = 0; i < speakers.length; i++) {
      const { p } = piece(i, s);
      total++;
      if (p.strokeCount >= L.STROKE_MIN && p.strokeCount <= L.STROKE_MAX) inBand++;
    }
  }
  // Sparse speakers legitimately fall under the floor -- a hesitant voice is
  // *supposed* to leave open canvas -- so this asserts the bulk, not all.
  assert.ok(inBand / total > 0.7, `only ${inBand}/${total} in band`);
});

/* -------------------------------------------------- the Phase 1 gate ---- */

test("five different voices produce five different paintings (PRD 14)", () => {
  const streams = speakers.map((_, i) => piece(i, 11).p);
  const seen = new Set(streams.map((p) => JSON.stringify(p.events)));
  assert.equal(seen.size, speakers.length, "two speakers produced the same piece");

  // The claim is not merely "not byte-identical" -- it is that they look
  // different. Stroke direction variance is the feature PRD 4.2 says carries
  // that, so monotone and expressive must differ measurably in it.
  const angleSpread = (p) => {
    const a = p.events.filter((e) => e.type === "stroke").map((e) => e.angle);
    const mean = a.reduce((x, y) => x + y, 0) / a.length;
    return Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / a.length);
  };
  const monotone = angleSpread(streams[0]);
  const expressive = angleSpread(streams[1]);
  assert.ok(expressive > monotone * 1.5,
    `expressive ${expressive.toFixed(2)} vs monotone ${monotone.toFixed(2)}`);
});

/* --------------------------------------------------------- normalise ---- */

test("normalisation expands mid-range values toward the extremes (PRD 4.5)", () => {
  const vals = [10, 11, 12, 13, 14]; // a very even speaker
  const n = L.normalise(vals);
  const out = vals.map(n);
  assert.ok(Math.max(...out) - Math.min(...out) > 0.85,
    `spread only ${(Math.max(...out) - Math.min(...out)).toFixed(2)}`);
});

test("a perfectly flat feature does not divide by zero", () => {
  const n = L.normalise([5, 5, 5, 5]);
  assert.equal(n(5), 0.5);
  assert.ok(Number.isFinite(n(9)));
});

/* --------------------------------------------------- subject selection -- */

test("each subject is selected by the conditions the PRD gives it", () => {
  const cases = {
    water:    { valence: 0.7, arousal: 0.15, rate: 0.25, contentDensity: 0.5, pauseRatio: 0.3, brightness: 0.4 },
    garden:   { valence: 0.9, arousal: 0.85, rate: 0.7, contentDensity: 0.7, pauseRatio: 0.15, brightness: 0.65 },
    field:    { valence: 0.8, arousal: 0.2, rate: 0.12, contentDensity: 0.45, pauseRatio: 0.35, brightness: 0.5 },
    sky:      { valence: 0.5, arousal: 0.2, rate: 0.15, contentDensity: 0.05, pauseRatio: 0.8, brightness: 0.55 },
    street:   { valence: 0.12, arousal: 0.8, rate: 0.9, contentDensity: 0.8, pauseRatio: 0.1, brightness: 0.72 },
    interior: { valence: 0.2, arousal: 0.18, rate: 0.35, contentDensity: 0.6, pauseRatio: 0.28, brightness: 0.15 },
  };
  for (const [want, f] of Object.entries(cases)) {
    const sel = L.selectSubject(f);
    assert.equal(sel.subject, want, `expected ${want}, got ${sel.subject} (runner-up ${sel.runnerUp})`);
    assert.notEqual(sel.runnerUp, sel.subject);
  }
});

test("subject selection is pure", () => {
  const f = { valence: 0.5, arousal: 0.5, rate: 0.5, contentDensity: 0.5, pauseRatio: 0.5, brightness: 0.5 };
  assert.deepEqual(L.selectSubject(f), L.selectSubject(f));
});

/* -------------------------------------------------------- sentiment ----- */

test("sentiment handles negation and boosters", async () => {
  await L.loadSentiment();
  const t = (s) => L.analyseSentiment(L.tokenize(s)).valence;
  assert.ok(t("this is good") > 0.2);
  assert.ok(t("this is not good") < 0);
  assert.ok(t("this is very good") > t("this is good"));
  assert.equal(L.analyseSentiment(L.tokenize("the of and")).coverage, 0);
});

test("titles follow Monet's subject, light, duration format (PRD 5)", () => {
  assert.equal(L.makeTitle("garden", "evening", 24000), "Garden, evening, 24 seconds");
  assert.equal(L.makeTitle("water", "morning", 1000), "Water, morning, 1 second");
});

/* -------------------------------------------------------- moderation ---- */

test("moderation rejects slurs, holds profanity, and passes ordinary speech", () => {
  assert.equal(L.moderate("the kitchen was warm and quiet"), "approved");
  assert.equal(L.moderate(null), "approved");
  assert.equal(L.moderate("what the fuck was that"), "pending");
  assert.equal(L.moderate("you are a retard"), "rejected");
  // spacing must not walk a slur through the filter
  assert.equal(L.moderate("r e t a r d"), "rejected");
});

/* ----------------------------------------------------------- prompts ---- */

test("the daily prompt is a pure function of the date", () => {
  assert.deepEqual(L.promptFor("2026-09-09"), L.promptFor("2026-09-09"));
  const week = new Set();
  for (let d = 1; d <= 14; d++) week.add(L.promptFor(`2026-09-${String(d).padStart(2, "0")}`).id);
  assert.ok(week.size > 2, "the rotation is stuck");
});

/* --------------------------------------------------- feature functions -- */

test("RMS, centroid and pitch behave on a synthetic tone", () => {
  const sr = 48000, n = 2048;
  const frame = new Float32Array(n);
  for (let i = 0; i < n; i++) frame[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr);

  assert.ok(Math.abs(L.rms(frame) - 0.5 / Math.SQRT2) < 0.02);

  const { f0 } = L.detectPitch(L.decimate(frame, 8), sr / 8, 0.5);
  assert.ok(Math.abs(f0 - 220) < 6, `detected ${f0}Hz`);

  const mag = new Float32Array(n >> 1);
  L.magnitudeSpectrum(frame, L.hann(n), mag);
  const c = L.spectralCentroid(mag, sr);
  assert.ok(c > 150 && c < 400, `centroid ${c}Hz`);
});

test("silence yields no pitch", () => {
  const { f0 } = L.detectPitch(new Float32Array(256), 6000);
  assert.equal(f0, 0);
});

test("the one-euro filter tracks a step without ringing", () => {
  const f = new L.OneEuro(1.0, 0.7, 1.0);
  let v = 0;
  for (let i = 0; i < 40; i++) v = f.filter(i < 20 ? 0 : 10, i * 0.05);
  assert.ok(v > 8 && v <= 10.001, `settled at ${v}`);
});

/* ------------------------------------------------------------ colour ---- */

test("the colour table is loaded and semantically coherent", () => {
  assert.ok(L.lexiconReady(), "artifact did not load");
  const water = L.clusterHue(["ocean", "sea", "river", "wave"]);
  assert.ok(water.agreement > 0.5, `related words disagree (${water.agreement.toFixed(2)})`);
  // Averaging hue arithmetically turns two reds into a green; the circular
  // mean must not.
  assert.ok(water.hue >= 0 && water.hue < 360);
});

test("unrelated semantic fields get separated hues", () => {
  const dist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const water = L.clusterHue(["ocean", "sea", "river"]).hue;
  const plant = L.clusterHue(["garden", "flower", "tree"]).hue;
  const room = L.clusterHue(["kitchen", "chair", "lamp"]).hue;
  // This is the property the relevance-filtered vocabulary exists to provide.
  // On the naive "most common 25k words" build these landed within 5 degrees.
  assert.ok(dist(water, plant) > 20, `water/plant only ${dist(water, plant).toFixed(0)} deg apart`);
  assert.ok(dist(plant, room) > 20, `plant/room only ${dist(plant, room).toFixed(0)} deg apart`);
});

test("out-of-vocabulary words still get a deterministic colour", () => {
  const a = L.colorFor("zzqxwv");
  const b = L.colorFor("zzqxwv");
  assert.deepEqual(a, b);
  assert.ok(a.chroma > 0, "never falls back to grey");
});
