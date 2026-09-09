/**
 * All randomness in the renderer comes from here (PRD 4.7).
 *
 * `Math.random()` is banned in every module under src/lib/render — the final
 * composition pass has to reproduce, stroke for stroke, the painting the user
 * just watched form, and a video renderer added later has to reproduce it again
 * on a server months from now.
 */

/** mulberry32. Fast, well-distributed, and trivially portable to a worker. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string, for deriving stable sub-seeds from names. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mix a numeric stream into a single seed. Used to derive the piece seed. */
export function hashNumbers(nums: ArrayLike<number>): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < nums.length; i++) {
    // quantise before hashing: float noise below this threshold must not change
    // the seed, or re-analysing the same audio would give a different painting.
    const q = Math.round(nums[i] * 1000) | 0;
    h ^= q & 0xff;         h = Math.imul(h, 0x01000193);
    h ^= (q >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A named sub-stream, so adding a new random draw in one place does not
 *  reshuffle every other stroke in the painting. */
export function subStream(seed: number, name: string): () => number {
  return mulberry32((seed ^ hashString(name)) >>> 0);
}

/** Uniform in [lo, hi). */
export const range = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);

/** Roughly gaussian, mean 0, sd ~0.29. Cheap and adequate for jitter. */
export const gauss = (r: () => number) => (r() + r() + r() - 1.5) / 1.5;

/** Pick one of a list. */
export const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.min(xs.length - 1, (r() * xs.length) | 0)];
