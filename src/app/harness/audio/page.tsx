"use client";

/**
 * Audio-path integration check.
 *
 * Drives the real AudioWorklet with a synthesised voice-like source instead of
 * a microphone: a glide through speech f0 with an amplitude envelope and
 * silences, so the worklet, the framing, every feature function, pause
 * detection, breath grouping and the composer all run exactly as they do on a
 * recording.
 *
 * The microphone itself is the one thing this cannot cover -- and it is also
 * the one thing the PRD's Phase 1 gate covers with five real people, which no
 * automated check substitutes for.
 */

import { useEffect, useState } from "react";
import { FrameFeature, analyse } from "@/lib/audio/analyzer";
import { buildPiece } from "@/lib/pipeline";

interface Check { name: string; pass: boolean; detail: string }

const DURATION_S = 6;

export default function AudioHarness() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [note, setNote] = useState("running…");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const out: Check[] = [];
      let ctx: AudioContext | null = null;
      try {
        ctx = new AudioContext();
        await ctx.resume();
        out.push({ name: "audio context starts", pass: ctx.state === "running", detail: `${ctx.state} @ ${ctx.sampleRate}Hz` });

        await ctx.audioWorklet.addModule("/worklet/features.worklet.js");
        out.push({ name: "worklet module loads", pass: true, detail: "/worklet/features.worklet.js" });

        const node = new AudioWorkletNode(ctx, "feature-processor");
        const frames: FrameFeature[] = [];
        node.port.onmessage = (e) => frames.push(e.data as FrameFeature);

        // A voice-like source: pitch glides through the speech range, amplitude
        // rises and falls in phrases, and there are real silences between them.
        const osc = ctx.createOscillator();
        osc.type = "sawtooth"; // harmonics, so the spectral features have something to measure
        const gain = ctx.createGain();
        const t0 = ctx.currentTime + 0.05;

        osc.frequency.setValueAtTime(140, t0);
        gain.gain.setValueAtTime(0.0001, t0);
        for (let phrase = 0; phrase < 4; phrase++) {
          const a = t0 + phrase * 1.5;
          osc.frequency.linearRampToValueAtTime(120 + phrase * 40, a + 0.4);
          osc.frequency.linearRampToValueAtTime(190 - phrase * 20, a + 0.9);
          gain.gain.linearRampToValueAtTime(0.25, a + 0.1);
          gain.gain.linearRampToValueAtTime(0.18, a + 0.8);
          gain.gain.linearRampToValueAtTime(0.0001, a + 1.0); // the pause
        }
        osc.connect(gain);
        gain.connect(node);
        // The worklet emits no audio; nothing is connected to the destination,
        // so this test is silent.
        osc.start(t0);
        osc.stop(t0 + DURATION_S);

        await new Promise((r) => setTimeout(r, DURATION_S * 1000 + 400));
        if (cancelled) return;

        out.push({
          name: "worklet emits features at ~20Hz",
          pass: frames.length > DURATION_S * 12 && frames.length < DURATION_S * 30,
          detail: `${frames.length} frames over ${DURATION_S}s`,
        });

        const voiced = frames.filter((f) => f.f0 > 0);
        out.push({
          name: "pitch is detected in the speech range",
          pass: voiced.length > frames.length * 0.25 &&
                voiced.every((f) => f.f0 >= 55 && f.f0 <= 900),
          detail: voiced.length
            ? `${voiced.length} voiced, ${Math.round(Math.min(...voiced.map((f) => f.f0)))}-${Math.round(Math.max(...voiced.map((f) => f.f0)))}Hz`
            : "no voiced frames",
        });

        const loud = frames.filter((f) => f.rmsDb > -45).length;
        out.push({
          name: "loudness varies across the clip",
          pass: loud > 0 && loud < frames.length,
          detail: `${loud} of ${frames.length} frames above -45dB`,
        });

        out.push({
          name: "spectral centroid is measured",
          pass: frames.some((f) => f.centroid > 100),
          detail: `max ${Math.round(Math.max(...frames.map((f) => f.centroid)))}Hz`,
        });

        // Now the analysis path, on real extracted frames rather than synthetic ones.
        const floorFrames = [...frames].sort((a, b) => a.rmsDb - b.rmsDb);
        const floor = floorFrames[Math.floor(floorFrames.length * 0.2)]?.rmsDb ?? -55;
        const a = analyse(frames, floor);

        out.push({
          name: "breath groups are found",
          pass: a.groups.length >= 2,
          detail: `${a.groups.length} groups, ${a.pauses.length} pauses (${a.pauses.filter((p) => p.major).length} major)`,
        });
        out.push({
          name: "a pitch contour is produced",
          pass: a.contour.length > 0 && a.contour.some((v) => v !== a.contour[0]),
          detail: `${a.contour.length} points`,
        });

        const piece = buildPiece(a, []);
        out.push({
          name: "a painting composes from real extracted audio",
          pass: piece.strokeCount > 0,
          detail: `${piece.strokeCount} strokes, subject ${piece.subject}, "${piece.title}"`,
        });
        out.push({
          name: "the lightness band holds on real audio",
          pass: piece.lightnessRange[0] >= 0.349 && piece.lightnessRange[1] <= 0.921,
          detail: `L ${piece.lightnessRange[0].toFixed(2)}-${piece.lightnessRange[1].toFixed(2)}`,
        });
      } catch (e) {
        out.push({ name: "audio path threw", pass: false, detail: String(e) });
      } finally {
        void ctx?.close();
      }

      if (!cancelled) {
        setChecks(out);
        setNote(`${out.filter((c) => c.pass).length}/${out.length} passed`);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const allPass = checks ? checks.every((c) => c.pass) : false;

  return (
    <main style={{ padding: 24, maxWidth: 820, margin: "0 auto" }}>
      <h1 className="title">Audio path</h1>
      <p className="meta" id="summary" data-pass={checks ? String(allPass) : "running"}>{note}</p>
      <ul style={{ paddingLeft: 18, lineHeight: 1.9 }}>
        {checks?.map((c) => (
          <li key={c.name} className="meta" data-result={c.pass ? "pass" : "fail"}>
            {c.pass ? "pass" : "FAIL"} — {c.name} <span style={{ opacity: 0.7 }}>({c.detail})</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
