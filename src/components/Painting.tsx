"use client";

/**
 * The canvas the painting forms on.
 *
 * Two modes, both driven by the identical event stream:
 *   - forming: events are drawn as their timestamps arrive, in real time
 *   - instant: the whole stream at once, for the finished piece
 *
 * `prefers-reduced-motion` collapses forming to instant and shows a play
 * button instead (PRD 9). The forming animation is the entire motion budget of
 * the product, so it is the only thing that has to respect the preference.
 */

import { useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { PaintEvent } from "@/lib/events";
import { Painter, RenderConfig, drawOrder } from "@/lib/render/renderer";
import { fitCanvas } from "@/lib/render/fit";
import type { Ctx2D } from "@/lib/render/brush";

export interface PaintingProps {
  events: PaintEvent[];
  seed: number;
  /** Aspect ratio, width / height. */
  aspect?: number;
  /** Play the stream in time. */
  forming?: boolean;
  /** ms of stream time per ms of wall clock. */
  speed?: number;
  final?: boolean;
  onDone?: () => void;
  /** Drive playback from an external clock (audio currentTime, in ms). */
  clockMs?: () => number | null;
  className?: string;
}

export function Painting({
  events, seed, aspect = 4 / 3, forming = false, speed = 1,
  final = false, onDone, clockMs, className,
}: PaintingProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const raf = useRef<number>(0);
  const doneRef = useRef(false);

  const setup = useCallback((): { ctx: Ctx2D; cfg: RenderConfig } | null => {
    const canvas = ref.current;
    if (!canvas) return null;
    // Measure synchronously. Waiting on a ResizeObserver's first callback
    // leaves the canvas blank for a frame in a browser and forever in a
    // headless one, which is exactly the bug that makes a screenshot lie.
    return fitCanvas(canvas, aspect, final);
  }, [aspect, final]);

  useLayoutEffect(() => {
    const s = setup();
    if (!s) return;
    const { ctx, cfg } = s;
    doneRef.current = false;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const painter = new Painter(ctx, cfg, seed);
    const order = drawOrder(events, cfg.liftLightLayer);

    if (!forming || reduce) {
      for (const i of order) painter.draw(events[i], i);
      painter.finish();
      onDone?.();
      return;
    }

    let cursor = 0;
    const start = performance.now();
    const tick = () => {
      const external = clockMs?.();
      const now = external ?? (performance.now() - start) * speed;
      while (cursor < order.length && events[order[cursor]].t <= now) {
        painter.draw(events[order[cursor]], order[cursor]);
        cursor++;
      }
      if (cursor < order.length) {
        raf.current = requestAnimationFrame(tick);
      } else if (!doneRef.current) {
        doneRef.current = true;
        painter.finish();
        onDone?.();
      }
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [events, seed, forming, speed, final, setup, onDone, clockMs]);

  // Repaint on resize, but only when the width actually changed: a mobile
  // browser fires resize on every URL-bar scroll and repainting 200 stamps
  // each time would drop the live pass below its frame budget.
  useEffect(() => {
    let lastW = ref.current?.parentElement?.clientWidth ?? 0;
    const onResize = () => {
      const w = ref.current?.parentElement?.clientWidth ?? 0;
      if (Math.abs(w - lastW) < 8) return;
      lastW = w;
      const s = setup();
      if (!s) return;
      const painter = new Painter(s.ctx, s.cfg, seed);
      for (const i of drawOrder(events, s.cfg.liftLightLayer)) painter.draw(events[i], i);
      painter.finish();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [events, seed, setup]);

  return <canvas ref={ref} className={`painting ${className ?? ""}`} />;
}
