/**
 * The final composition pass (PRD 7.7).
 *
 * Runs in a Worker so the cross-fade underneath it stays smooth. Same event
 * stream, same seed; only RenderConfig changes. What it can do that the live
 * pass could not is know the whole arc -- so it renders at export resolution,
 * lays the canvas weave over the top, and lifts the light layer above
 * everything, which a pass painting in real time cannot do.
 */

import { PaintEvent } from "../events";
import { Painter, FINAL_CONFIG, drawOrder } from "./renderer";
import type { Ctx2D } from "./brush";

export interface FinalRequest {
  events: PaintEvent[];
  seed: number;
  width: number;
  height: number;
}

export interface FinalResponse {
  bitmap: ImageBitmap;
  ms: number;
}

self.onmessage = (e: MessageEvent<FinalRequest>) => {
  const { events, seed, width, height } = e.data;
  const t0 = performance.now();

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d") as Ctx2D | null;
  if (!ctx) return;

  // pixelRatio 1: `width`/`height` are already the export pixel dimensions.
  const cfg = FINAL_CONFIG(width, height, 1);
  const painter = new Painter(ctx, cfg, seed);
  for (const i of drawOrder(events, cfg.liftLightLayer)) painter.draw(events[i], i);
  painter.finish();

  const bitmap = canvas.transferToImageBitmap();
  (self as unknown as Worker).postMessage({ bitmap, ms: performance.now() - t0 }, [bitmap]);
};
