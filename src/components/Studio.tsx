"use client";

/**
 * The whole user flow (PRD 3): landing -> countdown -> recording -> result.
 *
 * The hard rule this component exists to honour: **no spinner after the audio
 * ends.** The live canvas is already a finished painting, so it is shown
 * instantly and the final composition pass renders behind it and cross-fades
 * in. Nothing about the wait is ever put on screen.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Painter, drawOrder } from "@/lib/render/renderer";
import { fitCanvas } from "@/lib/render/fit";
import { PaintEvent } from "@/lib/events";
import { FrameFeature, analyse } from "@/lib/audio/analyzer";
import { TimedWord } from "@/lib/audio/compose";
import { buildPiece, openingSeed, Piece } from "@/lib/pipeline";
import { MAX_MS, MIN_MS } from "@/lib/audio/recorder";
import type { Recorder as RecorderType } from "@/lib/audio/recorder";
import type { LiveSpeech as LiveSpeechType } from "@/lib/speech";
import { loadLexicon } from "@/lib/semantics/lexicon";
import { loadSentiment } from "@/lib/semantics/sentiment";
import { encodeShare } from "@/lib/share";
import { Prompt } from "@/lib/prompts";

type Phase = "idle" | "countdown" | "recording" | "result";

const EXPORT_W = 2048;

export function Studio({ prompt }: { prompt: Prompt }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const finalRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [piece, setPiece] = useState<Piece | null>(null);
  const [finalReady, setFinalReady] = useState(false);
  const [keepAudio, setKeepAudio] = useState(true);
  const [addToGallery, setAddToGallery] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rec = useRef<RecorderType | null>(null);
  const speech = useRef<LiveSpeechType | null>(null);
  const frames = useRef<FrameFeature[]>([]);
  const words = useRef<TimedWord[]>([]);
  const painter = useRef<Painter | null>(null);
  const drawnGroups = useRef(0);
  const liveSeed = useRef(0);
  const audioBlob = useRef<Blob | null>(null);
  const lastCompose = useRef(0);

  /* ------------------------------------------------------- seed piece ---- */
  // A painting is already forming when you land (PRD 3). It is generated, not
  // fetched: the landing page must not wait on a network round trip to show
  // the one thing that explains the product.
  useEffect(() => {
    if (phase !== "idle") return;
    let cancelled = false;
    let frame = 0;

    // Dynamically imported: the analyser, composer and speaker profiles exist
    // only to build this one piece, and they have no business in the landing
    // page's initial bundle (PRD 13).
    void import("@/lib/seed").then(({ makeSeedPiece }) => {
      if (cancelled) return;
      const c = canvasRef.current;
      if (!c) return;
      const p = makeSeedPiece();
      const { ctx, cfg } = fitCanvas(c, 4 / 3);
      const pt = new Painter(ctx, cfg, p.seed);
      const order = drawOrder(p.events, false);
      let i = 0;
      // Loops, muted (PRD 3). Faster than real time: the seed piece has to
      // explain the product before the visitor decides whether to stay.
      let t0 = performance.now();
      const tick = () => {
        if (cancelled) return;
        const now = (performance.now() - t0) * 4;
        while (i < order.length && p.events[order[i]].t <= now) { pt.draw(p.events[order[i]], order[i]); i++; }
        if (i >= order.length && now > p.durationMs + 2600) { i = 0; t0 = performance.now(); pt.begin(); }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });

    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [phase]);

  /* ------------------------------------------------------ live painting -- */
  const paintLive = useCallback(() => {
    // The floor calibrated during the countdown, not a constant. Pause
    // detection is measured against it, and pauses are what separate breath
    // groups -- so a hardcoded floor means a quiet room produces one
    // unbroken cluster and a loud one produces nothing but gaps.
    const a = analyse(frames.current, rec.current?.noiseFloor ?? -50);
    if (a.groups.length <= drawnGroups.current) return;

    if (!painter.current) {
      const c = canvasRef.current;
      if (!c) return;
      const { ctx, cfg } = fitCanvas(c, 4 / 3);
      liveSeed.current = openingSeed(a);
      painter.current = new Painter(ctx, cfg, liveSeed.current);
    }

    const p = buildPiece(a, words.current, liveSeed.current);
    const pt = painter.current;
    let idx = 0;
    for (const e of p.events) {
      const groupOf =
        e.type === "cluster" ? e.id : e.type === "stroke" ? e.clusterId : -1;
      // Ground and horizon are laid down once, with the first closed breath
      // group. Repainting them later would visibly wipe the canvas.
      if (groupOf < 0 && drawnGroups.current === 0) pt.draw(e, idx);
      else if (groupOf >= drawnGroups.current) pt.draw(e, idx);
      idx++;
    }
    drawnGroups.current = a.groups.length;
  }, []);

  /* ----------------------------------------------------------- record ---- */
  const start = useCallback(async () => {
    setError(null);
    setPiece(null);
    setFinalReady(false);
    setShareUrl(null);
    frames.current = [];
    words.current = [];
    painter.current = null;
    drawnGroups.current = 0;
    audioBlob.current = null;

    // The colour table and the sentiment lexicon are fetched now, not on page
    // load: together they are ~330KB against a 150KB landing budget (PRD 13),
    // and neither is read until someone has actually spoken.
    void loadLexicon().catch(() => {});
    void loadSentiment().catch(() => {});

    // Loaded on demand: nothing here is reachable until this button is tapped.
    const [{ Recorder }, { LiveSpeech }] = await Promise.all([
      import("@/lib/audio/recorder"),
      import("@/lib/speech"),
    ]);

    speech.current = new LiveSpeech((w) => { words.current = w; });

    const r = new Recorder({
      onCountdown: (n) => { setPhase("countdown"); setCount(n); },
      onStart: () => {
        setPhase("recording");
        speech.current?.start();
        const c = canvasRef.current;
        if (c) { const { ctx } = fitCanvas(c, 4 / 3); ctx.clearRect(0, 0, c.width, c.height); }
      },
      onFrame: (f) => {
        frames.current.push(f);
        const now = performance.now();
        // Recomposing on every frame would run the whole pipeline 20 times a
        // second and eat the render budget; a closed breath group is the only
        // thing that can add paint anyway.
        if (now - lastCompose.current > 260) { lastCompose.current = now; paintLive(); }
      },
      onTick: (ms) => setElapsed(ms),
      onStop: (res) => { audioBlob.current = res.blob; void finish(res.frames, res.noiseFloorDb, res.durationMs); },
      onError: (e) => { setError(e.message === "microphone denied" ? "Microphone access is needed to record." : e.message); setPhase("idle"); },
    });
    rec.current = r;
    await r.start();
  }, [paintLive]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => { void rec.current?.stop(); }, []);

  /* ------------------------------------------------------- final pass ---- */
  const finish = useCallback(async (fr: FrameFeature[], floor: number, durationMs: number) => {
    const live = speech.current?.stop() ?? [];
    words.current = live;
    const a = analyse(fr, floor);
    a.durationMs = durationMs || a.durationMs;

    // Show the finished live painting immediately. Everything below happens
    // behind it (PRD 3, hard rule).
    const provisional = buildPiece(a, live, liveSeed.current || openingSeed(a));
    setPiece(provisional);
    setPhase("result");

    // Real word timestamps, if transcription is configured. Without them the
    // colour layer cannot be aligned to the clusters, so the live transcript
    // stands in.
    let finalWords = live;
    if (audioBlob.current) {
      try {
        const fd = new FormData();
        fd.append("audio", audioBlob.current, "clip.webm");
        const res = await fetch("/api/transcribe", { method: "POST", body: fd });
        if (res.ok) {
          const j = (await res.json()) as { words: TimedWord[] };
          if (j.words?.length) finalWords = j.words;
        }
      } catch { /* keep the live transcript */ }
    }

    await Promise.all([loadLexicon().catch(() => {}), loadSentiment().catch(() => {})]);
    const final = buildPiece(a, finalWords, liveSeed.current || openingSeed(a));
    setPiece(final);

    const w = EXPORT_W;
    const h = Math.round(w * 3 / 4);
    const worker = new Worker(new URL("@/lib/render/final.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<{ bitmap: ImageBitmap }>) => {
      const c = finalRef.current;
      if (c) {
        c.width = w; c.height = h;
        c.getContext("2d")?.drawImage(ev.data.bitmap, 0, 0);
        setFinalReady(true);
      }
      worker.terminate();
    };
    worker.postMessage({ events: final.events, seed: final.seed, width: w, height: h });
  }, []);

  /* ---------------------------------------------------------- actions ---- */
  const saveImage = useCallback(() => {
    const c = finalRef.current;
    if (!c || !finalReady) return;
    c.toBlob((b) => {
      if (!b) return;
      const url = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(piece?.title ?? "impression").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }, [finalReady, piece]);

  const share = useCallback(async () => {
    if (!piece) return;
    setBusy(true);
    setError(null);
    try {
      const audioBase64 = keepAudio && audioBlob.current
        ? await blobToBase64(audioBlob.current)
        : null;
      // The still travels with the piece so link previews work without a
      // headless canvas on the server. It is the exact image on screen.
      const stillBase64 = finalRef.current && finalReady
        ? await canvasToBase64(finalRef.current)
        : null;
      const res = await fetch("/api/pieces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: piece.events, seed: piece.seed, subject: piece.subject,
          runnerUp: piece.runnerUp, light: piece.light, title: piece.title,
          durationMs: piece.durationMs,
          transcript: keepAudio ? words.current.map((w) => w.word).join(" ") : null,
          audioBase64, audioMime: audioBlob.current?.type ?? null, stillBase64,
          isPublic: addToGallery, promptId: prompt.id,
        }),
      });
      if (res.ok) {
        const j = (await res.json()) as { id: string; deleteToken: string };
        // The delete token is how an anonymous person deletes their own piece
        // (PRD 8). It exists only here.
        try {
          const owned = JSON.parse(localStorage.getItem("impression.owned") ?? "{}");
          owned[j.id] = j.deleteToken;
          localStorage.setItem("impression.owned", JSON.stringify(owned));
        } catch { /* private mode */ }
        setShareUrl(`${location.origin}/p/${j.id}`);
      } else {
        // No database: fall back to the self-contained fragment link, which
        // carries the painting but not the voice.
        const enc = await encodeShare({
          v: 1, events: piece.events, seed: piece.seed, title: piece.title,
          subject: piece.subject, light: piece.light, durationMs: piece.durationMs,
        });
        setShareUrl(`${location.origin}/p/s#${enc}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not share");
    } finally {
      setBusy(false);
    }
  }, [piece, keepAudio, addToGallery, prompt.id, finalReady]);

  const replay = useCallback(() => {
    if (!piece) return;
    setFinalReady(false);
    const c = canvasRef.current;
    if (!c) return;
    const { ctx, cfg } = fitCanvas(c, 4 / 3);
    const pt = new Painter(ctx, cfg, piece.seed);
    const order = drawOrder(piece.events, false);
    let i = 0;
    const t0 = performance.now();
    const a = audioRef.current;
    if (a && keepAudio) { a.currentTime = 0; void a.play(); }
    const tick = () => {
      const now = a && !a.paused ? a.currentTime * 1000 : performance.now() - t0;
      while (i < order.length && piece.events[order[i]].t <= now) { pt.draw(piece.events[order[i]], order[i]); i++; }
      if (i < order.length) requestAnimationFrame(tick);
      else setFinalReady(true);
    };
    requestAnimationFrame(tick);
  }, [piece, keepAudio]);

  const ring = Math.min(1, elapsed / MAX_MS);
  const canStop = elapsed >= MIN_MS;

  return (
    <main className="studio">
      <div className="stage">
        <div className="frame">
          <canvas ref={canvasRef} className="painting" />
          <canvas
            ref={finalRef}
            className="painting final"
            style={{ opacity: finalReady ? 1 : 0 }}
            aria-hidden={!finalReady}
          />
          {phase === "countdown" && (
            <div className="countdown" aria-live="polite">{count}</div>
          )}
        </div>
      </div>

      <section className="panel">
        {phase === "result" && piece ? (
          <>
            <h1 className="title">{piece.title}</h1>
            <p className="meta">
              {Math.round(piece.durationMs / 1000)} seconds · {piece.strokeCount} strokes
            </p>
          </>
        ) : (
          <>
            <h1 className="title">{prompt.text}</h1>
            <p className="meta">
              {phase === "recording"
                ? `${(elapsed / 1000).toFixed(1)}s${canStop ? "" : " · stop available at 3s"}`
                : "Thirty seconds. Your voice becomes the painting."}
            </p>
          </>
        )}

        <div className="controls">
          {phase === "idle" && (
            <button className="record" onClick={start} aria-label="Record">
              <span className="dot" />
              <span>Record</span>
            </button>
          )}
          {phase === "countdown" && <button className="record" disabled><span className="dot" /><span>Get ready</span></button>}
          {phase === "recording" && (
            <button className="record recording" onClick={stop} disabled={!canStop} aria-label="Stop recording">
              <svg viewBox="0 0 44 44" className="ring" aria-hidden="true">
                <circle cx="22" cy="22" r="20" className="ring-track" />
                <circle
                  cx="22" cy="22" r="20" className="ring-progress"
                  style={{ strokeDasharray: `${2 * Math.PI * 20}`, strokeDashoffset: `${2 * Math.PI * 20 * (1 - ring)}` }}
                />
              </svg>
              <span>Stop</span>
            </button>
          )}
          {phase === "result" && (
            <>
              <button className="record" onClick={start} aria-label="Record again"><span className="dot" /><span>Again</span></button>
              <button className="link" onClick={replay}>Replay</button>
              <button className="link" onClick={saveImage} disabled={!finalReady}>Save image</button>
              <button className="link" onClick={share} disabled={busy}>{busy ? "Sharing…" : "Share"}</button>
            </>
          )}
        </div>

        {phase === "result" && (
          <div className="options">
            {/* The audio toggle sits before the share sheet, never in settings,
                and defaults on with one tap to strip it (PRD 11). */}
            <label>
              <input type="checkbox" checked={keepAudio} onChange={(e) => setKeepAudio(e.target.checked)} />
              Include my voice
            </label>
            <label>
              <input type="checkbox" checked={addToGallery} onChange={(e) => setAddToGallery(e.target.checked)} />
              Add to today&apos;s gallery
            </label>
          </div>
        )}

        {shareUrl && (
          <p className="share-out">
            <a href={shareUrl}>{shareUrl.replace(/^https?:\/\//, "").slice(0, 64)}</a>{" "}
            <button className="link" onClick={() => navigator.clipboard?.writeText(shareUrl)}>copy</button>
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      {audioBlob.current && keepAudio && (
        <audio ref={audioRef} src={URL.createObjectURL(audioBlob.current)} preload="auto" />
      )}
    </main>
  );
}

async function canvasToBase64(c: HTMLCanvasElement): Promise<string | null> {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  return blob ? blobToBase64(blob) : null;
}

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) {
    s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export type { PaintEvent };
