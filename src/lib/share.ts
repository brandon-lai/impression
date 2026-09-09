/**
 * Share encoding.
 *
 * Two paths, and which one is available depends on whether a database is
 * configured:
 *
 *   /p/<id>   the real share. Stored piece, stored audio, the recipient hears
 *             the voice that made it. Requires the database.
 *
 *   /p/s#<data>  the fallback. The whole event stream, gzipped and packed into
 *             the URL *fragment*, which never leaves the browser. The painting
 *             forms again on a synthetic timeline with no audio.
 *
 * The fallback exists because the event stream is only a few KB (PRD 7.3) and
 * because a share that silently does nothing is worse than a share that is
 * honest about carrying no audio. It is also what keeps the deployed product
 * demonstrable before any credential exists.
 */

import { PaintEvent } from "./events";

export interface SharePayload {
  v: 1;
  events: PaintEvent[];
  seed: number;
  title: string;
  subject: string;
  light: string;
  durationMs: number;
}

const toB64Url = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromB64Url = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** Coordinates are rounded to 4 decimals before packing. At any plausible
 *  canvas size that is far below one pixel, and it roughly halves the payload. */
function shrink(p: SharePayload): SharePayload {
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return {
    ...p,
    events: p.events.map((e) => {
      if (e.type === "stroke") {
        return { ...e, t: Math.round(e.t),
          path: e.path.map((v) => ({ x: r(v.x), y: r(v.y) })),
          width: r(e.width), angle: r(e.angle), hue: r(e.hue),
          chroma: r(e.chroma), lightness: r(e.lightness), load: r(e.load) };
      }
      if (e.type === "horizon") return { ...e, points: e.points.map((v) => ({ x: r(v.x), y: r(v.y) })) };
      if (e.type === "cluster") return { ...e, center: { x: r(e.center.x), y: r(e.center.y) } };
      return { ...e, hue: r(e.hue), lightness: r(e.lightness) };
    }),
  };
}

export async function encodeShare(p: SharePayload): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(shrink(p)));
  const gz = new Response(
    new Blob([json as BufferSource]).stream().pipeThrough(new CompressionStream("gzip")),
  );
  return toB64Url(new Uint8Array(await gz.arrayBuffer()));
}

export async function decodeShare(encoded: string): Promise<SharePayload | null> {
  try {
    const bytes = fromB64Url(encoded);
    const stream = new Blob([bytes as BufferSource]).stream().pipeThrough(new DecompressionStream("gzip"));
    const text = await new Response(stream).text();
    const parsed = JSON.parse(text) as SharePayload;
    return parsed.v === 1 && Array.isArray(parsed.events) ? parsed : null;
  } catch {
    return null;
  }
}
