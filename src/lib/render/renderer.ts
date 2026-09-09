/**
 * The renderer (PRD 4.7, 7.4).
 *
 *   render(marks: PaintEvent[], seed: number, config: RenderConfig): void
 *
 * Pure. Same inputs, identical output, forever. Three things depend on that:
 * the final composition pass has to match the painting the user just watched
 * form; someone will record the same clip twice and check; and a server-side
 * video renderer added later replays this same stream headlessly with no other
 * change (PRD 7.8).
 *
 * Consequently, nothing in this file may read `Math.random()`, `Date.now()`,
 * `devicePixelRatio`, or anything else ambient. Every random draw comes from a
 * sub-stream keyed by the event's index, which is also what lets the live pass
 * draw events one at a time and still land on exactly the pixels the one-shot
 * render produces.
 */

import { PaintEvent, StrokeEvent, Vec2 } from "../events";
import { gamutFit, noBlack, wrapHue } from "../color";
import { getBrushes, buildCanvasTexture, TIP_ASPECT, Ctx2D, AnyCanvas } from "./brush";
import { mulberry32, gauss } from "../prng";

export interface RenderConfig {
  /** CSS pixels of the drawing surface. */
  width: number;
  height: number;
  /** Backing-store multiplier. Passed in, never read from the environment. */
  pixelRatio: number;
  /** Stamp step as a fraction of stroke width. Lower = denser, slower. */
  stampSpacing: number;
  /** Woven-linen overlay. Final pass only (PRD 7.7). */
  canvasTexture: boolean;
  /**
   * Draw the light layer last, over everything.
   *
   * The live pass cannot do this: it is painting in real time and a highlight
   * struck at second 6 cannot wait for second 30. The final pass can, and
   * "highlights go on last" (PRD 7.4.3) is the difference between a sketch and
   * a finished oil. It touches only the handful of light-layer strokes -- the
   * passages of light -- so the piece stays recognisably the one that formed
   * on screen, which PRD 7.7 requires.
   */
  liftLightLayer: boolean;
}

export const LIVE_CONFIG = (w: number, h: number, pixelRatio: number): RenderConfig => ({
  width: w, height: h, pixelRatio,
  stampSpacing: 0.22, canvasTexture: false, liftLightLayer: false,
});

export const FINAL_CONFIG = (w: number, h: number, pixelRatio: number): RenderConfig => ({
  width: w, height: h, pixelRatio,
  stampSpacing: 0.15, canvasTexture: true, liftLightLayer: true,
});

/** Catmull-Rom through the control points, sampled to a polyline. */
function samplePath(points: Vec2[], out: Vec2[], steps: number): void {
  out.length = 0;
  if (points.length === 1) { out.push(points[0]); return; }
  if (points.length === 2) {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      out.push({ x: points[0].x + (points[1].x - points[0].x) * t,
                 y: points[0].y + (points[1].y - points[0].y) * t });
    }
    return;
  }
  const p = [points[0], ...points, points[points.length - 1]];
  for (let seg = 0; seg < p.length - 3; seg++) {
    const [p0, p1, p2, p3] = [p[seg], p[seg + 1], p[seg + 2], p[seg + 3]];
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(p[p.length - 2]);
}

export class Painter {
  private ctx: Ctx2D;
  private cfg: RenderConfig;
  private seed: number;
  private texture: AnyCanvas | null = null;
  /** Scratch, reused across strokes so a 30s piece does not allocate 250 arrays. */
  private poly: Vec2[] = [];
  /** Ground tone, remembered so the horizon band is painted in the family of
   *  the underpainting rather than in an arbitrary near-white. */
  private ground = { hue: 40, lightness: 0.72 };

  constructor(ctx: Ctx2D, cfg: RenderConfig, seed: number) {
    this.ctx = ctx;
    this.cfg = cfg;
    this.seed = seed >>> 0;
    this.begin();
  }

  private get W() { return this.cfg.width * this.cfg.pixelRatio; }
  private get H() { return this.cfg.height * this.cfg.pixelRatio; }

  begin(): void {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
  }

  /** Draw one event. `index` must be its position in the full stream. */
  draw(e: PaintEvent, index: number): void {
    switch (e.type) {
      case "ground":
        this.ground = { hue: e.hue, lightness: e.lightness };
        return this.drawGround(e.hue, e.lightness, index);
      case "horizon": return this.drawHorizon(e.points, index);
      case "cluster": return; // structural only; strokes carry the paint
      case "stroke": return this.drawStroke(e, index);
    }
  }

