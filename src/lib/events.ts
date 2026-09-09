/**
 * The paint event stream (PRD 7.3).
 *
 * Analysis produces these; the renderer consumes them and nothing else. That
 * separation is what makes the final composition pass possible, what keeps the
 * renderer a pure function (PRD 4.7), and what makes a server-side video
 * renderer a purely additive change later (PRD 7.8).
 *
 * All coordinates and widths are normalised to 0-1 against canvas width, never
 * pixels. The live pass and the 3x final export consume the identical stream;
 * only RenderConfig differs. Storing pixels here would have silently broken
 * that, because the live canvas size depends on the viewport.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type SubjectId = "water" | "garden" | "field" | "sky" | "street" | "interior";

export type Layer = "under" | "mid" | "light";

export interface GroundEvent {
  t: number;
  type: "ground";
  hue: number;
  lightness: number;
}

export interface HorizonEvent {
  t: number;
  type: "horizon";
  points: Vec2[];
}

export interface ClusterEvent {
  t: number;
  type: "cluster";
  id: number;
  center: Vec2;
  subject: SubjectId;
}

export interface StrokeEvent {
  t: number;
  type: "stroke";
  clusterId: number;
  path: Vec2[]; // 2-4 control points
  width: number;
  angle: number;
  hue: number;
  chroma: number;
  lightness: number;
  edgeBand: 0 | 1 | 2 | 3 | 4;
  load: number; // paint thickness, drives texture density
  layer: Layer;
}

export type PaintEvent = GroundEvent | HorizonEvent | ClusterEvent | StrokeEvent;

export const isStroke = (e: PaintEvent): e is StrokeEvent => e.type === "stroke";

/** Total duration covered by a stream, in ms. */
export function streamDuration(events: PaintEvent[]): number {
  let max = 0;
  for (const e of events) if (e.t > max) max = e.t;
  return max;
}

export function countStrokes(events: PaintEvent[]): number {
  let n = 0;
  for (const e of events) if (e.type === "stroke") n++;
  return n;
}

/**
 * The stroke budget (PRD 4.1 and 13). Impressionist *technique* at gestural
 * scale: 80-200 large loaded strokes, never thousands of dabs. A thousand tiny
 * pastel dabs from five different speakers look like five identical hazes and
 * the core claim -- that your voice made this and no one else's would have --
 * dies with them.
 */
export const STROKE_MIN = 80;
export const STROKE_MAX = 200;
export const STROKE_HARD_CAP = 300;
