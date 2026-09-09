/**
 * Procedural brush tips (PRD 7.4).
 *
 * The single decision that separates this from generic computer art: a stroke
 * is a *stamp sequence*, not a bezier. Walk the path, stamp a bristled alpha
 * mask at intervals with varying rotation, scale and opacity. A solid vector
 * path with a round cap reads as a drawing tool; a sequence of overlapping
 * bristle prints reads as loaded paint.
 *
 * Masks are generated once, from a fixed seed, so a piece rendered in the
 * browser today and on a server in a year gets byte-identical brushes.
 */

import { mulberry32 } from "../prng";

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** Tip source resolution. Generous enough that the 3x export downsamples
 *  rather than upsamples; small enough that generation stays under ~60ms. */
const TIP_W = 160;
const TIP_H = 100;
export const TIP_ASPECT = TIP_W / TIP_H;

const TIP_VARIANTS = 5; // PRD asks for 4-6 masks
const EDGE_BANDS = 5;   // spectral centroid maps onto these (PRD 4.2)

const BRUSH_SEED = 0x1b7a5e; // fixed forever: brushes are not part of a piece's identity

export function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctxOf(c: AnyCanvas): Ctx2D {
  const ctx = (c as HTMLCanvasElement).getContext("2d", { willReadFrequently: false });
  if (!ctx) throw new Error("2d context unavailable");
  return ctx as Ctx2D;
}

/** Smooth value noise over one dimension, from a seeded lattice. */
function lattice(rand: () => number, n: number): (u: number) => number {
  const pts = new Float32Array(n);
  for (let i = 0; i < n; i++) pts[i] = rand();
  return (u: number) => {
    const x = u * (n - 1);
    const i = Math.min(n - 2, Math.floor(x));
    const f = x - i;
    const s = f * f * (3 - 2 * f); // smoothstep
    return pts[i] * (1 - s) + pts[i + 1] * s;
  };
}

/**
 * One alpha mask.
 *
 * @param band 0 = soft and blended (breath on the canvas), 4 = crisp and
 *             heavily loaded (a knife-edged deposit of paint).
 */
