/**
 * Titles (PRD 5).
 *
 * Monet titled by subject, place and light. "Garden, evening, 24 seconds"
 * matches that format exactly, which is the point: it is the gallery label
 * under the piece and the share text at the same time, and it is free
 * shareability.
 */

import { SubjectId } from "../events";
import { SUBJECTS } from "../render/subjects";

export type Light = "morning" | "midday" | "evening" | "overcast";

export function makeTitle(subject: SubjectId, light: Light, durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  return `${SUBJECTS[subject].label}, ${light}, ${seconds} second${seconds === 1 ? "" : "s"}`;
}