  /**
   * The underpainting (PRD 4.2 "voice signature -> ground tone").
   *
   * Deliberately not a fill and emphatically not a gradient (PRD 4.4). It is a
   * scumble: broad, dry, near-analogous strokes laid across the whole canvas so
   * that even the untouched passages of a sparse piece have paint in them and
   * some colour variation to catch the eye.
   */
  private drawGround(hue: number, lightness: number, index: number): void {
    const { ctx } = this;
    const rand = mulberry32(this.seed ^ (index * 0x9e3779b1) ^ 0x60c0d4);
    const W = this.W, H = this.H;

    const base = noBlack(lightness, 0.035, hue);
    const [r, g, b] = gamutFit(base.l, base.c, base.h);
    ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    ctx.fillRect(0, 0, W, H);

    const brushes = getBrushes();
    // Scale matters here. Stretching the 160px tip mask across a third of the
    // canvas turns its bristle detail into flat bands, and the underpainting
    // reads as translucent slabs instead of as brushwork -- which is exactly
    // how the first landing render looked.
    const bandW = W / 9;
    for (let i = 0; i < 420; i++) {
      const cx = rand() * (W + bandW) - bandW / 2;
      const cy = rand() * H;
      const len = bandW * (0.7 + rand() * 1.1);
      const wid = H * (0.028 + rand() * 0.055);
      const ang = (gauss(rand) * 0.7) + (rand() < 0.35 ? Math.PI / 2 : 0);
      const l = Math.max(0.34, Math.min(0.94, lightness + gauss(rand) * 0.11));
      const h = wrapHue(hue + gauss(rand) * 40);
      const fixed = noBlack(l, 0.05 + rand() * 0.045, h);
      const [rr, gg, bb] = gamutFit(fixed.l, fixed.c, fixed.h);
      const tip = brushes.tinted(
        (rand() * 5) | 0, 0,
        Math.round(rr * 255), Math.round(gg * 255), Math.round(bb * 255),
      );
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.11 + rand() * 0.17;
      ctx.drawImage(tip as CanvasImageSource, -len / 2, -wid / 2, len, wid);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The horizon (PRD 4.2) -- the compositional spine, derived from the pitch
   * contour. It is not drawn as a line. A drawn line would be the one hard
   * edge in a painting made of broken colour and would instantly read as
   * vector art. It is a band of broad horizontal marks straddling the contour,
   * which is how the division actually appears in the reference paintings.
   */
  private drawHorizon(points: Vec2[], index: number): void {
    if (points.length < 2) return;
    const { ctx } = this;
    const rand = mulberry32(this.seed ^ (index * 0x85ebca6b) ^ 0x40712011);
    const W = this.W, H = this.H;
    const brushes = getBrushes();

    const yAt = (u: number) => {
      const x = Math.max(0, Math.min(1, u)) * (points.length - 1);
      const i = Math.min(points.length - 2, Math.floor(x));
      const f = x - i;
      return (points[i].y * (1 - f) + points[i + 1].y * f) * H;
    };

    const n = 34;
    for (let i = 0; i < n; i++) {
      const u = (i + rand() * 0.8) / n;
      const y = yAt(u) + gauss(rand) * H * 0.022;
      const len = W * (0.10 + rand() * 0.16);
      const wid = H * (0.018 + rand() * 0.030);
      ctx.save();
      ctx.translate(u * W, y);
      ctx.rotate(gauss(rand) * 0.10);
      ctx.globalAlpha = 0.16 + rand() * 0.22;
      const hl = Math.max(0.3, Math.min(0.94, this.ground.lightness + 0.14 + gauss(rand) * 0.06));
      const hc = noBlack(hl, 0.05, wrapHue(this.ground.hue + gauss(rand) * 30));
      const [hr, hg2, hb] = gamutFit(hc.l, hc.c, hc.h);
      const tip = brushes.tinted(
        (rand() * 5) | 0, 1,
        Math.round(hr * 255), Math.round(hg2 * 255), Math.round(hb * 255),
      );
      ctx.drawImage(tip as CanvasImageSource, -len / 2, -wid / 2, len, wid);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * One stroke: a stamp sequence along the path (PRD 7.4.2).
   *
   * Broken colour (PRD 4.3) is applied here at stamp granularity as well as at
   * stroke granularity -- each print shifts hue and lightness slightly around
   * the stroke's own colour. Nothing is mixed before placement; adjacent
   * deposits of unmixed colour do the mixing in the eye, which is the actual
   * technique and costs nothing.
   */
  private drawStroke(s: StrokeEvent, index: number): void {
    const { ctx } = this;
    const rand = mulberry32(this.seed ^ (index * 0xc2b2ae35) ^ 0x5713);
    const W = this.W, H = this.H;
    const brushes = getBrushes();

    const widthPx = Math.max(2, s.width * W);
    samplePath(s.path, this.poly, 10);
    const poly = this.poly;

    // Arc-length walk. Spacing scales with width so fat strokes do not cost
    // hundreds of stamps and thin ones do not come out dotted.
    const step = Math.max(1.2, widthPx * this.cfg.stampSpacing);
    let acc = 0;
    let total = 0;
    for (let i = 1; i < poly.length; i++) {
      total += Math.hypot((poly[i].x - poly[i - 1].x) * W, (poly[i].y - poly[i - 1].y) * H);
    }
    if (total < 1) total = widthPx;

    const variant = (rand() * 5) | 0;
    const band = s.edgeBand;
    // Paint load drives how opaque and how densely deposited each print is.
    // Per-stamp alpha is low because prints accumulate: at this spacing five
    // to seven overlap at any point along the path, and the stroke's opacity
    // is their sum rather than any one of them.
    const baseAlpha = (0.30 + 0.62 * Math.max(0, Math.min(1, s.load))) * 0.42;
    const tipLen = widthPx * TIP_ASPECT;

    let travelled = 0;
    for (let i = 1; i < poly.length; i++) {
      const ax = poly[i - 1].x * W, ay = poly[i - 1].y * H;
      const bx = poly[i].x * W, by = poly[i].y * H;
      const segLen = Math.hypot(bx - ax, by - ay);
      if (segLen < 1e-6) continue;
      const segAng = Math.atan2(by - ay, bx - ax);

      for (acc -= 0; acc < segLen; acc += step) {
        const f = acc / segLen;
        const px = ax + (bx - ax) * f;
        const py = ay + (by - ay) * f;
        const u = Math.max(0, Math.min(1, (travelled + acc) / total)); // 0..1 along stroke

        // Pressure: the brush lands, loads, and lifts. Asymmetric on purpose --
        // a symmetric swell reads as a machine-made shape.
        const peak = 0.34 + rand() * 0.22;
        const pressure =
          u < peak
            ? 0.45 + 0.55 * Math.pow(u / peak, 0.55)
            : 1 - 0.72 * Math.pow((u - peak) / (1 - peak + 1e-6), 1.5);

        const sc = pressure * (0.86 + rand() * 0.28);
        const w = widthPx * sc;
        const l = tipLen * sc * (0.9 + rand() * 0.3);

        // Broken colour, per stamp.
        const hue = wrapHue(s.hue + gauss(rand) * 7);
        const light = Math.max(0.28, Math.min(0.96, s.lightness + gauss(rand) * 0.055));
        const chroma = Math.max(0, s.chroma * (0.82 + rand() * 0.36));
        const fixed = noBlack(light, chroma, hue);
        const [r, g, b] = gamutFit(fixed.l, fixed.c, fixed.h);

        const tip = brushes.tinted(
          variant, band,
          Math.round(r * 255), Math.round(g * 255), Math.round(b * 255),
        );

        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(segAng + gauss(rand) * 0.16);
        // source-over with per-stamp alpha only. `multiply` and `screen` both
        // read as digital compositing rather than as paint (PRD 7.4.4).
        ctx.globalAlpha = Math.max(0.04, Math.min(1, baseAlpha * (0.7 + rand() * 0.5) * pressure));
        ctx.drawImage(tip as CanvasImageSource, -l * 0.5, -w * 0.5, l, w);
        ctx.restore();
      }
      acc -= segLen;
      travelled += segLen;
    }
    ctx.globalAlpha = 1;
  }

  /** The woven-linen pass. The one place `multiply` is correct: it is a
   *  physical substrate showing through paint, not a compositing effect. */
  finish(): void {
    if (!this.cfg.canvasTexture) return;
    const { ctx } = this;
    if (!this.texture) this.texture = buildCanvasTexture(this.W, this.H);
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    // Subtle. At 0.5 the weave stops being a substrate and becomes a grid
    // printed over the painting -- clearly visible in the first render.
    ctx.globalAlpha = 0.13;
    ctx.drawImage(this.texture as CanvasImageSource, 0, 0, this.W, this.H);
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }
}

/** Order events for drawing, honouring `liftLightLayer`. Returns the original
 *  indices so per-event seeding is unaffected by the reordering. */
export function drawOrder(events: PaintEvent[], lift: boolean): number[] {
  const idx = events.map((_, i) => i);
  if (!lift) return idx;
  const rank = (e: PaintEvent) => (e.type === "stroke" && e.layer === "light" ? 1 : 0);
  return idx.sort((a, b) => rank(events[a]) - rank(events[b]) || a - b);
}

/** The pure entry point (PRD 4.7). */
export function render(marks: PaintEvent[], seed: number, config: RenderConfig, ctx: Ctx2D): void {
  const p = new Painter(ctx, config, seed);
  for (const i of drawOrder(marks, config.liftLightLayer)) p.draw(marks[i], i);
  p.finish();
}
