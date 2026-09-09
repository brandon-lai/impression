"use client";

/**
 * Phase 0: the renderer harness (PRD 14).
 *
 * A standalone page that feeds synthetic PaintEvent streams into the renderer
 * with adjustable parameters. No audio, no backend. This is where brush
 * texture, stamp behaviour, broken-colour placement, value range, edge bands
 * and all six subjects get tuned.
 *
 * It also answers the Phase 1 gate on demand: "five speakers" renders the same
 * script spoken by five different speaker profiles side by side. If those five
 * are not visibly different from one another, the core claim has failed and no
 * amount of downstream polish repairs it.
 */

import { useEffect, useMemo, useState } from "react";
import { Painting } from "@/components/Painting";
import { SPEAKERS, SAMPLE_WORDS, synthAnalysis, synthWords } from "@/lib/synth";
import { buildPiece, Piece } from "@/lib/pipeline";
import { compose } from "@/lib/audio/compose";
import { SUBJECTS } from "@/lib/render/subjects";
import { SubjectId } from "@/lib/events";
import { loadLexicon } from "@/lib/semantics/lexicon";
import type { Analysis } from "@/lib/audio/analyzer";
import type { TimedWord } from "@/lib/audio/compose";

/** Compose with the subject pinned, so one subject can be tuned at a time
 *  without fighting the selection function. */
function withSubject(a: Analysis, w: TimedWord[], s: SubjectId): Piece {
  const base = buildPiece(a, w);
  if (base.subject === s) return base;
  const selection = { ...base.selection, subject: s };
  const r = compose({ analysis: a, words: w, sentiment: base.sentiment, selection, seed: base.seed });
  return {
    ...base, subject: s, selection,
    events: r.events, strokeCount: r.strokeCount, lightnessRange: r.lightnessRange,
  };
}

export default function Harness() {
  const [seed, setSeed] = useState(7);
  const [speaker, setSpeaker] = useState(1);
  const [subject, setSubject] = useState<SubjectId>("garden");
  const [mode, setMode] = useState<"single" | "grid" | "subjects">("single");
  const [lex, setLex] = useState(0);
  const [forming, setForming] = useState(false);

  // Query-string state is applied after mount, not in the initial state.
  // Reading window.location during render makes the server and client disagree
  // and React throws a hydration error -- which it did.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("seed")) setSeed(+p.get("seed")!);
    if (p.get("speaker")) setSpeaker(+p.get("speaker")!);
    if (p.get("subject")) setSubject(p.get("subject") as SubjectId);
    if (p.get("view")) setMode(p.get("view") as "single" | "grid" | "subjects");
  }, []);

  // Load the colour table on mount. Without it every word falls through to the
  // out-of-vocabulary hash, which scatters hues at random and makes the harness
  // a test of the wrong thing entirely -- the first renders came out looking
  // like confetti for exactly this reason.
  useEffect(() => { loadLexicon().then(() => setLex((v) => v + 1)).catch(() => {}); }, []);

  const single = useMemo(() => {
    const a = synthAnalysis(SPEAKERS[speaker], seed);
    return withSubject(a, synthWords(SAMPLE_WORDS[subject], a, seed), subject);
  }, [seed, speaker, subject, lex]);

  const grid = useMemo(
    () => SPEAKERS.map((sp) => {
      const a = synthAnalysis(sp, seed);
      return { name: sp.name, piece: withSubject(a, synthWords(SAMPLE_WORDS[subject], a, seed), subject) };
    }),
    [seed, subject, lex],
  );

  const subjects = useMemo(
    () => (Object.keys(SUBJECTS) as SubjectId[]).map((s) => {
      const a = synthAnalysis(SPEAKERS[speaker], seed);
      return { name: s, piece: withSubject(a, synthWords(SAMPLE_WORDS[s], a, seed), s) };
    }),
    [seed, speaker, lex],
  );

  const cells = mode === "grid" ? grid : subjects;

  return (
    <main style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <h1 className="title" style={{ marginBottom: 4 }}>Renderer harness</h1>
      <p className="meta" style={{ marginTop: 0 }}>Phase 0. Synthetic streams, no audio, no backend.</p>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", margin: "18px 0 24px" }}>
        <label className="meta">seed{" "}
          <input type="number" value={seed} onChange={(e) => setSeed(+e.target.value)} style={{ width: 70 }} />
        </label>
        <label className="meta">speaker{" "}
          <select value={speaker} onChange={(e) => setSpeaker(+e.target.value)}>
            {SPEAKERS.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
          </select>
        </label>
        <label className="meta">subject{" "}
          <select value={subject} onChange={(e) => setSubject(e.target.value as SubjectId)}>
            {Object.keys(SUBJECTS).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="meta">view{" "}
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="single">single</option>
            <option value="grid">five speakers</option>
            <option value="subjects">six subjects</option>
          </select>
        </label>
        <label className="meta">
          <input type="checkbox" checked={forming} onChange={(e) => setForming(e.target.checked)} /> animate
        </label>
        <button
          style={{ border: "1px solid var(--rule)", padding: "4px 10px", borderRadius: 3, fontSize: "0.9rem", color: "var(--muted)" }}
          onClick={async () => { await loadLexicon(); setLex((v) => v + 1); }}
        >
          load colour table
        </button>
        <span className="meta" id="stats">
          {single.strokeCount} strokes · L {single.lightnessRange[0].toFixed(2)}–{single.lightnessRange[1].toFixed(2)}
        </span>
      </div>

      {mode === "single" ? (
        <figure style={{ margin: 0, maxWidth: 900 }}>
          <div className="canvas-wrap">
            <Painting
              key={`${seed}-${speaker}-${subject}-${forming}-${lex}`}
              events={single.events} seed={single.seed}
              forming={forming} final={!forming} speed={4}
            />
          </div>
          <figcaption style={{ marginTop: 14 }}>
            <p className="title" style={{ fontSize: "1.4rem", margin: 0 }}>{single.title}</p>
            <p className="meta" style={{ margin: "4px 0 0" }}>
              runner-up {single.runnerUp} · margin {single.selection.margin.toFixed(2)}
            </p>
          </figcaption>
        </figure>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 22 }}>
          {cells.map((x) => (
            <figure key={x.name} style={{ margin: 0 }} data-cell={x.name}>
              <div className="canvas-wrap">
                <Painting key={`${x.name}-${seed}-${lex}`} events={x.piece.events} seed={x.piece.seed} final />
              </div>
              <figcaption className="meta" style={{ marginTop: 8 }}>
                {x.name} · {x.piece.strokeCount} strokes
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </main>
  );
}
