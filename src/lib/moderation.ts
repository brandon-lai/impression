/**
 * Gallery moderation (PRD 10).
 *
 * Public submission is opt-in per piece and transcripts pass this filter before
 * appearing. Private shares are unlisted and skip it entirely -- filtering what
 * someone sends to one friend would be both pointless and rude.
 *
 * Deliberately a small, blunt list. The gallery shows one day of opt-in pieces
 * on a side project; the failure mode worth engineering against is a slur on
 * the front page, not a determined adversary, and anything cleverer is a
 * moderation programme rather than a filter.
 */

const BLOCK = [
  "nigger", "nigga", "faggot", "fag", "kike", "spic", "chink", "tranny", "retard",
  "rape", "raping", "rapist", "molest", "pedophile", "paedophile", "childporn",
  "kys", "killyourself", "lynch",
];

const SOFT = ["fuck", "shit", "cunt", "bitch", "whore", "dick", "cock", "asshole"];

export type ModerationStatus = "approved" | "pending" | "rejected";

export function moderate(transcript: string | null): ModerationStatus {
  if (!transcript) return "approved"; // nothing to read
  const norm = transcript.toLowerCase().replace(/[^a-z]+/g, "");
  const words = transcript.toLowerCase().split(/[^a-z']+/).filter(Boolean);

  for (const bad of BLOCK) {
    // Match the squashed string too, so "n i g g e r" does not walk through.
    if (norm.includes(bad) || words.includes(bad)) return "rejected";
  }
  // Profanity alone is not a reason to reject a piece from a gallery of
  // people describing their kitchens, but it should not auto-publish either.
  for (const w of words) if (SOFT.includes(w)) return "pending";
  return "approved";
}
