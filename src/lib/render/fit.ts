"use client";

import { LIVE_CONFIG, FINAL_CONFIG, RenderConfig } from "./renderer";
import type { Ctx2D } from "./brush";

/**
 * Size a canvas to fit inside its container at a fixed aspect ratio.
 *
 * Deriving the height from the container's *width* alone is the obvious
 * version and it is wrong: the frame is also constrained by `max-height: 70vh`,
 * so on a wide viewport the canvas came out taller than the box that holds it,
 * overflowed, and covered the gallery label underneath -- the one thing PRD 9
 * says must never happen ("nothing floats over the painting"). Fitting against
 * both axes is what keeps the label visible.
 */
export function fitCanvas(
  c: HTMLCanvasElement,
  aspect: number,
  final = false,
): { ctx: Ctx2D; cfg: RenderConfig } {
  const parent = c.parentElement;
  const availW = Math.max(1, parent?.clientWidth || 640);
  const availH = parent?.clientHeight || 0;

  let cssW = availW;
  let cssH = cssW / aspect;
  if (availH > 0 && cssH > availH) {
    cssH = availH;
    cssW = cssH * aspect;
  }
  cssW = Math.round(cssW);
  cssH = Math.round(cssH);

  // devicePixelRatio is read here, at the boundary, and handed to the renderer.
  // The renderer must never read it: it has to stay a pure function (PRD 4.7).
  const dpr = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  c.width = Math.round(cssW * dpr);
  c.height = Math.round(cssH * dpr);
  c.style.width = `${cssW}px`;
  c.style.height = `${cssH}px`;

  return {
    ctx: c.getContext("2d") as Ctx2D,
    cfg: final ? FINAL_CONFIG(cssW, cssH, dpr) : LIVE_CONFIG(cssW, cssH, dpr),
  };
}