function buildMask(variant: number, band: number): AnyCanvas {
  const canvas = makeCanvas(TIP_W, TIP_H);
  const ctx = ctxOf(canvas);
  const img = ctx.createImageData(TIP_W, TIP_H);
  const data = img.data;

  const rand = mulberry32(BRUSH_SEED ^ (variant * 7919) ^ (band * 104729));

  // Bristle rows. Some rows are near-empty: those gaps are the whole reason
  // the mark reads as a brush rather than a smear.
  const bristleCount = 9 + variant * 3;
  const bristles = new Float32Array(TIP_H);
  {
    const jitter = lattice(rand, bristleCount * 2);
    for (let y = 0; y < TIP_H; y++) {
      const u = y / (TIP_H - 1);
      const phase = u * bristleCount * Math.PI * 2 + jitter(u) * 4;
      // Rectified sine gives fibres; the lattice makes their spacing uneven.
      let v = Math.abs(Math.sin(phase));
      v = 0.52 + 0.48 * Math.pow(v, 0.6 + band * 0.25);
      // occasional dead fibre
      // A few dead fibres, not many. Too many and the mark combs apart into
      // separate spikes instead of holding together as one loaded stroke.
      if (jitter(u * 0.97) < 0.10) v *= 0.45 + 0.4 * jitter(u * 1.31);
      bristles[y] = v;
    }
  }

  // Ragged outline. An elliptical footprint is the tell of a synthetic brush.
  const edgeTop = lattice(rand, 14);
  const edgeBot = lattice(rand, 14);
  const headBite = lattice(rand, 9);
  const grain = lattice(rand, 96);

  // Softness of the alpha ramp at the mark's boundary.
  const softness = 0.34 - band * 0.065; // 0.34 (band 0) .. 0.08 (band 4)
  const loadGamma = 1.35 - band * 0.16; // crisper bands hold their alpha longer

  for (let y = 0; y < TIP_H; y++) {
    const vy = y / (TIP_H - 1);
    for (let x = 0; x < TIP_W; x++) {
      const vx = x / (TIP_W - 1);

      // --- envelope along the stroke (x): loaded head, dragged-out tail ---
      const head = smoothstep(0, 0.10 + 0.10 * headBite(vx), vx);
      const tail = 1 - smoothstep(0.55, 1.0, vx) * (0.55 + 0.45 * headBite(vx * 0.6));
      const ex = head * Math.max(0, tail);

      // --- envelope across the stroke (y), with a ragged upper/lower edge ---
      const top = 0.06 + 0.14 * edgeTop(vx);
      const bot = 0.94 - 0.14 * edgeBot(vx);
      const ey =
        smoothstep(top - softness, top + softness * 0.6, vy) *
        (1 - smoothstep(bot - softness * 0.6, bot + softness, vy));

      // --- fibres and fine grain ---
      const g = 0.72 + 0.28 * grain(vx * 3.1 + vy * 0.7);
      let a = ex * ey * bristles[y] * g;
      a = Math.pow(Math.max(0, Math.min(1, a)), loadGamma);

      const i = (y * TIP_W + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function smoothstep(a: number, b: number, x: number): number {
  if (b <= a) return x < a ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface BrushSet {
  masks: AnyCanvas[][]; // [variant][band]
  /** Tinted stamp for a mask + colour. Cached: within a cluster the colours
   *  are analogous by construction, so the hit rate is high. */
  tinted(variant: number, band: number, r: number, g: number, b: number): AnyCanvas;
}

let cached: BrushSet | null = null;

export function getBrushes(): BrushSet {
  if (cached) return cached;

  const masks: AnyCanvas[][] = [];
  for (let v = 0; v < TIP_VARIANTS; v++) {
    const row: AnyCanvas[] = [];
    for (let b = 0; b < EDGE_BANDS; b++) row.push(buildMask(v, b));
    masks.push(row);
  }

  const cache = new Map<number, AnyCanvas>();
  const scratchPool: AnyCanvas[] = [];

  const tinted = (variant: number, band: number, r: number, g: number, b: number): AnyCanvas => {
    // 5 bits per channel. Finer than the eye needs at stamp scale, coarse
    // enough that a cluster's analogous colours collapse onto few entries.
    const qr = r >> 3, qg = g >> 3, qb = b >> 3;
    const key = ((variant * EDGE_BANDS + band) << 15) | (qr << 10) | (qg << 5) | qb;
    const hit = cache.get(key);
    if (hit) return hit;

    if (cache.size > 700) {
      // Colours drift monotonically through a piece, so old entries are dead.
      cache.clear();
      scratchPool.length = 0;
    }

    const c = makeCanvas(TIP_W, TIP_H);
    const ctx = ctxOf(c);
    ctx.drawImage(masks[variant][band] as CanvasImageSource, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = `rgb(${(qr << 3) | 4},${(qg << 3) | 4},${(qb << 3) | 4})`;
    ctx.fillRect(0, 0, TIP_W, TIP_H);
    ctx.globalCompositeOperation = "source-over";
    cache.set(key, c);
    return c;
  };

  cached = { masks, tinted };
  return cached;
}

/** Woven-linen alpha texture for the final pass (PRD 7.7.4). Canvas weave,
 *  not paper grain: two interleaved thread directions, not isotropic noise. */
export function buildCanvasTexture(w: number, h: number): AnyCanvas {
  const c = makeCanvas(w, h);
  const ctx = ctxOf(c);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const rand = mulberry32(BRUSH_SEED ^ 0x5eed);
  const warpJit = lattice(rand, 128);
  const weftJit = lattice(rand, 128);

  // ~7px thread pitch at export resolution reads as linen rather than as a grid.
  const pitch = Math.max(4, Math.round(w / 300));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const warp = Math.sin(((x + warpJit(y / h) * 3) / pitch) * Math.PI);
      const weft = Math.sin(((y + weftJit(x / w) * 3) / pitch) * Math.PI);
      // over-under: whichever thread is on top at this crossing catches light
      const over = ((Math.floor(x / pitch) + Math.floor(y / pitch)) & 1) === 0;
      const v = over ? warp * warp : weft * weft;
      const shade = 1 - 0.16 * (1 - v);
      const i = (y * w + x) * 4;
      const g = Math.round(shade * 255);
      d[i] = g; d[i + 1] = g; d[i + 2] = g; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
