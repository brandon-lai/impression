"use client";

/**
 * The share surface (PRD 7.9).
 *
 * With no video export in v1, this page *is* the entire share experience, so
 * it is treated as a primary surface rather than an afterthought: the painting
 * forms again, in sync with the voice that made it.
 *
 * Autoplay is muted, because browsers block unmuted autoplay and a share that
 * silently does nothing is worse than a share with a tap-to-hear control. When
 * a piece has no audio, none is served at all and the painting animates on a
 * synthetic timeline.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PaintEvent, streamDuration } from "@/lib/events";
import { Painter, drawOrder } from "@/lib/render/renderer";
import { fitCanvas } from "@/lib/render/fit";

export interface SharePlayerProps {
  events: PaintEvent[];
  seed: number;
  title: string;
  durationMs: number;
  audioSrc?: string | null;
}

export function SharePlayer({ events, seed, title, durationMs, audioSrc }: SharePlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [done, setDone] = useState(false);
  const raf = useRef(0);

  const paint = useCallback((animate: boolean) => {
    const c = canvasRef.current;
    if (!c) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const { ctx, cfg } = fitCanvas(c, 4 / 3, !(animate && !reduce));
    const painter = new Painter(ctx, cfg, seed);
    const order = drawOrder(events, cfg.liftLightLayer);

    if (!animate || reduce) {
      for (const i of order) painter.draw(events[i], i);
      painter.finish();
      setDone(true);
      return;
    }

    setDone(false);
    let i = 0;
    const total = streamDuration(events) || durationMs || 1;
    const t0 = performance.now();
    const tick = () => {
      const a = audioRef.current;
      // Drive from the audio clock when there is audio, so the marks land on
      // the words that made them rather than drifting apart over 30 seconds.
      const now = a && !a.paused && !a.ended ? a.currentTime * 1000 : performance.now() - t0;
      while (i < order.length && events[order[i]].t <= now) { painter.draw(events[order[i]], order[i]); i++; }
      if (i < order.length && now < total + 1200) raf.current = requestAnimationFrame(tick);
      else {
        for (; i < order.length; i++) painter.draw(events[order[i]], order[i]);
        painter.finish();
        setDone(true);
      }
    };
    raf.current = requestAnimationFrame(tick);
  }, [events, seed, durationMs]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) { a.muted = true; a.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }
    paint(true);
    return () => cancelAnimationFrame(raf.current);
  }, [paint]);

  const replay = () => {
    cancelAnimationFrame(raf.current);
    const a = audioRef.current;
    if (a) { a.currentTime = 0; a.muted = muted; void a.play(); }
    paint(true);
  };

  const toggleSound = () => {
    const a = audioRef.current;
    if (!a) return;
    const next = !muted;
    setMuted(next);
    a.muted = next;
    if (!next && a.paused) { a.currentTime = 0; void a.play(); paint(true); }
  };

  return (
    <main className="studio">
      <div className="stage">
        <div className="frame">
          <canvas ref={canvasRef} className="painting" />
        </div>
      </div>
      <section className="panel">
        <h1 className="title">{title}</h1>
        <p className="meta">{Math.round(durationMs / 1000)} seconds of someone&apos;s voice</p>
        <div className="controls">
          <Link href="/" className="record" style={{ textDecoration: "none" }}>
            <span className="dot" /><span>Make your own</span>
          </Link>
          <button className="link" onClick={replay}>Replay</button>
          {audioSrc && (
            <button className="link" onClick={toggleSound}>
              {muted ? "Sound on" : "Sound off"}
            </button>
          )}
          {!done && <span className="meta">forming…</span>}
        </div>
        {audioSrc && !playing && muted && (
          <p className="meta">Tap sound on to hear the voice that made this.</p>
        )}
      </section>
      {audioSrc && <audio ref={audioRef} src={audioSrc} preload="auto" playsInline />}
    </main>
  );
}
