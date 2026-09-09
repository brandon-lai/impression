"use client";

/**
 * The determinism check the PRD asks for in Phase 1: render the same event
 * stream twice and diff the output.
 *
 * It lives as a page rather than as a unit test because the thing being
 * asserted is *pixels*, and pixels need a real canvas. Purity is easy to
 * violate by accident -- a stray Date.now(), a devicePixelRatio read, an
 * unseeded Math.random deep in the brush code -- and none of those show up in
 * a type check or in a test of the event stream.
 *
 * Results are written into the DOM so a headless probe can read them.
 */

import { useEffect, useState } from "react";
import { Painter, LIVE_CONFIG, FINAL_CONFIG, drawOrder } from "@/lib/render/renderer";
import type { Ctx2D } from "@/lib/render/brush";
import { buildPiece } from "@/lib/pipeline";
import { SPEAKERS, SAMPLE_WORDS, synthAnalysis, synthWords } from "@/lib/synth";
import { PaintEvent } from "@/lib/events";

const W = 480, H = 360;

function renderToDataUrl(events: PaintEvent[], seed: number, final: boolean): string {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d") as Ctx2D;
  // pixelRatio is pinned to 1: the point is to compare renders, not displays.
  const cfg = final ? FINAL_CONFIG(W, H, 1) : LIVE_CONFIG(W, H, 1);
  const p = new Painter(ctx, cfg, seed);
  for (const i of drawOrder(events, cfg.liftLightLayer)) p.draw(events[i], i);
  p.finish();
  return c.toDataURL("image/png");
}

interface Result { name: string; pass: boolean; detail: string }

export default function Determinism() {
  const [results, setResults] = useState<Result[] | null>(null);

  useEffect(() => {
    const out: Result[] = [];

    for (let i = 0; i < SPEAKERS.length; i++) {
      const a = synthAnalysis(SPEAKERS[i], 100 + i);
      const p = buildPiece(a, synthWords(SAMPLE_WORDS.water, a, 100 + i));

      const one = renderToDataUrl(p.events, p.seed, false);
      const two = renderToDataUrl(p.events, p.seed, false);
      out.push({
        name: `live render is reproducible (${SPEAKERS[i].name})`,
        pass: one === two,
        detail: one === two ? `${one.length} bytes, identical` : "outputs differ",
      });

      const f1 = renderToDataUrl(p.events, p.seed, true);
      const f2 = renderToDataUrl(p.events, p.seed, true);
      out.push({
        name: `final pass is reproducible (${SPEAKERS[i].name})`,
        pass: f1 === f2,
        detail: f1 === f2 ? "identical" : "outputs differ",
      });

      // The final pass must differ from the live pass -- it lifts the light
      // layer and lays the canvas weave -- while remaining the same painting.
      out.push({
        name: `final differs from live (${SPEAKERS[i].name})`,
        pass: f1 !== one,
        detail: f1 !== one ? "differs, as intended" : "final pass did nothing",
      });

      // A different seed must produce a different painting, or the seed is
      // not actually reaching the renderer.
      const other = renderToDataUrl(p.events, (p.seed ^ 0x5f5f5f) >>> 0, false);
      out.push({
        name: `seed changes the render (${SPEAKERS[i].name})`,
        pass: other !== one,
        detail: other !== one ? "differs" : "seed is ignored",
      });
    }

    setResults(out);
  }, []);

  const passed = results?.filter((r) => r.pass).length ?? 0;
  const total = results?.length ?? 0;

  return (
    <main style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <h1 className="title">Determinism</h1>
      <p className="meta" id="summary" data-pass={results ? String(passed === total) : "running"}>
        {results ? `${passed}/${total} passed` : "running…"}
      </p>
      <ul style={{ paddingLeft: 18, lineHeight: 1.8 }}>
        {results?.map((r) => (
          <li key={r.name} className="meta" data-result={r.pass ? "pass" : "fail"}>
            {r.pass ? "pass" : "FAIL"} — {r.name} <span style={{ opacity: 0.7 }}>({r.detail})</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
