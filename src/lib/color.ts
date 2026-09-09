/**
 * OKLCH is the working colour space for the whole product (PRD 4.4).
 *
 * It is the right choice here for one specific reason: the palette rules are
 * stated in terms of *lightness spread* ("L 0.35 to 0.92") and hue-vs-value
 * independence ("pastel refers to hue, not value"). In HSL those two are
 * hopelessly entangled — an HSL yellow at L=0.5 is far brighter than an HSL
 * blue at L=0.5 — so the value-range assertion would be meaningless.
 */

export interface Oklch {
  l: number; // 0-1
  c: number; // 0 - ~0.37
  h: number; // degrees
}

function linearToSrgb(x: number): number {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** OKLCH -> sRGB in 0-255. Out-of-gamut components are clipped by the caller
 *  via `gamutFit`; this does the raw transform. */
export function oklchToRgbRaw(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;

  return [
    linearToSrgb(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    linearToSrgb(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    linearToSrgb(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S),
  ];
}

const inGamut = (rgb: [number, number, number]) =>
  rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/**
 * Reduce chroma until the colour is representable, keeping hue and lightness.
 * Clipping RGB instead would shift hue — a high-chroma orange clips to a
 * different orange — and hue is carrying semantic meaning in this product.
 */
export function gamutFit(l: number, c: number, h: number): [number, number, number] {
  let raw = oklchToRgbRaw(l, c, h);
  if (inGamut(raw)) return raw;
  let lo = 0;
  let hi = c;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    raw = oklchToRgbRaw(l, mid, h);
    if (inGamut(raw)) lo = mid;
    else hi = mid;
  }
  raw = oklchToRgbRaw(l, lo, h);
  return [
    Math.min(1, Math.max(0, raw[0])),
    Math.min(1, Math.max(0, raw[1])),
    Math.min(1, Math.max(0, raw[2])),
  ];
}

export function oklchToCss(l: number, c: number, h: number, alpha = 1): string {
  const [r, g, b] = gamutFit(l, c, h);
  const R = Math.round(r * 255);
  const G = Math.round(g * 255);
  const B = Math.round(b * 255);
  return alpha >= 1 ? `rgb(${R},${G},${B})` : `rgba(${R},${G},${B},${alpha.toFixed(3)})`;
}

export const wrapHue = (h: number) => ((h % 360) + 360) % 360;

/**
 * The no-black rule (PRD 4.4), enforced at the only place colour is created.
 *
 * Anything dark is pulled toward blue-violet and kept off the achromatic axis.
 * This is the single rule that most makes the output read as impressionist
 * rather than as generic computer art, so it is applied unconditionally rather
 * than left to each subject's palette to remember.
 */
export const SHADOW_HUE = 285;

export function noBlack(l: number, c: number, h: number): Oklch {
  if (l >= 0.42) return { l, c, h };
  const t = Math.min(1, (0.42 - l) / 0.42); // 0 at the threshold, 1 at pure black
  return {
    l: Math.max(0.3, l),
    // darker => more decisively blue-violet, and never desaturated to grey
    c: Math.max(c, 0.05 + 0.09 * t),
    h: wrapHue(h + shortestHueStep(h, SHADOW_HUE) * (0.55 + 0.45 * t)),
  };
}

function shortestHueStep(from: number, to: number): number {
  let d = wrapHue(to) - wrapHue(from);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
